-- ===========================================================================
-- Engine fixes proven by db:verify (three concrete defects, one migration)
-- ===========================================================================
--
-- 1. PAUSE/RESUME AUDIT REJECTED. admin_pause_auction updates the auction and
--    then inserts a PAUSE_AUCTION moderation_events row - but the action CHECK
--    only allowed TAKEDOWN_LISTING/BAN_USER/UNBAN_USER, so the insert raised
--    and the whole transaction rolled back: the auction stayed LIVE, bids kept
--    landing, and the resume math had no hold to measure. The pause looked
--    like it worked (no error surfaced past the RPC boundary in the UI path)
--    while changing nothing. Extending the CHECK is the fix; the pause/resume
--    functions themselves were correct.
--
-- 2. cancel_auction OVERLOAD AMBIGUITY. The lifecycle migration added
--    cancel_auction(uuid, text, text) alongside the legacy cancel_auction(uuid).
--    PostgREST cannot pick between them for a single-argument call (PGRST203),
--    so the seller's zero-bid cancel path broke at the boundary. The 3-arg
--    form has defaults covering every 1-arg call, so the legacy form is
--    dropped, not kept as a second way to do it.
--
-- 3. CANCELLED AUCTIONS KEPT A "WINNING" BID. Takedown and cancellation set
--    status=CANCELLED but left bids.is_winning=true standing: the data claimed
--    a winner where the product promises none (no winner, no transaction).
--    One AFTER trigger clears the flags on every transition into CANCELLED,
--    covering takedown, seller/admin cancel and approved cancellation requests
--    alike - including paths added later - instead of patching three function
--    bodies to remember the same line.

-- ---- 1. audit actions ------------------------------------------------------------
alter table public.moderation_events
  drop constraint if exists moderation_events_action_check;
alter table public.moderation_events
  add constraint moderation_events_action_check
  check (action in (
    'TAKEDOWN_LISTING','BAN_USER','UNBAN_USER',
    'PAUSE_AUCTION','RESUME_AUCTION'
  ));

-- ---- 2. single cancel_auction -------------------------------------------------------
drop function if exists public.cancel_auction(uuid);

-- ---- 3. no winners on cancelled auctions ----------------------------------------------
create or replace function private.clear_winning_on_cancel()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.status = 'CANCELLED' and old.status <> 'CANCELLED' then
    update public.bids set is_winning = false
     where auction_id = new.id and is_winning;
  end if;
  return new;
end;
$$;

comment on function private.clear_winning_on_cancel() is
  'AFTER UPDATE on auctions: a transition into CANCELLED means no winner, so
   no bid may keep claiming is_winning. History stays (rows are untouched),
   only the flag clears. Covers takedown, cancel and approved cancellation
   requests without each function remembering to do it.';

drop trigger if exists auctions_clear_winning_on_cancel on public.auctions;
create trigger auctions_clear_winning_on_cancel
  after update on public.auctions
  for each row execute function private.clear_winning_on_cancel();

revoke execute on function private.clear_winning_on_cancel() from public, anon;
