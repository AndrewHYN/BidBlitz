/**
 * Maps the database's raw error strings to the exact copy the UI must show.
 * The server never fabricates a success: if the engine rejected a bid, the
 * user sees why, in their language, with the number they need next.
 */

export type BidErrorCode =
  | "not_authenticated"
  | "auction_not_found"
  | "seller_cannot_bid"
  | "auction_not_live"
  | "auction_ended"
  | "auction_paused"
  | "duplicate_request"
  | "below_minimum"
  | "invalid_amount"
  | "invalid_request_id"
  | "auction_state_immutable"
  | "auction_identity_immutable"
  | "terms_frozen_after_publish"
  | "not_owner"
  | "invalid_state"
  | "image_required"
  | "has_bids"
  | "rate_limited"
  | "account_banned"
  | "invalid_input"
  | "reset_link_invalid"
  | "duplicate_report"
  | "unknown";

export type BidRejection = {
  code: BidErrorCode;
  /** Short, human, specific. */
  message: string;
  /** The floor the user must beat, when the error is `below_minimum`. */
  nextMinMinor?: bigint;
};

const MESSAGES: Record<BidErrorCode, string> = {
  not_authenticated: "Sign in to bid.",
  auction_not_found: "This auction is unavailable.",
  seller_cannot_bid: "You can't bid on your own auction.",
  auction_not_live: "This auction isn't live yet.",
  auction_ended: "Auction has ended.",
  // A paused auction is under administrative hold: bidding is disabled but the
  // sale is not over, so "ended" would be a lie and "not live" would imply it
  // never started. The countdown panel carries the fuller explanation.
  auction_paused: "Bidding is paused while BidBlitz reviews this auction.",
  // A second PENDING cancellation request for the same auction. The first one
  // is already with the team, so this names that instead of erroring.
  duplicate_request:
    "A cancellation request for this auction is already waiting for review.",
  below_minimum: "Minimum bid is {amount}.",
  invalid_amount: "Enter a valid bid amount.",
  invalid_request_id: "Something went wrong with that request. Try again.",
  auction_state_immutable: "That change isn't allowed on a live auction.",
  auction_identity_immutable: "That change isn't allowed on a live auction.",
  terms_frozen_after_publish: "Terms are locked once the auction is live.",
  not_owner: "You don't own this auction.",
  invalid_state: "That action isn't available right now.",
  image_required: "Add at least one photo before publishing.",
  has_bids: "People have bid on this auction, so it can't be cancelled.",
  rate_limited: "Too many attempts. Wait a moment and try again.",
  // Raised by the is_banned triggers (migration 20260928000003). It has to be
  // in this table rather than falling through to `unknown`: the terms promise
  // a user can be suspended, so "Something went wrong. Please try again." would
  // tell a suspended account that retrying is the answer when it is not. The
  // contact route is the one the site already publishes.
  account_banned:
    "Your account can't bid or list right now. If you think that's a mistake, get in touch.",
  // Password-reset defaults. The reset actions pass their own specific copy
  // for most failures; these are the fallbacks used when a provider message has
  // to be mapped to a code.
  invalid_input: "Check what you've entered and try again.",
  reset_link_invalid:
    "This reset link has expired or was already used. Request a new one.",
  // A reporter filing the same target twice: the reports table refuses the
  // second row with a uniqueness violation, and without this mapping the
  // reporter would be told something went wrong when the truth is that their
  // first report is already in the queue.
  duplicate_report:
    "You've already reported this. The team will review your first report.",
  unknown: "Something went wrong. Please try again.",
};

const KNOWN = new Set(Object.keys(MESSAGES));

function extractMessage(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    if (typeof o.error_description === "string") return o.error_description;
    if (typeof o.error === "string") return o.error;
    if (typeof o.hint === "string") return o.hint;
  }
  return "";
}

function extractHint(raw: unknown): string {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.hint === "string") return o.hint;
  }
  return "";
}

/**
 * PostgREST delivers our `raise exception 'code' using hint = floor` as a
 * message plus a hint. Parse both so `below_minimum` can tell the user the
 * exact number to type.
 */
export function normalizeEngineError(raw: unknown): BidRejection {
  const message = extractMessage(raw);
  const hint = extractHint(raw);

  let code: BidErrorCode = "unknown";
  for (const key of Object.keys(MESSAGES)) {
    if (message.includes(key)) {
      code = key as BidErrorCode;
      break;
    }
  }

  // permission-denied variants map onto the friendliest sensible wording
  if (code === "unknown" && /permission denied for function place_bid/.test(message)) {
    code = "not_authenticated";
  }

  const template = MESSAGES[code] ?? MESSAGES.unknown;

  if (code === "below_minimum" && hint && /^\d+$/.test(hint)) {
    return { code, message: template.replace("{amount}", "__AMOUNT__"), nextMinMinor: BigInt(hint) };
  }
  if (code === "rate_limited" || /rate limit/i.test(message)) {
    return { code: "rate_limited", message: MESSAGES.rate_limited };
  }

  return { code, message: KNOWN.has(code) ? template : MESSAGES.unknown };
}

/** Fill in the formatted amount for a `below_minimum` rejection. */
export function renderRejectionMessage(
  rejection: BidRejection,
  format: (minor: bigint) => string
): string {
  if (rejection.nextMinMinor !== undefined) {
    return rejection.message.replace("__AMOUNT__", format(rejection.nextMinMinor));
  }
  return rejection.message;
}
