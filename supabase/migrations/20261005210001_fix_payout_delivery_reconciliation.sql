-- ===========================================================================
-- Correct seller payout delivery semantics after Linkwa sandbox reconciliation.
--
-- PAID_OUT proves a provider payout instruction was accepted/recorded.
-- It does NOT itself prove seller delivery. A normal PAYOUT_DUE path already
-- carries the delivery fact; a historical provider-side payout reconciliation
-- may legitimately have no delivery fact.
--
-- Therefore PAID_OUT must never infer delivery_confirmed_at.
-- This migration also clears the one known sandbox reconciliation fixture that
-- was incorrectly stamped by the previous trigger. The exact UUID/reference
-- guard makes this a no-op in production where that sandbox row does not exist.
-- ===========================================================================

begin;

create or replace function private.seller_payouts_protect_state()
returns trigger
language plpgsql set search_path = ''
as $$
begin
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

  if old.status = 'PAID_OUT' then
    if new.status is distinct from old.status
       or new.payout_reference is distinct from old.payout_reference
       or new.paid_at is distinct from old.paid_at
       or new.delivery_confirmed_at is distinct from old.delivery_confirmed_at then
      raise exception 'payout_paid_out_immutable';
    end if;
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'WAITING_FOR_FULFILMENT'
        and new.status in ('DELIVERY_CONFIRMED','PAYOUT_PENDING','HELD','DISPUTED'))
      or (old.status = 'DELIVERY_CONFIRMED'
        and new.status in ('PAYOUT_PENDING','PAYOUT_DUE','HELD','DISPUTED'))
      or (old.status = 'PAYOUT_PENDING'
        and new.status in ('DELIVERY_CONFIRMED','PAYOUT_DUE','HELD','DISPUTED'))
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

    -- Only a state that explicitly means the delivery milestone has been
    -- reached may establish the delivery fact. PAID_OUT is intentionally
    -- excluded: payout movement is not delivery proof.
    if new.status in ('DELIVERY_CONFIRMED','PAYOUT_PENDING','PAYOUT_DUE')
       and new.delivery_confirmed_at is null then
      new.delivery_confirmed_at := clock_timestamp();
    elsif new.status = 'WAITING_FOR_FULFILMENT' then
      new.delivery_confirmed_at := null;
    end if;
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

comment on function private.seller_payouts_protect_state() is
  'BEFORE UPDATE freeze: money/identity fields are immutable, PAID_OUT is
   terminal, status follows the explicit fulfilment map, PAID_OUT requires a
   payout reference and paid_at, and delivery_confirmed_at is stamped only by
   explicit delivery-past states (never inferred from PAID_OUT).';

-- One-time repair of the known sandbox reconciliation fixture. Disable only
-- this trigger for the exact bookkeeping correction, then immediately restore
-- it. No provider call and no status/reference change occurs.
alter table public.seller_payouts disable trigger seller_payouts_protect_state;

update public.seller_payouts
   set delivery_confirmed_at = null
 where id = 'd6754669-f703-494b-bd64-454e57761f23'
   and status = 'PAID_OUT'
   and payout_reference = '01m463ry96b1v2tbk1w42qfhjs'
   and delivery_confirmed_at is not null;

alter table public.seller_payouts enable trigger seller_payouts_protect_state;

commit;
