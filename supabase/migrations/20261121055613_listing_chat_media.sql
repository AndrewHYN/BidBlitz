alter table public.listing_messages add column attachment_kind text
  check (attachment_kind in ('image','audio'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-chat-media', 'listing-chat-media', false, 3145728,
  array['image/jpeg','image/png','image/webp','audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav']);

create table private.listing_chat_upload_limits (
  sender_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  attempts integer not null
);
alter table private.listing_chat_upload_limits enable row level security;
revoke all on private.listing_chat_upload_limits from public, anon, authenticated;

create function public.reserve_listing_chat_upload(p_conversation_id uuid, p_sender_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_attempts integer;
begin
  if not exists (select 1 from public.listing_conversations
    where id = p_conversation_id and p_sender_id in (buyer_id,seller_id)) then
    raise exception 'conversation_unavailable' using errcode='P0002';
  end if;
  if exists (select 1 from public.profiles where id=p_sender_id and is_banned) then
    raise exception 'account_banned' using errcode='42501';
  end if;

  insert into private.listing_chat_upload_limits as budget (sender_id,window_start,attempts)
  values (p_sender_id,v_now,1)
  on conflict (sender_id) do update
    set window_start = case when budget.window_start <= v_now - interval '1 hour' then v_now else budget.window_start end,
        attempts = case when budget.window_start <= v_now - interval '1 hour' then 1 else budget.attempts + 1 end
    where budget.window_start <= v_now - interval '1 hour' or budget.attempts < 30
  returning attempts into v_attempts;
  if v_attempts is null then
    raise exception 'rate_limited' using errcode='P0001';
  end if;
end;
$$;

create function public.send_listing_chat_attachment(
  p_conversation_id uuid, p_sender_id uuid, p_message_id uuid, p_kind text
) returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_kind is null or p_kind not in ('image','audio') then
    raise exception 'invalid_message' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_sender_id::text, 64011));
  perform 1 from public.listing_conversations
    where id = p_conversation_id and p_sender_id in (buyer_id,seller_id) for update;
  if not found then
    raise exception 'conversation_unavailable' using errcode='P0002';
  end if;
  if exists (select 1 from public.profiles where id=p_sender_id and is_banned) then
    raise exception 'account_banned' using errcode='42501';
  end if;
  if (select count(*) from public.listing_messages
      where sender_id=p_sender_id and created_at > clock_timestamp()-interval '1 minute') >= 12 then
    raise exception 'rate_limited' using errcode='P0001';
  end if;
  insert into public.listing_messages (id,conversation_id,sender_id,body,attachment_kind)
    values (p_message_id,p_conversation_id,p_sender_id,
      case p_kind when 'image' then 'Photo' else 'Audio message' end,p_kind);
  update public.listing_conversations set last_message_at=clock_timestamp() where id=p_conversation_id;
end;
$$;

revoke all on function public.reserve_listing_chat_upload(uuid,uuid) from public,anon,authenticated;
revoke all on function public.send_listing_chat_attachment(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_listing_chat_upload(uuid,uuid) to service_role;
grant execute on function public.send_listing_chat_attachment(uuid,uuid,uuid,text) to service_role;
comment on table public.listing_messages is 'Private listing chat messages. Attachments are stored in a private bucket.';
