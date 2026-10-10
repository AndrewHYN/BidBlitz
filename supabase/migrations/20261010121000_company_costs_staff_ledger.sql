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
