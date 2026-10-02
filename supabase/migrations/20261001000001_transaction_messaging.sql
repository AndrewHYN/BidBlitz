-- ===========================================================================
-- Post-win transaction messaging (milestone C).
--
-- What happens after SOLD today: a transaction row, WON/SOLD notices, and no
-- way for the winner and the seller to reach each other. The privacy page
-- promises emails are never shown to other users, so there is deliberately no
-- public contact path — this table is the private one, scoped to exactly the
-- two parties of one transaction.
--
-- Design decisions, all deliberate:
--   - One thread per transaction, not a general inbox. transaction_id is the
--     conversation key; there is nothing to create, join, or invite into.
--   - Text only, 2000 chars. No attachments (storage abuse vector), no
--     reactions, no threads-in-threads.
--   - Messages are immutable: sender, body and timestamp freeze at insert.
--     Only read_at moves, and only the RECIPIENT moves it. Editing history
--     would destroy the abuse-evidence trail moderators rely on.
--   - Cancelled/unsold auctions never have transactions, so they never have
--     threads — no orphan conversations by construction. FAILED transactions
--     keep their thread: the parties may still need receipts and the team may
--     still need evidence.
--   - Banned senders are refused in the server action (defence in depth); RLS
--     stays parties-only either way. A banned recipient can still RECEIVE:
--     cutting the other party off mid-sale punishes the wrong person.
-- ===========================================================================

create table public.transaction_messages (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  sender_id      uuid not null references public.profiles(id) on delete restrict,
  body           text not null check (char_length(body) between 1 and 2000),
  read_at        timestamptz null,
  created_at     timestamptz not null default now()
);

create index transaction_messages_thread_idx
  on public.transaction_messages (transaction_id, created_at asc);
create index transaction_messages_sender_idx
  on public.transaction_messages (sender_id, created_at desc);

-- ---- immutability: only read_at may change, and only the recipient ---------
create or replace function public.transaction_messages_protect_history()
returns trigger
language plpgsql
as $$
begin
  if new.transaction_id is distinct from old.transaction_id
     or new.sender_id is distinct from old.sender_id
     or new.body is distinct from old.body
     or new.created_at is distinct from old.created_at then
    raise exception 'transaction_message_immutable' using errcode = '25001';
  end if;
  return new;
end;
$$;

drop trigger if exists transaction_messages_protect_history on public.transaction_messages;
create trigger transaction_messages_protect_history
  before update on public.transaction_messages
  for each row execute function public.transaction_messages_protect_history();

-- ---- RLS: exactly the two parties, plus team moderation -----------------------
alter table public.transaction_messages enable row level security;

-- Reading needs the same party check as writing: a forged transaction id
-- returns zero rows rather than an error the caller could distinguish.
-- Administrators can read (reported messages are evidence, and the queue is
-- useless without it) but never write: no insert/update path admits them.
create policy transaction_messages_select_parties
  on public.transaction_messages for select to authenticated
  using (
    private.is_admin()
    or exists (
      select 1 from public.transactions t
      where t.id = transaction_messages.transaction_id
        and (t.buyer_id = (select auth.uid()) or t.seller_id = (select auth.uid()))
    )
  );

create policy transaction_messages_insert_parties
  on public.transaction_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_messages.transaction_id
        and (t.buyer_id = (select auth.uid()) or t.seller_id = (select auth.uid()))
    )
  );

-- Marking read is the recipient's action: the sender may never touch read_at
-- (self-marking read would be a meaningless write and a cheap spam vector).
create policy transaction_messages_update_recipient
  on public.transaction_messages for update to authenticated
  using (
    sender_id <> (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_messages.transaction_id
        and (t.buyer_id = (select auth.uid()) or t.seller_id = (select auth.uid()))
    )
  )
  with check (
    sender_id <> (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_messages.transaction_id
        and (t.buyer_id = (select auth.uid()) or t.seller_id = (select auth.uid()))
    )
  );

-- No delete policy: history is evidence. Transactions are never deleted, and
-- transaction_messages follows them via on delete cascade only.

-- ---- realtime: the thread view subscribes to new rows -----------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'transaction_messages'
  ) then
    alter publication supabase_realtime add table public.transaction_messages;
  end if;
end $$;

-- ---- notification type for new-message alerts --------------------------------
alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'AUCTION_PUBLISHED','NEW_BID','OUTBID','ENDING_SOON',
    'WON','SOLD','ENDED_UNSOLD','REVIEW_REQUEST','LISTING_REMOVED',
    'BID_CONFIRMED',
    'REVIEW_SUBMITTED','REVIEW_APPROVED','REVIEW_REJECTED','REVIEW_CHANGES_REQUESTED',
    'CANCELLATION_REQUESTED','CANCELLATION_DECIDED',
    'AUCTION_PAUSED','AUCTION_RESUMED','AUCTION_CANCELLED',
    'NEW_MESSAGE'
  ));
