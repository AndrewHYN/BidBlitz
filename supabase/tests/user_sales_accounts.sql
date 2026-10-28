-- Run against the migrated database as postgres. Every fixture and change is
-- rolled back. No provider API or payment operation is involved.
begin;
create temp table qa_sales_users as select gen_random_uuid() seller,gen_random_uuid() buyer,
 gen_random_uuid() stranger,gen_random_uuid() finance;
insert into auth.users(id,email,aud,role,raw_user_meta_data,created_at,updated_at)
 select id,'qa-account-'||id::text||'@bidblitz.test','authenticated','authenticated',
 jsonb_build_object('display_name','QA sales account'),now(),now()
 from qa_sales_users u cross join lateral (values(u.seller),(u.buyer),(u.stranger),(u.finance)) x(id);
insert into public.staff_assignments(user_id,role_key,status,reason)
 select finance,'OWNER','ACTIVE','Harness: sales account rollback verification' from qa_sales_users;
select set_config('request.jwt.claims',jsonb_build_object('sub',finance,'role','authenticated')::text,true) from qa_sales_users;
create temp table qa_finance_baseline as select public.admin_finance_snapshot() value;
create temp table qa_sales(label text primary key,transaction_id uuid default gen_random_uuid(),
 auction_id uuid default gen_random_uuid(),seller_id uuid,gross bigint,payout_id uuid);
insert into qa_sales(label,seller_id,gross)
 select label,u.seller,gross from qa_sales_users u cross join (values
 ('UNVERIFIED',100),('HELD',200),('READY',300),('REVIEW',400),('PAID_OUT',500),('NON_LIVE',600)) x(label,gross);
insert into qa_sales(label,seller_id,gross) select 'OTHER_SELLER',stranger,700 from qa_sales_users;
insert into qa_sales(label,seller_id,gross)
 select 'BULK-'||i,seller,100 from qa_sales_users cross join generate_series(1,101) i;
insert into public.auctions(id,seller_id,title,description,condition,location,starting_bid_minor,bid_increment_minor)
 select auction_id,seller_id,'QA sales account '||label,'Rollback-only finance verification fixture.',
 'good','Harare',gross,1 from qa_sales;
insert into public.transactions(id,auction_id,seller_id,buyer_id,currency,gross_minor,fee_bps,fee_minor,net_minor)
 select s.transaction_id,s.auction_id,s.seller_id,u.buyer,'USD',s.gross,500,s.gross/20,s.gross-s.gross/20
 from qa_sales s cross join qa_sales_users u;
update public.transactions t set status='PAID',provider='linkwa',provider_reference='QA-'||s.label
 from qa_sales s where t.id=s.transaction_id;
update qa_sales s set payout_id=p.id from public.seller_payouts p where p.transaction_id=s.transaction_id;
insert into private.non_live_financial_records(transaction_id,reason,evidence_note)
 select transaction_id,'SANDBOX','Rollback fixture: verified sandbox payment, never live cash.' from qa_sales where label='NON_LIVE';
grant select on qa_sales,qa_sales_users,qa_finance_baseline to authenticated,anon,service_role;
create function pg_temp.qa_fail(p_sql text,p_expected text) returns void language plpgsql as $$
begin
 begin execute p_sql;
 exception when others then
  if position(p_expected in sqlerrm)>0 then return; end if;
  raise;
 end;
 raise exception 'Expected refusal: %',p_expected;
end;
$$;

set local role anon;
select pg_temp.qa_fail('select public.my_sales_account()','permission denied');
select pg_temp.qa_fail('select public.staff_collection_checks(array[]::uuid[])','permission denied');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true) from qa_sales_users;
set local role authenticated;
select pg_temp.qa_fail('select * from private.merchant_collection_evidence','permission denied');
select pg_temp.qa_fail('select * from private.non_live_financial_records','permission denied');
select pg_temp.qa_fail(format('select public.record_merchant_collection(%L,%L,100,%L,%L,%L,%L,true)',
 transaction_id,'QA-UNVERIFIED','USD','QA-SETTLEMENT','MERCHANT_STATEMENT',repeat('e',30)),'not_authorised')
 from qa_sales where label='UNVERIFIED';
