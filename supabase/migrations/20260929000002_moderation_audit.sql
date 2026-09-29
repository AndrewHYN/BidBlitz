-- ===========================================================================
-- Marketplace moderation: audit trail + admin enforcement functions
-- ===========================================================================
--
-- WHY THIS MIGRATION EXISTS
--
-- The reports pipeline (table, RLS, reportAction, admin queue) existed, and
-- cancel_auction() let an admin remove a listing - but nothing recorded the
-- removal. An operator taking down a listing left no actor, no reason, no
-- timestamp and no link to the report that prompted it. For a marketplace run
-- by one person, that is the difference between operating and improvising:
-- without a trail, a seller asking "why was my listing removed" gets a guess.
--
-- WHAT IT ADDS (and what it deliberately does not)
--
-- 1. public.moderation_events: the audit trail. One row per enforcement
--    action, append-only - no UPDATE or DELETE policy exists for any role,
--    and only admins may SELECT. Ordinary users cannot read internal notes,
--    cannot write rows, cannot touch it at all.
-- 2. public.admin_takedown_auction(): the single way an admin removes a
--    listing. Locks the row, refuses anything already closed (nothing to take
--    down), sets CANCELLED, writes the audit row (actor, previous status,
--    reason, report), notifies the seller with safe copy, and resolves the
--    originating report so one action closes the loop.
-- 3. public.admin_set_banned(): the single way an account is suspended or
--    restored. Refuses self-ban. Writes the audit row. The existing
--    is_banned triggers do the actual blocking (bids, publishing), unchanged.
-- 4. 'LISTING_REMOVED' notification type: the seller-visible half of a
--    takedown. It names the outcome and the help path, never report details.
--
-- WHAT IT DOES NOT DO
--
-- - No new terminal state. A taken-down listing is CANCELLED: buyers cannot
--   bid (place_bid refuses it), no payment flow can start (settle refuses
--   non-LIVE), the seller sees "cancelled", and bid history is preserved
--   (nothing is deleted). A separate TAKEDOWN state would force every reader
--   to handle one more "closed but different" case for no operational gain.
-- - No payout structures are reused. The payout audit trail records money;
--   this one records enforcement. Mixing them would let a moderation note
--   appear wherever money is shown.
-- - No seller-visible reason beyond the safe notice. The internal reason lives
--   in moderation_events (admin eyes only); the seller gets the outcome plus
--   where to ask about it.

-- ---- 1. the audit table ----------------------------------------------------
create table if not exists public.moderation_events (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  actor_id     uuid not null references public.profiles(id),
  action       text not null check (action in
                 ('TAKEDOWN_LISTING','BAN_USER','UNBAN_USER')),
  target_type  text not null check (target_type in ('auction','user')),
  target_id    uuid not null,
  prev_status  text,
  new_status   text,
  reason       text not null check (char_length(reason) between 5 and 1000),
  report_id    uuid references public.reports(id) on delete set null
);
create index if not exists moderation_events_target_idx
  on public.moderation_events (target_type, target_id, created_at desc);
create index if not exists moderation_events_actor_idx
  on public.moderation_events (actor_id, created_at desc);

alter table public.moderation_events enable row level security;

-- Admins may read the trail. NOBODY writes through PostgREST - not even
-- admins: rows are written only by the SECURITY DEFINER functions below,
-- which force actor_id to auth.uid(). An audit trail anyone can hand-write
-- is a diary, not evidence.
drop policy if exists moderation_events_admin_select on public.moderation_events;
create policy moderation_events_admin_select on public.moderation_events
  for select to authenticated
  using (private.is_admin());

-- ---- 2. the seller-visible half of a takedown -------------------------------
alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'AUCTION_PUBLISHED','NEW_BID','OUTBID','ENDING_SOON',
    'WON','SOLD','ENDED_UNSOLD','REVIEW_REQUEST','LISTING_REMOVED'
  ));

