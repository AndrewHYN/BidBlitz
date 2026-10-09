-- Production activation repair: accept canonical Zimbabwe phone numbers.
-- Keep payments paused; this migration neither sends money nor enables checkout.
alter table public.seller_payout_recipients
  drop constraint seller_payout_recipients_phone_chk,
  add constraint seller_payout_recipients_phone_chk
    check (phone_e164 is null or phone_e164 ~ '^[+]263[0-9]{9}$');

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

  if v_phone ~ '^[+]263[0-9]{9}$' then
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

  -- A money-moving claim is exclusive, never an idempotent success.
  if p_to_status = 'PAYOUT_DUE' and v_row.status = 'PAYOUT_DUE' then
    raise exception 'payout_already_claimed';
  end if;

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

