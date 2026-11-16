import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CategoryChips } from "./category-chips";

it("renders the category name, not a raw browse URL", () => {
  const html = renderToStaticMarkup(
    <CategoryChips categories={[{ slug: "toys-hobbies", name: "Toys & Hobbies", emoji: null }]} />
  );
  expect(html).toContain("Toys &amp; Hobbies");
  expect(html).toContain("category=toys-hobbies");
  expect(html).not.toContain(">\/browse?category=toys-hobbies<");
});
