-- One merchant integration, a separate derived sales ledger for each user.
-- Collection acknowledgement, merchant receipt, handover and seller receipt
-- remain separate facts. This migration moves no money and changes no switch.
create table private.merchant_collection_evidence (
 transaction_id uuid primary key references public.transactions(id) on delete restrict,
 provider text not null check(provider in ('linkwa','paynow')),
 collection_reference text not null check(char_length(collection_reference) between 1 and 200),
 gross_minor bigint not null check(gross_minor > 0),
 currency text not null check(currency='USD'),
 settlement_reference text not null check(char_length(settlement_reference) between 6 and 200),
 source text not null check(source in ('MERCHANT_WALLET_RECEIPT','MERCHANT_STATEMENT')),
 note text not null check(char_length(btrim(note)) between 25 and 1500),
 verified_by uuid not null references public.profiles(id) on delete restrict,
 verified_at timestamptz not null default clock_timestamp()
);
create unique index merchant_collection_unique_receipt
 on private.merchant_collection_evidence(provider,lower(settlement_reference));
create unique index merchant_collection_unique_collection
 on private.merchant_collection_evidence(provider,lower(collection_reference));
create index merchant_collection_verified_by on private.merchant_collection_evidence(verified_by);

-- Verified sandbox / simulated historical records stay immutable in their
-- original ledger, but cannot become real withdrawable seller proceeds.
create table private.non_live_financial_records (
 transaction_id uuid primary key references public.transactions(id) on delete restrict,
 reason text not null check(reason in ('SANDBOX','SIMULATED_PAYMENT')),
 evidence_note text not null check(char_length(btrim(evidence_note)) between 25 and 1500),
 recorded_at timestamptz not null default clock_timestamp()
);
alter table private.merchant_collection_evidence enable row level security;
alter table private.non_live_financial_records enable row level security;
revoke all on private.merchant_collection_evidence, private.non_live_financial_records
 from public,anon,authenticated,service_role;

create function private.collection_evidence_immutable()
returns trigger language plpgsql set search_path='' as $$
begin
 raise exception 'collection_evidence_immutable';
end;
$$;
create trigger collection_evidence_immutable before update or delete
 on private.merchant_collection_evidence for each row
 execute function private.collection_evidence_immutable();
create trigger financial_classification_immutable before update or delete
 on private.non_live_financial_records for each row
 execute function private.collection_evidence_immutable();
revoke all on function private.collection_evidence_immutable() from public,anon,authenticated;

