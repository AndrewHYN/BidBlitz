-- ===========================================================================
-- Seller payouts - the fulfilment / payout operation, kept SEPARATE from the
-- payment status.
--
-- Business rule this migration encodes:
--
--   PAID  == "Paynow has confirmed the buyer's payment."
--   PAID  != "the seller has received their proceeds."
--
-- The transaction status therefore stays exactly as it is: AWAITING_PAYMENT /
-- PAID / SETTLED / REFUNDED / FAILED, meaning only what Paynow told us about
-- the buyer's money. Overloading it with seller-facing states would make the
-- one column everybody reads mean two different things, and would let a payout
-- decision look like a provider confirmation.
--
-- Instead: one payout row per transaction, created by the database the moment
-- a transaction becomes PAID, freezing the seller's proceeds. Its own status
-- walks the manual fulfilment workflow:
--
--   WAITING_FOR_FULFILMENT -> DELIVERY_CONFIRMED -> PAYOUT_PENDING
--                                                -> PAYOUT_DUE -> PAID_OUT
--        \-> HELD / DISPUTED at any point before PAID_OUT; both are terminal
--            only for PAID_OUT (a hold or a dispute can be released back into
--            the workflow, but PAID_OUT can never be reversed).
--
-- Why the money is frozen here: `amount_minor` is copied from
-- `transactions.net_minor` at creation and can never change afterwards — not
-- for an admin, not for the service role, not for the browser. The currency is
-- copied the same way. If the platform fee is ever recomputed, this row still
-- says what this seller was owed for this sale.
--
-- Who can write:
--   * creation  - engine trigger, from a transaction that reached PAID.
--   * status    - public.admin_transition_seller_payout(), which refuses
--                 anybody who is not profiles.is_admin on their OWN session.
--   * everything else - nobody. INSERT/UPDATE/DELETE are revoked from
--     anon and authenticated, RLS grants SELECT only to admins, and the
--     BEFORE UPDATE trigger freezes the money columns for every role.
--
-- Nothing here moves money. "Record seller payout" means a human already
-- transferred the proceeds through the real external bank/payment process and
-- is writing down the reference. The application must never imply otherwise.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. seller_payouts
-- ---------------------------------------------------------------------------
create table if not exists public.seller_payouts (
  id                 uuid primary key default gen_random_uuid(),
  transaction_id     uuid not null unique references public.transactions(id) on delete restrict,
  seller_id          uuid not null references public.profiles(id) on delete restrict,

  -- frozen at creation from transactions.net_minor / transactions.currency
  amount_minor       bigint not null check (amount_minor >= 0),
  currency           text not null check (currency ~ '^[A-Z]{3}$'),

  status             text not null default 'WAITING_FOR_FULFILMENT'
                       check (status in
                         ('WAITING_FOR_FULFILMENT','DELIVERY_CONFIRMED',
                          'PAYOUT_PENDING','PAYOUT_DUE','PAID_OUT',
                          'HELD','DISPUTED')),

  payout_reference   text check (payout_reference is null or char_length(btrim(payout_reference)) between 1 and 200),
  paid_at            timestamptz,
  internal_note      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- PAID_OUT is the one state that claims money left the platform, so it is
  -- the one state that must carry both the reference and the moment it was
  -- recorded. Enforced by the database, not by the UI.
  constraint payout_paid_out_complete_chk
    check (status <> 'PAID_OUT'
           or (payout_reference is not null and paid_at is not null))
);

comment on table public.seller_payouts is
  'One row per paid transaction: the seller fulfilment / manual payout
   operation. amount_minor and currency are frozen from the transaction at
   creation and are immutable for every role. Status is admin-driven and
   separate from transactions.status, which only ever means what Paynow
   reported about the buyer. Creating this row moves no money.';

create index if not exists seller_payouts_seller_idx
  on public.seller_payouts (seller_id, created_at desc);
create index if not exists seller_payouts_status_idx
  on public.seller_payouts (status)
  where status <> 'PAID_OUT';

