"use client";

/**
 * Root error state (V2-06 06-04a step 3): replaces Next's default when the root layout itself fails. It renders its own
 * document, so it loads the global styles itself. Never the error's message (T-06-09, T-06-19): a static title, the
 * digest as a reference when there is one, and a reload. Nothing is reported (no session is known here).
 */
import "./globals.css";

const DIGEST = /^[A-Za-z0-9_-]{1,64}$/;

export default function GlobalError({ error }: { error: unknown; retry: () => void }) {
  const raw = error !== null && typeof error === "object" ? (error as { digest?: unknown }).digest : undefined;
  const digest = typeof raw === "string" && DIGEST.test(raw) ? raw : null;
  return (
    <html lang="en">
      <body>
        <title>Something went wrong</title>
        <main className="flex min-h-app w-full items-center justify-center bg-canvas p-4">
          <section aria-labelledby="global-error-title" className="mx-auto flex w-full max-w-md flex-col items-start gap-4 py-12">
            <h1 id="global-error-title" className="text-xl font-semibold text-fg">
              Something went wrong
            </h1>
            <p className="text-sm text-fg-secondary">The app could not be shown. Reload to try again.</p>
            {digest && <p className="text-xs text-fg-muted">Reference: {digest}</p>}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex min-h-[44px] items-center rounded-lg bg-accent px-4 text-sm font-medium text-fg-on-accent hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Reload
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
