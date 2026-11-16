import { describe, expect, it } from "vitest";
import { publicListingLocation } from "./listing-display";

describe("public listing location", () => {
  it.each(["Town", " town ", "City", "Location", "unknown", "", "  ", null, undefined])(
    "never advertises placeholder location %s as geography",
    (value) => expect(publicListingLocation(value)).toBe("Location not specified")
  );
  it.each(["Harare CBD", "Avondale", "Bulawayo", "Mutare"])(
    "preserves an actual seller-selected location %s",
    (value) => expect(publicListingLocation(value)).toBe(value)
  );
});
