# Infrastructure operating checklist

Production changes on 2026-11-25: foreign-key index coverage, caller identity initplans for 16 read policies, business seller read policy deduplication, and removal of public execution access to the internal staff admin synchronization helper. Existing app RPCs remain in use: never blanket-revoke them to silence the advisor. Deny-by-default RLS on server-only tables is intentional. Review actual authorization checks and regression tests before changing other privileged RPCs. Retain recently-created indexes until a representative workload has accumulated.

## Daily checks
- Supabase billing: cached and uncached egress, DB/storage, MAU, realtime messages and connections; check official usage. At 50%, 75%, 90% notify owner. Request logs are a proxy, not billing totals.
- Vercel billing: plan eligibility for commercial use, bandwidth, image transformations/cache reads and writes, functions and build consumption. Do not buy a plan without owner approval.
- Resend: provider quota and rejected deliveries; inspect outbox status counts only. Never log addresses or payloads. Do not disable transactional alerts to reduce spend.
- Domain: verify expiry and renewal through registrar account; set reminders at 30, 14 and 7 days.
- Check unauthorized access errors, storage privacy, production uptime and new security/performance advisories.

## Backup and recovery
Use an owner-controlled trusted machine or encrypted private storage. Follow the Supabase database backup/restore guide (https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). Store credentials in the operator environment, never the public Git repository. Back up roles/schema/data as applicable and separately download storage objects through the Storage API; database dumps do not include object bytes. Retain multiple encrypted generations and verify hashes. Test restoration to an isolated, non-production environment before declaring backups reliable. No automated backup or restore is considered verified until a real run and restore test succeed. Do not overwrite live data when testing.

## Pending
- Existing image migration: PR 73, verified pilot and private backup before switching references.
- Complete individual RPC authorization review, including role/ownership checks and direct RPC authorization tests. Leaked-password protection may require a paid plan.
- Verify current billing counters from provider dashboards; no connector currently exposes all those totals.
- Audit email outbox retry behavior and preference lookup scalability; do not read personal data for monitoring.
- Keep private chat media private. Avoid introducing public storage URLs for it.
