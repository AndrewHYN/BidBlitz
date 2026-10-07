-- Basic Business Seller foundation.
--
-- One owner may operate one business storefront. A draft may sell as that
-- business, but auction mechanics, fees, payout recipient and legal account
-- ownership remain attached to the same authenticated seller account.
--
-- This is NOT business verification, multi-user organisation management,
-- enterprise billing, branch inventory or catalog sync.

create table if not exists public.business_sellers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles(id) on delete restrict,
  slug text not null unique,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 80),
  description text check (description is null or char_length(description) <= 1200),
  location text check (location is null or char_length(location) <= 120),
  logo_path text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','SUSPENDED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_sellers_slug_chk
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint business_sellers_logo_path_chk
    check (
      logo_path is null
      or logo_path ~ '^[0-9a-f-]{36}/logo\.(jpg|jpeg|png|webp|gif)$'
    )
);

create index if not exists business_sellers_status_idx
  on public.business_sellers(status, created_at desc);

alter table public.auctions
  add column if not exists business_id uuid
    references public.business_sellers(id) on delete restrict;

create index if not exists auctions_business_status_idx
  on public.auctions(business_id, status, created_at desc)
  where business_id is not null;

alter table public.business_sellers enable row level security;

drop policy if exists business_sellers_public_read on public.business_sellers;
create policy business_sellers_public_read
on public.business_sellers for select
using (status='ACTIVE' or owner_id=(select auth.uid()) or private.is_admin());

revoke insert,update,delete on public.business_sellers from anon,authenticated;
grant select on public.business_sellers to anon,authenticated;
grant all on public.business_sellers to service_role;

-- Public business logo delivery, but no browser writes. The server action
-- validates bytes and derives the folder from the business row before upload.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'business-logos',
  'business-logos',
  true,
  2097152,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict(id) do update
set public=excluded.public,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists business_logos_public_read on storage.objects;
create policy business_logos_public_read
on storage.objects for select to public
using(bucket_id='business-logos');

-- No authenticated INSERT/UPDATE/DELETE policy is intentionally created.
-- Service-role server actions are the only writer.

create or replace function private.business_slug_base(p_name text)
returns text
language sql
immutable
set search_path=''
as $$
  select trim(both '-' from regexp_replace(
    lower(regexp_replace(coalesce(p_name,''),'[^a-zA-Z0-9]+','-','g')),
    '-+','-','g'
  ));
$$;

create or replace function private.upsert_my_business(
  p_display_name text,
  p_description text,
  p_location text
)
returns public.business_sellers
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.business_sellers%rowtype;
  v_base text;
  v_slug text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if char_length(btrim(coalesce(p_display_name,''))) not between 2 and 80 then
    raise exception 'invalid_business_name' using errcode='22023';
  end if;
  if char_length(coalesce(p_description,'')) > 1200 then
    raise exception 'invalid_business_description' using errcode='22023';
  end if;
  if char_length(coalesce(p_location,'')) > 120 then
    raise exception 'invalid_business_location' using errcode='22023';
  end if;

  select * into v_row
    from public.business_sellers
   where owner_id=v_uid
   for update;

  if found then
    update public.business_sellers
       set display_name=btrim(p_display_name),
           description=nullif(btrim(coalesce(p_description,'')),''),
           location=nullif(btrim(coalesce(p_location,'')),''),
           updated_at=clock_timestamp()
     where id=v_row.id
     returning * into v_row;
    return v_row;
  end if;

  v_base := private.business_slug_base(p_display_name);
  if char_length(v_base) < 2 then v_base := 'business'; end if;
  v_base := left(v_base,48);
  v_slug := v_base || '-' || left(replace(v_uid::text,'-',''),8);

  insert into public.business_sellers(
    owner_id,slug,display_name,description,location
  )
  values(
    v_uid,
    v_slug,
    btrim(p_display_name),
    nullif(btrim(coalesce(p_description,'')),''),
    nullif(btrim(coalesce(p_location,'')),'')
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.upsert_my_business(
  p_display_name text,
  p_description text default null,
  p_location text default null
)
returns public.business_sellers
language sql
security invoker
set search_path=''
as $$
  select private.upsert_my_business(p_display_name,p_description,p_location);
$$;

create or replace function private.set_auction_business_identity(
  p_auction_id uuid,
  p_business_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  a public.auctions%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode='42501'; end if;

  select * into a from public.auctions where id=p_auction_id for update;
  if not found then raise exception 'auction_not_found' using errcode='P0002'; end if;
  if a.seller_id <> v_uid then raise exception 'not_owner' using errcode='42501'; end if;
  if a.status <> 'DRAFT' then raise exception 'identity_locked' using errcode='P0001'; end if;

  if p_business_id is not null and not exists(
    select 1 from public.business_sellers b
    where b.id=p_business_id
      and b.owner_id=v_uid
      and b.status='ACTIVE'
  ) then
    raise exception 'business_not_owned' using errcode='42501';
  end if;

  update public.auctions
     set business_id=p_business_id,
         updated_at=clock_timestamp()
   where id=a.id;

  return jsonb_build_object(
    'ok',true,
    'auction_id',a.id,
    'business_id',p_business_id
  );
end;
$$;

create or replace function public.set_auction_business_identity(
  p_auction_id uuid,
  p_business_id uuid default null
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.set_auction_business_identity(p_auction_id,p_business_id);
$$;

revoke all on function private.business_slug_base(text) from public,anon;
revoke all on function private.upsert_my_business(text,text,text) from public,anon;
revoke all on function private.set_auction_business_identity(uuid,uuid) from public,anon;

grant execute on function private.business_slug_base(text) to authenticated,service_role;
grant execute on function private.upsert_my_business(text,text,text) to authenticated,service_role;
grant execute on function private.set_auction_business_identity(uuid,uuid) to authenticated,service_role;

revoke all on function public.upsert_my_business(text,text,text) from public,anon;
revoke all on function public.set_auction_business_identity(uuid,uuid) from public,anon;

grant execute on function public.upsert_my_business(text,text,text)
  to authenticated,service_role;
grant execute on function public.set_auction_business_identity(uuid,uuid)
  to authenticated,service_role;
