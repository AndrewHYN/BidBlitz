-- BidBlitz — 000010 release security hardening
--
-- Final pre-launch pass over the Supabase advisors (security + performance).
-- Nothing here changes auction correctness: place_bid()/settle_auction() keep
-- their FOR UPDATE serialization, idempotency, anti-sniping and integer money.
-- This migration tightens PRIVILEGE and POLICY MECHANICS only.
--
-- Sections:
--   1. `private` schema — internal functions leave the PostgREST-exposed API
--   2. every internal function moved with ALTER (OID preserved -> triggers and
--      already-created policies keep referencing them without recreation)
--   3. every function we own gets `set search_path = ''` + schema-qualified
--      references (SECURITY DEFINER without a fixed search_path is not safe)
--   4. least-privilege EXECUTE grants (no PUBLIC wildcard; anon loses internal
--      functions; settle_due_auctions becomes service_role-only)
--   5. RLS: `(select auth.uid())` init-plan optimisation (semantics unchanged)
--      + admin policies merged into their base policies (one permissive policy
--      per action, identical union semantics)
--   6. covering indexes for the four unindexed foreign keys + duplicate index
--   7. pg_trgm moved out of `public` (search index keeps working: the opclass
--      is referenced by OID, so the GIN index is unaffected)
--   8. guard: no function of ours may end this migration without search_path
--
-- Advisor findings this file is expected to clear:
--   security: function_search_path_mutable (4), extension_in_public (1),
--             anon_security_definer_function_executable (6)
--   performance: unindexed_foreign_keys (4), auth_rls_initplan (15),
--             multiple_permissive_policies (5), duplicate_index (1)
-- REMAINING and documented (ADR-010): authenticated_security_definer_
-- function_executable for place_bid/publish_auction/cancel_auction/
-- settle_auction — these four ARE the product's RPC surface; each re-checks
-- identity, ownership and state internally before acting.

-- ===========================================================================
-- 1. private schema — not in PostgREST's exposed schemas, so no /rest/v1/rpc
--    route exists for anything inside it. Reachable only from RLS policies,
--    triggers and direct SQL.
-- ===========================================================================
create schema if not exists private;
comment on schema private is
  'BidBlitz internal functions (policy helpers + triggers). Never exposed to PostgREST.';

grant usage on schema private to postgres, anon, authenticated, service_role;
-- auth.users triggers fire as the GoTrue role:
grant usage on schema private to supabase_admin, supabase_auth_admin;

-- ===========================================================================
-- 2. move internal functions. ALTER FUNCTION ... SET SCHEMA keeps the OID, so
--    triggers (handle_new_user, sync_*, touch_*, auctions_protect_state) and
--    policies that already captured the OID continue to resolve.
--    Guarded with to_regprocedure so a partial re-run never aborts.
-- ===========================================================================
do $$
begin
  if to_regprocedure('public.is_admin()') is not null then
    alter function public.is_admin() set schema private;
  end if;
  if to_regprocedure('public.is_seller_of(uuid)') is not null then
    alter function public.is_seller_of(uuid) set schema private;
  end if;
  if to_regprocedure('public.can_view_auction(uuid)') is not null then
    alter function public.can_view_auction(uuid) set schema private;
  end if;
  if to_regprocedure('public.handle_new_user()') is not null then
    alter function public.handle_new_user() set schema private;
  end if;
  if to_regprocedure('public.sync_email_verified()') is not null then
    alter function public.sync_email_verified() set schema private;
  end if;
  if to_regprocedure('public.sync_image_count()') is not null then
    alter function public.sync_image_count() set schema private;
  end if;
  if to_regprocedure('public.touch_updated_at()') is not null then
    alter function public.touch_updated_at() set schema private;
  end if;
  if to_regprocedure('public.auctions_protect_state()') is not null then
    alter function public.auctions_protect_state() set schema private;
  end if;
end $$;

-- ===========================================================================
-- 3. search_path = '' + fully qualified references, for every function we own.
--    pg_catalog is always implicitly searched, so clock_timestamp(), jsonb
--    operators etc. resolve; everything else is schema-qualified explicitly.
--    CREATE OR REPLACE preserves OID, owner and grants.
-- ===========================================================================

