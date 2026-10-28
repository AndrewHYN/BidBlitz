-- Private, explicitly queued maintenance evidence; no payment state changes.
create table public.payment_provider_checks (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'linkwa' check (provider = 'linkwa'),
  status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','PASSED','PARTIAL','FAILED')),
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours',
  started_at timestamptz,
  finished_at timestamptz,
  release_commit text check (release_commit is null or release_commit ~ '^[a-f0-9]{40}$'),
  api_authorized boolean,
  result jsonb,
  check (expires_at > requested_at)
);
alter table public.payment_provider_checks enable row level security;
revoke all on public.payment_provider_checks from public, anon, authenticated, service_role;
grant select, update on public.payment_provider_checks to service_role;
comment on table public.payment_provider_checks is
  'Server-only read-only provider audit results. API authorization is not proof of collection or settlement. A statement page is not a complete global merchant ledger.';

create function public.claim_payment_provider_check(p_id uuid, p_commit text)
returns boolean language sql security invoker set search_path = '' as $$
  with claimed as (
    update public.payment_provider_checks
    set status='RUNNING', started_at=clock_timestamp(), release_commit=p_commit
    where id=p_id and status='QUEUED' and provider='linkwa' and expires_at>clock_timestamp()
    returning id
  ) select exists(select 1 from claimed);
$$;

create function public.finish_payment_provider_check(p_id uuid, p_result jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_changed integer;
begin
  if jsonb_typeof(p_result) is distinct from 'object'
     or p_result->>'status' is null or p_result->>'status' not in ('PASSED','PARTIAL','FAILED')
     or p_result->>'collectionProven' is distinct from 'false'
     or jsonb_typeof(p_result->'apiAuthorized') is distinct from 'boolean' then
    raise exception 'invalid_provider_audit_result';
  end if;
  update public.payment_provider_checks
  set status=p_result->>'status', finished_at=clock_timestamp(),
      api_authorized=(p_result->>'apiAuthorized')::boolean, result=p_result
  where id=p_id and status='RUNNING';
  get diagnostics v_changed = row_count;
  return v_changed=1;
end;
$$;
revoke execute on function public.claim_payment_provider_check(uuid,text) from public,anon,authenticated;
revoke execute on function public.finish_payment_provider_check(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_payment_provider_check(uuid,text) to service_role;
grant execute on function public.finish_payment_provider_check(uuid,jsonb) to service_role;
