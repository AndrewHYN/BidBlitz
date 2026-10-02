-- ===========================================================================
-- Payment deadline: AWAITING_PAYMENT must not last forever.
--
-- A winning bidder could otherwise hold the seller and the item indefinitely:
-- the auction is SOLD, the transaction waits, and nothing in the state
-- machine moves it. The fix has three parts, all in this file:
--
--   1. payment_settings singleton: the window in seconds (default 72 hours).
--      A dedicated table, NOT fee_settings: a payment deadline is not a fee,
--      and stuffing it into the monetisation row would confuse every reader
--      of both. World-readable like the fee (buyers must see the rule),
--      writable only by privileged roles.
--   2. transactions.payment_due_at: stamped at creation by trigger (never by
--      the client), frozen afterwards. Rows predating this migration keep
--      NULL and stay deadline-less rather than gaining a surprise expiry.
--   3. EXPIRED terminal state + expire_overdue_transactions(): the sweep the
--      cron route calls after settlement. The transaction record is kept
--      (history, not garbage); the auction stays SOLD (the win happened);
--      counts stay (they record the win, not the payment); no payout row can
--      exist (payouts are born on PAID); both parties get a PAYMENT_EXPIRED
--      notice; the seller relists through the existing relist flow.
-- ===========================================================================

-- ---- 1. configuration singleton ---------------------------------------------
create table if not exists public.payment_settings (
  id                     smallint primary key default 1 check (id = 1),
  payment_window_seconds integer not null default 259200 check (payment_window_seconds > 0),
  updated_at             timestamptz not null default now()
);

insert into public.payment_settings (id) values (1) on conflict do nothing;

comment on table public.payment_settings is
  'Payment policy, not monetisation: how long a winner has to pay before the
   transaction expires. Read by the transaction triggers; changed only by
   privileged roles via documented SQL. 259200 = 72 hours.';

-- World-readable policy (the deadline is a public marketplace rule), no
-- client writes: mirrors fee_settings (000001 + 000002 RLS + 000004 grants).
alter table public.payment_settings enable row level security;
drop policy if exists payment_settings_select on public.payment_settings;
create policy payment_settings_select on public.payment_settings
  for select using (true);
revoke update, delete on public.payment_settings from anon, authenticated;

drop trigger if exists payment_settings_touch on public.payment_settings;
create trigger payment_settings_touch before update on public.payment_settings
  for each row execute function private.touch_updated_at();

-- ---- 2. due date on the transaction ------------------------------------------
alter table public.transactions
  add column if not exists payment_due_at timestamptz null;

comment on column public.transactions.payment_due_at is
  'When AWAITING_PAYMENT lapses into EXPIRED. Stamped at creation from
   payment_settings; NULL means predating deadlines (no expiry).';

-- Stamp on insert, freeze on update. A buyer must never be able to move
-- their own deadline, and no code path sets it directly.
create or replace function public.transactions_protect_due_at()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_window integer;
begin
  if tg_op = 'INSERT' then
    if new.payment_due_at is null then
      select payment_window_seconds into v_window
        from public.payment_settings where id = 1;
      new.payment_due_at :=
        now() + make_interval(secs => coalesce(v_window, 259200));
    end if;
    return new;
  end if;
  if new.payment_due_at is distinct from old.payment_due_at then
    raise exception 'transaction_due_date_immutable' using errcode = '25001';
  end if;
  return new;
end;
$$;

drop trigger if exists transactions_protect_due_at on public.transactions;
create trigger transactions_protect_due_at
  before insert or update on public.transactions
  for each row execute function public.transactions_protect_due_at();

-- ---- 3. EXPIRED state ---------------------------------------------------------
-- Explicit terminal state, not a reuse of FAILED: FAILED means the provider
-- reported the payment will not complete; EXPIRED means the winner never
-- paid in time. Collapsing them would destroy the audit distinction between
-- "Paynow said no" and "nobody paid".
alter table public.transactions
  drop constraint if exists transactions_status_check;
alter table public.transactions
  add constraint transactions_status_check
  check (status in (
    'AWAITING_PAYMENT','PAID','SETTLED','REFUNDED','FAILED','EXPIRED'
  ));

