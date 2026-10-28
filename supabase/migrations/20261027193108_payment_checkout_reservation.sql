-- One external initiation per sale, including concurrent requests and lost
-- provider replies. A reservation never expires automatically: an absent
-- recorded intent does not prove the provider failed to create a payment.
create table public.payment_checkout_claims (
  transaction_id uuid primary key references public.transactions(id) on delete cascade,
  provider text not null check (char_length(provider) between 1 and 40),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.payment_checkout_claims enable row level security;
revoke all on public.payment_checkout_claims from public, anon, authenticated;
grant select, insert on public.payment_checkout_claims to service_role;

create function public.claim_payment_checkout(
  p_transaction_id uuid,
  p_buyer_id uuid,
  p_provider text
) returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  v_transaction public.transactions%rowtype;
  v_provider text;
begin
  if p_provider is null or char_length(p_provider) not between 1 and 40
     or p_buyer_id is null then
    raise exception 'payment_invalid_request';
  end if;
  -- All callers serialize on the same transaction, across server instances.
  select * into v_transaction from public.transactions
    where id = p_transaction_id for update;
  if not found or v_transaction.buyer_id <> p_buyer_id then
    raise exception 'transaction_not_found';
  end if;
  if v_transaction.status <> 'AWAITING_PAYMENT' then
    raise exception 'not_awaiting_payment';
  end if;
  if v_transaction.payment_due_at is null
     or v_transaction.payment_due_at <= clock_timestamp() then
    raise exception 'payment_window_expired';
  end if;
  select provider into v_provider from public.payment_intents
    where transaction_id = p_transaction_id;
  if found then
    if v_provider <> p_provider then
      raise exception 'existing_provider_payment_pending';
    end if;
    return 'resume';
  end if;
  if exists (select 1 from public.payment_checkout_claims
             where transaction_id = p_transaction_id) then
    return 'held';
  end if;
  insert into public.payment_checkout_claims(transaction_id, provider)
    values (p_transaction_id, p_provider);
  return 'claimed';
end;
$$;
revoke execute on function public.claim_payment_checkout(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_payment_checkout(uuid, uuid, text) to service_role;
comment on table public.payment_checkout_claims is
  'Server-only checkout initiation reservations. Never clear an uncertain claim without provider evidence. Recorded payment sessions may be resumed.';
