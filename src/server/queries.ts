import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sweepDueAuctions } from "@/server/sweep";
import { recentlyListedCutoffIso } from "@/lib/auction-status";
import type { Database, SellerPayoutStatus, TransactionStatus } from "@/lib/supabase/types";

/**
 * Read model. Server Components call these so the first paint already has
 * content — no loading spinner in front of a page that could have been
 * rendered on the server.
 *
 * Every helper that can run as the caller uses the caller's session (RLS
 * applies). Only the ones that must see data regardless of viewer use the
 * admin client, and those never expose another user's private rows.
 */

export type AuctionRow = Database["public"]["Tables"]["auctions"]["Row"];
export type BidRow = Database["public"]["Tables"]["bids"]["Row"];
export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type TransactionRow = Database["public"]["Tables"]["transactions"]["Row"];

export type AuctionCardData = {
  id: string;
  title: string;
  imageUrl: string | null;
  currentBidMinor: number | null;
  startingBidMinor: number;
  bidCount: number;
  endsAt: string | null;
  status: string;
  location: string;
  condition: string;
  featured: boolean;
  categorySlug: string | null;
  categoryName: string | null;
};

const CARD_SELECT = `
  id, title, current_bid_minor, starting_bid_minor, bid_count,
  ends_at, status, location, condition, featured,
  categories:category_id(slug, name),
  auction_images(position, storage_path)
`;

type CardJoin = {
  id: string;
  title: string;
  current_bid_minor: number | null;
  starting_bid_minor: number;
  bid_count: number;
  ends_at: string | null;
  status: string;
  location: string;
  condition: string;
  featured: boolean;
  /**
   * PostgREST returns an object for a to-one relation and an array for a
   * to-many one, and which it is depends on the schema introspection — so we
   * accept both and normalise here rather than lying in a cast.
   */
  categories: { slug: string; name: string } | Array<{ slug: string; name: string }> | null;
  auction_images: Array<{ position: number; storage_path: string }>;
};

export function imageUrlFor(path: string | null | undefined): string | null {
  if (!path) return null;
  // Only a plain storage key survives. `auction_images.storage_path` is
  // written through PostgREST by sellers directly as well as by our server
  // action, so a row could carry `https://attacker.tld/x.jpg` — rendering it
  // would load an arbitrary external image in browse/detail (and the URL
  // could change after the listing was published). Anything that is not a
  // bare relative key (absolute, protocol-relative, backslash, `.`/`..`
  // traversal) falls through to `null` and the UI shows its own placeholder.
  const segments = path.split("/");
  const plain =
    !path.includes("://") &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    segments.every((seg) => seg !== "." && seg !== "..");
  if (!plain) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // public bucket => unauthenticated delivery, which keeps browse pages cacheable
  return `${base}/storage/v1/object/public/auction-images/${path}`;
}

function toCard(row: CardJoin): AuctionCardData {
  const sorted = [...(row.auction_images ?? [])].sort((a, b) => a.position - b.position);
  const category = Array.isArray(row.categories) ? (row.categories[0] ?? null) : row.categories;
  return {
    id: row.id,
    title: row.title,
    imageUrl: imageUrlFor(sorted[0]?.storage_path),
    currentBidMinor: row.current_bid_minor,
    startingBidMinor: row.starting_bid_minor,
    bidCount: row.bid_count,
    endsAt: row.ends_at,
    status: row.status,
    location: row.location,
    condition: row.condition,
    featured: row.featured,
    categorySlug: category?.slug ?? null,
    categoryName: category?.name ?? null,
  };
}

