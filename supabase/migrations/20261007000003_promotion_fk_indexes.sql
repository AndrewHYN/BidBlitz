-- Cover the two new nullable actor foreign keys introduced by the promotion
-- workflow. Partial indexes keep the common NULL case out while satisfying
-- delete/update FK lookups when an actor exists.
create index if not exists auctions_featured_by_idx
  on public.auctions (featured_by)
  where featured_by is not null;

create index if not exists promotion_requests_decided_by_idx
  on public.promotion_requests (decided_by)
  where decided_by is not null;
