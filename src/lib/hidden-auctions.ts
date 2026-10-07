/**
 * Known non-customer fixtures that must remain out of normal marketplace
 * discovery. We keep their ledger rows intact for auditability rather than
 * rewriting or deleting completed transaction history.
 */
export const HIDDEN_AUCTION_ID_LIST = [
  "ecc27880-5067-4d52-a806-96c7e884fb0b",
] as const;

const HIDDEN_AUCTION_IDS = new Set<string>(HIDDEN_AUCTION_ID_LIST);

export function isHiddenAuctionId(id: string): boolean {
  return HIDDEN_AUCTION_IDS.has(id);
}
