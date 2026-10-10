-- Safe external SmileCash/EcoCash transfer workflow (no transfer in SQL).
-- Each claim locks a seller payout against automated Linkwa disbursement.
-- The owner/finance operator transfers externally, verifies wallet receipt,
-- then records the exact reference. Old PAYOUT_DUE rows remain untouched.
-- Every amount, destination, and audit event is frozen before payment.
alter table public.payment_settings
  add column if not exists automatic_payouts_enabled boolean not null default false;
-- Preserve a separate emergency payout kill switch, independent of checkout.

create table if not exists public.external_seller_payout_claims (
  payout_id uuid primary key references public.seller_payouts(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency='USD'),
  seller_id uuid not null references public.profiles(id) on delete restrict,
  destination_phone_e164 text not null check (destination_phone_e164 ~ '^\\+[1-9][0-9]{8,14}$'),
  rail text not null check (rail in ('SMILECASH','ECOCASH','BANK_TRANSFER')),
  status text not null default 'RESERVED'
    check (status in ('RESERVED','RECEIPT_CONFIRMED','CANCELLED')),
  reserved_by uuid not null references public.profiles(id) on delete restrict,
  reserved_at timestamptz not null default clock_timestamp(),
  reason text not null check (char_length(btrim(reason)) between 20 and 1000),
  receipt_reference text unique check (
    receipt_reference is null or char_length(btrim(receipt_reference)) between 6 and 200),
  receipt_note text check (
    receipt_note is null or char_length(btrim(receipt_note)) between 25 and 1500),
  confirmed_by uuid references public.profiles(id) on delete restrict,
  confirmed_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  cancelled_at timestamptz,
  check ((status='RECEIPT_CONFIRMED' and receipt_reference is not null
          and confirmed_by is not null and confirmed_at is not null)
         or status<>'RECEIPT_CONFIRMED'),
  check ((status='CANCELLED' and cancelled_at is not null) or status<>'CANCELLED')
);
create index if not exists external_seller_payouts_by_status
 on public.external_seller_payout_claims(status,reserved_at);

