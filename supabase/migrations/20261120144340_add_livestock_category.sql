insert into public.categories (slug, name, emoji, sort_order)
values ('livestock', 'Livestock', '🐄', 110)
on conflict (slug) do nothing;
