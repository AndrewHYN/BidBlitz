/**
 * Readiness is NOT a button that activates financial transactions.
 * Every gate must be independently evidenced; unknown is blocked.
 */
export type GateState = "verified" | "blocked" | "unknown";
export type LaunchGate = {
  key: string;
  label: string;
  status: GateState;
  detail: string;
};

export function evaluateMoneyLaunch(gates: ReadonlyArray<LaunchGate>): {
  ready: boolean;
  blocked: number;
  unknown: number;
  verified: number;
  reason: string;
} {
  const verified = gates.filter(g => g.status === "verified").length;
  const blocked = gates.filter(g => g.status === "blocked").length;
  const unknown = gates.filter(g => g.status === "unknown").length;
  if (gates.length === 0) return { ready: false, blocked, unknown, verified, reason: "No verification gates were supplied." };
  if (new Set(gates.map(g => g.key)).size !== gates.length)
    return { ready: false, blocked: blocked + 1, unknown, verified, reason: "Duplicate verification gates." };
  if (blocked > 0) return { ready: false, blocked, unknown, verified, reason: "One or more mandatory launch gates failed." };
  if (unknown > 0) return { ready: false, blocked, unknown, verified, reason: "Mandatory provider or financial evidence is missing." };
  return { ready: true, blocked, unknown, verified, reason: "All supplied gates passed; human authorization is still required." };
}

export function settlementException(status: string, payoutReference: string | null): string | null {
  if (status === "PAYOUT_DUE" && !payoutReference)
    return "Provider outcome unknown: no reference. Do not retry or mark paid without Linkwa confirmation.";
  if (status === "PAYOUT_DUE" && payoutReference)
    return "Provider payout instruction recorded. Seller wallet receipt is not yet confirmed.";
  return null;
}