-- ---- pure helpers (stay public: pure, read-only, granted to clients) -------
create or replace function public.round_minor(p_amount numeric, p_bps integer)
returns bigint
language sql immutable strict set search_path = ''
as $$
  select trunc(abs(p_amount) * p_bps / 10000 + 0.5)::bigint
         * case when p_amount < 0 then -1 else 1 end;
$$;

create or replace function public.auction_effective_status(
  p_status public.auction_status_t,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_now timestamptz default now()
)
returns text
language sql immutable set search_path = ''
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

create or replace function public.server_now()
returns timestamptz
language sql stable set search_path = ''
as $$ select clock_timestamp(); $$;

-- ---- policy helpers -> private --------------------------------------------
create or replace function private.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select p.is_admin from public.profiles p where p.id = auth.uid()
  ), false);
$$;

create or replace function private.is_seller_of(p_auction_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.auctions a
    where a.id = p_auction_id and a.seller_id = auth.uid()
  );
$$;

create or replace function private.can_view_auction(p_auction_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.auctions a
    where a.id = p_auction_id
      and (a.status <> 'DRAFT' or a.seller_id = auth.uid() or private.is_admin())
  );
$$;

-- ---- trigger functions -> private ------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
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

create or replace function private.sync_email_verified()
returns trigger
language plpgsql security definer set search_path = ''
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

create or replace function private.sync_image_count()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_auction uuid;
  v_count   integer;
begin
  if TG_OP = 'DELETE' then
    v_auction := old.auction_id;
  else
    v_auction := new.auction_id;
  end if;

  select count(*) into v_count
    from public.auction_images
   where auction_id = v_auction;

  update public.auctions
     set image_count = v_count
   where id = v_auction
     and image_count is distinct from v_count;

  return null;
end;
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin new.updated_at := clock_timestamp(); return new; end;
$$;

-- SECURITY INVOKER on purpose (000006): current_user must distinguish the
-- engine (postgres) from a PostgREST client (authenticated).
create or replace function private.auctions_protect_state()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user in ('postgres','supabase_admin','service_role') then
    new.updated_at := clock_timestamp();
    return new;                                   -- the engine owns this row
  end if;

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

