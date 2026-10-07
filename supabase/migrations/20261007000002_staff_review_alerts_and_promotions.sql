-- BidBlitz staff review alerts + lightweight promoted listings.
--
-- Goals:
-- 1) held listings notify every active staff member who can review listings;
-- 2) sellers can request a simple 3-day or 7-day promotion;
-- 3) promotion approval is explicit staff work, never automatic billing;
-- 4) promoted placement expires by timestamp while auction history stays intact.
--
-- Payment, bidding, settlement, payout and auth semantics are unchanged.

alter table public.auctions
  add column if not exists featured_until timestamptz,
  add column if not exists featured_by uuid references public.profiles(id);

create table if not exists public.promotion_requests (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions(id) on delete cascade,
  seller_id uuid not null references public.profiles(id),
  requested_days smallint not null check (requested_days in (3, 7)),
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id),
  admin_note text check (admin_note is null or char_length(admin_note) <= 1000)
);

create unique index if not exists promotion_requests_one_pending_idx
  on public.promotion_requests (auction_id)
  where status = 'PENDING';

create index if not exists promotion_requests_seller_idx
  on public.promotion_requests (seller_id, requested_at desc);

alter table public.promotion_requests enable row level security;

drop policy if exists promotion_requests_owner_read on public.promotion_requests;
create policy promotion_requests_owner_read
  on public.promotion_requests for select to authenticated
  using (
    seller_id = (select auth.uid())
    or public.has_permission((select auth.uid()), 'settings.manage_marketplace')
  );

revoke all on public.promotion_requests from anon, authenticated;
grant select on public.promotion_requests to authenticated;
grant all on public.promotion_requests to service_role;

-- Extend the existing closed notification vocabulary instead of introducing a
-- second inbox. The header's realtime subscription immediately sees these rows.
alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'AUCTION_PUBLISHED','NEW_BID','OUTBID','ENDING_SOON',
    'WON','SOLD','ENDED_UNSOLD','REVIEW_REQUEST','LISTING_REMOVED',
    'BID_CONFIRMED','REVIEW_SUBMITTED','REVIEW_APPROVED','REVIEW_REJECTED',
    'REVIEW_CHANGES_REQUESTED','CANCELLATION_REQUESTED','CANCELLATION_DECIDED',
    'AUCTION_PAUSED','AUCTION_RESUMED','AUCTION_CANCELLED','NEW_MESSAGE',
    'PAYMENT_EXPIRED','STAFF_REVIEW_REQUIRED','PROMOTION_REQUESTED',
    'PROMOTION_APPROVED','PROMOTION_REJECTED'
  ));

-- A listing review row is the authoritative moment work enters the review
-- queue, so alert staff from that row instead of duplicating risk logic.
create or replace function private.notify_staff_listing_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
begin
  if new.status <> 'PENDING' then
    return new;
  end if;

  select title into v_title
    from public.auctions
   where id = new.auction_id;

  insert into public.notifications (user_id, type, auction_id, payload)
  select distinct a.user_id,
         'STAFF_REVIEW_REQUIRED',
         new.auction_id,
         jsonb_build_object(
           'title', coalesce(v_title, 'Listing'),
           'review_id', new.id
         )
    from public.staff_assignments a
   where a.status = 'ACTIVE'
     and public.has_permission(a.user_id, 'listings.review');

  return new;
end;
$$;

drop trigger if exists listing_reviews_notify_staff on public.listing_reviews;
create trigger listing_reviews_notify_staff
after insert on public.listing_reviews
for each row execute function private.notify_staff_listing_review();

