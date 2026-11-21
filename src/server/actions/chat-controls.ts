"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { reportAction } from "./social";

const actions = z.enum(["read", "unread", "pin", "unpin", "mute", "unmute", "archive", "unarchive", "delete", "leave", "rejoin"]);
export type ChatAction = z.infer<typeof actions>;

export async function updateChat(id: string, action: ChatAction) {
  if (!z.uuid().safeParse(id).success || !actions.safeParse(action).success) return "Invalid chat action.";
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return "Sign in to manage your messages.";
  const { error } = await db.rpc("set_listing_chat_action", { p_conversation_id: id, p_action: action });
  if (error) return "Couldn’t update this chat. Refresh and try again.";
  revalidatePath("/messages");
  revalidatePath(`/messages/${id}`);
  revalidatePath("/notifications");
  return null;
}

export async function reportChat(id: string, reason: string) {
  if (!z.uuid().safeParse(id).success || !z.string().trim().min(5).max(900).safeParse(reason).success)
    return "Tell us what happened in 5 to 900 characters.";
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return "Sign in to report a chat.";
  const { data: thread } = await db.from("listing_conversations").select("seller_id,buyer_id").eq("id", id).maybeSingle();
  if (!thread || ![thread.seller_id, thread.buyer_id].includes(user.id)) return "Conversation unavailable.";
  const result = await reportAction({ targetType: "user", targetId: thread.seller_id === user.id ? thread.buyer_id : thread.seller_id,
    reason: `Conversation ${id}\n${reason.trim()}` });
  return result.ok ? null : result.rejection.message;
}
