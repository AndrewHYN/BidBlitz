create table public.marketplace_daily_views (
  day date primary key,
  views bigint not null default 0
);
alter table public.marketplace_daily_views enable row level security;
revoke all on public.marketplace_daily_views from public, anon, authenticated;
grant select, insert, update on public.marketplace_daily_views to service_role;

create function public.record_marketplace_view()
returns void language sql set search_path = '' as $$
  insert into public.marketplace_daily_views(day, views)
  values ((now() at time zone 'Africa/Harare')::date, 1)
  on conflict (day) do update set views = marketplace_daily_views.views + 1;
$$;
revoke all on function public.record_marketplace_view() from public, anon, authenticated;
grant execute on function public.record_marketplace_view() to service_role;

create function public.marketplace_activity_summary()
returns jsonb language sql stable security definer set search_path = '' as $$
  with days as (
    select day::date from pg_catalog.generate_series(
      ((now() at time zone 'Africa/Harare')::date - 13)::timestamp,
      (now() at time zone 'Africa/Harare')::date::timestamp, interval '1 day'
    ) as day
  ), people as (
    select id, email, created_at, email_confirmed_at
    from auth.users
    where email not ilike '%@bidblitz.test' and email not ilike 'hyndrrx0+bb-qa-%@gmail.com'
  ), listings as (
    select a.* from public.auctions a join people p on p.id=a.seller_id where a.archived_at is null
  )
  select case when auth.uid() is not null and public.has_permission(auth.uid(), 'analytics.view') then
    pg_catalog.jsonb_build_object(
      'accounts', (select count(*) from people),
      'confirmed', (select count(*) from people where email_confirmed_at is not null),
      'days', (select jsonb_agg(jsonb_build_object('day',d.day,'views',coalesce(v.views,0),
        'signups',(select count(*) from people p where (p.created_at at time zone 'Africa/Harare')::date=d.day)) order by d.day)
        from days d left join public.marketplace_daily_views v on v.day=d.day),
      'states', (select coalesce(jsonb_object_agg(status, entries), '{}'::jsonb) from
        (select status, count(*) entries from listings group by status) s),
      'categories', (select coalesce(jsonb_object_agg(name, entries), '{}'::jsonb) from
        (select coalesce(c.name,'Uncategorized') name, count(*) entries from listings a
          left join public.categories c on c.id=a.category_id
          where a.status in ('LISTED','LIVE','SOLD_DIRECT') group by 1) s),
      'recentListings',(select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc),'[]'::jsonb) from
        (select title, listing_kind, status, created_at from listings where status in ('LISTED','LIVE','SOLD_DIRECT','PENDING_REVIEW')
          order by created_at desc,id limit 20) l),
      'contacts', case when public.has_permission(auth.uid(),'users.contact_support') then
        (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc),'[]'::jsonb) from
         (select email, created_at, (email_confirmed_at is not null) as confirmed from people
           order by created_at desc,id limit 25) p) else null end
    ) else null end;
$$;
revoke all on function public.marketplace_activity_summary() from public, anon, authenticated;
grant execute on function public.marketplace_activity_summary() to authenticated;
