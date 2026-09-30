-- ===========================================================================
-- Marketplace lifecycle: cancellation model, PAUSED, listing review
-- ===========================================================================
--
-- WHY THIS MIGRATION EXISTS
--
-- Three gaps, one theme: the engine knew LIVE and terminal states, but
-- nothing in between. A seller with bids had no legitimate path to end an
-- auction (cancel_auction refused has_bids, delete was DRAFT-only), an admin
-- had no safety hold between "leave it running" and "kill it", and every
-- listing published with zero scrutiny. Each gap invited either a workaround
-- (direct writes, support DMs) or a worse outcome (invalid state). This
-- migration adds the missing states and the tables that make them auditable,
-- without touching a single existing transition.
--
-- WHAT IT ADDS
--
-- States (appended to auction_status_t; existing values never move):
--   PAUSED         - admin-only safety hold. Not terminal, not biddable, not
--                    settleable. Bids and history retained. Only admin pause /
--                    resume / takedown touch it.
--   PENDING_REVIEW - a listing the risk screen held for a human. Not public,
--                    not biddable. Seller may withdraw to DRAFT; admin may
--                    approve (SCHEDULED/LIVE), reject or request changes
--                    (DRAFT + notice).
--
-- Tables:
--   auction_cancellations - every cancellation, seller or admin: actor, role,
--     previous status, reason code, explanation, timestamp. Takedowns write
--     here AND to moderation_events (lifecycle history vs ops trail stay
--     separate on purpose).
--   auction_cancellation_requests - seller requests to end a with-bids LIVE
--     auction: reason code, explanation, PENDING/APPROVED/REJECTED/WITHDRAWN,
--     reviewer + decision + timestamp. One PENDING per auction (partial
--     unique). The auction stays LIVE until an admin approves.
--   listing_reviews - one active review per auction: PENDING/APPROVED/
--     REJECTED/CHANGES_REQUESTED/WITHDRAWN, reviewer, reason, risk flags.
--
-- Engine changes (all additive):
--   place_bid refuses PAUSED ('auction_paused') and PENDING_REVIEW.
--   publish_auction routes risky listings to PENDING_REVIEW + review row.
--   cancel_auction takes an optional reason code, requires it past DRAFT,
--     refuses PAUSED entirely, and writes auction_cancellations.
--   New RPCs: admin_pause_auction, admin_resume_auction (deterministic
--     remaining-time math), request_cancellation, decide_cancellation,
--     withdraw_cancellation, admin_decide_review, withdraw_listing_review.
--
-- RLS: PENDING_REVIEW is seller/admin-only (select + can_view_auction);
-- everything else already excludes the new states correctly by omission
-- (update lists DRAFT/SCHEDULED/LIVE, so sellers cannot touch PAUSED or
-- review rows; images/storage lists match). New tables: reads for
-- requester/seller/admin as appropriate, ALL writes through the RPCs below
-- (no client insert/update/delete policies at all).
--
-- Notifications: REVIEW_SUBMITTED, REVIEW_APPROVED, REVIEW_REJECTED,
-- REVIEW_CHANGES_REQUESTED, CANCELLATION_REQUESTED, CANCELLATION_DECIDED,
-- AUCTION_PAUSED, AUCTION_RESUMED, AUCTION_CANCELLED, BID_CONFIRMED.

-- ---- 1b. pause timestamp ------------------------------------------------------------
alter table public.auctions
  add column if not exists paused_at timestamptz;

comment on column public.auctions.paused_at is
  'When the current PAUSED hold began. Set by admin_pause_auction, cleared by
   admin_resume_auction, which extends ends_at by (resumed - paused) so the
   remaining time is deterministic and pause history survives in
   moderation_events.';

-- ---- 2. reason codes ------------------------------------------------------------
create table if not exists public.auction_cancellations (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  auction_id    uuid not null references public.auctions(id) on delete cascade,
  actor_id      uuid not null references public.profiles(id),
  actor_role    text not null check (actor_role in ('seller','admin')),
  prev_status   text not null,
  reason_code   text not null check (reason_code in (
                  'ITEM_UNAVAILABLE','ITEM_DAMAGED','LISTING_ERROR',
                  'SELLER_WITHDRAWAL','TECHNICAL_PROBLEM','OTHER'
                )),
  explanation   text check (explanation is null or char_length(explanation) <= 1000)
);
create index if not exists auction_cancellations_auction_idx
  on public.auction_cancellations (auction_id, created_at desc);

alter table public.auction_cancellations enable row level security;

