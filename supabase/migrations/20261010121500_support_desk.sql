-- Support inbox is separate from financial settlement and dispute judgments.
insert into public.staff_permissions(key,category,description,sensitive)
values('support.manage','SUPPORT','Reply to customer tickets and assign operational follow-ups.',true)
on conflict (key) do nothing;
insert into public.staff_role_permissions(role_key,permission_key)
select g.role_key,g.permission_key from (values
 ('ADMIN','support.manage'),('SUPPORT','support.manage'),
 ('OPERATIONS','support.manage')
) g(role_key,permission_key)
join public.staff_roles r on r.key=g.role_key
join public.staff_permissions p on p.key=g.permission_key
on conflict (role_key,permission_key) do nothing;

create table if not exists public.support_tickets(
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.profiles(id),
 category text not null check(category in
 ('ACCOUNT','AUCTION','LISTING','PAYMENT','PAYOUT','SAFETY','OTHER')),
 subject text not null check(char_length(btrim(subject)) between 5 and 160),
 status text not null default 'OPEN' check(status in
 ('OPEN','IN_REVIEW','WAITING_CUSTOMER','RESOLVED','CLOSED')),
 priority text not null default 'NORMAL' check(priority in ('NORMAL','HIGH','URGENT')),
 assigned_to uuid references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create index if not exists support_tickets_open on public.support_tickets(status,updated_at desc);
create index if not exists support_tickets_owner on public.support_tickets(customer_id,created_at desc);

create table if not exists public.support_ticket_messages(
 id uuid primary key default gen_random_uuid(),
 ticket_id uuid not null references public.support_tickets(id),
 author_id uuid not null references public.profiles(id),
 body text not null check(char_length(btrim(body)) between 2 and 4000),
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists support_messages_ticket_time on public.support_ticket_messages(ticket_id,created_at);

create table if not exists public.support_staff_notes(
 id uuid primary key default gen_random_uuid(),
 ticket_id uuid not null references public.support_tickets(id),
 author_id uuid not null references public.profiles(id),
 body text not null check(char_length(btrim(body)) between 10 and 3000),
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists support_notes_ticket on public.support_staff_notes(ticket_id,created_at);

create table if not exists public.support_ticket_events (
 id uuid primary key default gen_random_uuid(),
 ticket_id uuid not null references public.support_tickets(id),
 actor_id uuid not null references public.profiles(id),
 action text not null check(action in ('OPENED','REPLIED','STATUS_CHANGED','ASSIGNED','PRIVATE_NOTE')),
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists support_events_ticket on public.support_ticket_events(ticket_id,created_at);

alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
alter table public.support_staff_notes enable row level security;
alter table public.support_ticket_events enable row level security;
revoke all on public.support_tickets,public.support_ticket_messages,
 public.support_staff_notes,public.support_ticket_events from public,anon,authenticated;
grant select on public.support_tickets,public.support_ticket_messages,
 public.support_staff_notes,public.support_ticket_events to authenticated;

drop policy if exists support_tickets_scope on public.support_tickets;
create policy support_tickets_scope on public.support_tickets for select to authenticated
using(auth.uid()=customer_id or public.has_permission(auth.uid(),'support.manage'));
drop policy if exists support_messages_scope on public.support_ticket_messages;
create policy support_messages_scope on public.support_ticket_messages for select to authenticated
using(exists(select 1 from public.support_tickets t where t.id=ticket_id
  and (t.customer_id=auth.uid() or public.has_permission(auth.uid(),'support.manage'))));
drop policy if exists support_staff_notes_scope on public.support_staff_notes;
create policy support_staff_notes_scope on public.support_staff_notes for select to authenticated
using(auth.uid() is not null and public.has_permission(auth.uid(),'support.manage'));
drop policy if exists support_ticket_events_scope on public.support_ticket_events;
create policy support_ticket_events_scope on public.support_ticket_events for select to authenticated
using(auth.uid() is not null and public.has_permission(auth.uid(),'support.manage'));
