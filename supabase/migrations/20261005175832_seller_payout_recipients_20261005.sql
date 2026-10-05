-- ===========================================================================
-- Seller payout recipients - the server-side ONLY place a seller's Linkwa
-- payout destination lives.
--
-- The provider identifiers (external_user_id / external_wallet_id) are
-- deliberately NOT on profiles, NOT in any browser-readable table, and never
-- accepted from the browser. They are registered out of band (a human operator
-- running linkLinkwaUser/registerLinkwaWallet with real credentials, then
-- recording the ids here through the service role). The admin payout console
-- reads this row server-side when it instructs a Linkwa payout.
--
-- Writing: no client write path at all - INSERT/UPDATE/DELETE are revoked from
-- anon and authenticated, and there is no RLS write policy. Only the service
-- role (SUPABASE_SECRET_KEY) or a migration may change a row.
-- Reading: admins only via RLS, and even then the admin UI only shows
-- "recipient on file: yes/no" - the ids themselves are never rendered.
-- ===========================================================================

create table if not exists public.seller_payout_recipients (
  seller_id           uuid primary key references public.profiles(id) on delete cascade,
  provider            text not null default 'linkwa' check (provider in ('linkwa')),
  external_user_id    text not null check (char_length(btrim(external_user_id)) > 0),
  external_wallet_id  text not null check (char_length(btrim(external_wallet_id)) > 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.seller_payout_recipients is
  'One row per seller: the Linkwa identity a payout is instructed against.
   Server-side only - no phone numbers or wallet ids are ever exposed to the
   browser, sellers, or buyers. Writing is service-role only.';

revoke all on table public.seller_payout_recipients from anon;
revoke insert, update, delete on table public.seller_payout_recipients from authenticated;
grant  select on table public.seller_payout_recipients to authenticated;

alter table public.seller_payout_recipients enable row level security;
drop policy if exists seller_payout_recipients_admin_select on public.seller_payout_recipients;
create policy seller_payout_recipients_admin_select on public.seller_payout_recipients
  for select to authenticated
  using (private.is_admin());
