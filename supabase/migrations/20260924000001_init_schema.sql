-- BidBlitz — 000001 init schema
-- Money is ALWAYS integer minor units + explicit currency. Never float.
-- Timestamps are ALWAYS timestamptz (UTC).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enumerations (text + CHECK: cheaper to evolve than pg enum under load)
-- ---------------------------------------------------------------------------
-- auction status: DRAFT -> SCHEDULED -> LIVE -> ENDED -> SOLD | UNSOLD
--                 any non-terminal -> CANCELLED
-- "ENDING" is deliberately NOT stored: it is derived from time (see
-- auction_effective_status) so a bid can never observe a stale ENDING flag.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'auction_status_t') then
    create type auction_status_t as enum
      ('DRAFT','SCHEDULED','LIVE','ENDED','SOLD','UNSOLD','CANCELLED');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  username         text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name     text not null check (char_length(display_name) between 1 and 60),
  avatar_url       text,
  bio              text check (bio is null or char_length(bio) <= 500),
  location         text check (location is null or char_length(location) <= 80),
  -- denormalised rating aggregate (kept integer for cheap, exact averages)
  rating_sum       integer not null default 0 check (rating_sum >= 0),
  rating_count     integer not null default 0 check (rating_count >= 0),
  sales_count      integer not null default 0 check (sales_count >= 0),
  purchases_count  integer not null default 0 check (purchases_count >= 0),
  email_verified   boolean not null default false,
  is_admin         boolean not null default false,
  is_banned        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on column public.profiles.rating_count is
  'Denormalised review aggregate. rating = rating_sum / nullif(rating_count,0).';

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id          smallserial primary key,
  slug        text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name        text not null unique check (char_length(name) between 1 and 40),
  emoji       text,
  sort_order  smallint not null default 0
);

-- ---------------------------------------------------------------------------
-- auctions
-- ---------------------------------------------------------------------------
create table if not exists public.auctions (
  id                        uuid primary key default gen_random_uuid(),
  seller_id                 uuid not null references public.profiles(id) on delete restrict,

  title                     text not null check (char_length(title) between 3 and 120),
  description               text not null check (char_length(description) between 10 and 5000),
  category_id               smallint references public.categories(id) on delete set null,
  condition                 text not null
                              check (condition in ('new','like_new','good','fair','poor')),
  location                  text not null check (char_length(location) between 1 and 80),

  currency                  text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  starting_bid_minor        bigint not null check (starting_bid_minor > 0),
  bid_increment_minor       bigint not null check (bid_increment_minor > 0),

  status                    auction_status_t not null default 'DRAFT',

  -- authoritative clock: browser countdown is decoration only
  starts_at                 timestamptz,
  ends_at                   timestamptz,
  duration_seconds          integer not null default 3600
                              check (duration_seconds between 60 and 604800),

  -- server-side anti-sniping
  anti_snipe_window_seconds   integer not null default 30
                                check (anti_snipe_window_seconds between 0 and 600),
  anti_snipe_extension_seconds integer not null default 30
                                check (anti_snipe_extension_seconds between 0 and 600),
  extension_count             integer not null default 0 check (extension_count >= 0),

  -- live bid projection (updated only inside place_bid under row lock)
  current_bid_minor        bigint,
  current_bidder_id        uuid references public.profiles(id) on delete set null,
  bid_count                integer not null default 0 check (bid_count >= 0),

  winner_id                uuid references public.profiles(id) on delete set null,
  winning_bid_minor        bigint,
  settled_at               timestamptz,

  featured                 boolean not null default false,
  image_count              smallint not null default 0
                             check (image_count between 0 and 8),

  -- full-text search
  search_vector            tsvector
                             generated always as (
                               setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
                               setweight(to_tsvector('english', coalesce(description,'')), 'B')
                             ) stored,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- integrity: a live auction must have an ordered, sane window
  constraint live_window_chk check (
    status <> 'LIVE'
    or (starts_at is not null and ends_at is not null and ends_at > starts_at)
  ),
  -- integrity: SOLD implies an actual winner and price
  constraint sold_has_winner_chk check (
    status <> 'SOLD' or (winner_id is not null and winning_bid_minor is not null)
  ),
  -- integrity: a price can never be below the seller's own floor
  constraint price_above_floor_chk check (
    current_bid_minor is null or current_bid_minor >= starting_bid_minor
  ),
  -- integrity: UNSOLD/CANCELLED never carry a winner
  constraint no_winner_when_unsold_chk check (
    status not in ('UNSOLD','CANCELLED','DRAFT') or winner_id is null
  )
);

-- Access-pattern indexes (verified against real queries, not speculative)
create index if not exists auctions_status_ends_at_idx
  on public.auctions (status, ends_at);
create index if not exists auctions_live_ends_idx
  on public.auctions (ends_at)
  where status = 'LIVE';                     -- settle sweep + ending-soon rail
create index if not exists auctions_seller_created_idx
  on public.auctions (seller_id, created_at desc);
create index if not exists auctions_category_status_idx
  on public.auctions (category_id, status, ends_at);
create index if not exists auctions_created_idx
  on public.auctions (created_at desc);      -- recently listed
create index if not exists auctions_featured_idx
  on public.auctions (ends_at)
  where featured;
create index if not exists auctions_search_idx
  on public.auctions using gin (search_vector);
create index if not exists auctions_location_idx
  on public.auctions (lower(location));

