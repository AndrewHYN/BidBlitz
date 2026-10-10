-- Company operating expenses are internal bookkeeping and never debit seller balances.
create table if not exists public.company_operating_costs (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  category text not null check(category in ('PAYROLL','MARKETING','PROVIDER_FEES','HOSTING','OPERATIONS','OTHER')),
  amount_minor bigint not null check(amount_minor > 0),
  status text not null default 'PLANNED' check(status in ('PLANNED','INCURRED','PAID','VOIDED')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.company_operating_costs enable row level security;
revoke all on public.company_operating_costs from anon,authenticated;

-- Staff department grants; finance analysts may read but not mutate.
insert into public.staff_permissions(key,category,description,sensitive) values
('finance.costs.view','FINANCE','Read internal operating costs and payroll provisions.',true),
('finance.costs.manage','FINANCE','Record internal costs, never transfer funds.',true)
on conflict (key) do nothing;
insert into public.staff_role_permissions(role_key,permission_key)
select g.role_key,g.permission_key from (values
 ('ADMIN','finance.costs.view'),('ADMIN','finance.costs.manage'),
 ('FINANCE','finance.costs.view'),('FINANCE','finance.costs.manage'),
 ('FINANCE_VIEWER','finance.costs.view')
) g(role_key,permission_key)
join public.staff_roles r on r.key=g.role_key
join public.staff_permissions p on p.key=g.permission_key
on conflict (role_key,permission_key) do nothing;

alter table public.company_operating_costs
 add column if not exists currency text not null default 'USD' check(currency='USD'),
 add column if not exists payee_label text,
 add column if not exists incurred_on date,
 add column if not exists external_reference text,
 add column if not exists updated_by uuid references public.profiles(id),
 add column if not exists updated_at timestamptz not null default now();
alter table public.company_operating_costs
 add constraint cost_paid_reference_check check(status<>'PAID' or external_reference is not null);
create index if not exists company_costs_status_created
 on public.company_operating_costs(status,created_at desc);

create table if not exists public.company_operating_cost_events (
 id uuid primary key default gen_random_uuid(),
 cost_id uuid not null references public.company_operating_costs(id),
 actor_id uuid not null references public.profiles(id),
 event text not null check(event in ('CREATED','STATE_CHANGE')),
 old_status text,
 new_status text not null,
 note text not null default '',
 created_at timestamptz not null default now()
);
create index if not exists company_cost_events_by_cost
 on public.company_operating_cost_events(cost_id,created_at desc);
alter table public.company_operating_cost_events enable row level security;
revoke all on public.company_operating_cost_events from public,anon,authenticated;
grant select on public.company_operating_costs,public.company_operating_cost_events to authenticated;
drop policy if exists company_operating_costs_read on public.company_operating_costs;
create policy company_operating_costs_read on public.company_operating_costs
 for select to authenticated using(auth.uid() is not null
 and public.has_permission(auth.uid(),'finance.costs.view'));
drop policy if exists company_cost_events_read on public.company_operating_cost_events;
create policy company_cost_events_read on public.company_operating_cost_events
 for select to authenticated using(auth.uid() is not null
 and public.has_permission(auth.uid(),'finance.costs.view'));

-- No direct writes allowed. Permission checked by the database at each call.
create or replace function public.staff_create_company_cost(
 p_description text,p_category text,p_amount_minor bigint,
 p_payee_label text,p_incurred_on date default null
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_id uuid; v_status text;
begin
 if v_uid is null or not public.has_permission(v_uid,'finance.costs.manage') then
  raise exception 'not_authorised' using errcode='42501';
 end if;
 if char_length(btrim(coalesce(p_description,''))) not between 5 and 180
  or p_category not in ('PAYROLL','MARKETING','PROVIDER_FEES','HOSTING','OPERATIONS','OTHER')
  or p_amount_minor is null or p_amount_minor not between 1 and 100000000
  or char_length(btrim(coalesce(p_payee_label,''))) not between 2 and 120
  or (p_incurred_on is not null and (p_incurred_on < current_date - interval '5 years'
   or p_incurred_on > current_date + interval '3 years')) then
  raise exception 'invalid_cost' using errcode='22023';
 end if;
 v_status:=case when p_incurred_on is null then 'PLANNED' else 'INCURRED' end;
 insert into public.company_operating_costs(
   description,category,amount_minor,payee_label,incurred_on,status,created_by,updated_by
 ) values(btrim(p_description),p_category,p_amount_minor,btrim(p_payee_label),
   p_incurred_on,v_status,v_uid,v_uid) returning id into v_id;
 insert into public.company_operating_cost_events(cost_id,actor_id,event,new_status,note)
 values(v_id,v_uid,'CREATED',v_status,'Created company cost; no money transferred.');
 return jsonb_build_object('ok',true,'id',v_id,'status',v_status);
end $$;
revoke all on function public.staff_create_company_cost(text,text,bigint,text,date) from public,anon;
grant execute on function public.staff_create_company_cost(text,text,bigint,text,date) to authenticated;

create or replace function public.staff_transition_company_cost(
 p_cost_id uuid,p_status text,p_external_reference text default null,p_note text default ''
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_cost public.company_operating_costs%rowtype;
begin
 if v_uid is null or not public.has_permission(v_uid,'finance.costs.manage') then
  raise exception 'not_authorised' using errcode='42501';
 end if;
 select * into v_cost from public.company_operating_costs where id=p_cost_id for update;
 if not found then raise exception 'cost_not_found' using errcode='P0002'; end if;
 if p_status is null or not (
   (v_cost.status='PLANNED' and p_status in ('INCURRED','VOIDED'))
   or (v_cost.status='INCURRED' and p_status in ('PAID','VOIDED'))) then
   raise exception 'invalid_cost_transition' using errcode='22023';
 end if;
 if char_length(coalesce(p_note,''))>1000 then
   raise exception 'note_too_long' using errcode='22023';
 end if;
 if p_status='PAID' and char_length(btrim(coalesce(p_external_reference,''))) not between 6 and 180 then
   raise exception 'paid_reference_required' using errcode='22023';
 end if;
 update public.company_operating_costs set status=p_status,updated_by=v_uid,
   incurred_on=case when p_status='INCURRED' and incurred_on is null then current_date else incurred_on end,
   external_reference=case when p_status='PAID' then btrim(p_external_reference) else external_reference end,
   updated_at=clock_timestamp()
   where id=p_cost_id;
 insert into public.company_operating_cost_events(cost_id,actor_id,event,old_status,new_status,note)
 values(p_cost_id,v_uid,'STATE_CHANGE',v_cost.status,p_status,btrim(coalesce(p_note,'')));
 return jsonb_build_object('ok',true,'status',p_status);
end $$;
revoke all on function public.staff_transition_company_cost(uuid,text,text,text) from public,anon;
grant execute on function public.staff_transition_company_cost(uuid,text,text,text) to authenticated;

create or replace function public.staff_company_cost_summary()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_planned bigint; v_incurred bigint; v_paid bigint; v_count bigint;
begin
 if v_uid is null or not public.has_permission(v_uid,'finance.costs.view') then
  raise exception 'not_authorised' using errcode='42501';
 end if;
 select coalesce(sum(amount_minor) filter(where status='PLANNED'),0),
        coalesce(sum(amount_minor) filter(where status='INCURRED'),0),
        coalesce(sum(amount_minor) filter(where status='PAID'),0),count(*)
  into v_planned,v_incurred,v_paid,v_count
  from public.company_operating_costs;
 return jsonb_build_object('currency','USD','plannedMinor',v_planned::text,
  'incurredMinor',v_incurred::text,'paidMinor',v_paid::text,
  'records',v_count,'asOf',statement_timestamp());
end $$;
revoke all on function public.staff_company_cost_summary() from public,anon;
grant execute on function public.staff_company_cost_summary() to authenticated;
