"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Download, Smartphone, X } from "lucide-react";
import { ANDROID_PACKAGE, APK_PATH, DAY_MS, DISMISS_MS, isAndroidBrowser, isAppReferrer, isPromotionPath, isReminderPath } from "@/lib/android-app-promotion";

const DISMISSED = "bidblitz:android-promo-dismissed-v1";
const REMINDED = "bidblitz:android-promo-reminded-v1";
const APP_SESSION = "bidblitz:android-app-session";
type RelatedNavigator = Navigator & { getInstalledRelatedApps?: () => Promise<{ id?: string; platform?: string }[]> };

function readStamp(key: string) {
  try { return Number(window.localStorage.getItem(key)) || 0; } catch { return 0; }
}
function saveStamp(key: string) {
  try { window.localStorage.setItem(key, String(Date.now())); } catch { /* storage unavailable */ }
}
function isAppSession() {
  const appReferrer = isAppReferrer(document.referrer);
  try {
    if (appReferrer) window.sessionStorage.setItem(APP_SESSION, "1");
    return appReferrer || window.sessionStorage.getItem(APP_SESSION) === "1";
  } catch { return appReferrer; }
}
export function AndroidAppPromotion() {
  const path = usePathname() ?? "";
  const [eligible, setEligible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [reminder, setReminder] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const display = ["standalone", "fullscreen", "minimal-ui"].some((mode) =>
        window.matchMedia("(display-mode: " + mode + ")").matches);
      if (!isAndroidBrowser(navigator.userAgent, document.referrer, display, isAppSession())) return;
      try {
        const related = await (navigator as RelatedNavigator).getInstalledRelatedApps?.();
        if (related?.some((app) => app.id === ANDROID_PACKAGE && app.platform === "play")) return;
      } catch { /* optional browser capability */ }
      if (!cancelled && Date.now() - readStamp(DISMISSED) >= DISMISS_MS) setEligible(true);
    }
    void check();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!eligible || dismissed || !isReminderPath(path) || Date.now() - readStamp(REMINDED) < DAY_MS) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "visible" || document.querySelector("input:focus, textarea:focus, [contenteditable=true]:focus")) return;
      saveStamp(REMINDED);
      setReminder(true);
    }, 20000);
    return () => window.clearTimeout(timer);
  }, [eligible, dismissed, path]);

  function dismiss() {
    saveStamp(DISMISSED);
    setDismissed(true);
    setReminder(false);
  }
  if (!eligible || dismissed || !isPromotionPath(path)) return null;

  const showReminder = reminder && isReminderPath(path);
  return (
    <>
      <aside aria-label="BidBlitz Android app" className="border-b border-border bg-accent text-accent-foreground">
        <div className="page-container flex flex-wrap items-center gap-2 py-2 sm:gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Smartphone className="size-5" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">Get the BidBlitz app</p>
            <p className="text-xs leading-tight opacity-80">Free for Android · 3.7 MB</p>
          </div>
          <a href={APK_PATH} download onClick={dismiss} className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground">
            <Download className="size-4" aria-hidden="true" /> Download
          </a>
          <button type="button" onClick={dismiss} aria-label="Dismiss app promotion for three days" className="flex size-9 shrink-0 items-center justify-center rounded-lg hover:bg-background/50"><X className="size-4" aria-hidden="true" /></button>
        </div>
      </aside>
      {showReminder && (
        <aside aria-label="Android app download reminder" className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+6rem)] z-40 mx-auto max-w-sm rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-xl">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Smartphone className="size-6" aria-hidden="true" /></span>
            <div className="flex-1">
              <p className="font-bold">Take BidBlitz with you</p>
              <p className="mt-1 text-sm text-muted-foreground">Your marketplace, right on your home screen. Same account, no extra signup.</p>
            </div>
            <button type="button" onClick={dismiss} aria-label="Close download reminder" className="flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-muted"><X className="size-4" aria-hidden="true" /></button>
          </div>
          <a href={APK_PATH} download onClick={dismiss} className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"><Download className="size-4" aria-hidden="true" /> Download Android app</a>
          <button type="button" onClick={dismiss} className="mt-2 w-full rounded-lg py-2 text-sm text-muted-foreground">Continue on website</button>
        </aside>
      )}
    </>
  );
}
