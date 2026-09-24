-- BidBlitz — 000004 storage, realtime, column grants

-- ===========================================================================
-- STORAGE — public reads (browse/SEO needs unauthenticated image delivery),
-- owner-only writes validated at the database.
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'auction-images', 'auction-images', true,
  10485760,                                                   -- 10 MB hard cap
  array['image/jpeg','image/png','image/webp','image/avif','image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- anyone may read images of auctions they can view
drop policy if exists auction_images_storage_read on storage.objects;
create policy auction_images_storage_read on storage.objects
  for select using (bucket_id = 'auction-images');

-- only the auction owner may write into <auction_id>/<file>
drop policy if exists auction_images_storage_insert on storage.objects;
create policy auction_images_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'auction-images'
    and (storage.foldername(name))[1] in (
      select a.id::text from public.auctions a
       where a.seller_id = auth.uid()
         and a.status in ('DRAFT','SCHEDULED','LIVE')
    )
  );

drop policy if exists auction_images_storage_delete on storage.objects;
create policy auction_images_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'auction-images'
    and (storage.foldername(name))[1] in (
      select a.id::text from public.auctions a where a.seller_id = auth.uid()
    )
  );

-- ===========================================================================
-- REALTIME — enable the tables so the adapter can use either Broadcast or
-- Postgres Changes. Broadcast carries the urgent bid signal; Postgres Changes
-- is the reconnect/reconciliation fallback. Authority stays in the database.
-- ===========================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'auctions'
  ) then
    alter publication supabase_realtime add table public.auctions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'bids'
  ) then
    alter publication supabase_realtime add table public.bids;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- full row images so consumers can render without a follow-up fetch
alter table public.auctions replica identity full;
alter table public.bids    replica identity full;
-- notifications carry PII-ish payloads: key only, no full row
alter table public.notifications replica identity default;

-- ===========================================================================
-- COLUMN GRANTS — defence in depth for auction state
-- RLS alone would allow a seller to UPDATE their own row; these grants make
-- the protected columns physically unwritable from PostgREST.
-- ===========================================================================
revoke update on public.auctions from anon, authenticated;
revoke insert on public.auctions from anon;
revoke delete on public.auctions from anon, authenticated;
revoke update, insert, delete on public.bids from anon, authenticated;
revoke insert, update, delete on public.transactions from anon, authenticated;
revoke insert, update, delete on public.notifications from anon, authenticated;
revoke update, delete on public.fee_settings from anon, authenticated, service_role;
revoke insert, update, delete on public.categories from anon, authenticated;

grant update (
  -- metadata only. NOT starts_at/ends_at (a seller could otherwise extend
  -- their own auction) and NOT featured (that must follow a real payment).
  title, description, category_id, condition, location,
  image_count, updated_at
) on public.auctions to authenticated;

grant insert (
  seller_id, title, description, category_id, condition, location, currency,
  starting_bid_minor, bid_increment_minor, duration_seconds,
  anti_snipe_window_seconds, anti_snipe_extension_seconds, image_count, status
) on public.auctions to authenticated;

grant delete on public.auctions to authenticated;

-- service_role (secret key) keeps full table access for operator tooling,
-- but the engine functions are what actually mutate protected columns.
grant update on public.auctions to service_role;

-- ===========================================================================
-- utility: server time for client clock synchronization
-- ===========================================================================
create or replace function public.server_now()
returns timestamptz
language sql stable
as $$ select clock_timestamp(); $$;

grant execute on function public.server_now() to anon, authenticated;
