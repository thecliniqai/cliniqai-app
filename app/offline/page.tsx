import type { Metadata } from "next";
import { RefreshCw, WifiOff } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { cn } from "@/lib/utils";
import { BUTTON_BASE, BUTTON_INTERACTIVE, BUTTON_SIZE, BUTTON_VARIANT, FOCUS_RING, TRANSITION } from "@/lib/ui/variants";

/**
 * `/offline` (PWA_STRATEGY §3.6; V2-06 06-05 step 5, branded by 06-01b step 4). The page the service worker serves when
 * a navigation fails for lack of network. Static (built once, no request data), outside every route group, public
 * (`PUBLIC_PAGE_PREFIXES`), and precached with `credentials: "omit"` by the service worker that `/sw.js` serves
 * (`app/sw.js/route.ts` → `lib/pwa/service-worker-source.ts`, 06-09a). It names no user, clinic or session, and holds
 * no patient data (PWA §4).
 *
 * Layout per the approved `005-surfaces/offline.html` (`offline_360` at 3a78a5d; 06-09e, design review M5): the 56 px
 * mark (named "CliniQ AI": no product name is written beside it), the WifiOff glyph, "You're offline" in Manrope 800
 * (title-1), the reassurance line, and Retry with its RefreshCw icon. The tab reads "Offline · CliniQ AI" (root title
 * template). "Retry" is a plain link (a full navigation that works without JavaScript): online it loads the app,
 * offline the service worker answers with this page again.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false },
};

export default function OfflinePage() {
  return (
    <main className="min-h-app bg-canvas text-fg flex items-center justify-center px-4 py-6">
      <div className="grid w-full max-w-110 justify-items-center gap-3.5 text-center">
        <BrandMark size={56} />
        <WifiOff aria-hidden="true" strokeWidth={1.75} className="size-[18px] text-fg-icon" data-offline-glyph="" />
        <h1 className="font-display text-title-1 tracking-title text-fg">You&apos;re offline</h1>
        <p className="text-body text-fg-secondary">Patient data isn&apos;t stored on this device. Reconnect to continue.</p>
        {/* A full navigation on purpose (no client router): it must work offline and without JavaScript. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className={cn(BUTTON_BASE, TRANSITION, FOCUS_RING, BUTTON_SIZE.lg, BUTTON_VARIANT.primary, BUTTON_INTERACTIVE.primary)}
        >
          <RefreshCw aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0" />
          Retry
        </a>
      </div>
    </main>
  );
}
