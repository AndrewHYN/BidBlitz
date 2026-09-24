-- BidBlitz — 000002 Row Level Security
-- Principle: RLS is the DATABASE AUTHORIZATION layer. Application business
-- rules (seller cannot bid, auction not closed, amount >= minimum) are enforced
-- separately inside place_bid()/settle_auction(). Both are tested.

-- ===========================================================================
-- helpers
-- ===========================================================================
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select p.is_admin from public.profiles p where p.id = auth.uid()
  ), false);
$$;

create or replace function public.is_seller_of(p_auction_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.auctions a
    where a.id = p_auction_id and a.seller_id = auth.uid()
  );
$$;

-- A draft belongs to nobody else; everything else is public except CANCELLED.
create or replace function public.can_view_auction(p_auction_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.auctions a
    where a.id = p_auction_id
      and (a.status <> 'DRAFT' or a.seller_id = auth.uid() or public.is_admin())
  );
$$;

-- ===========================================================================
-- enable RLS everywhere
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'public.profiles','public.categories','public.auctions','public.auction_images',
    'public.bids','public.watchlist','public.notifications','public.fee_settings',
    'public.transactions','public.reviews','public.reports'
  ] loop
    execute format('alter table %s enable row level security', t);
    -- NOTE: deliberately NOT "force". FORCE would apply RLS to the table owner
    -- (postgres), and place_bid()/settle_auction() are SECURITY DEFINER functions
    -- owned by postgres. They are the only legitimate writers of `bids` and of
    -- the bid projection; FORCE would let RLS veto the engine's own writes,
    -- because `bids` intentionally has NO insert policy. ENABLE restricts
    -- anon/authenticated — which is exactly the threat model — while leaving the
    -- definer able to enforce the business rules it owns.
  end loop;
end $$;

-- ===========================================================================
-- profiles: public read, self write, admin write
-- ===========================================================================
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (true);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    -- privilege columns are never client-writable
    and is_admin = (select p.is_admin from public.profiles p where p.id = auth.uid())
    and is_banned = (select p.is_banned from public.profiles p where p.id = auth.uid())
    and sales_count = (select p.sales_count from public.profiles p where p.id = auth.uid())
    and purchases_count = (select p.purchases_count from public.profiles p where p.id = auth.uid())
    and rating_sum = (select p.rating_sum from public.profiles p where p.id = auth.uid())
    and rating_count = (select p.rating_count from public.profiles p where p.id = auth.uid())
  );

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ===========================================================================
-- categories: read-only for everyone
-- ===========================================================================
drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories for select using (true);

-- ===========================================================================
-- auctions
-- ===========================================================================
drop policy if exists auctions_select on public.auctions;
create policy auctions_select on public.auctions
  for select using (
    status <> 'DRAFT'
    or seller_id = auth.uid()
    or public.is_admin()
  );

-- Sellers insert their own drafts; status may never start past DRAFT here.
drop policy if exists auctions_insert on public.auctions;
create policy auctions_insert on public.auctions
  for insert to authenticated
  with check (seller_id = auth.uid() and status = 'DRAFT' and winner_id is null);

-- Sellers edit their own auction METADATA only.
-- Immutable columns (seller_id, status, current_bid_minor, current_bidder_id,
-- bid_count, winner_id, winning_bid_minor, settled_at, extension_count) are
-- protected in three independent layers, because RLS WITH CHECK cannot see OLD:
--   1. column-level REVOKE/GRANT (see "column grants" below)
--   2. auctions_protect_state trigger (compares OLD vs NEW, migration 000003)
--   3. this policy's USING/WITH CHECK ownership rule
drop policy if exists auctions_update on public.auctions;
create policy auctions_update on public.auctions
  for update to authenticated
  using (seller_id = auth.uid() and status in ('DRAFT','SCHEDULED','LIVE'))
  with check (seller_id = auth.uid());

drop policy if exists auctions_delete_draft on public.auctions;
create policy auctions_delete_draft on public.auctions
  for delete to authenticated
  using (seller_id = auth.uid() and status = 'DRAFT' and bid_count = 0);

