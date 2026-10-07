-- Transaction dispute workflow.
--
-- BidBlitz moderates and records disputes but does not issue refunds here.
-- Opening a dispute freezes an unpaid seller payout when it is still safe to
-- do so. Staff resolution may release or hold that payout. PAYOUT_DUE and
-- PAID_OUT are never treated as safely reversible provider states.

insert into public.staff_permissions(key, category, description, sensitive)
values
  ('disputes.view', 'Disputes', 'Read buyer/seller dispute cases and evidence.', true),
  ('disputes.manage', 'Disputes', 'Move disputes through review and record a final resolution.', true)
on conflict (key) do update
set category=excluded.category,
    description=excluded.description,
    sensitive=excluded.sensitive;

insert into public.staff_role_permissions(role_key, permission_key)
select role_key, permission_key
from (values
  ('ADMIN','disputes.view'),
  ('ADMIN','disputes.manage'),
  ('MODERATOR','disputes.view'),
  ('MODERATOR','disputes.manage'),
  ('OPERATIONS','disputes.view'),
  ('SUPPORT','disputes.view'),
  ('FINANCE','disputes.view')
) as v(role_key, permission_key)
on conflict (role_key, permission_key) do nothing;

create table if not exists public.transaction_disputes (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references public.transactions(id) on delete restrict,
  opened_by uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (reason in (
    'ITEM_NOT_RECEIVED',
    'ITEM_NOT_AS_DESCRIBED',
    'ITEM_DAMAGED',
    'HANDOVER_SAFETY',
    'PAYMENT_OR_PAYOUT',
    'OTHER'
  )),
  status text not null default 'OPEN' check (status in (
    'OPEN',
    'WAITING_FOR_BUYER',
    'WAITING_FOR_SELLER',
    'UNDER_REVIEW',
    'RESOLVED'
  )),
  payout_status_at_open text,
  payout_frozen boolean not null default false,
  resolution text check (
    resolution is null or resolution in (
      'AGREEMENT_REACHED',
      'SELLER_RESPONSIBLE',
      'BUYER_RESPONSIBLE',
      'INSUFFICIENT_EVIDENCE',
      'CLOSED_NO_ACTION',
      'OTHER'
    )
  ),
  payout_resolution text check (
    payout_resolution is null or payout_resolution in ('RELEASE','HOLD','NONE')
  ),
  resolution_note text check (
    resolution_note is null or char_length(btrim(resolution_note)) between 5 and 4000
  ),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists transaction_disputes_status_idx
  on public.transaction_disputes(status, updated_at desc);
create index if not exists transaction_disputes_opened_by_idx
  on public.transaction_disputes(opened_by, created_at desc);
create index if not exists transaction_disputes_resolved_by_idx
  on public.transaction_disputes(resolved_by)
  where resolved_by is not null;

create table if not exists public.transaction_dispute_messages (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.transaction_disputes(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (char_length(btrim(body)) between 1 and 3000),
  created_at timestamptz not null default now()
);

create index if not exists transaction_dispute_messages_case_idx
  on public.transaction_dispute_messages(dispute_id, created_at asc);
create index if not exists transaction_dispute_messages_author_idx
  on public.transaction_dispute_messages(author_id, created_at desc);

create table if not exists public.transaction_dispute_evidence (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.transaction_disputes(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  storage_path text not null unique,
  mime_type text not null check (mime_type in (
    'image/jpeg','image/png','image/webp','image/gif'
  )),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  created_at timestamptz not null default now()
);

create index if not exists transaction_dispute_evidence_case_idx
  on public.transaction_dispute_evidence(dispute_id, created_at asc);
create index if not exists transaction_dispute_evidence_uploader_idx
  on public.transaction_dispute_evidence(uploaded_by, created_at desc);

-- Private evidence bucket. All reads/writes happen through verified server
-- actions and signed URLs. Public object access is intentionally disabled.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'dispute-evidence',
  'dispute-evidence',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update
set public=excluded.public,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

alter table public.transaction_disputes enable row level security;
alter table public.transaction_dispute_messages enable row level security;
alter table public.transaction_dispute_evidence enable row level security;

drop policy if exists transaction_disputes_read_parties_staff on public.transaction_disputes;
create policy transaction_disputes_read_parties_staff
on public.transaction_disputes for select to authenticated
using (
  exists (
    select 1
    from public.transactions t
    where t.id=transaction_disputes.transaction_id
      and (t.buyer_id=(select auth.uid()) or t.seller_id=(select auth.uid()))
  )
  or public.has_permission((select auth.uid()), 'disputes.view')
);

drop policy if exists transaction_dispute_messages_read_parties_staff on public.transaction_dispute_messages;
create policy transaction_dispute_messages_read_parties_staff
on public.transaction_dispute_messages for select to authenticated
using (
  exists (
    select 1
    from public.transaction_disputes d
    join public.transactions t on t.id=d.transaction_id
    where d.id=transaction_dispute_messages.dispute_id
      and (
        t.buyer_id=(select auth.uid())
        or t.seller_id=(select auth.uid())
        or public.has_permission((select auth.uid()), 'disputes.view')
      )
  )
);

drop policy if exists transaction_dispute_evidence_read_parties_staff on public.transaction_dispute_evidence;
create policy transaction_dispute_evidence_read_parties_staff
on public.transaction_dispute_evidence for select to authenticated
using (
  exists (
    select 1
    from public.transaction_disputes d
    join public.transactions t on t.id=d.transaction_id
    where d.id=transaction_dispute_evidence.dispute_id
      and (
        t.buyer_id=(select auth.uid())
        or t.seller_id=(select auth.uid())
        or public.has_permission((select auth.uid()), 'disputes.view')
      )
  )
);

revoke insert, update, delete on public.transaction_disputes
  from anon, authenticated;
revoke insert, update, delete on public.transaction_dispute_messages
  from anon, authenticated;
revoke insert, update, delete on public.transaction_dispute_evidence
  from anon, authenticated;
grant select on public.transaction_disputes,
                public.transaction_dispute_messages,
                public.transaction_dispute_evidence
  to authenticated;
grant all on public.transaction_disputes,
             public.transaction_dispute_messages,
             public.transaction_dispute_evidence
  to service_role;

-- Extend the single notification vocabulary.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
check (type in (
  'AUCTION_PUBLISHED','NEW_BID','OUTBID','ENDING_SOON','WON','SOLD','ENDED_UNSOLD',
  'REVIEW_REQUEST','LISTING_REMOVED','BID_CONFIRMED','REVIEW_SUBMITTED','REVIEW_APPROVED',
  'REVIEW_REJECTED','REVIEW_CHANGES_REQUESTED','CANCELLATION_REQUESTED','CANCELLATION_DECIDED',
  'AUCTION_PAUSED','AUCTION_RESUMED','AUCTION_CANCELLED','NEW_MESSAGE','PAYMENT_EXPIRED',
  'STAFF_REVIEW_REQUIRED','PROMOTION_REQUESTED','PROMOTION_APPROVED','PROMOTION_REJECTED',
  'DELIVERY_CONFIRMED','PAYOUT_SENT','PAYOUT_SETUP_REQUIRED','PAYOUT_ATTENTION',
  'DISPUTE_OPENED','DISPUTE_MESSAGE','DISPUTE_STATUS_CHANGED',
  'DISPUTE_STAFF_REQUIRED','DISPUTE_RESOLVED'
));

create or replace function private.open_transaction_dispute(
  p_transaction_id uuid,
  p_reason text,
  p_summary text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  t public.transactions%rowtype;
  p public.seller_payouts%rowtype;
  v_existing uuid;
  v_dispute_id uuid;
  v_title text;
  v_counterparty uuid;
  v_frozen boolean := false;
  v_payout_found boolean := false;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode='42501';
  end if;

  if p_reason not in (
    'ITEM_NOT_RECEIVED','ITEM_NOT_AS_DESCRIBED','ITEM_DAMAGED',
    'HANDOVER_SAFETY','PAYMENT_OR_PAYOUT','OTHER'
  ) then
    raise exception 'invalid_reason' using errcode='22023';
  end if;

  if char_length(btrim(coalesce(p_summary,''))) not between 10 and 3000 then
    raise exception 'invalid_summary' using errcode='22023';
  end if;

  select * into t
    from public.transactions
   where id=p_transaction_id
   for update;
  if not found then
    raise exception 'transaction_not_found' using errcode='P0002';
  end if;

  if v_uid not in (t.buyer_id, t.seller_id) then
    raise exception 'not_party' using errcode='42501';
  end if;

  if t.status not in ('PAID','SETTLED') then
    raise exception 'payment_not_confirmed' using errcode='P0001';
  end if;

  select id into v_existing
    from public.transaction_disputes
   where transaction_id=t.id;
  if v_existing is not null then
    return v_existing;
  end if;

  select * into p
    from public.seller_payouts
   where transaction_id=t.id
   for update;
  v_payout_found := found;

  insert into public.transaction_disputes(
    transaction_id,
    opened_by,
    reason,
    payout_status_at_open,
    payout_frozen
  ) values (
    t.id,
    v_uid,
    p_reason,
    case when v_payout_found then p.status else null end,
    false
  )
  returning id into v_dispute_id;

  insert into public.transaction_dispute_messages(dispute_id, author_id, body)
  values(v_dispute_id, v_uid, btrim(p_summary));

  if v_payout_found and p.status in (
    'WAITING_FOR_FULFILMENT','DELIVERY_CONFIRMED','PAYOUT_PENDING'
  ) then
    update public.seller_payouts
       set status='DISPUTED',
           internal_note=coalesce(internal_note || E'\n','')
             || 'Payout frozen automatically when dispute ' || v_dispute_id::text || ' opened.'
     where id=p.id;
    v_frozen := true;

    update public.transaction_disputes
       set payout_frozen=true
     where id=v_dispute_id;
  end if;

  select a.title into v_title
    from public.auctions a
   where a.id=t.auction_id;
  v_counterparty := case when v_uid=t.buyer_id then t.seller_id else t.buyer_id end;

  insert into public.notifications(user_id,type,auction_id,payload)
  values (
    v_counterparty,
    'DISPUTE_OPENED',
    t.auction_id,
    jsonb_build_object(
      'title',coalesce(v_title,'Sale'),
      'disputeId',v_dispute_id,
      'transactionId',t.id
    )
  );

  insert into public.notifications(user_id,type,auction_id,payload)
  select distinct sa.user_id,
         'DISPUTE_STAFF_REQUIRED',
         t.auction_id,
         jsonb_build_object(
           'title',coalesce(v_title,'Sale'),
           'disputeId',v_dispute_id,
           'transactionId',t.id
         )
    from public.staff_assignments sa
   where sa.status='ACTIVE'
     and public.has_permission(sa.user_id,'disputes.manage');

  return v_dispute_id;
end;
$$;

create or replace function public.open_transaction_dispute(
  p_transaction_id uuid,
  p_reason text,
  p_summary text
)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select private.open_transaction_dispute(p_transaction_id,p_reason,p_summary);
$$;

create or replace function private.add_transaction_dispute_message(
  p_dispute_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  d public.transaction_disputes%rowtype;
  t public.transactions%rowtype;
  v_message_id uuid;
  v_staff boolean := false;
  v_title text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode='42501';
  end if;
  if char_length(btrim(coalesce(p_body,''))) not between 1 and 3000 then
    raise exception 'invalid_message' using errcode='22023';
  end if;

  select * into d from public.transaction_disputes where id=p_dispute_id for update;
  if not found then raise exception 'dispute_not_found' using errcode='P0002'; end if;
  if d.status='RESOLVED' then raise exception 'dispute_resolved' using errcode='P0001'; end if;

  select * into t from public.transactions where id=d.transaction_id;
  v_staff := public.has_permission(v_uid,'disputes.manage');
  if v_uid not in (t.buyer_id,t.seller_id) and not v_staff then
    raise exception 'not_party' using errcode='42501';
  end if;

  insert into public.transaction_dispute_messages(dispute_id,author_id,body)
  values(d.id,v_uid,btrim(p_body))
  returning id into v_message_id;

  update public.transaction_disputes
     set updated_at=clock_timestamp()
   where id=d.id;

  select a.title into v_title from public.auctions a where a.id=t.auction_id;

  if v_staff then
    insert into public.notifications(user_id,type,auction_id,payload)
    select u,'DISPUTE_MESSAGE',t.auction_id,
           jsonb_build_object(
             'title',coalesce(v_title,'Sale'),
             'disputeId',d.id,
             'transactionId',t.id
           )
      from unnest(array[t.buyer_id,t.seller_id]) as u;
  else
    insert into public.notifications(user_id,type,auction_id,payload)
    values (
      case when v_uid=t.buyer_id then t.seller_id else t.buyer_id end,
      'DISPUTE_MESSAGE',
      t.auction_id,
      jsonb_build_object(
        'title',coalesce(v_title,'Sale'),
        'disputeId',d.id,
        'transactionId',t.id
      )
    );

    insert into public.notifications(user_id,type,auction_id,payload)
    select distinct sa.user_id,
           'DISPUTE_STAFF_REQUIRED',
           t.auction_id,
           jsonb_build_object(
             'title',coalesce(v_title,'Sale'),
             'disputeId',d.id,
             'transactionId',t.id
           )
      from public.staff_assignments sa
     where sa.status='ACTIVE'
       and public.has_permission(sa.user_id,'disputes.manage');
  end if;

  return v_message_id;
end;
$$;

create or replace function public.add_transaction_dispute_message(
  p_dispute_id uuid,
  p_body text
)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select private.add_transaction_dispute_message(p_dispute_id,p_body);
$$;

create or replace function private.staff_update_transaction_dispute(
  p_dispute_id uuid,
  p_status text,
  p_resolution text default null,
  p_payout_resolution text default null,
  p_resolution_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  d public.transaction_disputes%rowtype;
  t public.transactions%rowtype;
  p public.seller_payouts%rowtype;
  v_release_status text;
  v_title text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if not public.has_permission(v_uid,'disputes.manage') then
    raise exception 'not_staff' using errcode='42501';
  end if;

  if p_status not in (
    'OPEN','WAITING_FOR_BUYER','WAITING_FOR_SELLER','UNDER_REVIEW','RESOLVED'
  ) then
    raise exception 'invalid_status' using errcode='22023';
  end if;

  select * into d from public.transaction_disputes where id=p_dispute_id for update;
  if not found then raise exception 'dispute_not_found' using errcode='P0002'; end if;
  if d.status='RESOLVED' then raise exception 'dispute_resolved' using errcode='P0001'; end if;

  select * into t from public.transactions where id=d.transaction_id;
  select * into p from public.seller_payouts where transaction_id=t.id for update;

  if p_status='RESOLVED' then
    if p_resolution not in (
      'AGREEMENT_REACHED','SELLER_RESPONSIBLE','BUYER_RESPONSIBLE',
      'INSUFFICIENT_EVIDENCE','CLOSED_NO_ACTION','OTHER'
    ) then
      raise exception 'resolution_required' using errcode='22023';
    end if;
    if p_payout_resolution not in ('RELEASE','HOLD','NONE') then
      raise exception 'payout_resolution_required' using errcode='22023';
    end if;
    if char_length(btrim(coalesce(p_resolution_note,''))) not between 5 and 4000 then
      raise exception 'resolution_note_required' using errcode='22023';
    end if;

    if p_payout_resolution in ('RELEASE','HOLD')
       and p.status in ('PAYOUT_DUE','PAID_OUT') then
      raise exception 'payout_not_safely_reversible' using errcode='P0001';
    end if;

    if p_payout_resolution='RELEASE' and p.status in ('DISPUTED','HELD') then
      v_release_status := case
        when p.delivery_confirmed_at is not null then 'PAYOUT_PENDING'
        else 'WAITING_FOR_FULFILMENT'
      end;
      update public.seller_payouts
         set status=v_release_status,
             internal_note=coalesce(internal_note || E'\n','')
               || 'Dispute ' || d.id::text || ' resolved: payout released for normal processing.'
       where id=p.id;
    elsif p_payout_resolution='HOLD' and p.status not in ('HELD','PAID_OUT','PAYOUT_DUE') then
      update public.seller_payouts
         set status='HELD',
             internal_note=coalesce(internal_note || E'\n','')
               || 'Dispute ' || d.id::text || ' resolved: payout remains held for off-platform agreement.'
       where id=p.id;
    end if;

    update public.transaction_disputes
       set status='RESOLVED',
           resolution=p_resolution,
           payout_resolution=p_payout_resolution,
           resolution_note=btrim(p_resolution_note),
           resolved_by=v_uid,
           resolved_at=clock_timestamp(),
           updated_at=clock_timestamp()
     where id=d.id;
  else
    update public.transaction_disputes
       set status=p_status,
           updated_at=clock_timestamp()
     where id=d.id;
  end if;

  select a.title into v_title from public.auctions a where a.id=t.auction_id;

  insert into public.notifications(user_id,type,auction_id,payload)
  select u,
         case when p_status='RESOLVED' then 'DISPUTE_RESOLVED' else 'DISPUTE_STATUS_CHANGED' end,
         t.auction_id,
         jsonb_build_object(
           'title',coalesce(v_title,'Sale'),
           'disputeId',d.id,
           'transactionId',t.id,
           'status',p_status,
           'resolution',p_resolution,
           'payoutResolution',p_payout_resolution
         )
    from unnest(array[t.buyer_id,t.seller_id]) as u;

  return jsonb_build_object(
    'ok',true,
    'dispute_id',d.id,
    'status',p_status,
    'payout_resolution',p_payout_resolution
  );
end;
$$;

create or replace function public.staff_update_transaction_dispute(
  p_dispute_id uuid,
  p_status text,
  p_resolution text default null,
  p_payout_resolution text default null,
  p_resolution_note text default null
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.staff_update_transaction_dispute(
    p_dispute_id,p_status,p_resolution,p_payout_resolution,p_resolution_note
  );
$$;

revoke all on function private.open_transaction_dispute(uuid,text,text)
  from public,anon;
revoke all on function private.add_transaction_dispute_message(uuid,text)
  from public,anon;
revoke all on function private.staff_update_transaction_dispute(uuid,text,text,text,text)
  from public,anon;

grant execute on function private.open_transaction_dispute(uuid,text,text)
  to authenticated,service_role;
grant execute on function private.add_transaction_dispute_message(uuid,text)
  to authenticated,service_role;
grant execute on function private.staff_update_transaction_dispute(uuid,text,text,text,text)
  to authenticated,service_role;

revoke all on function public.open_transaction_dispute(uuid,text,text)
  from public,anon;
revoke all on function public.add_transaction_dispute_message(uuid,text)
  from public,anon;
revoke all on function public.staff_update_transaction_dispute(uuid,text,text,text,text)
  from public,anon;

grant execute on function public.open_transaction_dispute(uuid,text,text)
  to authenticated,service_role;
grant execute on function public.add_transaction_dispute_message(uuid,text)
  to authenticated,service_role;
grant execute on function public.staff_update_transaction_dispute(uuid,text,text,text,text)
  to authenticated,service_role;
