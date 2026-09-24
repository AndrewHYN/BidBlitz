-- BidBlitz — 000005 discovery indexes & search support
-- Added after the core engine so they can be tuned against real query shapes.

-- ending-soon rail: LIVE auctions ordered by imminent close
create index if not exists auctions_ending_soon_idx
  on public.auctions (ends_at asc)
  where status = 'LIVE';

-- most-bids sort
-- (no stored 'ENDING': ENDING is derived from time, never persisted — see
--  auction_effective_status in migration 000003)
create index if not exists auctions_bid_count_idx
  on public.auctions (bid_count desc, ends_at asc)
  where status in ('LIVE','SOLD','UNSOLD','ENDED');

-- price range filtering (minor units, integer)
create index if not exists auctions_price_idx
  on public.auctions (status, coalesce(current_bid_minor, starting_bid_minor));

-- condition filter
create index if not exists auctions_condition_idx
  on public.auctions (condition, status);

-- composite browse access path: category + status + sort key
create index if not exists auctions_browse_idx
  on public.auctions (category_id, status, coalesce(current_bid_minor, starting_bid_minor));

-- trigram-free ILIKE support for simple word search without a search cluster
create extension if not exists pg_trgm;
create index if not exists auctions_title_trgm_idx
  on public.auctions using gin (title gin_trgm_ops);

-- transaction lookups by provider state (payment reconciliation later)
create index if not exists transactions_provider_idx
  on public.transactions (provider, status)
  where provider is not null;

-- reviews per transaction (already unique) + per auction for the detail page
create index if not exists reviews_auction_idx
  on public.reviews (auction_id, created_at desc);
