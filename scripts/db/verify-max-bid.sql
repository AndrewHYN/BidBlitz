-- Transaction-only regression proof. Every fixture and side effect is rolled back.
begin;
do $$
declare
  ids uuid[]; seller uuid; buyer uuid; other_buyer uuid;
  auction uuid:=gen_random_uuid(); request uuid:=gen_random_uuid(); offer uuid;
  result jsonb; repeated jsonb; rejected boolean;
begin
  select array_agg(id) into ids from (select id from public.profiles where not is_banned order by created_at limit 3) p;
  if cardinality(ids)<3 then raise exception 'verification needs three existing profiles'; end if;
  seller:=ids[1]; buyer:=ids[2]; other_buyer:=ids[3];
  insert into public.seller_payout_recipients(seller_id,provider,external_user_id,external_wallet_id,setup_status)
  values(seller,'linkwa','rollback-verification-user','rollback-verification-wallet','READY')
  on conflict(seller_id) do update set external_user_id=excluded.external_user_id,external_wallet_id=excluded.external_wallet_id,setup_status='READY';
  insert into public.auctions(id,seller_id,title,description,condition,location,starting_bid_minor,bid_increment_minor,status,starts_at,ends_at)
  values(auction,seller,'Rollback Max Bid verification','Transaction-only regression auction','good','Harare',100,100,'LIVE',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day');
  perform set_config('request.jwt.claim.sub',seller::text,true);
  rejected:=false;
  begin perform public.submit_max_bid(auction,1000,gen_random_uuid()); exception when others then
    if sqlerrm<>'seller_cannot_bid' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'seller self bid accepted'; end if;
  perform set_config('request.jwt.claim.sub',buyer::text,true);
  result:=public.submit_max_bid(auction,1000,request);
  if result->>'ok'<>'true' then raise exception 'max bid failed: %',result; end if;
  offer:=(result->>'offer_id')::uuid;
  repeated:=public.submit_max_bid(auction,1000,request);
  if repeated->>'offer_id'<>offer::text or repeated->>'duplicate'<>'true' then raise exception 'submission replay failed'; end if;
  if (select count(*) from public.bids where auction_id=auction)<>1 then raise exception 'submission duplicated bid'; end if;
  rejected:=false;
  begin perform public.decide_max_bid(offer,true); exception when others then
    if sqlerrm<>'offer_unavailable' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'buyer accepted own offer'; end if;
  perform set_config('request.jwt.claim.sub',other_buyer::text,true);
  perform public.place_bid(auction,1100,gen_random_uuid());
  perform set_config('request.jwt.claim.sub',seller::text,true);
  rejected:=false;
  begin perform public.decide_max_bid(offer,true); exception when others then
    if sqlerrm<>'offer_outbid' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'outbid offer accepted'; end if;
  perform public.decide_max_bid(offer,false);
  if (select current_bid_minor from public.auctions where id=auction)<>1100 then raise exception 'decline changed binding bid'; end if;
  perform set_config('request.jwt.claim.sub',buyer::text,true);
  result:=public.submit_max_bid(auction,1200,gen_random_uuid());
  offer:=(result->>'offer_id')::uuid;
  perform set_config('request.jwt.claim.sub',seller::text,true);
  update public.seller_payout_recipients set setup_status='ERROR' where seller_id=seller;
  rejected:=false;
  begin perform public.decide_max_bid(offer,true); exception when others then
    if sqlerrm<>'payout_setup_required' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'unready wallet accepted'; end if;
  update public.seller_payout_recipients set setup_status='READY' where seller_id=seller;
  update public.auctions set status='PAUSED',paused_at=clock_timestamp() where id=auction;
  rejected:=false;
  begin perform public.decide_max_bid(offer,true); exception when others then
    if sqlerrm<>'auction_not_live' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'paused auction accepted'; end if;
  update public.auctions set status='LIVE',paused_at=null where id=auction;
  result:=public.decide_max_bid(offer,true);
  if result->>'status'<>'SOLD' or result->>'winner_id'<>buyer::text then raise exception 'early settlement failed'; end if;
  repeated:=public.decide_max_bid(offer,true);
  if repeated->>'transaction_id'<>result->>'transaction_id' then raise exception 'acceptance replay changed transaction'; end if;
  if (select count(*) from public.transactions where auction_id=auction)<>1 then raise exception 'duplicated sale'; end if;
  if not exists(select 1 from public.transactions where auction_id=auction and status='AWAITING_PAYMENT' and gross_minor=1200 and fee_bps=500 and fee_minor=60 and net_minor=1140) then raise exception 'payment or 5/95 accounting incorrect'; end if;
  if exists(select 1 from public.seller_payouts p join public.transactions t on t.id=p.transaction_id where t.auction_id=auction and p.status='PAID_OUT') then raise exception 'acceptance paid seller prematurely'; end if;
  if has_table_privilege('authenticated','public.max_bid_offers','INSERT') or has_table_privilege('authenticated','public.max_bid_offers','UPDATE') then raise exception 'client can bypass offer engine'; end if;
  if has_function_privilege('anon','public.submit_max_bid(uuid,bigint,uuid)','EXECUTE') or has_function_privilege('anon','public.decide_max_bid(uuid,boolean)','EXECUTE') then raise exception 'anonymous engine access'; end if;
  perform set_config('request.jwt.claim.sub',other_buyer::text,true);
  set local role authenticated;
  if exists(select 1 from public.max_bid_offers where auction_id=auction) then raise exception 'private offer visible to unrelated bidder'; end if;
  reset role;
  if (select ends_at>clock_timestamp() from public.auctions where id=auction) then raise exception 'timer still running'; end if;
end $$;
select 'PASS: self-bid, replay, unauthorized acceptance, outbid refusal, private RLS, unready wallet, paused refusal, binding decline, early close, one awaiting-payment sale, 5%/95%, no premature payout' as verification;
rollback;
