import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type {
  DisputePayoutResolution,
  DisputeReason,
  DisputeResolution,
  DisputeStatus,
} from "@/lib/supabase/types";
import { hasPermission } from "@/server/permissions";

export type DisputeCase = {
  id: string;
  transactionId: string;
  auctionId: string;
  auctionTitle: string;
  openedBy: string;
  reason: DisputeReason;
  status: DisputeStatus;
  payoutStatusAtOpen: string | null;
  payoutFrozen: boolean;
  resolution: DisputeResolution | null;
  payoutResolution: DisputePayoutResolution | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  buyer: { id: string; username: string; displayName: string };
  seller: { id: string; username: string; displayName: string };
  transaction: {
    status: string;
    currency: string;
    grossMinor: number;
    feeMinor: number;
    feeBps: number;
    netMinor: number;
  };
  payout: {
    status: string;
    deliveryConfirmedAt: string | null;
    paidAt: string | null;
  } | null;
  messages: Array<{
    id: string;
    authorId: string;
    authorName: string;
    authorUsername: string;
    body: string;
    createdAt: string;
  }>;
  evidence: Array<{
    id: string;
    uploadedBy: string;
    uploaderName: string;
    signedUrl: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
  }>;
};

async function loadCase(disputeId: string): Promise<DisputeCase | null> {
  const admin = createAdminClient();
  const { data: dispute } = await admin
    .from("transaction_disputes")
    .select(
      "id, transaction_id, opened_by, reason, status, payout_status_at_open, payout_frozen, resolution, payout_resolution, resolution_note, resolved_by, resolved_at, created_at, updated_at"
    )
    .eq("id", disputeId)
    .maybeSingle();
  if (!dispute) return null;

  const { data: tx } = await admin
    .from("transactions")
    .select(
      "id, auction_id, buyer_id, seller_id, status, currency, gross_minor, fee_minor, fee_bps, net_minor"
    )
    .eq("id", dispute.transaction_id)
    .maybeSingle();
  if (!tx) return null;

  const [{ data: auction }, { data: payout }, { data: messages }, { data: evidenceRows }] =
    await Promise.all([
      admin.from("auctions").select("title").eq("id", tx.auction_id).maybeSingle(),
      admin
        .from("seller_payouts")
        .select("status, delivery_confirmed_at, paid_at")
        .eq("transaction_id", tx.id)
        .maybeSingle(),
      admin
        .from("transaction_dispute_messages")
        .select("id, author_id, body, created_at")
        .eq("dispute_id", dispute.id)
        .order("created_at", { ascending: true }),
      admin
        .from("transaction_dispute_evidence")
        .select("id, uploaded_by, storage_path, mime_type, size_bytes, created_at")
        .eq("dispute_id", dispute.id)
        .order("created_at", { ascending: true }),
    ]);

  const profileIds = [
    tx.buyer_id,
    tx.seller_id,
    dispute.opened_by,
    ...(messages ?? []).map((message) => message.author_id),
    ...(evidenceRows ?? []).map((row) => row.uploaded_by),
    ...(dispute.resolved_by ? [dispute.resolved_by] : []),
  ];
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, username, display_name")
    .in("id", [...new Set(profileIds)]);

  const byId = new Map(
    (profiles ?? []).map((profile) => [
      profile.id,
      {
        id: profile.id,
        username: profile.username,
        displayName: profile.display_name,
      },
    ])
  );

  const buyer = byId.get(tx.buyer_id);
  const seller = byId.get(tx.seller_id);
  if (!buyer || !seller) return null;

  const evidence = [];
  for (const row of evidenceRows ?? []) {
    const { data: signed } = await admin.storage
      .from("dispute-evidence")
      .createSignedUrl(row.storage_path, 15 * 60);
    if (!signed?.signedUrl) continue;
    evidence.push({
      id: row.id,
      uploadedBy: row.uploaded_by,
      uploaderName: byId.get(row.uploaded_by)?.displayName ?? "BidBlitz user",
      signedUrl: signed.signedUrl,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
    });
  }

  return {
    id: dispute.id,
    transactionId: dispute.transaction_id,
    auctionId: tx.auction_id,
    auctionTitle: auction?.title ?? "Auction",
    openedBy: dispute.opened_by,
    reason: dispute.reason as DisputeReason,
    status: dispute.status as DisputeStatus,
    payoutStatusAtOpen: dispute.payout_status_at_open,
    payoutFrozen: dispute.payout_frozen,
    resolution: dispute.resolution as DisputeResolution | null,
    payoutResolution: dispute.payout_resolution as DisputePayoutResolution | null,
    resolutionNote: dispute.resolution_note,
    resolvedBy: dispute.resolved_by,
    resolvedAt: dispute.resolved_at,
    createdAt: dispute.created_at,
    updatedAt: dispute.updated_at,
    buyer,
    seller,
    transaction: {
      status: tx.status,
      currency: tx.currency,
      grossMinor: tx.gross_minor,
      feeMinor: tx.fee_minor,
      feeBps: tx.fee_bps,
      netMinor: tx.net_minor,
    },
    payout: payout
      ? {
          status: payout.status,
          deliveryConfirmedAt: payout.delivery_confirmed_at,
          paidAt: payout.paid_at,
        }
      : null,
    messages: (messages ?? []).map((message) => ({
      id: message.id,
      authorId: message.author_id,
      authorName: byId.get(message.author_id)?.displayName ?? "BidBlitz user",
      authorUsername: byId.get(message.author_id)?.username ?? "user",
      body: message.body,
      createdAt: message.created_at,
    })),
    evidence,
  };
}

export async function getPartyDisputeCase(
  disputeId: string,
  viewerId: string
): Promise<DisputeCase | null> {
  const caseData = await loadCase(disputeId);
  if (!caseData) return null;
  if (viewerId !== caseData.buyer.id && viewerId !== caseData.seller.id) return null;
  return caseData;
}

export async function getStaffDisputeCase(
  disputeId: string,
  viewerId: string
): Promise<DisputeCase | null> {
  if (!(await hasPermission(viewerId, "disputes.view"))) return null;
  return loadCase(disputeId);
}
