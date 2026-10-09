import type { LinkwaBalance } from "./linkwa-payouts";

export type BalanceDisplay =
  | { state: "ready"; availableMinor: bigint; pendingMinor: bigint }
  | { state: "connected"; message: string };

/** No balance entry is not evidence of either an error or a zero balance. */
export function describeLinkwaBalance(balances: LinkwaBalance[]): BalanceDisplay {
  const usd = balances.find((entry) => entry.currency === "USD");
  if (usd) {
    return { state: "ready", availableMinor: usd.availableMinor, pendingMinor: usd.pendingMinor };
  }
  return {
    state: "connected",
    message: balances.length === 0
      ? "Linkwa is connected. The provider returned no balance entries. No available funds have been confirmed for seller payouts."
      : "Linkwa is connected, but the provider returned no USD balance. No available USD funds have been confirmed for seller payouts.",
  };
}
