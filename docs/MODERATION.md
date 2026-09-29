# BidBlitz moderation

How a one-person marketplace handles a bad listing, a bad account, and the
paperwork that proves it was handled. Every claim here is asserted in
`scripts/db/verify-engine.mjs` (§15b) or in the browser suite
(`e2e/moderation.spec.ts`); check names are given so nothing is trusted.

## The model

```
NORMAL                    REPORTED                          ENFORCEMENT
seller drafts             user reports auction/user         listing violates
  -> photos                 -> OPEN report in admin queue     -> TAKEDOWN_LISTING
  -> publishes              -> admin marks REVIEWING            (CANCELLED +
  -> public                 -> admin decides                   audit + seller notice)
  -> server validation        RESOLVED or DISMISSED
  -> reportable                                     user violates seriously
                                                    -> BAN_USER (suspend)
                                                    -> UNBAN_USER (restore)
```

No manual approval for ordinary listings: publish-time validation (schema,
photo requirement, terms freeze) plus the report queue is the whole gate.
Anything heavier would need an operator BidBlitz does not have.

## Reports

- Targets: `auction` or `user`. Entry points: the report dialog on every
  auction page and, for signed-in visitors, on other users' profiles. Your own
  profile offers no control, and the server refuses self-reports.
- Statuses: `OPEN` → `REVIEWING` → `RESOLVED` / `DISMISSED`.
- Duplicates: `(reporter_id, target_type, target_id)` is unique, so a second
  filing is refused at the database boundary — and answered, not errored:
  "You've already reported this..." names the queued first report.
- Targets must exist and be visible, or the filing is refused before any row.
- Authorization is at the boundary, never the buttons: inserts force
  `reporter_id = auth.uid()`; selects are reporter-or-admin; updates are
  admin-only; nothing deletes through the API at all.

## Enforcement

`admin_takedown_auction()` and `admin_set_banned()` are the only enforcement
paths. Both check `auth.uid()` plus `is_admin` inside SECURITY DEFINER bodies
(EXECUTE is revoked from anon; the UI checks first for a fast honest refusal,
but the function is the boundary that matters).

- **Takedown** locks the row, refuses already-closed and draft rows (history
  is not rewritten; drafts are private, so there is nothing public to
  remove), sets `CANCELLED`, writes the audit row, notifies the seller with
  safe copy, and resolves the originating report. No new terminal state: the
  existing closed-auction behavior — no bids, no payment flow, preserved
  history — is exactly what a takedown needs.
- **Ban** refuses self-ban (no lockout button), is idempotent, and writes the
  audit row. Blocking itself stays in the `is_banned` triggers: bids,
  publishing and listing creation are refused at the database boundary.
  Banned accounts CAN still file reports — a safety signal stays a signal.
- A seller cancellation and an admin takedown both end at `CANCELLED`; they
  are distinguished by the audit row (present only for takedowns) and by the
  `LISTING_REMOVED` notice the seller receives (present only for takedowns).

## The audit trail

`moderation_events`: actor, action, target, previous/new status, reason,
optional report, timestamp. Append-only by construction — admin SELECT only,
no insert/update/delete policy for any role; rows are written solely by the
two functions above, which force `actor_id` to the caller. The admin console
renders recent entries with reasons; ordinary users cannot read them.

## What each side sees

- **Operator:** report reason, target name + link (never a bare UUID),
  triage buttons, takedown/suspend buttons with confirmations naming target,
  action, reason and consequence, and the audit list. Queues, not KPI cards.
- **Seller of a removed listing:** the listing page renders its normal
  cancelled state (never an error page), plus a `LISTING_REMOVED`
  notification naming the outcome and the help path. Never who reported them,
  never the internal reason.
- **Bidders on a removed listing:** bidding refused, no "winning" state, no
  payment path, full history intact.
- **Suspended account:** every blocked action answers `account_banned` with
  the appeal route — never "try again", which would be both useless and
  untrue.

## Rules

`/help/rules` carries the marketplace list beside the bidding rules: genuine
goods, honest descriptions, on-site payment, one account, no abuse, honest
reports. Each maps to a report reason and an enforcement action above. That
mapping is the whole policy: a rule without an enforcement path is decoration,
so there are only as many rules as there are actions.
