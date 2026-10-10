-- High-value seller money requires two independent active reviewers.
-- Monetary threshold: USD 100.00 in integer cents. Existing historical
-- PAID_OUT rows are untouched. Payments remain paused during rollout.
create table if not exists public.payout_approval_requests (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references public.seller_payouts(id),
  requested_by uuid not null references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  amount_minor bigint not null check (amount_minor >= 10000),
  currency text not null check (currency='USD'),
  status text not null default 'REQUESTED'
    check (status in ('REQUESTED','APPROVED','VOIDED')),
  reason text not null check (char_length(btrim(reason)) between 15 and 1000),
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  requested_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz,
  voided_at timestamptz,
  check (requested_by is distinct from reviewed_by),
  check ((status='APPROVED' and reviewed_by is not null and reviewed_at is not null)
    or (status<>'APPROVED'))
);
create unique index if not exists payout_approval_active_one_per_payout
 on public.payout_approval_requests(payout_id)
 where status in ('REQUESTED','APPROVED');
create index if not exists payout_approval_requests_pending
 on public.payout_approval_requests(status,requested_at desc);

create table if not exists public.payout_approval_events (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.payout_approval_requests(id),
 payout_id uuid not null references public.seller_payouts(id),
 actor_id uuid references public.profiles(id),
 action text not null check (action in ('REQUESTED','APPROVED','VOIDED')),
 note text not null default '',
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists payout_approval_events_by_payout
 on public.payout_approval_events(payout_id, created_at desc);

alter table public.payout_approval_requests enable row level security;
alter table public.payout_approval_events enable row level security;
revoke all on public.payout_approval_requests, public.payout_approval_events
 from public, anon, authenticated;
grant select on public.payout_approval_requests, public.payout_approval_events to authenticated;
drop policy if exists payout_approval_requests_read on public.payout_approval_requests;
create policy payout_approval_requests_read on public.payout_approval_requests
 for select to authenticated using (auth.uid() is not null
 and public.has_permission(auth.uid(),'payouts.view'));
drop policy if exists payout_approval_events_read on public.payout_approval_events;
create policy payout_approval_events_read on public.payout_approval_events
 for select to authenticated using (auth.uid() is not null
 and public.has_permission(auth.uid(),'payouts.view'));

create or replace function public.request_high_value_payout_approval(
 p_payout_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
 v_uid uuid := auth.uid();
 v_payout public.seller_payouts%rowtype;
 v_request_id uuid;
begin
 if v_uid is null or not public.has_permission(v_uid,'payouts.transition') then
    raise exception 'not_authorised' using errcode='42501';
 end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 15 and 1000 then
    raise exception 'reason_required' using errcode='22023';
 end if;
 select * into v_payout from public.seller_payouts where id=p_payout_id for update;
 if not found then raise exception 'payout_not_found' using errcode='P0002'; end if;
 if v_payout.currency <> 'USD' or v_payout.amount_minor < 10000
    or v_payout.delivery_confirmed_at is null
    or v_payout.status not in ('DELIVERY_CONFIRMED','PAYOUT_PENDING','PAYOUT_DUE') then
   raise exception 'payout_not_eligible' using errcode='22023';
 end if;
 if exists(select 1 from public.transaction_disputes d
   where d.transaction_id=v_payout.transaction_id and d.status<>'RESOLVED') then
   raise exception 'dispute_open' using errcode='42501';
 end if;
 if not exists (select 1 from public.transactions t
   where t.id=v_payout.transaction_id and t.status in ('PAID','SETTLED')) then
   raise exception 'payment_not_confirmed' using errcode='22023';
 end if;
 if v_uid = v_payout.seller_id or exists(
   select 1 from public.transactions t where t.id=v_payout.transaction_id
   and t.buyer_id=v_uid) then
   raise exception 'conflicted_reviewer' using errcode='42501';
 end if;
 if exists (select 1 from public.payout_approval_requests a
   where a.payout_id=p_payout_id and a.status in ('REQUESTED','APPROVED')) then
    raise exception 'approval_already_active' using errcode='23505';
 end if;
 insert into public.payout_approval_requests(
  payout_id,requested_by,amount_minor,currency,reason)
 values (v_payout.id,v_uid,v_payout.amount_minor,v_payout.currency,btrim(p_reason))
 returning id into v_request_id;
 insert into public.payout_approval_events(request_id,payout_id,actor_id,action,note)
 values(v_request_id,v_payout.id,v_uid,'REQUESTED','High-value payout authorization requested.');
 return jsonb_build_object('ok',true,'id',v_request_id,'status','REQUESTED');
end
$$;
revoke all on function public.request_high_value_payout_approval(uuid,text) from public,anon;
grant execute on function public.request_high_value_payout_approval(uuid,text) to authenticated;

create or replace function public.review_high_value_payout_approval(
 p_request_id uuid, p_approve boolean, p_note text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
 v_uid uuid := auth.uid();
 v_req public.payout_approval_requests%rowtype;
 v_payout public.seller_payouts%rowtype;
 v_new text;
begin
 if v_uid is null or not public.has_permission(v_uid,'payouts.review') then
   raise exception 'not_authorised' using errcode='42501';
 end if;
 if p_approve is null or char_length(btrim(coalesce(p_note,''))) not between 15 and 1000 then
   raise exception 'review_note_required' using errcode='22023';
 end if;
 select * into v_req from public.payout_approval_requests
  where id=p_request_id for update;
 if not found then raise exception 'approval_not_found' using errcode='P0002'; end if;
 if v_req.status<>'REQUESTED' then
   raise exception 'approval_already_decided' using errcode='22023';
 end if;
 if v_uid=v_req.requested_by then
   raise exception 'self_approval_forbidden' using errcode='42501';
 end if;
 select * into v_payout from public.seller_payouts where id=v_req.payout_id for update;
 if not found or v_payout.status not in ('DELIVERY_CONFIRMED','PAYOUT_PENDING','PAYOUT_DUE')
   or v_payout.delivery_confirmed_at is null
   or v_payout.amount_minor is distinct from v_req.amount_minor
   or v_payout.currency is distinct from v_req.currency then
   raise exception 'payout_not_eligible' using errcode='22023';
 end if;
 if exists (select 1 from public.transaction_disputes d
   where d.transaction_id=v_payout.transaction_id and d.status<>'RESOLVED') then
   raise exception 'dispute_open' using errcode='42501';
 end if;
 if not exists(select 1 from public.transactions t
  where t.id=v_payout.transaction_id and t.status in ('PAID','SETTLED')) then
   raise exception 'payment_not_confirmed' using errcode='22023';
 end if;
 if v_uid=v_payout.seller_id or exists(
   select 1 from public.transactions t where t.id=v_payout.transaction_id
   and t.buyer_id=v_uid) then
   raise exception 'conflicted_reviewer' using errcode='42501';
 end if;
 v_new:=case when p_approve then 'APPROVED' else 'VOIDED' end;
 update public.payout_approval_requests set
   status=v_new, reviewed_by=v_uid, reviewed_at=case when p_approve then clock_timestamp() else null end,
   voided_at=case when p_approve then null else clock_timestamp() end,
   review_note=btrim(p_note)
 where id=v_req.id;
 insert into public.payout_approval_events(request_id,payout_id,actor_id,action,note)
 values (v_req.id,v_req.payout_id,v_uid,case when p_approve then 'APPROVED' else 'VOIDED' end,
   'Independent review decision recorded.');
 return jsonb_build_object('ok',true,'status',v_new);
end
$$;
revoke all on function public.review_high_value_payout_approval(uuid,boolean,text) from public,anon;
grant execute on function public.review_high_value_payout_approval(uuid,boolean,text) to authenticated;

create or replace function private.require_high_value_payout_approval()
returns trigger
language plpgsql set search_path = ''
as $$
begin
 if old.status is distinct from new.status
    and new.status in ('PAYOUT_DUE','PAID_OUT')
    and new.amount_minor >= 10000 then
   if not exists(
     select 1 from public.payout_approval_requests a
       where a.payout_id=new.id and a.status='APPROVED'
         and a.currency=new.currency and a.amount_minor=new.amount_minor
         and public.has_permission(a.requested_by,'payouts.transition')
         and public.has_permission(a.reviewed_by,'payouts.review')
         and a.requested_by<>a.reviewed_by
         and a.requested_by<>new.seller_id
         and a.reviewed_by<>new.seller_id
         and not exists(select 1 from public.transactions t
           where t.id=new.transaction_id and
           (t.buyer_id=a.requested_by or t.buyer_id=a.reviewed_by))
   ) then
     raise exception 'payout_second_approval_required' using errcode='42501';
   end if;
 end if;
 return new;
end
$$;

drop trigger if exists zz_payout_requires_second_approval on public.seller_payouts;
create trigger zz_payout_requires_second_approval
 before update of status on public.seller_payouts
 for each row execute function private.require_high_value_payout_approval();

create or replace function private.void_high_value_payout_approvals_on_hold()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_id uuid;
begin
 if old.status is distinct from new.status
  and new.status in ('HELD','DISPUTED','WAITING_FOR_FULFILMENT') then
   for v_id in
     update public.payout_approval_requests
       set status='VOIDED',voided_at=clock_timestamp()
       where payout_id=new.id and status in ('REQUESTED','APPROVED')
       returning id
   loop
     insert into public.payout_approval_events(request_id,payout_id,actor_id,action,note)
     values(v_id,new.id,auth.uid(),'VOIDED',
       'Automatically invalidated after payout entered a held, disputed or unconfirmed state.');
   end loop;
 end if;
 return new;
end
$$;
drop trigger if exists payout_void_approvals_on_hold on public.seller_payouts;
create trigger payout_void_approvals_on_hold
 after update of status on public.seller_payouts
 for each row execute function private.void_high_value_payout_approvals_on_hold();
