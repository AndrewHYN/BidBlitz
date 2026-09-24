-- BidBlitz — 000003 auction engine
-- THE TECHNICAL HEART.
--   * place_bid()      — locked, idempotent, anti-sniping bid transaction
--   * settle_auction() — authoritative close + winner + fee + transaction
--   * publish/cancel   — state transitions
-- All money is integer minor units. All fees computed here, never in a client.

-- ===========================================================================
-- helpers
-- ===========================================================================
-- Round half up, away from zero, on a numeric -> exactly representable bigint.
-- Never float: this is numeric/integer arithmetic end to end.
create or replace function public.round_minor(p_amount numeric, p_bps integer)
returns bigint
language sql immutable strict
as $$
  select trunc(abs(p_amount) * p_bps / 10000 + 0.5)::bigint
         * case when p_amount < 0 then -1 else 1 end;
$$;

-- Server-authoritative view of status. "ENDING" is derived, never stored, so a
-- stale stored flag can never lie about an auction that already closed.
create or replace function public.auction_effective_status(
  p_status auction_status_t,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_now timestamptz default now()
)
returns text
language sql immutable
as $$
  select case
    when p_status = 'SCHEDULED' and p_starts_at is not null and p_starts_at <= p_now
      then 'LIVE'
    when p_status <> 'LIVE' then p_status::text
    when p_ends_at <= p_now then 'ENDED'
    when p_ends_at - p_now <= interval '60 seconds' then 'ENDING'
    else 'LIVE'
  end;
$$;