create function private.record_merchant_collection(
 p_transaction_id uuid, p_collection_reference text, p_gross_minor bigint,
 p_currency text, p_settlement_reference text, p_source text,
 p_note text, p_funds_received boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid := auth.uid();
 v_sale public.transactions%rowtype;
 v_existing private.merchant_collection_evidence%rowtype;
begin
 if v_actor is null or not public.has_permission(v_actor,'payouts.mark_paid') then
  raise exception 'not_authorised' using errcode='42501';
 end if;
 if p_funds_received is distinct from true
    or p_gross_minor is null or p_gross_minor <= 0 or p_currency is distinct from 'USD'
    or p_source is null or p_source not in ('MERCHANT_WALLET_RECEIPT','MERCHANT_STATEMENT')
    or p_note is null or char_length(btrim(p_note)) not between 25 and 1500
    or p_collection_reference is null or char_length(btrim(p_collection_reference)) not between 1 and 200
    or p_settlement_reference is null or char_length(btrim(p_settlement_reference)) not between 6 and 200 then
  raise exception 'collection_evidence_incomplete';
 end if;
 select * into v_sale from public.transactions where id=p_transaction_id for update;
 if not found or v_sale.status not in ('PAID','SETTLED')
    or lower(coalesce(v_sale.provider,'')) not in ('linkwa','paynow')
    or v_sale.provider_reference is distinct from btrim(p_collection_reference)
    or v_sale.currency is distinct from p_currency or v_sale.gross_minor is distinct from p_gross_minor then
  raise exception 'collection_does_not_match_sale';
 end if;
 if exists(select 1 from private.non_live_financial_records where transaction_id=p_transaction_id) then
  raise exception 'non_live_payment';
 end if;
 select * into v_existing from private.merchant_collection_evidence where transaction_id=p_transaction_id;
 if found then
  if v_existing.settlement_reference is distinct from btrim(p_settlement_reference)
     or v_existing.source is distinct from p_source then
   raise exception 'collection_evidence_already_recorded';
  end if;
  return jsonb_build_object('ok',true,'already',true);
 end if;
 insert into private.merchant_collection_evidence(transaction_id,provider,collection_reference,
   gross_minor,currency,settlement_reference,source,note,verified_by)
 values(v_sale.id,lower(v_sale.provider),v_sale.provider_reference,v_sale.gross_minor,
   v_sale.currency,btrim(p_settlement_reference),p_source,btrim(p_note),v_actor);
 return jsonb_build_object('ok',true,'already',false);
end;
$$;
create function public.record_merchant_collection(
 p_transaction_id uuid, p_collection_reference text, p_gross_minor bigint,
 p_currency text, p_settlement_reference text, p_source text,
 p_note text, p_funds_received boolean
) returns jsonb language sql security invoker set search_path='' as $$
 select private.record_merchant_collection(p_transaction_id,p_collection_reference,p_gross_minor,
   p_currency,p_settlement_reference,p_source,p_note,p_funds_received);
$$;
revoke all on function private.record_merchant_collection(uuid,text,bigint,text,text,text,text,boolean),
 public.record_merchant_collection(uuid,text,bigint,text,text,text,text,boolean) from public,anon;
grant execute on function private.record_merchant_collection(uuid,text,bigint,text,text,text,text,boolean),
 public.record_merchant_collection(uuid,text,bigint,text,text,text,text,boolean) to authenticated;

create function private.staff_collection_checks(p_transaction_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_permission(auth.uid(),'payments.view') then
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
create function public.staff_collection_checks(p_transaction_ids uuid[])
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.staff_collection_checks(p_transaction_ids);
$$;
revoke all on function private.staff_collection_checks(uuid[]),public.staff_collection_checks(uuid[]) from public,anon;
grant execute on function private.staff_collection_checks(uuid[]),public.staff_collection_checks(uuid[]) to authenticated;

-- Both transfer rails require an exact, reviewed merchant receipt. Existing
-- uncertain PAYOUT_DUE records can still be investigated and reconciled.
create function private.require_verified_collection(p_transaction_id uuid)
returns void language plpgsql set search_path='' as $$
begin
 if exists(select 1 from private.non_live_financial_records where transaction_id=p_transaction_id)
   or not exists(select 1 from public.transactions t
     join private.merchant_collection_evidence e on e.transaction_id=t.id
      and e.gross_minor=t.gross_minor and e.currency=t.currency
      and e.provider=lower(t.provider) and e.collection_reference=t.provider_reference
     where t.id=p_transaction_id and t.status in ('PAID','SETTLED')) then
  raise exception 'collection_settlement_unverified' using errcode='42501';
 end if;
end;
$$;
create function private.check_payout_collection()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='external_seller_payout_claims' then
  perform private.require_verified_collection((select p.transaction_id from public.seller_payouts p where p.id=new.payout_id));
 elsif new.status='PAYOUT_DUE' and old.status is distinct from new.status then
  perform private.require_verified_collection(new.transaction_id);
 end if;
 return new;
end;
$$;
create trigger zz_collection_before_external_payout before insert on public.external_seller_payout_claims
 for each row execute function private.check_payout_collection();
create trigger zz_collection_before_provider_payout before update of status on public.seller_payouts
 for each row execute function private.check_payout_collection();
revoke all on function private.require_verified_collection(uuid),private.check_payout_collection() from public,anon,authenticated;
grant execute on function private.require_verified_collection(uuid) to service_role;
grant select on private.merchant_collection_evidence,private.non_live_financial_records to service_role;

create function private.my_sales_account()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'not_authorised' using errcode='42501'; end if;
 return (
 with sales as materialized (
  select t.id,t.auction_id,a.title,t.gross_minor,t.fee_minor,t.net_minor,t.created_at,
    t.provider_reference,e.transaction_id is not null as collection_verified,
    case
     when p.id is null or p.amount_minor is distinct from t.net_minor or p.currency is distinct from t.currency then 'REVIEW'
     when p.status='PAID_OUT' then 'PAID_OUT'
     when p.status='PAYOUT_DUE' or p.payout_reference is not null or x.status='RESERVED'
       or exists(select 1 from public.seller_payout_events pe where pe.payout_id=p.id
                 and pe.to_status in ('PAYOUT_DUE','PAID_OUT')) then 'REVIEW'
     when e.transaction_id is null then 'UNVERIFIED'
     when p.status in ('HELD','DISPUTED') or d.status<>'RESOLVED' or d.payout_frozen
       or p.delivery_confirmed_at is null then 'HELD'
     when p.status in ('DELIVERY_CONFIRMED','PAYOUT_PENDING') then 'READY'
     else 'REVIEW'
    end as bucket
   from public.transactions t
   left join public.auctions a on a.id=t.auction_id
   left join public.seller_payouts p on p.transaction_id=t.id
   left join public.external_seller_payout_claims x on x.payout_id=p.id
   left join public.transaction_disputes d on d.transaction_id=t.id
   left join private.merchant_collection_evidence e on e.transaction_id=t.id
   where t.seller_id=auth.uid() and t.status in ('PAID','SETTLED') and t.currency='USD'
     and not exists(select 1 from private.non_live_financial_records n where n.transaction_id=t.id)
 ), totals as (
  select count(*) as count,coalesce(sum(gross_minor),0)::text as gross,
   coalesce(sum(fee_minor),0)::text as fee,coalesce(sum(net_minor),0)::text as proceeds,
   coalesce(sum(net_minor) filter(where bucket='UNVERIFIED'),0)::text as unverified,
   coalesce(sum(net_minor) filter(where bucket='HELD'),0)::text as held,
   coalesce(sum(net_minor) filter(where bucket='READY'),0)::text as ready,
   coalesce(sum(net_minor) filter(where bucket='REVIEW'),0)::text as review,
   coalesce(sum(net_minor) filter(where bucket='PAID_OUT'),0)::text as paid_out from sales
 )
 select jsonb_build_object('currency','USD','asOf',now(),'transactionCount',totals.count,
  'grossMinor',gross,'feeMinor',fee,'proceedsMinor',proceeds,'unverifiedMinor',unverified,
  'heldMinor',held,'readyMinor',ready,'reviewMinor',review,'paidOutMinor',paid_out,
  'otherCurrencyCount',(select count(*) from public.transactions t where t.seller_id=auth.uid()
     and t.status in ('PAID','SETTLED') and t.currency<>'USD'
     and not exists(select 1 from private.non_live_financial_records n where n.transaction_id=t.id)),
  'entries',coalesce((select jsonb_agg(jsonb_build_object(
    'id',s.id,'auctionId',s.auction_id,'title',s.title,'grossMinor',s.gross_minor::text,
    'feeMinor',s.fee_minor::text,'proceedsMinor',s.net_minor::text,'createdAt',s.created_at,
    'providerReference',s.provider_reference,'collectionVerified',s.collection_verified,'bucket',s.bucket)
    order by s.created_at desc,s.id desc)
    from (select * from sales order by created_at desc,id desc limit 100)s),'[]'::jsonb)) from totals
 );
end;
$$;
create function public.my_sales_account()
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.my_sales_account();
$$;
revoke all on function private.my_sales_account(),public.my_sales_account() from public,anon;
grant execute on function private.my_sales_account(),public.my_sales_account() to authenticated;
comment on function public.my_sales_account() is
 'Caller-owned, derived sales ledger. No user-id input, mutable balance, deposit account or automatic payout.';
