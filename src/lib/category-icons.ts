import {
  BookOpen,
  Car,
  Gamepad2,
  House,
  LayoutGrid,
  Monitor,
  Palette,
  Shirt,
  Tent,
  Trophy,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * Category glyphs as Lucide icons.
 *
 * The `categories.emoji` column predates the product rule in AGENTS.md — "No
 * emojis in product UI when a real icon exists; use Lucide" — so the UI maps
 * slugs to real icons. The column itself stays: it is data, migrations seed
 * it, and dropping it is a schema change with no product upside.
 * Unknown slugs fall back to LayoutGrid so a new category never renders bare.
 */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  electronics: Monitor,
  fashion: Shirt,
  "home-garden": House,
  collectibles: Trophy,
  "toys-hobbies": Gamepad2,
  "sports-outdoors": Tent,
  "vehicles-parts": Car,
  "art-memorabilia": Palette,
  "books-music": BookOpen,
  "tools-equipment": Wrench,
};

export function categoryIcon(slug: string): LucideIcon {
  return CATEGORY_ICONS[slug] ?? LayoutGrid;
}
