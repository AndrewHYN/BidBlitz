-- Archive the historical PCA10 demo sale without deleting its bid, transaction,
-- notifications, image metadata or payout evidence.
alter table public.auctions
  add column if not exists archived_at timestamptz;

comment on column public.auctions.archived_at is
  'When non-null, this auction is retained for audit/history but hidden from normal marketplace and user-facing auction surfaces.';

create index if not exists auctions_public_visibility_idx
  on public.auctions (archived_at, status, created_at desc);

update public.auctions
set archived_at = coalesce(archived_at, now())
where id = 'ecc27880-5067-4d52-a806-96c7e884fb0b'
  and title = 'PCA10'
  and description = 'Small computer';

insert into public.schema_migrations(filename)
values ('20261007000001_archive_demo_auction.sql')
on conflict (filename) do nothing;
