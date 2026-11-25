# Media migration — operator runbook

This is separate from the browser upload hotfix. No production database or storage mutation is performed by this commit.

1. Use Node 22+ on a trusted local operator machine. Run npm ci (Next's lockfile includes sharp 0.35.4). Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the local environment, never in source, command-line arguments, logs or shared CI artifacts. Verify project ref.
2. Run node scripts/media/optimize-listings.mjs (dry-run; no object downloads).
3. Back up the database and choose an encrypted local directory outside the repository for originals and manifest. Stop competing maintenance scripts. Run node scripts/media/optimize-listings.mjs --apply --limit=1 --backup=/absolute/private/path. Inspect the listing and verify buyer view. Repeat in small batches only after validation. Existing object and row identity are retained, and the new path is content-addressed and verified before the conditional row update.
4. Rollback with node scripts/media/optimize-listings.mjs --rollback --backup=/absolute/private/path. Rollback is conditional on the new path still being current. Keep originals until verification and a defined retention/purge policy. Do not remove objects through SQL.
5. The script deliberately skips animation, already-small photos and images that cannot reach the hard size limit without greater quality loss. No automatic cleanup. Known small source rows may be skipped based on stored metadata; audit metadata separately. Run batches with a sufficiently high limit if skipped candidates prevent progress.

## Follow-on work
- Avatar keys are constrained to owner/avatar.ext; use a separate backup, verified replacement and conditional reference update. Do not bypass owner or privacy rules. Private chat attachments require a separately verified authorization-preserving migration; do not migrate to a public bucket.
- For card thumbnails, introduce a first-class variant field and generation/cleanup policy; use 30–60 KB thumbnails by default and original-size gallery only on request. Do not guess thumbnail paths on existing objects.
- Measure cached egress in official organization billing; storage SQL is a measured object-size proxy, not billing data. Keep cache revocation bounded, especially avatars. Target stable URLs and avoid globally disabling search indexing.
- If moving public media to R2, use Standard storage, a custom media subdomain and a provider-aware key resolver. Keep private chat in Supabase. No subscription or credentials created by this change.
