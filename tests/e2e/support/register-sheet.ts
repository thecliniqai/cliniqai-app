import type { Page } from "@playwright/test";
import { awaitHydrated } from "./hydrated";

/**
 * Two things the Register patient sheet's specs raced (09E-14a, flake F5; iphone-15, found as "the sheet did not open within 5 s" and as "Fix 1 field before
 * registering" with the sex still unchosen):
 *
 * 1. `awaitRegisterLinkHydrated`: the "Register Patient" link is clicked only once React has hydrated it. A click before that is not handled by the client router, and WebKit
 *    hydrates later than Chromium (09B-02b); the sheet then opens only after a full document load, or not within the assertion's 5 s.
 * 2. `fillAgeAndSettle`: after the age is typed the form asks the duplicate lookup (a server action, debounced 400 ms) and shows its answer ABOVE the age and sex
 *    fields. A tap on "Female" that lands as the answer arrives hits whatever moved under it (seen: the radio stayed unchosen). The spec waits for that answer to be
 *    on screen before it taps further down. (The shift under a finger is a product question, raised in 09E-NOTES.)
 */
export async function awaitRegisterLinkHydrated(page: Page): Promise<void> {
  await awaitHydrated(page, 'a[href*="new=1"]');
}

export async function fillAgeAndSettle(page: Page, fillAge: () => Promise<void>): Promise<void> {
  const lookup = page.waitForResponse((r) => r.request().method() === "POST" && r.request().headers()["next-action"] !== undefined, { timeout: 4_000 }).catch(() => null);
  await fillAge();
  await lookup;
  // The answer is rendered a frame or two after the response.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