create table if not exists public.external_seller_payout_events (
 id uuid primary key default gen_random_uuid(),
 payout_id uuid not null references public.seller_payouts(id) on delete restrict,
 actor_id uuid references public.profiles(id),
 event_type text not null check(event_type in ('RESERVED','RECEIPT_CONFIRMED','CANCELLED')),
 note text not null check (char_length(btrim(note)) between 10 and 1500),
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists external_seller_payout_events_by_payout
 on public.external_seller_payout_events(payout_id,created_at desc);

alter table public.external_seller_payout_claims enable row level security;
alter table public.external_seller_payout_events enable row level security;
revoke all on public.external_seller_payout_claims,
 public.external_seller_payout_events from public,anon,authenticated;
grant select on public.external_seller_payout_claims,
 public.external_seller_payout_events to authenticated;
drop policy if exists external_seller_payout_claims_staff_read on public.external_seller_payout_claims;
create policy external_seller_payout_claims_staff_read
 on public.external_seller_payout_claims for select to authenticated
 using (auth.uid() is not null and public.has_permission(auth.uid(),'payouts.view'));
drop policy if exists external_seller_payout_events_staff_read on public.external_seller_payout_events;
create policy external_seller_payout_events_staff_read
 on public.external_seller_payout_events for select to authenticated
 using (auth.uid() is not null and public.has_permission(auth.uid(),'payouts.view'));

-- Provider instructions and external wallet transfers are mutually exclusive
-- at the database boundary, even if a cron worker read an old status.
create or replace function private.block_linkwa_for_external_claim()
returns trigger language plpgsql set search_path=''
as $block$
begin
 if old.status is distinct from new.status and new.status='PAYOUT_DUE'
   and exists (select 1 from public.external_seller_payout_claims e
               where e.payout_id=new.id and e.status='RESERVED') then
   raise exception 'external_payout_already_reserved' using errcode='42501';
 end if;
 return new;
end;
$block$;
drop trigger if exists zz_external_claim_blocks_linkwa on public.seller_payouts;
create trigger zz_external_claim_blocks_linkwa before update of status
 on public.seller_payouts for each row
 execute function private.block_linkwa_for_external_claim();

-- Extend ONLY the manual, already-received-and-audited terminal transition.
-- Other frozen-money, delivery, and provider-exclusivity rules stay byte-for-byte
-- aligned to the version previously verified in production.
CREATE OR REPLACE FUNCTION private.seller_payouts_protect_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- Money and identity are frozen for EVERY role, engine included.
  if new.id is distinct from old.id
     or new.transaction_id is distinct from old.transaction_id
     or new.seller_id is distinct from old.seller_id
     or new.amount_minor is distinct from old.amount_minor
     or new.currency is distinct from old.currency
     or new.created_at is distinct from old.created_at then
    raise exception 'payout_money_immutable';
  end if;

  if current_user not in ('postgres', 'supabase_admin', 'service_role') then
    raise exception 'payout_state_immutable';
  end if;

  -- PAID_OUT means "an administrator has already transferred this seller's
  -- proceeds and recorded it". It is terminal: status, amount, reference, the
  -- recorded moment and the delivery fact can never be walked back.
  if old.status = 'PAID_OUT' then
    if new.status is distinct from old.status
       or new.payout_reference is distinct from old.payout_reference
       or new.paid_at is distinct from old.paid_at
       or new.delivery_confirmed_at is distinct from old.delivery_confirmed_at then
      raise exception 'payout_paid_out_immutable';
    end if;
  end if;

  -- The delivery fact belongs to this function alone. The ONLY ways it may
  -- change are the two assignments below: created by entering
  -- DELIVERY_CONFIRMED, cleared when fulfilment restarts at
  -- WAITING_FOR_FULFILMENT. A direct write - by an admin, a service role or a
  -- future migration - is refused, so nothing can backdate or erase delivery
  -- outside the state machine. (Entering DELIVERY_CONFIRMED passes this check
  -- because the stamp has not been applied yet at this point in the function.)
  if new.delivery_confirmed_at is distinct from old.delivery_confirmed_at
     and not (new.status = 'WAITING_FOR_FULFILMENT'
              and new.delivery_confirmed_at is null) then
    raise exception 'payout_delivery_immutable';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'WAITING_FOR_FULFILMENT'
        and new.status in ('DELIVERY_CONFIRMED','HELD','DISPUTED'))
      or (old.status = 'DELIVERY_CONFIRMED'
        and new.status in ('PAYOUT_PENDING','PAYOUT_DUE','HELD','DISPUTED'))
      or (old.status = 'PAYOUT_PENDING'
        and new.status in ('DELIVERY_CONFIRMED','PAYOUT_DUE','HELD','DISPUTED'))
      or (old.status in ('DELIVERY_CONFIRMED','PAYOUT_PENDING')
        and new.status = 'PAID_OUT'
        and exists (select 1 from public.external_seller_payout_claims ext
             where ext.payout_id=new.id and ext.status='RECEIPT_CONFIRMED'
               and ext.amount_minor=new.amount_minor and ext.currency=new.currency
               and ext.receipt_reference=new.payout_reference))
      or (old.status = 'PAYOUT_DUE'
        and new.status in ('PAID_OUT','HELD','DISPUTED'))
      or (old.status = 'HELD'
        and new.status in ('WAITING_FOR_FULFILMENT','DELIVERY_CONFIRMED',
                           'PAYOUT_PENDING','PAYOUT_DUE','DISPUTED'))
      or (old.status = 'DISPUTED'
        and new.status in ('WAITING_FOR_FULFILMENT','DELIVERY_CONFIRMED',
                           'PAYOUT_PENDING','PAYOUT_DUE','HELD'))
    ) then
      raise exception 'payout_invalid_transition';
    end if;

    if new.status = 'PAID_OUT'
       and (new.payout_reference is null or btrim(new.payout_reference) = ''
            or new.paid_at is null) then
      raise exception 'payout_reference_required';
    end if;

    -- No payout may be declared due without a delivery that was actually
    -- confirmed first - including the HELD retry path, which reuses the same
    -- rule instead of getting an exception. The historical reconciled PAID_OUT
    -- row never passes through here again: PAID_OUT is terminal.
    if new.status = 'PAYOUT_DUE' and new.delivery_confirmed_at is null then
      raise exception 'payout_delivery_not_confirmed';
    end if;

    -- The single place a delivery fact is ever created. PAYOUT_PENDING,
    -- PAYOUT_DUE and PAID_OUT are deliberately absent: they describe money
    -- moving, not the seller handing the item over.
    if new.status = 'DELIVERY_CONFIRMED' and new.delivery_confirmed_at is null then
      new.delivery_confirmed_at := clock_timestamp();
    elsif new.status = 'WAITING_FOR_FULFILMENT' then
      new.delivery_confirmed_at := null;
    end if;
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$function$
;

