-- BidBlitz controlled referral attribution: NO coins, credits, payouts or rewards.
-- No email/phone in this table. One immutable attribution per new user.
create table if not exists public.referral_codes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  code text not null unique check (code ~ '^BB[A-F0-9]{10}$'),
  created_at timestamptz not null default clock_timestamp()
);
create table if not exists public.referral_signups (
  referred_user_id uuid primary key references public.profiles(id) on delete cascade,
  referrer_user_id uuid not null references public.profiles(id) on delete cascade,
  code text not null references public.referral_codes(code),
  created_at timestamptz not null default clock_timestamp(),
  check (referrer_user_id <> referred_user_id)
);
create index if not exists referral_signups_by_referrer on public.referral_signups(referrer_user_id,created_at desc);

alter table public.referral_codes enable row level security;
alter table public.referral_signups enable row level security;
revoke all on public.referral_codes,public.referral_signups from public,anon,authenticated;
grant select on public.referral_codes to authenticated;
drop policy if exists referral_codes_read_own on public.referral_codes;
create policy referral_codes_read_own on public.referral_codes for select to authenticated
using (auth.uid()=user_id);

create or replace function public.my_referral_code()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_code text; v_attempt int;
begin
 if v_uid is null then raise exception 'not_authenticated' using errcode='42501'; end if;
 if not exists(select 1 from public.profiles p where p.id=v_uid
    and p.is_banned=false and p.email_verified=true) then
   raise exception 'verified_account_required' using errcode='42501';
 end if;
 select code into v_code from public.referral_codes where user_id=v_uid;
 if v_code is not null then return jsonb_build_object('ok',true,'code',v_code); end if;
 for v_attempt in 1..5 loop
  v_code:='BB'||upper(substring(md5(gen_random_uuid()::text),1,10));
  begin
   insert into public.referral_codes(user_id,code) values (v_uid,v_code)
    on conflict (user_id) do nothing;
   select code into v_code from public.referral_codes where user_id=v_uid;
   if v_code is not null then return jsonb_build_object('ok',true,'code',v_code); end if;
  exception when unique_violation then
   null; -- rare random code collision: generate another
  end;
 end loop;
 raise exception 'referral_code_unavailable' using errcode='P0001';
end
$$;
revoke all on function public.my_referral_code() from public,anon;
grant execute on function public.my_referral_code() to authenticated;

create or replace function public.redeem_referral_code(p_code text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_inviter uuid; v_normalized text:=upper(btrim(coalesce(p_code,'')));
begin
 if v_uid is null then raise exception 'not_authenticated' using errcode='42501'; end if;
 if v_normalized !~ '^BB[A-F0-9]{10}$' then raise exception 'invalid_code' using errcode='22023'; end if;
 if not exists(select 1 from public.profiles p where p.id=v_uid
   and p.is_banned=false and p.email_verified=true
   and p.created_at>clock_timestamp()-interval '30 days') then
   raise exception 'new_verified_account_required' using errcode='42501';
 end if;
 if exists(select 1 from public.referral_signups r where r.referred_user_id=v_uid) then
   raise exception 'already_redeemed' using errcode='23505';
 end if;
 if exists(select 1 from public.transactions t where t.buyer_id=v_uid
   and t.status in ('PAID','SETTLED')) then
   raise exception 'prior_purchase_not_eligible' using errcode='42501';
 end if;
 select c.user_id into v_inviter from public.referral_codes c
 join public.profiles p on p.id=c.user_id
 where c.code=v_normalized and p.is_banned=false;
 if v_inviter is null then raise exception 'code_unavailable' using errcode='P0002'; end if;
 if v_inviter=v_uid then raise exception 'self_referral' using errcode='42501'; end if;
 insert into public.referral_signups(referred_user_id,referrer_user_id,code)
 values(v_uid,v_inviter,v_normalized);
 return jsonb_build_object('ok',true,'status','ATTRIBUTED');
end
$$;
revoke all on function public.redeem_referral_code(text) from public,anon;
grant execute on function public.redeem_referral_code(text) to authenticated;

create or replace function public.my_referral_summary()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_count int; v_claimed boolean;
begin
 if v_uid is null then raise exception 'not_authenticated' using errcode='42501'; end if;
 select count(*)::integer into v_count from public.referral_signups where referrer_user_id=v_uid;
 select exists(select 1 from public.referral_signups where referred_user_id=v_uid) into v_claimed;
 return jsonb_build_object('signups',v_count,'hasRedeemed',v_claimed);
end
$$;
revoke all on function public.my_referral_summary() from public,anon;
grant execute on function public.my_referral_summary() to authenticated;

create or replace function public.staff_referral_summary()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_codes int; v_redemptions int;
begin
 if v_uid is null or not (
 public.has_permission(v_uid,'marketing.view') or
 public.has_permission(v_uid,'settings.manage_marketplace')) then
    raise exception 'not_authorised' using errcode='42501';
 end if;
 select count(*)::integer into v_codes from public.referral_codes;
 select count(*)::integer into v_redemptions from public.referral_signups;
 return jsonb_build_object('issuedCodes',v_codes,'redeemedInvitations',v_redemptions);
end
$$;
revoke all on function public.staff_referral_summary() from public,anon;
grant execute on function public.staff_referral_summary() to authenticated;
