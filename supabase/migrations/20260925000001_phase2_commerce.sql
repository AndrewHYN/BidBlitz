-- ===========================================================================
-- Phase 2 — commercial-loop completion
--
-- Additive only. NO engine function is modified: settlement, fees, anti-
-- sniping, RLS and the SECURITY DEFINER architecture stay exactly as verified
-- at baseline 9e5b709. Every new EXECUTE follows the least-privilege pattern
-- of migration 000010.
--
-- What this migration adds:
--   1. review rating aggregates (profiles.rating_sum/rating_count existed but
--      nothing ever maintained them, so every profile read "no ratings")
--   2. ENDING_SOON notifications (the enum value and the UI existed; nothing
--      ever produced the event)
--   3. REVIEW_REQUEST notifications (same — produced now at transaction
--      creation, when the reviewable interaction actually exists)
--   4. the payment webhook seam: payment_events audit log, the idempotent
--      mark_transaction_paid() writer, and the transactions freeze trigger
--      that makes the financial record immutable and its status transitions
--      explicit — WITHOUT activating any provider
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Review rating aggregates
--
--    reviews are inserted directly by clients (RLS policy reviews_insert), so
--    the denormalised aggregate has to be maintained in the database, next to
--    the data. Recompute-per-row: exact, idempotent, and safe under any
--    interleaving (no increment that could drift).
-- ---------------------------------------------------------------------------
create or replace function private.sync_review_rating()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if tg_op in ('DELETE', 'UPDATE') then
    v_id := old.reviewee_id;
    update public.profiles
       set rating_sum   = (select coalesce(sum(r.rating), 0)
                             from public.reviews r where r.reviewee_id = v_id),
           rating_count = (select count(*)
                             from public.reviews r where r.reviewee_id = v_id),
           updated_at   = clock_timestamp()
     where id = v_id;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_id := new.reviewee_id;
    update public.profiles
       set rating_sum   = (select coalesce(sum(r.rating), 0)
                             from public.reviews r where r.reviewee_id = v_id),
           rating_count = (select count(*)
                             from public.reviews r where r.reviewee_id = v_id),
           updated_at   = clock_timestamp()
     where id = v_id;
  end if;

  return null; -- AFTER trigger: row is already written
end;
$$;

comment on function private.sync_review_rating() is
  'AFTER INSERT/UPDATE/DELETE on reviews: recompute the reviewee''s rating
   aggregate from the reviews table itself (never increment, never drift).';

drop trigger if exists reviews_sync_rating on public.reviews;
create trigger reviews_sync_rating
  after insert or update or delete on public.reviews
  for each row execute function private.sync_review_rating();

-- ---------------------------------------------------------------------------
-- 2. ENDING_SOON — produced by the same opportunistic paths as settlement
--    (read-path sweep + daily cron), once per auction per recipient.
--
--    Window: the final tenth of the auction's duration, clamped to 30s..1h.
--    Recipients: watchers + the current highest bidder (never the seller —
--    the seller gets NEW_BID on every bid instead).
--
--    Free-tier honest model: if nobody looks at the site during the window
--    and the daily cron arrives after the auction closed, the notice is
--    missed. It is never worth more than a stale badge; no paid scheduler.
-- ---------------------------------------------------------------------------
create or replace function public.notify_ending_soon(p_limit integer)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  with due as (
    select a.id, a.title, a.ends_at, a.seller_id, a.current_bidder_id
      from public.auctions a
     where a.status = 'LIVE'
       and a.ends_at > clock_timestamp()
       and a.ends_at <= clock_timestamp()
             + make_interval(secs => least(3600, greatest(30, a.duration_seconds / 10)))
     order by a.ends_at
     limit p_limit
  ),
  targets as (
    select d.id as auction_id, d.title, d.ends_at, d.seller_id, w.user_id
      from due d
      join public.watchlist w on w.auction_id = d.id
    union
    select d.id, d.title, d.ends_at, d.seller_id, d.current_bidder_id
      from due d
     where d.current_bidder_id is not null
  )
  insert into public.notifications (user_id, type, auction_id, payload)
  select t.user_id, 'ENDING_SOON', t.auction_id,
         jsonb_build_object('title', t.title, 'ends_at', t.ends_at)
    from targets t
   where t.user_id is not null
     and t.user_id <> t.seller_id
     and not exists (
       select 1 from public.notifications n
        where n.user_id = t.user_id
          and n.auction_id = t.auction_id
          and n.type = 'ENDING_SOON'
     );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.notify_ending_soon(integer) is
  'Ending-soon notices for watchers + the current bidder of auctions closing
   within the final tenth of their duration (30s..1h window). Idempotent:
   `not exists` keeps it to one notice per auction per recipient, so the sweep
   and the cron can both call it. EXECUTE: service_role only.';

