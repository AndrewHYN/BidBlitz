-- BidBlitz — 000006 fix auction immutability trigger + narrow client grants
--
-- Why this migration exists (honest changelog):
-- 20260924000003 created auctions_protect_state() as SECURITY DEFINER and
-- included `bid_count` in its "identity is immutable" branch. Because the
-- engine itself increments bid_count on every bid, place_bid() raised
-- auction_identity_immutable and NO BID could ever be recorded.
--
-- Two defects fixed here:
--   1. trigger must be SECURITY INVOKER so current_user distinguishes the
--      engine (postgres) from a PostgREST client (authenticated);
--   2. client column grants included starts_at/ends_at/featured, which would
--      let a seller extend their own auction or self-feature without payment.

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

-- re-narrow the client's writable column set
revoke update on public.auctions from anon, authenticated;
grant update (
  title, description, category_id, condition, location, image_count, updated_at
) on public.auctions to authenticated;
grant update on public.auctions to service_role;
