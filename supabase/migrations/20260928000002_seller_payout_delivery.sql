-- ===========================================================================
-- Seller payouts - record delivery separately from payout movement.
--
-- "Delivery confirmed" is a fact about the seller's side of the sale; it has
-- to survive a hold or a dispute and still be readable afterwards. Deriving it
-- from the current payout status cannot do that: an On hold payout does not
-- say whether delivery was ever confirmed, and guessing would be worse than
-- leaving it blank.
--
-- So: one nullable timestamp, written by the transition itself.
--   * first move into a state past delivery  -> stamped
--   * move back to WAITING_FOR_FULFILMENT    -> cleared (fulfilment restarted)
--   * nothing else touches it, and it is frozen once PAID_OUT
-- ===========================================================================

alter table public.seller_payouts
  add column if not exists delivery_confirmed_at timestamptz;

comment on column public.seller_payouts.delivery_confirmed_at is
  'When the administrator confirmed delivery/pickup. Cleared if fulfilment is
   restarted. Survives holds and disputes, so the delivery fact outlives the
   payout state. Written only by the fulfilment transition, never by a client.';

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
  -- proceeds and recorded it". It is terminal: status, amount, reference and
  -- the recorded moment can never be walked back through ordinary means.
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

    -- Delivery is a fact recorded by the transition, not a guess by the UI.
    if new.status in ('DELIVERY_CONFIRMED','PAYOUT_PENDING','PAYOUT_DUE','PAID_OUT')
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
  'BEFORE UPDATE freeze: transaction/seller/amount/currency/created_at are
   immutable for every role, privileged roles only may update at all,
   PAID_OUT is terminal, status follows the explicit fulfilment map, a move to
   PAID_OUT must carry a reference and a paid_at, and delivery_confirmed_at is
   stamped/cleared by the transition itself. SECURITY INVOKER so current_user
   distinguishes engine roles from clients.';

-- The seller's own view gains the delivery fact and nothing else: still no
-- payout reference, still no internal note. Dropped first because PostgreSQL
-- refuses to change a function's declared return type in place.
drop function if exists public.my_seller_payouts();
create function public.my_seller_payouts()
returns table (
  transaction_id         uuid,
  status                 text,
  amount_minor           bigint,
  currency               text,
  delivery_confirmed_at  timestamptz,
  paid_at                timestamptz,
  updated_at             timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select p.transaction_id, p.status, p.amount_minor, p.currency,
         p.delivery_confirmed_at, p.paid_at, p.updated_at
    from public.seller_payouts p
   where p.seller_id = auth.uid()
   order by p.created_at desc;
$$;

revoke execute on function public.my_seller_payouts() from public, anon;
grant execute on function public.my_seller_payouts()
  to postgres, supabase_admin, service_role, authenticated;
