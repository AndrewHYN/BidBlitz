import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(_request: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params;
  const headers = { "Cache-Control": "private, no-store" };
  const missing = () => new Response(null, { status: 404, headers });
  if (!z.uuid().safeParse(messageId).success) return missing();

  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return missing();
  const { data: message } = await db.from("listing_messages").select("conversation_id,attachment_kind")
    .eq("id", messageId).maybeSingle();
  if (!message?.attachment_kind) return missing();
  const { data: thread } = await db.from("listing_conversations").select("buyer_id,seller_id")
    .eq("id", message.conversation_id).maybeSingle();
  if (!thread || ![thread.buyer_id, thread.seller_id].includes(user.id)) return missing();

  const { data } = await createAdminClient().storage.from("listing-chat-media")
    .createSignedUrl(`${message.conversation_id}/${messageId}`, 120);
  return data ? new Response(null, { status: 307, headers: { ...headers, Location: data.signedUrl } }) : missing();
}
