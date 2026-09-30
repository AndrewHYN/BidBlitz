-- ===========================================================================
-- Team RBAC: roles, permissions, assignments, invitations, audit
-- ===========================================================================
--
-- WHY THIS EXISTS
--
-- BidBlitz is operated by people, and `profiles.is_admin` (one boolean, all
-- powers) cannot tell a moderator from finance. This adds the durable model:
-- roles hold permissions, users hold assignments, and every change is
-- audited. `is_admin` stays as a compatibility mirror, maintained by the
-- RPCs below, until every dependency is migrated and proven.
--
-- OWNER BOOTSTRAP. The current production owner is determined from
-- authoritative database state, not from a name in this file: every profile
-- carrying is_admin at migration time receives the OWNER role. The project
-- verifies continuously (db:verify asserts exactly one admin, a real
-- account), so this set is known to be exactly the operator. granted_by is
-- the same row, with the reason saying so plainly.
--
-- INVIOLABLE RULES (enforced in the RPCs, tested in db:verify):
--   owner assignments change only by OWNER actors;
--   the last OWNER cannot be revoked or suspended;
--   nobody targets themselves;
--   nobody grants a permission they do not hold (OWNER bypasses: holds all);
--   revoked/suspended assignments authorize nothing;
--   every change writes staff_audit, which has no write surface for anyone.
--
-- Permissions are strings like 'listings.takedown', grouped by category.
-- Sensitive ones are flagged for the UI, which must show them distinctly.

-- ---- 1. catalog ---------------------------------------------------------------
create table if not exists public.staff_roles (
  key         text primary key,
  name        text not null,
  description text not null,
  is_system   boolean not null default true
);

create table if not exists public.staff_permissions (
  key         text primary key,
  category    text not null,
  description text not null,
  sensitive   boolean not null default false
);

create table if not exists public.staff_role_permissions (
  role_key        text not null references public.staff_roles(key),
  permission_key  text not null references public.staff_permissions(key),
  granted_by      uuid references public.profiles(id),
  granted_at      timestamptz not null default now(),
  primary key (role_key, permission_key)
);

insert into public.staff_roles (key, name, description, is_system) values
  ('OWNER',     'Platform Owner', 'Full platform control. One holder.', true),
  ('ADMIN',     'Administrator',  'Broad marketplace, moderation, user and operational powers.', true),
  ('MODERATOR', 'Moderator',      'Listing review, takedown, pause/resume, reports, user moderation.', true),
  ('OPERATIONS','Operations',     'Day-to-day ops and seller support. No team or finance powers.', true),
  ('FINANCE',   'Finance',        'Payments, payouts and reporting. No moderation or team powers.', true),
  ('SUPPORT',   'Support',        'User assistance and visibility. No mutation powers.', true)
on conflict (key) do nothing;

