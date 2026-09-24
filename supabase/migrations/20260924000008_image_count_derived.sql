-- BidBlitz — 000008 make image_count derived, not client-writable
--
-- Why this migration exists (honest changelog):
--
-- 20260924000004 grants authenticated UPDATE on `image_count`, but
-- auctions_protect_state() raises `auction_state_immutable` the moment that
-- column actually changes. So attachImagesAction's update ALWAYS failed — the
-- error was awaited and ignored — `image_count` stayed 0 forever, and
-- publish_auction() then rejected every listing with `image_required`.
-- A seller could upload photos and could never publish. (Reported against the
-- sell flow; confirmed by reading both the grant and the trigger.)
--
-- The deeper defect is not the mismatch. It is that `image_required` was
-- reading a column a client was permitted to write: the rule "you cannot list
-- without a photo" must not be satisfiable by editing a column, so no amount
-- of widening the trigger would have been correct.
--
-- Fix:
--   1. image_count becomes DERIVED. An AFTER trigger on auction_images
--      recomputes it from the child rows. The function is SECURITY DEFINER for
--      the same reason place_bid() is: it acts with the engine's authority, so
--      auctions_protect_state() sees role `postgres` and allows the write
--      (bid_count is maintained the identical way).
--   2. publish_auction() now counts the child rows directly instead of trusting
--      the denormalised column — defence in depth.
--   3. clients lose INSERT and UPDATE on image_count entirely.
--   4. existing rows are backfilled from the child table.
--
-- Side effect worth stating: the check constraint (image_count between 0 and 8)
-- now fires from real data, so the 8-photo cap is enforced by the database even
-- for callers that bypass the app.

-- ---------------------------------------------------------------------------
-- 1. derived count
-- ---------------------------------------------------------------------------
create or replace function public.sync_image_count()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_auction uuid;
  v_count   integer;
begin
  -- Read only the side that exists for this event: `old` is unassigned on
  -- INSERT and `new` is unassigned on DELETE, so coalesce() over both would
  -- raise instead of yielding null.
  if TG_OP = 'DELETE' then
    v_auction := old.auction_id;
  else
    v_auction := new.auction_id;
  end if;

  select count(*) into v_count
    from public.auction_images
   where auction_id = v_auction;

  update public.auctions
     set image_count = v_count
   where id = v_auction
     and image_count is distinct from v_count;   -- no-op writes, no dead tuples

  return null;
end;
$$;

-- Deliberately NOT revoked from authenticated: PostgreSQL checks EXECUTE on a
-- trigger function when the trigger is created (here, as the migration role),
-- not when it fires, and a `returns trigger` function cannot be called from
-- SQL at all — it errors with "trigger functions can only be called as
-- triggers". There is no callable surface to harden.

drop trigger if exists auction_images_sync_count on public.auction_images;
create trigger auction_images_sync_count
  after insert or delete or update of auction_id
  on public.auction_images
  for each row execute function public.sync_image_count();

-- ---------------------------------------------------------------------------
-- 2. publish_auction — judge the real rows, not the cached column
--    (`create or replace` keeps the existing owner and grants)
-- ---------------------------------------------------------------------------
create or replace function public.publish_auction(
  p_auction_id uuid,
  p_starts_at  timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  a       public.auctions%rowtype;
  v_uid   uuid := auth.uid();
  v_start timestamptz;
  v_imgs  integer;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  select * into a from public.auctions where id = p_auction_id for update;
  if not found then raise exception 'auction_not_found' using errcode = 'P0002'; end if;
  if a.seller_id <> v_uid then raise exception 'not_owner' using errcode = '42501'; end if;
  if a.status not in ('DRAFT','SCHEDULED') then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  -- Count the photographs themselves. image_count is now derived and clients
  -- cannot write it, but a business rule should still read its own source of
  -- truth rather than a cached projection of it.
  select count(*) into v_imgs
    from public.auction_images where auction_id = a.id;
  if v_imgs < 1 then
    raise exception 'image_required' using errcode = 'P0001';
  end if;

  v_start := coalesce(p_starts_at, clock_timestamp());

  update public.auctions
     set status     = case when v_start <= clock_timestamp()
                           then 'LIVE'::auction_status_t
                           else 'SCHEDULED'::auction_status_t end,
         starts_at  = v_start,
         ends_at    = v_start + make_interval(secs => duration_seconds),
         updated_at = clock_timestamp()
   where id = a.id
   returning * into a;

  insert into public.notifications (user_id, type, auction_id, payload)
  values (a.seller_id, 'AUCTION_PUBLISHED', a.id,
          jsonb_build_object('title', a.title, 'ends_at', a.ends_at));

  return jsonb_build_object('ok', true, 'status', a.status,
                            'starts_at', a.starts_at, 'ends_at', a.ends_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. clients may no longer write the count at all
--    (re-issuing the full column list, since a column-level grant cannot be
--     narrowed by revoking the column alone)
-- ---------------------------------------------------------------------------
revoke update on public.auctions from authenticated;
grant update (
  -- metadata only. NOT starts_at/ends_at (a seller could otherwise extend
  -- their own auction), NOT featured (that must follow a real payment),
  -- NOT image_count (derived by sync_image_count, and it gates publish).
  title, description, category_id, condition, location, updated_at
) on public.auctions to authenticated;

revoke insert on public.auctions from authenticated;
grant insert (
  -- image_count omitted on purpose: the column default (0) applies and only
  -- sync_image_count() may ever move it off zero.
  seller_id, title, description, category_id, condition, location, currency,
  starting_bid_minor, bid_increment_minor, duration_seconds,
  anti_snipe_window_seconds, anti_snipe_extension_seconds, status
) on public.auctions to authenticated;

-- ---------------------------------------------------------------------------
-- 4. backfill: repair any row the broken write path left stale
-- ---------------------------------------------------------------------------
update public.auctions a
   set image_count = (
     select count(*) from public.auction_images i where i.auction_id = a.id
   )
 where a.image_count is distinct from (
     select count(*) from public.auction_images i where i.auction_id = a.id
   );
