-- Run as the migration test role with BidBlitz's existing seller/buyer QA fixtures.
-- All messages, reputation changes, flags and decisions are rolled back together.
begin;
do $$
declare
  seller uuid := (select id from public.profiles where username='seller');
  buyer uuid := (select id from public.profiles where username='buyer1');
  stranger uuid := (select id from public.profiles where username='buyer2');
  staff uuid := (select id from public.profiles p where public.has_permission(p.id,'reports.resolve') and public.has_permission(p.id,'reports.view') limit 1);
  item uuid := (select id from public.auctions where seller_id=seller limit 1);
  thread uuid; message_id uuid; review_id uuid; report_id uuid; before_count integer;
begin
  if item is null or buyer is null or stranger is null or staff is null then raise exception 'missing QA fixtures'; end if;
  if has_function_privilege('anon','public.submit_chat_review(uuid,integer,text)','execute')
    or has_table_privilege('authenticated','private.report_evidence','select') then raise exception 'bad grants'; end if;
  -- Start from a controlled relationship inside this rollback-only transaction.
  delete from public.listing_conversations where buyer_id=buyer and seller_id=seller;
  delete from public.reviews where reviewer_id=buyer and reviewee_id=seller and transaction_id is null;
  select rating_count into before_count from public.profiles where id=seller;
  insert into public.listing_conversations(listing_id,buyer_id,seller_id) values(item,buyer,seller) returning id into thread;
  insert into public.listing_messages(conversation_id,sender_id,body) values(thread,buyer,'Fixture enquiry');
  perform set_config('request.jwt.claim.sub',buyer::text,true);
  if exists(select 1 from public.chat_review_context(seller)) then raise exception 'one-way chat eligible'; end if;
  begin
    perform public.submit_chat_review(seller,5,'');
    raise exception 'one-way rating succeeded';
  exception when raise_exception then if sqlerrm <> 'exchange_required' then raise; end if; end;
  insert into public.listing_messages(conversation_id,sender_id,body) values(thread,seller,'Fixture reply') returning id into message_id;
  perform public.submit_chat_review(seller,4,'');
  begin
    perform public.submit_chat_review(seller,1,'Duplicate');
    raise exception 'duplicate accepted';
  exception when unique_violation then null; end;
  select id into strict review_id from public.reviews where reviewer_id=buyer and reviewee_id=seller and transaction_id is null and rating=4 and comment is null;
  if (select rating_count from public.profiles where id=seller)<>before_count+1 then raise exception 'rating omitted'; end if;
  perform set_config('request.jwt.claim.sub',stranger::text,true);
  begin
    perform public.report_marketplace_content('message',message_id,'Fixture message');
    raise exception 'outsider reported a private message';
  exception when raise_exception then if sqlerrm <> 'invalid_target' then raise; end if; end;
  perform set_config('request.jwt.claim.sub',buyer::text,true);
  perform public.report_marketplace_content('message',message_id,'Fixture message');
  if exists(select 1 from public.marketplace_moderation_queue()) then raise exception 'nonstaff queue access'; end if;
  perform set_config('request.jwt.claim.sub',seller::text,true);
  perform public.report_marketplace_content('review',review_id,'Fixture review');
  select id into strict report_id from public.reports where target_type='review' and target_id=review_id;
  begin
    perform public.decide_marketplace_report(report_id,'hide');
    raise exception 'participant moderated their review';
  exception when raise_exception then if sqlerrm <> 'decision_refused' then raise; end if; end;
  perform set_config('request.jwt.claim.sub',staff::text,true);
  if not exists(select 1 from private.report_evidence e join public.reports r on r.id=e.report_id where r.target_id=message_id and e.excerpt='Fixture reply') then raise exception 'missing reported evidence'; end if;
  perform public.decide_marketplace_report(report_id,'hide');
  if (select hidden_at from public.reviews where id=review_id) is null
    or (select rating_count from public.profiles where id=seller)<>before_count then raise exception 'moderated rating still visible or counted'; end if;
end;
$$;
rollback;