-- ---------------------------------------------------------------------------
-- 2. seller_payout_events - the audit trail. Nobody can edit history.
-- ---------------------------------------------------------------------------
create table if not exists public.seller_payout_events (
  id               uuid primary key default gen_random_uuid(),
  payout_id        uuid not null references public.seller_payouts(id) on delete cascade,
  from_status      text,
  to_status        text not null check (to_status in
                     ('WAITING_FOR_FULFILMENT','DELIVERY_CONFIRMED',
                      'PAYOUT_PENDING','PAYOUT_DUE','PAID_OUT',
                      'HELD','DISPUTED')),
  payout_reference text,
  note             text,
  actor_id         uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);

comment on table public.seller_payout_events is
  'Append-only audit of every seller_payouts INSERT and status change: who
   moved it, from what, to what, with which reference. INSERT only; no UPDATE
   or DELETE policy, no client write grant.';

create index if not exists seller_payout_events_payout_idx
  on public.seller_payout_events (payout_id, created_at);

-- ---------------------------------------------------------------------------
-- 3. Table privileges. PostgREST hands new public tables to anon and
--    authenticated by default; the browser must have no write path at all,
--    and SELECT only where an RLS policy says so.
-- ---------------------------------------------------------------------------
revoke all on table public.seller_payouts from anon;
revoke insert, update, delete on table public.seller_payouts from authenticated;
grant  select on table public.seller_payouts to authenticated;

revoke all on table public.seller_payout_events from anon;
revoke insert, update, delete on table public.seller_payout_events from authenticated;
grant  select on table public.seller_payout_events to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS: SELECT for admins only, and for the payout audit trail too.
--    There is deliberately no insert/update/delete policy on either table:
--    RLS and the revoked grants both say the browser cannot write.
-- ---------------------------------------------------------------------------
alter table public.seller_payouts enable row level security;
drop policy if exists seller_payouts_admin_select on public.seller_payouts;
create policy seller_payouts_admin_select on public.seller_payouts
  for select to authenticated
  using (private.is_admin());

alter table public.seller_payout_events enable row level security;
drop policy if exists seller_payout_events_admin_select on public.seller_payout_events;
create policy seller_payout_events_admin_select on public.seller_payout_events
  for select to authenticated
  using (private.is_admin());

-- ---------------------------------------------------------------------------
-- 5. updated_at + freeze + audit triggers on seller_payouts.
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER on purpose: the role doing the UPDATE must be visible, so
-- the freeze can refuse anyone who is not an engine/privileged role (exactly
-- the reasoning used by private.transactions_protect_state).
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
       or new.paid_at is distinct from old.paid_at then
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
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

comment on function private.seller_payouts_protect_state() is
  'BEFORE UPDATE freeze: transaction/seller/amount/currency/created_at are
   immutable for every role, privileged roles only may update at all,
   PAID_OUT is terminal, status follows the explicit fulfilment map, and a
   move to PAID_OUT must carry a reference and a paid_at. SECURITY INVOKER so
   current_user distinguishes engine roles from clients.';

drop trigger if exists seller_payouts_protect_state on public.seller_payouts;
create trigger seller_payouts_protect_state
  before update on public.seller_payouts
  for each row execute function private.seller_payouts_protect_state();

create trigger seller_payouts_touch
  before update on public.seller_payouts
  for each row execute function private.touch_updated_at();

-- SECURITY DEFINER because seller_payout_events carries RLS with no write
-- policy and authenticated holds no INSERT grant: the elevated path is
-- narrow - one INSERT, no reads.
create or replace function private.seller_payouts_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.seller_payout_events
      (payout_id, from_status, to_status, payout_reference, note, actor_id)
    values
      (new.id, null, new.status, new.payout_reference, 'payout record created', auth.uid());
    return new;
  end if;

  -- Only state and reference changes are worth an audit row; a note edit on an
  -- unchanged status is not an operational event.
  if new.status is distinct from old.status
     or new.payout_reference is distinct from old.payout_reference
     or new.paid_at is distinct from old.paid_at then
    insert into public.seller_payout_events
      (payout_id, from_status, to_status, payout_reference, note, actor_id)
    values
      (new.id, old.status, new.status, new.payout_reference, new.internal_note, auth.uid());
  end if;
  return new;