/** Home: live now + ending soon + recently listed. One round trip. */
export const getHomeFeed = cache(async () => {
  // Close anything overdue BEFORE we read, so a card can never show a "Live"
  // badge next to an expired countdown. Throttled to one call per minute.
  await sweepDueAuctions();
  const supabase = await createClient();
  // Server clock, never the browser's: freshness membership is decided here,
  // in this server query, and the client receives only the result.
  const recentCutoffIso = recentlyListedCutoffIso(Date.now());

  const [live, ending, recent, categories] = await Promise.all([
    supabase
      .from("auctions")
      .select(CARD_SELECT)
      .eq("status", "LIVE")
      .is("archived_at", null)
      .order("ends_at", { ascending: true })
      .limit(12),
    supabase
      .from("auctions")
      .select(CARD_SELECT)
      .eq("status", "LIVE")
      .is("archived_at", null)
      .order("ends_at", { ascending: true })
      .limit(8),
    // Recently listed is a merchandising window, not a lifecycle state:
    // publicly discoverable (LIVE/SCHEDULED) AND stamped within the window,
    // newest first. Leaving the window changes nothing about the auction -
    // it stays in Browse, search and the seller's listings.
    supabase
      .from("auctions")
      .select(CARD_SELECT)
      .in("status", ["LIVE", "SCHEDULED"])
      .is("archived_at", null)
      .gt("listed_at", recentCutoffIso)
      .order("listed_at", { ascending: false })
      .limit(12),
    supabase.from("categories").select("id, slug, name, emoji, sort_order").order("sort_order"),
  ]);

  return {
    live: (live.data ?? []).map(toCard),
    endingSoon: (ending.data ?? []).map(toCard),
    recent: (recent.data ?? []).map(toCard),
    categories: categories.data ?? [],
    error: live.error?.message ?? null,
  };
});

export type BrowseFilters = {
  q?: string;
  category?: string;
  condition?: string;
  min?: number;
  max?: number;
  location?: string;
  sort?: string;
  page?: number;
};

const PAGE_SIZE = 24;

export const browseAuctions = cache(async (filters: BrowseFilters) => {
  // Same reconcile-on-read nudge as the home feed; the throttle inside
  // `sweepDueAuctions` makes this free in the common case.
  await sweepDueAuctions();
  const supabase = await createClient();
  const page = Math.max(1, filters.page ?? 1);

  let query = supabase
    .from("auctions")
    .select(CARD_SELECT, { count: "exact" })
    .neq("status", "DRAFT")
    .neq("status", "CANCELLED")
    .is("archived_at", null);

  if (filters.q) {
    // Postgres full-text, no search cluster needed at this scale
    const ts = filters.q.replace(/[^a-zA-Z0-9\s]/g, " ").trim().split(/\s+/).join(" & ");
    if (ts) query = query.textSearch("search_vector", ts, { type: "websearch" });
  }
  if (filters.category) query = query.eq("categories.slug", filters.category);
  if (filters.condition) query = query.eq("condition", filters.condition);
  if (filters.location) query = query.ilike("location", `%${filters.location}%`);
  if (filters.min !== undefined) {
    query = query.or(`current_bid_minor.gte.${filters.min},and(current_bid_minor.is.null,starting_bid_minor.gte.${filters.min})`);
  }
  if (filters.max !== undefined) {
    query = query.or(`current_bid_minor.lte.${filters.max},and(current_bid_minor.is.null,starting_bid_minor.lte.${filters.max})`);
  }

  switch (filters.sort) {
    case "newest":
      query = query.order("created_at", { ascending: false });
      break;
    case "most-bids":
      query = query.order("bid_count", { ascending: false });
      break;
    case "price-asc":
      query = query.order("current_bid_minor", { ascending: true, nullsFirst: true });
      break;
    case "price-desc":
      query = query.order("current_bid_minor", { ascending: false, nullsFirst: true });
      break;
    case "ending-soon":
    default:
      query = query.order("ends_at", { ascending: true });
  }

  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await query.range(from, from + PAGE_SIZE - 1);

  if (error) {
    console.error("[browse]", error.message);
    return { items: [], total: 0, page, pageSize: PAGE_SIZE, error: error.message };
  }

  return {
    items: (data ?? []).map(toCard),
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
    error: null,
  };
});

