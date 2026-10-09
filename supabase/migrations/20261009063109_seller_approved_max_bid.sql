-- Max Bid is a binding bid plus a private offer for seller-approved early close.
-- No payment/payout is initiated here. Settlement uses the existing fee engine.
create table public.max_bid_offers (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions(id) on delete cascade,
  bid_id uuid not null unique references public.bids(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id),
  seller_id uuid not null references public.profiles(id),
  amount_minor bigint not null check (amount_minor between 100 and 1000000000000),
  currency text not null check (currency='USD'),
  request_id uuid not null,
  status text not null default 'PENDING' check (status in ('PENDING','ACCEPTED','DECLINED','EXPIRED')),
  created_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz,
  transaction_id uuid references public.transactions(id),
  unique (buyer_id,request_id),
  check (buyer_id<>seller_id)
);
create index max_bid_offers_seller_pending_idx on public.max_bid_offers(seller_id,created_at desc) where status='PENDING';
create index max_bid_offers_auction_idx on public.max_bid_offers(auction_id,created_at desc);
alter table public.max_bid_offers enable row level security;
revoke all on public.max_bid_offers from anon,authenticated;
grant select on public.max_bid_offers to authenticated;
grant all on public.max_bid_offers to service_role;
create policy max_bid_offers_participants on public.max_bid_offers for select to authenticated
  using (buyer_id=(select auth.uid()) or seller_id=(select auth.uid()));

create function public.submit_max_bid(p_auction_id uuid,p_amount_minor bigint,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid:=auth.uid(); a public.auctions%rowtype;
  o public.max_bid_offers%rowtype; b public.bids%rowtype; v_result jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_request_id is null then raise exception 'invalid_request_id'; end if;
  if p_amount_minor is null or p_amount_minor<100 or p_amount_minor>1000000000000 then raise exception 'invalid_amount'; end if;
  select * into a from public.auctions where id=p_auction_id for update;
  if not found then raise exception 'auction_not_found'; end if;
  if a.seller_id=v_uid then raise exception 'seller_cannot_bid' using errcode='42501'; end if;
  if exists(select 1 from public.profiles where id=v_uid and is_banned) then raise exception 'account_banned'; end if;
  select * into o from public.max_bid_offers where buyer_id=v_uid and request_id=p_request_id;
  if found then
    if o.auction_id<>p_auction_id or o.amount_minor<>p_amount_minor then raise exception 'invalid_request_id'; end if;
    return jsonb_build_object('ok',true,'duplicate',true,'offer_id',o.id,'status',o.status);
  end if;
  -- Never reinterpret an ordinary bid or a different auction's idempotency key.
  if exists(select 1 from public.bids where bidder_id=v_uid and request_id=p_request_id) then raise exception 'invalid_request_id'; end if;
  if a.status<>'LIVE' or a.ends_at is null or a.ends_at<=clock_timestamp() then raise exception 'auction_not_live'; end if;
  if a.currency<>'USD' then raise exception 'invalid_amount'; end if;
  v_result:=public.place_bid(p_auction_id,p_amount_minor,p_request_id);
  if not coalesce((v_result->>'ok')::boolean,false) then return v_result; end if;
  select * into strict b from public.bids where id=(v_result->>'bid_id')::uuid;
  insert into public.max_bid_offers(auction_id,bid_id,buyer_id,seller_id,amount_minor,currency,request_id)
  values(a.id,b.id,v_uid,a.seller_id,b.amount_minor,b.currency,p_request_id) returning * into o;
  update public.notifications set payload=payload||jsonb_build_object('max_bid',true,'offer_id',o.id)
  where id=(select id from public.notifications where user_id=a.seller_id and auction_id=a.id and type='NEW_BID'
    and payload->>'bid_count'=v_result->>'bid_count' order by created_at desc limit 1);
  return v_result||jsonb_build_object('offer_id',o.id,'offer_status','PENDING');
end $$;
revoke all on function public.submit_max_bid(uuid,bigint,uuid) from public,anon;
grant execute on function public.submit_max_bid(uuid,bigint,uuid) to authenticated;

create function public.decide_max_bid(p_offer_id uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid:=auth.uid(); v_auction_id uuid; a public.auctions%rowtype;
  o public.max_bid_offers%rowtype; v_result jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_accept is null then raise exception 'invalid_input'; end if;
  select auction_id into v_auction_id from public.max_bid_offers where id=p_offer_id and seller_id=v_uid;
  if not found then raise exception 'offer_unavailable' using errcode='42501'; end if;
  -- Same lock order as bids, settlement and submission: auction, then offer.
  select * into strict a from public.auctions where id=v_auction_id for update;
  select * into strict o from public.max_bid_offers where id=p_offer_id for update;
  if a.seller_id<>v_uid or o.seller_id<>v_uid then raise exception 'not_owner' using errcode='42501'; end if;
  if exists(select 1 from public.profiles where id=v_uid and is_banned) then raise exception 'account_banned'; end if;
  if o.status='ACCEPTED' and p_accept then
    return jsonb_build_object('ok',true,'already',true,'status','SOLD','transaction_id',o.transaction_id,'auction_id',a.id,'winner_id',a.winner_id,'winning_bid_minor',a.winning_bid_minor);
  end if;
  if o.status='DECLINED' and not p_accept then return jsonb_build_object('ok',true,'already',true,'status','DECLINED'); end if;
  if o.status<>'PENDING' then raise exception 'offer_unavailable'; end if;
  if not p_accept then
    update public.max_bid_offers set status='DECLINED',decided_at=clock_timestamp() where id=o.id;
    return jsonb_build_object('ok',true,'status','DECLINED');
  end if;
  if a.status<>'LIVE' or a.ends_at is null or a.ends_at<=clock_timestamp() then raise exception 'auction_not_live'; end if;
  if a.current_bidder_id is distinct from o.buyer_id or a.current_bid_minor is distinct from o.amount_minor then raise exception 'offer_outbid'; end if;
  if exists(select 1 from public.profiles where id=o.buyer_id and is_banned) then raise exception 'account_banned'; end if;
  if not exists(select 1 from public.seller_payout_recipients where seller_id=v_uid and setup_status='READY'
    and external_user_id is not null and external_wallet_id is not null) then raise exception 'payout_setup_required'; end if;
  update public.auctions set ends_at=clock_timestamp() where id=a.id;
  v_result:=public.settle_auction(a.id);
  if not coalesce((v_result->>'ok')::boolean,false) or v_result->>'status'<>'SOLD'
    or (v_result->>'winner_id')::uuid<>o.buyer_id then raise exception 'early_settlement_failed'; end if;
  update public.max_bid_offers set status='ACCEPTED',decided_at=clock_timestamp(),transaction_id=(v_result->>'transaction_id')::uuid where id=o.id;
  update public.max_bid_offers set status='EXPIRED',decided_at=clock_timestamp() where auction_id=a.id and id<>o.id and status='PENDING';
  return v_result||jsonb_build_object('auction_id',a.id);
end $$;
revoke all on function public.decide_max_bid(uuid,boolean) from public,anon;
grant execute on function public.decide_max_bid(uuid,boolean) to authenticated;
