-- Keep finance totals and payout actions consistent with verified test classifications and merchant receipt checks.
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
  from public.transactions t
  where not exists(select 1 from private.non_live_financial_records n where n.transaction_id=t.id)
    and status in ('PAID','SETTLED');

  select jsonb_build_object(
    'salesCount', count(*),
    'grossMinor', coalesce(sum(gross_minor),0),
    'feeMinor', coalesce(sum(fee_minor),0),
    'sellerMinor', coalesce(sum(net_minor),0)
  )
  into v_today_money
  from public.transactions t
  where not exists(select 1 from private.non_live_financial_records n where n.transaction_id=t.id)
    and status in ('PAID','SETTLED')
    and updated_at >= v_today;

  select coalesce(
    jsonb_object_agg(status, jsonb_build_object('count', c, 'amountMinor', amount_minor)),
    '{}'::jsonb
  )
  into v_payouts
  from (
    select status, count(*)::integer as c, coalesce(sum(amount_minor),0) as amount_minor
    from public.seller_payouts p
    where not exists(select 1 from private.non_live_financial_records n where n.transaction_id=p.transaction_id)
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
      select count(*) from public.seller_payouts p
      where not exists(select 1 from private.non_live_financial_records n where n.transaction_id=p.transaction_id)
        and status in ('HELD','DISPUTED','PAYOUT_DUE')
    )
  );
end;
$$;


create or replace function private.staff_collection_checks(p_transaction_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not (public.has_permission(auth.uid(),'payments.view') or public.has_permission(auth.uid(),'payouts.view')) then
  raise exception 'not_authorised' using errcode='42501';
 end if;
 if coalesce(cardinality(p_transaction_ids),0) > 100 then raise exception 'too_many_transactions'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
  'transactionId',t.id,'verified',e.transaction_id is not null,
  'nonLive',n.transaction_id is not null,'settlementReference',e.settlement_reference,
  'verifiedAt',e.verified_at))
  from public.transactions t
  left join private.merchant_collection_evidence e on e.transaction_id=t.id
  left join private.non_live_financial_records n on n.transaction_id=t.id
  where t.id=any(p_transaction_ids)), '[]'::jsonb);
end;
$$;
