import type { Page } from "@playwright/test";

/**
 * Waits until React has hydrated the element matched by `selector` (it carries a `__reactProps$` key once its handlers are attached). A click or a key press
 * before that point is silently lost; WebKit (iphone-15) hydrates later than Chromium, which is how this was found (09B-02b).
 */
export async function awaitHydrated(page: Page, selector = "[data-consult-workspace]"): Promise<void> {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return el !== null && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
    },
    selector,
    { timeout: 15_000 },
  );
}