revoke execute on function public.notify_ending_soon(integer)
  from public, anon, authenticated;
grant execute on function public.notify_ending_soon(integer)
  to postgres, supabase_admin, service_role;

-- ---------------------------------------------------------------------------
-- 3. REVIEW_REQUEST — fired once, at the moment the reviewable interaction
--    exists (transaction creation during settlement). A trigger keeps
--    settle_auction() untouched: the engine stays byte-identical.
--    The reader links to the Transactions page, where the review dialog is.
-- ---------------------------------------------------------------------------
create or replace function private.request_reviews()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_title text;
begin
  select title into v_title from public.auctions where id = new.auction_id;

  insert into public.notifications (user_id, type, auction_id, payload) values
    (new.buyer_id,  'REVIEW_REQUEST', new.auction_id,
      jsonb_build_object('title', v_title,
                         'transaction_id', new.id,
                         'currency', new.currency)),
    (new.seller_id, 'REVIEW_REQUEST', new.auction_id,
      jsonb_build_object('title', v_title,
                         'transaction_id', new.id,
                         'currency', new.currency));
  return null; -- AFTER trigger
end;
$$;

comment on function private.request_reviews() is
  'AFTER INSERT on transactions: ask BOTH parties to review. Transactions are
   inserted exactly once per auction (auction_id UNIQUE), so this fires once.';

drop trigger if exists transactions_request_reviews on public.transactions;
create trigger transactions_request_reviews
  after insert on public.transactions
  for each row execute function private.request_reviews();

-- ---------------------------------------------------------------------------
-- 4a. payment_events — the webhook audit log.
--     Dedupe key (provider, event_id) is what makes provider retries safe:
--     a redelivered event can never be recorded twice.
--     RLS on, no policies: PostgREST clients cannot see or touch it; the
--     server reads it through SECURITY DEFINER code / the service role.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_events (
  id             uuid primary key default gen_random_uuid(),
  provider       text not null check (char_length(provider) between 1 and 40),
  event_id       text not null check (char_length(event_id) between 1 and 200),
  -- no FK on purpose: an audit log must accept a record about a row that a
  -- later lifecycle step (refund, purge) may alter; linkage is by validated
  -- value, written only after mark_transaction_paid confirmed the row.
  transaction_id uuid,
  amount_minor   bigint,
  currency       text,
  payload        jsonb not null default '{}'::jsonb,
  received_at    timestamptz not null default now(),
  unique (provider, event_id)
);

alter table public.payment_events enable row level security;
revoke all on table public.payment_events from anon, authenticated;

comment on table public.payment_events is
  'Webhook audit trail: every provider event received, keyed by
   (provider, event_id) so replays are recorded exactly once.';

