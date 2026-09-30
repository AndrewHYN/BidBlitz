-- ===========================================================================
-- Email outbox + notification preferences
-- ===========================================================================
--
-- WHY THIS EXISTS
--
-- Email is a delivery channel on top of database state, never the source of
-- truth for it. Every past incident class this project has recorded came from
-- coupling a side effect to a commit; email is the next one in line. So:
--
-- - The marketplace writes its state first (bids, settlements, decisions).
-- - The same server action then enqueues an email row in the SAME database.
-- - A dispatcher sends queued rows independently. If sending fails, the row
--   stays queued with its error; the bid/settlement/decision is unaffected.
-- - Idempotency keys make retries and double-submits collapse into one row.
-- - Preferences gate OPTIONAL mail. Critical mail (security, money, outcomes)
--   is never gated: losing a "you won" email to an unchecked box is not a
--   preference, it is a failure.
--
-- WHAT LIVES WHERE
--
-- - email_outbox: the durable queue. Writes go through the service-role
--   client from server actions only (no PostgREST insert policy exists, so a
--   browser cannot enqueue anything directly). Reads are admin-only, for the
--   delivery-failures view.
-- - notification_preferences: one row per user, created lazily. Optional
--   categories only; critical events bypass preferences in the dispatcher.
-- - Sending itself is TypeScript (lib/email/sender.ts) via the Resend API.
--   No credentials in this migration, no delivery assumed: without
--   RESEND_API_KEY the dispatcher leaves rows QUEUED and says so.

create table if not exists public.email_outbox (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  idempotency_key    text not null unique,
  recipient          text not null,
  template_key       text not null,
  payload            jsonb not null default '{}'::jsonb,
  status             text not null default 'QUEUED' check (status in (
                       'QUEUED','SENDING','SENT','FAILED','SKIPPED'
                     )),
  attempts           integer not null default 0,
  last_error         text,
  provider_message_id text,
  sent_at            timestamptz
);
create index if not exists email_outbox_due_idx
  on public.email_outbox (status, created_at)
  where status = 'QUEUED';
create index if not exists email_outbox_recipient_idx
  on public.email_outbox (recipient, created_at desc);

alter table public.email_outbox enable row level security;

-- No client writes, ever: enqueueing happens server-side through the
-- service role, after the marketplace state it describes is committed.
-- Admins read failures; everyone else sees nothing.
drop policy if exists email_outbox_admin_select on public.email_outbox;
create policy email_outbox_admin_select on public.email_outbox
  for select to authenticated using (private.is_admin());

create table if not exists public.notification_preferences (
  user_id                   uuid primary key references public.profiles(id) on delete cascade,
  updated_at                timestamptz not null default now(),
  -- OPTIONAL mail only. Critical mail (security, money, outcomes, moderation
  -- decisions) bypasses these flags in the dispatcher, always.
  outbid                    boolean not null default true,
  ending_soon               boolean not null default true,
  marketplace_activity      boolean not null default false
);

alter table public.notification_preferences enable row level security;

drop policy if exists notification_preferences_owner on public.notification_preferences;
create policy notification_preferences_owner on public.notification_preferences
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Claim a batch for sending: exactly one dispatcher owns each row, so two
-- overlapping runs never send the same email twice.
create or replace function public.claim_email_jobs(p_limit integer default 25)
returns setof public.email_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.email_outbox
     set status = 'SENDING', attempts = attempts + 1
   where id in (select id from public.email_outbox
                 where status = 'QUEUED'
                 order by created_at
                 limit greatest(p_limit, 1)
                 for update skip locked)
  returning *;
end;
$$;

revoke all on function public.claim_email_jobs(integer) from public, anon;
-- No grant to authenticated: only the service role (dispatcher) claims jobs.
-- There is deliberately no client path to sending.
