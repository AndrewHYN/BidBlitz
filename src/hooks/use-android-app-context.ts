"use client";

import { useEffect, useState } from "react";
import { isAppReferrer, isInstalledContext } from "@/lib/android-app-promotion";

const SESSION = "bidblitz:android-app-session";
type Context = "unknown" | "app" | "android-browser" | "other-browser";

export function useAndroidAppContext() {
  const [context, setContext] = useState<Context>("unknown");
  useEffect(() => {
    let alive = true;
    async function detect() {
      await Promise.resolve();
      const referrer = document.referrer;
      const display = ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"].some(mode =>
        window.matchMedia("(display-mode: " + mode + ")").matches);
      const launcher = new URLSearchParams(window.location.search).get("source") === "bidblitz-android";
      let session = launcher;
      try {
        if (launcher || isAppReferrer(referrer)) window.sessionStorage.setItem(SESSION, "1");
        session = launcher || window.sessionStorage.getItem(SESSION) === "1";
      } catch { /* storage disabled */ }
      if (isInstalledContext(referrer, display, session)) {
        if (alive) setContext("app");
        return;
      }
      if (/Android/i.test(navigator.userAgent)) {
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