-- The seller reads their own auction's closure; admins read everything.
-- Writes go through cancel_auction()/takedown only (both SECURITY DEFINER):
-- a closure row anyone can hand-write proves nothing.
drop policy if exists auction_cancellations_select on public.auction_cancellations;
create policy auction_cancellations_select on public.auction_cancellations
  for select to authenticated
  using (
    private.is_admin()
    or exists (select 1 from public.auctions a
                where a.id = auction_cancellations.auction_id
                  and a.seller_id = (select auth.uid()))
  );

-- ---- 3. cancellation requests ---------------------------------------------------
create table if not exists public.auction_cancellation_requests (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  auction_id     uuid not null references public.auctions(id) on delete restrict,
  requester_id   uuid not null references public.profiles(id),
  reason_code    text not null check (reason_code in (
                   'ITEM_UNAVAILABLE','ITEM_DAMAGED','LISTING_ERROR',
                   'SELLER_WITHDRAWAL','TECHNICAL_PROBLEM','OTHER'
                 )),
  explanation    text check (explanation is null or char_length(explanation) <= 1000),
  status         text not null default 'PENDING' check (status in (
                   'PENDING','APPROVED','REJECTED','WITHDRAWN'
                 )),
  reviewer_id    uuid references public.profiles(id),
  reviewer_reason text check (reviewer_reason is null or char_length(reviewer_reason) <= 1000),
  reviewed_at    timestamptz
);
-- One live request per auction: a second submit while one is pending is a
-- duplicate, not a new decision.
create unique index if not exists auction_cancellation_requests_one_pending_idx
  on public.auction_cancellation_requests (auction_id)
  where status = 'PENDING';
create index if not exists auction_cancellation_requests_status_idx
  on public.auction_cancellation_requests (status, created_at desc);

alter table public.auction_cancellation_requests enable row level security;

-- Requester and auction seller read; admins read all. All writes through RPCs.
drop policy if exists auction_cancellation_requests_select on public.auction_cancellation_requests;
create policy auction_cancellation_requests_select on public.auction_cancellation_requests
  for select to authenticated
  using (
    private.is_admin()
    or requester_id = (select auth.uid())
    or exists (select 1 from public.auctions a
                where a.id = auction_cancellation_requests.auction_id
                  and a.seller_id = (select auth.uid()))
  );

-- ---- 4. listing reviews ---------------------------------------------------------
create table if not exists public.listing_reviews (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  auction_id   uuid not null references public.auctions(id) on delete restrict,
  status       text not null default 'PENDING' check (status in (
                 'PENDING','APPROVED','REJECTED','CHANGES_REQUESTED','WITHDRAWN'
               )),
  reviewer_id  uuid references public.profiles(id),
  reason       text check (reason is null or char_length(reason) <= 1000),
  risk_flags   jsonb not null default '{}'::jsonb,
  reviewed_at  timestamptz
);
-- One active review per auction.
create unique index if not exists listing_reviews_one_pending_idx
  on public.listing_reviews (auction_id)
  where status = 'PENDING';
create index if not exists listing_reviews_status_idx
  on public.listing_reviews (status, created_at desc);

alter table public.listing_reviews enable row level security;

-- Seller reads their own listing's review; admins read all. Writes via RPCs.
drop policy if exists listing_reviews_select on public.listing_reviews;
create policy listing_reviews_select on public.listing_reviews
  for select to authenticated
  using (
    private.is_admin()
    or exists (select 1 from public.auctions a
                where a.id = listing_reviews.auction_id
                  and a.seller_id = (select auth.uid()))
  );

-- ---- 5. visibility: PENDING_REVIEW is seller/admin-only -------------------------
-- PAUSED stays public (a paused listing must explain itself in the open).
-- PENDING_REVIEW must not be public: unreviewed content is not inventory.
drop policy if exists auctions_select on public.auctions;
create policy auctions_select on public.auctions
  for select using (
    status not in ('DRAFT','PENDING_REVIEW')
    or seller_id = (select auth.uid())
    or private.is_admin()
  );

create or replace function private.can_view_auction(p_auction_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.auctions a
    where a.id = p_auction_id
      and (a.status not in ('DRAFT','PENDING_REVIEW')
           or a.seller_id = auth.uid() or private.is_admin())
  );
$$;

-- ---- 6. notification types ------------------------------------------------------
alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'AUCTION_PUBLISHED','NEW_BID','OUTBID','ENDING_SOON',
    'WON','SOLD','ENDED_UNSOLD','REVIEW_REQUEST','LISTING_REMOVED',
    'BID_CONFIRMED',
    'REVIEW_SUBMITTED','REVIEW_APPROVED','REVIEW_REJECTED','REVIEW_CHANGES_REQUESTED',
    'CANCELLATION_REQUESTED','CANCELLATION_DECIDED',
    'AUCTION_PAUSED','AUCTION_RESUMED','AUCTION_CANCELLED'
  ));

