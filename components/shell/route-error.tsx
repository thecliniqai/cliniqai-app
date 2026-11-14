"use client";

/**
 * The route error state (V2-06 06-04a step 3; P1-28 M3; threats T-06-09, T-06-19). Every `error.tsx` renders this.
 *
 * - Never shows the error's message (it can carry PHI; in production a client error keeps its original message). A
 *   server error's digest is shown as a short reference so support can match the server's record.
 * - The kind (`lib/errors/client-error-kind.ts`) picks the copy: offline → reconnect, skew → reload, otherwise a plain
 *   "Try again" (`retry()`: re-fetch and re-render the segment).
 * - `report` (signed-in dashboard only): an error **without** a digest is sent once per boundary render to
 *   `reportClientRenderError` with its class name and the route pattern, nothing else. A digest means the server
 *   already recorded it (`onRequestError`). Public and auth boundaries never report: there is no session.
 * - `standalone` renders its own `<main>` (boundaries outside the dashboard shell, whose page owned the landmark).
 */
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { reportClientRenderError } from "@/features/observability/actions";
import { clientErrorKind } from "@/lib/errors/client-error-kind";
import { routePatternOf } from "@/lib/errors/client-route";

const DIGEST = /^[A-Za-z0-9_-]{1,64}$/;
const NAME_LIMIT = 80;

function digestOf(error: unknown): string | null {
  const digest = error !== null && typeof error === "object" ? (error as { digest?: unknown }).digest : undefined;
  return typeof digest === "string" && DIGEST.test(digest) ? digest : null;
}

function nameOf(error: unknown): string {
  const name = error !== null && typeof error === "object" ? (error as { name?: unknown }).name : undefined;
  return typeof name === "string" && name !== "" ? name.slice(0, NAME_LIMIT) : "Error";
}

const COPY = {
  offline: { title: "You're offline", body: "You're offline. Reconnect to continue.", action: "Try again" },
  skew: { title: "This app was updated", body: "This app was updated. Reload to continue.", action: "Reload" },
  other: {
    title: "Something went wrong",
    body: "This page could not be shown. Try again, or come back to it in a moment.",
    action: "Try again",
  },
} as const;

export interface RouteErrorProps {
  error: unknown;
  retry: () => void;
  /** Send uncaught render errors without a digest to the error sink (signed-in dashboard boundaries only). */
  report?: boolean;
  /** A way out inside the app, e.g. `{ href: "/", label: "Go to Today" }`. */
  home?: { href: string; label: string };
  /** Render a `<main>` landmark (boundaries outside the dashboard shell). */
  standalone?: boolean;
}

export function RouteError({ error, retry, report = false, home, standalone = false }: RouteErrorProps) {
  const pathname = usePathname();
  const params = useParams();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const reported = useRef<unknown>(null);
  const kind = clientErrorKind(error);
  const digest = digestOf(error);
  const copy = COPY[kind];
  const route = routePatternOf(pathname, params);

  useEffect(() => {
    heading.current?.focus();
  }, [error]);

  useEffect(() => {
    if (!report || digest || reported.current === error) return;
    reported.current = error;
    reportClientRenderError({ name: nameOf(error), route }).catch(() => undefined);
  }, [report, digest, error, route]);

  const onAction = () => {
    if (kind === "skew") window.location.reload();
    else retry();
  };

  const content = (
    <section aria-labelledby={headingId} className="mx-auto flex w-full max-w-md flex-col items-start gap-4 py-12">
      <h1 id={headingId} ref={heading} tabIndex={-1} className="text-xl font-semibold text-fg focus:outline-none">
        {copy.title}
      </h1>
      <p className="text-sm text-fg-secondary">{copy.body}</p>
      {digest && <p className="text-xs text-fg-muted">Reference: {digest}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={onAction}>
          {copy.action}
        </Button>
        {home && (
          <Link
            href={home.href}
            className="inline-flex min-h-[44px] items-center rounded-lg px-4 text-sm font-medium text-accent-fg hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {home.label}
          </Link>
        )}
      </div>
    </section>
  );

  if (!standalone) return content;
  return <main className="flex min-h-app w-full items-center justify-center bg-canvas p-4">{content}</main>;
}
