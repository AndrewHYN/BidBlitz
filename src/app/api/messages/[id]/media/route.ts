import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CHAT_MEDIA_LIMIT, chatMediaType } from "@/lib/chat-media";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyListingChatRecipient } from "@/server/email/notify";

function reply(message: string, status: number) {
  return Response.json({ message }, { status });
}

function matchesFormat(bytes: Buffer, mime: string) {
  const has = (signature: string, offset = 0) => bytes.subarray(offset, offset + signature.length).toString("latin1") === signature;
  switch (mime) {
    case "image/jpeg": return has("\xff\xd8\xff");
    case "image/png": return has("\x89PNG\r\n\x1a\n");
    case "image/webp": return has("RIFF") && has("WEBP", 8);
    case "audio/webm": return has("\x1a\x45\xdf\xa3");
    case "audio/ogg": return has("OggS");
    case "audio/mp4": return has("ftyp", 4);
    case "audio/mpeg": return has("ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    case "audio/wav": return has("RIFF") && has("WAVE", 8);
    default: return false;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const origin = request.headers.get("origin");
  // Next may build request.url with an internal hostname behind its proxy.
  const originUrl = origin ? URL.parse(origin) : null;
  if (!originUrl || originUrl.host !== request.headers.get("host")
      || !["https:", "http:"].includes(originUrl.protocol)) {
    return reply("Request unavailable.", 403);
  }
  if (!z.uuid().safeParse(id).success) return reply("Conversation unavailable.", 404);
  const media = chatMediaType(request.headers.get("content-type") ?? "");
  if (!media || !request.body) return reply("Choose a supported photo or audio file.", 415);
  if (Number(request.headers.get("content-length")) > CHAT_MEDIA_LIMIT) return reply("Choose a file under 3 MB.", 413);

  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return reply("Sign in to send attachments.", 401);
  const { data: thread } = await db.from("listing_conversations")
    .select("listing_id,buyer_id,seller_id,left_by").eq("id", id).maybeSingle();
  if (!thread || ![thread.buyer_id, thread.seller_id].includes(user.id)) return reply("Conversation unavailable.", 404);

  const retryKey = request.headers.get("idempotency-key");
  if (retryKey !== null && !z.uuidv4().safeParse(retryKey).success) return reply("Invalid upload reference.", 400);
  const messageId = retryKey ?? randomUUID();
  const findSent = () => db.from("listing_messages").select("id")
    .eq("id", messageId).eq("conversation_id", id).eq("sender_id", user.id)
    .eq("attachment_kind", media.kind).maybeSingle();
  if (retryKey) {
    const existing = await findSent();
    if (existing.data) return Response.json({ ok: true });
    if (existing.error) return reply("Couldn’t check delivery. Try again.", 503);
  }

  if (thread.left_by) return reply("Someone left this chat. Attachments are paused.", 409);
  const admin = createAdminClient();
  const { error: reservation } = await admin.rpc("reserve_listing_chat_upload", {
    p_conversation_id: id, p_sender_id: user.id,
  });
  if (reservation) {
    if (reservation.message === "rate_limited") return reply("Too many attachments. Try again later.", 429);
    return reply("Attachments are unavailable right now.", 403);
  }

  let length = 0;
  const chunks: Uint8Array[] = [];
  const reader = request.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > CHAT_MEDIA_LIMIT) {
        await reader.cancel();
        return reply("Choose a file under 3 MB.", 413);
      }
      chunks.push(value);
    }
  } catch {
    return reply("The upload was interrupted. Try again.", 400);
  }
  const bytes = Buffer.concat(chunks, length);
  if (!matchesFormat(bytes, media.mime)) return reply("The file doesn’t match its format.", 415);

  const path = `${id}/${messageId}`;
  const bucket = admin.storage.from("listing-chat-media");
  const { error: upload } = await bucket.upload(path, bytes, { contentType: media.mime, upsert: false });
  if (upload) {
    if (retryKey && (await findSent()).data) return Response.json({ ok: true });
    return reply("Couldn’t upload the attachment. Try again.", 502);
  }
  const { error: send } = await admin.rpc("send_listing_chat_attachment", {
    p_conversation_id: id, p_sender_id: user.id, p_message_id: messageId, p_kind: media.kind,
  });
  if (send) {
    // A transport error can occur after the database commits. Preserve the
    // object unless a follow-up read confirms no message references it.
    const result = await findSent();
    if (result.error) return reply("Couldn’t confirm delivery. Check the conversation before resending.", 502);
    if (!result.data) {
      await bucket.remove([path]);
      if (send.message === "chat_closed") return reply("Someone left this chat. Attachments are paused.", 409);
      return send.message === "rate_limited"
        ? reply("Too many messages. Try again later.", 429)
        : reply("Couldn’t send the attachment. Try again.", 502);
    }
  }
  revalidatePath("/messages");
  revalidatePath(`/messages/${id}`);
  after(async () => {
    const { data: listing } = await db.from("auctions").select("title").eq("id", thread.listing_id).maybeSingle();
    const recipient = thread.buyer_id === user.id ? thread.seller_id : thread.buyer_id;
    await notifyListingChatRecipient(recipient, listing?.title ?? "your listing", id).catch(() => {});
  });
  return Response.json({ ok: true });
}
