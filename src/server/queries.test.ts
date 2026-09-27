import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { imageUrlFor } from "@/server/queries";

const BASE = "https://example.supabase.co";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
});

describe("imageUrlFor()", () => {
  it("maps a plain storage key onto the public bucket", () => {
    expect(imageUrlFor("auction/abc/cover.jpg")).toBe(
      `${BASE}/storage/v1/object/public/auction-images/auction/abc/cover.jpg`
    );
  });

  it("returns null for missing values so the UI can show its own placeholder", () => {
    expect(imageUrlFor(null)).toBeNull();
    expect(imageUrlFor(undefined)).toBeNull();
    expect(imageUrlFor("")).toBeNull();
  });

  it("refuses anything that is not a bare storage key", () => {
    expect(imageUrlFor("https://attacker.tld/x.jpg")).toBeNull();
    expect(imageUrlFor("http://attacker.tld/x.jpg")).toBeNull();
    expect(imageUrlFor("//attacker.tld/x.jpg")).toBeNull();
    expect(imageUrlFor("/etc/passwd")).toBeNull();
    expect(imageUrlFor("\\attacker.tld")).toBeNull();
    expect(imageUrlFor("a/../../other-bucket/x.jpg")).toBeNull();
    expect(imageUrlFor("./cover.jpg")).toBeNull();
  });
});
