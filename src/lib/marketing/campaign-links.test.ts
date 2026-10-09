import { describe, expect, it } from "vitest";
import { buildCampaignUrl, normalizeCampaignTag } from "./campaign-links";

describe("campaign links", () => {
  it("builds real shareable URL with encoded normalized UTM parameters", () => {
    const link = buildCampaignUrl({
      origin: "https://bidblitz.co.zw/",
      destination: "auctions",
      source: " Instagram ",
      medium: "Social Media",
      campaign: "Friday Blitz!",
      content: "Creator #1",
    });
    const url = new URL(link);
    expect(url.origin).toBe("https://bidblitz.co.zw");
    expect(url.pathname).toBe("/browse");
    expect(url.searchParams.get("utm_campaign")).toBe("friday_blitz");
    expect(url.searchParams.get("utm_source")).toBe("instagram");
    expect(url.searchParams.get("utm_medium")).toBe("social_media");
    expect(url.searchParams.get("utm_content")).toBe("creator_1");
  });

  it("drops untrusted query strings and hashes supplied on the origin", () => {
    const link = buildCampaignUrl({
      origin: "https://bidblitz.co.zw/bad?x=secret#frag",
      destination: "sell", source: "whatsapp", medium: "dm", campaign: "sellers",
    });
    const url = new URL(link);
    expect(url.pathname).toBe("/sell");
    expect(url.searchParams.has("x")).toBe(false);
    expect(url.hash).toBe("");
  });

  it("never accepts javascript protocols or empty required tags", () => {
    expect(() => buildCampaignUrl({
      origin: "javascript:alert(1)", destination: "home",
      source: "x", medium: "social", campaign: "launch",
    })).toThrow();
    expect(() => buildCampaignUrl({
      origin: "https://bidblitz.co.zw", destination: "home",
      source: "@@@", medium: "social", campaign: "launch",
    })).toThrow();
    expect(normalizeCampaignTag("  a/b ?  ")).toBe("a_b");
  });
});
