-- P0-05: seller numbers must never be selectable by anonymous visitors.
-- Publication consent does not imply putting the number in public HTML.
revoke select on public.listing_contacts from anon;
drop policy if exists listing_contacts_read on public.listing_contacts;
create policy listing_contacts_owner_read on public.listing_contacts
  for select to authenticated
  using (
    exists (
      select 1 from public.auctions a
       where a.id = listing_contacts.auction_id
         and (a.seller_id = (select auth.uid()) or private.is_admin())
    )
  );

create table if not exists public.listing_contact_reveals (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.auctions(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  revealed_at timestamptz not null default now()
);
create index if not exists listing_contact_reveals_rate_idx
  on public.listing_contact_reveals (viewer_id, revealed_at desc);
alter table public.listing_contact_reveals enable row level security;
revoke all on public.listing_contact_reveals from public, anon, authenticated;
grant select on public.listing_contact_reveals to authenticated;
create policy listing_contact_reveals_admin_read on public.listing_contact_reveals
  for select to authenticated using (private.is_admin());

-- Authenticated users can request a limited number of contact reveals.
-- The function owns authorization, rate enforcement and the audit insertion
-- in one transaction. Do not expose a service-role client to the browser.
create or replace function public.reveal_listing_contact(p_listing_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := (select auth.uid());
  v_phone text;
  v_created_at timestamptz;
  v_hourly_count integer;
  v_hourly_limit integer;
begin
  if v_viewer is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles p where p.id = v_viewer and p.is_banned) then
    raise exception 'account_banned' using errcode = '42501';
  end if;

  select c.phone_e164 into v_phone
    from public.listing_contacts c
    join public.auctions a on a.id = c.auction_id
    join public.profiles seller on seller.id = a.seller_id
   where a.id = p_listing_id
     and a.is_direct
     and a.status = 'LISTED'::public.auction_status_t
     and a.archived_at is null
     and a.seller_id <> v_viewer
     and not seller.is_banned;
  if v_phone is null then
    raise exception 'listing_unavailable' using errcode = '42501';
  end if;

  -- Lock by viewer to stop concurrent reveals exceeding the hourly budget.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_viewer::text, 0));
  select created_at into v_created_at from auth.users where id = v_viewer;
  v_hourly_limit := case when v_created_at > now() - interval '48 hours' then 5 else 20 end;

  select count(*) into v_hourly_count
    from public.listing_contact_reveals
   where viewer_id = v_viewer and revealed_at >= now() - interval '1 hour';
  if v_hourly_count >= v_hourly_limit then
    raise exception 'rate_limited' using errcode = '42501';
  end if;

  insert into public.listing_contact_reveals (listing_id, viewer_id)
  values (p_listing_id, v_viewer);
  return v_phone;
end;
$$;
revoke all on function public.reveal_listing_contact(uuid) from public, anon, authenticated;
grant execute on function public.reveal_listing_contact(uuid) to authenticated;
