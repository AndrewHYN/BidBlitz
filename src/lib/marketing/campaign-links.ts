/** UTM links only. These parameters do not themselves count clicks or conversions. */
export const CAMPAIGN_DESTINATIONS = {
  auctions: "/browse",
  sell: "/sell",
  home: "/",
} as const;

export type CampaignDestination = keyof typeof CAMPAIGN_DESTINATIONS;

export function normalizeCampaignTag(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 70);
}

export function buildCampaignUrl(input: {
  origin: string;
  destination: CampaignDestination;
  source: string;
  medium: string;
  campaign: string;
  content?: string;
}): string {
  const url = new URL(input.origin);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid site URL");
  const source = normalizeCampaignTag(input.source);
  const medium = normalizeCampaignTag(input.medium);
  const campaign = normalizeCampaignTag(input.campaign);
  const content = normalizeCampaignTag(input.content ?? "");
  if (!source || !medium || !campaign) throw new Error("Campaign, source and medium are required");
  url.pathname = CAMPAIGN_DESTINATIONS[input.destination];
  url.search = "";
  url.hash = "";
  url.searchParams.set("utm_source", source);
  url.searchParams.set("utm_medium", medium);
  url.searchParams.set("utm_campaign", campaign);
  if (content) url.searchParams.set("utm_content", content);
  return url.toString();
}
