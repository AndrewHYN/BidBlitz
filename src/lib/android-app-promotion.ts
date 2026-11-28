export const ANDROID_PACKAGE = "zw.co.bidblitz.app";
export const APK_PATH = "/downloads/BidBlitz-1.0.0.apk";
export const DAY_MS = 24 * 60 * 60 * 1000;
export const DISMISS_MS = 3 * DAY_MS;

export function isAndroidBrowser(userAgent: string, referrer: string, appDisplay: boolean, appSession: boolean) {
  return /Android/i.test(userAgent) && !appDisplay && !appSession &&
    !/^android-app:\/\/zw\.co\.bidblitz\.app(?:\/|$)/i.test(referrer);
}

export function isAppReferrer(referrer: string) {
  return /^android-app:\/\/zw\.co\.bidblitz\.app(?:\/|$)/i.test(referrer);
}

export function isPromotionPath(path: string) {
  return path === "/" || ["/browse", "/marketplace", "/listing", "/services-zimbabwe", "/business"]
    .some((prefix) => path === prefix || path.startsWith(prefix + "/"));
}
export function isReminderPath(path: string) {
  return path === "/login" || path === "/signup" || path === "/" || path === "/browse" || path === "/marketplace" || path === "/services-zimbabwe";
}

export type PromoMoment = "login" | "signup" | "signup-complete" | "listing-published" | "browse";
export const PROMO_EVENT = "bidblitz:download-promotion";
export function promoMoment(path: string): PromoMoment | null {
  if (path === "/login") return "login";
  if (path === "/signup") return "signup";
  return isReminderPath(path) ? "browse" : null;
}
export function isInstalledContext(referrer: string, appDisplay: boolean, appSession: boolean) {
  return appDisplay || appSession || isAppReferrer(referrer);
}
export function showAppPromotion(moment: PromoMoment, lastShown: number, dismissedAt: number, now: number) {
  const cooldown = moment === "browse" ? DAY_MS : 6 * 60 * 60 * 1000;
  return now - dismissedAt >= DISMISS_MS && now - lastShown >= cooldown;
}
