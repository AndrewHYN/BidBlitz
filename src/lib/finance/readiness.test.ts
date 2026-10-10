import { describe, expect, it } from "vitest";
import { evaluateMoneyLaunch, settlementException } from "./readiness";

const base = [
  { key: "api", label: "API", status: "verified" as const, detail: "Read-only production request passed" },
  { key: "custody", label: "Custody", status: "verified" as const, detail: "Written provider confirmation" },
  { key: "compliance", label: "Compliance", status: "verified" as const, detail: "Signed off" },
];
describe("financial launch readiness", () => {
  it("blocks empty or duplicate gate sets", () => {
    expect(evaluateMoneyLaunch([]).ready).toBe(false);
    expect(evaluateMoneyLaunch([...base,base[0]]).ready).toBe(false);
  });
  it("blocks a production API 401 even if every other gate passes", () => {
    const result = evaluateMoneyLaunch(base.map(g => g.key === "api" ? { ...g, status: "blocked" as const } : g));
    expect(result.ready).toBe(false);
    expect(result.blocked).toBe(1);
  });
  it("blocks missing settlement or legal proof", () => {
    expect(evaluateMoneyLaunch(base.map(g => g.key === "custody" ? { ...g, status: "unknown" as const } : g)).ready).toBe(false);
  });
  it("returns green only for independently proven inputs", () => {
    expect(evaluateMoneyLaunch(base).ready).toBe(true);
  });
  it("never treats a provider instruction or missing reference as final receipt", () => {
    expect(settlementException("PAYOUT_DUE",null)).toContain("Do not retry");
    expect(settlementException("PAYOUT_DUE","LW-555")).toContain("not yet confirmed");
    expect(settlementException("PAID_OUT","LW-555")).toBeNull();
  });
});
