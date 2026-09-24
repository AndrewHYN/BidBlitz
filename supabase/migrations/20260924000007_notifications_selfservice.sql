-- BidBlitz — 000007 restore the legitimate notification self-service write
--
-- Why this migration exists (honest changelog):
-- 20260924000004 revoked INSERT/UPDATE/DELETE on public.notifications for
-- anon+authenticated to stop clients forging notifications. That was correct
-- for INSERT but over-revoked UPDATE: the `notifications_mark_read` RLS policy
-- existed with no table privilege behind it, so "mark as read" returned
--   403 permission denied for table notifications
-- The in-app notifications UI would have been broken in production.
--
-- Fix: grant only the read_at column. payload/user_id/type stay unwritable, and
-- INSERT stays revoked so a client still cannot fabricate an event.

grant update (read_at) on public.notifications to authenticated;

-- dismiss/acknowledge your own notification outright
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete to authenticated using (user_id = auth.uid());

grant delete on public.notifications to authenticated;

-- NOT granted to authenticated: insert (events are server-generated only),
-- and update of payload/user_id/type/auction_id (column-level, immutable).
