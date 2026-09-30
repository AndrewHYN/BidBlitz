-- ===========================================================================
-- Auction lifecycle states: PAUSED + PENDING_REVIEW (enum values only)
-- ===========================================================================
--
-- This file contains ONLY the ALTER TYPE statements, deliberately separated
-- from the migration that uses them. PostgreSQL forbids using a newly added
-- enum value in the same transaction that added it (55P04), and the
-- migration runner sends each file as one request — so the values must be
-- committed here before 20260930000002 references them. Appending to an enum
-- never rewrites the table and never moves existing values.
alter type public.auction_status_t add value if not exists 'PAUSED';
alter type public.auction_status_t add value if not exists 'PENDING_REVIEW';