-- Extend the transition map in place: AWAITING_PAYMENT gains the EXPIRED
-- edge, EXPIRED itself has no out-edges (terminal, like FAILED). The body is
-- otherwise byte-faithful to 20260925000001_phase2_commerce.sql — including
-- the updated_at bump — so the only behavioral change is the new edge.
create or replace function private.transactions_protect_state()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.auction_id is distinct from old.auction_id
     or new.seller_id is distinct from old.seller_id
     or new.buyer_id is distinct from old.buyer_id
     or new.currency is distinct from old.currency
     or new.gross_minor is distinct from old.gross_minor
     or new.fee_bps is distinct from old.fee_bps
     or new.fee_minor is distinct from old.fee_minor
     or new.net_minor is distinct from old.net_minor
     or new.created_at is distinct from old.created_at then
    raise exception 'transaction_money_immutable';
  end if;

  if current_user not in ('postgres', 'supabase_admin', 'service_role') then
    raise exception 'transaction_state_immutable';
  end if;

  if new.provider is distinct from old.provider
     and old.provider is not null then
    raise exception 'transaction_provider_immutable';
  end if;
  if new.provider_reference is distinct from old.provider_reference
     and old.provider_reference is not null then
    raise exception 'transaction_provider_immutable';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'AWAITING_PAYMENT' and new.status in ('PAID', 'FAILED', 'EXPIRED'))
      or (old.status = 'PAID' and new.status in ('SETTLED', 'REFUNDED'))
    ) then
      raise exception 'transaction_invalid_transition';
    end if;
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

comment on function private.transactions_protect_state() is
  'BEFORE UPDATE freeze: money columns immutable for every role, status moves
   only along AWAITING_PAYMENT -> PAID|FAILED|EXPIRED and PAID ->
   SETTLED|REFUNDED, provider fields single-write. SECURITY INVOKER on purpose
   so current_user distinguishes engine roles from clients (same pattern as
   private.auctions_protect_state).';

-- ---- 4. expiry sweep -----------------------------------------------------------
-- Idempotent, lock-safe, service-only. Returns the expired rows so the cron
-- route can announce (realtime) and email (outbox) after the commit, exactly
-- like the settlement sweep does.
create or replace function public.expire_overdue_transactions(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_row   record;
  v_n     integer := 0;
  v_out   jsonb := '[]'::jsonb;
begin
  for v_row in
    select t.id, t.auction_id, t.buyer_id, t.seller_id, a.title
      from public.transactions t
      join public.auctions a on a.id = t.auction_id
     where t.status = 'AWAITING_PAYMENT'
       and t.payment_due_at is not null
       and t.payment_due_at <= now()
     order by t.payment_due_at asc
     limit v_limit
     for update of t skip locked
  loop
    update public.transactions set status = 'EXPIRED' where id = v_row.id;
    insert into public.notifications (user_id, type, auction_id, payload)
    values
      (v_row.buyer_id, 'PAYMENT_EXPIRED', v_row.auction_id,
       jsonb_build_object('title', v_row.title, 'transactionId', v_row.id, 'isSeller', false)),
      (v_row.seller_id, 'PAYMENT_EXPIRED', v_row.auction_id,
       jsonb_build_object('title', v_row.title, 'transactionId', v_row.id, 'isSeller', true));
    v_out := v_out || jsonb_build_object(
      'transaction_id', v_row.id, 'auction_id', v_row.auction_id,
      'buyer_id', v_row.buyer_id, 'seller_id', v_row.seller_id, 'title', v_row.title);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('expired', v_n, 'items', v_out);
end;
$$;

revoke all on function public.expire_overdue_transactions(integer)
  from public, anon, authenticated;
grant execute on function public.expire_overdue_transactions(integer)
  to postgres, supabase_admin, service_role;

-- ---- 5. notification type -------------------------------------------------------
alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'AUCTION_PUBLISHED','NEW_BID','OUTBID','ENDING_SOON',
    'WON','SOLD','ENDED_UNSOLD','REVIEW_REQUEST','LISTING_REMOVED',
    'BID_CONFIRMED',
    'REVIEW_SUBMITTED','REVIEW_APPROVED','REVIEW_REJECTED','REVIEW_CHANGES_REQUESTED',
    'CANCELLATION_REQUESTED','CANCELLATION_DECIDED',
    'AUCTION_PAUSED','AUCTION_RESUMED','AUCTION_CANCELLED',
    'NEW_MESSAGE','PAYMENT_EXPIRED'
  ));
