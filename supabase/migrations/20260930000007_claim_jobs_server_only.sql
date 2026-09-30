-- ===========================================================================
-- claim_email_jobs is server-only: revoke the authenticated grant
-- ===========================================================================
--
-- DEFECT. public.claim_email_jobs() is SECURITY DEFINER with no internal
-- authorization - by design, because only the dispatcher (service role) may
-- ever call it, and the claim is exclusive per row. But the live function
-- carried GRANT EXECUTE TO authenticated, so any signed-in user could call
-- it over PostgREST: flipping QUEUED rows to SENDING, burning their attempt
-- counters, and (worst case) racing the dispatcher into double-sends.
-- Reading the queue was never possible (admin-only SELECT policy), but
-- moving rows through the state machine must not be either.
--
-- FIX. Revoke from authenticated (and re-assert public/anon, idempotently).
-- service_role keeps EXECUTE: the dispatcher authenticates as service_role
-- via the admin client, which is unaffected by this revoke. No application
-- code calls this function as an authenticated user - sender.ts uses the
-- admin client everywhere - so nothing legitimate loses access.
-- Regression: db:verify OB-CALL proves anon and authenticated calls fail.

revoke all on function public.claim_email_jobs(integer) from authenticated;
revoke all on function public.claim_email_jobs(integer) from public, anon;
