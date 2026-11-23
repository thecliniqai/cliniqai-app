/**
 * V2-09e 09E-01: the page rows of the latency lane (B-1 in-app, B-3 full load): which page, which role, which link is clicked, and which
 * element is "the first data" of the page. Selectors only; the measuring is `latency-run.ts`, the assertions are the budgets.
 *
 * First data element of a page: a thing only the page's own data makes (a lane, the first patient row, the Rx entry row, the first grid slot),
 * never the layout or the skeleton.
 */
import type { Page } from "@playwright/test";
import type { MarkSpec } from "../support/latency";
import type { E2eRole } from "../support/run-data";
import { run } from "../support/m0-data";

/** What a row needs to know about this run: the seeded ids. */
export interface PageContext {
  patientId: string;
  visitId: string;
}

export function pageContext(): PageContext {
  const { tenantA } = run();
  return { patientId: tenantA.patientId, visitId: tenantA.visitId };
}

export interface PageRowDef {
  /** The id of the in-app row (`in-app.R.patients`); the full-load row is `full.` plus the rest. */
  id: string;
  role: E2eRole;
  /** The page the step starts from and the page it ends on (a pathname plus query). */
  from: string;
  to: (ctx: PageContext) => string;
  /** The link the user clicks on `from` (a real `next/link`), or null when the role has none and the app navigates by `router.push`. */
  link: ((page: Page, ctx: PageContext) => ReturnType<Page["locator"]>) | null;
  /** The first data element of the destination. */
  data: (ctx: PageContext) => MarkSpec;
}

const nav = (name: string) => (page: Page) => page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name, exact: true });

/** Today's lanes are the board's data: the first lane on screen. */
const TODAY_LANE: MarkSpec = { selector: "[data-today-board] [data-lane]" };

export const PAGE_ROWS: readonly PageRowDef[] = [
  { id: "in-app.R.today", role: "receptionist", from: "/patients", to: () => "/today", link: nav("Today"), data: () => TODAY_LANE },
  { id: "in-app.R.patients", role: "receptionist", from: "/today", to: () => "/patients", link: nav("Patients"), data: () => ({ selector: '#main a[href^="/patients/"]' }) },
];

export function fullLoadId(id: string): string {
  return id.replace(/^in-app\./, "full.");
}