insert into public.staff_permissions (key, category, description, sensitive) values
  ('admin.access',            'ADMIN',  'Open the admin console.', false),
  ('admin.manage_team',       'ADMIN',  'Promote, demote, suspend and revoke staff.', true),
  ('admin.manage_roles',      'ADMIN',  'Create roles and change role permission bundles.', true),
  ('admin.view_audit',        'ADMIN',  'Read the team audit trail.', true),
  ('listings.view',           'LISTINGS','Inspect any listing.', false),
  ('listings.review',         'LISTINGS','Review held listings.', false),
  ('listings.approve',        'LISTINGS','Approve a held listing.', false),
  ('listings.reject',         'LISTINGS','Reject a held listing.', false),
  ('listings.request_changes','LISTINGS','Send a listing back for changes.', false),
  ('listings.takedown',       'LISTINGS','Take down a violating listing.', true),
  ('auctions.view',           'AUCTIONS','Inspect any auction and its history.', false),
  ('auctions.pause',          'AUCTIONS','Pause a live auction for safety review.', true),
  ('auctions.resume',         'AUCTIONS','Resume a paused auction.', false),
  ('auctions.cancel',         'AUCTIONS','Cancel an auction as the operator.', true),
  ('auctions.review_cancellation','AUCTIONS','Decide seller cancellation requests.', false),
  ('auctions.view_bid_history','AUCTIONS','See full bid history including bidder identities.', false),
  ('users.view',              'USERS',  'Inspect any user profile.', false),
  ('users.contact_support',   'USERS',  'Contact users on support matters.', false),
  ('users.suspend',           'USERS',  'Suspend an account.', true),
  ('users.restore',           'USERS',  'Restore a suspended account.', false),
  ('users.view_moderation_history','USERS','See a user''s moderation record.', false),
  ('reports.view',            'REPORTS','Read the moderation queue.', false),
  ('reports.review',          'REPORTS','Mark reports under review.', false),
  ('reports.resolve',         'REPORTS','Resolve reports.', false),
  ('reports.dismiss',         'REPORTS','Dismiss reports.', false),
  ('payments.view',           'PAYMENTS','See payment records.', false),
  ('payments.view_sensitive', 'PAYMENTS','See sensitive payment detail.', true),
  ('payments.review_exceptions','PAYMENTS','Review payment exceptions.', false),
  ('payments.refund',         'PAYMENTS','Issue refunds.', true),
  ('payments.manage_payment_state','PAYMENTS','Change payment state by hand.', true),
  ('payouts.view',            'PAYOUTS','See payout records.', false),
  ('payouts.review',          'PAYOUTS','Review payouts.', false),
  ('payouts.transition',      'PAYOUTS','Move payouts through the workflow.', true),
  ('payouts.mark_paid',       'PAYOUTS','Record a seller payout as paid.', true),
  ('settings.view',           'SETTINGS','See marketplace settings.', false),
  ('settings.manage_marketplace','SETTINGS','Change marketplace settings.', true),
  ('settings.manage_fees',    'SETTINGS','Change the platform fee.', true),
  ('notifications.view',      'NOTIFICATIONS','See notification traffic.', false),
  ('notifications.manage_templates','NOTIFICATIONS','Change notification copy.', false),
  ('notifications.view_delivery_failures','NOTIFICATIONS','See email delivery failures.', false),
  ('analytics.view',          'ANALYTICS','See platform analytics.', false)
on conflict (key) do nothing;

