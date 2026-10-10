-- Allow sellers to receive independently verified staff-managed transfers
-- without forcing a Linkwa SmileCash recipient registration.
-- A MANUAL_READY contact is not a provider-linked wallet. Payouts remain
-- subject to paid transaction, delivery, dispute and admin receipt safeguards.
alter table public.seller_payout_recipients
  drop constraint if exists seller_payout_recipients_setup_status_chk;
alter table public.seller_payout_recipients
  add constraint seller_payout_recipients_setup_status_chk check
  (setup_status in ('UNLINKED','LINKING','READY','NEEDS_WALLET','ERROR','MANUAL_READY'));

create or replace function public.set_manual_payout_contact(
  p_first_name text, p_last_name text, p_phone_e164 text
) returns jsonb language plpgsql security definer set search_path=''
as $manual$
declare
  v_uid uuid := auth.uid();
  v_first text := btrim(coalesce(p_first_name, ''));
  v_last text := btrim(coalesce(p_last_name, ''));
  v_phone text := btrim(coalesce(p_phone_e164, ''));
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode='42501';
  end if;
  if char_length(v_first) not between 1 and 80
     or char_length(v_last) not between 1 and 80
     or v_phone !~ '^[+]263[0-9]{9}$' then
    raise exception 'invalid_payout_contact' using errcode='22023';
  end if;
  -- Never accept a seller id from the client. Changing the contact doesn't
  -- modify any existing frozen external claim or payout amount/destination.
  insert into public.seller_payout_recipients
    (seller_id,provider,phone_e164,legal_first_name,legal_last_name,
     setup_status,external_user_id,external_wallet_id,wallet_provider,
     setup_error,linked_at,updated_at)
  values (v_uid,'linkwa',v_phone,v_first,v_last,'MANUAL_READY',
          null,null,null,null,null,clock_timestamp())
  on conflict (seller_id) do update set
    phone_e164=excluded.phone_e164,
    legal_first_name=excluded.legal_first_name,
    legal_last_name=excluded.legal_last_name,
    setup_status='MANUAL_READY',
    external_user_id=null,external_wallet_id=null,wallet_provider=null,
    setup_error=null,linked_at=null,updated_at=clock_timestamp();
  return jsonb_build_object('ok',true,'status','MANUAL_READY',
    'masked_phone',left(v_phone,4)||'•••••'||right(v_phone,3));
end;
$manual$;
revoke all on function public.set_manual_payout_contact(text,text,text)
  from public,anon;
grant execute on function public.set_manual_payout_contact(text,text,text)
  to authenticated;

-- Same return shape as the existing owner-safe projection. Manual contact
-- readiness is separate from the Linkwa external user/wallet id condition.
create or replace function public.my_payout_setup()
returns table(
  setup_status text, masked_phone text, wallet_provider text,
  ready boolean, linked_at timestamptz
) language sql stable security definer set search_path=''
as $setup$
  select r.setup_status,
         case when r.phone_e164 is null then null
              else left(r.phone_e164,4)||'•••••'||right(r.phone_e164,3) end,
         r.wallet_provider,
         (r.setup_status='MANUAL_READY' and r.phone_e164 ~ '^[+]263[0-9]{9}$')
         or (r.setup_status='READY' and r.external_user_id is not null
             and r.external_wallet_id is not null),
         r.linked_at
    from public.seller_payout_recipients r
   where r.seller_id=auth.uid();
$setup$;
revoke all on function public.my_payout_setup() from public,anon;
grant execute on function public.my_payout_setup() to authenticated,service_role;

-- A seller may now publish with a securely stored contact for staff payout.
-- The existing finance reservation still freezes the exact wallet address,
-- while the programmatic Linkwa path requires the separate READY+IDs state.
create or replace function private.auction_require_payout_ready()
returns trigger language plpgsql security definer set search_path=''
as $publish$
begin
  if new.status in ('PENDING_REVIEW','LIVE','SCHEDULED')
     and old.status is distinct from new.status
     and not exists (
       select 1 from public.seller_payout_recipients r
        where r.seller_id=new.seller_id
          and ((r.setup_status='READY' and r.external_user_id is not null
                and r.external_wallet_id is not null)
           or (r.setup_status='MANUAL_READY'
               and r.phone_e164 ~ '^[+]263[0-9]{9}$'))
     ) then
    raise exception 'payout_setup_required';
  end if;
  return new;
end;
$publish$;

comment on table public.seller_payout_recipients is
 'Seller payout destination contact, restricted to service role writes or the own-account manual contact RPC. MANUAL_READY does not constitute a linked Linkwa wallet; external payouts still require independent staff verification.';

-- Finance triage recognises a saved manual contact without pretending it
-- is a Linkwa-linked wallet. The Linkwa-ready flag remains distinct and
-- never authorizes provider payouts to MANUAL_READY recipients.
CREATE OR REPLACE FUNCTION public.admin_finance_operations(p_limit integer DEFAULT 75)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
            ((r.setup_status = 'READY' and r.external_wallet_id is not null and r.external_user_id is not null)
             or (r.setup_status = 'MANUAL_READY' and r.phone_e164 ~ '^[+]263[0-9]{9}$')) is true as "walletReady",
            (r.setup_status = 'READY' and r.external_wallet_id is not null
              and r.external_user_id is not null) is true as "linkwaWalletReady",
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
$function$;
