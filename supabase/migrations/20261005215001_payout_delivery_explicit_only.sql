-- ===========================================================================
-- Delivery is an explicit fulfilment fact. Nothing else may create it.
--
-- Before this migration the protect trigger stamped `delivery_confirmed_at`
-- on the first move into DELIVERY_CONFIRMED, PAYOUT_PENDING, PAYOUT_DUE *or*
-- PAID_OUT, and the transition map let WAITING_FOR_FULFILMENT jump straight
-- to PAYOUT_PENDING. Both made a delivery claim that nobody confirmed, which
-- is a financial-correctness defect: the payout queue would read "the seller
-- delivered" when only "an operator moved a row" had happened.
--
-- The state machine this migration enforces, in full:
--
--   WAITING_FOR_FULFILMENT -> DELIVERY_CONFIRMED -> PAYOUT_PENDING
--                          -> PAYOUT_DUE -> PAID_OUT
--
--   HELD / DISPUTED are side states that re-enter that chain. HELD may hold a
--   provider attempt that failed AFTER a legitimate delivery confirmation, so
--   HELD -> PAYOUT_DUE stays legal - but only when the delivery fact already
--   exists (requirement: a hold never conjures delivery).
--
-- Rules (all enforced here, not in the UI):
--   1. `delivery_confirmed_at` is created ONLY by entering DELIVERY_CONFIRMED.
--   2. PAYOUT_PENDING and PAYOUT_DUE never create or modify it.
--   3. PAID_OUT never creates it.
--   4. WAITING_FOR_FULFILMENT -> PAYOUT_PENDING is refused (map no longer
--      contains it): payout states are unreachable before delivery.
--   5. Every move into PAYOUT_DUE requires the fact to already exist.
--   6. HELD -> PAYOUT_DUE therefore also requires it (same rule, no special
--      case) while remaining reachable for retries.
--   7. The HELD retry path (HELD -> PAYOUT_PENDING -> PAYOUT_DUE, or straight
--      to PAYOUT_DUE) still works whenever delivery was confirmed.
--   8. This file contains no DML: the historical reconciled PAID_OUT row
--      (d6754669…, delivery_confirmed_at NULL) keeps NULL delivery and stays
--      terminal. We do not invent delivery for money that already moved.
--   9. PAID_OUT stays terminal (no branch leaves it, and it stays frozen).
--  10. Money/identity freeze, privileged-role check, PAID_OUT immutability,
--      payout-reference requirement, the audit trigger, RLS and grants are
--      carried over verbatim from 20260928000001/20261005210001.
--
-- Live verification, for whoever applies this (needs SQL access this
-- environment does not have):
--   select pg_get_functiondef('private.seller_payouts_protect_state()'::regprocedure);
--   -- must show `new.status in ('DELIVERY_CONFIRMED','HELD','DISPUTED')` for
--   -- WAITING_FOR_FULFILMENT, `payout_delivery_not_confirmed` before the
--   -- stamp block, and a stamp condition of `new.status = 'DELIVERY_CONFIRMED'`.
--   select id, status, delivery_confirmed_at from public.seller_payouts;
--   -- d6754669… must still be PAID_OUT with delivery_confirmed_at NULL.
-- ===========================================================================

begin;

create or replace function private.seller_payouts_protect_state()
returns trigger
language plpgsql set search_path = ''
as $$
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
$$;

comment on function private.seller_payouts_protect_state() is
  'BEFORE UPDATE freeze: money/identity fields are immutable, PAID_OUT is
   terminal, status follows the fulfilment map WAITING_FOR_FULFILMENT ->
   DELIVERY_CONFIRMED -> PAYOUT_PENDING -> PAYOUT_DUE -> PAID_OUT (HELD and
   DISPUTED re-enter it), PAID_OUT requires a payout reference and paid_at,
   every move into PAYOUT_DUE requires an existing delivery fact, and
   delivery_confirmed_at is created only by entering DELIVERY_CONFIRMED -
   never inferred from PAYOUT_PENDING, PAYOUT_DUE or PAID_OUT.';

commit;
