-- Operations 2.0: least-privilege departments, finance read desk, and provider instruction acknowledgement.
-- Backward compatible while payments_enabled remains false. NO FUNDS MOVED HERE.

insert into public.staff_permissions (key, category, description, sensitive) values
 ('marketing.view', 'marketing', 'Access the marketing campaign workspace without pricing or payout powers.', false)
on conflict (key) do nothing;

insert into public.staff_roles (key, name, description, is_system) values
 ('MARKETING', 'Marketing & Growth', 'Campaign creation and tracking only; no promotion pricing, payouts or customer finances.', true),
 ('DISPUTES', 'Dispute Resolution', 'Investigate buyer and seller cases, with no payout release authority.', true),
 ('FINANCE_VIEWER', 'Finance Analyst', 'Read financial operations, never create or mark a payout.', true),
 ('TRUST_SAFETY', 'Trust & Safety', 'Monitor abuse and reports, without financial or promotion powers.', true)
on conflict (key) do nothing;

insert into public.staff_role_permissions (role_key, permission_key)
select grants.role_key, grants.permission_key
from (values
 ('MARKETING', 'admin.access'), ('MARKETING', 'marketing.view'),
 ('DISPUTES', 'admin.access'), ('DISPUTES', 'disputes.view'),
 ('DISPUTES', 'disputes.manage'), ('DISPUTES', 'users.view'),
 ('FINANCE_VIEWER', 'admin.access'), ('FINANCE_VIEWER', 'payments.view'),
 ('FINANCE_VIEWER', 'payouts.view'),
 ('TRUST_SAFETY', 'admin.access'), ('TRUST_SAFETY', 'reports.view'),
 ('TRUST_SAFETY', 'listings.view'), ('TRUST_SAFETY', 'users.view')
) grants(role_key, permission_key)
join public.staff_roles r on r.key = grants.role_key
join public.staff_permissions p on p.key = grants.permission_key
on conflict (role_key, permission_key) do nothing;

-- A read-only SECDEF projection: RLS for raw transactions and seller payouts
-- remains unchanged; staff can only read an intentionally bounded projection
-- after verifying LIVE assigned financial permissions.
create or replace function public.admin_finance_operations(p_limit integer default 75)
returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $$
declare
 v_uid uuid := auth.uid();
 v_can_payments boolean;
 v_can_payouts boolean;
 v_transactions jsonb := '[]'::jsonb;
 v_payouts jsonb := '[]'::jsonb;
begin
 if v_uid is null then
   raise exception 'not_authenticated' using errcode = '42501';
 end if;
 v_can_payments := public.has_permission(v_uid, 'payments.view');
 v_can_payouts := public.has_permission(v_uid, 'payouts.view');
 if not (v_can_payments or v_can_payouts) then
   raise exception 'not_authorised' using errcode = '42501';
 end if;
 if p_limit is null or p_limit < 1 or p_limit > 100 then
   raise exception 'invalid_limit' using errcode = '22023';
 end if;

 if v_can_payments then
   select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_transactions
   from (
     select t.id, t.status, t.provider,
            t.provider_reference as "providerReference",
            t.gross_minor::text as "grossMinor",
            t.fee_minor::text as "feeMinor",
            t.net_minor::text as "sellerMinor",
            t.currency, t.created_at as "createdAt",
            t.updated_at as "updatedAt",
            a.title as "auctionTitle",
            coalesce(s.display_name, s.username, 'Seller') as "sellerName",
            coalesce(b.display_name, b.username, 'Buyer') as "buyerName"
     from public.transactions t
     left join public.auctions a on a.id = t.auction_id
     left join public.profiles s on s.id = t.seller_id
     left join public.profiles b on b.id = t.buyer_id
     order by t.created_at desc, t.id desc
     limit p_limit
   ) q;
 end if;

 if v_can_payouts then
   select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_payouts
   from (
     select p.id, p.transaction_id as "transactionId", p.status,
            p.amount_minor::text as "amountMinor", p.currency,
            p.payout_reference as "payoutReference", p.paid_at as "paidAt",
            p.delivery_confirmed_at as "deliveryConfirmedAt",
            p.updated_at as "updatedAt",
            t.status as "paymentStatus", t.gross_minor::text as "grossMinor",
            t.fee_minor::text as "feeMinor",
            a.title as "auctionTitle",
            coalesce(s.display_name, s.username, 'Seller') as "sellerName",
            (r.setup_status = 'READY' and r.external_wallet_id is not null and r.external_user_id is not null) is true as "walletReady",
            exists (select 1 from public.transaction_disputes d
              where d.transaction_id = p.transaction_id and d.status <> 'RESOLVED') as "hasOpenDispute"
     from public.seller_payouts p
     join public.transactions t on t.id = p.transaction_id
     left join public.auctions a on a.id = t.auction_id
     left join public.profiles s on s.id = p.seller_id
     left join public.seller_payout_recipients r on r.seller_id = p.seller_id
     order by case p.status when 'PAYOUT_DUE' then 0 when 'DISPUTED' then 1
       when 'HELD' then 2 when 'PAYOUT_PENDING' then 3
       when 'DELIVERY_CONFIRMED' then 4 when 'WAITING_FOR_FULFILMENT' then 5
       else 6 end, p.created_at desc, p.id desc
     limit p_limit
   ) q;
 end if;
 return jsonb_build_object(
    'asOf', clock_timestamp(), 'limit', p_limit,
    'canViewPayments', v_can_payments, 'canViewPayouts', v_can_payouts,
    'transactions', v_transactions, 'payouts', v_payouts);
