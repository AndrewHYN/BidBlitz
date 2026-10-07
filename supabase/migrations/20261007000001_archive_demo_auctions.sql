alter table public.auctions
  add column if not exists is_hidden boolean not null default false;