-- Bundles. OWNER is intentionally absent: ownership implies every permission
-- without enumerating them, so a newly added permission is owner-held from
-- birth rather than waiting for a bundle update.
insert into public.staff_role_permissions (role_key, permission_key) values
  -- ADMIN: everything except ownership-level team control is granted below
  -- through the individual rows; OWNER-only paths (assign OWNER, touch OWNER
  -- rows, manage_roles) are refused in the RPCs regardless of bundles.
  ('ADMIN','admin.access'),('ADMIN','admin.manage_team'),('ADMIN','admin.view_audit'),
  ('ADMIN','listings.view'),('ADMIN','listings.review'),('ADMIN','listings.approve'),
  ('ADMIN','listings.reject'),('ADMIN','listings.request_changes'),('ADMIN','listings.takedown'),
  ('ADMIN','auctions.view'),('ADMIN','auctions.pause'),('ADMIN','auctions.resume'),
  ('ADMIN','auctions.cancel'),('ADMIN','auctions.review_cancellation'),('ADMIN','auctions.view_bid_history'),
  ('ADMIN','users.view'),('ADMIN','users.contact_support'),('ADMIN','users.suspend'),
  ('ADMIN','users.restore'),('ADMIN','users.view_moderation_history'),
  ('ADMIN','reports.view'),('ADMIN','reports.review'),('ADMIN','reports.resolve'),('ADMIN','reports.dismiss'),
  ('ADMIN','payments.view'),('ADMIN','payments.view_sensitive'),('ADMIN','payments.review_exceptions'),
  ('ADMIN','payments.refund'),('ADMIN','payments.manage_payment_state'),
  ('ADMIN','payouts.view'),('ADMIN','payouts.review'),('ADMIN','payouts.transition'),('ADMIN','payouts.mark_paid'),
  ('ADMIN','settings.view'),('ADMIN','settings.manage_marketplace'),('ADMIN','settings.manage_fees'),
  ('ADMIN','notifications.view'),('ADMIN','notifications.manage_templates'),
  ('ADMIN','notifications.view_delivery_failures'),('ADMIN','analytics.view'),
  -- MODERATOR: moderation only. No payouts, no team, no fees.
  ('MODERATOR','admin.access'),
  ('MODERATOR','listings.view'),('MODERATOR','listings.review'),('MODERATOR','listings.approve'),
  ('MODERATOR','listings.reject'),('MODERATOR','listings.request_changes'),('MODERATOR','listings.takedown'),
  ('MODERATOR','auctions.view'),('MODERATOR','auctions.pause'),('MODERATOR','auctions.resume'),
  ('MODERATOR','auctions.cancel'),('MODERATOR','auctions.review_cancellation'),('MODERATOR','auctions.view_bid_history'),
  ('MODERATOR','users.view'),('MODERATOR','users.contact_support'),('MODERATOR','users.suspend'),
  ('MODERATOR','users.restore'),('MODERATOR','users.view_moderation_history'),
  ('MODERATOR','reports.view'),('MODERATOR','reports.review'),('MODERATOR','reports.resolve'),('MODERATOR','reports.dismiss'),
  ('MODERATOR','notifications.view'),
  -- OPERATIONS: ops and seller support. No team, no finance mutation, no ban.
  ('OPERATIONS','admin.access'),
  ('OPERATIONS','listings.view'),('OPERATIONS','listings.review'),
  ('OPERATIONS','auctions.view'),('OPERATIONS','auctions.cancel'),('OPERATIONS','auctions.review_cancellation'),
  ('OPERATIONS','users.view'),('OPERATIONS','users.contact_support'),
  ('OPERATIONS','reports.view'),('OPERATIONS','reports.review'),
  ('OPERATIONS','notifications.view'),
  -- FINANCE: money in and money out. No moderation, no team.
  ('FINANCE','admin.access'),
  ('FINANCE','payments.view'),('FINANCE','payments.view_sensitive'),('FINANCE','payments.review_exceptions'),
  ('FINANCE','payouts.view'),('FINANCE','payouts.review'),('FINANCE','payouts.transition'),('FINANCE','payouts.mark_paid'),
  ('FINANCE','settings.view'),
  ('FINANCE','notifications.view'),
  -- SUPPORT: visibility and assistance only. No mutation powers at all.
  ('SUPPORT','admin.access'),
  ('SUPPORT','users.view'),('SUPPORT','users.contact_support'),
  ('SUPPORT','auctions.view'),
  ('SUPPORT','notifications.view')
on conflict do nothing;

-- ---- 2. assignments, invitations, audit ------------------------------------------
create table if not exists public.staff_assignments (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid not null references public.profiles(id),
  role_key    text not null references public.staff_roles(key),
  status      text not null default 'ACTIVE' check (status in ('ACTIVE','SUSPENDED','REVOKED')),
  granted_by  uuid references public.profiles(id),
  granted_at  timestamptz not null default now(),
  reason      text check (reason is null or char_length(reason) <= 1000),
  revoked_at  timestamptz
);
-- One live-or-suspended row per (user, role): re-assigning after a revoke
-- writes a new row (history), never resurrects the old one.
create unique index if not exists staff_assignments_one_live_idx
  on public.staff_assignments (user_id, role_key)
  where status in ('ACTIVE','SUSPENDED');
create index if not exists staff_assignments_user_idx
  on public.staff_assignments (user_id, status);

create table if not exists public.team_invitations (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  email        text not null,
  role_key     text not null references public.staff_roles(key),
  invited_by   uuid not null references public.profiles(id),
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  revoked_at   timestamptz
);
-- One outstanding invitation per address: the partial index cannot express
-- expiry (now() is stable, not immutable), so expiry is enforced in the RPC
-- and a second active invite is refused there too.
create unique index if not exists team_invitations_one_active_idx
  on public.team_invitations (lower(email))
  where accepted_at is null and revoked_at is null;

