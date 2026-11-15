"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

type DealError = { ok: false; message: string };
type DealSuccess = { ok: true; conversationId?: string; status?: string };
export type DealResult = DealError | DealSuccess;

async function signedIn() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}
function failure(message?: string): DealError {
  if (message?.includes("rate_limited")) return { ok: false, message: "Too many requests. Try again later." };
  if (message?.includes("already") || message?.includes("duplicate")) return { ok: false, message: "This request has already been decided." };
  return { ok: false, message: "This action is not available. Check the listing status and try again." };
}
function refresh() {
  revalidatePath("/messages");
  revalidatePath("/browse");
  revalidatePath("/dashboard/selling");
}

const offerInput = z.object({
  listingId: z.uuid(),
  amountMinor: z.number().int().min(100).max(999999999999999),
});
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
    .select("conversation_id").eq("id", data).single();
  refresh();
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
  refresh();
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
    .select("conversation_id").eq("id", data).single();
  refresh();
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
  refresh();
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
