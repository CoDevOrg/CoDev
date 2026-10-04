"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import {
  analyticsAllowed,
  analyticsPath,
  analyticsReferrer,
} from "@/lib/platform/privacy-preferences";

/**
 * Records one page view per client-side navigation. Mounted once in the root
 * layout so it covers every surface — marketing, dashboard, workspaces.
 *
 * Uses `navigator.sendBeacon` so the write survives the page being torn down
 * mid-navigation, and falls back to a keepalive `fetch` where beacon is
 * unavailable. Failures are swallowed: telemetry must never break a page.
 */
export function VisitTracker() {
  const pathname = usePathname();
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    const signal =
      (navigator as Navigator & { globalPrivacyControl?: boolean })
        .globalPrivacyControl === true || navigator.doNotTrack === "1";
    if (!pathname || !analyticsAllowed(document.cookie, signal)) return;
    const path = analyticsPath(pathname);

    // Guard against React re-running the effect for the same location.
    if (lastSent.current === path) return;
    lastSent.current = path;

    const payload = JSON.stringify({
      path,
      referrer: analyticsReferrer(document.referrer),
    });

    try {
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon("/api/track/visit", blob);
        return;
      }
    } catch {
      // fall through to fetch
    }

    void fetch("/api/track/visit", {
      method: "POST",
      body: payload,
      headers: { "content-type": "application/json" },
      keepalive: true,
    }).catch(() => {});
  }, [pathname]);

  return null;
}