create table if not exists public.staff_audit (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  actor_id       uuid not null references public.profiles(id),
  action         text not null check (action in (
                   'TEAM_MEMBER_INVITED','TEAM_MEMBER_INVITE_REVOKED',
                   'ROLE_ASSIGNED','ROLE_REMOVED',
                   'STAFF_SUSPENDED','STAFF_RESTORED','STAFF_REVOKED',
                   'INVITE_ACCEPTED'
                 )),
  target_user_id uuid references public.profiles(id),
  previous_state jsonb not null default '{}'::jsonb,
  new_state      jsonb not null default '{}'::jsonb,
  reason         text check (reason is null or char_length(reason) <= 1000)
);
create index if not exists staff_audit_target_idx
  on public.staff_audit (target_user_id, created_at desc);

-- RLS: assignments readable by the holder and by admins; invitations readable
-- by admins (the invitee has no account yet, so acceptance runs through an
-- RPC that checks the token, not through RLS); audit readable by admins.
-- No client writes anywhere here: every mutation below goes through the RPCs.
alter table public.staff_roles enable row level security;
alter table public.staff_permissions enable row level security;
alter table public.staff_role_permissions enable row level security;
alter table public.staff_assignments enable row level security;
alter table public.team_invitations enable row level security;
alter table public.staff_audit enable row level security;

drop policy if exists staff_catalog_read on public.staff_roles;
create policy staff_catalog_read on public.staff_roles for select to authenticated using (true);
drop policy if exists staff_permissions_read on public.staff_permissions;
create policy staff_permissions_read on public.staff_permissions for select to authenticated using (true);
drop policy if exists staff_role_permissions_read on public.staff_role_permissions;
create policy staff_role_permissions_read on public.staff_role_permissions for select to authenticated using (true);

drop policy if exists staff_assignments_read on public.staff_assignments;
create policy staff_assignments_read on public.staff_assignments
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());

drop policy if exists team_invitations_admin_read on public.team_invitations;
create policy team_invitations_admin_read on public.team_invitations
  for select to authenticated using (private.is_admin());

drop policy if exists staff_audit_admin_read on public.staff_audit;
create policy staff_audit_admin_read on public.staff_audit
  for select to authenticated using (private.is_admin());

-- ---- 3. permission evaluation -------------------------------------------------------
-- The single source of truth. OWNER implies everything (so new permissions are
-- owner-held from birth); otherwise an ACTIVE assignment whose role grants it.
-- Read live on every call: revocation takes effect on the next check, never
-- on the next login. No JWT claims involved, by design (stale claims would
-- let a revoked staffer keep working until refresh).
create or replace function public.has_permission(p_user_id uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff_assignments a
    where a.user_id = p_user_id
      and a.status = 'ACTIVE'
      and (
        a.role_key = 'OWNER'
        or exists (select 1 from public.staff_role_permissions r
                    where r.role_key = a.role_key
                      and r.permission_key = p_permission)
      )
  );
$$;

-- ---- 4. owner bootstrap ---------------------------------------------------------------
-- From authoritative state: whoever carries is_admin becomes OWNER. The suite
-- asserts this set is exactly the operator, so the migration cannot crown a
-- stranger. granted_by points at the same row, with the reason saying so.
insert into public.staff_assignments (user_id, role_key, status, granted_by, reason)
select id, 'OWNER', 'ACTIVE', id,
       'Initial owner: sole administrator at RBAC migration time.'
  from public.profiles where is_admin
on conflict do nothing;

