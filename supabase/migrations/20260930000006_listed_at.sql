-- ===========================================================================
-- listed_at: when a listing became publicly available
-- ===========================================================================
--
-- WHY. The homepage "Recently Listed" rail must mean "publicly available and
-- published within 72 hours". No existing column says that:
--   created_at  is the DRAFT's birth (a review-held listing would look old
--               before any buyer could see it);
--   starts_at   is the future opening time for SCHEDULED listings (a listing
--               published an hour ago but starting in six days would look
--               six days old);
--   updated_at  moves on every bid.
-- So the smallest correct field is a new one, stamped exactly once, at the
-- moment of first public availability:
--   publish_auction direct path (LIVE/SCHEDULED) stamps it;
--   the review-held path leaves it NULL (not public yet);
--   admin_decide_review APPROVED stamps it;
--   coalesce() everywhere: an already-public row never gets restamped
--   (rescheduling a SCHEDULED listing must not refresh its freshness).
-- Withdrawing to DRAFT and republishing re-stamps only when the row was
-- never public (listed_at still NULL). "List again" creates a new row.
--
-- BACKFILL. Pre-column rows get least(starts_at, now()): exact for
-- immediately-published LIVE rows (starts_at was set at publish), and for
-- future SCHEDULED rows it clamps to now rather than pretending the listing
-- is days old or days young. Documented approximation, new rows are exact.

alter table public.auctions
  add column if not exists listed_at timestamptz;

comment on column public.auctions.listed_at is
  'When this listing first became publicly available. Stamped by
   publish_auction (direct path) and by review approval; never overwritten
   (coalesce), never set for DRAFT/PENDING_REVIEW rows. Drives the homepage
   Recently Listed freshness window only - it is merchandising, not lifecycle:
   leaving the window changes nothing about the auction.';

update public.auctions
   set listed_at = least(starts_at, now())
 where listed_at is null
   and status not in ('DRAFT','PENDING_REVIEW')
   and starts_at is not null;

-- Stamping lives in ONE before-trigger, not in two function bodies: any path
-- that moves a never-public row into a public state stamps it, and no path
-- can restamp (the NULL guard) or stamp a row that never went public.
create or replace function private.stamp_listed_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.listed_at is null
     and new.status in ('SCHEDULED','LIVE')
     and (old.status is null or old.status in ('DRAFT','PENDING_REVIEW')) then
    new.listed_at := now();
  end if;
  return new;
end;
$$;

comment on function private.stamp_listed_at() is
  'BEFORE INSERT OR UPDATE on auctions: stamps listed_at at first public
   availability (into SCHEDULED/LIVE from DRAFT/PENDING_REVIEW), once -
   the NULL guard means reschedules and approvals never restamp.';

drop trigger if exists auctions_stamp_listed_at on public.auctions;
create trigger auctions_stamp_listed_at
  before insert or update on public.auctions
  for each row execute function private.stamp_listed_at();

revoke execute on function private.stamp_listed_at() from public, anon;