/** Detail page payload. Returns null when the auction is not visible to them. */
export const getAuctionDetail = cache(async (id: string) => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("auctions")
    .select(
      `*,
       categories:category_id(id, slug, name),
       auction_images(id, storage_path, position, width, height),
       seller:profiles!auctions_seller_id_fkey(
         id, username, display_name, avatar_path, bio, location,
         rating_sum, rating_count, sales_count, purchases_count,
         email_verified, created_at
       )`
    )
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();

  if (error) {
    console.error("[auction detail]", error.message);
    return null;
  }
  if (!data) return null;

  const { data: bids } = await supabase
    .from("bids")
    .select(
      `id, amount_minor, currency, created_at, is_winning,
       bidder:profiles!bids_bidder_id_fkey(username, display_name)`
    )
    .eq("auction_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let watched = false;
  let myHighestBidMinor: number | null = null;
  if (user) {
    const [{ data: wl }, { data: myBids }] = await Promise.all([
      supabase
        .from("watchlist")
        .select("auction_id")
        .eq("user_id", user.id)
        .eq("auction_id", id)
        .maybeSingle(),
      supabase
        .from("bids")
        .select("amount_minor")
        .eq("auction_id", id)
        .eq("bidder_id", user.id)
        .order("amount_minor", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    watched = Boolean(wl);
    myHighestBidMinor = (myBids?.amount_minor as number | undefined) ?? null;
  }

  let transaction: TransactionRow | null = null;
  if (user) {
    const { data: tx } = await supabase
      .from("transactions")
      .select("*")
      .eq("auction_id", id)
      .maybeSingle();
    transaction = tx ?? null;
  }

  return {
    auction: data as AuctionRow & {
      categories: { id: number; slug: string; name: string } | null;
      auction_images: Array<{
        id: string;
        storage_path: string;
        position: number;
        width: number | null;
        height: number | null;
      }>;
      seller: ProfileRow | null;
    },
    bids: (bids ?? []) as unknown as Array<
      BidRow & { bidder: { username: string; display_name: string } | null }
    >,
    viewerId: user?.id ?? null,
    watched,
    myHighestBidMinor,
    transaction,
  };
});

export const getCategories = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select("id, slug, name, emoji, sort_order")
    .order("sort_order");
  return data ?? [];
});

/**
 * The current platform fee rate, in basis points, read from the single row
 * in `fee_settings` (world-readable on purpose: it IS public policy).
 * Display surfaces (sell flow, fee notes) must state THE rate the engine
 * will actually charge — never a hardcoded copy of it.
 * `null` means "no rate readable right now": callers then omit the percent
 * instead of inventing one.
 */
export const getFeeBps = cache(async (): Promise<number | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("fee_settings")
    .select("fee_bps")
    .eq("id", 1)
    .maybeSingle();
  return data?.fee_bps ?? null;
});

