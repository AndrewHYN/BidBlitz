-- Dedicated dispute operators, due-by targets and PRIVATE case notes.
-- The public buyer/seller dispute timeline stays unchanged. No payout mutation.

create table if not exists public.dispute_ops_cases (
 dispute_id uuid primary key references public.transaction_disputes(id),
 assigned_to uuid not null references public.profiles(id),
 priority text not null default 'NORMAL' check (priority in ('NORMAL','HIGH','URGENT')),
 next_action_at timestamptz not null,
 assigned_by uuid not null references public.profiles(id),
 updated_by uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create index if not exists dispute_ops_cases_assignee_due
 on public.dispute_ops_cases(assigned_to,next_action_at);

create table if not exists public.dispute_ops_events (
 id uuid primary key default gen_random_uuid(),
 dispute_id uuid not null references public.transaction_disputes(id),
 actor_id uuid not null references public.profiles(id),
 event_type text not null check (event_type in ('ASSIGNED','REASSIGNED','INTERNAL_NOTE')),
 description text not null check (char_length(btrim(description)) between 10 and 3000),
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists dispute_ops_events_case_time
 on public.dispute_ops_events(dispute_id,created_at desc);

alter table public.dispute_ops_cases enable row level security;
alter table public.dispute_ops_events enable row level security;
revoke all on public.dispute_ops_cases,public.dispute_ops_events from public,anon,authenticated;
grant select on public.dispute_ops_cases,public.dispute_ops_events to authenticated;
drop policy if exists dispute_ops_cases_read on public.dispute_ops_cases;
create policy dispute_ops_cases_read on public.dispute_ops_cases for select to authenticated
using (auth.uid() is not null and public.has_permission(auth.uid(),'disputes.manage'));
drop policy if exists dispute_ops_events_read on public.dispute_ops_events;
create policy dispute_ops_events_read on public.dispute_ops_events for select to authenticated
using (auth.uid() is not null and public.has_permission(auth.uid(),'disputes.manage'));

create or replace function public.staff_dispute_operators()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_list jsonb;
begin
 if v_uid is null or not public.has_permission(v_uid,'disputes.manage') then
   raise exception 'not_authorised' using errcode='42501';
 end if;
 select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_list
 from (
   select p.id, coalesce(nullif(p.display_name,''),p.username,'Staff') as name
   from public.profiles p
   where exists(select 1 from public.staff_assignments a
     where a.user_id=p.id and a.status='ACTIVE'
     and (a.role_key='OWNER' or exists(
       select 1 from public.staff_role_permissions rp
       where rp.role_key=a.role_key and rp.permission_key='disputes.manage')))
   order by p.id
   limit 100
 ) q;
 return v_list;
end
$$;
revoke all on function public.staff_dispute_operators() from public,anon;
grant execute on function public.staff_dispute_operators() to authenticated;

create or replace function public.staff_assign_dispute_case(
 p_dispute_id uuid, p_assignee uuid, p_priority text, p_target_hours integer
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_uid uuid:=auth.uid();
 v_status text;
 v_existing uuid;
 v_action text;
begin
 if v_uid is null or not public.has_permission(v_uid,'disputes.manage') then
   raise exception 'not_authorised' using errcode='42501';
 end if;
 if p_priority not in ('NORMAL','HIGH','URGENT')
    or p_target_hours not in (24,48,72)
    or p_assignee is null or
    not public.has_permission(p_assignee,'disputes.manage') then
   raise exception 'invalid_assignment' using errcode='22023';
 end if;
 select status into v_status from public.transaction_disputes
  where id=p_dispute_id for update;
 if not found or v_status='RESOLVED' then
   raise exception 'case_not_assignable' using errcode='22023';
 end if;
 select assigned_to into v_existing from public.dispute_ops_cases
   where dispute_id=p_dispute_id;
 v_action:=case when v_existing is null then 'ASSIGNED' else 'REASSIGNED' end;
 insert into public.dispute_ops_cases (
   dispute_id,assigned_to,priority,next_action_at,assigned_by,updated_by)
 values(p_dispute_id,p_assignee,p_priority,
   clock_timestamp()+make_interval(hours=>p_target_hours),v_uid,v_uid)
 on conflict (dispute_id) do update set
   assigned_to=excluded.assigned_to,priority=excluded.priority,
   next_action_at=excluded.next_action_at,updated_by=v_uid,
   updated_at=clock_timestamp();
 insert into public.dispute_ops_events(dispute_id,actor_id,event_type,description)
 values (p_dispute_id,v_uid,v_action,
   format('Assigned staff operator; priority %s; next review in %s hours.',p_priority,p_target_hours));
 return jsonb_build_object('ok',true,'status',v_action);
end
$$;
revoke all on function public.staff_assign_dispute_case(uuid,uuid,text,integer)
 from public,anon;
grant execute on function public.staff_assign_dispute_case(uuid,uuid,text,integer)
 to authenticated;

create or replace function public.staff_add_private_dispute_note(
 p_dispute_id uuid,p_note text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_status text; v_id uuid;
begin
 if v_uid is null or not public.has_permission(v_uid,'disputes.manage') then
   raise exception 'not_authorised' using errcode='42501';
 end if;
 if char_length(btrim(coalesce(p_note,''))) not between 10 and 3000 then
   raise exception 'invalid_note' using errcode='22023';
 end if;
 select status into v_status from public.transaction_disputes
   where id=p_dispute_id for update;
 if not found then raise exception 'case_not_found' using errcode='P0002'; end if;
 -- Keep an internal postmortem possible after resolution, never change outcome.
 insert into public.dispute_ops_events(dispute_id,actor_id,event_type,description)
 values(p_dispute_id,v_uid,'INTERNAL_NOTE',btrim(p_note))
 returning id into v_id;
 return jsonb_build_object('ok',true,'id',v_id);
end
$$;
revoke all on function public.staff_add_private_dispute_note(uuid,text) from public,anon;
grant execute on function public.staff_add_private_dispute_note(uuid,text) to authenticated;
