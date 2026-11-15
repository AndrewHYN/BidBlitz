-- Split three listing experiences without changing historical auctions or payments.
alter table public.auctions add column listing_kind text;
update public.auctions set listing_kind = case when is_direct then 'SALE' else 'AUCTION' end;
alter table public.auctions alter column listing_kind set default 'AUCTION';
alter table public.auctions alter column listing_kind set not null;
alter table public.auctions add constraint auction_listing_kind_valid
  check ((is_direct and listing_kind in ('SALE','SERVICE')) or (not is_direct and listing_kind='AUCTION'));

create function private.set_new_listing_kind()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.is_direct then new.listing_kind := 'SALE';
  else new.listing_kind := 'AUCTION';
  end if;
  return new;
end;
$$;
create trigger aa_set_new_listing_kind before insert on public.auctions
  for each row execute function private.set_new_listing_kind();
revoke execute on function private.set_new_listing_kind() from public,anon,authenticated;

-- Preserve the existing, audited direct listing creation path and its phone consent.
create function public.create_service_listing(
  p_title text, p_description text, p_category_id smallint, p_condition text,
  p_location text, p_fulfilment_method text, p_fulfilment_notes text,
  p_price_minor bigint, p_phone text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  v_id := public.create_direct_listing(p_title,p_description,p_category_id,
     p_condition,p_location,p_fulfilment_method,p_fulfilment_notes,p_price_minor,p_phone);
  update public.auctions set listing_kind='SERVICE'
    where id=v_id and seller_id=auth.uid() and is_direct and status='DRAFT';
  if not found then raise exception 'listing_unavailable' using errcode='P0002'; end if;
  return v_id;
end;
$$;
revoke all on function public.create_service_listing(text,text,smallint,text,text,text,text,bigint,text)
  from public,anon,authenticated;
grant execute on function public.create_service_listing(text,text,smallint,text,text,text,text,bigint,text)
  to authenticated;

-- Offers are negotiations, never orders or charges. The buyer and seller arrange payment separately.
create table public.listing_offers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.auctions(id) on delete cascade,
  conversation_id uuid not null references public.listing_conversations(id) on delete cascade,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  amount_minor bigint not null check (amount_minor between 100 and 999999999999999),
  status text not null default 'PENDING' check (status in ('PENDING','ACCEPTED','DECLINED')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create index listing_offers_conversation_recent on public.listing_offers(conversation_id,created_at desc);
create unique index listing_offers_one_accepted_per_listing on public.listing_offers(listing_id) where status='ACCEPTED';
alter table public.listing_offers enable row level security;
revoke all on public.listing_offers from public,anon,authenticated;
grant select on public.listing_offers to authenticated;
create policy "offer participants read" on public.listing_offers for select to authenticated
  using ((select auth.uid()) in (buyer_id,seller_id));

create function public.make_listing_offer(p_listing_id uuid,p_amount_minor bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_buyer uuid := auth.uid(); v_seller uuid; v_thread uuid; v_id uuid;
begin
  if v_buyer is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_amount_minor is null or p_amount_minor not between 100 and 999999999999999 then
    raise exception 'invalid_amount' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_buyer::text,64012));
  select seller_id into v_seller from public.auctions
     where id=p_listing_id and is_direct and listing_kind='SALE' and status='LISTED' and archived_at is null;
  if v_seller is null or v_seller=v_buyer then raise exception 'listing_unavailable' using errcode='P0002'; end if;
  if (select count(*) from public.listing_offers where buyer_id=v_buyer and created_at > now()-interval '1 hour') >= 12 then
    raise exception 'rate_limited' using errcode='P0001';
  end if;
  v_thread := public.start_listing_conversation(p_listing_id,
       'I would like to offer US$' || pg_catalog.to_char(p_amount_minor::numeric / 100,'FM9999999999990.00') || ' for this item.');
  insert into public.listing_offers(listing_id,conversation_id,buyer_id,seller_id,amount_minor)
    values(p_listing_id,v_thread,v_buyer,v_seller,p_amount_minor) returning id into v_id;
  return v_id;
end;
$$;

create function public.respond_listing_offer(p_offer_id uuid,p_accept boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare v_seller uuid := auth.uid(); v_offer public.listing_offers%rowtype; v_status text;
begin
  if v_seller is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_accept is null then raise exception 'invalid_input' using errcode='22023'; end if;
  select * into v_offer from public.listing_offers where id=p_offer_id for update;
  if not found or v_offer.seller_id<>v_seller then
    raise exception 'offer_unavailable' using errcode='P0002';
  end if;
  if v_offer.status<>'PENDING' then raise exception 'offer_already_decided' using errcode='P0001'; end if;
  if not exists(select 1 from public.auctions a where a.id=v_offer.listing_id and a.status='LISTED')
    then raise exception 'listing_unavailable' using errcode='P0002'; end if;
  v_status := case when p_accept then 'ACCEPTED' else 'DECLINED' end;
  update public.listing_offers set status=v_status,responded_at=now() where id=p_offer_id;
  insert into public.listing_messages(conversation_id,sender_id,body)
    values(v_offer.conversation_id,v_seller,case when p_accept then 'I accepted your offer. Let us arrange collection and payment.' else 'I declined this offer. You can still message me.' end);
  update public.listing_conversations set last_message_at=now() where id=v_offer.conversation_id;
  return v_status;
end;
$$;
revoke all on function public.make_listing_offer(uuid,bigint) from public,anon,authenticated;
revoke all on function public.respond_listing_offer(uuid,boolean) from public,anon,authenticated;
grant execute on function public.make_listing_offer(uuid,bigint) to authenticated;
grant execute on function public.respond_listing_offer(uuid,boolean) to authenticated;

-- Service hiring is direct, manual and auditable. No payment processing.
create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.auctions(id) on delete cascade,
  conversation_id uuid not null references public.listing_conversations(id) on delete cascade,
  client_id uuid not null references auth.users(id) on delete cascade,
  provider_id uuid not null references auth.users(id) on delete cascade,
  details text not null check(char_length(btrim(details)) between 10 and 2000),
  status text not null default 'REQUESTED'
    check(status in ('REQUESTED','ACCEPTED','DECLINED','DELIVERED','COMPLETED','CANCELLED')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index service_requests_conversation_recent on public.service_requests(conversation_id,created_at desc);
alter table public.service_requests enable row level security;
revoke all on public.service_requests from public,anon,authenticated;
grant select on public.service_requests to authenticated;
create policy "service request parties read" on public.service_requests
  for select to authenticated using ((select auth.uid()) in (client_id,provider_id));

create table public.service_reviews (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.service_requests(id) on delete cascade,
  listing_id uuid not null references public.auctions(id) on delete cascade,
  provider_id uuid not null references auth.users(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (char_length(comment)<=1000),
  created_at timestamptz not null default now()
);
create index service_reviews_listing_recent on public.service_reviews(listing_id,created_at desc);
alter table public.service_reviews enable row level security;
revoke all on public.service_reviews from public,anon,authenticated;
grant select on public.service_reviews to anon,authenticated;
create policy "public completed-service reviews" on public.service_reviews for select to anon,authenticated using (true);

create function public.request_service_hire(p_listing_id uuid,p_details text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_client uuid := auth.uid(); v_provider uuid; v_thread uuid; v_request uuid;
begin
  if v_client is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if char_length(btrim(coalesce(p_details,''))) not between 10 and 2000
     then raise exception 'invalid_details' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_client::text,64013));
  select seller_id into v_provider from public.auctions where id=p_listing_id
    and is_direct and listing_kind='SERVICE' and status='LISTED' and archived_at is null;
  if v_provider is null or v_provider=v_client then raise exception 'listing_unavailable' using errcode='P0002'; end if;
  if (select count(*) from public.service_requests where client_id=v_client and created_at>now()-interval '1 hour')>=8
    then raise exception 'rate_limited' using errcode='P0001'; end if;
  v_thread := public.start_listing_conversation(p_listing_id,'Hire request: '||btrim(p_details));
  insert into public.service_requests(listing_id,conversation_id,client_id,provider_id,details)
    values(p_listing_id,v_thread,v_client,v_provider,btrim(p_details)) returning id into v_request;
  return v_request;
end;
$$;

create function public.respond_service_hire(p_request_id uuid,p_action text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_request public.service_requests%rowtype;
      v_next text; v_message text;
begin
  if v_actor is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  select * into v_request from public.service_requests where id=p_request_id for update;
  if not found or v_actor not in (v_request.client_id,v_request.provider_id)
    then raise exception 'request_unavailable' using errcode='P0002'; end if;
  if p_action='ACCEPT' and v_actor=v_request.provider_id and v_request.status='REQUESTED' then
    v_next:='ACCEPTED'; v_message:='I accepted your hire request. Let us confirm the details.';
  elsif p_action='DECLINE' and v_actor=v_request.provider_id and v_request.status='REQUESTED' then
    v_next:='DECLINED'; v_message:='I cannot accept this hire request.';
  elsif p_action='DELIVER' and v_actor=v_request.provider_id and v_request.status='ACCEPTED' then
    v_next:='DELIVERED'; v_message:='I have completed the service. Please confirm if everything is done.';
  elsif p_action='CONFIRM' and v_actor=v_request.client_id and v_request.status='DELIVERED' then
    v_next:='COMPLETED'; v_message:='I confirmed the service is complete. Thank you!';
  elsif p_action='CANCEL' and v_actor=v_request.client_id and v_request.status in ('REQUESTED','ACCEPTED') then
    v_next:='CANCELLED'; v_message:='I cancelled this hire request.';
  else raise exception 'invalid_hire_transition' using errcode='P0001'; end if;
  update public.service_requests set status=v_next,updated_at=now() where id=p_request_id;
  insert into public.listing_messages(conversation_id,sender_id,body)
    values(v_request.conversation_id,v_actor,v_message);
  update public.listing_conversations set last_message_at=now() where id=v_request.conversation_id;
  return v_next;
end;
$$;

create function public.review_completed_service(p_request_id uuid,p_rating smallint,p_comment text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_client uuid := auth.uid(); v_request public.service_requests%rowtype; v_review uuid;
begin
  if v_client is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_rating is null or p_rating not between 1 and 5 or char_length(coalesce(p_comment,''))>1000
    then raise exception 'invalid_review' using errcode='22023'; end if;
  select * into v_request from public.service_requests where id=p_request_id;
  if not found or v_request.client_id<>v_client or v_request.status<>'COMPLETED'
    then raise exception 'review_unavailable' using errcode='P0002'; end if;
  insert into public.service_reviews(request_id,listing_id,provider_id,reviewer_id,rating,comment)
    values(p_request_id,v_request.listing_id,v_request.provider_id,v_client,p_rating,nullif(btrim(p_comment),''))
    returning id into v_review;
  return v_review;
end;
$$;
revoke all on function public.request_service_hire(uuid,text) from public,anon,authenticated;
revoke all on function public.respond_service_hire(uuid,text) from public,anon,authenticated;
revoke all on function public.review_completed_service(uuid,smallint,text) from public,anon,authenticated;
grant execute on function public.request_service_hire(uuid,text) to authenticated;
grant execute on function public.respond_service_hire(uuid,text) to authenticated;
grant execute on function public.review_completed_service(uuid,smallint,text) to authenticated;

-- Every message creates an ordinary, RLS-protected in-app notification for the other participant.
create function private.notify_listing_message() returns trigger language plpgsql security definer set search_path='' as $$
declare v_thread public.listing_conversations%rowtype; v_title text; v_recipient uuid;
begin
  select * into v_thread from public.listing_conversations where id=new.conversation_id;
  if not found then return new; end if;
  v_recipient := case when new.sender_id=v_thread.buyer_id then v_thread.seller_id else v_thread.buyer_id end;
  select title into v_title from public.auctions where id=v_thread.listing_id;
  insert into public.notifications(user_id,type,auction_id,payload)
    values(v_recipient,'NEW_MESSAGE',v_thread.listing_id,
      jsonb_build_object('listingChatId',v_thread.id,'title',coalesce(v_title,'Listing'),'senderId',new.sender_id));
  return new;
end;
$$;
create trigger listing_message_notify after insert on public.listing_messages
  for each row execute function private.notify_listing_message();
revoke execute on function private.notify_listing_message() from public,anon,authenticated;

-- Read only the columns authorized by existing RLS; Realtime does not bypass message privacy.
alter publication supabase_realtime add table public.listing_messages;
alter publication supabase_realtime add table public.listing_conversations;
