import { describe, expect, it } from "vitest";
import {
  CATEGORY_SECTIONS, categoryMatches, groupedCategories, suggestedCategorySlugs,
} from "./category-taxonomy";

const categories = [
  { id: 1, slug: "electronics", name: "Electronics" },
  { id: 2, slug: "gaming-pcs", name: "Gaming PCs & Desktops" },
  { id: 3, slug: "livestock", name: "Livestock" },
  { id: 4, slug: "tech-services", name: "Tech & Repair Services" },
  { id: 5, slug: "other-items", name: "Other Items" },
  { id: 6, slug: "legacy-category", name: "Legacy Category" },
];

describe("marketplace categories", () => {
  it("has unique slugs and no duplicate categories across sections", () => {
    const slugs = CATEGORY_SECTIONS.flatMap((section) => section.entries.map((entry) => entry.slug));
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toContain("gaming-pcs");
    expect(slugs).toContain("livestock");
    expect(slugs).toContain("other-items");
  });

  it("keeps older categories available and splits services from items", () => {
    const sale = groupedCategories(categories, "SALE");
    expect(sale.flatMap((section) => section.categories.map((category) => category.slug)))
      .toEqual(expect.arrayContaining(["electronics", "gaming-pcs", "livestock", "legacy-category", "other-items"]));
    expect(sale.flatMap((section) => section.categories.map((category) => category.slug)))
      .not.toContain("tech-services");
    const services = groupedCategories(categories, "SERVICE");
    expect(services.flatMap((section) => section.categories.map((category) => category.slug)))
      .toEqual(["tech-services"]);
  });

  it("searches names and seller terminology", () => {
    expect(categoryMatches(categories[1], "gaming computer")).toBe(true);
    expect(categoryMatches(categories[1], "desktop")).toBe(true);
    expect(categoryMatches(categories[2], "rabbits")).toBe(true);
    expect(categoryMatches(categories[1], "cattle")).toBe(false);
  });

  it("suggests a specific category based on the listing title", () => {
    expect(suggestedCategorySlugs("Custom gaming PC RTX 4060", "SALE")).toEqual(["gaming-pcs"]);
    expect(suggestedCategorySlugs("New Zealand rabbits", "SALE")).toEqual(["livestock"]);
    expect(suggestedCategorySlugs("Website development Harare", "SERVICE")).toEqual(["web-app-development"]);
    expect(suggestedCategorySlugs("Laptop repair Harare", "SERVICE")).toEqual(["tech-services"]);
  });
});
