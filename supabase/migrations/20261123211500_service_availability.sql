-- Service listings remain discoverable when the provider is temporarily unavailable.
-- Unlike a removed listing, availability can be reversed without losing reviews or history.
alter table public.auctions
  add column service_availability text not null default 'AVAILABLE'
  constraint auctions_service_availability_valid
    check (service_availability in ('AVAILABLE', 'BUSY', 'UNAVAILABLE'));

-- Only the provider may change availability. Status (LISTED) and other lifecycle
-- fields are left untouched; service enquiries and reviews retain their history.
create function public.set_service_availability(p_listing_id uuid, p_availability text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_state text := upper(btrim(coalesce(p_availability, '')));
begin
  if v_actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if v_state not in ('AVAILABLE', 'BUSY', 'UNAVAILABLE') then
    raise exception 'invalid_availability' using errcode = '22023';
  end if;

  update public.auctions
     set service_availability = v_state
   where id = p_listing_id
     and seller_id = v_actor
     and is_direct
     and listing_kind = 'SERVICE'
     and status = 'LISTED'
     and archived_at is null;

  if not found then
    raise exception 'listing_unavailable' using errcode = 'P0002';
  end if;
  return v_state;
end;
$$;
revoke all on function public.set_service_availability(uuid,text) from public,anon,authenticated;
grant execute on function public.set_service_availability(uuid,text) to authenticated;

-- Enforce availability at the database boundary as well as hiding the button
-- in the UI. This prevents direct RPC calls from booking unavailable providers.
create function private.require_available_service()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_state text;
begin
  select a.service_availability into v_state
    from public.auctions a
    where a.id = new.listing_id
      and a.listing_kind = 'SERVICE'
      and a.is_direct
      and a.status = 'LISTED'
      and a.archived_at is null
    for share;

  if v_state is null or v_state = 'UNAVAILABLE' then
    raise exception 'service_unavailable' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
create trigger require_available_service_before_request
  before insert on public.service_requests
  for each row execute function private.require_available_service();
revoke all on function private.require_available_service() from public,anon,authenticated;

comment on column public.auctions.service_availability is
  'Provider-controlled state for SERVICE listings. UNAVAILABLE keeps the listing public but blocks new service requests.';