-- ---- the engine (stays public: this is the product RPC surface) ------------
create or replace function public.settle_auction(p_auction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
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

create or replace function public.settle_due_auctions(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = ''
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
         status              = case when status = 'SCHEDULED' then 'LIVE'::public.auction_status_t
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
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  select * into a from public.auctions where id = p_auction_id for update;
  if not found then raise exception 'auction_not_found' using errcode = 'P0002'; end if;
  if a.seller_id <> v_uid then raise exception 'not_owner' using errcode = '42501'; end if;
  if a.status not in ('DRAFT','SCHEDULED') then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  -- Count the photographs themselves. image_count is derived and clients
  -- cannot write it, but a business rule should still read its own source of
  -- truth rather than a cached projection of it.
  select count(*) into v_imgs
    from public.auction_images where auction_id = a.id;
  if v_imgs < 1 then
    raise exception 'image_required' using errcode = 'P0001';
  end if;

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

create or replace function public.cancel_auction(p_auction_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  a     public.auctions%rowtype;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  select * into a from public.auctions where id = p_auction_id for update;
  if not found then raise exception 'auction_not_found' using errcode = 'P0002'; end if;
  if a.seller_id <> v_uid and not private.is_admin() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if a.bid_count > 0 and not private.is_admin() then
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
-- 4. least-privilege EXECUTE grants
-- ===========================================================================

-- Trigger functions: drop the PUBLIC wildcard, then grant every role that can
-- actually fire the trigger (defensive: whether PostgreSQL checks EXECUTE at
-- fire time or only at CREATE TRIGGER, each firing role is covered).
revoke execute on function private.handle_new_user() from public, anon;
revoke execute on function private.sync_email_verified() from public, anon;
revoke execute on function private.sync_image_count() from public, anon;
revoke execute on function private.auctions_protect_state() from public, anon;
revoke execute on function private.touch_updated_at() from public, anon;

grant execute on function private.handle_new_user()
  to postgres, supabase_admin, supabase_auth_admin, service_role;
grant execute on function private.sync_email_verified()
  to postgres, supabase_admin, supabase_auth_admin, service_role;
grant execute on function private.sync_image_count()
  to postgres, service_role, authenticated;
grant execute on function private.auctions_protect_state()
  to postgres, service_role, authenticated;
grant execute on function private.touch_updated_at()
  to postgres, service_role, authenticated;

-- Policy helpers: anon/authenticated evaluate them inside RLS predicates, so
-- they keep EXECUTE — but only inside `private`, where PostgREST cannot route.
grant execute on function private.is_admin()          to anon, authenticated, service_role;
grant execute on function private.can_view_auction(uuid) to anon, authenticated, service_role;
grant execute on function private.is_seller_of(uuid)  to authenticated, service_role;
revoke execute on function private.is_seller_of(uuid) from anon;

-- The sweep is invoked only by the secret-key paths (src/server/sweep.ts and
-- /api/cron/settle both use the admin client). An authenticated client never
-- calls it; settle_auction() (the per-auction close the UI does call) keeps
-- its authenticated grant below.
revoke execute on function public.settle_due_auctions(integer) from authenticated;
comment on function public.settle_due_auctions(integer) is
  'Sweep. EXECUTE: service_role only (admin sweep + cron route). Auction
   correctness never depends on who calls this: settle_auction() re-derives
   every winner under FOR UPDATE.';

-- ===========================================================================
-- 5. RLS — init-plan optimisation + admin policy merge
--    Every auth.uid() becomes (select auth.uid()): evaluated once per statement
--    instead of per row. SEMANTICS ARE UNCHANGED — auth.uid() cannot vary
--    within one statement.
-- ===========================================================================

-- ---- profiles --------------------------------------------------------------
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));

-- Self-update + admin-update merged into ONE permissive policy (identical
-- union: `(self constraints) OR is_admin()`). Clears multiple_permissive_
-- policies for profiles UPDATE without changing who can write what.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or private.is_admin())
  with check (
    (
      id = (select auth.uid())
      -- privilege columns are never client-writable
      and is_admin = (select p.is_admin from public.profiles p where p.id = (select auth.uid()))
      and is_banned = (select p.is_banned from public.profiles p where p.id = (select auth.uid()))
      and sales_count = (select p.sales_count from public.profiles p where p.id = (select auth.uid()))
      and purchases_count = (select p.purchases_count from public.profiles p where p.id = (select auth.uid()))
      and rating_sum = (select p.rating_sum from public.profiles p where p.id = (select auth.uid()))
      and rating_count = (select p.rating_count from public.profiles p where p.id = (select auth.uid()))
    )
    or private.is_admin()
  );

drop policy if exists profiles_admin_update on public.profiles;

-- ---- auctions --------------------------------------------------------------
drop policy if exists auctions_select on public.auctions;
create policy auctions_select on public.auctions
  for select using (
    status <> 'DRAFT'
    or seller_id = (select auth.uid())
    or private.is_admin()
  );

drop policy if exists auctions_insert on public.auctions;
create policy auctions_insert on public.auctions
  for insert to authenticated
  with check (
    (seller_id = (select auth.uid()) and status = 'DRAFT' and winner_id is null)
    or private.is_admin()
  );

drop policy if exists auctions_update on public.auctions;
create policy auctions_update on public.auctions
  for update to authenticated
  using (
    (seller_id = (select auth.uid()) and status in ('DRAFT','SCHEDULED','LIVE'))
    or private.is_admin()
  )
  with check (seller_id = (select auth.uid()) or private.is_admin());

drop policy if exists auctions_delete_draft on public.auctions;
create policy auctions_delete_draft on public.auctions
  for delete to authenticated
  using (
    (seller_id = (select auth.uid()) and status = 'DRAFT' and bid_count = 0)
    or private.is_admin()
  );

-- auctions_admin was the second permissive policy for every action on
-- auctions; its `is_admin()` is now folded into each policy above.
drop policy if exists auctions_admin on public.auctions;

-- ---- auction_images --------------------------------------------------------
drop policy if exists auction_images_select on public.auction_images;
create policy auction_images_select on public.auction_images
  for select using (private.can_view_auction(auction_id));

