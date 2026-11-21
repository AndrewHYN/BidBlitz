import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CategoryPicker } from "./category-picker";

const categories = [
  { id: 12, slug: "gaming-pcs", name: "Gaming PCs & Desktops" },
  { id: 65, slug: "other-items", name: "Other Items" },
  { id: 64, slug: "other-services", name: "Other Services" },
  { id: 57, slug: "tech-services", name: "Tech & Repair Services" },
];

describe("sell category picker", () => {
  it("makes searching obvious and offers an Other Items shortcut on sale listings", () => {
    const html = renderToStaticMarkup(
      <CategoryPicker categories={categories} kind="SALE" value="" onChange={() => {}} titleHint="Gaming PC RTX 3060" />
    );
    expect(html).toContain("Search or choose a category");
    expect(html).toContain("Type gaming PC");
    expect(html).toContain("Suggested: Gaming PCs &amp; Desktops");
    expect(html).toContain("Not listed? Choose Other Items");
    expect(html).toContain("category-other-shortcut");
  });

  it("uses Other Services for services, not the item fallback", () => {
    const html = renderToStaticMarkup(
      <CategoryPicker categories={categories} kind="SERVICE" value="" onChange={() => {}} />
    );
    expect(html).toContain("Not listed? Choose Other Services");
    expect(html).not.toContain("Not listed? Choose Other Items");
  });

  it("shows the selected category and avoids redundant Other prompt", () => {
    const html = renderToStaticMarkup(
      <CategoryPicker categories={categories} kind="SALE" value="65" onChange={() => {}} />
    );
    expect(html).toContain("Other Items");
    expect(html).toContain("Describe your item clearly");
    expect(html).not.toContain("Not listed? Choose Other Items");
  });
});
