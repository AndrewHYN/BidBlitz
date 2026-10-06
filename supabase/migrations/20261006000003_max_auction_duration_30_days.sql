-- BidBlitz — allow auction durations up to 30 days.
--
-- Existing rows are untouched. This only widens the authoritative database
-- CHECK so new listings can choose the longer durations offered by the app.

alter table public.auctions
  drop constraint if exists auctions_duration_seconds_check;

alter table public.auctions
  add constraint auctions_duration_seconds_check
  check (duration_seconds between 60 and 2592000);