create or replace function public.staff_reserve_external_seller_payout(
 p_payout_id uuid,p_rail text,p_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $reserve$
declare
 v_uid uuid:=auth.uid(); v_payout public.seller_payouts%rowtype;
 v_phone text; v_tx public.transactions%rowtype;
begin
 if v_uid is null or not public.has_permission(v_uid,'payouts.transition') then
   raise exception 'not_authorised' using errcode='42501';
 end if;
 if p_rail not in ('SMILECASH','ECOCASH','BANK_TRANSFER')
  or char_length(btrim(coalesce(p_reason,''))) not between 20 and 1000 then
   raise exception 'invalid_reservation' using errcode='22023';
 end if;
 select * into v_payout from public.seller_payouts
  where id=p_payout_id for update;
 if not found then raise exception 'payout_not_found' using errcode='P0002'; end if;
 if v_payout.status not in ('DELIVERY_CONFIRMED','PAYOUT_PENDING')
   or v_payout.payout_reference is not null
   or v_payout.delivery_confirmed_at is null
   or v_payout.currency<>'USD' or v_payout.amount_minor<=0 then
    raise exception 'payout_not_eligible' using errcode='42501';
 end if;
 if exists (select 1 from public.seller_payout_events e
   where e.payout_id=v_payout.id and
   (e.to_status in ('PAYOUT_DUE','PAID_OUT')
    or e.payout_reference is not null)) then
   raise exception 'historical_provider_attempt_exists' using errcode='42501';
 end if;
 if exists(select 1 from public.transaction_disputes d
   where d.transaction_id=v_payout.transaction_id and d.status<>'RESOLVED') then
    raise exception 'dispute_open' using errcode='42501';
 end if;
 select * into v_tx from public.transactions
   where id=v_payout.transaction_id for update;
 if not found or v_tx.status not in ('PAID','SETTLED')
   or v_tx.net_minor is distinct from v_payout.amount_minor then
   raise exception 'sale_not_payable' using errcode='42501';
 end if;
 select r.phone_e164 into v_phone from public.seller_payout_recipients r
   where r.seller_id=v_payout.seller_id;
 if v_phone is null or v_phone !~ '^\\+[1-9][0-9]{8,14}$' then
   raise exception 'recipient_phone_unavailable' using errcode='42501';
 end if;
 -- One claim per payout forever; cancelled claims remain evidence of an attempt.
 insert into public.external_seller_payout_claims(
    payout_id,amount_minor,currency,seller_id,destination_phone_e164,
    rail,reserved_by,reason)
 values(v_payout.id,v_payout.amount_minor,v_payout.currency,v_payout.seller_id,
    v_phone,p_rail,v_uid,btrim(p_reason));
 insert into public.external_seller_payout_events(payout_id,actor_id,event_type,note)
 values (v_payout.id,v_uid,'RESERVED',
  'External wallet payment reserved; provider transfer NOT initiated by BidBlitz.');
 return jsonb_build_object('ok',true,'status','RESERVED');
end;
$reserve$;

create or replace function public.staff_confirm_external_seller_payout(
 p_payout_id uuid,p_receipt_reference text,p_receipt_note text,
 p_seller_receipt_verified boolean)
returns jsonb language plpgsql security definer set search_path=''
as $confirm$
declare
 v_uid uuid:=auth.uid(); v_payout public.seller_payouts%rowtype;
 v_claim public.external_seller_payout_claims%rowtype;
 v_ref text:=nullif(btrim(coalesce(p_receipt_reference,'')),'');
 v_note text:=btrim(coalesce(p_receipt_note,''));
 v_tx public.transactions%rowtype;
begin
 if v_uid is null or not public.has_permission(v_uid,'payouts.mark_paid')
   or p_seller_receipt_verified is distinct from true then
   raise exception 'not_authorised_or_receipt_unverified' using errcode='42501';
 end if;
 if char_length(coalesce(v_ref,'')) not between 6 and 200
  or char_length(v_note) not between 25 and 1500 then
    raise exception 'receipt_evidence_required' using errcode='22023';
 end if;
 select * into v_payout from public.seller_payouts
    where id=p_payout_id for update;
 if not found then raise exception 'payout_not_found' using errcode='P0002'; end if;
 select * into v_claim from public.external_seller_payout_claims
    where payout_id=p_payout_id for update;
 if not found or v_claim.status<>'RESERVED'
  or v_payout.status not in ('DELIVERY_CONFIRMED','PAYOUT_PENDING')
  or v_payout.delivery_confirmed_at is null
  or v_payout.payout_reference is not null
  or v_payout.currency<>v_claim.currency
  or v_payout.amount_minor<>v_claim.amount_minor
  or v_payout.seller_id<>v_claim.seller_id then
   raise exception 'external_payout_not_ready' using errcode='42501';
 end if;
 if exists(select 1 from public.transaction_disputes d
    where d.transaction_id=v_payout.transaction_id and d.status<>'RESOLVED') then
   raise exception 'dispute_open' using errcode='42501';
 end if;
 select * into v_tx from public.transactions
   where id=v_payout.transaction_id for update;
 if not found or v_tx.status not in ('PAID','SETTLED')
    or v_tx.net_minor<>v_claim.amount_minor then
   raise exception 'sale_not_payable' using errcode='42501';
 end if;
 if exists(select 1 from public.seller_payout_events e
   where e.payout_id=v_payout.id and
    (e.to_status in ('PAYOUT_DUE','PAID_OUT') or e.payout_reference is not null)) then
   raise exception 'provider_payout_attempt_exists' using errcode='42501';
 end if;
 -- Change evidence first in this ONE DB transaction. The before-update
 -- payout state machine requires this exact evidence and reference to exist.
 update public.external_seller_payout_claims set
    status='RECEIPT_CONFIRMED',receipt_reference=v_ref,
    receipt_note=v_note,confirmed_at=clock_timestamp(),confirmed_by=v_uid
 where payout_id=p_payout_id;
 update public.seller_payouts set
    status='PAID_OUT',payout_reference=v_ref,paid_at=clock_timestamp(),
    internal_note=concat_ws(E'\\n',nullif(internal_note,''),
      'External payment receipt confirmed by authorized finance staff.')
 where id=p_payout_id;
 insert into public.external_seller_payout_events(payout_id,actor_id,event_type,note)
 values (p_payout_id,v_uid,'RECEIPT_CONFIRMED',
   'External payment receipt independently attested and recorded; exact reference stored.');
 return jsonb_build_object('ok',true,'status','PAID_OUT');
end;
$confirm$;

create or replace function public.staff_cancel_external_seller_payout(
 p_payout_id uuid,p_no_transfer_sent boolean,p_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $cancel$
declare v_uid uuid:=auth.uid(); v_claim public.external_seller_payout_claims%rowtype;
begin
 if v_uid is null or not public.has_permission(v_uid,'payouts.transition')
    or p_no_transfer_sent is distinct from true then
   raise exception 'not_authorised_or_transfer_uncertain' using errcode='42501';
 end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 25 and 1000 then
   raise exception 'reason_required' using errcode='22023';
 end if;
 -- Lock the payout first in the same order as all other payout RPCs.
 perform 1 from public.seller_payouts where id=p_payout_id for update;
 select * into v_claim from public.external_seller_payout_claims
   where payout_id=p_payout_id for update;
 if not found or v_claim.status<>'RESERVED' then
   raise exception 'claim_not_cancellable' using errcode='42501';
 end if;
 update public.external_seller_payout_claims set
   status='CANCELLED',cancelled_by=v_uid,cancelled_at=clock_timestamp()
 where payout_id=p_payout_id;
 insert into public.external_seller_payout_events(payout_id,actor_id,event_type,note)
 values(p_payout_id,v_uid,'CANCELLED',
  'Operator confirmed NO transfer was sent. Reservation cancelled; provider may be used only after fresh checks.');
 return jsonb_build_object('ok',true,'status','CANCELLED');
end;
$cancel$;

revoke all on function public.staff_reserve_external_seller_payout(uuid,text,text)
 from public,anon;
revoke all on function public.staff_confirm_external_seller_payout(uuid,text,text,boolean)
 from public,anon;
revoke all on function public.staff_cancel_external_seller_payout(uuid,boolean,text)
 from public,anon;
grant execute on function public.staff_reserve_external_seller_payout(uuid,text,text)
 to authenticated;
grant execute on function public.staff_confirm_external_seller_payout(uuid,text,text,boolean)
 to authenticated;
grant execute on function public.staff_cancel_external_seller_payout(uuid,boolean,text)
 to authenticated;