export const getWatchlist = cache(async (userId: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("watchlist")
    .select(
      `created_at,
       auctions:auction_id(${CARD_SELECT}, archived_at)`
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return (data ?? [])
    .map((row) => {
      const auction = row.auctions as unknown as (CardJoin & { archived_at: string | null }) | null;
      return auction && auction.archived_at === null ? toCard(auction) : null;
    })
    .filter(Boolean) as AuctionCardData[];
});

export const getNotifications = cache(async (userId: string) => {
  const supabase = await createClient();
  const { data: list } = await supabase
    .from("notifications")
    .select("id, type, payload, read_at, created_at, auction_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(80);

  const rows = list ?? [];
  const auctionIds = [
    ...new Set(rows.flatMap((row) => (row.auction_id ? [row.auction_id] : []))),
  ];
  const archived = new Set<string>();

  if (auctionIds.length > 0) {
    const { data: hidden } = await supabase
      .from("auctions")
      .select("id")
      .in("id", auctionIds)
      .not("archived_at", "is", null);
    for (const row of hidden ?? []) archived.add(row.id);
  }

  const items = rows
    .filter((row) => row.auction_id === null || !archived.has(row.auction_id))
    .slice(0, 50);

  return {
    items,
    unreadCount: items.filter((row) => row.read_at === null).length,
  };
});

export const getUnreadCount = async (userId: string): Promise<number> => {
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("notifications")
    .select("id, auction_id")
    .eq("user_id", userId)
    .is("read_at", null)
    .limit(500);

  const unread = rows ?? [];
  const auctionIds = [
    ...new Set(unread.flatMap((row) => (row.auction_id ? [row.auction_id] : []))),
  ];
  if (auctionIds.length === 0) return unread.length;

  const { data: hidden } = await admin
    .from("auctions")
    .select("id")
    .in("id", auctionIds)
    .not("archived_at", "is", null);
  const archived = new Set((hidden ?? []).map((row) => row.id));

  return unread.filter(
    (row) => row.auction_id === null || !archived.has(row.auction_id)
  ).length;
};

/** Buyer view: auctions I bid on. */
export const getBuying = cache(async (userId: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bids")
    .select(
      `auction_id, amount_minor, created_at,
       auctions:auction_id(${CARD_SELECT}, winner_id, status, current_bidder_id, current_bid_minor, archived_at)`
    )
    .eq("bidder_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  const seen = new Set<string>();
  const out: Array<
    AuctionCardData & {
      myBidMinor: number;
      isWinning: boolean;
      won: boolean;
      winnerId: string | null;
    }
  > = [];

  for (const row of data ?? []) {
    if (seen.has(row.auction_id)) continue;
    seen.add(row.auction_id);
    const a = row.auctions as unknown as CardJoin & {
      winner_id: string | null;
      current_bidder_id: string | null;
      current_bid_minor: number | null;
      archived_at: string | null;
    };
    if (!a || a.archived_at !== null) continue;
    out.push({
      ...toCard(a),
      myBidMinor: row.amount_minor as number,
      isWinning: a.current_bidder_id === userId,
      won: a.status === "SOLD" && a.winner_id === userId,
      winnerId: a.winner_id,
    });
  }

  return out;
});

/** Seller view: my auctions with sale state. */
export const getSelling = cache(async (userId: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("auctions")
    .select(
      `${CARD_SELECT}, winner_id, winning_bid_minor, seller_id, created_at,
       transactions(id, status, gross_minor, fee_minor, net_minor, currency)`
    )
    .eq("seller_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  type SellingTx = {
    id: string;
    status: string;
    gross_minor: number;
    fee_minor: number;
    net_minor: number;
    currency: string;
  };

  return ((data ?? []) as unknown as Array<
    AuctionCardData & {
      winner_id: string | null;
      winning_bid_minor: number | null;
      seller_id: string;
      created_at: string;
      // PostgREST shapes this embed by cardinality, not by what the query
      // asks for: transactions.auction_id is UNIQUE, so one auction has at
      // most one transaction and the embed arrives as an OBJECT or NULL,
      // never an array. The page below was written for an array, so a row
      // with no sale crashed it (null[0]) and a row with a sale silently hid
      // its summary (object[0] is undefined). No e2e ever visited this page
      // with rows, which is how a crash-on-every-listing survived every gate.
      // Normalized here, once, so the declared type is the runtime truth.
      transactions: SellingTx | SellingTx[] | null;
    }
  >).map((item) => ({
    ...item,
    transactions: Array.isArray(item.transactions)
      ? item.transactions
      : item.transactions
        ? [item.transactions]
        : [],
  }));
});

export const getTransactions = cache(async (userId: string) => {
  const supabase = await createClient();
  const [{ data }, { data: myReviews }] = await Promise.all([
    supabase
      .from("transactions")
      .select(
        `id, auction_id, seller_id, buyer_id, currency, gross_minor, fee_bps,
         fee_minor, net_minor, status, provider, payment_due_at, created_at,
         auctions:auction_id(title, archived_at)`
      )
      .or(`seller_id.eq.${userId},buyer_id.eq.${userId}`)
      .order("created_at", { ascending: false }),
    // Which of these sales the viewer has already reviewed — the UI shows
    // "Reviewed" instead of offering a second (server-rejected) attempt.
    supabase
      .from("reviews")
      .select("transaction_id")
      .eq("reviewer_id", userId),
  ]);

  const reviewed = new Set((myReviews ?? []).map((r) => r.transaction_id));

  return ((data ?? []) as unknown as Array<{
    id: string;
    auction_id: string;
    seller_id: string;
    buyer_id: string;
    currency: string;
    gross_minor: number;
    fee_bps: number;
    fee_minor: number;
    net_minor: number;
    status: string;
    provider: string | null;
    payment_due_at: string | null;
    created_at: string;
    auctions: { title: string; archived_at: string | null } | null;
  }>)
    .filter((row) => row.auctions?.archived_at === null)
    .map((row) => ({ ...row, reviewed: reviewed.has(row.id) }));
});

// ---------------------------------------------------------------------------
// Post-win threads: exactly the two parties, enforced by RLS twice over
// (the transaction row and every message row). A forged id, or a signed-in
// non-party, reads zero rows — the page answers "not available" either way.
// ---------------------------------------------------------------------------

export type ThreadMessage = {
  id: string;
  sender_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

export type ThreadCounterparty = { id: string; username: string; display_name: string };

export type ThreadView = {
  id: string;
  auction_id: string;
  title: string;
  seller_id: string;
  buyer_id: string;
  status: string;
  role: "buyer" | "seller" | "moderator";
  counterparty: ThreadCounterparty;
  messages: ThreadMessage[];
} | null;

/**
 * The thread for one transaction, or null when it does not exist, is not
 * the viewer's, or the messaging migration has not been applied yet. All
 * three look identical on purpose: no existence oracle for forged ids.
 *
 * Administrators read in a moderator role (reported messages are evidence)
 * but cannot post: the send action admits parties only.
 */
export const getThread = cache(async (userId: string, transactionId: string): Promise<ThreadView> => {
  const supabase = await createClient();
  const [{ data: tx, error: txError }, { data: self }] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, auction_id, seller_id, buyer_id, status, auctions:auction_id(title, archived_at)")
      .eq("id", transactionId)
      .maybeSingle(),
    supabase.from("profiles").select("is_admin").eq("id", userId).maybeSingle(),
  ]);
  if (txError || !tx) return null;
  const row = tx as unknown as {
    id: string;
    auction_id: string;
    seller_id: string;
    buyer_id: string;
    status: string;
    auctions: { title: string; archived_at: string | null } | null;
  };
  const isParty = row.seller_id === userId || row.buyer_id === userId;
  const isAdmin = (self as { is_admin?: boolean } | null)?.is_admin === true;
  if (!isParty && !isAdmin) return null;
  if (row.auctions?.archived_at !== null && !isAdmin) return null;
  const role = !isParty ? "moderator" : row.seller_id === userId ? "seller" : "buyer";

  const counterpartyId = row.seller_id === userId ? row.buyer_id : row.seller_id;
  const [{ data: counterparty }, { data: messages }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, username, display_name")
      .eq("id", counterpartyId)
      .maybeSingle(),
    supabase
      .from("transaction_messages")
      .select("id, sender_id, body, read_at, created_at")
      .eq("transaction_id", row.id)
      .order("created_at", { ascending: true })
      .limit(200),
  ]);
  // A missing table (migration pending) must read as "not available", never
  // as a crash: messages is null only on query failure.
  if (!counterparty || !messages) return null;
  return {
    id: row.id,
    auction_id: row.auction_id,
    title: row.auctions?.title ?? "your sale",
    seller_id: row.seller_id,
    buyer_id: row.buyer_id,
    status: row.status,
    role,
    counterparty: counterparty as unknown as ThreadCounterparty,
    messages: messages as unknown as ThreadMessage[],
  };
});

/** Unread inbound counts per transaction for the viewer (badge on the table). */
export const getMessageUnreadCounts = cache(async (userId: string): Promise<Map<string, number>> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("transaction_messages")
    .select("transaction_id")
    .neq("sender_id", userId)
    .is("read_at", null)
    .limit(500);
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ transaction_id: string }>) {
    counts.set(row.transaction_id, (counts.get(row.transaction_id) ?? 0) + 1);
  }
  return counts;
});

