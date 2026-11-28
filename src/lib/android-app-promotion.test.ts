import { describe, expect, it } from "vitest";
import { isAndroidBrowser, isAppReferrer, isPromotionPath, isReminderPath } from "./android-app-promotion";

describe("Android download promotion", () => {
  it("only shows in Android browsers", () => {
    expect(isAndroidBrowser("Mozilla Android Chrome", "", false, false)).toBe(true);
    expect(isAndroidBrowser("Mozilla iPhone Safari", "", false, false)).toBe(false);
    expect(isAndroidBrowser("Desktop Chrome", "", false, false)).toBe(false);
  });
  it("suppresses app launches, installed display modes and app sessions", () => {
    expect(isAppReferrer("android-app://zw.co.bidblitz.app/")).toBe(true);
    expect(isAndroidBrowser("Android", "android-app://zw.co.bidblitz.app", false, false)).toBe(false);
    expect(isAndroidBrowser("Android", "", true, false)).toBe(false);
    expect(isAndroidBrowser("Android", "", false, true)).toBe(false);
  });
  it("does not interrupt protected flows", () => {
    for (const path of ["/messages", "/sell", "/login", "/signup", "/admin", "/settings"]) {
      expect(isPromotionPath(path)).toBe(false);
      expect(isReminderPath(path)).toBe(false);
    }
    expect(isPromotionPath("/listing/abc")).toBe(true);
    expect(isReminderPath("/listing/abc")).toBe(false);
    expect(isReminderPath("/marketplace")).toBe(true);
  });
});
