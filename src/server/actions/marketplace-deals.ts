"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { notifyListingChatRecipient } from "@/server/email/notify";

type DealError = { ok: false; message: string };
type DealSuccess = { ok: true; conversationId?: string; status?: string };
export type DealResult = DealError | DealSuccess;

async function signedIn() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}
function failure(message?: string): DealError {
  if (message === "chat_closed") return { ok: false, message: "Someone left this chat. They must rejoin before you can start a new offer or request." };
  if (message?.includes("rate_limited")) return { ok: false, message: "Too many requests. Try again later." };
  if (message?.includes("already") || message?.includes("duplicate")) return { ok: false, message: "This request has already been decided." };
  return { ok: false, message: "This action is not available. Check the listing status and try again." };
}
function refresh() {
  revalidatePath("/messages");
  revalidatePath("/browse");
  revalidatePath("/dashboard/selling");
}

/** A deal RPC writes a chat message itself; mirror normal chat email alerts.
 * Resolve the recipient from the DB row, never from the browser payload.
 * Email is best-effort and must not undo a committed offer or hire request. */
async function alertDealRecipient(
  supabase: Awaited<ReturnType<typeof createClient>>,
  listingId: string,
  conversationId: string | null | undefined,
  recipientId: string | null | undefined,
) {
  if (!conversationId || !recipientId) return;
  try {
    const { data } = await supabase.from("auctions").select("title").eq("id", listingId).maybeSingle();
    await notifyListingChatRecipient(recipientId, data?.title ?? "your listing", conversationId);
  } catch {
    // In-app notifications are already created by the database trigger.
  }
}

const offerInput = z.object({
  listingId: z.uuid(),
  amountMinor: z.number().int().min(100).max(999999999999999),
});
/**
 * Seller-only RPC: a reservation is a reversible handover plan, not payment.
 * The browser never supplies the buyer ID; the RPC verifies the conversation.
 */
export async function setListingPickupAction(input: unknown): Promise<DealResult> {
  const parsed = z.object({ listingId: z.uuid(), conversationId: z.uuid().nullable() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid pickup request." };
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, message: "Sign in to manage pickup." };
  const { data, error } = await supabase.rpc("set_listing_pickup", {
    p_listing_id: parsed.data.listingId, p_conversation_id: parsed.data.conversationId,
  });
  if (error) {
    if (error.message.includes("already_reserved")) return { ok: false, message: "Pickup is already pending with another buyer. Release that reservation before choosing someone else." };
    return { ok: false, message: "Could not change the pickup arrangement. Check that the listing and chat are still active." };
  }
  refresh();
  revalidatePath(`/listing/${parsed.data.listingId}`);
  if (parsed.data.conversationId) revalidatePath(`/messages/${parsed.data.conversationId}`);
  return { ok: true, status: data };
}

export async function makeListingOfferAction(input: unknown): Promise<DealResult> {
  const parsed = offerInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter a valid offer of at least US$1." };
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, message: "Sign in to make an offer." };
  const { data, error } = await supabase.rpc("make_listing_offer", {
    p_listing_id: parsed.data.listingId,
    p_amount_minor: parsed.data.amountMinor,
  });
  if (error || !data) return failure(error?.message);
  const { data: offer } = await supabase.from("listing_offers")
    .select("conversation_id,seller_id").eq("id", data).single();
  refresh();
  await alertDealRecipient(supabase, parsed.data.listingId, offer?.conversation_id, offer?.seller_id);
  return { ok: true, conversationId: offer?.conversation_id };
}

export async function respondListingOfferAction(input: unknown): Promise<DealResult> {
  const parsed = z.object({ offerId: z.uuid(), accept: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid offer." };
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, message: "Sign in to respond." };
  const { data, error } = await supabase.rpc("respond_listing_offer", {
    p_offer_id: parsed.data.offerId, p_accept: parsed.data.accept,
  });
  if (error) return failure(error.message);
  const { data: offer } = await supabase.from("listing_offers")
    .select("conversation_id,buyer_id,listing_id").eq("id", parsed.data.offerId).maybeSingle();
  refresh();
  if (offer) await alertDealRecipient(supabase, offer.listing_id, offer.conversation_id, offer.buyer_id);
  return { ok: true, status: data };
}

export async function requestServiceHireAction(input: unknown): Promise<DealResult> {
  const parsed = z.object({
    listingId: z.uuid(),
    details: z.string().trim().min(10).max(2000),
  }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Explain what you need in 10 to 2,000 characters." };
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, message: "Sign in to request a service." };
  const { data, error } = await supabase.rpc("request_service_hire", {
    p_listing_id: parsed.data.listingId, p_details: parsed.data.details,
  });
  if (error || !data) return failure(error?.message);
  const { data: request } = await supabase.from("service_requests")
    .select("conversation_id,provider_id").eq("id", data).single();
  refresh();
  await alertDealRecipient(supabase, parsed.data.listingId, request?.conversation_id, request?.provider_id);
  return { ok: true, conversationId: request?.conversation_id };
}

export async function respondServiceHireAction(input: unknown): Promise<DealResult> {
  const parsed = z.object({
    requestId: z.uuid(),
    action: z.enum(["ACCEPT","DECLINE","DELIVER","CONFIRM","CANCEL"]),
  }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid service action." };
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, message: "Sign in first." };
  const { data, error } = await supabase.rpc("respond_service_hire", {
    p_request_id: parsed.data.requestId, p_action: parsed.data.action,
  });
  if (error) return failure(error.message);
  const { data: request } = await supabase.from("service_requests")
    .select("conversation_id,listing_id,client_id,provider_id").eq("id", parsed.data.requestId).maybeSingle();
  refresh();
  if (request) {
    await alertDealRecipient(supabase, request.listing_id, request.conversation_id,
      request.provider_id === user.id ? request.client_id : request.provider_id);
  }
  return { ok: true, status: data };
}

export async function reviewCompletedServiceAction(input: unknown): Promise<DealResult> {
  const parsed = z.object({
    requestId: z.uuid(),
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(1000),
  }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Use 1–5 stars and up to 1,000 characters." };
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, message: "Sign in first." };
  const { error } = await supabase.rpc("review_completed_service", {
    p_request_id: parsed.data.requestId,
    p_rating: parsed.data.rating,
    p_comment: parsed.data.comment,
  });
  if (error) return failure(error.message);
  refresh();
  return { ok: true, status: "REVIEWED" };
}