export const getProfileByUsername = cache(async (username: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select(
      `id, username, display_name, avatar_path, bio, location, rating_sum,
       rating_count, sales_count, purchases_count, email_verified, created_at`
    )
    .eq("username", username)
    .maybeSingle();
  if (!data) return null;

  const [{ data: reviews }, { data: listings }] = await Promise.all([
    supabase
      .from("reviews")
      .select(
        `id, rating, comment, created_at,
         reviewer:profiles!reviews_reviewer_id_fkey(username, display_name),
         auctions:auction_id(title)`
      )
      .eq("reviewee_id", data.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("auctions")
      .select(CARD_SELECT)
      .eq("seller_id", data.id)
      .neq("status", "DRAFT")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  return {
    profile: data,
    reviews: reviews ?? [],
    listings: (listings ?? []).map(toCard),
  };
});

// ---------------------------------------------------------------------------
// Seller - own payout status
// ---------------------------------------------------------------------------

export type SellerPayoutView = {
  transaction_id: string;
  status: SellerPayoutStatus;
  amount_minor: number;
  currency: string;
  delivery_confirmed_at: string | null;
  paid_at: string | null;
  updated_at: string;
};

/**
 * The caller's own seller payouts, and nothing else.
 *
 * This goes through the `my_seller_payouts()` function rather than a table
 * select on purpose: the table has no seller-facing RLS policy precisely so a
 * seller can never read another payout, an internal note, or the payout
 * reference of their own record through a direct PostgREST call.
 */
export const getMySellerPayouts = cache(async (): Promise<SellerPayoutView[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_seller_payouts");
  if (error || !Array.isArray(data)) return [];
  return data as unknown as SellerPayoutView[];
});

export { toCard };

// ---------------------------------------------------------------------------
// Admin - payout operations
// ---------------------------------------------------------------------------

export type AdminPayoutRow = {
  payoutId: string;
  status: SellerPayoutStatus;
  amountMinor: number;
  currency: string;
  payoutReference: string | null;
  paidAt: string | null;
  deliveryConfirmedAt: string | null;
  internalNote: string | null;
  payoutCreatedAt: string;
  payoutUpdatedAt: string;
  transactionId: string;
  transactionStatus: TransactionStatus;
  grossMinor: number;
  feeBps: number;
  feeMinor: number;
  netMinor: number;
  recordedAt: string;
  auctionId: string;
  auctionTitle: string;
  sellerId: string;
  sellerName: string;
  buyerId: string;
  buyerName: string;
  /**
   * Whether a Linkwa payout recipient is on file for this seller. Boolean
   * only: the external ids themselves never leave the server.
   */
  recipientOnFile: boolean;
};

/**
 * The payout queue, for administrators only.
 *
 * Runs on the caller's session, so RLS decides who sees anything: transactions
 * are readable by their parties plus admins, `seller_payouts` has an
 * admin-only SELECT policy, and there is no write path here at all. Auction
 * and profile names are read separately rather than nested, because the
 * answer is a flat row for a table and a second round trip keeps the shape
 * obvious.
 */
export const getAdminPayouts = cache(async (): Promise<AdminPayoutRow[]> => {
  const supabase = await createClient();

  const { data: payouts, error } = await supabase
    .from("seller_payouts")
    .select(
      `id, transaction_id, seller_id, amount_minor, currency, status,
       payout_reference, paid_at, delivery_confirmed_at, internal_note,
       created_at, updated_at,
       transactions:transaction_id(id, auction_id, buyer_id, gross_minor,
         fee_bps, fee_minor, net_minor, currency, status, created_at)`
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error || !payouts?.length) return [];

  type PayoutWithTx = (typeof payouts)[number];
  const tx = (p: PayoutWithTx) =>
    p.transactions as unknown as {
      id: string;
      auction_id: string;
      buyer_id: string;
      gross_minor: number;
      fee_bps: number;
      fee_minor: number;
      net_minor: number;
      currency: string;
      status: TransactionStatus;
      created_at: string;
    };

  const auctionIds = [...new Set(payouts.map((p) => tx(p).auction_id))];
  const profileIds = [
    ...new Set(payouts.flatMap((p) => [p.seller_id, tx(p).buyer_id])),
  ];

  const [auctionsRes, profilesRes, recipientsRes] = await Promise.all([
    supabase.from("auctions").select("id, title").in("id", auctionIds),
    supabase
      .from("profiles")
      .select("id, username, display_name")
      .in("id", profileIds),
    // Boolean flag only: the ids stay server-side and are never rendered.
    supabase
      .from("seller_payout_recipients")
      .select("seller_id")
      .in("seller_id", [...new Set(payouts.map((p) => p.seller_id))]),
  ]);
  const recipientsOnFile = new Set(
    (recipientsRes.data ?? []).map((r) => r.seller_id as string)
  );

  const titleById = new Map(
    (auctionsRes.data ?? []).map((a) => [a.id as string, a.title as string])
  );
  const nameById = new Map(
    (profilesRes.data ?? []).map((p) => [
      p.id as string,
      (p.display_name as string) || (p.username as string),
    ])
  );

  return payouts.map((p) => {
    const t = tx(p);
    return {
      payoutId: p.id,
      status: p.status as SellerPayoutStatus,
      amountMinor: Number(p.amount_minor),
      currency: p.currency,
      payoutReference: p.payout_reference,
      paidAt: p.paid_at,
      deliveryConfirmedAt: p.delivery_confirmed_at,
      internalNote: p.internal_note,
      payoutCreatedAt: p.created_at,
      payoutUpdatedAt: p.updated_at,
      transactionId: p.transaction_id,
      transactionStatus: t.status,
      grossMinor: Number(t.gross_minor),
      feeBps: t.fee_bps,
      feeMinor: Number(t.fee_minor),
      netMinor: Number(t.net_minor),
      recordedAt: t.created_at,
      auctionId: t.auction_id,
      auctionTitle: titleById.get(t.auction_id) ?? "Auction",
      sellerId: p.seller_id,
      sellerName: nameById.get(p.seller_id) ?? "Seller",
      buyerId: t.buyer_id,
      buyerName: nameById.get(t.buyer_id) ?? "Buyer",
      recipientOnFile: recipientsOnFile.has(p.seller_id),
    };
  });
});
