"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Download, Smartphone, X } from "lucide-react";
import { APK_PATH, isPromotionPath, promoMoment, PROMO_EVENT, showAppPromotion, DISMISS_MS, type PromoMoment } from "@/lib/android-app-promotion";
import { useAndroidAppContext } from "@/hooks/use-android-app-context";

const DISMISSED = "bidblitz:android-promo-dismissed-v2";
const SHOWN = "bidblitz:android-promo-last-shown-v2";
const copy: Record<PromoMoment, { heading: string; detail: string }> = {
  login: { heading: "Sign in on the BidBlitz app", detail: "Use the same account in our free Android app. Or keep signing in here." },
  signup: { heading: "Join BidBlitz on Android", detail: "Create your account here or take the marketplace with you in our free app." },
  "signup-complete": { heading: "Take your new account with you", detail: "After confirming your email, use the same account in the Android app." },
  "listing-published": { heading: "Manage your listing on the app", detail: "Keep BidBlitz close while you manage listings and respond to buyers." },
  browse: { heading: "Take BidBlitz with you", detail: "Buy, sell and discover services from your Android home screen." },
};
function stamp(key: string) {
  try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; }
}
function save(key: string) {
  try { localStorage.setItem(key, String(Date.now())); } catch { /* storage unavailable */ }
}

export function AndroidAppPromotion() {
  const path = usePathname() ?? "";
  const context = useAndroidAppContext();
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (Date.now() - stamp(DISMISSED) < DISMISS_MS) setDismissed(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const [active, setActive] = useState<{ moment: PromoMoment; path: string } | null>(null);
  const browser = context === "android-browser" || context === "other-browser";
  const mobile = context === "android-browser";
  const moment = promoMoment(path);

  useEffect(() => {
    if (!mobile || dismissed || !moment) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "visible" || document.querySelector("input:focus, textarea:focus, [contenteditable=true]:focus")) return;
      if (!showAppPromotion(moment, stamp(SHOWN + ":" + moment), stamp(DISMISSED), Date.now())) return;
      save(SHOWN + ":" + moment);
      setActive({ moment, path });
    }, moment === "browse" ? 20000 : 1500);
    return () => window.clearTimeout(timer);
  }, [mobile, dismissed, moment, path]);

  useEffect(() => {
    if (!mobile || dismissed) return;
    function onMoment(e: Event) {
      const next = (e as CustomEvent<PromoMoment>).detail;
      if (next !== "listing-published" && next !== "signup-complete") return;
      if (!showAppPromotion(next, stamp(SHOWN + ":" + next), stamp(DISMISSED), Date.now())) return;
      save(SHOWN + ":" + next);
      setActive({ moment: next, path });
    }
    window.addEventListener(PROMO_EVENT, onMoment);
    return () => window.removeEventListener(PROMO_EVENT, onMoment);
  }, [mobile, dismissed, path]);

  function dismiss() {
    save(DISMISSED);
    setDismissed(true);
    setActive(null);
  }
  if (!browser || dismissed) return null;
  const banner = mobile && (isPromotionPath(path) || moment === "login" || moment === "signup");
  const popup = mobile && active?.path === path ? copy[active.moment] : null;
  return (
    <>
      {banner && (
        <aside aria-label="BidBlitz Android app" className="border-b border-orange-500/30 bg-orange-500/10 text-foreground">
          <div className="page-container flex flex-wrap items-center gap-2 py-2 sm:gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-orange-600 text-white"><Smartphone className="size-5" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold leading-tight">Get the BidBlitz Android app</p><p className="text-xs leading-tight text-muted-foreground">Free · 3.7 MB · Same account</p></div>
            <a href={APK_PATH} download onClick={dismiss} className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg bg-orange-600 px-3 text-xs font-semibold text-white hover:bg-orange-700"><Download className="size-4" aria-hidden="true" /> Download APK</a>
            <button type="button" onClick={dismiss} aria-label="Dismiss app promotion for three days" className="flex size-9 shrink-0 items-center justify-center rounded-lg hover:bg-muted"><X className="size-4" aria-hidden="true" /></button>
          </div>
        </aside>
      )}
      {popup && (
        <aside aria-label="Android app download reminder" role="region" className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-40 mx-auto max-w-sm rounded-2xl border border-orange-500/40 bg-card p-4 text-card-foreground shadow-xl">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-orange-600 text-white"><Smartphone className="size-6" aria-hidden="true" /></span>
            <div className="flex-1"><p className="font-bold">{popup.heading}</p><p className="mt-1 text-sm text-muted-foreground">{popup.detail}</p></div>
            <button type="button" onClick={dismiss} aria-label="Close download reminder" className="flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-muted"><X className="size-4" aria-hidden="true" /></button>
          </div>
          <a href={APK_PATH} download onClick={dismiss} className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-700"><Download className="size-4" aria-hidden="true" /> Download Android APK</a>
          <button type="button" onClick={dismiss} className="mt-2 w-full rounded-lg py-2 text-sm text-muted-foreground">Continue on website</button>
        </aside>
      )}
    </>
  );
}
