-- ===========================================================================
-- Phase 3b - the server-side settlement fallback (pollurl persistence)
--
-- Additive only. NO engine function and NO existing transition is modified:
-- settlement, fees, anti-sniping, RLS, the freeze triggers and the
-- mark_transaction_* family stay exactly as verified at baseline.
--
-- WHY THIS EXISTS
--
--   `resulturl` remains the PRIMARY settlement signal: Paynow POSTs a signed
--   status update to our webhook and nothing about that path changes here.
--   What test mode proved (ADR-011) is that a push can simply never arrive,
--   which leaves a transaction stuck in AWAITING_PAYMENT with the money
--   actually taken. The documented fallback is to poll the `pollurl` Paynow
--   returns from `initiatetransaction` - but that URL was never stored, so
--   the fallback had nothing to poll.
--
--   This migration stores it. Deliberately:
--     * a NEW table, never a column on `transactions`: the financial record
--       keeps its frozen money columns and gains nothing provider-specific;
--     * RLS on with no policies (same shape as `payment_events`): no
--       PostgREST client can read or forge a payment session URL, which
--       carries a capability token (guid) for reading payment status;
--     * the writer is a narrow SECURITY DEFINER that inserts one row and
--       reads only the transaction it is asked about;
--     * one row per transaction (UNIQUE), latest initiation wins: a buyer who
--       restarts checkout replaces the abandoned session instead of
--       accumulating poll URLs.
--
--   Reading is done by the privileged server client only. Nothing here
--   changes a transaction status: reconciliation still has to authenticate a
--   signed Paynow message and pass mark_transaction_* like every other event.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. payment_intents - where a Paynow payment session for a transaction lives.
--
--     poll_url         the CheckPayment guid URL. The ONLY way to read current
--                      status server-side when no push arrives.
--     browser_url      where the buyer was sent; kept for audit/debugging of
--                      an abandoned session, never rendered to a client.
--     provider_reference  Paynow's own reference at initiation time.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_intents (
  id                uuid primary key default gen_random_uuid(),
  transaction_id    uuid not null unique references public.transactions(id) on delete cascade,
  provider          text not null check (char_length(provider) between 1 and 40),
  poll_url          text not null check (char_length(poll_url) between 1 and 2000),
  browser_url       text,
  provider_reference text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.payment_intents enable row level security;
revoke all on table public.payment_intents from anon, authenticated;

comment on table public.payment_intents is
  'Server-only record of the provider payment session for a transaction
   (Paynow pollurl). RLS with no policies: unreadable and unwritable from any
   PostgREST client. Never a source of payment truth on its own - status only
   ever changes through an authenticated provider message.';

-- ---------------------------------------------------------------------------
-- 2. record_payment_intent - the sole writer.
--
--     * the transaction must exist (an intent for a row we do not own is
--       rejected rather than silently stored);
--     * UPSERT: a repeated initiation replaces the session, so reconciliation
--       always polls the newest one and abandoned sessions cannot linger;
--     * provider fields are first-write-wins only where the new value is
--       absent, so a later initiation without a reference cannot erase one.
-- ---------------------------------------------------------------------------
create or replace function public.record_payment_intent(
  p_transaction_id     uuid,
  p_provider           text,
  p_poll_url           text,
  p_browser_url        text default null,
  p_provider_reference text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_exists boolean;
begin
  if p_transaction_id is null or p_provider is null
     or p_poll_url is null or char_length(p_poll_url) = 0 then
    raise exception 'payment_invalid_request';
  end if;

  select exists(select 1 from public.transactions where id = p_transaction_id)
    into v_exists;
  if not coalesce(v_exists, false) then
    raise exception 'transaction_not_found';
  end if;

  insert into public.payment_intents
    (transaction_id, provider, poll_url, browser_url, provider_reference)
  values
    (p_transaction_id, p_provider, p_poll_url, p_browser_url, p_provider_reference)
  on conflict (transaction_id) do update
    set poll_url          = excluded.poll_url,
        browser_url       = coalesce(excluded.browser_url, public.payment_intents.browser_url),
        provider_reference = coalesce(excluded.provider_reference,
                                      public.payment_intents.provider_reference),
        updated_at        = clock_timestamp();

  return jsonb_build_object('ok', true, 'transaction_id', p_transaction_id);
end;
$$;

comment on function public.record_payment_intent(uuid, text, text, text, text) is
  'Store (or replace) the provider payment session for a transaction. Writes
   payment_intents only: it never touches a transaction status. EXECUTE:
   privileged roles only.';

revoke execute on function public.record_payment_intent(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_payment_intent(uuid, text, text, text, text)
  to postgres, supabase_admin, service_role;
