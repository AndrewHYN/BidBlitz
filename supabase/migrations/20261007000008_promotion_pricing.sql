-- Lightweight promotion pricing.
-- This is deliberately not an ad billing platform. Sellers see an explicit
-- quote; staff manually confirms the commercial arrangement before approval.

create table if not exists public.promotion_settings (
  days smallint primary key check (days in (3,7)),
  price_minor bigint not null check (price_minor >= 0),
  currency text not null default 'USD' check (currency='USD'),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.promotion_settings(days,price_minor,currency,enabled)
values
  (3,100,'USD',true),
  (7,200,'USD',true)
on conflict (days) do nothing;

alter table public.promotion_requests
  add column if not exists quoted_price_minor bigint,
  add column if not exists currency text;

update public.promotion_requests r
   set quoted_price_minor = coalesce(
         quoted_price_minor,
         (select s.price_minor from public.promotion_settings s where s.days=r.requested_days),
         0
       ),
       currency=coalesce(currency,'USD')
 where quoted_price_minor is null or currency is null;

alter table public.promotion_requests
  alter column quoted_price_minor set not null,
  alter column currency set not null,
  alter column currency set default 'USD';

alter table public.promotion_requests
  drop constraint if exists promotion_requests_quote_chk,
  add constraint promotion_requests_quote_chk check (quoted_price_minor >= 0),
  drop constraint if exists promotion_requests_currency_chk,
  add constraint promotion_requests_currency_chk check (currency='USD');

alter table public.promotion_settings enable row level security;

drop policy if exists promotion_settings_read on public.promotion_settings;
create policy promotion_settings_read
on public.promotion_settings for select
using (true);

revoke insert,update,delete on public.promotion_settings from anon,authenticated;
grant select on public.promotion_settings to anon,authenticated;
grant all on public.promotion_settings to service_role;

create or replace function public.request_auction_promotion(
  p_auction_id uuid,
  p_days integer
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  a public.auctions%rowtype;
  v_id uuid;
  v_price bigint;
  v_currency text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_days not in (3,7) then raise exception 'invalid_duration' using errcode='22023'; end if;

  select price_minor,currency into v_price,v_currency
    from public.promotion_settings
   where days=p_days and enabled=true;
  if not found then raise exception 'promotion_unavailable' using errcode='P0001'; end if;

  select * into a from public.auctions where id=p_auction_id for update;
  if not found then raise exception 'auction_not_found' using errcode='P0002'; end if;
  if a.seller_id <> v_uid then raise exception 'not_owner' using errcode='42501'; end if;
  if a.status not in ('LIVE','SCHEDULED') then raise exception 'invalid_state' using errcode='P0001'; end if;
  if a.featured_until is not null and a.featured_until > clock_timestamp() then
    raise exception 'already_promoted' using errcode='P0001';
  end if;
  if exists(
    select 1 from public.promotion_requests p
    where p.auction_id=a.id and p.status='PENDING'
  ) then
    raise exception 'already_requested' using errcode='P0001';
  end if;

  insert into public.promotion_requests(
    auction_id,seller_id,requested_days,quoted_price_minor,currency
  )
  values(a.id,v_uid,p_days,v_price,v_currency)
  returning id into v_id;

  insert into public.notifications(user_id,type,auction_id,payload)
  select distinct s.user_id,'PROMOTION_REQUESTED',a.id,
         jsonb_build_object(
           'title',a.title,
           'request_id',v_id,
           'days',p_days,
           'priceMinor',v_price,
           'currency',v_currency
         )
    from public.staff_assignments s
   where s.status='ACTIVE'
     and public.has_permission(s.user_id,'settings.manage_marketplace');

  return jsonb_build_object(
    'ok',true,
    'request_id',v_id,
    'status','PENDING',
    'price_minor',v_price,
    'currency',v_currency
  );
end;
$$;

create or replace function private.admin_update_promotion_pricing(
  p_days integer,
  p_price_minor bigint,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if not public.has_permission(v_uid,'settings.manage_marketplace') then
    raise exception 'not_admin' using errcode='42501';
  end if;
  if p_days not in (3,7) or p_price_minor < 0 then
    raise exception 'invalid_promotion_price' using errcode='22023';
  end if;

  insert into public.promotion_settings(days,price_minor,currency,enabled,updated_at)
  values(p_days,p_price_minor,'USD',p_enabled,clock_timestamp())
  on conflict(days) do update
    set price_minor=excluded.price_minor,
        enabled=excluded.enabled,
        updated_at=excluded.updated_at;

  return jsonb_build_object(
    'ok',true,'days',p_days,'price_minor',p_price_minor,'enabled',p_enabled
  );
end;
$$;

create or replace function public.admin_update_promotion_pricing(
  p_days integer,
  p_price_minor bigint,
  p_enabled boolean
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.admin_update_promotion_pricing(p_days,p_price_minor,p_enabled);
$$;

revoke all on function private.admin_update_promotion_pricing(integer,bigint,boolean)
  from public,anon;
grant execute on function private.admin_update_promotion_pricing(integer,bigint,boolean)
  to authenticated,service_role;

revoke all on function public.admin_update_promotion_pricing(integer,bigint,boolean)
  from public,anon;
grant execute on function public.admin_update_promotion_pricing(integer,bigint,boolean)
  to authenticated,service_role;
