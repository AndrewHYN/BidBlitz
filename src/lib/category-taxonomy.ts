export type CategoryOption = { id: number; name: string; slug: string };

type CategoryEntry = { slug: string; search?: string };
type CategorySection = { label: string; service?: boolean; entries: readonly CategoryEntry[] };

// Single UI taxonomy for sale, auction, service, and browse. The original
// category slugs stay available: existing listings retain their category IDs.
// The database is still authoritative for which options are actually available.
export const CATEGORY_SECTIONS: readonly CategorySection[] = [
  { label: "Computers & Gaming", entries: [
    { slug: "gaming-pcs", search: "gaming pc desktop gaming computer gpu" },
    { slug: "laptops", search: "notebooks macbook laptop" },
    { slug: "computer-parts", search: "graphics card gpu ram cpu motherboard ssd desktop pc components" },
    { slug: "gaming-consoles", search: "playstation ps4 ps5 xbox nintendo switch" },
    { slug: "gaming-accessories", search: "controllers gaming keyboards monitors headsets" },
    { slug: "computers-other", search: "computers printers office pc" },
  ] },
  { label: "Phones & Electronics", entries: [
    { slug: "phones-tablets", search: "phone smartphone iphone samsung ipad android tablet" },
    { slug: "phone-accessories", search: "charger cases screen protector power bank" },
    { slug: "tv-audio", search: "television smart tv speaker sound bar headphones" },
    { slug: "cameras-drones", search: "camera lens drone" },
    { slug: "electronics", search: "other electronics appliances gadgets" },
  ] },
  { label: "Vehicles & Transport", entries: [
    { slug: "cars", search: "vehicle car sedan suv truck" },
    { slug: "motorcycles", search: "motorbike bike scooter" },
    { slug: "vehicle-parts", search: "car tyres wheels spares engines parts" },
    { slug: "bicycles", search: "bicycle mountain bike cycling" },
    { slug: "vehicles-parts", search: "other vehicles transport" },
  ] },
  { label: "Property", entries: [
    { slug: "property-sale", search: "house plot stand land apartment for sale" },
    { slug: "property-rent", search: "rooms flat house apartment accommodation rentals lease" },
    { slug: "commercial-property", search: "shop office warehouse commercial rentals" },
  ] },
  { label: "Home & Garden", entries: [
    { slug: "furniture", search: "sofa bed couch wardrobe table chair" },
    { slug: "home-appliances", search: "fridge stove washing machine freezer" },
    { slug: "kitchen-dining", search: "pots dishes cutlery kitchenware" },
    { slug: "building-materials", search: "bricks cement roofing tiles construction" },
    { slug: "home-garden", search: "garden decor household plants" },
  ] },
  { label: "Fashion & Beauty", entries: [
    { slug: "fashion", search: "clothing clothes dress shirts trousers men women" },
    { slug: "shoes", search: "sneakers heels trainers footwear boots" },
    { slug: "bags-accessories", search: "handbags handbags purse belts" },
    { slug: "jewellery-watches", search: "rings necklaces watches jewelry" },
    { slug: "beauty-personal-care", search: "cosmetics makeup skincare perfumes hair products" },
  ] },
  { label: "Farming & Animals", entries: [
    { slug: "livestock", search: "rabbits chickens goats cattle sheep pigs poultry" },
    { slug: "pets-animals", search: "dogs cats puppies kittens birds fish" },
    { slug: "farm-produce", search: "vegetables maize grains fruit harvest" },
    { slug: "farm-supplies", search: "fertilizer seeds animal feed" },
    { slug: "farming-equipment", search: "tractor irrigation farming tools" },
  ] },
  { label: "Tools & Work", entries: [
    { slug: "tools-equipment", search: "tools drill welding power tools workshop" },
    { slug: "industrial-equipment", search: "generator compressor machinery" },
    { slug: "office-supplies", search: "desks paper stationery photocopier" },
  ] },
  { label: "Kids, Hobbies & Collectibles", entries: [
    { slug: "baby-kids", search: "baby stroller pram cot children's clothing" },
    { slug: "toys-hobbies", search: "toys board games hobbies" },
    { slug: "collectibles", search: "antiques cards stamps coins memorabilia" },
  ] },
  { label: "Sports & Outdoors", entries: [
    { slug: "sports-outdoors", search: "gym exercise football fitness camping sports equipment" },
  ] },
  { label: "Books, Art & Music", entries: [
    { slug: "books-music", search: "books textbooks novels cds records" },
    { slug: "musical-instruments", search: "guitar piano keyboard drums" },
    { slug: "art-memorabilia", search: "paintings sculptures pictures art" },
  ] },
  { label: "Food & Groceries", entries: [
    { slug: "food-groceries", search: "groceries snacks drinks baked goods food" },
  ] },
  { label: "Services", service: true, entries: [
    { slug: "web-app-development", search: "web developer web design software development websites web apps portfolio ecommerce coding programming" },
    { slug: "tech-services", search: "computer repair phone repair laptop repair IT help" },
    { slug: "home-services", search: "cleaning plumbing electrical handyman gardening" },
    { slug: "transport-services", search: "delivery courier moving transport taxi" },
    { slug: "beauty-services", search: "hair braiding barber nails makeup beauty" },
    { slug: "event-services", search: "photography catering wedding dj decoration" },
    { slug: "teaching-services", search: "tutoring lessons training teaching" },
    { slug: "business-services", search: "accounting marketing design printing consulting" },
    { slug: "other-services", search: "hire freelancer work services" },
  ] },
  { label: "Other", entries: [
    { slug: "other-items", search: "miscellaneous other uncategorized items" },
  ] },
];

