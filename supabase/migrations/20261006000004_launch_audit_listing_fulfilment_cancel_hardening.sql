-- BidBlitz launch audit follow-up:
-- 1) capture fulfilment terms as first-class listing data without inventing
--    values for historical listings;
-- 2) keep admin moderation power over other sellers' auctions, but prevent an
--    admin from bypassing bidder protection on their own auction.

alter table public.auctions
  add column if not exists fulfilment_method text,
  add column if not exists fulfilment_notes text;

alter table public.auctions
  drop constraint if exists auctions_fulfilment_method_check;

alter table public.auctions
  add constraint auctions_fulfilment_method_check
  check (
    fulfilment_method is null
    or fulfilment_method in ('COLLECTION','DELIVERY','BOTH')
  );

alter table public.auctions
  drop constraint if exists auctions_fulfilment_notes_check;

alter table public.auctions
  add constraint auctions_fulfilment_notes_check
  check (fulfilment_notes is null or char_length(fulfilment_notes) <= 500);


create or replace function public.set_auction_fulfilment(
  p_auction_id uuid,
  p_method text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_method not in ('COLLECTION','DELIVERY','BOTH') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  if p_notes is not null and char_length(p_notes) > 500 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  update public.auctions
     set fulfilment_method = p_method,
         fulfilment_notes = nullif(trim(coalesce(p_notes, '')), ''),
         updated_at = clock_timestamp()
   where id = p_auction_id
     and seller_id = v_uid
     and status = 'DRAFT';

  if not found then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  return jsonb_build_object('ok', true);
end;
$;

revoke all on function public.set_auction_fulfilment(uuid, text, text) from public, anon;
grant execute on function public.set_auction_fulfilment(uuid, text, text) to authenticated, service_role;

create or replace function public.auctions_require_fulfilment_before_publish()
returns trigger
language plpgsql
set search_path = ''
as $
begin
  if new.status in ('LIVE','SCHEDULED','PENDING_REVIEW')
     and old.status is distinct from new.status
     and new.fulfilment_method is null then
    raise exception 'fulfilment_required' using errcode = 'P0001';
  end if;
  return new;
end;
$;

drop trigger if exists auctions_require_fulfilment_before_publish on public.auctions;
create trigger auctions_require_fulfilment_before_publish
before update on public.auctions
for each row execute function public.auctions_require_fulfilment_before_publish();

create or replace function public.cancel_auction(
  p_auction_id  uuid,
  p_reason_code text default null,
  p_explanation text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  a         public.auctions%rowtype;
  v_uid     uuid := auth.uid();
  v_isadmin boolean := private.is_admin();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  select * into a from public.auctions where id = p_auction_id for update;
  if not found then raise exception 'auction_not_found' using errcode = 'P0002'; end if;

  if a.seller_id <> v_uid and not v_isadmin then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  -- Admin powers are for moderation, not for escaping the seller's commitment
  -- on the admin's own auction. Once anybody has bid, the seller path is the
  -- durable cancellation-request workflow and another admin must decide it.
  if a.bid_count > 0 and (not v_isadmin or a.seller_id = v_uid) then
    raise exception 'has_bids' using errcode = 'P0001';
  end if;

  if a.status in ('SOLD','UNSOLD','CANCELLED') then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  if a.status = 'PAUSED' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  if a.status <> 'DRAFT'
     and (p_reason_code is null
          or p_reason_code not in ('ITEM_UNAVAILABLE','ITEM_DAMAGED','LISTING_ERROR',
                                   'SELLER_WITHDRAWAL','TECHNICAL_PROBLEM','OTHER')) then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  if p_explanation is not null and char_length(p_explanation) > 1000 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  update public.auctions
     set status = 'CANCELLED', updated_at = clock_timestamp()
   where id = a.id;

  insert into public.auction_cancellations
    (auction_id, actor_id, actor_role, prev_status, reason_code, explanation)
  values
    (
      a.id,
      v_uid,
      case when v_isadmin and a.seller_id <> v_uid then 'admin' else 'seller' end,
      a.status,
      coalesce(p_reason_code, 'OTHER'),
      nullif(trim(coalesce(p_explanation, '')), '')
    );

  return jsonb_build_object(
    'ok', true,
    'status', 'CANCELLED',
    'previous_status', a.status
  );
end;
$$;

revoke all on function public.cancel_auction(uuid, text, text) from public, anon;
grant execute on function public.cancel_auction(uuid, text, text) to authenticated, service_role;