end;
$$;

comment on function private.seller_payouts_audit() is
  'AFTER INSERT OR UPDATE: append one seller_payout_events row per payout
   creation and per state/reference change, tagged with auth.uid(). SECURITY
   DEFINER because clients have no INSERT grant on the audit table.';

drop trigger if exists seller_payouts_audit on public.seller_payouts;
create trigger seller_payouts_audit
  after insert or update on public.seller_payouts
  for each row execute function private.seller_payouts_audit();

-- ---------------------------------------------------------------------------
-- 6. Create the payout the moment Paynow confirms the money.
--
--    SECURITY DEFINER so it works whoever moved the transaction to PAID, and
--    so the insert reaches a table clients cannot write to.
-- ---------------------------------------------------------------------------
create or replace function private.seller_payouts_from_transaction()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'PAID' and old.status is distinct from 'PAID' then
    insert into public.seller_payouts
      (transaction_id, seller_id, amount_minor, currency)
    values
      (new.id, new.seller_id, new.net_minor, new.currency)
    on conflict (transaction_id) do nothing;

  elsif new.status = 'REFUNDED' and old.status is distinct from 'REFUNDED' then
    -- The buyer got their money back, so there is nothing left to pay out.
    -- A payout that has already been recorded as PAID_OUT is left alone: the
    -- administrator has already transferred the proceeds and must deal with
    -- that out of band, not have their record quietly rewritten.
    update public.seller_payouts
       set status         = 'HELD',
           internal_note  = coalesce(internal_note || E'\n', '')
                            || 'Transaction refunded - payout held.'
     where transaction_id = new.id
       and status <> 'PAID_OUT'
       and status <> 'HELD';
  end if;

  return new;
end;
$$;

comment on function private.seller_payouts_from_transaction() is
  'AFTER UPDATE on transactions: creates the seller payout (frozen from
   net_minor/currency) when a transaction reaches PAID, and holds a payout
   that is not yet recorded as paid out when the transaction is refunded.
   Creates no money and moves no money.';

drop trigger if exists seller_payouts_from_transaction on public.transactions;
create trigger seller_payouts_from_transaction
  after update on public.transactions
  for each row execute function private.seller_payouts_from_transaction();

