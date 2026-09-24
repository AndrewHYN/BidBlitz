-- BidBlitz — 000009 seed the category taxonomy
--
-- Why this migration exists (honest changelog):
-- The schema created `public.categories` and never inserted a row: no seed
-- file, no seed migration, nothing. Measured against the live project before
-- this change: `select count(*) from public.categories` -> 0.
--
-- That is not a cosmetic gap. The sell form renders the category picker from
-- this table, `createAuctionSchema` requires a categoryId, and `publish_auction`
-- refuses a listing without one. With an empty table the picker showed only its
-- placeholder, the E2E `sell-category` select had nothing to choose, and no
-- human could publish a listing at all. Browse/home fell back to their honest
-- empty states forever.
--
-- Idempotent: `on conflict (slug)` keeps re-running safe, so this can be
-- replayed by any environment (local, preview, production) without a data
-- migration story.
--
-- Note: the rows are taxonomy only — no listings, no fake bids, no pretend
-- activity. A brand-new deployment still truthfully renders empty states until
-- a real seller lists something.

insert into public.categories (slug, name, emoji, sort_order) values
  ('electronics',       'Electronics',          '📱', 10),
  ('fashion',           'Fashion',              '👕', 20),
  ('home-garden',       'Home & Garden',        '🏡', 30),
  ('collectibles',      'Collectibles',         '🏆', 40),
  ('toys-hobbies',      'Toys & Hobbies',       '🎲', 50),
  ('sports-outdoors',   'Sports & Outdoors',    '⛺', 60),
  ('vehicles-parts',    'Vehicles & Parts',     '🚗', 70),
  ('art-memorabilia',   'Art & Memorabilia',    '🎨', 80),
  ('books-music',       'Books & Music',        '📚', 90),
  ('tools-equipment',   'Tools & Equipment',    '🔧', 100)
on conflict (slug) do update
   set name       = excluded.name,
       emoji      = excluded.emoji,
       sort_order = excluded.sort_order;
