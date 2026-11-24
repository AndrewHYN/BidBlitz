-- Run against an isolated test database after migrations. This does not create fake users in production.
do $$
begin
  if has_table_privilege('anon', 'public.listing_contacts', 'select') then
    raise exception 'anonymous callers can still SELECT private seller phone numbers';
  end if;
  if has_function_privilege('anon', 'public.reveal_listing_contact(uuid)', 'execute') then
    raise exception 'anonymous callers can execute contact reveal';
  end if;
  if not has_function_privilege('authenticated', 'public.reveal_listing_contact(uuid)', 'execute') then
    raise exception 'authenticated callers need the rate-limited contact reveal function';
  end if;
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.update_listing_contact(uuid,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.update_listing_contact(uuid,text,text)', 'execute')
     or has_table_privilege('authenticated', 'public.listing_contacts', 'update') then
    raise exception 'incorrect listing contact edit privileges';
  end if;
end $$;