-- ---------------------------------------------------------------------------
-- 4b. mark_transaction_paid — the ONE idempotent path to PAID.
--
--     Properties, in order of operation:
--       * row lock (FOR UPDATE) serialises concurrent webhook deliveries;
--       * PAID again => already_paid, no write (retry-safe);
--       * only AWAITING_PAYMENT may become PAID (explicit transition);
--       * amount + currency must equal the recorded sale (the engine's gross,
--         not whatever the caller claims);
--       * payment_events dedupes by (provider, event_id);
--       * status change + audit row commit together (single transaction).
--
--     EXECUTE: service_role only — PostgREST clients have no path here.
-- ---------------------------------------------------------------------------
create or replace function public.mark_transaction_paid(
  p_transaction_id    uuid,
  p_provider          text,
  p_provider_reference text,
  p_amount_minor      bigint,
  p_currency          text,
  p_event_id          text,
  p_payload           jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t          public.transactions%rowtype;
  v_recorded boolean;
begin
  if p_transaction_id is null or p_provider is null
     or p_amount_minor is null or p_currency is null or p_event_id is null then
    raise exception 'payment_invalid_request';
  end if;

  select * into t from public.transactions where id = p_transaction_id for update;
  if not found then
    raise exception 'transaction_not_found';
  end if;

  if t.status = 'PAID' then
    -- idempotent replay of an already-applied event
    return jsonb_build_object('ok', true, 'already_paid', true, 'status', 'PAID');
  end if;

  if t.status <> 'AWAITING_PAYMENT' then
    raise exception 'payment_invalid_transition';
  end if;

  if p_currency is distinct from t.currency
     or p_amount_minor is distinct from t.gross_minor then
    raise exception 'payment_amount_mismatch';
  end if;

  insert into public.payment_events
    (provider, event_id, transaction_id, amount_minor, currency, payload)
  values
    (p_provider, p_event_id, p_transaction_id, p_amount_minor, p_currency,
     coalesce(p_payload, '{}'::jsonb))
  on conflict (provider, event_id) do nothing;
  get diagnostics v_recorded = row_count;

  update public.transactions
     set status             = 'PAID',
         provider           = p_provider,
         provider_reference = p_provider_reference,
         updated_at         = clock_timestamp()
   where id = p_transaction_id;

  return jsonb_build_object(
    'ok', true, 'status', 'PAID',
    'transaction_id', p_transaction_id,
    'recorded', coalesce(v_recorded, false)
  );
end;
$$;

comment on function public.mark_transaction_paid(uuid, text, text, bigint, text, text, jsonb) is
  'Sole path from AWAITING_PAYMENT to PAID. Row-locked, amount-verified,
   event-deduplicated, auditable. A real PaymentProvider''s confirm()
   validates the webhook signature, then calls this — auction and fee code
   never change. EXECUTE: service_role only.';

revoke execute on function public.mark_transaction_paid(uuid, text, text, bigint, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.mark_transaction_paid(uuid, text, text, bigint, text, text, jsonb)
  to postgres, supabase_admin, service_role;

-- ---------------------------------------------------------------------------
-- 4c. transactions freeze — stronger than auctions_protect_state, because a
--     financial record is written once and only its LIFECYCLE moves:
--
--       * money columns (gross/fee/net/fee_bps/currency/parties/created_at)
--         are immutable for EVERY role, engine included — the engine INSERTs
--         the record and never rewrites it;
--       * only privileged roles (postgres/supabase_admin/service_role) may
--         update at all — clients hold no UPDATE grant anyway, this is
--         belt-and-braces;
--       * provider fields: first write wins;
--       * status follows an explicit transition map:
--           AWAITING_PAYMENT -> PAID | FAILED
--           PAID             -> SETTLED | REFUNDED
-- ---------------------------------------------------------------------------
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
      (old.status = 'AWAITING_PAYMENT' and new.status in ('PAID', 'FAILED'))
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
   only along AWAITING_PAYMENT -> PAID|FAILED and PAID -> SETTLED|REFUNDED,
   provider fields single-write. SECURITY INVOKER on purpose so current_user
   distinguishes engine roles from clients (same pattern as
   private.auctions_protect_state).';

drop trigger if exists transactions_protect_state on public.transactions;
create trigger transactions_protect_state
  before update on public.transactions
  for each row execute function private.transactions_protect_state();

-- ---------------------------------------------------------------------------
-- Least-privilege EXECUTE for the new trigger functions (defensive mirror of
-- migration 000010: cover every role that can actually fire the trigger,
-- whatever PostgreSQL's fire-time check behaviour is).
-- ---------------------------------------------------------------------------
revoke execute on function private.sync_review_rating() from public, anon;
revoke execute on function private.request_reviews() from public, anon;
revoke execute on function private.transactions_protect_state() from public, anon;

-- reviews are inserted by authenticated clients, so that role fires
-- sync_rating; the transactions triggers fire from engine roles only.
grant execute on function private.sync_review_rating()
  to postgres, supabase_admin, service_role, authenticated;
grant execute on function private.request_reviews()
  to postgres, supabase_admin, service_role;
grant execute on function private.transactions_protect_state()
  to postgres, supabase_admin, service_role, authenticated;
