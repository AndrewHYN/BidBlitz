-- Harden authenticated payout RPCs: keep privileged logic in the unexposed
-- private schema and expose only SECURITY INVOKER wrappers in public.
--
-- The private schema is not in the Supabase Data API exposed schemas, so these
-- definer helpers are not directly callable through /rest/v1/rpc/*. Public
-- wrappers preserve the same API while the database advisor no longer sees an
-- externally exposed SECURITY DEFINER endpoint.

create or replace function private.my_payout_setup_impl()
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

create or replace function public.my_payout_setup()
returns table (
  setup_status text,
  masked_phone text,
  wallet_provider text,
  ready boolean,
  linked_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$
  select * from private.my_payout_setup_impl();
$$;

create or replace function private.my_transaction_payout_states_impl()
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

create or replace function public.my_transaction_payout_states()
returns table (
  transaction_id uuid,
  payout_status text,
  delivery_confirmed_at timestamptz,
  paid_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$
  select * from private.my_transaction_payout_states_impl();
$$;

create or replace function private.buyer_confirm_delivery_impl(p_transaction_id uuid)
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

  if not exists (
    select 1 from public.notifications n
     where n.user_id=t.seller_id
       and n.auction_id=t.auction_id
       and n.type='DELIVERY_CONFIRMED'
       and n.payload->>'transactionId'=t.id::text
  ) then
    insert into public.notifications(user_id,type,auction_id,payload)
    values (
      t.seller_id,
      'DELIVERY_CONFIRMED',
      t.auction_id,
      jsonb_build_object('title',coalesce(v_title,'Sale'),'transactionId',t.id)
    );
  end if;

  return jsonb_build_object(
    'ok',true,
    'already', p.status <> 'WAITING_FOR_FULFILMENT',
    'status','DELIVERY_CONFIRMED',
    'payout_id',p.id
  );
end;
$$;

create or replace function public.buyer_confirm_delivery(p_transaction_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.buyer_confirm_delivery_impl(p_transaction_id);
$$;

-- Public API roles can invoke only the wrappers. The helpers live in a schema
-- that PostgREST does not expose.
revoke all on function private.my_payout_setup_impl() from public, anon;
revoke all on function private.my_transaction_payout_states_impl() from public, anon;
revoke all on function private.buyer_confirm_delivery_impl(uuid) from public, anon;

grant usage on schema private to authenticated, service_role;
grant execute on function private.my_payout_setup_impl() to authenticated, service_role;
grant execute on function private.my_transaction_payout_states_impl() to authenticated, service_role;
grant execute on function private.buyer_confirm_delivery_impl(uuid) to authenticated, service_role;

revoke all on function public.my_payout_setup() from public, anon;
revoke all on function public.my_transaction_payout_states() from public, anon;
revoke all on function public.buyer_confirm_delivery(uuid) from public, anon;
grant execute on function public.my_payout_setup() to authenticated, service_role;
grant execute on function public.my_transaction_payout_states() to authenticated, service_role;
grant execute on function public.buyer_confirm_delivery(uuid) to authenticated, service_role;
