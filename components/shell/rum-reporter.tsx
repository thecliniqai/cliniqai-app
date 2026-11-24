"use client";

import { useEffect } from "react";
import { useReportWebVitals } from "next/web-vitals";
import { rum } from "@/lib/observability/rum/collector";
import type { RumMetric } from "@/lib/observability/rum/catalog";

const VITALS: Readonly<Record<string, RumMetric>> = { LCP: "lcp", INP: "inp", CLS: "cls", TTFB: "ttfb", FCP: "fcp" };

/**
 * Real-user monitoring in the dashboard shell (V2-09e 09E-02, R-20; no `web-vitals` package: Next's own hook). Records the five Web
 * Vitals, marks the start of an in-app navigation (a click on a same-origin link) for `DataReady`, and flushes the batch with a beacon when
 * the page goes to the background. Renders nothing.
 */
export function RumReporter() {
  useReportWebVitals((metric) => {
    const name = VITALS[metric.name];
    if (name) rum.record(name, metric.value);
  });

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download")) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      try {
        const url = new URL(link.href);
        if (url.origin === window.location.origin && url.pathname !== window.location.pathname) rum.navigationStarted();
      } catch {
        // not a URL: not a navigation
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") rum.flush(true);
    };
    // `pagehide` also covers a page that is closed or put in the back-forward cache without a visibility change (iOS Safari).
    const onPageHide = () => rum.flush(true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  return null;
}
