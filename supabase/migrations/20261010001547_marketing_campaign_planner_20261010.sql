-- Operations 2.0 M3: campaign planning and immutable staff accountability.
-- Planning only: NO automatic ads, messages, emails, paid promotions or spend.
insert into public.staff_permissions (key,category,description,sensitive)
values ('marketing.manage','marketing',
  'Create and manage staff marketing campaigns; never move or allocate funds.', false)
on conflict (key) do nothing;

insert into public.staff_role_permissions (role_key,permission_key)
values ('MARKETING','marketing.manage')
on conflict (role_key,permission_key) do nothing;

create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 100),
  objective text not null check (objective in
    ('SELLER_ACQUISITION','BUYER_ACQUISITION','AUCTION_EVENT','REACTIVATION')),
  destination text not null check (destination in ('home','auctions','sell')),
  source text not null check (source ~ '^[a-z0-9_-]{2,70}$'),
  medium text not null check (medium ~ '^[a-z0-9_-]{2,70}$'),
  campaign_tag text not null unique check (campaign_tag ~ '^[a-z0-9_-]{3,70}$'),
  content_tag text check (content_tag is null or content_tag ~ '^[a-z0-9_-]{1,70}$'),
  brief text not null default '' check (char_length(brief) <= 2000),
  planned_budget_minor bigint not null default 0
    check (planned_budget_minor >= 0 and planned_budget_minor <= 10000000),
  currency text not null default 'USD' check (currency='USD'),
  status text not null default 'DRAFT'
    check (status in ('DRAFT','READY','RUNNING','PAUSED','COMPLETED')),
  planned_start timestamptz,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists marketing_campaigns_status_created
  on public.marketing_campaigns(status,created_at desc);

create table if not exists public.marketing_campaign_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns(id),
  actor_id uuid not null references public.profiles(id),
  event text not null check (event in ('CREATED','STATUS_CHANGED')),
  old_status text,
  new_status text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists marketing_campaign_events_campaign_created
 on public.marketing_campaign_events(campaign_id,created_at desc);

alter table public.marketing_campaigns enable row level security;
alter table public.marketing_campaign_events enable row level security;
revoke all on public.marketing_campaigns,public.marketing_campaign_events from public,anon,authenticated;
grant select on public.marketing_campaigns,public.marketing_campaign_events to authenticated;

drop policy if exists marketing_campaigns_read on public.marketing_campaigns;
create policy marketing_campaigns_read on public.marketing_campaigns for select to authenticated
using (auth.uid() is not null and
  (public.has_permission(auth.uid(),'marketing.view')
   or public.has_permission(auth.uid(),'settings.manage_marketplace')));

drop policy if exists marketing_campaign_events_read on public.marketing_campaign_events;
create policy marketing_campaign_events_read on public.marketing_campaign_events for select to authenticated
using (auth.uid() is not null and
  (public.has_permission(auth.uid(),'marketing.view')
   or public.has_permission(auth.uid(),'settings.manage_marketplace')));

create or replace function public.admin_create_marketing_campaign(
 p_title text,p_objective text,p_destination text,p_source text,
 p_medium text,p_campaign_tag text,p_content_tag text,
 p_brief text,p_planned_budget_minor bigint,p_planned_start timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_uid uuid:=auth.uid();
 v_id uuid;
begin
 if v_uid is null or not (
   public.has_permission(v_uid,'marketing.manage')
   or public.has_permission(v_uid,'settings.manage_marketplace')) then
   raise exception 'not_authorised' using errcode='42501';
 end if;
 if p_title is null or char_length(btrim(p_title)) not between 3 and 100
    or p_objective not in ('SELLER_ACQUISITION','BUYER_ACQUISITION','AUCTION_EVENT','REACTIVATION')
    or p_destination not in ('home','auctions','sell')
    or p_source !~ '^[a-z0-9_-]{2,70}$'
    or p_medium !~ '^[a-z0-9_-]{2,70}$'
    or p_campaign_tag !~ '^[a-z0-9_-]{3,70}$'
    or (p_content_tag is not null and p_content_tag !~ '^[a-z0-9_-]{1,70}$')
    or char_length(coalesce(p_brief,''))>2000
    or p_planned_budget_minor is null
    or p_planned_budget_minor not between 0 and 10000000
    or (p_planned_start is not null and
      (p_planned_start < clock_timestamp() - interval '24 hours'
       or p_planned_start > clock_timestamp() + interval '18 months')) then
   raise exception 'invalid_campaign' using errcode='22023';
 end if;
 insert into public.marketing_campaigns(
    title,objective,destination,source,medium,campaign_tag,content_tag,
    brief,planned_budget_minor,planned_start,created_by,updated_by)
 values (btrim(p_title),p_objective,p_destination,p_source,p_medium,p_campaign_tag,
    nullif(p_content_tag,''),coalesce(btrim(p_brief),''),p_planned_budget_minor,
    p_planned_start,v_uid,v_uid)
 returning id into v_id;
 insert into public.marketing_campaign_events(
    campaign_id,actor_id,event,new_status)
 values (v_id,v_uid,'CREATED','DRAFT');
 return jsonb_build_object('ok',true,'id',v_id,'status','DRAFT');
exception
 when unique_violation then raise exception 'duplicate_campaign_tag' using errcode='23505';
end
$$;

create or replace function public.admin_set_marketing_campaign_status(
 p_campaign_id uuid,p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_uid uuid:=auth.uid();
 v_current text;
begin
 if v_uid is null or not (
   public.has_permission(v_uid,'marketing.manage')
   or public.has_permission(v_uid,'settings.manage_marketplace')) then
   raise exception 'not_authorised' using errcode='42501';
 end if;
 select status into v_current from public.marketing_campaigns
  where id=p_campaign_id for update;
 if not found then raise exception 'campaign_not_found' using errcode='P0002'; end if;
 if p_status=v_current then
   return jsonb_build_object('ok',true,'status',v_current,'already',true);
 end if;
 if not (
   (v_current='DRAFT' and p_status in ('READY','COMPLETED'))
   or (v_current='READY' and p_status in ('RUNNING','PAUSED','COMPLETED'))
   or (v_current='RUNNING' and p_status in ('PAUSED','COMPLETED'))
   or (v_current='PAUSED' and p_status in ('RUNNING','COMPLETED'))
 ) then raise exception 'invalid_campaign_transition' using errcode='22023'; end if;
 update public.marketing_campaigns
   set status=p_status, updated_at=clock_timestamp(),updated_by=v_uid
   where id=p_campaign_id;
 insert into public.marketing_campaign_events(campaign_id,actor_id,event,old_status,new_status)
   values(p_campaign_id,v_uid,'STATUS_CHANGED',v_current,p_status);
 return jsonb_build_object('ok',true,'status',p_status,'already',false);
end
$$;

revoke all on function public.admin_create_marketing_campaign(text,text,text,text,text,text,text,text,bigint,timestamptz) from public,anon;
grant execute on function public.admin_create_marketing_campaign(text,text,text,text,text,text,text,text,bigint,timestamptz) to authenticated,service_role;
revoke all on function public.admin_set_marketing_campaign_status(uuid,text) from public,anon;
grant execute on function public.admin_set_marketing_campaign_status(uuid,text) to authenticated,service_role;