-- Seller request. No money moves here: this is deliberately a small,
-- manually-operated premium-placement workflow for the current stage.
create or replace function public.request_auction_promotion(
  p_auction_id uuid,
  p_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  a public.auctions%rowtype;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_days not in (3, 7) then
    raise exception 'invalid_duration' using errcode = '22023';
  end if;

  select * into a
    from public.auctions
   where id = p_auction_id
   for update;

  if not found then
    raise exception 'auction_not_found' using errcode = 'P0002';
  end if;

  if a.seller_id <> v_uid then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  if a.status not in ('LIVE','SCHEDULED') then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  if a.featured_until is not null and a.featured_until > clock_timestamp() then
    raise exception 'already_promoted' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.promotion_requests p
     where p.auction_id = a.id and p.status = 'PENDING'
  ) then
    raise exception 'already_requested' using errcode = 'P0001';
  end if;

  insert into public.promotion_requests (auction_id, seller_id, requested_days)
  values (a.id, v_uid, p_days)
  returning id into v_id;

  insert into public.notifications (user_id, type, auction_id, payload)
  select distinct s.user_id,
         'PROMOTION_REQUESTED',
         a.id,
         jsonb_build_object(
           'title', a.title,
           'request_id', v_id,
           'days', p_days
         )
    from public.staff_assignments s
   where s.status = 'ACTIVE'
     and public.has_permission(s.user_id, 'settings.manage_marketplace');

  return jsonb_build_object(
    'ok', true,
    'request_id', v_id,
    'status', 'PENDING'
  );
end;
$$;

create or replace function public.admin_decide_promotion(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r public.promotion_requests%rowtype;
  a public.auctions%rowtype;
  v_until timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not public.has_permission(v_uid, 'settings.manage_marketplace') then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  if p_note is not null and char_length(p_note) > 1000 then
    raise exception 'invalid_note' using errcode = '22023';
  end if;

  select * into r
    from public.promotion_requests
   where id = p_request_id
   for update;

  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;

  if r.status <> 'PENDING' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  select * into a
    from public.auctions
   where id = r.auction_id
   for update;

  if not found then
    raise exception 'auction_not_found' using errcode = 'P0002';
  end if;

  if p_approve then
    if a.status not in ('LIVE','SCHEDULED') then
      raise exception 'auction_not_promotable' using errcode = 'P0001';
    end if;

    v_until := clock_timestamp() + make_interval(days => r.requested_days);

    update public.auctions
       set featured = true,
           featured_until = v_until,
           featured_by = v_uid,
           updated_at = clock_timestamp()
     where id = a.id;

    update public.promotion_requests
       set status = 'APPROVED',
           decided_at = clock_timestamp(),
           decided_by = v_uid,
           admin_note = nullif(trim(coalesce(p_note, '')), '')
     where id = r.id;

    insert into public.notifications (user_id, type, auction_id, payload)
    values (
      r.seller_id,
      'PROMOTION_APPROVED',
      r.auction_id,
      jsonb_build_object(
        'title', a.title,
        'featured_until', v_until,
        'days', r.requested_days
      )
    );

    return jsonb_build_object(
      'ok', true,
      'status', 'APPROVED',
      'featured_until', v_until
    );
  end if;

  update public.promotion_requests
     set status = 'REJECTED',
         decided_at = clock_timestamp(),
         decided_by = v_uid,
         admin_note = nullif(trim(coalesce(p_note, '')), '')
   where id = r.id;

  insert into public.notifications (user_id, type, auction_id, payload)
  values (
    r.seller_id,
    'PROMOTION_REJECTED',
    r.auction_id,
    jsonb_build_object(
      'title', a.title,
      'reason', nullif(trim(coalesce(p_note, '')), '')
    )
  );

  return jsonb_build_object('ok', true, 'status', 'REJECTED');
end;
$$;

revoke all on function public.request_auction_promotion(uuid, integer)
  from public, anon;
revoke all on function public.admin_decide_promotion(uuid, boolean, text)
  from public, anon;

grant execute on function public.request_auction_promotion(uuid, integer)
  to authenticated, service_role;
grant execute on function public.admin_decide_promotion(uuid, boolean, text)
  to authenticated, service_role;
