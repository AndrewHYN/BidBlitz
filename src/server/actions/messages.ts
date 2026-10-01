"use server";

/**
 * Post-win transaction threads. Exactly the two parties of one transaction
 * can read and write; everyone else — including other signed-in users —
 * gets zero rows and a generic "not available" page, never a distinction
 * between "no such thread" and "not yours".
 *
 * State commits first, alerts second: the message row is the commit point.
 * The in-app notification and the email are best-effort afterwards and can
 * never fail the send (they also degrade cleanly when the messaging
 * migration has not been applied yet — the notification CHECK would reject
 * NEW_MESSAGE, the message itself still lands).
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { messageSchema } from "@/lib/validation";
import { normalizeEngineError, type BidRejection } from "@/server/errors";
import { MESSAGE_LIMIT, rateLimit } from "@/server/rate-limit";
import { emailKey, queueEmail } from "@/server/email/sender";
import { createServerRealtime } from "@/lib/realtime/supabase";

export type MessageResult = { ok: true } | { ok: false; rejection: BidRejection };

type ThreadTx = {
  id: string;
  auction_id: string;
  seller_id: string;
  buyer_id: string;
  title: string;
};

/** The sale both parties share, or null when it does not exist / is not theirs. */
async function partyTransaction(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  transactionId: string
): Promise<ThreadTx | null> {
  const { data, error } = await supabase
    .from("transactions")
    .select("id, auction_id, seller_id, buyer_id, auctions:auction_id(title)")
    .eq("id", transactionId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as {
    id: string;
    auction_id: string;
    seller_id: string;
    buyer_id: string;
    auctions: { title: string } | null;
  };
  if (row.seller_id !== userId && row.buyer_id !== userId) return null;
  return { ...row, title: row.auctions?.title ?? "your sale" };
}

/**
 * Alert the other party. Best-effort by construction: resolves nothing that
 * the message send depends on, throws nothing into it. A missed alert is a
 * missed alert, not a lost message.
 */
async function alertCounterparty(tx: ThreadTx, senderId: string): Promise<void> {
  try {
    const recipientId = tx.seller_id === senderId ? tx.buyer_id : tx.seller_id;
    const admin = createAdminClient();
    await admin.from("notifications").insert({
      user_id: recipientId,
      type: "NEW_MESSAGE",
      auction_id: tx.auction_id,
      payload: { title: tx.title, transactionId: tx.id },
    });
    // Realtime is the urgent channel (a notification, never authority): the
    // recipient's open thread refreshes from the server on receipt.
    const rt = createServerRealtime(admin);
    await rt.publishToUser(recipientId, tx.auction_id, {
      type: "message.received",
      auctionId: tx.auction_id,
      transactionId: tx.id,
      senderId,
      serverTime: new Date().toISOString(),
    });
    const { data } = await admin.auth.admin.getUserById(recipientId);
    const email = data?.user?.email ?? null;
    if (!email) return;
    const { data: profile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", senderId)
      .maybeSingle();
    const senderName =
      (profile as { display_name?: string } | null)?.display_name ?? "The other party";
    await queueEmail({
      to: email,
      template: "new_message",
      data: { name: email.split("@")[0], title: tx.title, senderName, transactionId: tx.id },
      idempotencyKey: `${emailKey("new_message", tx.id)}:${Date.now()}`,
    });
  } catch {
    // Alerts never fail sends.
  }
}

export async function sendMessageAction(input: unknown): Promise<MessageResult> {
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      rejection: {
        code: "invalid_input",
        message: parsed.error.issues[0]?.message ?? "Invalid message.",
      },
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, rejection: { code: "not_authenticated", message: "Sign in to message." } };
  }

  // Per-sender budget: one abusive account cannot spend another's, and a
  // real delivery arrangement (a handful of messages) never notices it.
  const budget = rateLimit(`message:${user.id}`, MESSAGE_LIMIT.limit, MESSAGE_LIMIT.windowMs);
  if (!budget.allowed) {
    return {
      ok: false,
      rejection: {
        code: "rate_limited",
        message: "You are sending messages too quickly. Wait a minute and try again.",
      },
    };
  }

  const tx = await partyTransaction(supabase, user.id, parsed.data.transactionId);
  if (!tx) {
    return {
      ok: false,
      rejection: { code: "not_owner", message: "This conversation is not available." },
    };
  }

  // Banned accounts keep reading (cutting them off mid-sale punishes the
  // counterparty) but cannot write. RLS stays parties-only either way.
  const { data: self } = await supabase
    .from("profiles")
    .select("is_banned")
    .eq("id", user.id)
    .maybeSingle();
  if ((self as { is_banned?: boolean } | null)?.is_banned) {
    return {
      ok: false,
      rejection: { code: "not_authenticated", message: "Your account cannot send messages." },
    };
  }

  const { error } = await supabase.from("transaction_messages").insert({
    transaction_id: tx.id,
    sender_id: user.id,
    body: parsed.data.body,
  });
  if (error) return { ok: false, rejection: normalizeEngineError({ message: error.message }) };

  await alertCounterparty(tx, user.id);

  revalidatePath(`/dashboard/transactions/${tx.id}`);
  revalidatePath("/dashboard/transactions");
  revalidatePath("/notifications");
  return { ok: true };
}

export async function markThreadReadAction(input: unknown): Promise<MessageResult> {
  const parsed = messageSchema
    .pick({ transactionId: true })
    .safeParse(typeof input === "object" && input !== null ? input : {});
  if (!parsed.success) {
    return { ok: false, rejection: { code: "invalid_input", message: "Invalid transaction." } };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, rejection: { code: "not_authenticated", message: "Sign in." } };
  }

  // RLS admits only the recipient's rows; the trigger admits only read_at
  // changes. A forged transaction id updates zero rows — still { ok: true },
  // so failure and non-membership are indistinguishable.
  const { error } = await supabase
    .from("transaction_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("transaction_id", parsed.data.transactionId)
    .neq("sender_id", user.id)
    .is("read_at", null);
  if (error) return { ok: false, rejection: normalizeEngineError({ message: error.message }) };

  revalidatePath(`/dashboard/transactions/${parsed.data.transactionId}`);
  return { ok: true };
}
