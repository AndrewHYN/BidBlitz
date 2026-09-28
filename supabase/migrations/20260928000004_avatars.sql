-- ===========================================================================
-- Avatars - a real profile picture, from a controlled namespace
--
-- THE DEFECT THIS CLOSES
-- `profiles.avatar_url` was a free-text column and the UI rendered it straight
-- into an <img src>. A user could set it to any string they liked, including
-- `https://attacker.tld/pixel.png`, and the site would then load a remote
-- image of someone else's choosing: a tracking pixel on every page view, a way
-- for the URL under a profile to change after the fact, and an uncontrolled
-- third-party dependency on a page about money. The column is REMOVED, not
-- constrained, so the shape cannot be reintroduced by accident.
--
-- WHAT REPLACES IT
-- `profiles.avatar_path` holds a storage KEY, never a URL. It is only ever
-- written by the server, it must match the one legal shape, and the shape
-- itself is proof of ownership: the first path segment is the owner's auth id.
--
--   <user uuid>/avatar.<ext>      ext in jpg | png | webp | gif
--
-- BUCKET
-- `avatars` is PUBLIC for reads, because an avatar is public information and
-- this is what keeps profile pages cacheable without a signed request per
-- visitor. Writes are not public: every INSERT/UPDATE/DELETE policy is scoped
-- to the caller's own folder, so no user can write, replace or delete another
-- user's object, and the folder is derived from `auth.uid()` in the database
-- rather than from anything the client sends.
--
-- UPLOAD VALIDATION
-- Enforced server-side by magic bytes, never by the browser's MIME type and
-- never by the filename extension - both are attacker-chosen. SVG is excluded
-- deliberately: it is an XML document that can carry script, and a
-- user-supplied one served from our own origin is a stored-XSS vector.
-- The bucket's `allowed_mime_types` is a second, independent gate.
--
-- NOT CHOSEN
-- No server-side resizing or format conversion: that needs an image pipeline
-- (ImageMagick/Sharp) this project deliberately does not depend on. The
-- controls here are a 2 MB cap, a hard square aspect ratio in the UI so the
-- layout never shifts, and the existing 1x1/4x3 lazy image pipeline for
-- listing photos. Avatar *resizing* is recorded in POST_LAUNCH_BACKLOG.md.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. the bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true, 2097152,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. profiles.avatar_path replaces profiles.avatar_url
--
--    The CHECK is the first of two ownership gates. It guarantees the value is
--    a bare key of exactly the legal shape, with no scheme, no leading slash,
--    no backslash and no traversal segment - so even a client that wrote this
--    column directly could only ever produce something renderable as a
--    key inside the avatars bucket.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists avatar_path text;

alter table public.profiles
  drop constraint if exists profiles_avatar_path_chk;
alter table public.profiles
  add constraint profiles_avatar_path_chk
  check (
    avatar_path is null
    or avatar_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/avatar\.(jpg|jpeg|png|webp|gif)$'
  );

-- Anything already in the free-text column cannot be trusted to be a key, so
-- it is discarded rather than migrated. (Measured 2026-09-28: zero rows had a
-- value, so this loses nothing.)
update public.profiles set avatar_url = null where avatar_url is not null;

alter table public.profiles drop column if exists avatar_url;

comment on column public.profiles.avatar_path is
  'Storage key of this user''s avatar inside the public "avatars" bucket, in
   the form <auth uid>/avatar.<ext>. Never a URL. Written only by
   updateAvatarAction/removeAvatarAction; constrained to the owner''s own
   folder by both a CHECK and a WITH CHECK on profiles_update_self.';

-- ---------------------------------------------------------------------------
-- 3. storage policies - every write is scoped to the caller's own folder
--
--    (storage.foldername(name))[1] is the first path segment. Requiring it to
--    equal auth.uid()::text is what makes cross-user writes, cross-user
--    deletes and namespace escapes (../someone-else) all fail in the database
--    rather than in application code that can be forgotten.
-- ---------------------------------------------------------------------------
drop policy if exists avatars_storage_read on storage.objects;
create policy avatars_storage_read on storage.objects
  for select to public
  using (bucket_id = 'avatars');

drop policy if exists avatars_storage_insert on storage.objects;
create policy avatars_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ ('^' || (select auth.uid())::text || '/avatar\.(jpg|jpeg|png|webp|gif)$')
  );

drop policy if exists avatars_storage_update on storage.objects;
create policy avatars_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ ('^' || (select auth.uid())::text || '/avatar\.(jpg|jpeg|png|webp|gif)$')
  );

drop policy if exists avatars_storage_delete on storage.objects;
create policy avatars_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- 4. profiles_update_self: the second ownership gate
--
--    The avatar column is written by a server action like any other profile
--    field, so the policy has to stop a direct client write from pointing this
--    profile at another user's folder. The CHECK above only proves the SHAPE;
--    this proves the OWNER.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or private.is_admin())
  with check (
    (
      id = (select auth.uid())
      -- privilege columns are never client-writable
      and is_admin = (select p.is_admin from public.profiles p where p.id = (select auth.uid()))
      and is_banned = (select p.is_banned from public.profiles p where p.id = (select auth.uid()))
      and sales_count = (select p.sales_count from public.profiles p where p.id = (select auth.uid()))
      and purchases_count = (select p.purchases_count from public.profiles p where p.id = (select auth.uid()))
      and rating_sum = (select p.rating_sum from public.profiles p where p.id = (select auth.uid()))
      and rating_count = (select p.rating_count from public.profiles p where p.id = (select auth.uid()))
      -- an avatar must live in the caller's OWN folder
      and (
        avatar_path is null
        or split_part(avatar_path, '/', 1) = (select auth.uid())::text
      )
    )
    or private.is_admin()
  );
