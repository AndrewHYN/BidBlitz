-- Contact-only changes preserve listing state and existing reveal privacy.
create or replace function public.update_listing_contact(
  p_listing_id uuid, p_phone text, p_expected_phone text
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_current text;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_phone is null or p_phone !~ '^[+][1-9][0-9]{6,14}$' then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;
  perform 1 from public.auctions a
    where a.id = p_listing_id and a.seller_id = v_user and a.is_direct
      and a.archived_at is null and a.status in ('DRAFT', 'LISTED')
      and exists (select 1 from public.profiles p where p.id = v_user and not p.is_banned)
    for update;
  if not found then
    raise exception 'listing_unavailable' using errcode = '42501';
  end if;
  select phone_e164 into v_current from public.listing_contacts
    where auction_id = p_listing_id for update;
  if not found then
    raise exception 'listing_unavailable' using errcode = '42501';
  end if;
  if v_current is distinct from p_expected_phone then
    raise exception 'contact_changed' using errcode = 'P0001';
  end if;
  update public.listing_contacts set phone_e164 = p_phone where auction_id = p_listing_id;
  return p_phone;
end;
$$;
revoke all on function public.update_listing_contact(uuid,text,text) from public, anon, authenticated;
grant execute on function public.update_listing_contact(uuid,text,text) to authenticated;
