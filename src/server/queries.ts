import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sweepDueAuctions } from "@/server/sweep";
import type { Database } from "@/lib/supabase/types";

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
  if (/^https?:\/\//.test(path)) return path;
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

  const [live, ending, recent, categories] = await Promise.all([
    supabase
      .from("auctions")
      .select(CARD_SELECT)
      .eq("status", "LIVE")
      .order("ends_at", { ascending: true })
      .limit(12),
    supabase
      .from("auctions")
      .select(CARD_SELECT)
      .eq("status", "LIVE")
      .order("ends_at", { ascending: true })
      .limit(8),
    supabase
      .from("auctions")
      .select(CARD_SELECT)
      .neq("status", "DRAFT")
      .order("created_at", { ascending: false })
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
    .neq("status", "CANCELLED");

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
         id, username, display_name, avatar_url, bio, location,
         rating_sum, rating_count, sales_count, purchases_count,
         email_verified, created_at
       )`
    )
    .eq("id", id)
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

export const getWatchlist = cache(async (userId: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("watchlist")
    .select(
      `created_at,
       auctions:auction_id(${CARD_SELECT})`
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return (data ?? [])
    .map((row) => {
      const auction = row.auctions as unknown as CardJoin | null;
      return auction ? toCard(auction) : null;
    })
    .filter(Boolean) as AuctionCardData[];
});

export const getNotifications = cache(async (userId: string) => {
  const supabase = await createClient();
  const [list, unread] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, type, payload, read_at, created_at, auction_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null),
  ]);

  return { items: list.data ?? [], unreadCount: unread.count ?? 0 };
});

export const getUnreadCount = async (userId: string): Promise<number> => {
  const admin = createAdminClient();
  const { count } = await admin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  return count ?? 0;
};

/** Buyer view: auctions I bid on. */
export const getBuying = cache(async (userId: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bids")
    .select(
      `auction_id, amount_minor, created_at,
       auctions:auction_id(${CARD_SELECT}, winner_id, status, current_bidder_id, current_bid_minor)`
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
    };
    if (!a) continue;
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
    .order("created_at", { ascending: false });

  return (data ?? []) as unknown as Array<
    AuctionCardData & {
      winner_id: string | null;
      winning_bid_minor: number | null;
      seller_id: string;
      created_at: string;
      transactions: Array<{
        id: string;
        status: string;
        gross_minor: number;
        fee_minor: number;
        net_minor: number;
        currency: string;
      }>;
    }
  >;
});

export const getTransactions = cache(async (userId: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("transactions")
    .select(
      `id, auction_id, seller_id, buyer_id, currency, gross_minor, fee_bps,
       fee_minor, net_minor, status, provider, created_at,
       auctions:auction_id(title)`
    )
    .or(`seller_id.eq.${userId},buyer_id.eq.${userId}`)
    .order("created_at", { ascending: false });

  return (data ?? []) as unknown as Array<{
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
    created_at: string;
    auctions: { title: string } | null;
  }>;
});

export const getProfileByUsername = cache(async (username: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select(
      `id, username, display_name, avatar_url, bio, location, rating_sum,
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
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  return {
    profile: data,
    reviews: reviews ?? [],
    listings: (listings ?? []).map(toCard),
  };
});

export { toCard };
