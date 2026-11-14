alter table public.auctions
  add column is_direct boolean not null default false,
  add constraint auctions_direct_state_check check (
    case when is_direct then
      status in ('DRAFT', 'PENDING_REVIEW', 'LISTED', 'SOLD_DIRECT', 'CANCELLED')
      and (status not in ('LISTED', 'SOLD_DIRECT') or listed_at is not null)
      and starts_at is null and ends_at is null and bid_count = 0
      and current_bid_minor is null and current_bidder_id is null
      and winner_id is null and winning_bid_minor is null
    else status not in ('LISTED', 'SOLD_DIRECT') end
  );

create index auctions_direct_browse_idx on public.auctions (listed_at desc, id)
  where is_direct and status = 'LISTED' and archived_at is null;

create table public.listing_contacts (
  auction_id uuid primary key references public.auctions(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^[+]263[0-9]{9}$')
);

alter table public.listing_contacts enable row level security;
revoke all on public.listing_contacts from public, anon, authenticated;
grant select on public.listing_contacts to anon, authenticated;

-- Only the number explicitly supplied for this listing is ever public.
create policy listing_contacts_read on public.listing_contacts for select to anon, authenticated
using (
  exists (
    select 1 from public.auctions a
     where a.id = listing_contacts.auction_id and a.is_direct
       and (a.seller_id = (select auth.uid()) or
         (a.status = 'LISTED' and a.archived_at is null and exists (
           select 1 from public.profiles p where p.id = a.seller_id and not p.is_banned
         )))
  )
);

create policy auctions_direct_seller_visibility on public.auctions
  as restrictive for select to anon, authenticated using (
    not is_direct or seller_id = (select auth.uid()) or (select private.is_admin())
    or exists (select 1 from public.profiles p where p.id = seller_id and not p.is_banned)
  );

create function public.create_direct_listing(
  p_title text, p_description text, p_category_id smallint, p_condition text,
  p_location text, p_fulfilment_method text, p_fulfilment_notes text,
  p_price_minor bigint, p_phone text
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_seller uuid := auth.uid();
  v_id uuid;
begin
  if v_seller is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles p where p.id = v_seller and p.is_banned) then
    raise exception 'account_banned' using errcode = '42501';
  end if;
  -- Serialize only draft creation for this account, so parallel calls
  -- cannot all pass the same rolling limit before their inserts commit.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_seller::text, 113));
  if (select count(*) from public.auctions a
       where a.seller_id = v_seller and a.is_direct
         and a.created_at > clock_timestamp() - interval '1 minute') >= 6 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if p_price_minor is null or p_price_minor not between 100 and 999999999999999
     or p_category_id is null or p_fulfilment_method is null
     or char_length(btrim(coalesce(p_location, ''))) < 2 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  insert into public.auctions (
    seller_id, is_direct, title, description, category_id, condition, location,
    fulfilment_method, fulfilment_notes, starting_bid_minor, bid_increment_minor,
    anti_snipe_window_seconds, anti_snipe_extension_seconds
  ) values (
    v_seller, true, btrim(p_title), btrim(p_description), p_category_id, p_condition, btrim(p_location),
    p_fulfilment_method, p_fulfilment_notes, p_price_minor, 1, 0, 0
  ) returning id into v_id;

  insert into public.listing_contacts (auction_id, phone_e164) values (v_id, p_phone);
  return v_id;
end;
$$;

revoke all on function public.create_direct_listing(text,text,smallint,text,text,text,text,bigint,text)
  from public, anon, authenticated;
grant execute on function public.create_direct_listing(text,text,smallint,text,text,text,text,bigint,text)
  to authenticated;

-- Preserve the existing publish validation, risk screen and staff review.
-- PostgreSQL runs before-triggers of the same kind in name order.
create function private.apply_direct_listing_state() returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.status = 'SOLD_DIRECT' and old.status is distinct from new.status then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  if old.status in ('DRAFT', 'PENDING_REVIEW') and new.status in ('LIVE', 'SCHEDULED') then
    new.status := 'LISTED';
    new.starts_at := null;
    new.ends_at := null;
    new.listed_at := coalesce(old.listed_at, clock_timestamp());
  end if;
  if new.status in ('LISTED', 'PENDING_REVIEW') and old.status is distinct from new.status then
    if new.fulfilment_method is null then
      raise exception 'fulfilment_required' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.listing_contacts c where c.auction_id = new.id) then
      raise exception 'listing_contact_required' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger aa_apply_direct_listing_state before update of status on public.auctions
  for each row when (new.is_direct) execute function private.apply_direct_listing_state();

create or replace function private.auction_require_payout_ready()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not new.is_direct
     and new.status in ('PENDING_REVIEW','LIVE','SCHEDULED')
     and old.status is distinct from new.status
     and not exists (
       select 1 from public.seller_payout_recipients r where r.seller_id=new.seller_id
        and ((r.setup_status='READY' and r.external_user_id is not null
              and r.external_wallet_id is not null)
         or (r.setup_status='MANUAL_READY' and r.phone_e164 ~ '^[+]263[0-9]{9}$'))
     ) then
    raise exception 'payout_setup_required';
  end if;
  return new;
end;
$$;

-- A direct listing cannot get bids even through an old client or RPC.
create function private.reject_direct_listing_bid() returns trigger language plpgsql set search_path = ''
as $$
begin
  if exists (select 1 from public.auctions a where a.id = new.auction_id and a.is_direct) then
    raise exception 'auction_not_live' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger bids_reject_direct_listing before insert on public.bids
  for each row execute function private.reject_direct_listing_bid();

revoke execute on function private.apply_direct_listing_state() from public, anon, authenticated;
revoke execute on function private.reject_direct_listing_bid() from public, anon, authenticated;

create function public.close_direct_listing(p_auction_id uuid, p_sold boolean)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_seller uuid := auth.uid();
  v_listing public.auctions%rowtype;
  v_status public.auction_status_t;
begin
  if v_seller is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_sold is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  v_status := case when p_sold then 'SOLD_DIRECT'::public.auction_status_t
                  else 'CANCELLED'::public.auction_status_t end;

  select * into v_listing from public.auctions
   where id = p_auction_id and seller_id = v_seller and is_direct and archived_at is null
   for update;
  if not found then
    raise exception 'auction_not_found' using errcode = 'P0002';
  end if;
  if v_listing.status = v_status then
    return v_status::text;
  end if;
  if v_listing.status <> 'LISTED' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  update public.auctions set status = v_status where id = p_auction_id;
  return v_status::text;
end;
$$;

revoke all on function public.close_direct_listing(uuid,boolean) from public, anon, authenticated;
grant execute on function public.close_direct_listing(uuid,boolean) to authenticated;