-- ---- 7. place_bid: refuse the new non-biddable states ---------------------------
create or replace function public.place_bid(
  p_auction_id    uuid,
  p_amount_minor  bigint,
  p_request_id    uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a          public.auctions%rowtype;
  v_uid      uuid := auth.uid();
  v_now      timestamptz := clock_timestamp();
  v_min      bigint;
  v_prev     uuid;
  v_prev_amt bigint;
  v_extended boolean := false;
  v_bid_id   uuid;
  v_settle   jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_auction_id is null then
    raise exception 'auction_not_found' using errcode = 'P0002';
  end if;
  if p_request_id is null then
    raise exception 'invalid_request_id' using errcode = '22023';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0
     or p_amount_minor > 1000000000000 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  select id into v_bid_id from public.bids
   where bidder_id = v_uid and request_id = p_request_id;
  if v_bid_id is not null then
    select * into a from public.auctions where id = p_auction_id;
    return jsonb_build_object(
      'ok', true, 'duplicate', true, 'bid_id', v_bid_id,
      'amount_minor', p_amount_minor,
      'current_bid_minor', a.current_bid_minor,
      'bid_count', a.bid_count,
      'ends_at', a.ends_at,
      'next_min_minor', coalesce(a.current_bid_minor + a.bid_increment_minor,
                                 a.starting_bid_minor),
      'status', public.auction_effective_status(a.status, a.starts_at, a.ends_at, v_now)
    );
  end if;

  select * into a from public.auctions where id = p_auction_id for update;
  if not found then
    raise exception 'auction_not_found' using errcode = 'P0002';
  end if;

  if a.seller_id = v_uid then
    raise exception 'seller_cannot_bid' using errcode = '42501';
  end if;

  if a.status in ('DRAFT','CANCELLED') then
    raise exception 'auction_not_live' using errcode = 'P0001';
  end if;
  if a.status = 'SCHEDULED' and (a.starts_at is null or a.starts_at > v_now) then
    raise exception 'auction_not_live' using errcode = 'P0001';
  end if;
  if a.status in ('ENDED','SOLD','UNSOLD') then
    raise exception 'auction_ended' using errcode = 'P0001';
  end if;
  -- PAUSED is an administrative safety hold, not a market state: bidding is
  -- disabled by design while existing bids stay recorded. Dedicated code so
  -- the UI can say "paused" instead of "ended", which would be a lie.
  if a.status = 'PAUSED' then
    raise exception 'auction_paused' using errcode = 'P0001';
  end if;
  -- PENDING_REVIEW listings are not inventory yet. This is belt and braces:
  -- RLS already hides them from everyone but the seller and admins.
  if a.status = 'PENDING_REVIEW' then
    raise exception 'auction_not_live' using errcode = 'P0001';
  end if;
  if a.status = 'LIVE' and a.ends_at <= v_now then
    v_settle := public.settle_auction(a.id);
    return jsonb_build_object(
      'ok', false, 'error', 'auction_ended',
      'settled', coalesce(v_settle->>'status', 'UNKNOWN'),
      'ends_at', a.ends_at
    );
  end if;

  v_min := case when a.current_bid_minor is null
                then a.starting_bid_minor
                else a.current_bid_minor + a.bid_increment_minor end;

  if p_amount_minor < v_min then
    raise exception 'below_minimum'
      using errcode = 'P0001', hint = v_min::text;
  end if;

  v_prev     := a.current_bidder_id;
  v_prev_amt := a.current_bid_minor;

  insert into public.bids (auction_id, bidder_id, amount_minor, currency,
                           request_id, is_winning)
  values (a.id, v_uid, p_amount_minor, a.currency, p_request_id, true)
  returning id into v_bid_id;

  if a.anti_snipe_extension_seconds > 0
     and a.status = 'LIVE'
     and (a.ends_at - v_now) <= make_interval(secs => a.anti_snipe_window_seconds) then
    a.ends_at := a.ends_at + make_interval(secs => a.anti_snipe_extension_seconds);
    v_extended := true;
  end if;

  update public.auctions
     set current_bid_minor   = p_amount_minor,
         current_bidder_id   = v_uid,
         bid_count           = bid_count + 1,
         ends_at             = a.ends_at,
         extension_count     = extension_count + case when v_extended then 1 else 0 end,
         status              = case when status = 'SCHEDULED' then 'LIVE'::public.auction_status_t
                                    else status end,
         updated_at          = v_now
   where id = a.id
   returning * into a;

  if v_prev is not null and v_prev <> v_uid then
    insert into public.notifications (user_id, type, auction_id, payload)
    values (v_prev, 'OUTBID', a.id,
            jsonb_build_object('title', a.title,
                               'your_last_bid_minor', v_prev_amt,
                               'current_bid_minor', p_amount_minor,
                               'currency', a.currency,
                               'next_min_minor', v_min + a.bid_increment_minor));
  end if;

  insert into public.notifications (user_id, type, auction_id, payload)
  values (a.seller_id, 'NEW_BID', a.id,
          jsonb_build_object('title', a.title,
                             'current_bid_minor', p_amount_minor,
                             'currency', a.currency, 'bid_count', a.bid_count));

  return jsonb_build_object(
    'ok', true, 'duplicate', false,
    'bid_id', v_bid_id,
    'amount_minor', p_amount_minor,
    'current_bid_minor', a.current_bid_minor,
    'bid_count', a.bid_count,
    'ends_at', a.ends_at,
    'extended', v_extended,
    'extension_seconds', case when v_extended then a.anti_snipe_extension_seconds else 0 end,
    'outbid_user_id', v_prev,
    'next_min_minor', a.current_bid_minor + a.bid_increment_minor,
    'status', public.auction_effective_status(a.status, a.starts_at, a.ends_at, v_now),
    'server_time', v_now
  );
end;
$$;

comment on function public.place_bid(uuid, bigint, uuid) is
  'Bid intake. Serializes on the auction row (FOR UPDATE). PAUSED and
   PENDING_REVIEW are refused outright (auction_paused / auction_not_live); a
   bid on a clock-expired LIVE auction settles it first and reports the
   refusal as a RETURNED {ok:false,error:auction_ended} so the settlement
   commits. All other refusals raise, because they change nothing.';


-- ---- 8. publish with risk routing -----------------------------------------------
-- Most listings publish exactly as before. Listings that trip a risk signal
-- go to PENDING_REVIEW with a review row instead: the seller sees "under
-- review", the listing is invisible to everyone else, and an admin decides.
--
-- The signals are deliberately few, legible, and recorded per decision in
-- risk_flags, so a seller asking "why was mine held" gets an answer and a
-- future tuning pass has data instead of opinions:
--   first_listing     seller has never had a non-draft auction
--   reported_seller   an OPEN/REVIEWING report targets the seller or listings
--   prior_takedown    a TAKEDOWN_LISTING event names the seller's auctions
--   prior_ban         the seller's account was ever banned (even if restored)
--   high_value        starting bid at or above $500 (50000 minor)
create or replace function public.publish_auction(
  p_auction_id uuid,
  p_starts_at  timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  a       public.auctions%rowtype;
  v_uid   uuid := auth.uid();
  v_start timestamptz;
  v_imgs  integer;
  v_flags jsonb := '{}'::jsonb;
  v_risky boolean := false;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  select * into a from public.auctions where id = p_auction_id for update;
  if not found then raise exception 'auction_not_found' using errcode = 'P0002'; end if;
  if a.seller_id <> v_uid then raise exception 'not_owner' using errcode = '42501'; end if;
  if a.status not in ('DRAFT','SCHEDULED') then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  select count(*) into v_imgs
    from public.auction_images where auction_id = a.id;
  if v_imgs < 1 then
    raise exception 'image_required' using errcode = 'P0001';
  end if;

  -- ---- risk screen (each signal recorded, none of them silent) --------------
  if not exists (select 1 from public.auctions x
                  where x.seller_id = v_uid and x.status <> 'DRAFT' and x.id <> a.id) then
    v_flags := v_flags || '{"first_listing": true}';
    v_risky := true;
  end if;
  if exists (select 1 from public.reports r
              where r.status in ('OPEN','REVIEWING')
                and ((r.target_type = 'user' and r.target_id = v_uid)
                     or (r.target_type = 'auction' and r.target_id in
                         (select x.id from public.auctions x where x.seller_id = v_uid)))) then
    v_flags := v_flags || '{"reported_seller": true}';
    v_risky := true;
  end if;
  if exists (select 1 from public.moderation_events m
              where m.action = 'TAKEDOWN_LISTING'
                and m.target_type = 'auction' and m.target_id in
                (select x.id from public.auctions x where x.seller_id = v_uid)) then
    v_flags := v_flags || '{"prior_takedown": true}';
    v_risky := true;
  end if;
  if exists (select 1 from public.moderation_events m
              where m.action = 'BAN_USER'
                and m.target_type = 'user' and m.target_id = v_uid) then
    v_flags := v_flags || '{"prior_ban": true}';
    v_risky := true;
  end if;
  if coalesce(a.starting_bid_minor, 0) >= 50000 then
    v_flags := v_flags || '{"high_value": true}';
    v_risky := true;
  end if;

  if v_risky then
    update public.auctions
       set status = 'PENDING_REVIEW', updated_at = clock_timestamp()
     where id = a.id;

    insert into public.listing_reviews (auction_id, status, risk_flags)
    values (a.id, 'PENDING', v_flags)
    on conflict do nothing;

    insert into public.notifications (user_id, type, auction_id, payload)
    values (v_uid, 'REVIEW_SUBMITTED', a.id,
            jsonb_build_object('title', a.title));

    return jsonb_build_object('ok', true, 'status', 'PENDING_REVIEW',
                              'risk_flags', v_flags);
  end if;

  -- ---- trusted path: unchanged --------------------------------------------------
  v_start := coalesce(p_starts_at, clock_timestamp());

  update public.auctions
     set status     = case when v_start <= clock_timestamp()
                           then 'LIVE'::public.auction_status_t
                           else 'SCHEDULED'::public.auction_status_t end,
         starts_at  = v_start,
         ends_at    = v_start + make_interval(secs => duration_seconds),
         updated_at = clock_timestamp()
   where id = a.id
   returning * into a;

  insert into public.notifications (user_id, type, auction_id, payload)
  values (a.seller_id, 'AUCTION_PUBLISHED', a.id,
          jsonb_build_object('title', a.title, 'ends_at', a.ends_at));

  return jsonb_build_object('ok', true, 'status', a.status,
                            'starts_at', a.starts_at, 'ends_at', a.ends_at);
end;
$$;

-- ---- 9. review decisions -----------------------------------------------------------
create or replace function public.admin_decide_review(
  p_review_id uuid,
  p_decision  text,
  p_reason    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       public.listing_reviews%rowtype;
  a       public.auctions%rowtype;
  v_uid   uuid := auth.uid();
  v_start timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not private.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  if p_decision not in ('APPROVED','REJECTED','CHANGES_REQUESTED') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_decision in ('REJECTED','CHANGES_REQUESTED')
     and (p_reason is null or char_length(trim(p_reason)) < 5) then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  select * into r from public.listing_reviews where id = p_review_id for update;
  if not found then raise exception 'review_not_found' using errcode = 'P0002'; end if;
  if r.status <> 'PENDING' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  select * into a from public.auctions where id = r.auction_id for update;
  if not found then raise exception 'auction_not_found' using errcode = 'P0002'; end if;
  -- The listing must still be waiting. Anything else means the world moved
  -- under the review (withdrawn, published by another path) and the decision
  -- no longer applies to anything.
  if a.status <> 'PENDING_REVIEW' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  if p_decision = 'APPROVED' then
    -- Timing restarts at approval: the seller should get the full duration
    -- they configured, not whatever is left of a clock that started while
    -- the listing sat in a queue.
    v_start := clock_timestamp();
    update public.auctions
       set status    = case when a.starts_at is not null and a.starts_at > v_start
                            then 'SCHEDULED'::public.auction_status_t
                            else 'LIVE'::public.auction_status_t end,
           starts_at = case when a.starts_at is not null and a.starts_at > v_start
                            then a.starts_at else v_start end,
           ends_at   = (case when a.starts_at is not null and a.starts_at > v_start
                            then a.starts_at else v_start end)
                       + make_interval(secs => a.duration_seconds),
           updated_at = v_start
     where id = a.id
     returning * into a;

    update public.listing_reviews
       set status = 'APPROVED', reviewer_id = v_uid,
           reason = nullif(trim(coalesce(p_reason, '')), ''),
           reviewed_at = clock_timestamp()
     where id = r.id;

    insert into public.notifications (user_id, type, auction_id, payload)
    values (a.seller_id, 'REVIEW_APPROVED', a.id,
            jsonb_build_object('title', a.title, 'ends_at', a.ends_at));

    return jsonb_build_object('ok', true, 'decision', 'APPROVED',
                              'status', a.status, 'ends_at', a.ends_at);
  else
    -- REJECTED and CHANGES_REQUESTED both return the listing to DRAFT: the
    -- difference is the notice, which says plainly whether to fix and
    -- resubmit or stop. Either way nothing public ever existed to clean up.
    update public.auctions
       set status = 'DRAFT', updated_at = clock_timestamp()
     where id = a.id;

    update public.listing_reviews
       set status = p_decision, reviewer_id = v_uid,
           reason = trim(p_reason), reviewed_at = clock_timestamp()
     where id = r.id;

    insert into public.notifications (user_id, type, auction_id, payload)
    values (a.seller_id,
            case when p_decision = 'REJECTED' then 'REVIEW_REJECTED'
                 else 'REVIEW_CHANGES_REQUESTED' end,
            a.id,
            jsonb_build_object('title', a.title, 'reason', trim(p_reason)));

    return jsonb_build_object('ok', true, 'decision', p_decision,
                              'status', 'DRAFT');
  end if;
end;
$$;

-- Seller withdraws their own pending review to edit and resubmit. Withdrawing
-- is always safe: PENDING_REVIEW was never public, so there is nothing to
-- unwind, and the withdrawn row stays as history rather than vanishing.
create or replace function public.withdraw_listing_review(p_auction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rid uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  select id into v_rid from public.listing_reviews
   where auction_id = p_auction_id and status = 'PENDING'
   for update;
  if not found then raise exception 'review_not_found' using errcode = 'P0002'; end if;

  update public.auctions set status = 'DRAFT', updated_at = clock_timestamp()
   where id = p_auction_id and seller_id = v_uid and status = 'PENDING_REVIEW';
  if not found then raise exception 'not_owner' using errcode = '42501'; end if;

  update public.listing_reviews
     set status = 'WITHDRAWN', reviewed_at = clock_timestamp()
   where id = v_rid;

  return jsonb_build_object('ok', true, 'status', 'DRAFT');
end;
$$;

-- ---- 10. cancel with reason ----------------------------------------------------------
create or replace function public.cancel_auction(
  p_auction_id  uuid,
  p_reason_code text default null,
  p_explanation text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  a         public.auctions%rowtype;
  v_uid     uuid := auth.uid();
  v_isadmin boolean := private.is_admin();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  select * into a from public.auctions where id = p_auction_id for update;
  if not found then raise exception 'auction_not_found' using errcode = 'P0002'; end if;
  if a.seller_id <> v_uid and not v_isadmin then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if a.bid_count > 0 and not v_isadmin then
    -- cannot yank an auction people have bid on
    raise exception 'has_bids' using errcode = 'P0001';
  end if;
  if a.status in ('SOLD','UNSOLD','CANCELLED') then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  -- A paused auction is under administrative hold: neither the seller nor a
  -- bare cancel may release it. The hold lifts only through resume or
  -- takedown, both audited.
  if a.status = 'PAUSED' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  -- Past DRAFT, a cancellation without a reason is a gap in the record.
  -- Drafts never reach this function (they hard-delete), so the requirement
  -- costs sellers nothing they were not already being asked.
  if a.status <> 'DRAFT'
     and (p_reason_code is null
          or p_reason_code not in ('ITEM_UNAVAILABLE','ITEM_DAMAGED','LISTING_ERROR',
                                   'SELLER_WITHDRAWAL','TECHNICAL_PROBLEM','OTHER')) then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  if p_explanation is not null and char_length(p_explanation) > 1000 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  update public.auctions
     set status = 'CANCELLED', updated_at = clock_timestamp()
   where id = a.id;

  insert into public.auction_cancellations
    (auction_id, actor_id, actor_role, prev_status, reason_code, explanation)
  values
    (a.id, v_uid, case when v_isadmin then 'admin' else 'seller' end,
     a.status, coalesce(p_reason_code, 'OTHER'),
     nullif(trim(coalesce(p_explanation, '')), ''));

  return jsonb_build_object('ok', true, 'status', 'CANCELLED',
                            'previous_status', a.status);
end;
$$;


-- ---- 11. pause and resume (admin hold) -------------------------------------------------
-- PAUSED is LIVE with the clock stopped: no bids, no settlement, no payment,
-- history untouched. Resume shifts ends_at forward by exactly the held
-- duration, so the remaining time is deterministic, anti-sniping is
-- preserved (it keys off ends_at, which moved intact), and every hold stays
-- in moderation_events.
create or replace function public.admin_pause_auction(
  p_auction_id uuid,
  p_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_seller uuid;
  v_title  text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not private.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 5
     or char_length(p_reason) > 1000 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  -- LIVE only. Anything else has nothing running to freeze: drafts and
  -- scheduled listings are handled by cancel/takedown, closed ones are
  -- history.
  update public.auctions
     set status = 'PAUSED', paused_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where id = p_auction_id and status = 'LIVE'
   returning seller_id, title into v_seller, v_title;
  if not found then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  insert into public.moderation_events
    (actor_id, action, target_type, target_id,
     prev_status, new_status, reason)
  values
    (v_uid, 'PAUSE_AUCTION', 'auction', p_auction_id,
     'LIVE', 'PAUSED', trim(p_reason));

  insert into public.notifications (user_id, type, auction_id, payload)
  values (v_seller, 'AUCTION_PAUSED', p_auction_id,
          jsonb_build_object('title', v_title));

  return jsonb_build_object('ok', true, 'status', 'PAUSED');
end;
$$;

create or replace function public.admin_resume_auction(
  p_auction_id uuid,
  p_reason     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_seller uuid;
  v_title  text;
  v_held   interval;
  v_ends   timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not private.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  if p_reason is not null and char_length(p_reason) > 1000 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  select seller_id, title,
         clock_timestamp() - paused_at, ends_at
    into v_seller, v_title, v_held, v_ends
    from public.auctions where id = p_auction_id and status = 'PAUSED'
     for update;
  if not found then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  if v_held is null or v_held < interval '0' then
    -- paused_at missing or clock moved backwards: refuse rather than invent
    -- a remaining time. An operator fixes the row; the engine never guesses.
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  update public.auctions
     set status = 'LIVE', paused_at = null,
         ends_at = v_ends + v_held,
         updated_at = clock_timestamp()
   where id = p_auction_id;

  insert into public.moderation_events
    (actor_id, action, target_type, target_id,
     prev_status, new_status, reason)
  values
    (v_uid, 'RESUME_AUCTION', 'auction', p_auction_id,
     'PAUSED', 'LIVE',
     coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Hold lifted after review.'));

  insert into public.notifications (user_id, type, auction_id, payload)
  values (v_seller, 'AUCTION_RESUMED', p_auction_id,
          jsonb_build_object('title', v_title, 'ends_at', v_ends + v_held));

  return jsonb_build_object('ok', true, 'status', 'LIVE',
                            'ends_at', v_ends + v_held);
end;
$$;

-- ---- 12. seller cancellation requests ----------------------------------------------------
-- A LIVE auction with bids cannot be cancelled by its seller directly
-- (cancel_auction raises has_bids). The legitimate path is a durable request:
-- the auction stays LIVE while it is pending, an admin decides, and both
-- sides are told. Withdrawing is always allowed to the requester.
create or replace function public.request_cancellation(
  p_auction_id uuid,
  p_reason_code text,
  p_explanation text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_title  text;
  v_admin  record;
  v_req_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_reason_code not in ('ITEM_UNAVAILABLE','ITEM_DAMAGED','LISTING_ERROR',
                           'SELLER_WITHDRAWAL','TECHNICAL_PROBLEM','OTHER') then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  if p_explanation is not null and char_length(p_explanation) > 1000 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  select title into v_title from public.auctions
   where id = p_auction_id and seller_id = v_uid and status = 'LIVE'
   for update;
  if not found then
    -- Wrong owner, wrong state, or no such auction: one refusal covers all
    -- three, because distinguishing them would let callers probe inventory.
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  -- ON CONFLICT DO NOTHING plus the partial unique index is what makes
  -- a second PENDING request a duplicate: the insert affects zero rows, FOUND
  -- is false, and the caller gets duplicate_request instead of a second row.
  insert into public.auction_cancellation_requests
    (auction_id, requester_id, reason_code, explanation)
  values
    (p_auction_id, v_uid, p_reason_code,
     nullif(trim(coalesce(p_explanation, '')), ''))
  on conflict do nothing
  returning id into v_req_id;
  if not found then
    raise exception 'duplicate_request' using errcode = 'P0001';
  end if;

  -- The admin queue is pulled, but a waiting seller should not depend on
  -- polling: every admin gets a notice through the channel they already read.
  for v_admin in select id from public.profiles where is_admin loop
    insert into public.notifications (user_id, type, auction_id, payload)
    values (v_admin.id, 'CANCELLATION_REQUESTED', p_auction_id,
            jsonb_build_object('title', v_title));
  end loop;

  return jsonb_build_object('ok', true, 'status', 'PENDING');
end;
$$;

create or replace function public.decide_cancellation(
  p_request_id uuid,
  p_approve    boolean,
  p_reason     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  r       public.auction_cancellation_requests%rowtype;
  a       public.auctions%rowtype;
  v_bidder uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not private.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  if p_approve is null then raise exception 'invalid_input' using errcode = '22023'; end if;
  if (not p_approve) and (p_reason is null or char_length(trim(p_reason)) < 5) then
    -- Rejecting without telling the seller why is the specific cruelty this
    -- check exists to prevent. Approvals carry the request's own reason.
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  select * into r from public.auction_cancellation_requests
   where id = p_request_id for update;
  if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if r.status <> 'PENDING' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  -- A seller cannot approve their own request: the reviewer must differ from
  -- the requester even if the requester somehow holds admin.
  if r.requester_id = v_uid then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  select * into a from public.auctions where id = r.auction_id for update;
  if not found then raise exception 'auction_not_found' using errcode = 'P0002'; end if;

  if p_approve then
    -- Approval is only meaningful on a live auction. If it already sold,
    -- ended or was taken down while waiting, there is nothing to cancel and
    -- approving anyway would rewrite history.
    if a.status <> 'LIVE' then
      raise exception 'invalid_state' using errcode = 'P0001';
    end if;

    update public.auctions
       set status = 'CANCELLED', updated_at = clock_timestamp()
     where id = a.id;

    update public.auction_cancellation_requests
       set status = 'APPROVED', reviewer_id = v_uid,
           reviewer_reason = nullif(trim(coalesce(p_reason, '')), ''),
           reviewed_at = clock_timestamp()
     where id = r.id;

    insert into public.auction_cancellations
      (auction_id, actor_id, actor_role, prev_status,
       reason_code, explanation)
    values
      (a.id, v_uid, 'admin', 'LIVE',
       r.reason_code, r.explanation);

    insert into public.moderation_events
      (actor_id, action, target_type, target_id,
       prev_status, new_status, reason, report_id)
    values
      (v_uid, 'TAKEDOWN_LISTING', 'auction', a.id,
       'LIVE', 'CANCELLED',
       coalesce(nullif(trim(coalesce(p_reason, '')), ''),
                'Seller cancellation request approved.'),
       null);

    -- Seller learns the decision; every distinct bidder learns the auction
    -- they committed to is gone, with no payment path and history intact.
    insert into public.notifications (user_id, type, auction_id, payload)
    values (a.seller_id, 'CANCELLATION_DECIDED', a.id,
            jsonb_build_object('title', a.title, 'approved', true));
    for v_bidder in select distinct bidder_id from public.bids
                     where auction_id = a.id loop
      insert into public.notifications (user_id, type, auction_id, payload)
      values (v_bidder, 'AUCTION_CANCELLED', a.id,
              jsonb_build_object('title', a.title));
    end loop;

    return jsonb_build_object('ok', true, 'decision', 'APPROVED',
                              'status', 'CANCELLED');
  else
    update public.auction_cancellation_requests
       set status = 'REJECTED', reviewer_id = v_uid,
           reviewer_reason = trim(p_reason), reviewed_at = clock_timestamp()
     where id = r.id;

    -- Rejection changes nothing about the auction: it stays LIVE with its
    -- bids, its clock and its history. Only the seller is told, with the why.
    insert into public.notifications (user_id, type, auction_id, payload)
    values (a.seller_id, 'CANCELLATION_DECIDED', a.id,
            jsonb_build_object('title', a.title, 'approved', false,
                               'reason', trim(p_reason)));

    return jsonb_build_object('ok', true, 'decision', 'REJECTED',
                              'status', a.status);
  end if;
end;
$$;

-- Withdrawing is the requester's own undo, always allowed while pending, and
-- it never touches the auction: withdrawing a request is not cancelling.
create or replace function public.withdraw_cancellation(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  update public.auction_cancellation_requests
     set status = 'WITHDRAWN', reviewed_at = clock_timestamp()
   where id = p_request_id and requester_id = v_uid and status = 'PENDING';
  if not found then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  return jsonb_build_object('ok', true, 'status', 'WITHDRAWN');
end;
$$;

-- ---- 13. grants: writes stay inside the RPCs -------------------------------------------
revoke all on function public.request_cancellation(uuid, text, text) from public, anon;
revoke all on function public.decide_cancellation(uuid, boolean, text) from public, anon;
revoke all on function public.withdraw_cancellation(uuid) from public, anon;
revoke all on function public.admin_pause_auction(uuid, text) from public, anon;
revoke all on function public.admin_resume_auction(uuid, text) from public, anon;
revoke all on function public.admin_decide_review(uuid, text, text) from public, anon;
revoke all on function public.withdraw_listing_review(uuid) from public, anon;
grant execute on function public.request_cancellation(uuid, text, text) to authenticated, service_role;
grant execute on function public.decide_cancellation(uuid, boolean, text) to authenticated, service_role;
grant execute on function public.withdraw_cancellation(uuid) to authenticated, service_role;
grant execute on function public.admin_pause_auction(uuid, text) to authenticated, service_role;
grant execute on function public.admin_resume_auction(uuid, text) to authenticated, service_role;
grant execute on function public.admin_decide_review(uuid, text, text) to authenticated, service_role;
grant execute on function public.withdraw_listing_review(uuid) to authenticated, service_role;
