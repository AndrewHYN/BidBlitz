"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export function MarketplaceViewTracker() {
  const pathname = usePathname();
  const previousPath = useRef<string | null>(null);
  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    if (pathname !== "/" && pathname !== "/browse" && !/^\/(listing|auction)\/[^/]+$/.test(pathname)) return;
    void fetch("/api/marketplace-view", { method: "POST", keepalive: true }).catch(() => {});
  }, [pathname]);
  return null;
}
