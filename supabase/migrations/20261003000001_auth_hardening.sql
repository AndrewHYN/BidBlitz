-- Auth-adjacent least-privilege tightening. No business logic changes: both
-- statements narrow EXECUTION CONTEXT only.
--
-- 1. cancel_auction(uuid, text, text) is SECURITY DEFINER but refuses every
--    unauthenticated caller up front (`not_authenticated` when auth.uid() is
--    null), so anon EXECUTE can never do anything but burn a round trip.
--    Revoking it removes the advisor finding without touching any legitimate
--    path: sellers and admins always call authenticated. (The legacy 1-arg
--    overload was already dropped; this is the only remaining signature.)
--
-- 2. transaction_messages_protect_history() is a BEFORE UPDATE trigger whose
--    body touches only NEW/OLD plus a raise, so pinning an empty search_path
--    changes nothing it can resolve. Same hardening every other trigger
--    function in this project carries.

revoke execute on function public.cancel_auction(uuid, text, text) from anon;

alter function public.transaction_messages_protect_history() set search_path to '';
