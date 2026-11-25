import { describe, expect, it } from "vitest";
import { fitPhoto, PHOTO_BUDGETS, preparePhoto } from "./prepare-photo";

describe("photo preparation budgets", () => {
  it("preserves landscape and portrait aspect ratios", () => {
    expect(fitPhoto(4000, 3000, 1600)).toEqual({width:1600,height:1200});
    expect(fitPhoto(3000, 4000, 1600)).toEqual({width:1200,height:1600});
  });
  it("never upscales", () => expect(fitPhoto(320, 240, 1600)).toEqual({width:320,height:240}));
  it("rejects invalid dimensions", () => expect(() => fitPhoto(0, 200, 1600)).toThrow());
  it("keeps small files unchanged", async () => {
    const file = new File(["small"], "small.png", {type:"image/png"});
    expect(await preparePhoto(file, "listing")).toBe(file);
  });
  it("does not silently flatten large GIFs", async () => {
    const file = new File([new Uint8Array(PHOTO_BUDGETS.avatar.maxBytes + 1)], "animation.gif", {type:"image/gif"});
    await expect(preparePhoto(file, "avatar")).rejects.toThrow("GIF");
  });
});