export function groupedCategories<T extends { slug: string; name: string }>(
  categories: readonly T[],
  kind: "SALE" | "AUCTION" | "SERVICE",
): Array<{ label: string; categories: T[] }> {
  const bySlug = new Map(categories.map((category) => [category.slug, category]));
  const used = new Set<string>();
  const sections = CATEGORY_SECTIONS
    .filter((section) => kind === "SERVICE" ? section.service : !section.service)
    .map((section) => {
      const found = section.entries
        .map((entry) => bySlug.get(entry.slug))
        .filter((category): category is T => Boolean(category));
      for (const category of found) used.add(category.slug);
      return { label: section.label, categories: found };
    })
    .filter((section) => section.categories.length > 0);
  if (kind !== "SERVICE") {
    // Preserve unknown historical item categories, but never leak known
    // service-only categories into the sale/auction picker.
    const recognized = new Set(CATEGORY_SECTIONS.flatMap((section) =>
      section.entries.map((entry) => entry.slug)
    ));
    const unmatched = categories.filter((category) =>
      !used.has(category.slug) && !recognized.has(category.slug)
    );
    if (unmatched.length) sections.push({ label: "More categories", categories: unmatched });
  }
  return sections;
}

export function categoryMatches(category: CategoryOption, term: string): boolean {
  const normalized = term.toLocaleLowerCase().trim();
  if (!normalized) return true;
  const entry = CATEGORY_SECTIONS.flatMap((section) => section.entries)
    .find((candidate) => candidate.slug === category.slug);
  const searchable = [category.name, category.slug.replaceAll("-", " "), entry?.search ?? ""]
    .join(" ").toLocaleLowerCase();
  return normalized.split(/\s+/).every((part) => searchable.includes(part));
}

export function suggestedCategorySlugs(title: string, kind: "SALE" | "AUCTION" | "SERVICE"): string[] {
  const normalized = title.toLowerCase();
  if (kind === "SERVICE") {
    if (/developer|website|software|web app|web design|programming|coding/.test(normalized)) return ["web-app-development"];
    if (/repair|computer|phone/.test(normalized)) return ["tech-services"];
    if (/delivery|transport|moving/.test(normalized)) return ["transport-services"];
    if (/hair|braid|makeup|nails|barber/.test(normalized)) return ["beauty-services"];
    if (/plumb|clean|electric|paint|garden/.test(normalized)) return ["home-services"];
    return [];
  }
  if (/gaming\s*(pc|computer|desktop)|\bpc\s*gaming\b/.test(normalized)) return ["gaming-pcs"];
  if (/laptop|macbook|notebook|thinkpad|elitebook|pavilion/.test(normalized)) return ["laptops"];
  if (/graphics card|\bgpu\b|\brtx\b|\bgtx\b|motherboard|\bram\b/.test(normalized)) return ["computer-parts"];
  if (/playstation|\bps[345]\b|\bxbox\b|nintendo/.test(normalized)) return ["gaming-consoles"];
  if (/iphone|samsung|smartphone|tablet|\bphone\b/.test(normalized)) return ["phones-tablets"];
  if (/rabbit|chicken|goat|cattle|sheep|pig|broiler/.test(normalized)) return ["livestock"];
  if (/\bcar\b|toyota|honda|mazda|nissan/.test(normalized)) return ["cars"];
  if (/fridge|freezer|washing machine|stove/.test(normalized)) return ["home-appliances"];
  if (/sofa|couch|wardrobe|dining table|bed frame/.test(normalized)) return ["furniture"];
  return [];
}
