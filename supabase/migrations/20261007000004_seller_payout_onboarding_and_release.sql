-- Seller payout onboarding + automatic release after buyer-confirmed handover.
--
-- BidBlitz takes the frozen transaction fee (currently 5%). The seller payout
-- row already freezes transactions.net_minor, so the payout amount can never
-- drift after the sale. This migration adds:
--   * a runtime payment kill switch;
--   * private seller payout contact/setup state;
--   * a buyer-only delivery confirmation RPC;
--   * a service-role-only payout transition RPC for the server payout worker;
--   * a publish guard: sellers must have a ready payout wallet before going live.
--
-- No auction bid, anti-snipe, fee calculation or winner logic is changed.

alter table public.payment_settings
  add column if not exists payments_enabled boolean not null default false;

comment on column public.payment_settings.payments_enabled is
  'Emergency runtime switch for NEW checkout initiation and NEW seller payout instructions. Signed provider webhooks remain accepted so in-flight money can reconcile.';

alter table public.seller_payout_recipients
  alter column external_user_id drop not null,
  alter column external_wallet_id drop not null,
  add column if not exists phone_e164 text,
  add column if not exists legal_first_name text,
  add column if not exists legal_last_name text,
  add column if not exists wallet_provider text,
  add column if not exists setup_status text not null default 'UNLINKED',
  add column if not exists setup_error text,
  add column if not exists linked_at timestamptz;

alter table public.seller_payout_recipients
  drop constraint if exists seller_payout_recipients_phone_chk,
  add constraint seller_payout_recipients_phone_chk
    check (phone_e164 is null or phone_e164 ~ '^\\+263[0-9]{9}$'),
  drop constraint if exists seller_payout_recipients_first_name_chk,
  add constraint seller_payout_recipients_first_name_chk
    check (legal_first_name is null or char_length(btrim(legal_first_name)) between 1 and 80),
  drop constraint if exists seller_payout_recipients_last_name_chk,
  add constraint seller_payout_recipients_last_name_chk
    check (legal_last_name is null or char_length(btrim(legal_last_name)) between 1 and 80),
  drop constraint if exists seller_payout_recipients_wallet_provider_chk,
  add constraint seller_payout_recipients_wallet_provider_chk
    check (wallet_provider is null or wallet_provider in ('smilecash')),
  drop constraint if exists seller_payout_recipients_setup_status_chk,
  add constraint seller_payout_recipients_setup_status_chk
    check (setup_status in ('UNLINKED','LINKING','READY','NEEDS_WALLET','ERROR'));

update public.seller_payout_recipients
   set setup_status = 'READY',
       wallet_provider = coalesce(wallet_provider, 'smilecash'),
       linked_at = coalesce(linked_at, created_at)
 where external_user_id is not null
   and external_wallet_id is not null
   and setup_status <> 'READY';

comment on table public.seller_payout_recipients is
  'Private seller payout setup. Phone/name/provider ids are server-side only. READY means Linkwa user + SmileCash wallet ids are present and the seller can receive marketplace payouts.';

create index if not exists seller_payout_recipients_status_idx
  on public.seller_payout_recipients (setup_status);

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
check (type in (
  'AUCTION_PUBLISHED','NEW_BID','OUTBID','ENDING_SOON','WON','SOLD','ENDED_UNSOLD',
  'REVIEW_REQUEST','LISTING_REMOVED','BID_CONFIRMED','REVIEW_SUBMITTED','REVIEW_APPROVED',
  'REVIEW_REJECTED','REVIEW_CHANGES_REQUESTED','CANCELLATION_REQUESTED','CANCELLATION_DECIDED',
  'AUCTION_PAUSED','AUCTION_RESUMED','AUCTION_CANCELLED','NEW_MESSAGE','PAYMENT_EXPIRED',
  'STAFF_REVIEW_REQUIRED','PROMOTION_REQUESTED','PROMOTION_APPROVED','PROMOTION_REJECTED',
  'DELIVERY_CONFIRMED','PAYOUT_SENT','PAYOUT_SETUP_REQUIRED','PAYOUT_ATTENTION'
));

