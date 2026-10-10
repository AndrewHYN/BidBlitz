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
