import { describe, expect, it } from "vitest";
import { knownListingTown, listedAge, suggestedSearches } from "./discovery";

describe("marketplace discovery", () => {
  it("suggests only actual listing terms, deduplicated and linked to real searches", () => {
    expect(suggestedSearches([
      { id: "1", title: "New Zealand Rabbits" },
      { id: "2", title: "Nike Airforce" },
      { id: "3", title: "new zealand rabbits" },
    ])).toEqual([
      { label: "New Zealand Rabbits", href: "/browse?q=New%20Zealand%20Rabbits" },
      { label: "Nike Airforce", href: "/browse?q=Nike%20Airforce" },
    ]);
    expect(suggestedSearches([])).toEqual([]);
  });

  it("formats the actual listing timestamp rather than showing countdowns for sales", () => {
    const now = Date.parse("2026-11-21T12:00:00Z");
    expect(listedAge("2026-11-20T19:00:00Z", now)).toBe("17 hours ago");
    expect(listedAge("2026-11-21T11:58:00Z", now)).toBe("2 minutes ago");
    expect(listedAge(null, now)).toBeNull();
  });

  it("never guesses a town when a listing names only a suburb", () => {
    expect(knownListingTown("Harare CBD")).toBe("Harare");
    expect(knownListingTown("Snake Park CTT (Pajoy)")).toBeNull();
  });
});