end
$$;

revoke all on function public.admin_finance_operations(integer) from public, anon;
grant execute on function public.admin_finance_operations(integer) to authenticated, service_role;

-- Record provider acceptance as INSTRUCTED / NEEDS RECONCILIATION, not PAID_OUT.
-- The Linkwa payout API acknowledges an instruction but no separate payout
-- status endpoint is currently verified. Never infer seller receipt from POST.
create or replace function public.service_record_payout_instruction(
  p_payout_id uuid, p_provider_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_reference text := nullif(btrim(coalesce(p_provider_reference,'')),'');
 v_payout public.seller_payouts%rowtype;
begin
 if auth.role() <> 'service_role' then
   raise exception 'service_only' using errcode = '42501';
 end if;
 if p_payout_id is null or v_reference is null or char_length(v_reference) > 200 then
   raise exception 'invalid_reference' using errcode = '22023';
 end if;
 select * into v_payout from public.seller_payouts
  where id=p_payout_id for update;
 if not found then raise exception 'payout_not_found' using errcode = 'P0002'; end if;
 if v_payout.status <> 'PAYOUT_DUE' then
   raise exception 'payout_not_pending_reconciliation' using errcode = 'P0001';
 end if;
 if v_payout.payout_reference = v_reference then
   return jsonb_build_object('ok',true,'already',true,'status','PAYOUT_DUE');
 end if;
 if v_payout.payout_reference is not null then
   raise exception 'different_provider_reference' using errcode = 'P0001';
 end if;
 update public.seller_payouts set payout_reference=v_reference
   where id=p_payout_id;
 insert into public.seller_payout_events
  (payout_id, from_status, to_status, payout_reference, note)
 values (p_payout_id, 'PAYOUT_DUE','PAYOUT_DUE',v_reference,
  'Provider accepted payout instruction; final settlement NOT independently verified.');
 return jsonb_build_object('ok',true,'already',false,'status','PAYOUT_DUE');
end
$$;

revoke all on function public.service_record_payout_instruction(uuid,text) from public, anon, authenticated;
grant execute on function public.service_record_payout_instruction(uuid,text) to service_role;


-- A truthful live HQ for every department, including staff whose RLS does NOT
-- allow reading raw moderator/payment tables. A null is "not authorized" and
-- a failed RPC is "unavailable", never falsely counted as an empty queue.
create or replace function public.admin_operations_queue_counts()
returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $$
declare
 v_uid uuid := auth.uid();
 v_reviews integer;
 v_cancellations integer;
 v_paused integer;
 v_reports integer;
 v_disputes integer;
 v_promotions integer;
 v_payouts integer;
begin
 if v_uid is null or not public.has_permission(v_uid,'admin.access') then
   raise exception 'not_authorised' using errcode='42501';
 end if;
 if public.has_permission(v_uid,'listings.review') then
   select count(*)::integer into v_reviews from public.listing_reviews where status='PENDING';
 end if;
 if public.has_permission(v_uid,'auctions.review_cancellation') then
   select count(*)::integer into v_cancellations from public.auction_cancellation_requests where status='PENDING';
 end if;
 if public.has_permission(v_uid,'auctions.view') then
   select count(*)::integer into v_paused from public.auctions where status='PAUSED';
 end if;
 if public.has_permission(v_uid,'reports.view') then
   select count(*)::integer into v_reports from public.reports where status in ('OPEN','REVIEWING');
 end if;
 if public.has_permission(v_uid,'disputes.view') then
   select count(*)::integer into v_disputes from public.transaction_disputes where status <> 'RESOLVED';
 end if;
 if public.has_permission(v_uid,'settings.manage_marketplace') then
   select count(*)::integer into v_promotions from public.promotion_requests where status='PENDING';
 end if;
 if public.has_permission(v_uid,'payouts.view') then
   select count(*)::integer into v_payouts from public.seller_payouts
     where status in ('PAYOUT_DUE','PAYOUT_PENDING');
 end if;
 return jsonb_build_object(
   'reviews',v_reviews,'cancellations',v_cancellations,'paused',v_paused,
   'reports',v_reports,'disputes',v_disputes,'promotions',v_promotions,
   'payouts',v_payouts,'asOf',statement_timestamp());
end
$$;
revoke all on function public.admin_operations_queue_counts() from public, anon;
grant execute on function public.admin_operations_queue_counts() to authenticated, service_role;
