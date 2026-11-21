alter table public.listing_conversations add column left_by uuid,
  add constraint listing_chat_leaver_is_member check (left_by in (buyer_id,seller_id));

create table public.listing_chat_preferences (
  conversation_id uuid not null references public.listing_conversations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  manual_unread boolean not null default false,
  pinned boolean not null default false,
  archived boolean not null default false,
  muted boolean not null default false,
  hidden boolean not null default false,
  cleared_at timestamptz,
  primary key (user_id, conversation_id)
);
alter table public.listing_chat_preferences enable row level security;
revoke all on public.listing_chat_preferences from public,anon,authenticated;
grant select on public.listing_chat_preferences to authenticated, service_role;
create policy "read own chat settings" on public.listing_chat_preferences for select to authenticated
  using (user_id=(select auth.uid()));

-- A personal deletion applies to every message read, including the private media route.
create policy "respect personal history cutoff" on public.listing_messages as restrictive for select to authenticated
  using (not exists (select 1 from public.listing_chat_preferences p
    where p.conversation_id=listing_messages.conversation_id and p.user_id=(select auth.uid())
    and listing_messages.created_at <= p.cleared_at));

create function public.set_listing_chat_action(p_conversation_id uuid,p_action text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); leaver uuid;
begin
  select left_by into leaver from public.listing_conversations
    where id=p_conversation_id and actor in (buyer_id,seller_id) for update;
  if not found then raise exception 'conversation_unavailable'; end if;
  if p_action='leave' then
    if leaver is not null and leaver<>actor then raise exception 'chat_closed'; end if;
    update public.listing_conversations set left_by=actor where id=p_conversation_id;
  elsif p_action='rejoin' then
    if leaver is distinct from actor then raise exception 'cannot_rejoin'; end if;
    update public.listing_conversations set left_by=null where id=p_conversation_id;
    update public.listing_chat_preferences set archived=false,hidden=false where conversation_id=p_conversation_id and user_id=actor;
  elsif p_action in ('unread','pin','unpin','archive','unarchive','mute','unmute','delete') then
    insert into public.listing_chat_preferences(user_id,conversation_id) values(actor,p_conversation_id)
      on conflict do nothing;
    update public.listing_chat_preferences set
      manual_unread=case when p_action='unread' then true when p_action='delete' then false else manual_unread end,
      pinned=case when p_action='pin' then true when p_action in ('unpin','delete') then false else pinned end,
      archived=case when p_action='archive' then true when p_action in ('unarchive','delete') then false else archived end,
      muted=case when p_action='mute' then true when p_action='unmute' then false else muted end,
      hidden=case when p_action='delete' then true when p_action='unarchive' then false else hidden end,
      cleared_at=case when p_action='delete' then clock_timestamp() else cleared_at end
      where user_id=actor and conversation_id=p_conversation_id;
  elsif p_action <> 'read' or p_action is null then raise exception 'invalid_action';
  end if;
  if p_action='read' then perform public.mark_listing_conversation_read(p_conversation_id); end if;
  if p_action in ('delete','leave') then
    update public.notifications set read_at=clock_timestamp() where user_id=actor and type='NEW_MESSAGE'
      and payload->>'listingChatId'=p_conversation_id::text and read_at is null;
  end if;
end;
$$;
revoke all on function public.set_listing_chat_action(uuid,text) from public,anon;
grant execute on function public.set_listing_chat_action(uuid,text) to authenticated;

-- Serialize every send (including service-role media) against leave and deletion.
create function private.guard_listing_chat_message() returns trigger language plpgsql security definer set search_path='' as $$
declare leaver uuid;
begin
  select left_by into leaver from public.listing_conversations where id=new.conversation_id for update;
  if leaver is not null then raise exception 'chat_closed'; end if;
  new.created_at := clock_timestamp();
  update public.listing_chat_preferences set archived=false,hidden=false where conversation_id=new.conversation_id and (archived or hidden);
  return new;
end;
$$;
revoke all on function private.guard_listing_chat_message() from public,anon,authenticated;
create trigger guard_listing_chat_message before insert on public.listing_messages
  for each row execute function private.guard_listing_chat_message();

