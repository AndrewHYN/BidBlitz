"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/server/permissions";

const requestSchema = z.object({
  auctionId: z.string().uuid("Invalid auction"),
  days: z.union([z.literal(3), z.literal(7)]),
});

const decisionSchema = z.object({
  requestId: z.string().uuid("Invalid promotion request"),
  approve: z.boolean(),
  note: z.string().trim().max(1000, "Keep the note under 1000 characters.").optional(),
});

export async function requestPromotionAction(
  input: unknown
): Promise<{ ok: true; status: string } | { ok: false; message: string }> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in first." };

  const { data, error } = await supabase.rpc("request_auction_promotion", {
    p_auction_id: parsed.data.auctionId,
    p_days: parsed.data.days,
  });

  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("already_promoted")) return { ok: false, message: "This auction is already promoted." };
    if (m.includes("already_requested")) return { ok: false, message: "A promotion request is already waiting for review." };
    if (m.includes("invalid_state")) return { ok: false, message: "Only live or scheduled auctions can be promoted." };
    if (m.includes("not_owner")) return { ok: false, message: "You can only promote your own auction." };
    return { ok: false, message: "We could not request promotion. Reload and try again." };
  }

  revalidatePath(`/sell/${parsed.data.auctionId}`);
  revalidatePath("/admin");
  return { ok: true, status: (data as { status?: string } | null)?.status ?? "PENDING" };
}

export async function decidePromotionAction(
  input: unknown
): Promise<{ ok: true; status: string } | { ok: false; message: string }> {
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid decision." };
  }

  const permission = await requirePermission("settings.manage_marketplace");
  if (!permission.ok) return permission;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_decide_promotion", {
    p_request_id: parsed.data.requestId,
    p_approve: parsed.data.approve,
    p_note: parsed.data.note || null,
  });

  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("invalid_state")) return { ok: false, message: "That promotion request was already decided." };
    if (m.includes("auction_not_promotable")) return { ok: false, message: "That auction is no longer live or scheduled." };
    if (m.includes("not_admin")) return { ok: false, message: "You do not have permission to manage promotions." };
    return { ok: false, message: "That promotion decision was refused. Reload and try again." };
  }

  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath("/browse");
  return { ok: true, status: (data as { status?: string } | null)?.status ?? "" };
}