-- ===========================================================================
-- settle_auction — closes exactly once, decides the winner, records the fee
-- ===========================================================================
create or replace function public.settle_auction(p_auction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  a          public.auctions%rowtype;
  v_now      timestamptz := clock_timestamp();
  v_fee      public.fee_settings%rowtype;
  v_gross    bigint;
  v_fee_amt  bigint;
  v_net      bigint;
  v_tx_id    uuid;
begin
  select * into a from public.auctions where id = p_auction_id for update;
  if not found then
    raise exception 'auction_not_found';
  end if;

  -- Idempotent: settling a settled auction is a no-op, never a double-writer.
  if a.status <> 'LIVE' then
    return jsonb_build_object(
      'ok', true, 'already_settled', true,
      'status', a.status, 'winner_id', a.winner_id,
      'winning_bid_minor', a.winning_bid_minor
    );
  end if;

  if a.ends_at > v_now then
    return jsonb_build_object('ok', false, 'error', 'not_due',
                              'ends_at', a.ends_at);
  end if;

  if a.bid_count = 0 or a.current_bid_minor is null or a.current_bidder_id is null then
    update public.auctions
       set status = 'UNSOLD', settled_at = v_now, updated_at = v_now
     where id = a.id;

    insert into public.notifications (user_id, type, auction_id, payload)
    values (a.seller_id, 'ENDED_UNSOLD', a.id,
            jsonb_build_object('title', a.title, 'reason', 'no_bids'));

    return jsonb_build_object('ok', true, 'status', 'UNSOLD', 'winner_id', null);
  end if;

  -- ---- winner + sale -------------------------------------------------------
  v_gross := a.current_bid_minor;

  select * into v_fee from public.fee_settings where id = 1;
  if not found then
    v_fee.fee_bps := 500; v_fee.min_fee_minor := 0;
  end if;

  v_fee_amt := greatest(v_fee.min_fee_minor,
                        public.round_minor(v_gross::numeric, v_fee.fee_bps));
  v_fee_amt := least(v_fee_amt, v_gross);      -- fee can never exceed the sale
  v_net     := v_gross - v_fee_amt;

  update public.auctions
     set status = 'SOLD',
         winner_id = a.current_bidder_id,
         winning_bid_minor = v_gross,
         settled_at = v_now,
         updated_at = v_now
   where id = a.id;

  insert into public.transactions
    (auction_id, seller_id, buyer_id, currency, gross_minor,
     fee_bps, fee_minor, net_minor, status)
  values
    (a.id, a.seller_id, a.current_bidder_id, a.currency, v_gross,
     v_fee.fee_bps, v_fee_amt, v_net, 'AWAITING_PAYMENT')
  returning id into v_tx_id;

  -- mark the winning bid, unmark any previous claim
  update public.bids set is_winning = false
   where auction_id = a.id and is_winning;
  update public.bids
     set is_winning = true
   where auction_id = a.id
     and bidder_id = a.current_bidder_id
     and amount_minor = v_gross
     and created_at = (
       select max(b2.created_at) from public.bids b2
        where b2.auction_id = a.id
          and b2.bidder_id = a.current_bidder_id
          and b2.amount_minor = v_gross
     );

  update public.profiles set sales_count   = sales_count   + 1,
                             updated_at    = now() where id = a.seller_id;
  update public.profiles set purchases_count = purchases_count + 1,
                             updated_at      = now() where id = a.current_bidder_id;

  insert into public.notifications (user_id, type, auction_id, payload) values
    (a.current_bidder_id, 'WON', a.id,
      jsonb_build_object('title', a.title, 'winning_bid_minor', v_gross,
                         'currency', a.currency, 'transaction_id', v_tx_id)),
    (a.seller_id, 'SOLD', a.id,
      jsonb_build_object('title', a.title, 'winning_bid_minor', v_gross,
                         'currency', a.currency, 'fee_minor', v_fee_amt,
                         'net_minor', v_net, 'transaction_id', v_tx_id));

  return jsonb_build_object(
    'ok', true, 'status', 'SOLD',
    'winner_id', a.current_bidder_id,
    'winning_bid_minor', v_gross,
    'fee_minor', v_fee_amt, 'net_minor', v_net,
    'currency', a.currency, 'transaction_id', v_tx_id
  );
end;
$$;

-- Sweep: close everything due. Called by page loads, by the bid path, and by
-- the /api/cron/settle route (Vercel cron). Never depends on a single trigger.
create or replace function public.settle_due_auctions(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  r          record;
  v_closed   integer := 0;
  v_result   jsonb;
begin
  for r in
    select id from public.auctions
     where status = 'LIVE' and ends_at <= clock_timestamp()
     order by ends_at
     limit p_limit
     for update skip locked          -- parallel workers never double-settle
  loop
    v_result := public.settle_auction(r.id);
    if coalesce((v_result->>'ok')::boolean, false) then
      v_closed := v_closed + 1;
    end if;
  end loop;
  return v_closed;
end;
$$;

-- ===========================================================================
-- place_bid — the single writer for bidding
-- ===========================================================================
-- errors are raised with SQLSTATE detail so the app can map them to copy:
--   not_authenticated | auction_not_found | seller_cannot_bid
--   auction_not_live  | auction_ended     | below_minimum
create or replace function public.place_bid(
  p_auction_id    uuid,
  p_amount_minor  bigint,
  p_request_id    uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
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
begin
  -- ---- request validation --------------------------------------------------
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

  -- ---- idempotent replay ---------------------------------------------------
  -- Same logical request submitted twice (retry, double tap, flaky network):
  -- return the ORIGINAL result. Never create a second bid.
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

  -- ---- serialize on the auction row ---------------------------------------
  -- FOR UPDATE is the ONLY serializer. No JS locks, no in-memory mutex.
  select * into a from public.auctions where id = p_auction_id for update;
  if not found then
    raise exception 'auction_not_found' using errcode = 'P0002';
  end if;

  -- ---- business rules (application layer, tested) --------------------------
  if a.seller_id = v_uid then
    raise exception 'seller_cannot_bid' using errcode = '42501';
  end if;

  -- re-evaluate state against the SERVER clock; a client countdown is irrelevant
  if a.status in ('DRAFT','CANCELLED') then
    raise exception 'auction_not_live' using errcode = 'P0001';
  end if;
  if a.status = 'SCHEDULED' and (a.starts_at is null or a.starts_at > v_now) then
    raise exception 'auction_not_live' using errcode = 'P0001';
  end if;
  if a.status in ('ENDED','SOLD','UNSOLD') then
    raise exception 'auction_ended' using errcode = 'P0001';
  end if;
  if a.status = 'LIVE' and a.ends_at <= v_now then
    -- closed on the server clock but not yet swept: settle it, then refuse
    perform public.settle_auction(a.id);
    raise exception 'auction_ended' using errcode = 'P0001';
  end if;

  -- minimum: first bid = starting price, every later bid = current + increment
  v_min := case when a.current_bid_minor is null
                then a.starting_bid_minor
                else a.current_bid_minor + a.bid_increment_minor end;

  if p_amount_minor < v_min then
    raise exception 'below_minimum'
      using errcode = 'P0001', hint = v_min::text;
  end if;

  v_prev     := a.current_bidder_id;
  v_prev_amt := a.current_bid_minor;

  -- ---- write the bid -------------------------------------------------------
  insert into public.bids (auction_id, bidder_id, amount_minor, currency,
                           request_id, is_winning)
  values (a.id, v_uid, p_amount_minor, a.currency, p_request_id, true)
  returning id into v_bid_id;

  -- ---- anti-sniping (server side, inside the same lock) --------------------
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
         status              = case when status = 'SCHEDULED' then 'LIVE'::auction_status_t
                                    else status end,
         updated_at          = v_now
   where id = a.id
   returning * into a;

  -- ---- notifications (fire-and-forget; realtime is the urgent channel) -----
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

-- ===========================================================================
-- publish / cancel
-- ===========================================================================
create or replace function public.publish_auction(
  p_auction_id uuid,
  p_starts_at  timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  a       public.auctions%rowtype;
  v_uid   uuid := auth.uid();
  v_start timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  select * into a from public.auctions where id = p_auction_id for update;
  if not found then raise exception 'auction_not_found' using errcode = 'P0002'; end if;
  if a.seller_id <> v_uid then raise exception 'not_owner' using errcode = '42501'; end if;
  if a.status not in ('DRAFT','SCHEDULED') then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  if a.image_count < 1 then
    raise exception 'image_required' using errcode = 'P0001';
  end if;

  v_start := coalesce(p_starts_at, clock_timestamp());

  update public.auctions
     set status     = case when v_start <= clock_timestamp()
                           then 'LIVE'::auction_status_t
                           else 'SCHEDULED'::auction_status_t end,
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

create or replace function public.cancel_auction(p_auction_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  a     public.auctions%rowtype;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  select * into a from public.auctions where id = p_auction_id for update;
  if not found then raise exception 'auction_not_found' using errcode = 'P0002'; end if;
  if a.seller_id <> v_uid and not public.is_admin() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if a.bid_count > 0 and not public.is_admin() then
    -- cannot yank an auction people have bid on
    raise exception 'has_bids' using errcode = 'P0001';
  end if;
  if a.status in ('SOLD','UNSOLD','CANCELLED') then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  update public.auctions
     set status = 'CANCELLED', updated_at = clock_timestamp()
   where id = a.id;

  return jsonb_build_object('ok', true, 'status', 'CANCELLED');
end;
$$;

-- ===========================================================================
-- immutability trigger — RLS cannot see OLD, triggers can
-- ===========================================================================
-- SECURITY INVOKER on purpose: it needs to see WHO is writing.
--   * place_bid()/settle_auction()/publish_auction() are SECURITY DEFINER
--     (owner = postgres), so inside those current_user = 'postgres' and the
--     engine is allowed to move the bid projection and the state machine.
--   * a PostgREST PATCH arrives as role 'authenticated' and may only touch
--     metadata — never a price, a winner, a count or a status.
-- A SECURITY DEFINER trigger would erase that distinction (it would always
-- report postgres), which is exactly the bug this replaces.
create or replace function public.auctions_protect_state()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  if current_user in ('postgres','supabase_admin','service_role') then
    new.updated_at := clock_timestamp();
    return new;                                   -- the engine owns this row
  end if;

  -- client path: financial + lifecycle columns are frozen
  if new.seller_id is distinct from old.seller_id
     or new.currency is distinct from old.currency
     or new.status is distinct from old.status
     or new.current_bid_minor is distinct from old.current_bid_minor
     or new.current_bidder_id is distinct from old.current_bidder_id
     or new.bid_count is distinct from old.bid_count
     or new.winner_id is distinct from old.winner_id
     or new.winning_bid_minor is distinct from old.winning_bid_minor
     or new.settled_at is distinct from old.settled_at
     or new.extension_count is distinct from old.extension_count
     or new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at
     or new.duration_seconds is distinct from old.duration_seconds
     or new.anti_snipe_window_seconds is distinct from old.anti_snipe_window_seconds
     or new.anti_snipe_extension_seconds is distinct from old.anti_snipe_extension_seconds
     or new.starting_bid_minor is distinct from old.starting_bid_minor
     or new.bid_increment_minor is distinct from old.bid_increment_minor
     or new.image_count is distinct from old.image_count then
    raise exception 'auction_state_immutable';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists auctions_protect_state on public.auctions;
create trigger auctions_protect_state
  before update on public.auctions
  for each row execute function public.auctions_protect_state();

-- ===========================================================================
-- profiles: created automatically on signup
-- ===========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  v_base   text;
  v_handle text;
  v_name   text;
  v_i      integer := 0;
begin
  v_base := lower(coalesce(
    nullif(split_part(coalesce(new.email,'user'), '@', 1), ''),
    'blitz'
  ));
  v_base := regexp_replace(v_base, '[^a-z0-9_]', '', 'g');
  if char_length(v_base) < 3 then v_base := 'blitz' || left(v_base, 8); end if;
  if char_length(v_base) > 16 then v_base := left(v_base, 16); end if;

  v_handle := v_base;
  loop
    exit when not exists (select 1 from public.profiles where username = v_handle);
    v_i := v_i + 1;
    v_handle := left(v_base, 24 - length(v_i::text)) || v_i::text;
    exit when v_i > 9999;
  end loop;

  v_name := coalesce(nullif(new.raw_user_meta_data->>'display_name',''),
                     nullif(new.raw_user_meta_data->>'full_name',''),
                     v_handle);

  insert into public.profiles (id, username, display_name, email_verified, location)
  values (new.id, v_handle, left(v_name, 60),
          coalesce(new.email_confirmed_at is not null, false),
          left(coalesce(new.raw_user_meta_data->>'location',''), 80))
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- keep email verification state in sync
create or replace function public.sync_email_verified()
returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
begin
  update public.profiles
     set email_verified = (new.email_confirmed_at is not null),
         updated_at = now()
   where id = new.id
     and email_verified is distinct from (new.email_confirmed_at is not null);
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update on auth.users
  for each row execute function public.sync_email_verified();

-- ===========================================================================
-- updated_at hygiene
-- ===========================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := clock_timestamp(); return new; end; $$;

drop trigger if exists transactions_touch on public.transactions;
create trigger transactions_touch before update on public.transactions
  for each row execute function public.touch_updated_at();

drop trigger if exists fee_settings_touch on public.fee_settings;
create trigger fee_settings_touch before update on public.fee_settings
  for each row execute function public.touch_updated_at();

-- ===========================================================================
-- engine privileges — declared HERE because these functions are born here.
-- (Granting them in 000002 would fail with 42883 before they exist.)
-- ===========================================================================
revoke all on function public.place_bid(uuid, bigint, uuid)              from public, anon;
revoke all on function public.settle_auction(uuid)                       from public, anon;
revoke all on function public.settle_due_auctions(integer)               from public, anon;
revoke all on function public.publish_auction(uuid, timestamptz)         from public, anon;
revoke all on function public.cancel_auction(uuid)                       from public, anon;
revoke all on function public.auction_effective_status(auction_status_t, timestamptz, timestamptz, timestamptz) from public;
revoke all on function public.round_minor(numeric, integer)              from public;

grant execute on function public.auction_effective_status(auction_status_t, timestamptz, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.round_minor(numeric, integer) to anon, authenticated;

-- Only an authenticated user may bid; the function re-checks identity, state,
-- ownership, timing and minimum internally, so EXECUTE is safe to grant.
grant execute on function public.place_bid(uuid, bigint, uuid)      to authenticated;
grant execute on function public.publish_auction(uuid, timestamptz) to authenticated;
grant execute on function public.cancel_auction(uuid)               to authenticated;

-- Settlement is privileged: invoked by the cron route / secret key, and by any
-- authenticated page load that discovers an overdue auction.
grant execute on function public.settle_auction(uuid)     to authenticated, service_role;
grant execute on function public.settle_due_auctions(integer) to authenticated, service_role;

-- hide the engine surface from anon entirely
revoke execute on function public.touch_updated_at() from public;
