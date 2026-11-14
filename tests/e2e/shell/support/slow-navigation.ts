/**
 * Holds back a client navigation's RSC response (V2-06 06-04a route-states specs).
 *
 * Next 16 prefetches a link in two requests to the same path: the route tree (`Next-Router-Segment-Prefetch: /_tree`),
 * then, once the tree is cached, the segment data up to the loading boundary (`Next-Router-Prefetch: 1`, no
 * segment header). The navigation itself fetches the page with `RSC: 1` and no `Next-Router-Prefetch`; holding only
 * that request shows the prefetched loading state until it is released, provided the segment-data prefetch had
 * already ARRIVED when the link was clicked. If it is still in flight, the router renders the pending prefetch, React
 * entangles that render with the final (held) data, and the loading state never shows (the route-state loading flake,
 * 06-WAVE-NOTES.md). So {@link clickNavLink} waits for that prefetch to settle, and `holdNavigation`, which observes
 * it, must be installed before `page.goto` of the page with the link (the sidebar's links prefetch on load).
 */
import type { Page, Request } from "@playwright/test";
import { expect } from "../../fixtures";

const isPrefetch = (request: Request) => request.headers()["next-router-prefetch"] !== undefined;
const isRsc = (request: Request) => request.headers()["rsc"] === "1";
const isRouteTree = (request: Request) => request.headers()["next-router-segment-prefetch"] === "/_tree";

export interface HeldNavigation {
  /** Lets the held navigation response through. */
  release: () => void;
  /** How many navigation requests were held. */
  held: () => number;
  /** How many segment-data (loading boundary) prefetches of the path have settled. */
  prefetched: () => number;
}

/**
 * Holds every non-prefetch RSC request for `pathname` until `release()` or `holdMs` (when given) has passed, and counts
 * the path's settled segment-data prefetches. Call it before `page.goto`.
 */
export async function holdNavigation(page: Page, pathname: string, holdMs?: number): Promise<HeldNavigation> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let count = 0;
  let prefetched = 0;
  // Playwright often reports a fully read prefetch body as `requestfailed` (net::ERR_ABORTED) rather than
  // `requestfinished`; either way the response has arrived (the Loading assertion still fails if its data did not).
  const settled = (request: Request) => {
    if (new URL(request.url()).pathname !== pathname) return;
    if (isRsc(request) && isPrefetch(request) && !isRouteTree(request)) prefetched++;
  };
  page.on("requestfinished", settled);
  page.on("requestfailed", settled);
  await page.route(
    (url) => url.pathname === pathname,
    async (route) => {
      const request = route.request();
      if (isRsc(request) && !isPrefetch(request)) {
        count++;
        await (holdMs === undefined ? gate : new Promise((resolve) => setTimeout(resolve, holdMs)));
      }
      await route.continue();
    },
  );
  return { release, held: () => count, prefetched: () => prefetched };
}

/**
 * Clicks the shell's nav link `name`, opening the mobile navigation first when the sidebar is off-canvas, once the
 * link's route has been prefetched up to its loading boundary (`nav` from {@link holdNavigation}).
 */
export async function clickNavLink(page: Page, name: string, nav: HeldNavigation): Promise<void> {
  const menu = page.getByRole("button", { name: "Open mobile navigation menu" });
  if (await menu.isVisible()) await menu.click();
  const link = page.getByRole("link", { name, exact: true });
  await expect(link).toBeVisible();
  await expect
    .poll(nav.prefetched, { message: `${name}: loading-boundary prefetch settled`, timeout: 15_000 })
    .toBeGreaterThan(0);
  await link.click();
}
