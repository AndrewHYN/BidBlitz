-- Opt-in marketplace emails, using the existing service-only outbox.
-- No browser access to these functions and no email on a failed listing mutation.
create function public.queue_marketplace_closed_email(p_listing_id uuid)
returns setof uuid language sql security definer set search_path = '' as $$
  with listing as (
    select a.id,a.title,a.seller_id,a.status
    from public.auctions a
    where a.id=p_listing_id and a.is_direct and a.listing_kind='SALE'
      and a.status in ('SOLD_DIRECT','CANCELLED') and a.archived_at is null
      and a.updated_at > now() - interval '1 day'
  ), audience as (
    select w.user_id from public.watchlist w join listing l on l.id=w.auction_id
    union
    select c.buyer_id from public.listing_conversations c join listing l on l.id=c.listing_id
    where c.left_by is null and not exists (
      select 1 from public.listing_chat_preferences p
      where p.conversation_id=c.id and p.user_id=c.buyer_id and (p.muted or p.hidden)
    )
  )
  insert into public.email_outbox(idempotency_key,recipient,template_key,payload)
  select 'marketplace_closed:'||l.id||':'||l.status::text||':'||u.id,
    lower(u.email), 'marketplace_listing_closed',
    jsonb_build_object('title',l.title,'listingId',l.id,'status',l.status,'userId',u.id)
  from listing l cross join audience a
  join auth.users u on u.id=a.user_id
  join public.profiles pr on pr.id=u.id and not pr.is_banned
  join public.notification_preferences p on p.user_id=u.id and p.marketplace_activity
  where u.id<>l.seller_id and u.email is not null and u.email_confirmed_at is not null
  on conflict (idempotency_key) do nothing
  returning id;
$$;
revoke all on function public.queue_marketplace_closed_email(uuid) from public,anon,authenticated;
grant execute on function public.queue_marketplace_closed_email(uuid) to service_role;

-- At most one recent recommendation per opted-in user per Harare calendar day.
-- Match explicitly saved categories; never infer interests from private chats.
-- Only public, available sales from non-banned sellers are eligible.
create function public.queue_marketplace_daily_match()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  insert into public.email_outbox(idempotency_key,recipient,template_key,payload)
  select 'marketplace_daily:'||u.id||':'||((now() at time zone 'Africa/Harare')::date)::text,
    lower(u.email), 'marketplace_daily_match',
    jsonb_build_object('title',m.title,'listingId',m.id,'userId',u.id)
  from public.notification_preferences p
  join auth.users u on u.id=p.user_id and u.email is not null and u.email_confirmed_at is not null
  join public.profiles buyer on buyer.id=u.id and not buyer.is_banned
  cross join lateral (
    select a.id,a.title
    from public.auctions a
    join public.profiles seller on seller.id=a.seller_id and not seller.is_banned
    where a.is_direct and a.listing_kind='SALE' and a.status='LISTED' and a.archived_at is null
      and a.seller_id<>u.id and a.listed_at > now() - interval '1 day'
      and not exists (select 1 from public.listing_pickup_reservations r where r.listing_id=a.id)
      and not exists (select 1 from public.watchlist w where w.user_id=u.id and w.auction_id=a.id)
      and exists (
        select 1 from public.watchlist w join public.auctions saved on saved.id=w.auction_id
        where w.user_id=u.id and saved.category_id=a.category_id
      )
    order by a.listed_at desc,a.id
    limit 1
  ) m
  where p.marketplace_activity
  on conflict (idempotency_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.queue_marketplace_daily_match() from public,anon,authenticated;
grant execute on function public.queue_marketplace_daily_match() to service_role;
