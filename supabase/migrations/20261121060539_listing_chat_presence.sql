create table private.marketplace_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null
);
alter table private.marketplace_presence enable row level security;
revoke all on private.marketplace_presence from public, anon, authenticated;

create function public.touch_marketplace_presence()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  viewer uuid := auth.uid();
  observed_at timestamptz := clock_timestamp();
begin
  if viewer is null then return; end if;
  insert into private.marketplace_presence as presence (user_id, last_seen_at)
    values (viewer, observed_at)
    on conflict (user_id) do update set last_seen_at = excluded.last_seen_at
    where presence.last_seen_at < excluded.last_seen_at - interval '45 seconds';
end;
$$;

create function public.listing_chat_peer_presence(p_conversation_ids uuid[])
returns table (conversation_id uuid, last_seen_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select conversation.id, presence.last_seen_at
  from public.listing_conversations as conversation
  join private.marketplace_presence as presence
    on presence.user_id = case when conversation.buyer_id = auth.uid()
      then conversation.seller_id else conversation.buyer_id end
  where conversation.id = any(p_conversation_ids[1:100])
    and auth.uid() in (conversation.buyer_id, conversation.seller_id);
$$;

revoke all on function public.touch_marketplace_presence() from public, anon, authenticated;
revoke all on function public.listing_chat_peer_presence(uuid[]) from public, anon, authenticated;
grant execute on function public.touch_marketplace_presence() to authenticated;
grant execute on function public.listing_chat_peer_presence(uuid[]) to authenticated;
