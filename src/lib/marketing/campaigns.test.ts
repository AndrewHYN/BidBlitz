import { describe, it, expect } from "vitest";
import { prepareCampaign, campaignStatusTargets } from "./campaigns";

const input = {
  title: "Friday gaming blitz",
  objective: "AUCTION_EVENT",
  destination: "auctions",
  source: "Instagram",
  medium: "Social Media",
  campaignTag: "Friday Blitz",
  budgetUsd: "12.50",
  brief: "Original product demo with seller consent.",
  plannedDate: "2026-11-06",
};
describe("campaign planning", () => {
  it("normalizes UTM codes and never uses floating point budget math", () => {
    expect(prepareCampaign(input)).toMatchObject({
      source: "instagram", medium: "social_media", campaignTag: "friday_blitz",
      budgetMinor: 1250, plannedStart: "2026-11-06T12:00:00.000Z",
    });
  });
  it("rejects invalid amounts and budgets beyond policy cap", () => {
    expect(prepareCampaign({ ...input, budgetUsd: "3.001" })).toBeNull();
    expect(prepareCampaign({ ...input, budgetUsd: "100000.01" })).toBeNull();
    expect(prepareCampaign({ ...input, budgetUsd: "-2" })).toBeNull();
  });
  it("rejects invalid calendar dates and empty campaign tags", () => {
    expect(prepareCampaign({ ...input, plannedDate: "2026-02-30" })).toBeNull();
    expect(prepareCampaign({ ...input, campaignTag: "!!!" })).toBeNull();
  });
  it("enforces narrow status progression with a terminal completion", () => {
    expect(campaignStatusTargets("DRAFT")).toEqual(["READY","COMPLETED"]);
    expect(campaignStatusTargets("RUNNING")).toEqual(["PAUSED","COMPLETED"]);
    expect(campaignStatusTargets("COMPLETED")).toEqual([]);
  });
  it("does not allow uncontrolled objective/status values", () => {
    expect(prepareCampaign({ ...input, objective: "PAYOUTS" })).toBeNull();
    expect(prepareCampaign({ ...input, source: "!" })).toBeNull();
  });
});
