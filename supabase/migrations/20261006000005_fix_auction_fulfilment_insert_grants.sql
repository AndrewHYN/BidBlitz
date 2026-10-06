-- Hotfix: the launch-audit migration added fulfilment columns to a table
-- that intentionally uses column-level INSERT grants. New columns do not
-- inherit those existing column grants, so authenticated draft creation
-- started returning 403 permission denied.
grant insert (fulfilment_method, fulfilment_notes)
on table public.auctions
to authenticated;
