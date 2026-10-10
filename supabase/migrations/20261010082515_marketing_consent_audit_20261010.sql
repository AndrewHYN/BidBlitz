-- Audit explicit optional-marketing email consent without modifying security mail.
-- These timestamps are never a license to send mail without current consent.
alter table public.notification_preferences
  add column if not exists marketing_opt_in_at timestamptz,
  add column if not exists marketing_opt_out_at timestamptz;

create or replace function private.notification_preferences_consent_audit()
returns trigger language plpgsql set search_path=''
as $$
begin
  if tg_op='INSERT' then
    if new.marketplace_activity then
      new.marketing_opt_in_at:=clock_timestamp();
      new.marketing_opt_out_at:=null;
    end if;
  elsif new.marketplace_activity is distinct from old.marketplace_activity then
    if new.marketplace_activity then
      new.marketing_opt_in_at:=clock_timestamp();
      new.marketing_opt_out_at:=null;
    else
      new.marketing_opt_out_at:=clock_timestamp();
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists notification_preferences_consent_audit on public.notification_preferences;
create trigger notification_preferences_consent_audit
before insert or update of marketplace_activity on public.notification_preferences
for each row execute function private.notification_preferences_consent_audit();

-- An aggregate-only staff view of CONSENTED accounts. No emails, identity
-- or address export is granted to marketing staff by this function.
create or replace function public.staff_marketing_opt_in_summary()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare
 v_uid uuid:=auth.uid();
 v_consent int;
 v_total int;
begin
 if v_uid is null or not (
  public.has_permission(v_uid,'marketing.view') or
  public.has_permission(v_uid,'settings.manage_marketplace')) then
   raise exception 'not_authorised' using errcode='42501';
 end if;
 select count(*)::integer into v_consent
 from public.notification_preferences n
 join public.profiles p on p.id=n.user_id
 where n.marketplace_activity=true and n.marketing_opt_in_at is not null
   and p.email_verified=true and p.is_banned=false;
 select count(*)::integer into v_total from public.notification_preferences;
 return jsonb_build_object('optedIn',v_consent,'preferenceRows',v_total);
end
$$;
revoke all on function public.staff_marketing_opt_in_summary() from public,anon;
grant execute on function public.staff_marketing_opt_in_summary() to authenticated;