drop policy if exists auction_images_insert on public.auction_images;
create policy auction_images_insert on public.auction_images
  for insert to authenticated
  with check (
    private.is_seller_of(auction_id)
    and exists (select 1 from public.auctions a
                where a.id = auction_id and a.status in ('DRAFT','SCHEDULED','LIVE'))
  );

drop policy if exists auction_images_delete on public.auction_images;
create policy auction_images_delete on public.auction_images
  for delete to authenticated
  using (private.is_seller_of(auction_id));

-- ---- bids ------------------------------------------------------------------
drop policy if exists bids_select on public.bids;
create policy bids_select on public.bids
  for select using (private.can_view_auction(auction_id) or bidder_id = (select auth.uid()));

-- ---- watchlist -------------------------------------------------------------
drop policy if exists watchlist_all on public.watchlist;
create policy watchlist_all on public.watchlist
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---- notifications ---------------------------------------------------------
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_mark_read on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and read_at is not null);

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---- transactions ----------------------------------------------------------
drop policy if exists transactions_select on public.transactions;
create policy transactions_select on public.transactions
  for select to authenticated
  using (seller_id = (select auth.uid()) or buyer_id = (select auth.uid()) or private.is_admin());

-- ---- reviews ---------------------------------------------------------------
drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews
  for insert to authenticated
  with check (
    reviewer_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_id
        and (t.buyer_id = (select auth.uid()) or t.seller_id = (select auth.uid()))
    )
  );

-- ---- reports ---------------------------------------------------------------
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports
  for insert to authenticated with check (reporter_id = (select auth.uid()));

drop policy if exists reports_select_own on public.reports;
create policy reports_select_own on public.reports
  for select to authenticated
  using (reporter_id = (select auth.uid()) or private.is_admin());

drop policy if exists reports_admin_update on public.reports;
create policy reports_admin_update on public.reports
  for update to authenticated using (private.is_admin()) with check (private.is_admin());

-- ---- storage (auth.uid() wrapped the same way; semantics identical) --------
drop policy if exists auction_images_storage_insert on storage.objects;
create policy auction_images_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'auction-images'
    and (storage.foldername(name))[1] in (
      select a.id::text from public.auctions a
       where a.seller_id = (select auth.uid())
         and a.status in ('DRAFT','SCHEDULED','LIVE')
    )
  );

drop policy if exists auction_images_storage_delete on storage.objects;
create policy auction_images_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'auction-images'
    and (storage.foldername(name))[1] in (
      select a.id::text from public.auctions a where a.seller_id = (select auth.uid())
    )
  );

-- ===========================================================================
-- 6. covering indexes for the four unindexed foreign keys
--    (each one is a real access pattern: buyer dashboard "winning", winner
--     pages, per-auction notifications, "my reviews")
-- ===========================================================================
create index if not exists auctions_current_bidder_idx
  on public.auctions (current_bidder_id);
create index if not exists auctions_winner_idx
  on public.auctions (winner_id);
create index if not exists notifications_auction_idx
  on public.notifications (auction_id);
create index if not exists reviews_reviewer_idx
  on public.reviews (reviewer_id);

-- duplicate of auctions_live_ends_idx (000001): identical keys AND identical
-- predicate. Keep the original, drop the copy.
drop index if exists public.auctions_ending_soon_idx;

-- ===========================================================================
-- 7. pg_trgm out of `public`. The GIN index on auctions.title keeps working:
--    an index references its operator class by OID, not by schema name.
--    No query in the app calls similarity()/show_trgm() — search runs on
--    search_vector (full-text) and ilike — so moving the extension cannot
--    change behaviour, only exposure.
-- ===========================================================================
do $$
declare
  ext_schema text;
begin
  select n.nspname into ext_schema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';
  if ext_schema = 'public' then
    alter extension pg_trgm set schema extensions;
  end if;
end $$;

-- ===========================================================================
-- 8. guard — this migration must not finish with any function of ours on a
--    mutable search_path. (Extension members already live elsewhere by now.)
-- ===========================================================================
do $$
declare
  bad text;
begin
  select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname)
    into bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and (
       p.proconfig is null
       or not exists (
         select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'
       )
     );
  if bad is not null then
    raise exception 'functions without a fixed search_path: %', bad;
  end if;
end $$;
