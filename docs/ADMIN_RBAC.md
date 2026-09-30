# Team RBAC — roles, permissions, invitations, audit

Staff authorization is database-driven. `profiles.is_admin` remains only as a
compatibility mirror, maintained by the team RPCs; every authorization decision
reads live role assignments. A revoked staffer loses access on the next check,
not the next login: no JWT claim, no client flag, and no request header is ever
trusted for a privileged action.

Every claim below is asserted in `scripts/db/verify-engine.mjs` (the `RB:`
checks) or in the named RPC. Re-test rather than trust.

## Roles

| Role | Purpose | Incompatible with |
| --- | --- | --- |
| `OWNER` | Full platform control. Exactly one holder. | Being touched by anyone but an owner |
| `ADMIN` | Broad marketplace, moderation, user and operational powers | Granting `OWNER`, touching `OWNER` rows |
| `MODERATOR` | Listing review, takedown, pause/resume, reports, user moderation | Payouts, team management, fees |
| `OPERATIONS` | Day-to-day ops and seller support | Team admin, finance mutation, bans |
| `FINANCE` | Payments, payouts, reporting | Moderation, team management |
| `SUPPORT` | User assistance and read-only visibility | Every mutation power |

`OWNER` implies every permission without a bundle row, so a newly added
permission is owner-held from birth. All other roles hold exactly the
permissions in `staff_role_permissions` — no more, and the RPCs refuse to grant
a permission the granter does not hold themselves.

## Permission catalogue

Permissions are `category.capability` strings in `staff_permissions`. Sensitive
ones (payouts, refunds, payment-state mutation, suspension, team and fee
management) are flagged `sensitive = true` and the Team UI renders them
distinctly at the point of selection, not buried in documentation.

- `ADMIN`: `admin.access`, `admin.manage_team`, `admin.manage_roles`,
  `admin.view_audit`
- `LISTINGS`: `view`, `review`, `approve`, `reject`, `request_changes`,
  `takedown`
- `AUCTIONS`: `view`, `pause`, `resume`, `cancel`, `review_cancellation`,
  `view_bid_history`
- `USERS`: `view`, `contact_support`, `suspend`, `restore`,
  `view_moderation_history`
- `REPORTS`: `view`, `review`, `resolve`, `dismiss`
- `PAYMENTS`: `view`, `view_sensitive`, `review_exceptions`, `refund`,
  `manage_payment_state`
- `PAYOUTS`: `view`, `review`, `transition`, `mark_paid`
- `SETTINGS`: `view`, `manage_marketplace`, `manage_fees`
- `NOTIFICATIONS`: `view`, `manage_templates`, `view_delivery_failures`
- `ANALYTICS`: `view`

Separation of duties is enforced in the database, not the UI: a moderator holds
no payout permission, finance holds no moderation permission, support holds no
mutation permission at all.

## Managing the team (`/admin/team`)

Requires `admin.manage_team`. The owner can search users by username or display
name (an admin-only endpoint, so it is not an enumeration oracle), promote an
existing user, invite a new member by email, suspend, restore, or revoke all
access. Suspending or revoking never touches the member's buyer/seller account
or history — only staff access changes.

Self-protection, enforced inside the RPCs:

- nobody can change their own access (`cannot_target_self`);
- nobody can grant a permission they do not hold (`cannot_grant_unheld`,
  owners excepted because they hold everything);
- `OWNER` cannot be granted through the assignment RPC at all — ownership
  transfer is a separate future workflow, not a role dropdown;
- `OWNER` rows move only by owner hands (`owner_only`);
- the last owner cannot be suspended or revoked (`last_owner` tripwire).

Server helpers live in `src/server/permissions.ts` (`hasPermission`,
`requirePermission`); the header's Admin entry follows the live
`admin.access` permission, and `/admin` re-checks it server-side.

## Invitations

`admin_invite_member` creates a single-use, 72-hour invitation storing only a
SHA-256 hash of a 32-byte token. The raw token is returned once, to be emailed;
afterwards no database read can reconstruct the link. Acceptance binds the
signed-in account whose email matches, and re-checks expiry, revocation and
single-use under lock. A wrong or mismatched token reads as `invalid_invite`
and nothing else, so invitations cannot be probed. Expired rows stay visible
until revoked: expiry is enforced by the accept RPC, and a stale row is a
prompt to revoke it, not a grant of anything.

If the invitation email cannot even be queued, the invitation is revoked again:
an invite nobody can receive is a live token with no purpose.

## Audit

Every change writes `staff_audit` (actor, action, target, previous and new
state, reason, timestamp): assignments, suspensions, restores, revocations,
invitations, revocations of invitations, and acceptances. The table has no
write surface for anyone — no client insert/update/delete policy exists — so
no staff member can alter their own trail.

## Migrating from `is_admin`

1. Every profile carrying `is_admin` at migration time received the `OWNER`
   role (verified: exactly the operator's real account, no QA account).
2. Each team RPC keeps the mirror in step via `staff_sync_is_admin`: active
   `OWNER`/`ADMIN` implies `is_admin = true`, otherwise it clears.
3. New code checks `has_permission`, never the flag.
4. `is_admin` is removed only after every dependency is migrated and proven —
   until then it is a mirror, not a source of truth.
