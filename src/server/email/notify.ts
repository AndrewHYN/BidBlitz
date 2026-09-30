import "server-only";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";
import { emailKey, queueEmail } from "./sender";

/**
 * One-liner fan-out for marketplace events. Every function here is
 * best-effort by construction: it resolves recipients from authoritative
 * rows, enqueues with a deterministic key, and never throws into the
 * marketplace action that called it. A missed email is a missing email, not
 * a rolled-back bid.
 */

async function userContact(userId: string): Promise<{ email: string; name: string } | null> {
  try {
    if (!hasAdminCredentials()) return null;
    const admin = createAdminClient();
    const { data } = await admin.auth.admin.getUserById(userId);
    const email = data?.user?.email ?? null;
    if (!email) return null;
    const { data: profile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    return {
      email,
      name: (profile as { display_name?: string } | null)?.display_name ?? email.split("@")[0],
    };
  } catch {
    return null;
  }
}

async function adminContacts(): Promise<Array<{ email: string; name: string }>> {
  try {
    if (!hasAdminCredentials()) return [];
    const admin = createAdminClient();
    const { data } = await admin
      .from("staff_assignments")
      .select("user_id")
      .eq("status", "ACTIVE");
    const ids = [...new Set(((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id))];
    const out: Array<{ email: string; name: string }> = [];
    for (const id of ids.slice(0, 10)) {
      const contact = await userContact(id);
      if (contact) out.push(contact);
    }
    return out;
  } catch {
    return [];
  }
}

async function distinctBidderIds(auctionId: string): Promise<string[]> {
  try {
    if (!hasAdminCredentials()) return [];
    const admin = createAdminClient();
    const { data } = await admin.from("bids").select("bidder_id").eq("auction_id", auctionId);
    return [...new Set(((data ?? []) as Array<{ bidder_id: string }>).map((r) => r.bidder_id))];
  } catch {
    return [];
  }
}

/** The seller of an auction, for events the seller must hear about. */
export async function notifySeller(
  sellerId: string,
  template: string,
  data: Record<string, string>,
  key: string
): Promise<void> {
  const contact = await userContact(sellerId);
  if (!contact) return;
  await queueEmail({
    to: contact.email,
    template,
    data: { ...data, name: contact.name },
    idempotencyKey: key,
  });
}

/** Every distinct bidder plus the seller: the audience of a paused/resumed/cancelled auction. */
export async function notifyAuctionAudience(
  auctionId: string,
  sellerId: string,
  template: string,
  data: Record<string, string>,
  keyPrefix: string,
  opts?: { excludeSeller?: boolean }
): Promise<void> {
  const ids = await distinctBidderIds(auctionId);
  const audience = opts?.excludeSeller ? ids : [...new Set([sellerId, ...ids])];
  for (const id of audience) {
    const contact = await userContact(id);
    if (!contact) continue;
    await queueEmail({
      to: contact.email,
      template,
      data: {
        ...data,
        name: contact.name,
        isSeller: id === sellerId ? "true" : "false",
      },
      idempotencyKey: emailKey(keyPrefix, auctionId, id),
    });
  }
}

/** All active staff: the audience of inbound admin work. */
export async function notifyAdmins(
  template: string,
  data: Record<string, string>,
  key: string
): Promise<void> {
  for (const contact of await adminContacts()) {
    await queueEmail({
      to: contact.email,
      template,
      data: { ...data, name: contact.name },
      idempotencyKey: `${key}:${contact.email}`,
    });
  }
}

/** One user, resolved by id (ban/unban, wins, payments). */
export async function notifyUser(
  userId: string,
  template: string,
  data: Record<string, string>,
  key: string
): Promise<void> {
  const contact = await userContact(userId);
  if (!contact) return;
  await queueEmail({
    to: contact.email,
    template,
    data: { ...data, name: contact.name },
    idempotencyKey: key,
  });
}
