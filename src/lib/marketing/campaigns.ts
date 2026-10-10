import { z } from "zod";
import { normalizeCampaignTag } from "@/lib/marketing/campaign-links";
import { parseMoneyToMinor } from "@/lib/money";

export const CAMPAIGN_OBJECTIVES = [
  "SELLER_ACQUISITION", "BUYER_ACQUISITION", "AUCTION_EVENT", "REACTIVATION",
] as const;
export const CAMPAIGN_STATUSES = [
  "DRAFT", "READY", "RUNNING", "PAUSED", "COMPLETED",
] as const;

const fields = z.object({
  title: z.string().trim().min(3).max(100),
  objective: z.enum(CAMPAIGN_OBJECTIVES),
  destination: z.enum(["home","auctions","sell"]),
  source: z.string().min(2).max(90),
  medium: z.string().min(2).max(90),
  campaignTag: z.string().min(3).max(90),
  contentTag: z.string().max(90).optional().default(""),
  budgetUsd: z.string().min(1).max(20),
  brief: z.string().max(2000).optional().default(""),
  plannedDate: z.string().optional().default(""),
});
export type CreateCampaignInput = z.input<typeof fields>;

export type PreparedCampaign = {
  title: string;
  objective: typeof CAMPAIGN_OBJECTIVES[number];
  destination: "home" | "auctions" | "sell";
  source: string;
  medium: string;
  campaignTag: string;
  contentTag: string | null;
  brief: string;
  budgetMinor: number;
  plannedStart: string | null;
};

export function prepareCampaign(value: unknown): PreparedCampaign | null {
  const parsed = fields.safeParse(value);
  if (!parsed.success) return null;
  const c = parsed.data;
  const source = normalizeCampaignTag(c.source);
  const medium = normalizeCampaignTag(c.medium);
  const campaignTag = normalizeCampaignTag(c.campaignTag);
  const contentTag = normalizeCampaignTag(c.contentTag);
  if (source.length < 2 || medium.length < 2 || campaignTag.length < 3) return null;

  const budget = parseMoneyToMinor(c.budgetUsd, "USD");
  if (budget === null || budget < 0n || budget > 10000000n) return null;

  const plannedStart = c.plannedDate
    ? /^\d{4}-\d{2}-\d{2}$/.test(c.plannedDate)
      ? `${c.plannedDate}T12:00:00.000Z`
      : null
    : null;
  if (c.plannedDate && (!plannedStart || Number.isNaN(Date.parse(plannedStart))
    || new Date(plannedStart).toISOString().slice(0,10) !== c.plannedDate)) return null;

  return {
    title: c.title,
    objective: c.objective,
    destination: c.destination,
    source, medium, campaignTag, contentTag: contentTag || null,
    brief: c.brief.trim(), budgetMinor: Number(budget), plannedStart,
  };
}

export function campaignStatusTargets(status: string): string[] {
  switch (status) {
    case "DRAFT": return ["READY","COMPLETED"];
    case "READY": return ["RUNNING","PAUSED","COMPLETED"];
    case "RUNNING": return ["PAUSED","COMPLETED"];
    case "PAUSED": return ["RUNNING","COMPLETED"];
    default: return [];
  }
}
