-- ===========================================================================
-- place_bid: settle-then-refuse must COMMIT the settlement
-- ===========================================================================
--
-- THE BUG. `place_bid()` on an auction whose clock had passed called
-- `settle_auction()` and then `raise exception 'auction_ended'` to refuse the
-- bid. In PostgreSQL a raised exception aborts the enclosing transaction, so
-- the settlement was rolled back with it. Measured, not reasoned about: the
-- CASE A checks in scripts/db/verify-engine.mjs placed a bid on an expired
-- auction, confirmed the refusal, read the row back, and found it still LIVE.
--
-- The bid was refused correctly - which is why every test passed - but the
-- settlement silently did not survive. The auction stayed LIVE until some
-- other trigger swept it, and the code comment claiming "settle it, then
-- refuse" described an intent the next statement undid.
--
-- THE FIX. Settle first, then report the refusal as a RETURNED rejection,
-- never as a raise. The transaction commits with the settlement persisted and
-- no bid written: exactly one final outcome, decided under the row lock, on
-- the server clock.
--
-- The caller contract is preserved on purpose. placeBidAction() already
-- handles `!payload?.ok` through normalizeEngineError(), which reads the
-- `error` field - so `{ok:false, error:'auction_ended'}` maps to the exact
-- message the user sees today ("Auction has ended."). PostgREST callers see
-- HTTP 200 with that body instead of HTTP 4xx with a raised message; the
-- checks in scripts/db/verify-engine.mjs assert the new shape. Nothing about
-- what any human reads changes; only the settlement now survives, which is
-- the entire point of calling it.
--
-- Every OTHER raise in this function is untouched, deliberately. Those paths
-- change nothing, so rolling back is correct there - and a refusal that
-- writes nothing must keep failing closed with an exception, not a value.

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
    -- Closed on the server clock but not yet swept. Settle FIRST so the close
    -- is recorded (winner or UNSOLD, exactly one transaction or none, exactly
    -- one winning bid or none, notifications, counters), then report the
    -- refusal as a RETURNED rejection - never as a raise. A raise here aborts
    -- the enclosing transaction and rolls the settlement back with it, which
    -- is the defect this migration fixes: the row stayed LIVE while the
    -- bidder was told it ended.
    --
    -- settle_auction() cannot fail here: we hold the row lock on a LIVE row
    -- whose ends_at is past, so it is due by construction, and it re-checks
    -- everything itself. If it ever did raise, the exception would propagate
    -- and the bid would be refused with nothing written - fail-closed, as a
    -- refusal must be.
    v_settle := public.settle_auction(a.id);
    return jsonb_build_object(
      'ok', false, 'error', 'auction_ended',
      'settled', coalesce(v_settle->>'status', 'UNKNOWN'),
      'ends_at', a.ends_at
    );
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

-- The grants on place_bid() survive CREATE OR REPLACE untouched, and they are
-- exactly what this path needs: authenticated callers may invoke it, and the
-- SECURITY DEFINER body does its own auth.uid(), ownership, ban, clock and
-- state checks before writing anything. No grant change in this migration.
comment on function public.place_bid(uuid, bigint, uuid) is
  'Bid intake. Serializes on the auction row (FOR UPDATE). A bid on a
   clock-expired LIVE auction settles it first and reports the refusal as a
   RETURNED {ok:false,error:auction_ended} so the settlement commits; raising
   there would roll the settlement back. All other refusals raise, because
   they change nothing.';
