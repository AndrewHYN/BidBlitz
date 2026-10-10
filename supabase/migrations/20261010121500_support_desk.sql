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

-- Login-required ticket creation, bounded to five tickets per customer/hour.
create or replace function public.open_support_ticket(
 p_category text,p_subject text,p_body text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_id uuid;
begin
 if v_uid is null then raise exception 'not_authenticated' using errcode='42501'; end if;
 if p_category is null or p_category not in
   ('ACCOUNT','AUCTION','LISTING','PAYMENT','PAYOUT','SAFETY','OTHER')
   or char_length(btrim(coalesce(p_subject,''))) not between 5 and 160
   or char_length(btrim(coalesce(p_body,''))) not between 10 and 4000 then
   raise exception 'invalid_ticket' using errcode='22023';
 end if;
 if (select count(*) from public.support_tickets where customer_id=v_uid
   and created_at > clock_timestamp()-interval '1 hour') >=5 then
   raise exception 'ticket_rate_limited' using errcode='42900';
 end if;
 insert into public.support_tickets(customer_id,category,subject)
   values(v_uid,p_category,btrim(p_subject)) returning id into v_id;
 insert into public.support_ticket_messages(ticket_id,author_id,body)
   values(v_id,v_uid,btrim(p_body));
 insert into public.support_ticket_events(ticket_id,actor_id,action)
   values(v_id,v_uid,'OPENED');
 return jsonb_build_object('ok',true,'id',v_id);
end $$;
revoke all on function public.open_support_ticket(text,text,text) from public,anon;
grant execute on function public.open_support_ticket(text,text,text) to authenticated;

-- Only the customer or an active authorized support operator may add
-- publicly visible responses. Closed and resolved tickets are immutable.
create or replace function public.reply_support_ticket(
 p_ticket_id uuid,p_body text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_ticket public.support_tickets%rowtype; v_staff boolean;
begin
 if v_uid is null then raise exception 'not_authenticated' using errcode='42501'; end if;
 if char_length(btrim(coalesce(p_body,''))) not between 2 and 4000 then
   raise exception 'invalid_message' using errcode='22023';
 end if;
 select * into v_ticket from public.support_tickets where id=p_ticket_id for update;
 if not found then raise exception 'ticket_not_found' using errcode='P0002'; end if;
 v_staff:=public.has_permission(v_uid,'support.manage');
 if not v_staff and v_ticket.customer_id<>v_uid then
   raise exception 'not_authorised' using errcode='42501';
 end if;
 if v_ticket.status in ('CLOSED','RESOLVED') then
   raise exception 'ticket_closed' using errcode='22023';
 end if;
 insert into public.support_ticket_messages(ticket_id,author_id,body)
   values(v_ticket.id,v_uid,btrim(p_body));
 update public.support_tickets set updated_at=clock_timestamp(),
    status=case when v_staff then 'WAITING_CUSTOMER' else 'OPEN' end
    where id=v_ticket.id;
 insert into public.support_ticket_events(ticket_id,actor_id,action)
   values(v_ticket.id,v_uid,'REPLIED');
 return jsonb_build_object('ok',true,'status',
    case when v_staff then 'WAITING_CUSTOMER' else 'OPEN' end);
end $$;
revoke all on function public.reply_support_ticket(uuid,text) from public,anon;
grant execute on function public.reply_support_ticket(uuid,text) to authenticated;
