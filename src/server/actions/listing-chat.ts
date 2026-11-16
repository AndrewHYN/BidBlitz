"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { notifyListingChatRecipient } from "@/server/email/notify";

const conversationInput = z.object({
  listingId: z.uuid(),
  body: z.string().trim().min(1, "Write a message.").max(2000),
});
const sendInput = z.object({
  conversationId: z.uuid(),
  body: z.string().trim().min(1, "Write a message.").max(2000),
});

export type ListingChatResult =
  | { ok: true; conversationId: string }
  | { ok: false; message: string };

function chatError(code?: string): string {
  if (code === "rate_limited") return "Too many messages. Please try again later.";
  if (code === "account_banned") return "This account cannot send messages.";
  if (code === "invalid_message") return "Messages must be between 1 and 2,000 characters.";
  if (code === "listing_unavailable") return "This item is no longer available to message.";
  return "Messaging is unavailable right now. Please try again.";
}

async function alertOtherParticipant(
  supabase: Awaited<ReturnType<typeof createClient>>,
  conversationId: string,
  senderId: string
): Promise<void> {
  try {
    // The DB RPC controls who can send; this read only discovers the actual
    // counterparty, never accepting a recipient from a browser payload.
    const { data: thread } = await supabase
      .from("listing_conversations")
      .select("listing_id, buyer_id, seller_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (!thread) return;
    const recipientId =
      thread.buyer_id === senderId ? thread.seller_id :
      thread.seller_id === senderId ? thread.buyer_id : null;
    if (!recipientId) return;
    const { data: listing } = await supabase
      .from("auctions")
      .select("title")
      .eq("id", thread.listing_id)
      .maybeSingle();
    await notifyListingChatRecipient(recipientId, listing?.title ?? "your listing", conversationId);
  } catch {
    // The message is committed before notifications; an alert cannot undo it.
  }
}

export async function startListingChatAction(input: unknown): Promise<ListingChatResult> {
  const parsed = conversationInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose an item and write a message (maximum 2,000 characters)." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to message a seller." };

  const { data, error } = await supabase.rpc("start_listing_conversation", {
    p_listing_id: parsed.data.listingId,
    p_body: parsed.data.body,
  });
  if (error || !data) return { ok: false, message: chatError(error?.message) };
  revalidatePath("/messages");
  revalidatePath(`/messages/${data}`);
  await alertOtherParticipant(supabase, data, user.id);
  return { ok: true, conversationId: data };
}

export async function sendListingChatAction(input: unknown): Promise<ListingChatResult> {
  const parsed = sendInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Write a message of 2,000 characters or fewer." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to send a message." };

  const { error } = await supabase.rpc("send_listing_message", {
    p_conversation_id: parsed.data.conversationId,
    p_body: parsed.data.body,
  });
  if (error) return { ok: false, message: chatError(error.message) };
  revalidatePath("/messages");
  revalidatePath(`/messages/${parsed.data.conversationId}`);
  await alertOtherParticipant(supabase, parsed.data.conversationId, user.id);
  return { ok: true, conversationId: parsed.data.conversationId };
}

export async function markListingChatReadAction(conversationId: string): Promise<void> {
  if (!z.uuid().safeParse(conversationId).success) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.rpc("mark_listing_conversation_read", {
    p_conversation_id: conversationId,
  });
  if (!error) revalidatePath("/messages");
}
