-- Finance release: deliberate provider payout opt-in and a permanent,
-- append-only reconciliation trail. Does not send or replay money.
alter table public.payment_settings add column if not exists
  linkwa_payout_instructions_enabled boolean not null default false;
-- Keep provider disbursements disabled until payout-status/idempotency
-- is proven or a human explicitly accepts the one-instruction risk.
update public.payment_settings set linkwa_payout_instructions_enabled=false
  where linkwa_payout_instructions_enabled is distinct from false;

create table if not exists public.seller_payout_reconciliation_evidence (
 id uuid primary key default gen_random_uuid(),
 payout_id uuid not null references public.seller_payouts(id) on delete restrict,
 evidence_kind text not null check (evidence_kind in
  ('INVESTIGATION','PROVIDER_REFERENCE','SELLER_RECEIPT')),
 provider_reference text check
   (provider_reference is null or char_length(btrim(provider_reference)) between 6 and 200),
 evidence_note text not null check (char_length(btrim(evidence_note)) between 25 and 1500),
 seller_receipt_verified boolean not null default false,
 recorded_by uuid not null references public.profiles(id) on delete restrict,
 recorded_at timestamptz not null default clock_timestamp(),
 check ((evidence_kind='INVESTIGATION' and provider_reference is null
         and seller_receipt_verified=false)
     or (evidence_kind='PROVIDER_REFERENCE' and provider_reference is not null
         and seller_receipt_verified=false)
     or (evidence_kind='SELLER_RECEIPT' and provider_reference is not null
         and seller_receipt_verified=true))
);
create index if not exists payout_reconciliation_evidence_by_payout
  on public.seller_payout_reconciliation_evidence(payout_id,recorded_at desc);
-- Never assign a single provider payout reference to two seller payouts.
create unique index if not exists payout_reconciliation_ref_per_payout
  on public.seller_payout_reconciliation_evidence(provider_reference,payout_id)
  where provider_reference is not null;
alter table public.seller_payout_reconciliation_evidence enable row level security;
revoke all on public.seller_payout_reconciliation_evidence from public,anon,authenticated;
grant select on public.seller_payout_reconciliation_evidence to authenticated;
create policy seller_payout_reconciliation_staff_select
 on public.seller_payout_reconciliation_evidence
 for select to authenticated
 using (auth.uid() is not null and public.has_permission(auth.uid(),'payouts.view'));

create or replace function public.staff_record_payout_reconciliation(
  p_payout_id uuid, p_kind text, p_reference text,
  p_note text, p_seller_receipt_verified boolean
) returns jsonb language plpgsql security definer set search_path=''
as $evidence$
declare
 v_uid uuid := auth.uid();
 v_payout public.seller_payouts%rowtype;
 v_ref text := nullif(btrim(coalesce(p_reference,'')),'');
 v_note text := btrim(coalesce(p_note,''));
 v_entry uuid;
begin
 if v_uid is null or not public.has_permission(v_uid,'payouts.mark_paid') then
   raise exception 'not_authorised' using errcode='42501';
 end if;
 if p_kind not in ('INVESTIGATION','PROVIDER_REFERENCE','SELLER_RECEIPT')
    or char_length(v_note) not between 25 and 1500 then
   raise exception 'invalid_evidence' using errcode='22023';
 end if;
 if (p_kind='INVESTIGATION' and (v_ref is not null
        or p_seller_receipt_verified is distinct from false))
    or (p_kind='PROVIDER_REFERENCE' and
        (char_length(coalesce(v_ref,'')) not between 6 and 200
        or p_seller_receipt_verified is distinct from false))
    or (p_kind='SELLER_RECEIPT' and
        (char_length(coalesce(v_ref,'')) not between 6 and 200
         or p_seller_receipt_verified is distinct from true)) then
   raise exception 'receipt_evidence_required' using errcode='22023';
 end if;
 select * into v_payout from public.seller_payouts where id=p_payout_id for update;
 if not found or v_payout.status<>'PAYOUT_DUE' then
   raise exception 'payout_not_under_reconciliation' using errcode='42501';
 end if;
 -- Serialize evidence writers for the same provider reference across cases.
 -- A read-then-insert alone cannot prevent concurrent cross-payout reuse.
 if v_ref is not null then
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_ref, 0));
 end if;
 if v_ref is not null and
  (exists(select 1 from public.seller_payouts p where p.id<>p_payout_id
          and p.payout_reference=v_ref)
   or exists(select 1 from public.external_seller_payout_claims c
       where c.payout_id<>p_payout_id and c.receipt_reference=v_ref)
   or exists(select 1 from public.seller_payout_reconciliation_evidence e
       where e.payout_id<>p_payout_id and e.provider_reference=v_ref)) then
   raise exception 'reference_owned_by_another_payout' using errcode='23505';
 end if;
 if v_payout.payout_reference is not null and v_ref is not null
    and v_ref<>v_payout.payout_reference then
   raise exception 'provider_reference_mismatch' using errcode='22023';
 end if;
 insert into public.seller_payout_reconciliation_evidence
   (payout_id,evidence_kind,provider_reference,evidence_note,
    seller_receipt_verified,recorded_by)
 values (p_payout_id,p_kind,v_ref,v_note,p_seller_receipt_verified,v_uid)
 returning id into v_entry;
 return jsonb_build_object('ok',true,'evidence_id',v_entry,'status','RECORDED');
end;
$evidence$;
revoke all on function public.staff_record_payout_reconciliation(
 uuid,text,text,text,boolean) from public,anon;
grant execute on function public.staff_record_payout_reconciliation(
 uuid,text,text,text,boolean) to authenticated;

-- For a provider-sensitive payout, a human verified seller receipt is needed
-- before the legacy owner status transition may attest PAID_OUT.
create or replace function private.require_reconciled_receipt_for_provider_payout()
 returns trigger language plpgsql set search_path=''
 as $guard$
begin
 if old.status='PAYOUT_DUE' and new.status='PAID_OUT' and
    not exists (
      select 1 from public.seller_payout_reconciliation_evidence e
      where e.payout_id=new.id and e.evidence_kind='SELLER_RECEIPT'
        and e.seller_receipt_verified=true
        and e.provider_reference=new.payout_reference
        and public.has_permission(e.recorded_by,'payouts.mark_paid')
    ) then
    raise exception 'verified_seller_receipt_evidence_required'
      using errcode='42501';
 end if;
 return new;
end;
$guard$;
drop trigger if exists zz_payout_verified_provider_receipt on public.seller_payouts;
create trigger zz_payout_verified_provider_receipt before update of status
 on public.seller_payouts for each row
 execute function private.require_reconciled_receipt_for_provider_payout();
