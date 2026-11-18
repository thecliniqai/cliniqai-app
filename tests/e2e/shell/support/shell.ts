/**
 * Shared checks for the 06-04b shell specs: the visible Primary navigation, axe over the shell (top bar, navigation,
 * toasts, overlays; the v1 page content inside `<main>` is the M0 report's debt and V2-08/V2-09's to rebuild), no
 * horizontal scroll, and target sizes.
 */
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { ROOT } from "../../support/app-env";
import { settleAnimations } from "../../support/settle";

export const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
export const OUT = path.join(ROOT, "design-captures/06-04b");

/** The one Primary navigation visible at this width (Sidebar, Rail or BottomBar). */
export function primaryNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Primary" });
}

/** `[name, href]` of every link in the visible Primary navigation, in order. */
export async function navLinks(page: Page): Promise<Array<[string, string]>> {
  return primaryNav(page)
    .getByRole("link")
    .evaluateAll((links) =>
      links.map((a) => [a.getAttribute("aria-label") ?? (a.textContent ?? "").trim(), new URL((a as HTMLAnchorElement).href).pathname] as [string, string]),
    );
}

export async function noHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

export interface AxeSummary {
  label: string;
  url: string;
  scope: string;
  violations: Array<{ id: string; impact: string | null | undefined; nodes: number }>;
}

/**
 * axe (the M0 tags) over the page with `<main>` excluded unless `wholePage`; writes the summary to
 * `design-captures/06-04b/axe/<label>.json` and returns the serious/critical violations.
 */
export async function axeShell(
  page: Page,
  testInfo: TestInfo,
  label: string,
  opts: { wholePage?: boolean; include?: string } = {},
): Promise<Array<{ id: string; targets: string[] }>> {
  await settleAnimations(page);
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  if (opts.include) builder = builder.include(opts.include);
  else if (!opts.wholePage) builder = builder.exclude("#main");
  const results = await builder.analyze();
  const summary: AxeSummary = {
    label,
    url: new URL(results.url).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<id>"),
    scope: opts.include ?? (opts.wholePage ? "page" : "page without #main"),
    violations: results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
  };
  const dir = path.join(OUT, "axe");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${label}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  await testInfo.attach(`axe-${label}.json`, { body: JSON.stringify(summary, null, 2), contentType: "application/json" });
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(" ")) }));
}

/** Interactive elements of the shell (top bar and visible navigation) smaller than `min` px either way. */
export async function smallShellTargets(page: Page, min: number): Promise<string[]> {
  return page.evaluate((floor) => {
    const regions = [
      ...document.querySelectorAll<HTMLElement>("[data-shell-top-bar], [data-shell-nav]"),
    ].filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).display !== "none");
    const out: string[] = [];
    for (const region of regions) {
      for (const el of region.querySelectorAll<HTMLElement>("a[href], button, input, [role=button], [tabindex]:not([tabindex='-1'])")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.width < floor || r.height < floor) {
          const name = el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().slice(0, 30);
          out.push(`${el.tagName.toLowerCase()} "${name}" ${Math.round(r.width)}×${Math.round(r.height)}`);
        }
      }
    }
    return out;
  }, min);
}