-- ---- 5. team RPCs --------------------------------------------------------------------------
create or replace function public.admin_assign_role(
  p_user_id  uuid,
  p_role_key text,
  p_reason   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_is_owner boolean;
  v_perm     text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not public.has_permission(v_uid, 'admin.manage_team') then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if p_user_id is null then raise exception 'user_not_found' using errcode = 'P0002'; end if;
  if p_user_id = v_uid then
    raise exception 'cannot_target_self' using errcode = 'P0001';
  end if;
  if p_role_key is null
     or not exists (select 1 from public.staff_roles r where r.key = p_role_key) then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if p_role_key = 'OWNER' then
    raise exception 'owner_only' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  v_is_owner := public.has_permission(v_uid, 'admin.manage_roles')
                and exists (select 1 from public.staff_assignments a
                             where a.user_id = v_uid and a.role_key = 'OWNER'
                               and a.status = 'ACTIVE');
  -- Least privilege on granting: every permission in the target role must
  -- already be held by the granter, or the granter is manufacturing access
  -- they do not have. OWNER bypasses because OWNER holds everything.
  if not v_is_owner then
    for v_perm in select r.permission_key from public.staff_role_permissions r
                   where r.role_key = p_role_key loop
      if not public.has_permission(v_uid, v_perm) then
        raise exception 'cannot_grant_unheld' using errcode = 'P0001';
      end if;
    end loop;
  end if;
  -- Nobody touches OWNER rows without being OWNER.
  if exists (select 1 from public.staff_assignments a
              where a.user_id = p_user_id and a.role_key = 'OWNER'
                and a.status in ('ACTIVE','SUSPENDED')) and not v_is_owner then
    raise exception 'owner_only' using errcode = 'P0001';
  end if;

  insert into public.staff_assignments (user_id, role_key, status, granted_by, reason)
  values (p_user_id, p_role_key, 'ACTIVE', v_uid,
          nullif(trim(coalesce(p_reason, '')), ''))
  on conflict do nothing;

  insert into public.staff_audit
    (actor_id, action, target_user_id, new_state, reason)
  values
    (v_uid, 'ROLE_ASSIGNED', p_user_id,
     jsonb_build_object('role', p_role_key),
     nullif(trim(coalesce(p_reason, '')), ''));

  perform public.staff_sync_is_admin(p_user_id);

  return jsonb_build_object('ok', true, 'role', p_role_key);
end;
$$;

-- Keeps the legacy boolean mirror in step with roles. ADMIN or OWNER active
-- implies is_admin; otherwise it clears. Called by every team RPC, never by
-- clients (no EXECUTE grant below includes it for them... it is granted to
-- authenticated because the RPCs run as the caller? No: SECURITY DEFINER runs
-- as the owner, so callers need no grant on helpers at all. Revoked below.)
create or replace function public.staff_sync_is_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set is_admin =
    exists (select 1 from public.staff_assignments a
             where a.user_id = p_user_id and a.status = 'ACTIVE'
               and a.role_key in ('OWNER','ADMIN'))
   where id = p_user_id;
end;
$$;

create or replace function public.admin_set_assignment_status(
  p_assignment_id uuid,
  p_status        text,
  p_reason        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_is_owner boolean;
  v_row      public.staff_assignments%rowtype;
  v_owners   integer;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not public.has_permission(v_uid, 'admin.manage_team') then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if p_status not in ('SUSPENDED','REVOKED','ACTIVE') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select * into v_row from public.staff_assignments
   where id = p_assignment_id for update;
  if not found then raise exception 'assignment_not_found' using errcode = 'P0002'; end if;
  if v_row.user_id = v_uid then
    raise exception 'cannot_target_self' using errcode = 'P0001';
  end if;

  v_is_owner := exists (select 1 from public.staff_assignments a
                         where a.user_id = v_uid and a.role_key = 'OWNER'
                           and a.status = 'ACTIVE');
  -- OWNER rows move only by OWNER hands, and the last OWNER never moves.
  if v_row.role_key = 'OWNER' then
    if not v_is_owner then
      raise exception 'owner_only' using errcode = 'P0001';
    end if;
    if p_status in ('SUSPENDED','REVOKED') then
      select count(*) into v_owners from public.staff_assignments
       where role_key = 'OWNER' and status = 'ACTIVE' and id <> v_row.id;
      if v_owners = 0 then
        raise exception 'last_owner' using errcode = 'P0001';
      end if;
    end if;
  end if;

  update public.staff_assignments
     set status = p_status,
         revoked_at = case when p_status = 'REVOKED' then clock_timestamp() else revoked_at end
   where id = v_row.id;

  insert into public.staff_audit
    (actor_id, action, target_user_id,
     previous_state, new_state, reason)
  values
    (v_uid,
     case p_status when 'SUSPENDED' then 'STAFF_SUSPENDED'
                   when 'REVOKED' then 'STAFF_REVOKED'
                   else 'STAFF_RESTORED' end,
     v_row.user_id,
     jsonb_build_object('role', v_row.role_key, 'status', v_row.status),
     jsonb_build_object('role', v_row.role_key, 'status', p_status),
     nullif(trim(coalesce(p_reason, '')), ''));

  perform public.staff_sync_is_admin(v_row.user_id);

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

-- Revoke everything at once: the "remove from team" path. Same OWNER guards
-- per row, applied in one pass; OWNER rows need an OWNER actor each.
create or replace function public.admin_revoke_all_access(
  p_user_id uuid,
  p_reason  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_is_owner boolean;
  v_row      record;
  v_owners   integer;
  v_count    integer := 0;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not public.has_permission(v_uid, 'admin.manage_team') then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if p_user_id = v_uid then
    raise exception 'cannot_target_self' using errcode = 'P0001';
  end if;

  v_is_owner := exists (select 1 from public.staff_assignments a
                         where a.user_id = v_uid and a.role_key = 'OWNER'
                           and a.status = 'ACTIVE');

  for v_row in select * from public.staff_assignments
                where user_id = p_user_id and status in ('ACTIVE','SUSPENDED')
                for update loop
    if v_row.role_key = 'OWNER' then
      if not v_is_owner then
        raise exception 'owner_only' using errcode = 'P0001';
      end if;
      select count(*) into v_owners from public.staff_assignments
       where role_key = 'OWNER' and status = 'ACTIVE' and id <> v_row.id;
      if v_owners = 0 then
        raise exception 'last_owner' using errcode = 'P0001';
      end if;
    end if;

    update public.staff_assignments
       set status = 'REVOKED', revoked_at = clock_timestamp()
     where id = v_row.id;
    v_count := v_count + 1;
  end loop;

  insert into public.staff_audit
    (actor_id, action, target_user_id, new_state, reason)
  values
    (v_uid, 'STAFF_REVOKED', p_user_id,
     jsonb_build_object('assignments_revoked', v_count),
     nullif(trim(coalesce(p_reason, '')), ''));

  perform public.staff_sync_is_admin(p_user_id);

  return jsonb_build_object('ok', true, 'revoked', v_count);
end;
$$;

-- Invitations: single-use, 72-hour, token hashed at rest. The raw token is
-- returned ONCE, to be emailed; afterwards only the hash exists.
create or replace function public.admin_invite_member(
  p_email    text,
  p_role_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_is_owner boolean;
  v_token    text := encode(gen_random_bytes(32), 'hex');
  v_id       uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not public.has_permission(v_uid, 'admin.manage_team') then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if p_email is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if p_role_key is null
     or not exists (select 1 from public.staff_roles r where r.key = p_role_key) then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  v_is_owner := exists (select 1 from public.staff_assignments a
                         where a.user_id = v_uid and a.role_key = 'OWNER'
                           and a.status = 'ACTIVE');
  if p_role_key = 'OWNER' and not v_is_owner then
    raise exception 'owner_only' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.team_invitations i
              where lower(i.email) = lower(p_email)
                and i.accepted_at is null and i.revoked_at is null
                and i.expires_at > clock_timestamp()) then
    raise exception 'duplicate_invite' using errcode = 'P0001';
  end if;

  insert into public.team_invitations
    (email, role_key, invited_by, token_hash, expires_at)
  values
    (lower(p_email), p_role_key, v_uid,
     encode(digest(v_token, 'sha256'), 'hex'),
     clock_timestamp() + interval '72 hours')
  returning id into v_id;

  insert into public.staff_audit
    (actor_id, action, previous_state, new_state)
  values
    (v_uid, 'TEAM_MEMBER_INVITED', '{}'::jsonb,
     jsonb_build_object('email', lower(p_email), 'role', p_role_key,
                        'invitation_id', v_id));

  -- The raw token leaves the database exactly once, in this return value, to
  -- be emailed. Afterwards only the hash exists; a database read can never
  -- reconstruct an invitation link.
  return jsonb_build_object('ok', true, 'invitation_id', v_id, 'token', v_token);
end;
$$;

create or replace function public.admin_revoke_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not public.has_permission(v_uid, 'admin.manage_team') then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  update public.team_invitations set revoked_at = clock_timestamp()
   where id = p_invite_id and accepted_at is null and revoked_at is null;
  if not found then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  insert into public.staff_audit (actor_id, action, new_state)
  values (v_uid, 'TEAM_MEMBER_INVITE_REVOKED',
          jsonb_build_object('invitation_id', p_invite_id));

  return jsonb_build_object('ok', true);
end;
$$;

-- Acceptance binds the SIGNED-IN account whose email matches, nothing else:
-- entering an address never grants anything, and a mismatched session learns
-- nothing beyond "invalid". Single-use via the accepted_at guard under lock.
create or replace function public.accept_team_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  inv     public.team_invitations%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_token is null or char_length(p_token) <> 64 then
    raise exception 'invalid_invite' using errcode = 'P0001';
  end if;

  select * into inv from public.team_invitations
   where token_hash = encode(digest(p_token, 'sha256'), 'hex')
   for update;
  if not found then raise exception 'invalid_invite' using errcode = 'P0001'; end if;
  if inv.accepted_at is not null or inv.revoked_at is not null
     or inv.expires_at <= clock_timestamp() then
    raise exception 'invalid_invite' using errcode = 'P0001';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if v_email is null or lower(v_email) <> lower(inv.email) then
    raise exception 'invalid_invite' using errcode = 'P0001';
  end if;

  update public.team_invitations set accepted_at = clock_timestamp()
   where id = inv.id;

  insert into public.staff_assignments (user_id, role_key, status, granted_by,
    reason)
  values (v_uid, inv.role_key, 'ACTIVE', inv.invited_by,
          'Accepted team invitation.')
  on conflict do nothing;

  insert into public.staff_audit
    (actor_id, action, target_user_id, new_state)
  values
    (v_uid, 'INVITE_ACCEPTED', v_uid,
     jsonb_build_object('role', inv.role_key, 'invitation_id', inv.id));

  perform public.staff_sync_is_admin(v_uid);

  return jsonb_build_object('ok', true, 'role', inv.role_key);
end;
$$;

-- ---- 6. grants ---------------------------------------------------------------
revoke all on function public.has_permission(uuid, text) from public, anon;
revoke all on function public.admin_assign_role(uuid, text, text) from public, anon;
revoke all on function public.admin_set_assignment_status(uuid, text, text) from public, anon;
revoke all on function public.admin_revoke_all_access(uuid, text) from public, anon;
revoke all on function public.admin_invite_member(text, text) from public, anon;
revoke all on function public.admin_revoke_invite(uuid) from public, anon;
revoke all on function public.accept_team_invite(text) from public, anon;
revoke all on function public.staff_sync_is_admin(uuid) from public, anon;
grant execute on function public.has_permission(uuid, text) to authenticated, service_role;
grant execute on function public.admin_assign_role(uuid, text, text) to authenticated, service_role;
grant execute on function public.admin_set_assignment_status(uuid, text, text) to authenticated, service_role;
grant execute on function public.admin_revoke_all_access(uuid, text) to authenticated, service_role;
grant execute on function public.admin_invite_member(text, text) to authenticated, service_role;
grant execute on function public.admin_revoke_invite(uuid) to authenticated, service_role;
grant execute on function public.accept_team_invite(text) to authenticated, service_role;
-- staff_sync_is_admin runs only from inside the RPCs above (definer context);
-- no caller needs it directly, so it keeps no grant at all.