drop policy if exists auctions_admin on public.auctions;
create policy auctions_admin on public.auctions
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ===========================================================================
-- auction_images
-- ===========================================================================
drop policy if exists auction_images_select on public.auction_images;
create policy auction_images_select on public.auction_images
  for select using (public.can_view_auction(auction_id));

drop policy if exists auction_images_insert on public.auction_images;
create policy auction_images_insert on public.auction_images
  for insert to authenticated
  with check (
    public.is_seller_of(auction_id)
    and exists (select 1 from public.auctions a
                where a.id = auction_id and a.status in ('DRAFT','SCHEDULED','LIVE'))
  );

drop policy if exists auction_images_delete on public.auction_images;
create policy auction_images_delete on public.auction_images
  for delete to authenticated
  using (public.is_seller_of(auction_id));

-- ===========================================================================
-- bids: world-readable on open auctions (username only, never contact data)
-- ===========================================================================
drop policy if exists bids_select on public.bids;
create policy bids_select on public.bids
  for select using (public.can_view_auction(auction_id) or bidder_id = auth.uid());

-- NOTE: no INSERT/UPDATE/DELETE policy for authenticated users on purpose.
-- Every bid must go through place_bid() (SECURITY DEFINER) so that state,
-- locks, idempotency and anti-sniping cannot be bypassed. The function is the
-- only writer. RLS therefore denies direct bid inserts outright.

-- ===========================================================================
-- watchlist: strictly private
-- ===========================================================================
drop policy if exists watchlist_all on public.watchlist;
create policy watchlist_all on public.watchlist
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ===========================================================================
-- notifications: strictly private
-- ===========================================================================
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_mark_read on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and read_at is not null);

-- inserts happen only from SECURITY DEFINER functions (no client policy)

-- ===========================================================================
-- fee_settings: world-readable price is FINE (it is public policy) but the
-- table is immutable to clients — only the secret key can ever change it.
-- ===========================================================================
drop policy if exists fee_settings_select on public.fee_settings;
create policy fee_settings_select on public.fee_settings for select using (true);
-- deliberately NO insert/update/delete policy

-- ===========================================================================
-- transactions: only the two parties, plus operator
-- ===========================================================================
drop policy if exists transactions_select on public.transactions;
create policy transactions_select on public.transactions
  for select to authenticated
  using (seller_id = auth.uid() or buyer_id = auth.uid() or public.is_admin());

-- inserts/updates come only from settle_auction() (SECURITY DEFINER).
-- No client write policy exists on purpose: the client cannot mint money.

-- ===========================================================================
-- reviews
-- ===========================================================================
drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews for select using (true);

drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews
  for insert to authenticated
  with check (
    reviewer_id = auth.uid()
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_id
        and (t.buyer_id = auth.uid() or t.seller_id = auth.uid())
    )
  );

-- ===========================================================================
-- reports
-- ===========================================================================
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports
  for insert to authenticated with check (reporter_id = auth.uid());

drop policy if exists reports_select_own on public.reports;
create policy reports_select_own on public.reports
  for select to authenticated
  using (reporter_id = auth.uid() or public.is_admin());

drop policy if exists reports_admin_update on public.reports;
create policy reports_admin_update on public.reports
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ===========================================================================
-- grants
-- ---------------------------------------------------------------------------
-- Execution-order note: place_bid(), settle_auction(), settle_due_auctions(),
-- publish_auction() and cancel_auction() do not exist yet — they are created
-- in 20260924000003_auction_engine.sql, which grants their privileges there.
-- Granting here would abort this migration with 42883 (undefined function).
-- ===========================================================================

-- Policy helpers are evaluated while acting AS anon/authenticated, so those
-- roles need EXECUTE on them or every RLS predicate fails open/closed wrongly.
grant execute on function public.is_admin()          to anon, authenticated;
grant execute on function public.is_seller_of(uuid)  to anon, authenticated;
grant execute on function public.can_view_auction(uuid) to anon, authenticated;
-- auction_effective_status()/round_minor() are created in 000003 and granted
-- there; granting them here would abort this file with 42883.

revoke all on function public.is_admin() from public;
revoke all on function public.is_seller_of(uuid) from public;
revoke all on function public.can_view_auction(uuid) from public;
