-- Run in a single DB session with the migrations applied. All fixtures roll back.
begin;
do $$
declare buyer uuid := gen_random_uuid(); seller uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  item uuid; thread uuid; offer uuid; hire uuid;
begin
  insert into auth.users(id,email) select id,id::text || '@example.invalid' from unnest(array[buyer,seller,outsider]) as id;
  insert into public.auctions(seller_id,title,description,condition,location,starting_bid_minor,bid_increment_minor,is_direct,listing_kind,status,listed_at)
    values(seller,'Chat test fixture','Transaction-only test fixture','good','Harare',1000,100,true,'SALE','LISTED',now()) returning id into item;
  insert into public.listing_conversations(listing_id,buyer_id,seller_id) values(item,buyer,seller) returning id into thread;
  insert into public.listing_offers(listing_id,conversation_id,buyer_id,seller_id,amount_minor)
    values(item,thread,buyer,seller,500) returning id into offer;
  insert into public.service_requests(listing_id,conversation_id,client_id,provider_id,details)
    values(item,thread,buyer,seller,'Test service request') returning id into hire;
  perform set_config('chat_test.buyer',buyer::text,true),set_config('chat_test.seller',seller::text,true),
    set_config('chat_test.outsider',outsider::text,true),set_config('chat_test.thread',thread::text,true),
    set_config('chat_test.offer',offer::text,true),set_config('chat_test.hire',hire::text,true);
end;
$$;
set local role authenticated;
do $$
declare buyer uuid := current_setting('chat_test.buyer')::uuid; seller uuid := current_setting('chat_test.seller')::uuid;
  thread uuid := current_setting('chat_test.thread')::uuid; found_error boolean;
begin
  perform set_config('request.jwt.claim.sub',buyer::text,true);
  perform public.send_listing_message(thread,'First message');
  perform set_config('request.jwt.claim.sub',seller::text,true);
  perform public.set_listing_chat_action(thread,'read');
  assert exists(select 1 from public.listing_messages where conversation_id=thread and read_at is not null);
  perform public.set_listing_chat_action(thread,'unread');
  perform public.set_listing_chat_action(thread,'mute');
  perform public.set_listing_chat_action(thread,'pin');
  perform public.set_listing_chat_action(thread,'archive');
  assert exists(select 1 from public.listing_chat_inbox(true) where id=thread and muted and pinned and manual_unread);
  perform set_config('request.jwt.claim.sub',buyer::text,true);
  assert exists(select 1 from public.listing_chat_inbox(false) where id=thread and not muted and not pinned);
  perform public.send_listing_message(thread,'After archive');
  perform set_config('request.jwt.claim.sub',seller::text,true);
  assert exists(select 1 from public.listing_chat_inbox(false) where id=thread and unread_count=1);
  assert not exists(select 1 from public.notifications where payload->>'listingChatId'=thread::text and read_at is null);
  perform public.set_listing_chat_action(thread,'delete');
  assert not exists(select 1 from public.listing_chat_inbox(false) where id=thread);
  assert not exists(select 1 from public.listing_messages where conversation_id=thread);
  perform set_config('request.jwt.claim.sub',buyer::text,true);
  assert (select count(*)=2 from public.listing_messages where conversation_id=thread);
  perform public.send_listing_message(thread,'After deletion');
  perform public.set_listing_chat_action(thread,'leave');
  perform set_config('request.jwt.claim.sub',seller::text,true);
  assert (select count(*)=1 from public.listing_messages where conversation_id=thread);
  assert exists(select 1 from public.listing_chat_inbox(false) where id=thread and left_by=buyer);
  found_error:=false;
  begin perform public.send_listing_message(thread,'Message while closed');
  exception when raise_exception then if sqlerrm <> 'chat_closed' then raise; end if; found_error:=true; end;
  assert found_error;
  found_error:=false;
  begin perform public.set_listing_chat_action(thread,'rejoin');
  exception when raise_exception then if sqlerrm <> 'cannot_rejoin' then raise; end if; found_error:=true; end;
  assert found_error;
  assert public.respond_listing_offer(current_setting('chat_test.offer')::uuid,true)='ACCEPTED';
  assert public.respond_service_hire(current_setting('chat_test.hire')::uuid,'ACCEPT')='ACCEPTED';
  perform set_config('request.jwt.claim.sub',current_setting('chat_test.outsider'),true);
  assert not exists(select 1 from public.listing_chat_inbox(false) where id=thread);
  found_error:=false;
  begin perform public.set_listing_chat_action(thread,'delete');
  exception when raise_exception then if sqlerrm <> 'conversation_unavailable' then raise; end if; found_error:=true; end;
  assert found_error;
  perform set_config('request.jwt.claim.sub',buyer::text,true);
  perform public.set_listing_chat_action(thread,'rejoin');
  perform public.send_listing_message(thread,'After rejoining');
  assert exists(select 1 from public.listing_chat_inbox(false) where id=thread and left_by is null and last_body='After rejoining');
end;
$$;
rollback;