select pg_temp.qa_fail('select public.staff_collection_checks(array[]::uuid[])','not_authorised');
reset role;

select set_config('request.jwt.claims',jsonb_build_object('sub',finance,'role','authenticated')::text,true) from qa_sales_users;
set local role authenticated;
do $$ declare v jsonb; b jsonb; begin
 v:=public.admin_finance_snapshot(); select value into b from qa_finance_baseline;
 if (v#>>'{allTime,grossMinor}')::bigint-(b#>>'{allTime,grossMinor}')::bigint<>12300
  or (v#>>'{allTime,sellerMinor}')::bigint-(b#>>'{allTime,sellerMinor}')::bigint<>11685
  or (v#>>'{allTime,salesCount}')::int-(b#>>'{allTime,salesCount}')::int<>107 then
  raise exception 'Finance snapshot included a known sandbox payment';
 end if;
end; $$;
select pg_temp.qa_fail(format('select public.record_merchant_collection(%L,%L,99,%L,%L,%L,%L,true)',
 transaction_id,'QA-UNVERIFIED','USD','QA-SETTLEMENT','MERCHANT_STATEMENT',repeat('e',30)),'collection_does_not_match_sale')
 from qa_sales where label='UNVERIFIED';
select pg_temp.qa_fail(format('select public.record_merchant_collection(%L,%L,100,%L,%L,%L,%L,true)',
 transaction_id,'WRONG-REFERENCE','USD','QA-SETTLEMENT','MERCHANT_STATEMENT',repeat('e',30)),'collection_does_not_match_sale')
 from qa_sales where label='UNVERIFIED';
select pg_temp.qa_fail(format('select public.record_merchant_collection(%L,%L,100,%L,%L,%L,%L,true)',
 transaction_id,'QA-UNVERIFIED','ZAR','QA-SETTLEMENT','MERCHANT_STATEMENT',repeat('e',30)),'collection_evidence_incomplete')
 from qa_sales where label='UNVERIFIED';
select pg_temp.qa_fail(format('select public.record_merchant_collection(%L,%L,100,%L,%L,%L,%L,false)',
 transaction_id,'QA-UNVERIFIED','USD','QA-SETTLEMENT','MERCHANT_STATEMENT',repeat('e',30)),'collection_evidence_incomplete')
 from qa_sales where label='UNVERIFIED';
select pg_temp.qa_fail(format('select public.record_merchant_collection(%L,%L,600,%L,%L,%L,%L,true)',
 transaction_id,'QA-NON_LIVE','USD','QA-SETTLEMENT','MERCHANT_STATEMENT',repeat('e',30)),'non_live_payment')
 from qa_sales where label='NON_LIVE';
select public.record_merchant_collection(transaction_id,'QA-'||label,gross,'USD',
 'QA-RECEIPT-'||label,'MERCHANT_WALLET_RECEIPT','Verified settled receipt for this rollback-only sale.',true)
 from qa_sales where label in ('HELD','READY','REVIEW','PAID_OUT');
do $$ declare v jsonb; begin
 select public.record_merchant_collection(transaction_id,'QA-'||label,gross,'USD',
  'QA-RECEIPT-'||label,'MERCHANT_WALLET_RECEIPT',repeat('e',30),true) into v from qa_sales where label='HELD';
 if v->>'already'<>'true' then raise exception 'Repeated evidence must be idempotent'; end if;
end; $$;
select pg_temp.qa_fail(format('select public.record_merchant_collection(%L,%L,100,%L,%L,%L,%L,true)',
 transaction_id,'QA-UNVERIFIED','USD','qa-receipt-held','MERCHANT_STATEMENT',repeat('e',30)),'duplicate key')
 from qa_sales where label='UNVERIFIED';
select pg_temp.qa_fail(format('select public.record_merchant_collection(%L,%L,200,%L,%L,%L,%L,true)',
 transaction_id,'QA-HELD','USD','DIFFERENT-RECEIPT','MERCHANT_WALLET_RECEIPT',repeat('e',30)),'collection_evidence_already_recorded')
 from qa_sales where label='HELD';
reset role;
select pg_temp.qa_fail('update private.merchant_collection_evidence set note=repeat(''x'',30)','collection_evidence_immutable');

update public.seller_payouts p set status='DELIVERY_CONFIRMED' from qa_sales s
 where p.transaction_id=s.transaction_id and s.label in ('UNVERIFIED','READY','REVIEW','PAID_OUT');
select pg_temp.qa_fail(format('update public.seller_payouts set status=''PAYOUT_DUE'' where transaction_id=%L',transaction_id),
 'collection_settlement_unverified') from qa_sales where label='UNVERIFIED';
select pg_temp.qa_fail(format('insert into public.external_seller_payout_claims(payout_id,amount_minor,currency,seller_id,destination_phone_e164,rail,reserved_by,reason) select id,amount_minor,currency,seller_id,''+263770000000'',''SMILECASH'',%L,%L from public.seller_payouts where transaction_id=%L',
 u.finance,repeat('e',30),s.transaction_id),'collection_settlement_unverified')
 from qa_sales s cross join qa_sales_users u where s.label='UNVERIFIED';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
update public.seller_payouts p set status='PAYOUT_DUE' from qa_sales s
 where p.transaction_id=s.transaction_id and s.label in ('REVIEW','PAID_OUT');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',finance,'role','authenticated')::text,true) from qa_sales_users;
set local role authenticated;
select public.staff_record_payout_reconciliation(s.payout_id,'SELLER_RECEIPT','QA-SELLER-RECEIPT',
 'Rollback fixture: independently verified the seller wallet receipt.',true)
 from qa_sales s where s.label='PAID_OUT';
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
update public.seller_payouts p set status='PAID_OUT',payout_reference='QA-SELLER-RECEIPT',paid_at=clock_timestamp()
 from qa_sales s where p.transaction_id=s.transaction_id and s.label='PAID_OUT';
reset role;

select set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true) from qa_sales_users;
set local role authenticated;
do $$ declare v jsonb; begin
 v:=public.my_sales_account();
 if (v->>'transactionCount')::int<>106 or jsonb_array_length(v->'entries')<>100
  or v->>'grossMinor'<>'11600' or v->>'feeMinor'<>'580' or v->>'proceedsMinor'<>'11020'
  or v->>'unverifiedMinor'<>'9690' or v->>'heldMinor'<>'190' or v->>'readyMinor'<>'285'
  or v->>'reviewMinor'<>'380' or v->>'paidOutMinor'<>'475' then
  raise exception 'Incorrect complete-account sums or evidence buckets: %',v;
 end if;
end; $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',stranger,'role','authenticated')::text,true) from qa_sales_users;
set local role authenticated;
do $$ declare v jsonb; begin
 v:=public.my_sales_account();
 if v->>'transactionCount'<>'1' or v->>'proceedsMinor'<>'665' then raise exception 'Cross-user account disclosure'; end if;
end; $$;
reset role;

-- A verified collection alone never clears a dispute or a pending transfer.
insert into public.transaction_disputes(transaction_id,opened_by,reason,payout_frozen)
 select s.transaction_id,u.buyer,'PAYMENT_OR_PAYOUT',true from qa_sales s cross join qa_sales_users u where s.label='READY';
select set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true) from qa_sales_users;
set local role authenticated;
do $$ declare v jsonb; begin
 v:=public.my_sales_account();
 if v->>'readyMinor'<>'0' or v->>'heldMinor'<>'475' then raise exception 'Disputed funds became available'; end if;
end; $$;
reset role;
select 'Sales account authorization, exact sums, receipt idempotency, payout gates, test exclusion, paging and dispute checks passed' as verification;
rollback;
