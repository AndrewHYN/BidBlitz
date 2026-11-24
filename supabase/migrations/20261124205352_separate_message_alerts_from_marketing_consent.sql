-- Private message alerts must not change promotional email consent.
alter table public.notification_preferences alter column marketplace_activity set default false;
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='notification_preferences' and column_name='listing_message_alerts'
  ) then
    alter table public.notification_preferences add column listing_message_alerts boolean not null default true;
    update public.notification_preferences set listing_message_alerts=false where marketplace_activity=false;
  end if;
end $$;
insert into public.notification_preferences (user_id, listing_message_alerts)
select id, true from public.profiles
on conflict (user_id) do nothing;
