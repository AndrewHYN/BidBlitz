-- A seller may reserve an item for ONE conversation while handover is arranged.
-- This is not a payment, escrow transaction, purchase confirmation, or public buyer identity.
create table public.listing_pickup_reservations (
  listing_id uuid primary key references public.auctions(id) on delete cascade,
  conversation_id uuid not null references public.listing_conversations(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  constraint pickup_participants_distinct check (buyer_id <> seller_id)
);

create index listing_pickup_reservations_conversation_idx
  on public.listing_pickup_reservations(conversation_id);
alter table public.listing_pickup_reservations enable row level security;
revoke all on public.listing_pickup_reservations from public, anon, authenticated;
grant select on public.listing_pickup_reservations to authenticated;
create policy "pickup reservation visible to participants"
  on public.listing_pickup_reservations for select to authenticated
  using ((select auth.uid()) in (seller_id, buyer_id));

-- Notifications reuse the existing private, RLS-scoped inbox and its Realtime
-- channel. The event subtype is explicit so these do NOT say "New enquiry".
-- No client may write notifications or reservation rows directly.
create function public.set_listing_pickup(p_listing_id uuid, p_conversation_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_seller uuid;
  v_title text;
  v_current public.listing_pickup_reservations%rowtype;
  v_chat public.listing_conversations%rowtype;
begin
  if v_actor is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  -- Lock the listing first so reservations and closing a sale cannot race.
  select seller_id, title into v_seller, v_title from public.auctions
    where id=p_listing_id and seller_id=v_actor and is_direct
      and listing_kind='SALE' and status='LISTED' and archived_at is null
    for update;
  if not found then raise exception 'listing_unavailable' using errcode='P0002'; end if;

  select * into v_current from public.listing_pickup_reservations
    where listing_id=p_listing_id for update;

  if p_conversation_id is null then
    if v_current.listing_id is not null then
      delete from public.listing_pickup_reservations where listing_id=p_listing_id;
      if not exists (
        select 1 from public.listing_chat_preferences
        where conversation_id=v_current.conversation_id and user_id=v_current.buyer_id and muted
      ) then
        insert into public.notifications(user_id,type,auction_id,payload)
          values(v_current.buyer_id,'NEW_MESSAGE',p_listing_id,
            pg_catalog.jsonb_build_object('listingChatId',v_current.conversation_id,
              'title',v_title,'event','pickup_cancelled'));
      end if;
    end if;
    return 'AVAILABLE';
  end if;

  select * into v_chat from public.listing_conversations
    where id=p_conversation_id and listing_id=p_listing_id and seller_id=v_actor
      and buyer_id<>v_actor and left_by is null;
  if not found then raise exception 'conversation_unavailable' using errcode='P0002'; end if;
  if v_current.conversation_id=p_conversation_id then return 'PENDING'; end if;
  if v_current.listing_id is not null then raise exception 'already_reserved' using errcode='P0001'; end if;

  insert into public.listing_pickup_reservations(listing_id,conversation_id,seller_id,buyer_id)
    values(p_listing_id,v_chat.id,v_actor,v_chat.buyer_id);
  if not exists (
    select 1 from public.listing_chat_preferences
    where conversation_id=v_chat.id and user_id=v_chat.buyer_id and muted
  ) then
    insert into public.notifications(user_id,type,auction_id,payload)
      values(v_chat.buyer_id,'NEW_MESSAGE',p_listing_id,
        pg_catalog.jsonb_build_object('listingChatId',v_chat.id,
          'title',v_title,'event','pickup_pending'));
  end if;
  return 'PENDING';
end;
$$;
revoke all on function public.set_listing_pickup(uuid,uuid) from public,anon;
grant execute on function public.set_listing_pickup(uuid,uuid) to authenticated;

-- Preserve existing seller-only close semantics and idempotence. On SOLD,
-- inform ALL distinct interested buyers that the listing is no longer available.
-- We do NOT tell any buyer that they purchased it, or claim that payment moved.
create or replace function public.close_direct_listing(p_auction_id uuid, p_sold boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_seller uuid := auth.uid();
  v_listing public.auctions%rowtype;
  v_status public.auction_status_t;
begin
  if v_seller is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_sold is null then raise exception 'invalid_input' using errcode='22023'; end if;
  v_status := case when p_sold then 'SOLD_DIRECT'::public.auction_status_t
                   else 'CANCELLED'::public.auction_status_t end;

  select * into v_listing from public.auctions
    where id=p_auction_id and seller_id=v_seller and is_direct and archived_at is null
    for update;
  if not found then raise exception 'auction_not_found' using errcode='P0002'; end if;
  if v_listing.status=v_status then return v_status::text; end if;
  if v_listing.status<>'LISTED' then raise exception 'invalid_state' using errcode='P0001'; end if;

  update public.auctions set status=v_status where id=p_auction_id;
  if p_sold and v_listing.listing_kind='SALE' then
    insert into public.notifications(user_id,type,auction_id,payload)
      select distinct on (c.buyer_id)
        c.buyer_id,'NEW_MESSAGE',p_auction_id,
        pg_catalog.jsonb_build_object('listingChatId',c.id,
          'title',v_listing.title,'event','listing_sold')
      from public.listing_conversations c
      left join public.listing_chat_preferences pref
        on pref.conversation_id=c.id and pref.user_id=c.buyer_id
      where c.listing_id=p_auction_id and c.seller_id=v_seller
        and not coalesce(pref.muted,false)
      order by c.buyer_id,c.last_message_at desc;
  end if;
  -- No stale "pending pickup" state survives removal or sale.
  delete from public.listing_pickup_reservations where listing_id=p_auction_id;
  return v_status::text;
end;
$$;
revoke all on function public.close_direct_listing(uuid,boolean) from public,anon;
grant execute on function public.close_direct_listing(uuid,boolean) to authenticated;
