import "server-only";
import { createClient } from "@/lib/supabase/server";

export type MaxBidOffer = {
  id: string; auction_id: string; buyer_id: string; seller_id: string;
  amount_minor: number; currency: string; status: string; created_at: string;
  transaction_id: string | null;
};

export async function getMaxBidOffers(auctionId?: string): Promise<MaxBidOffer[]> {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return [];
  let query = db.from("max_bid_offers").select("id,auction_id,buyer_id,seller_id,amount_minor,currency,status,created_at,transaction_id")
    .order("created_at", { ascending: false }).limit(50);
  if (auctionId) query = query.eq("auction_id", auctionId);
  else query = query.eq("seller_id", user.id).eq("status", "PENDING");
  const { data, error } = await query;
  if (error) throw new Error("Max Bid offers could not be loaded. Please refresh.");
  return (data ?? []) as MaxBidOffer[];
}
