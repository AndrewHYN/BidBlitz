-- ===========================================================================
-- Phase 3 - payment provider readiness
--
-- Additive only. NO engine function is modified: settlement, fees, anti-
-- sniping, RLS and the SECURITY DEFINER architecture stay exactly as verified
-- at baseline 9e5b709 / 20152a7. No provider is activated by this file.
--
-- What this migration adds, and why:
--
--   The Phase 2 seam could move a transaction in exactly one direction
--   (AWAITING_PAYMENT -> PAID). A real provider also reports a payment that
--   never happened, and money that was returned. The transitions already
--   existed in the transactions freeze trigger (AWAITING_PAYMENT -> FAILED,
--   PAID -> REFUNDED) but had no server-authoritative writer, which meant the
--   allowlist could never be exercised and a callback could only be ignored.
--
--   1. record_payment_event()  - the audit write for a provider event that is
--      authentic and recognised but deliberately changes no state (an
--      in-flight status, a dispute awaiting a human). The table has no
--      PostgREST surface, so without this the audit log would be unreachable.
--   2. mark_transaction_failed()   AWAITING_PAYMENT -> FAILED, idempotent.
--   3. mark_transaction_refunded() PAID -> REFUNDED, idempotent.
--
--   Every property of mark_transaction_paid() is preserved: row lock, one
--   explicit transition per function, (provider, event_id) dedupe, status and
--   audit row committing together, EXECUTE restricted to privileged roles.
--
--   Deliberately NOT added: no amount check on the failure/refund paths. No
--   money moved on a failure, and a refund returns whatever was paid, so
--   requiring equality with the sale amount would reject legitimate events.
--   The amount and currency check stays where it belongs - on the only
--   transition that claims money arrived.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. record_payment_event - audit-only write for a recognised, non-final
--    provider event.
--
--    SECURITY DEFINER because payment_events carries RLS with no policies on
--    purpose: PostgREST clients have no path to it, so the audit log cannot
--    be read or forged from the browser. The elevated path is narrow - it
--    INSERTS one row and reads nothing.
-- ---------------------------------------------------------------------------
create or replace function public.record_payment_event(
  p_provider       text,
  p_event_id       text,
  p_transaction_id uuid,
  p_payload        jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_recorded boolean;
begin
  if p_provider is null or p_event_id is null then
    raise exception 'payment_invalid_request';
  end if;

  insert into public.payment_events
    (provider, event_id, transaction_id, payload)
  values
    (p_provider, p_event_id, p_transaction_id, coalesce(p_payload, '{}'::jsonb))
  on conflict (provider, event_id) do nothing;
  get diagnostics v_recorded = row_count;

  return jsonb_build_object(
    'ok', true,
    'recorded', coalesce(v_recorded, false),
    'event_id', p_event_id
  );
end;
$$;

comment on function public.record_payment_event(text, text, uuid, jsonb) is
  'Audit-only: record a provider event that is authentic and recognised but
   changes no transaction state (in-flight status, dispute). Idempotent by
   (provider, event_id). EXECUTE: privileged roles only.';

revoke execute on function public.record_payment_event(text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_payment_event(text, text, uuid, jsonb)
  to postgres, supabase_admin, service_role;

-- ---------------------------------------------------------------------------
-- 2. mark_transaction_failed - the writer for AWAITING_PAYMENT -> FAILED.
--
--    Properties, in order:
--      * row lock (FOR UPDATE) serialises concurrent webhook deliveries;
--      * FAILED again => already_failed, no write (retry-safe);
--      * only AWAITING_PAYMENT may become FAILED (explicit transition - a
--        PAID transaction can never be cancelled out from under the seller);
--      * payment_events dedupes by (provider, event_id);
--      * status change and audit row commit together (single transaction);
--      * provider fields: first write wins, never overwritten.
-- ---------------------------------------------------------------------------
create or replace function public.mark_transaction_failed(
  p_transaction_id    uuid,
  p_provider          text,
  p_provider_reference text,
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
  if p_transaction_id is null or p_provider is null or p_event_id is null then
    raise exception 'payment_invalid_request';
  end if;

  select * into t from public.transactions where id = p_transaction_id for update;
  if not found then
    raise exception 'transaction_not_found';
  end if;

  if t.status = 'FAILED' then
    return jsonb_build_object('ok', true, 'already_failed', true, 'status', 'FAILED');
  end if;

  if t.status <> 'AWAITING_PAYMENT' then
    raise exception 'payment_invalid_transition';
  end if;

  insert into public.payment_events
    (provider, event_id, transaction_id, payload)
  values
    (p_provider, p_event_id, p_transaction_id, coalesce(p_payload, '{}'::jsonb))
  on conflict (provider, event_id) do nothing;
  get diagnostics v_recorded = row_count;

  update public.transactions
     set status             = 'FAILED',
         provider           = case when t.provider is null
                                   then p_provider else t.provider end,
         provider_reference = case when t.provider_reference is null
                                   then p_provider_reference
                                   else t.provider_reference end,
         updated_at         = clock_timestamp()
   where id = p_transaction_id;

  return jsonb_build_object(
    'ok', true, 'status', 'FAILED',
    'transaction_id', p_transaction_id,
    'recorded', coalesce(v_recorded, false)
  );
end;
$$;

comment on function public.mark_transaction_failed(uuid, text, text, text, jsonb) is
  'Sole path from AWAITING_PAYMENT to FAILED. Row-locked, event-deduplicated,
   auditable, retry-safe. No amount check: no money moved on a failure.
   EXECUTE: privileged roles only.';

revoke execute on function public.mark_transaction_failed(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.mark_transaction_failed(uuid, text, text, text, jsonb)
  to postgres, supabase_admin, service_role;

-- ---------------------------------------------------------------------------
-- 3. mark_transaction_refunded - the writer for PAID -> REFUNDED.
--
--    Provider fields are never touched here: they were written when the
--    payment became PAID and the freeze trigger makes them first-write-wins.
--    The refund reason lives in the audit payload.
-- ---------------------------------------------------------------------------
create or replace function public.mark_transaction_refunded(
  p_transaction_id uuid,
  p_provider       text,
  p_event_id       text,
  p_payload        jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t          public.transactions%rowtype;
  v_recorded boolean;
begin
  if p_transaction_id is null or p_provider is null or p_event_id is null then
    raise exception 'payment_invalid_request';
  end if;

  select * into t from public.transactions where id = p_transaction_id for update;
  if not found then
    raise exception 'transaction_not_found';
  end if;

  if t.status = 'REFUNDED' then
    return jsonb_build_object('ok', true, 'already_refunded', true, 'status', 'REFUNDED');
  end if;

  if t.status <> 'PAID' then
    raise exception 'payment_invalid_transition';
  end if;

  insert into public.payment_events
    (provider, event_id, transaction_id, payload)
  values
    (p_provider, p_event_id, p_transaction_id, coalesce(p_payload, '{}'::jsonb))
  on conflict (provider, event_id) do nothing;
  get diagnostics v_recorded = row_count;

  update public.transactions
     set status     = 'REFUNDED',
         updated_at = clock_timestamp()
   where id = p_transaction_id;

  return jsonb_build_object(
    'ok', true, 'status', 'REFUNDED',
    'transaction_id', p_transaction_id,
    'recorded', coalesce(v_recorded, false)
  );
end;
$$;

comment on function public.mark_transaction_refunded(uuid, text, text, jsonb) is
  'Sole path from PAID to REFUNDED. Row-locked, event-deduplicated, auditable,
   retry-safe. Provider reference fields are deliberately untouched (written
   once, at PAID). EXECUTE: privileged roles only.';

revoke execute on function public.mark_transaction_refunded(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.mark_transaction_refunded(uuid, text, text, jsonb)
  to postgres, supabase_admin, service_role;
