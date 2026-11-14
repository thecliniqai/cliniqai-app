import type { Metadata } from "next";
import { BrandMark } from "@/components/brand/brand-mark";
import { PRODUCT_NAME } from "@/lib/design/brand";

/**
 * `/offline` (PWA_STRATEGY §3.6; V2-06 06-05 step 5, branded by 06-01b step 4). The page the service worker serves when
 * a navigation fails for lack of network. Static (built once, no request data), outside every route group, public
 * (`PUBLIC_PAGE_PREFIXES`), and precached by `public/sw.js` with `credentials: "omit"`. It names no user, clinic or
 * session, and holds no patient data (PWA §4).
 *
 * The brand mark is decorative (the product name is written next to it). The tab reads "Offline · CliniQ AI" (root
 * title template). "Retry" is a plain link (a full navigation that works without JavaScript): online it loads the app,
 * offline the service worker answers with this page again.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false },
};

export default function OfflinePage() {
  return (
    <main className="min-h-app bg-canvas text-fg flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm text-center">
        <div className="flex items-center justify-center gap-3">
          <BrandMark size={56} decorative />
          <p className="font-display text-title-1 text-fg">{PRODUCT_NAME}</p>
        </div>
        <h1 className="mt-8 text-title-2 font-semibold">You&apos;re offline</h1>
        <p className="mt-3 text-body text-fg-secondary">
          Patient data isn&apos;t stored on this device. Reconnect to continue.
        </p>
        {/* A full navigation on purpose (no client router): it must work offline and without JavaScript. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="mt-8 inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-6 text-body font-semibold text-fg-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Retry
        </a>
      </div>
    </main>
  );
}