-- ---------------------------------------------------------------------------
-- auction_images
-- ---------------------------------------------------------------------------
create table if not exists public.auction_images (
  id           uuid primary key default gen_random_uuid(),
  auction_id   uuid not null references public.auctions(id) on delete cascade,
  storage_path text not null,
  position     smallint not null default 0 check (position between 0 and 7),
  width        integer check (width is null or width > 0),
  height       integer check (height is null or height > 0),
  bytes        integer check (bytes is null or bytes between 1 and 10485760),
  created_at   timestamptz not null default now(),
  unique (auction_id, storage_path)
);
create index if not exists auction_images_auction_pos_idx
  on public.auction_images (auction_id, position);

-- ---------------------------------------------------------------------------
-- bids
-- ---------------------------------------------------------------------------
create table if not exists public.bids (
  id           uuid primary key default gen_random_uuid(),
  auction_id   uuid not null references public.auctions(id) on delete cascade,
  bidder_id    uuid not null references public.profiles(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  currency     text not null check (currency ~ '^[A-Z]{3}$'),
  -- replay/duplicate protection: same logical request never becomes 2 bids
  request_id   uuid not null,
  is_winning   boolean not null default false,
  created_at   timestamptz not null default now()
);

create unique index if not exists bids_idempotency_idx
  on public.bids (bidder_id, request_id);
create index if not exists bids_auction_created_idx
  on public.bids (auction_id, created_at desc);   -- bid history, newest first
create index if not exists bids_bidder_created_idx
  on public.bids (bidder_id, created_at desc);    -- buyer dashboard

-- ---------------------------------------------------------------------------
-- watchlist
-- ---------------------------------------------------------------------------
create table if not exists public.watchlist (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  auction_id uuid not null references public.auctions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, auction_id)
);
create index if not exists watchlist_auction_idx on public.watchlist (auction_id);

-- ---------------------------------------------------------------------------
-- notifications (event model is transport-agnostic: email/push later)
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null check (type in (
               'AUCTION_PUBLISHED','NEW_BID','OUTBID','ENDING_SOON',
               'WON','SOLD','ENDED_UNSOLD','REVIEW_REQUEST'
             )),
  auction_id uuid references public.auctions(id) on delete cascade,
  payload    jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (user_id)
  where read_at is null;

-- ---------------------------------------------------------------------------
-- fee_settings — single source of truth for monetisation (server-side only)
-- ---------------------------------------------------------------------------
create table if not exists public.fee_settings (
  id             smallint primary key default 1 check (id = 1),
  fee_bps        integer not null default 500 check (fee_bps between 0 and 10000),
  min_fee_minor  bigint  not null default 0 check (min_fee_minor >= 0),
  currency       text    not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  updated_at     timestamptz not null default now()
);
insert into public.fee_settings (id) values (1) on conflict (id) do nothing;
comment on table public.fee_settings is
  'Singleton. 500 bps = 5%. Read only by server functions; never by the client.';

-- ---------------------------------------------------------------------------
-- transactions — immutable financial record of a completed sale
-- ---------------------------------------------------------------------------
create table if not exists public.transactions (
  id                uuid primary key default gen_random_uuid(),
  auction_id        uuid not null unique references public.auctions(id) on delete restrict,
  seller_id         uuid not null references public.profiles(id) on delete restrict,
  buyer_id          uuid not null references public.profiles(id) on delete restrict,

  currency          text not null check (currency ~ '^[A-Z]{3}$'),
  gross_minor       bigint not null check (gross_minor > 0),
  fee_bps           integer not null check (fee_bps between 0 and 10000),
  fee_minor         bigint not null check (fee_minor >= 0),
  net_minor         bigint not null check (net_minor >= 0),

  status            text not null default 'AWAITING_PAYMENT'
                      check (status in
                        ('AWAITING_PAYMENT','PAID','SETTLED','REFUNDED','FAILED')),
  -- provider abstraction: NULL until a real PaymentProvider is configured
  provider          text check (provider is null or char_length(provider) <= 40),
  provider_reference text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint fee_math_chk check (fee_minor + net_minor = gross_minor),
  constraint buyer_never_seller_chk check (buyer_id <> seller_id)
);

create index if not exists transactions_seller_idx
  on public.transactions (seller_id, created_at desc);
create index if not exists transactions_buyer_idx
  on public.transactions (buyer_id, created_at desc);
create index if not exists transactions_status_idx
  on public.transactions (status) where status in ('AWAITING_PAYMENT','FAILED');

-- ---------------------------------------------------------------------------
-- reviews
-- ---------------------------------------------------------------------------
create table if not exists public.reviews (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references public.transactions(id) on delete cascade,
  auction_id     uuid not null references public.auctions(id) on delete cascade,
  reviewer_id    uuid not null references public.profiles(id) on delete cascade,
  reviewee_id    uuid not null references public.profiles(id) on delete cascade,
  rating         smallint not null check (rating between 1 and 5),
  comment        text check (comment is null or char_length(comment) <= 1000),
  created_at     timestamptz not null default now(),
  constraint parties_differ_chk check (reviewer_id <> reviewee_id)
);
create index if not exists reviews_reviewee_idx on public.reviews (reviewee_id, created_at desc);

-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references public.profiles(id) on delete cascade,
  target_type  text not null check (target_type in ('auction','user')),
  target_id    uuid not null,
  reason       text not null check (char_length(reason) between 5 and 1000),
  status       text not null default 'OPEN'
                 check (status in ('OPEN','REVIEWING','RESOLVED','DISMISSED')),
  resolution   text,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  unique (reporter_id, target_type, target_id)
);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
