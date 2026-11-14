import type { Metadata } from "next";

/**
 * `/offline` (PWA_STRATEGY §3.6; V2-06 06-05 step 5). The page the service worker serves when a navigation fails for
 * lack of network. Static (built once, no request data), outside every route group, public (`PUBLIC_PAGE_PREFIXES`),
 * and precached by `public/sw.js` with `credentials: "omit"`. It names no user, clinic or session, and holds no
 * patient data (PWA §4).
 *
 * "Retry" is a plain link (a full navigation that works without JavaScript): online it loads the app, offline the
 * service worker answers with this page again. "ClinicQ" is the Wave A working name; 06-01b brands it.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false },
};

export default function OfflinePage() {
  return (
    <main className="min-h-dvh bg-canvas text-fg flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm text-center">
        <p className="text-title-3 font-semibold text-accent-fg">ClinicQ</p>
        <h1 className="mt-6 text-title-1 font-semibold">You&apos;re offline</h1>
        <p className="mt-3 text-body text-fg-secondary">
          Patient data isn&apos;t stored on this device. Reconnect to continue.
        </p>
        {/* A full navigation on purpose (no client router): it must work offline and without JavaScript. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="mt-8 inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-6 text-body font-semibold text-fg-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Retry
        </a>
      </div>
    </main>
  );
}