create or replace function private.notify_listing_message() returns trigger language plpgsql security definer set search_path='' as $$
declare thread public.listing_conversations%rowtype; recipient uuid; title text;
begin
  select * into strict thread from public.listing_conversations where id=new.conversation_id;
  recipient := case when new.sender_id=thread.buyer_id then thread.seller_id else thread.buyer_id end;
  if exists(select 1 from public.listing_chat_preferences where conversation_id=thread.id and user_id=recipient and muted)
    then return new; end if;
  select a.title into title from public.auctions a where a.id=thread.listing_id;
  insert into public.notifications(user_id,type,auction_id,payload) values(recipient,'NEW_MESSAGE',thread.listing_id,
    jsonb_build_object('listingChatId',thread.id,'title',coalesce(title,'Listing'),'senderId',new.sender_id));
  return new;
end;
$$;

-- Order and filter before pagination so old pins and archives stay reachable.
create function public.listing_chat_inbox(p_archived boolean,p_offset integer default 0)
returns table(id uuid,listing_id uuid,buyer_id uuid,seller_id uuid,left_by uuid,pinned boolean,muted boolean,
  last_body text,last_sender uuid,last_at timestamptz,last_read timestamptz,manual_unread boolean,unread_count bigint)
language sql stable security invoker set search_path='' as $$
  select c.id,c.listing_id,c.buyer_id,c.seller_id,c.left_by,coalesce(p.pinned,false),coalesce(p.muted,false),
    m.body,m.sender_id,m.created_at,m.read_at,coalesce(p.manual_unread,false),
    (select count(*) from public.listing_messages u where u.conversation_id=c.id and u.sender_id<>auth.uid() and u.read_at is null)
  from public.listing_conversations c left join public.listing_chat_preferences p on p.conversation_id=c.id and p.user_id=auth.uid()
  left join lateral (select * from public.listing_messages lm where lm.conversation_id=c.id order by lm.created_at desc,lm.id desc limit 1) m on true
  where auth.uid() in(c.buyer_id,c.seller_id) and
    (case when coalesce(p.hidden,false) then c.left_by=auth.uid() and p_archived
      else coalesce(p.archived,false)=p_archived end)
  order by coalesce(p.pinned,false) desc,c.last_message_at desc,c.id limit 51 offset greatest(p_offset,0);
$$;
revoke all on function public.listing_chat_inbox(boolean,integer) from public,anon;
grant execute on function public.listing_chat_inbox(boolean,integer) to authenticated;

create or replace function public.respond_listing_offer(p_offer_id uuid,p_accept boolean)
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
  perform 1 from public.listing_conversations where id=v_offer.conversation_id and left_by is null for update;
  if found then
    insert into public.listing_messages(conversation_id,sender_id,body)
      values(v_offer.conversation_id,v_seller,case when p_accept then 'I accepted your offer. Let us arrange collection and payment.' else 'I declined this offer. You can still message me.' end);
    update public.listing_conversations set last_message_at=now() where id=v_offer.conversation_id;
  end if;
  return v_status;
end;
$$;

create or replace function public.respond_service_hire(p_request_id uuid,p_action text)
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
  perform 1 from public.listing_conversations where id=v_request.conversation_id and left_by is null for update;
  if found then
    insert into public.listing_messages(conversation_id,sender_id,body)
      values(v_request.conversation_id,v_actor,v_message);
    update public.listing_conversations set last_message_at=now() where id=v_request.conversation_id;
  end if;
  return v_next;
end;
$$;

create or replace function public.mark_listing_conversation_read(p_conversation_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); affected integer;
begin
  perform 1 from public.listing_conversations where id=p_conversation_id and actor in(buyer_id,seller_id) for update;
  if not found then raise exception 'conversation_unavailable'; end if;
  update public.listing_messages m set read_at=clock_timestamp()
    where m.conversation_id=p_conversation_id and m.sender_id<>actor and m.read_at is null
    and not exists(select 1 from public.listing_chat_preferences p where p.conversation_id=m.conversation_id
      and p.user_id=actor and p.cleared_at>=m.created_at);
  get diagnostics affected=row_count;
  update public.listing_chat_preferences set manual_unread=false where user_id=actor and conversation_id=p_conversation_id and manual_unread;
  update public.notifications set read_at=clock_timestamp() where user_id=actor and type='NEW_MESSAGE'
    and payload->>'listingChatId'=p_conversation_id::text and read_at is null;
  return affected;
end;
$$;
