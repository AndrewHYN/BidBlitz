-- ===========================================================================
-- Invite token hashing: schema-qualify pgcrypto calls
-- ===========================================================================
--
-- DEFECT. admin_invite_member and accept_team_invite run with
-- `set search_path = ''` (correct: no attacker-influenced schema can shadow
-- anything), but call gen_random_bytes() and digest() unqualified. Those live
-- in the `extensions` schema where Supabase installs pgcrypto - not in
-- pg_catalog, which is the only schema implicitly searched when search_path
-- is empty. So every invitation and every acceptance raised
-- "function does not exist" at runtime: invites could never be created.
-- (encode() is pg_catalog and was never affected.)
--
-- FIX. Re-create both functions with extensions-qualified calls. Bodies are
-- otherwise identical to 20260930000003_team_rbac.sql; nothing about the
-- invitation security model changes.

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
  v_token    text := encode(extensions.gen_random_bytes(32), 'hex');
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
     encode(extensions.digest(v_token, 'sha256'), 'hex'),
     clock_timestamp() + interval '72 hours')
  returning id into v_id;

  insert into public.staff_audit
    (actor_id, action, previous_state, new_state)
  values
    (v_uid, 'TEAM_MEMBER_INVITED', '{}'::jsonb,
     jsonb_build_object('email', lower(p_email), 'role', p_role_key,
                        'invitation_id', v_id));

  return jsonb_build_object('ok', true, 'invitation_id', v_id, 'token', v_token);
end;
$$;

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
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
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
