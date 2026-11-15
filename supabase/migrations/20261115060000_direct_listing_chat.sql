-- Direct-marketplace buyer/seller messaging. No payments or legacy auction ledger changes.
-- All messages stay private to the two authenticated participants; no phone numbers are imported.
create table public.listing_conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.auctions(id) on delete cascade,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (listing_id, buyer_id),
  constraint listing_chat_distinct_parties check (buyer_id <> seller_id)
);

create table public.listing_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.listing_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint listing_message_body_size check (char_length(btrim(body)) between 1 and 2000)
);

create index listing_conversations_buyer_recent on public.listing_conversations (buyer_id, last_message_at desc);
create index listing_conversations_seller_recent on public.listing_conversations (seller_id, last_message_at desc);
create index listing_messages_thread_recent on public.listing_messages (conversation_id, created_at desc);
create index listing_messages_unread on public.listing_messages (conversation_id, read_at) where read_at is null;

alter table public.listing_conversations enable row level security;
alter table public.listing_messages enable row level security;
revoke all on public.listing_conversations, public.listing_messages from public, anon, authenticated;
grant select on public.listing_conversations, public.listing_messages to authenticated;

create policy "participants read listing conversations" on public.listing_conversations
  for select to authenticated
  using ((select auth.uid()) = buyer_id or (select auth.uid()) = seller_id);

create policy "participants read listing messages" on public.listing_messages
  for select to authenticated
  using (exists (
    select 1 from public.listing_conversations c
    where c.id = conversation_id
      and ((select auth.uid()) = c.buyer_id or (select auth.uid()) = c.seller_id)
  ));

-- Security definer is necessary because neither client role can insert, update, or forge
-- participants. Each RPC checks caller identity, listing state, and server-side rate limits.
create function public.start_listing_conversation(p_listing_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_sender uuid := auth.uid();
  v_seller uuid;
  v_thread uuid;
begin
  if v_sender is null then
    raise exception 'not_authenticated' using errcode='42501';
  end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 2000 then
    raise exception 'invalid_message' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_sender::text, 64011));
  if exists (select 1 from public.profiles where id=v_sender and is_banned) then
    raise exception 'account_banned' using errcode='42501';
  end if;
  select a.seller_id into v_seller from public.auctions a
    where a.id=p_listing_id and a.is_direct and a.status='LISTED'
      and a.archived_at is null;
  if v_seller is null or v_seller=v_sender then
    raise exception 'listing_unavailable' using errcode='P0002';
  end if;
  if exists (select 1 from public.profiles where id=v_seller and is_banned) then
    raise exception 'listing_unavailable' using errcode='P0002';
  end if;
  if (select count(*) from public.listing_messages
      where sender_id=v_sender and created_at > clock_timestamp()-interval '1 minute') >= 12 then
    raise exception 'rate_limited' using errcode='P0001';
  end if;
  select c.id into v_thread from public.listing_conversations c
    where c.listing_id=p_listing_id and c.buyer_id=v_sender;
  if v_thread is null and
      (select count(*) from public.listing_conversations c
       where c.buyer_id=v_sender and c.created_at > clock_timestamp()-interval '1 hour') >= 10 then
    raise exception 'rate_limited' using errcode='P0001';
  end if;
  insert into public.listing_conversations (listing_id,buyer_id,seller_id)
    values (p_listing_id,v_sender,v_seller)
    on conflict (listing_id,buyer_id) do update
      set last_message_at=excluded.last_message_at
    returning id into v_thread;
  insert into public.listing_messages (conversation_id,sender_id,body)
    values(v_thread,v_sender,btrim(p_body));
  update public.listing_conversations
    set last_message_at=clock_timestamp() where id=v_thread;
  return v_thread;
end;
$$;

create function public.send_listing_message(p_conversation_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_sender uuid := auth.uid();
  v_buyer uuid;
  v_seller uuid;
  v_message uuid;
begin
  if v_sender is null then
    raise exception 'not_authenticated' using errcode='42501';
  end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 2000 then
    raise exception 'invalid_message' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_sender::text, 64011));
  select buyer_id,seller_id into v_buyer,v_seller
    from public.listing_conversations
    where id=p_conversation_id for update;
  if v_buyer is null or v_sender not in (v_buyer,v_seller) then
    raise exception 'conversation_unavailable' using errcode='P0002';
  end if;
  if exists (select 1 from public.profiles where id=v_sender and is_banned) then
    raise exception 'account_banned' using errcode='42501';
  end if;
  if (select count(*) from public.listing_messages
      where sender_id=v_sender and created_at > clock_timestamp()-interval '1 minute') >= 12 then
    raise exception 'rate_limited' using errcode='P0001';
  end if;
  insert into public.listing_messages (conversation_id,sender_id,body)
    values(p_conversation_id,v_sender,btrim(p_body)) returning id into v_message;
  update public.listing_conversations
    set last_message_at=clock_timestamp() where id=p_conversation_id;
  return v_message;
end;
$$;

create function public.mark_listing_conversation_read(p_conversation_id uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_reader uuid := auth.uid();
  v_count integer;
begin
  if v_reader is null then
    raise exception 'not_authenticated' using errcode='42501';
  end if;
  if not exists(select 1 from public.listing_conversations c
    where c.id=p_conversation_id and v_reader in (c.buyer_id,c.seller_id)) then
    raise exception 'conversation_unavailable' using errcode='P0002';
  end if;
  update public.listing_messages
    set read_at=clock_timestamp()
    where conversation_id=p_conversation_id and sender_id<>v_reader and read_at is null;
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

revoke all on function public.start_listing_conversation(uuid,text) from public,anon,authenticated;
revoke all on function public.send_listing_message(uuid,text) from public,anon,authenticated;
revoke all on function public.mark_listing_conversation_read(uuid) from public,anon,authenticated;
grant execute on function public.start_listing_conversation(uuid,text) to authenticated;
grant execute on function public.send_listing_message(uuid,text) to authenticated;
grant execute on function public.mark_listing_conversation_read(uuid) to authenticated;

comment on table public.listing_conversations is 'Private pre-sale listing threads; unlike transaction_messages, no auction win or payment is needed.';
comment on table public.listing_messages is 'Private plaintext, text-only messages; visible only to conversation participants. Never import scraped contacts or outside messages.';
