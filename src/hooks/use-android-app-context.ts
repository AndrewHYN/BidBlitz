"use client";

import { useEffect, useState } from "react";
import { isAppReferrer, isInstalledContext, ANDROID_PACKAGE } from "@/lib/android-app-promotion";

const SESSION = "bidblitz:android-app-session";
type Context = "unknown" | "app" | "android-browser" | "other-browser";
type RelatedNavigator = Navigator & { getInstalledRelatedApps?: () => Promise<{ id?: string; platform?: string }[]> };

export function useAndroidAppContext() {
  const [context, setContext] = useState<Context>("unknown");
  useEffect(() => {
    let alive = true;
    async function detect() {
      const referrer = document.referrer;
      const display = ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"].some(mode =>
        window.matchMedia("(display-mode: " + mode + ")").matches);
      let session = false;
      try {
        if (isAppReferrer(referrer)) window.sessionStorage.setItem(SESSION, "1");
        session = window.sessionStorage.getItem(SESSION) === "1";
      } catch { /* storage disabled */ }
      if (isInstalledContext(referrer, display, session)) {
        if (alive) setContext("app");
        return;
      }
      if (/Android/i.test(navigator.userAgent)) {
        // Also suppress nudges when Chrome can confirm the corresponding APK
        // is installed. On browsers lacking this API, the TWA referrer and
        // display mode are still checked.
        try {
          const related = await (navigator as RelatedNavigator).getInstalledRelatedApps?.();
          if (related?.some(app => app.id === ANDROID_PACKAGE && app.platform === "play")) {
            if (alive) setContext("app");
            return;
          }
        } catch { /* optional browser API */ }
        if (alive) setContext("android-browser");
        return;
      }
      if (alive) setContext("other-browser");
    }
    void detect();
    return () => { alive = false; };
  }, []);
  return context;
}
