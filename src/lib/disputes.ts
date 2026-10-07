import type {
  DisputePayoutResolution,
  DisputeReason,
  DisputeResolution,
  DisputeStatus,
} from "@/lib/supabase/types";

export const DISPUTE_REASON_OPTIONS: ReadonlyArray<{
  value: DisputeReason;
  label: string;
  hint: string;
}> = [
  {
    value: "ITEM_NOT_RECEIVED",
    label: "Item not received",
    hint: "The handover or delivery did not happen as agreed.",
  },
  {
    value: "ITEM_NOT_AS_DESCRIBED",
    label: "Item not as described",
    hint: "The item materially differs from the auction description or photos.",
  },
  {
    value: "ITEM_DAMAGED",
    label: "Item damaged",
    hint: "The item arrived or was handed over with undisclosed damage.",
  },
  {
    value: "HANDOVER_SAFETY",
    label: "Handover or safety concern",
    hint: "There was a problem with the collection, delivery or safety of the handover.",
  },
  {
    value: "PAYMENT_OR_PAYOUT",
    label: "Payment or payout question",
    hint: "The provider or seller payout state needs BidBlitz review.",
  },
  {
    value: "OTHER",
    label: "Something else",
    hint: "Use this only when the issue does not fit the categories above.",
  },
];

export const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  OPEN: "Open",
  WAITING_FOR_BUYER: "Waiting for buyer",
  WAITING_FOR_SELLER: "Waiting for seller",
  UNDER_REVIEW: "Under review",
  RESOLVED: "Resolved",
};

export const DISPUTE_RESOLUTION_LABELS: Record<DisputeResolution, string> = {
  AGREEMENT_REACHED: "Buyer and seller reached an agreement",
  SELLER_RESPONSIBLE: "Seller responsible",
  BUYER_RESPONSIBLE: "Buyer responsible",
  INSUFFICIENT_EVIDENCE: "Insufficient evidence",
  CLOSED_NO_ACTION: "Closed with no further action",
  OTHER: "Other recorded outcome",
};

export const DISPUTE_PAYOUT_LABELS: Record<DisputePayoutResolution, string> = {
  RELEASE: "Release seller payout",
  HOLD: "Keep seller payout on hold",
  NONE: "No payout change",
};

export function disputeReasonLabel(reason: DisputeReason): string {
  return DISPUTE_REASON_OPTIONS.find((option) => option.value === reason)?.label ?? reason;
}