-- ---------------------------------------------------------------------------
-- 7. The only status writer: admin_transition_seller_payout()
--
--    SECURITY DEFINER because it must reach a table whose UPDATE grant has
--    been revoked from every client role. Everything it does is gated on the
--    caller's OWN authenticated session reading profiles.is_admin - a forged
--    body cannot grant itself admin, and RLS is not the only thing standing
--    between the browser and a payout row.
-- ---------------------------------------------------------------------------
create or replace function public.admin_transition_seller_payout(
  p_payout_id        uuid,
  p_to_status        text,
  p_payout_reference text default null,
  p_internal_note    text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_row  public.seller_payouts%rowtype;
  v_ref  text;
  v_note text;
  v_tx   public.transactions%rowtype;
begin
  if v_uid is null then
    raise exception 'payout_not_authenticated';
  end if;

  if not exists (
    select 1 from public.profiles p where p.id = v_uid and p.is_admin
  ) then
    raise exception 'payout_admin_only';
  end if;

  if p_payout_id is null then
    raise exception 'payout_not_found';
  end if;
  if p_to_status not in
     ('WAITING_FOR_FULFILMENT','DELIVERY_CONFIRMED','PAYOUT_PENDING',
      'PAYOUT_DUE','PAID_OUT','HELD','DISPUTED') then
    raise exception 'payout_invalid_status';
  end if;

  v_ref  := nullif(btrim(coalesce(p_payout_reference, '')), '');
  v_note := nullif(btrim(coalesce(p_internal_note, '')), '');

  select * into v_row from public.seller_payouts where id = p_payout_id for update;
  if not found then
    raise exception 'payout_not_found';
  end if;

  if v_row.status = p_to_status then
    return jsonb_build_object(
      'ok', true, 'already', true, 'status', v_row.status, 'payout_id', v_row.id
    );
  end if;

  if p_to_status = 'PAID_OUT' then
    if v_ref is null then
      raise exception 'payout_reference_required';
    end if;
    -- Never pay out against money that is not (or is no longer) there.
    select * into v_tx from public.transactions where id = v_row.transaction_id for update;
    if not found or v_tx.status not in ('PAID', 'SETTLED') then
      raise exception 'payout_transaction_not_payable';
    end if;
  end if;

  update public.seller_payouts
     set status           = p_to_status,
         payout_reference = case when v_ref is not null then v_ref
                                 else payout_reference end,
         internal_note    = case when v_note is null then internal_note
                                 else coalesce(internal_note || E'\n', '') || v_note end,
         paid_at          = case when p_to_status = 'PAID_OUT' then clock_timestamp()
                                 else paid_at end
   where id = p_payout_id;

  return jsonb_build_object(
    'ok', true, 'already', false, 'status', p_to_status, 'payout_id', p_payout_id
  );
end;
$$;

comment on function public.admin_transition_seller_payout(uuid, text, text, text) is
  'Admin-only writer for the seller payout workflow: mark delivery confirmed,
   mark payout pending / payout due, record an externally completed payout
   (PAID_OUT, reference mandatory), hold, or record a dispute. It never moves
   money - "record seller payout" means a human already transferred the
   proceeds externally. Refuses any caller whose own session is not
   profiles.is_admin. EXECUTE: authenticated + service_role.';

revoke execute on function public.admin_transition_seller_payout(uuid, text, text, text)
  from public, anon;
grant execute on function public.admin_transition_seller_payout(uuid, text, text, text)
  to postgres, supabase_admin, service_role, authenticated;

-- ---------------------------------------------------------------------------
-- 8. my_seller_payouts() - the seller's own view, and nothing else.
--
--    The table has no seller-facing SELECT policy because that would also
--    hand the seller `internal_note`, which is operator commentary. This
--    returns the four facts a seller is entitled to and stops there.
-- ---------------------------------------------------------------------------
create or replace function public.my_seller_payouts()
returns table (
  transaction_id uuid,
  status         text,
  amount_minor   bigint,
  currency       text,
  paid_at        timestamptz,
  updated_at     timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select p.transaction_id, p.status, p.amount_minor, p.currency,
         p.paid_at, p.updated_at
    from public.seller_payouts p
   where p.seller_id = auth.uid()
   order by p.created_at desc;
$$;

comment on function public.my_seller_payouts() is
  'Read-only: the calling user''s own seller payouts, with the internal note
   and the payout reference deliberately excluded. SECURITY DEFINER because
   seller_payouts has no seller-facing RLS policy.';

revoke execute on function public.my_seller_payouts() from public, anon;
grant execute on function public.my_seller_payouts()
  to postgres, supabase_admin, service_role, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Backfill: a transaction that was already PAID before this migration
--    still needs its payout row, with the same frozen money.
-- ---------------------------------------------------------------------------
insert into public.seller_payouts
  (transaction_id, seller_id, amount_minor, currency, internal_note)
select t.id, t.seller_id, t.net_minor, t.currency,
       'Created by migration backfill for a transaction already marked PAID.'
  from public.transactions t
 where t.status in ('PAID', 'SETTLED')
   and not exists (
     select 1 from public.seller_payouts p where p.transaction_id = t.id
   )
on conflict (transaction_id) do nothing;

-- ---------------------------------------------------------------------------
-- 10. Least-privilege EXECUTE for the new trigger functions, covering every
--     role that can actually fire them.
-- ---------------------------------------------------------------------------
revoke execute on function private.seller_payouts_protect_state() from public, anon;
revoke execute on function private.seller_payouts_audit() from public, anon;
revoke execute on function private.seller_payouts_from_transaction() from public, anon;

grant execute on function private.seller_payouts_protect_state()
  to postgres, supabase_admin, service_role, authenticated;
grant execute on function private.seller_payouts_audit()
  to postgres, supabase_admin, service_role, authenticated;
grant execute on function private.seller_payouts_from_transaction()
  to postgres, supabase_admin, service_role;