-- Owner-safe projection: never exposes Linkwa's external ids.
create or replace function public.my_payout_setup()
returns table (
  setup_status text,
  masked_phone text,
  wallet_provider text,
  ready boolean,
  linked_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select r.setup_status,
         case
           when r.phone_e164 is null then null
           else left(r.phone_e164, 4) || '•••••' || right(r.phone_e164, 3)
         end,
         r.wallet_provider,
         (
           r.setup_status = 'READY'
           and r.external_user_id is not null
           and r.external_wallet_id is not null
         ),
         r.linked_at
    from public.seller_payout_recipients r
   where r.seller_id = auth.uid();
$$;

revoke all on function public.my_payout_setup() from public, anon;
grant execute on function public.my_payout_setup()
  to authenticated, service_role;

-- Publishing cannot create a seller obligation when there is nowhere to send
-- the proceeds. Drafts remain usable, so payout setup can be completed later.
create or replace function private.auction_require_payout_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('PENDING_REVIEW','LIVE','SCHEDULED')
     and old.status is distinct from new.status
     and not exists (
       select 1
         from public.seller_payout_recipients r
        where r.seller_id = new.seller_id
          and r.setup_status = 'READY'
          and r.external_user_id is not null
          and r.external_wallet_id is not null
     ) then
    raise exception 'payout_setup_required';
  end if;
  return new;
end;
$$;

drop trigger if exists auction_require_payout_ready on public.auctions;
create trigger auction_require_payout_ready
before update of status on public.auctions
for each row execute function private.auction_require_payout_ready();

-- Buyer/seller-safe payout projection for their own transactions. Internal
-- notes, provider ids and payout references remain private.
create or replace function public.my_transaction_payout_states()
returns table (
  transaction_id uuid,
  payout_status text,
  delivery_confirmed_at timestamptz,
  paid_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select p.transaction_id, p.status, p.delivery_confirmed_at, p.paid_at
    from public.seller_payouts p
    join public.transactions t on t.id = p.transaction_id
   where t.buyer_id = auth.uid() or t.seller_id = auth.uid();
$$;

revoke all on function public.my_transaction_payout_states() from public, anon;
grant execute on function public.my_transaction_payout_states()
  to authenticated, service_role;

-- Buyer confirms the seller handed over the item. This is the only non-admin
-- path that establishes the delivery fact. It cannot pay money by itself.
create or replace function public.buyer_confirm_delivery(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  t public.transactions%rowtype;
  p public.seller_payouts%rowtype;
  v_title text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode='42501';
  end if;

  select * into t
    from public.transactions
   where id = p_transaction_id
   for update;
  if not found then
    raise exception 'transaction_not_found' using errcode='P0002';
  end if;
  if t.buyer_id <> v_uid then
    raise exception 'buyer_only' using errcode='42501';
  end if;
  if t.status not in ('PAID','SETTLED') then
    raise exception 'payment_not_confirmed' using errcode='P0001';
  end if;

  select * into p
    from public.seller_payouts
   where transaction_id = t.id
   for update;
  if not found then
    raise exception 'payout_not_found' using errcode='P0002';
  end if;

  if p.status = 'PAID_OUT' then
    return jsonb_build_object('ok',true,'already',true,'status',p.status,'payout_id',p.id);
  end if;
  if p.status in ('HELD','DISPUTED') then
    raise exception 'payout_blocked' using errcode='P0001';
  end if;

  if p.status = 'WAITING_FOR_FULFILMENT' then
    update public.seller_payouts
       set status = 'DELIVERY_CONFIRMED',
           internal_note = coalesce(internal_note || E'\n','') ||
             'Buyer confirmed handover.'
     where id = p.id;
  end if;

  select title into v_title from public.auctions where id=t.auction_id;
  insert into public.notifications(user_id,type,auction_id,payload)
  values (
    t.seller_id,
    'DELIVERY_CONFIRMED',
    t.auction_id,
    jsonb_build_object('title',coalesce(v_title,'Sale'),'transactionId',t.id)
  );

  return jsonb_build_object(
    'ok',true,
    'already', p.status <> 'WAITING_FOR_FULFILMENT',
    'status','DELIVERY_CONFIRMED',
    'payout_id',p.id
  );
end;
$$;

revoke all on function public.buyer_confirm_delivery(uuid) from public, anon;
grant execute on function public.buyer_confirm_delivery(uuid)
  to authenticated, service_role;

-- Server-only transition used by the payout worker. Browser roles cannot call
-- it; the existing table trigger still enforces the legal state graph.
create or replace function public.service_transition_seller_payout(
  p_payout_id uuid,
  p_to_status text,
  p_payout_reference text default null,
  p_internal_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.seller_payouts%rowtype;
  v_tx public.transactions%rowtype;
  v_ref text := nullif(btrim(coalesce(p_payout_reference,'')),'');
  v_note text := nullif(btrim(coalesce(p_internal_note,'')),'');
begin
  if p_to_status not in (
    'WAITING_FOR_FULFILMENT','DELIVERY_CONFIRMED','PAYOUT_PENDING',
    'PAYOUT_DUE','PAID_OUT','HELD','DISPUTED'
  ) then
    raise exception 'payout_invalid_status';
  end if;

  select * into v_row
    from public.seller_payouts
   where id=p_payout_id
   for update;
  if not found then raise exception 'payout_not_found'; end if;

  if v_row.status = p_to_status then
    return jsonb_build_object('ok',true,'already',true,'status',v_row.status,'payout_id',v_row.id);
  end if;

  if p_to_status='PAID_OUT' then
    if v_ref is null then raise exception 'payout_reference_required'; end if;
    select * into v_tx from public.transactions where id=v_row.transaction_id for update;
    if not found or v_tx.status not in ('PAID','SETTLED') then
      raise exception 'payout_transaction_not_payable';
    end if;
  end if;

  update public.seller_payouts
     set status=p_to_status,
         payout_reference=case when v_ref is not null then v_ref else payout_reference end,
         internal_note=case when v_note is null then internal_note
                            else coalesce(internal_note || E'\n','') || v_note end,
         paid_at=case when p_to_status='PAID_OUT' then clock_timestamp() else paid_at end
   where id=p_payout_id;

  return jsonb_build_object('ok',true,'already',false,'status',p_to_status,'payout_id',p_payout_id);
end;
$$;

revoke all on function public.service_transition_seller_payout(uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.service_transition_seller_payout(uuid,text,text,text)
  to postgres, supabase_admin, service_role;

-- Extend account provisioning so email/password signups can seed a private
-- payout phone. OAuth users simply get no payout row until they set one up.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_handle text;
  v_name text;
  v_phone text;
  v_i integer := 0;
begin
  v_base := lower(coalesce(
    nullif(split_part(coalesce(new.email,'user'), '@', 1), ''),
    'blitz'
  ));
  v_base := regexp_replace(v_base, '[^a-z0-9_]', '', 'g');
  if char_length(v_base) < 3 then v_base := 'blitz' || left(v_base, 8); end if;
  if char_length(v_base) > 16 then v_base := left(v_base, 16); end if;

  v_handle := v_base;
  loop
    exit when not exists (select 1 from public.profiles where username = v_handle);
    v_i := v_i + 1;
    v_handle := left(v_base, 24 - length(v_i::text)) || v_i::text;
    exit when v_i > 9999;
  end loop;

  v_name := coalesce(nullif(new.raw_user_meta_data->>'display_name',''),
                     nullif(new.raw_user_meta_data->>'full_name',''),
                     v_handle);
  v_phone := nullif(new.raw_user_meta_data->>'payout_phone_e164','');

  insert into public.profiles (id, username, display_name, email_verified, location)
  values (new.id, v_handle, left(v_name, 60),
          coalesce(new.email_confirmed_at is not null, false),
          left(coalesce(new.raw_user_meta_data->>'location',''), 80))
  on conflict (id) do nothing;

  if v_phone ~ '^\\+263[0-9]{9}$' then
    insert into public.seller_payout_recipients
      (seller_id, provider, phone_e164, setup_status)
    values
      (new.id, 'linkwa', v_phone, 'UNLINKED')
    on conflict (seller_id) do update
      set phone_e164=excluded.phone_e164,
          updated_at=clock_timestamp()
      where public.seller_payout_recipients.setup_status <> 'READY';
  end if;

  return new;
end;
$$;
