/**
 * Holds back a client navigation's RSC response (V2-06 06-04a route-states specs). Next prefetches a link's route up to
 * its loading boundary; the navigation itself then fetches the page with the `RSC` header and no
 * `Next-Router-Prefetch` header. Holding only that request shows the prefetched loading state until it is released.
 */
import type { Page, Request } from "@playwright/test";
import { expect } from "../../fixtures";

const isPrefetch = (request: Request) => request.headers()["next-router-prefetch"] !== undefined;
const isRsc = (request: Request) => request.headers()["rsc"] === "1";

export interface HeldNavigation {
  /** Lets the held navigation response through. */
  release: () => void;
  /** How many navigation requests were held. */
  held: () => number;
}

/** Holds every non-prefetch RSC request for `pathname` until `release()` or `holdMs` (when given) has passed. */
export async function holdNavigation(page: Page, pathname: string, holdMs?: number): Promise<HeldNavigation> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let count = 0;
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
  return { release, held: () => count };
}

/** Clicks the shell's nav link `name`, opening the mobile navigation first when the sidebar is off-canvas. */
export async function clickNavLink(page: Page, name: string, pathname: string): Promise<void> {
  const menu = page.getByRole("button", { name: "Open mobile navigation menu" });
  if (await menu.isVisible()) await menu.click();
  const link = page.getByRole("link", { name, exact: true });
  await expect(link).toBeVisible();
  // The route's loading state comes from the link's prefetch: wait until it has been fetched.
  await expect
    .poll(() => page.evaluate((p) => performance.getEntriesByType("resource").some((e) => new URL(e.name).pathname === p), pathname), {
      timeout: 15_000,
    })
    .toBe(true);
  await link.click();
}
