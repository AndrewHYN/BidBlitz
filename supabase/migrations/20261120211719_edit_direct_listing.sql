create function public.edit_direct_listing(
  p_auction_id uuid, p_title text, p_description text, p_price_minor bigint, p_expected_updated_at timestamptz
) returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_seller uuid := auth.uid();
  v_listing public.auctions%rowtype;
  v_review boolean;
begin
  if v_seller is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 120
     or char_length(btrim(coalesce(p_description, ''))) not between 10 and 5000
     or p_price_minor is null or p_price_minor not between 100 and 999999999999999 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select * into v_listing from public.auctions
   where id = p_auction_id and seller_id = v_seller and is_direct and archived_at is null
   for update;
  if not found then
    raise exception 'auction_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.profiles where id = v_seller and is_banned) then
    raise exception 'account_banned' using errcode = '42501';
  end if;
  if v_listing.status not in ('DRAFT', 'LISTED') then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  if v_listing.updated_at is distinct from p_expected_updated_at then
    raise exception 'listing_changed' using errcode = 'P0001';
  end if;
  if v_listing.status = 'LISTED' and v_listing.title = btrim(p_title)
     and v_listing.description = btrim(p_description)
     and v_listing.starting_bid_minor = p_price_minor then
    return 'LISTED';
  end if;

  v_review := v_listing.listed_at is not null
    and not exists (
      select 1 from public.listing_reviews
      where auction_id = p_auction_id and status = 'APPROVED'
        and risk_flags @> '{"listing_edit":true}'
    );
  if v_review and v_listing.image_count < 1 then
    raise exception 'image_required' using errcode = 'P0001';
  end if;

  update public.auctions
     set title = btrim(p_title), description = btrim(p_description),
         starting_bid_minor = p_price_minor,
         status = case when v_review then 'PENDING_REVIEW'::public.auction_status_t else v_listing.status end
   where id = p_auction_id;
  if v_review then
    insert into public.listing_reviews (auction_id, status, risk_flags)
    values (p_auction_id, 'PENDING', '{"listing_edit":true}');
    insert into public.notifications (user_id, type, auction_id, payload)
    values (v_seller, 'REVIEW_SUBMITTED', p_auction_id, jsonb_build_object('title', btrim(p_title)));
    return 'PENDING_REVIEW';
  end if;
  return v_listing.status::text;
end;
$$;

revoke all on function public.edit_direct_listing(uuid,text,text,bigint,timestamptz) from public, anon, authenticated;
grant execute on function public.edit_direct_listing(uuid,text,text,bigint,timestamptz) to authenticated;

-- A withdrawn or returned edit goes back to Draft. Its seller must resubmit
-- through the edit action instead of publishing unreviewed changes.
create function private.require_direct_edit_review() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if exists (
    select 1 from public.listing_reviews
    where auction_id = old.id and risk_flags @> '{"listing_edit":true}'
  ) and not exists (
    select 1 from public.listing_reviews
    where auction_id = old.id and status = 'APPROVED' and risk_flags @> '{"listing_edit":true}'
  ) then
    raise exception 'direct_edit_review_required' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- This runs after the existing aa_apply_direct_listing_state trigger
-- converts an auction publish to LISTED.
create trigger ab_require_direct_edit_review before update of status on public.auctions
for each row when (new.is_direct and old.status = 'DRAFT' and new.status in ('LISTED','LIVE','SCHEDULED'))
execute function private.require_direct_edit_review();

revoke execute on function private.require_direct_edit_review() from public, anon, authenticated;
