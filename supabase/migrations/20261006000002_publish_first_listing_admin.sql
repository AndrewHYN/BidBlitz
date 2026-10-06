-- BidBlitz — 20261006000002 publish_auction: first_listing does not hold admin.access sellers
--
-- Why: the risk screen treated "the seller has never published before" as a
-- reason to hold a listing for human review. That is an onboarding signal
-- for untrusted sellers; for a caller who already holds the live
-- public.has_permission(v_uid, 'admin.access') staff permission it only
-- routed the operator's own first listing into the same queue, producing
-- self-review and operational friction.
--
-- What changes: the first_listing risk flag is now only set when the caller
-- does NOT hold admin.access. Everything else is preserved verbatim:
--   * reported_seller / prior_takedown / prior_ban / high_value still hold
--     the listing for a staff OR ordinary seller alike;
--   * the PENDING_REVIEW transition, listing_reviews row, risk_flags audit
--     payload and REVIEW_SUBMITTED notification are unchanged;
--   * the trusted publish path (LIVE/SCHEDULED, timing, AUCTION_PUBLISHED
--     notification) is unchanged;
--   * private.is_admin() / profiles.is_admin is NOT used as authority —
--     has_permission reads ACTIVE role assignments live, so revoking a role
--     takes effect on the next publish call;
--   * no staff seller can bypass review for any genuine risk signal; this
--     is not a moderation bypass.
--
-- No data backfill, no updates/deletes of auctions, no payment, payout,
-- settlement, cancellation or messaging semantics touched. Historical
-- PENDING_REVIEW rows keep their recorded risk_flags; new publishes only.
--create or replace function public.publish_auction(
  p_auction_id uuid,
  p_starts_at  timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  a       public.auctions%rowtype;
  v_uid   uuid := auth.uid();
  v_start timestamptz;
  v_imgs  integer;
  v_flags jsonb := '{}'::jsonb;
  v_risky boolean := false;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  select * into a from public.auctions where id = p_auction_id for update;
  if not found then raise exception 'auction_not_found' using errcode = 'P0002'; end if;
  if a.seller_id <> v_uid then raise exception 'not_owner' using errcode = '42501'; end if;
  if a.status not in ('DRAFT','SCHEDULED') then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  select count(*) into v_imgs
    from public.auction_images where auction_id = a.id;
  if v_imgs < 1 then
    raise exception 'image_required' using errcode = 'P0001';
  end if;

  -- ---- risk screen (each signal recorded, none of them silent) --------------
  -- first_listing is an onboarding signal: it exists to hold a stranger's
  -- first public sale for human review. A caller who already holds the live
  -- admin.access permission (read fresh from staff_assignments on every
  -- call, so revocation takes effect immediately) is known staff, so holding
  -- their first listing in the same queue only produces self-review. Every
  -- other risk signal below still applies to staff unchanged, and an
  -- ordinary first-time seller is held exactly as before.
  if not public.has_permission(v_uid, 'admin.access')
     and not exists (select 1 from public.auctions x
                  where x.seller_id = v_uid and x.status <> 'DRAFT' and x.id <> a.id) then
    v_flags := v_flags || '{"first_listing": true}';
    v_risky := true;
  end if;
  if exists (select 1 from public.reports r
              where r.status in ('OPEN','REVIEWING')
                and ((r.target_type = 'user' and r.target_id = v_uid)
                     or (r.target_type = 'auction' and r.target_id in
                         (select x.id from public.auctions x where x.seller_id = v_uid)))) then
    v_flags := v_flags || '{"reported_seller": true}';
    v_risky := true;
  end if;
  if exists (select 1 from public.moderation_events m
              where m.action = 'TAKEDOWN_LISTING'
                and m.target_type = 'auction' and m.target_id in
                (select x.id from public.auctions x where x.seller_id = v_uid)) then
    v_flags := v_flags || '{"prior_takedown": true}';
    v_risky := true;
  end if;
  if exists (select 1 from public.moderation_events m
              where m.action = 'BAN_USER'
                and m.target_type = 'user' and m.target_id = v_uid) then
    v_flags := v_flags || '{"prior_ban": true}';
    v_risky := true;
  end if;
  if coalesce(a.starting_bid_minor, 0) >= 50000 then
    v_flags := v_flags || '{"high_value": true}';
    v_risky := true;
  end if;

  if v_risky then
    update public.auctions
       set status = 'PENDING_REVIEW', updated_at = clock_timestamp()
     where id = a.id;

    insert into public.listing_reviews (auction_id, status, risk_flags)
    values (a.id, 'PENDING', v_flags)
    on conflict do nothing;

    insert into public.notifications (user_id, type, auction_id, payload)
    values (v_uid, 'REVIEW_SUBMITTED', a.id,
            jsonb_build_object('title', a.title));

    return jsonb_build_object('ok', true, 'status', 'PENDING_REVIEW',
                              'risk_flags', v_flags);
  end if;

  -- ---- trusted path: unchanged --------------------------------------------------
  v_start := coalesce(p_starts_at, clock_timestamp());

  update public.auctions
     set status     = case when v_start <= clock_timestamp()
                           then 'LIVE'::public.auction_status_t
                           else 'SCHEDULED'::public.auction_status_t end,
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
