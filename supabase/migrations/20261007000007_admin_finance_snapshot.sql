-- Read-only finance snapshot for authorised operators.
-- This aggregates marketplace money without exposing provider secrets.

create or replace function private.admin_finance_snapshot()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  v_today timestamptz := date_trunc('day', clock_timestamp());
  v_all jsonb;
  v_today_money jsonb;
  v_payouts jsonb;
  v_wallets jsonb;
  v_open_disputes integer;
  v_payments_enabled boolean;
  v_fee_bps integer;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if not (
    public.has_permission(v_uid,'payments.view')
    or public.has_permission(v_uid,'payouts.view')
  ) then
    raise exception 'not_authorised' using errcode='42501';
  end if;

  select jsonb_build_object(
    'salesCount', count(*),
    'grossMinor', coalesce(sum(gross_minor),0),
    'feeMinor', coalesce(sum(fee_minor),0),
    'sellerMinor', coalesce(sum(net_minor),0)
  )
  into v_all
  from public.transactions
  where status in ('PAID','SETTLED');

  select jsonb_build_object(
    'salesCount', count(*),
    'grossMinor', coalesce(sum(gross_minor),0),
    'feeMinor', coalesce(sum(fee_minor),0),
    'sellerMinor', coalesce(sum(net_minor),0)
  )
  into v_today_money
  from public.transactions
  where status in ('PAID','SETTLED')
    and updated_at >= v_today;

  select coalesce(
    jsonb_object_agg(status, jsonb_build_object('count', c, 'amountMinor', amount_minor)),
    '{}'::jsonb
  )
  into v_payouts
  from (
    select status, count(*)::integer as c, coalesce(sum(amount_minor),0) as amount_minor
    from public.seller_payouts
    group by status
  ) q;

  select jsonb_build_object(
    'ready', count(*) filter (where setup_status='READY'),
    'needsWallet', count(*) filter (where setup_status='NEEDS_WALLET'),
    'linking', count(*) filter (where setup_status='LINKING'),
    'error', count(*) filter (where setup_status='ERROR'),
    'unlinked', count(*) filter (where setup_status='UNLINKED')
  )
  into v_wallets
  from public.seller_payout_recipients;

  select count(*)::integer into v_open_disputes
  from public.transaction_disputes
  where status <> 'RESOLVED';

  select payments_enabled into v_payments_enabled
  from public.payment_settings where id=1;

  select fee_bps into v_fee_bps
  from public.fee_settings where id=1;

  return jsonb_build_object(
    'asOf', clock_timestamp(),
    'currency', 'USD',
    'feeBps', coalesce(v_fee_bps,0),
    'paymentsEnabled', coalesce(v_payments_enabled,false),
    'allTime', coalesce(v_all,'{}'::jsonb),
    'today', coalesce(v_today_money,'{}'::jsonb),
    'payouts', coalesce(v_payouts,'{}'::jsonb),
    'wallets', coalesce(v_wallets,'{}'::jsonb),
    'openDisputes', coalesce(v_open_disputes,0),
    'awaitingPayment', (
      select count(*) from public.transactions where status='AWAITING_PAYMENT'
    ),
    'attentionPayouts', (
      select count(*) from public.seller_payouts
      where status in ('HELD','DISPUTED','PAYOUT_DUE')
    )
  );
end;
$$;

create or replace function public.admin_finance_snapshot()
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.admin_finance_snapshot();
$$;

revoke all on function private.admin_finance_snapshot() from public,anon;
grant execute on function private.admin_finance_snapshot()
  to authenticated,service_role;

revoke all on function public.admin_finance_snapshot() from public,anon;
grant execute on function public.admin_finance_snapshot()
  to authenticated,service_role;