-- ---- 3. admin takedown -------------------------------------------------------
create or replace function public.admin_takedown_auction(
  p_auction_id uuid,
  p_reason     text,
  p_report_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_prev   text;
  v_seller uuid;
  v_title  text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not private.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if p_auction_id is null then
    raise exception 'auction_not_found' using errcode = 'P0002';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 5
     or char_length(p_reason) > 1000 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  select status::text, seller_id, title into v_prev, v_seller, v_title
    from public.auctions where id = p_auction_id for update;
  if not found then
    raise exception 'auction_not_found' using errcode = 'P0002';
  end if;
  -- There must be something to take down. A closed auction is already out of
  -- the marketplace; "taking it down" would rewrite history, not protect
  -- anyone. DRAFT is private to the seller, so there is nothing public to
  -- remove either - reports against drafts are dismissed, not enforced.
  if v_prev in ('SOLD','UNSOLD','CANCELLED') then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  if v_prev = 'DRAFT' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  update public.auctions
     set status = 'CANCELLED', updated_at = clock_timestamp()
   where id = p_auction_id;

  insert into public.moderation_events
    (actor_id, action, target_type, target_id,
     prev_status, new_status, reason, report_id)
  values
    (v_uid, 'TAKEDOWN_LISTING', 'auction', p_auction_id,
     v_prev, 'CANCELLED', trim(p_reason), p_report_id);

  -- The seller learns the outcome and where to ask about it - never who
  -- reported them, never the internal note. That boundary is the reason the
  -- notice and the audit row are two different writes.
  insert into public.notifications (user_id, type, auction_id, payload)
  values (v_seller, 'LISTING_REMOVED', p_auction_id,
          jsonb_build_object('title', v_title));

  -- One action closes the loop: a report that prompted this takedown is
  -- resolved with safe copy, but only if it is still open and really targets
  -- this auction. Anything else is left for the operator to triage by hand.
  if p_report_id is not null then
    update public.reports
       set status = 'RESOLVED', resolved_at = clock_timestamp(),
           resolution = 'The listing was removed by BidBlitz moderation.'
     where id = p_report_id
       and target_type = 'auction' and target_id = p_auction_id
       and status in ('OPEN','REVIEWING');
  end if;

  return jsonb_build_object('ok', true, 'status', 'CANCELLED',
                            'previous_status', v_prev);
end;
$$;

-- ---- 4. admin ban / unban ----------------------------------------------------
create or replace function public.admin_set_banned(
  p_user_id uuid,
  p_banned  boolean,
  p_reason  text,
  p_report_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_prev boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not private.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  -- An operator who can remove their own admin row by banning themselves is
  -- an operator about to lock everyone out. Refuse it outright.
  if p_user_id = v_uid then
    raise exception 'cannot_ban_self' using errcode = 'P0001';
  end if;
  if p_banned is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 5
     or char_length(p_reason) > 1000 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  select is_banned into v_prev from public.profiles
   where id = p_user_id for update;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if v_prev = p_banned then
    -- Idempotent: banning the banned changes nothing and writes nothing, so
    -- a double-clicked confirmation cannot duplicate the trail.
    return jsonb_build_object('ok', true, 'unchanged', true,
                              'is_banned', v_prev);
  end if;

  update public.profiles set is_banned = p_banned, updated_at = clock_timestamp()
   where id = p_user_id;

  insert into public.moderation_events
    (actor_id, action, target_type, target_id,
     prev_status, new_status, reason, report_id)
  values
    (v_uid,
     case when p_banned then 'BAN_USER' else 'UNBAN_USER' end,
     'user', p_user_id,
     case when v_prev then 'banned' else 'active' end,
     case when p_banned then 'banned' else 'active' end,
     trim(p_reason), p_report_id);

  if p_report_id is not null then
    update public.reports
       set status = 'RESOLVED', resolved_at = clock_timestamp(),
           resolution = 'BidBlitz moderation reviewed this account and acted on it.'
     where id = p_report_id
       and target_type = 'user' and target_id = p_user_id
       and status in ('OPEN','REVIEWING');
  end if;

  return jsonb_build_object('ok', true, 'unchanged', false,
                            'is_banned', p_banned);
end;
$$;

-- ---- 5. least-privilege EXECUTE ----------------------------------------------
-- Anonymous callers get nothing: both functions raise not_authenticated
-- without a session anyway, but there is no reason to route them at all.
revoke all on function public.admin_takedown_auction(uuid, text, uuid)
  from public, anon;
revoke all on function public.admin_set_banned(uuid, boolean, text, uuid)
  from public, anon;
grant execute on function public.admin_takedown_auction(uuid, text, uuid)
  to authenticated, service_role;
grant execute on function public.admin_set_banned(uuid, boolean, text, uuid)
  to authenticated, service_role;

comment on function public.admin_takedown_auction(uuid, text, uuid) is
  'Admin listing takedown. Locks the auction, refuses already-closed and
   draft rows, sets CANCELLED, writes the moderation_events audit row
   (actor/reason/report), notifies the seller with safe copy, and resolves
   the originating report. EXECUTE: authenticated (is_admin enforced inside).';
comment on function public.admin_set_banned(uuid, boolean, text, uuid) is
  'Admin suspend/restore. Refuses self-ban, idempotent when already in the
   requested state, writes the moderation_events audit row. Blocking itself
   is done by the is_banned triggers, unchanged. EXECUTE: authenticated
   (is_admin enforced inside).';
