-- BidBlitz — 20261006000001 minimum auction starting price ($1.00 / 100 cents)
--
-- Why: the production payment provider (Linkwa) will not process a payment
-- below USD 1.00. An auction starting below 100c can produce a sale that
-- cannot be paid for, exactly what happened in the 2026-10 production test
-- ($0.50 sale -> provider refused before any payment intent existed).
--
-- Smallest correct fix: a BEFORE INSERT trigger on public.auctions that
-- refuses NEW rows below 100c. It does NOT:
--   * scan, update or delete existing rows (historical sub-$1 auctions,
--     transactions and payments stay exactly as they are);
--   * fire on UPDATE, so settling/status changes of an old row are
--     unaffected;
--   * change settlement, payout, or reconciliation semantics.
--
-- The app validates the same rule earlier (createAuctionSchema) so sellers
-- get a field-level error; this trigger is the authoritative database
-- boundary for every insert path.

create or replace function public.auctions_enforce_min_starting_price()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  if new.starting_bid_minor is null or new.starting_bid_minor < 100 then
    raise exception 'below_minimum_price';
  end if;
  return new;
end;
$$;

drop trigger if exists auctions_min_starting_price on public.auctions;
create trigger auctions_min_starting_price
  before insert on public.auctions
  for each row
  execute function public.auctions_enforce_min_starting_price();

revoke all on function public.auctions_enforce_min_starting_price()
  from public, anon, authenticated;
