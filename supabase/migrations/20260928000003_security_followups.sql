-- ===========================================================================
-- Close the documented security follow-ups from the 2026-09-27 sweep
--
-- Four items, all re-evaluated against the live database on 2026-09-28 rather
-- than taken on trust. Three are fixed here; one is deliberately NOT, and the
-- reasoning is recorded in POST_LAUNCH_BACKLOG.md.
--
-- 1. `profiles_insert_self` could mint an administrator.
--    The UPDATE policy already refuses to let anyone change `is_admin`,
--    `is_banned` or any counter - but the INSERT policy checked only
--    `id = auth.uid()`. Profiles are created by the `handle_new_user` trigger,
--    so the app never inserts one; the reachable path is narrow but real: any
--    signed-in user whose profile row is missing (a partially-applied trigger,
--    a restored backup, a hand-repair) could insert their own row with
--    `is_admin = true` and become an administrator. One line, no downside:
--    a self-inserted row must start from a known-safe state.
--
-- 2. `auction_images.storage_path` accepted any string.
--    The upload action already requires the path to start with the auction's
--    own id and `imageUrlFor()` refuses anything that is not a bare storage
--    key, but a direct PostgREST write could still store something odd. The
--    database now enforces the shape the application already assumes.
--
-- 3. `is_banned` was read by nothing.
--    The column existed, two RLS policies mentioned it purely to stop a user
--    changing their OWN flag - and no code path anywhere consulted it. The
--    operations manual tells an operator to suspend an abusive account and the
--    terms tell a user their account can be suspended, so an escalation that
--    followed the manual silently achieved nothing: the account kept bidding and
--    kept listing. Enforced here as two triggers rather than by editing
--    `place_bid` / `publish_auction`:
--      * a trigger cannot be bypassed by any current or future write path;
--      * the bidding and publishing hot paths keep the exact logic they were
--        verified with - no re-typed function body to regress;
--      * engine transitions are unaffected, so `settle_auctions` still closes a
--        banned seller's auction and `cancel_auction` still works. Banning
--        stops commercial activity; it must not strand a live auction.
--
-- 4. NOT fixed here: `place_bid`'s idempotency lookup is keyed
--    (bidder_id, request_id) without the auction id. See the backlog entry -
--    changing it means re-issuing the whole authoritative function for a bug
--    that needs a client to reuse a request id across two auctions, which the
--    app never does.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. A self-inserted profile can never arrive privileged.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (
    id = (select auth.uid())
    -- mirrors the privilege guards already on profiles_update_self: privilege
    -- columns are set by the server, never by the row's creator.
    and is_admin = false
    and is_banned = false
    and sales_count = 0
    and purchases_count = 0
    and rating_sum = 0
    and rating_count = 0
  );

-- ---------------------------------------------------------------------------
-- 2. The storage path shape the application already assumes.
--    Two properties, both of which the upload action and imageUrlFor() already
--    rely on, so neither is new behaviour:
--      a) the key contains the OWNING auction's id as a path segment, so an
--         image row cannot point at another auction's object;
--      b) the key ends in a real file extension, so it is a file key and not an
--         arbitrary string.
--    Depth is deliberately not constrained: the browser uploader produces
--    "<auction id>/0.png" while the verification harness writes
--    "harness/<auction id>/cover.jpg", and a future CDN prefix is equally
--    legitimate. A CHECK can reference other columns of its own row, so the
--    auction id is matched directly rather than hard-coded as a shape.
-- ---------------------------------------------------------------------------
alter table public.auction_images
  drop constraint if exists auction_images_storage_path_chk;
alter table public.auction_images
  add constraint auction_images_storage_path_chk
  check (
    storage_path ~ ('(^|/)' || auction_id::text || '/')
    and storage_path ~ '\.[A-Za-z0-9]{1,8}$'
  );

-- ---------------------------------------------------------------------------
-- 3. A banned account cannot bid, and cannot list or publish.
--
--    NO `current_user` bypass here, deliberately, and the first attempt at this
--    got it wrong in an instructive way. `place_bid` and `publish_auction` are
--    SECURITY DEFINER, so `current_user` inside them is `postgres` for BOTH a
--    real user's bid and a genuine engine pass - the role tells you who owns
--    the function, not who is acting. A bypass written the way
--    private.auctions_protect_state() uses one therefore disabled the whole
--    check: the harness proved a banned account could still bid and publish.
--
--    The trigger does not need to tell actors apart, because the conditions
--    below are already specific:
--      * nothing but place_bid ever inserts a bid, and place_bid only ever
--        represents the caller, so every bid row is by definition an actor;
--      * settlement, anti-sniping and image_count maintenance only ever touch an
--        auction that is already out of DRAFT, and the check fires only on an
--        INSERT or on a move out of DRAFT. A banned seller's live auction still
--        closes, still settles and still gets its count kept up to date -
--        banning stops commerce, it must not strand an auction.
-- ---------------------------------------------------------------------------
create or replace function private.reject_banned_bidder()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if exists (
    select 1 from public.profiles p
     where p.id = new.bidder_id and p.is_banned
  ) then
    raise exception 'account_banned' using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function private.reject_banned_bidder() is
  'BEFORE INSERT on bids: refuses a bid from a banned account. No current_user
   bypass - place_bid is SECURITY DEFINER, so the role is the function owner for
   every caller including a banned one.';

drop trigger if exists bids_reject_banned on public.bids;
create trigger bids_reject_banned
  before insert on public.bids
  for each row execute function private.reject_banned_bidder();

create or replace function private.reject_banned_publisher()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.status <> 'DRAFT' and (tg_op = 'INSERT' or old.status = 'DRAFT') then
    if exists (
      select 1 from public.profiles p
       where p.id = new.seller_id and p.is_banned
    ) then
      raise exception 'account_banned' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

comment on function private.reject_banned_publisher() is
  'BEFORE INSERT OR UPDATE on auctions: refuses a banned seller creating a
   listing or publishing a draft. Engine transitions (settle, anti-snipe,
   image_count) never move an auction out of DRAFT, so they are unaffected.';

drop trigger if exists auctions_reject_banned on public.auctions;
create trigger auctions_reject_banned
  before insert or update on public.auctions
  for each row execute function private.reject_banned_publisher();

-- ---------------------------------------------------------------------------
-- 4. EXECUTE: the two new trigger functions can only ever be fired by a
--    trigger, never called directly, so PUBLIC is revoked and the roles that
--    can actually fire them are granted.
-- ---------------------------------------------------------------------------
revoke execute on function private.reject_banned_bidder() from public, anon;
revoke execute on function private.reject_banned_publisher() from public, anon;

grant execute on function private.reject_banned_bidder()
  to postgres, supabase_admin, service_role, authenticated;
grant execute on function private.reject_banned_publisher()
  to postgres, supabase_admin, service_role, authenticated;
