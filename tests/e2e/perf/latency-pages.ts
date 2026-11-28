/**
 * V2-09e 09E-01: the page rows of the latency lane (B-1 in-app, B-3 full load): which page, which role, which link is clicked, and which
 * element is "the first data" of the page. Selectors only; the measuring is `latency-run.ts`, the assertions are the budgets.
 *
 * First data element of a page: a thing only the page's own data makes (a lane, the first patient row, the Rx entry row, the first grid slot),
 * never the layout or the skeleton.
 */
import type { Locator, Page } from "@playwright/test";
import type { MarkSpec } from "../support/latency";
import type { E2eRole } from "../support/run-data";
import { run, seedSignedConsultation } from "../support/m0-data";

/** What a row needs to know about this run: the seeded ids and names. */
export interface PageContext {
  patientId: string;
  patientName: string;
  /** The run's visit, in consultation with the run's doctor (a consult in draft). */
  visitId: string;
  /** A sealed consultation of the run's doctor (seeded only for the rows that open one). */
  sealed?: { visitId: string; patientName: string; medicine: string };
}

export async function pageContext(withSealed: boolean): Promise<PageContext> {
  const { tenantA } = run();
  const base = { patientId: tenantA.patientId, patientName: tenantA.patientName, visitId: tenantA.visitId };
  if (!withSealed) return base;
  const sealed = await seedSignedConsultation("Perf sealed");
  return { ...base, sealed: { visitId: sealed.visitId, patientName: sealed.patientName, medicine: sealed.medicine } };
}

export interface PageRowDef {
  /** The id of the in-app row (`in-app.R.patients`); the full-load row is `full.` plus the rest. */
  id: string;
  role: E2eRole;
  /** The page the step starts from and the page it ends on (a pathname plus query). */
  from: (ctx: PageContext) => string;
  to: (ctx: PageContext) => string;
  /** What the user clicks on `from` (a real `next/link` or the view switch). */
  click: (page: Page, ctx: PageContext) => Locator;
  /** The first data element of the destination. */
  data: (ctx: PageContext) => MarkSpec;
  /** The row opens a sealed consultation: seed one first. */
  sealed?: boolean;
}

const nav = (name: string) => (page: Page) => page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name, exact: true });
const inMain = (href: string) => (page: Page) => page.locator(`#main a[href="${href}"]`).first();

const TODAY_LANE: MarkSpec = { selector: "[data-today-board] [data-lane]" };
const TABLE_ROW: MarkSpec = { selector: "#main table tbody tr" };

export const PAGE_ROWS: readonly PageRowDef[] = [
  { id: "in-app.R.today", role: "receptionist", from: () => "/patients", to: () => "/today", click: nav("Today"), data: () => TODAY_LANE },
  {
    id: "in-app.R.schedule-day",
    role: "receptionist",
    from: () => "/today",
    to: () => "/schedule",
    click: nav("Schedule"),
    data: () => ({ selector: "#main [data-day-grid]" }),
  },
  {
    id: "in-app.R.schedule-week",
    role: "receptionist",
    from: () => "/schedule",
    to: () => "/schedule?view=week",
    click: (page) => page.getByRole("radio", { name: "Week" }),
    // V2-09f: the week view is the time grid from 768 px and the overview list below; both sit in `[data-week-view]`.
    data: () => ({ selector: "#main [data-week-view]" }),
  },
  {
    id: "in-app.R.patients",
    role: "receptionist",
    from: () => "/today",
    to: () => "/patients",
    click: nav("Patients"),
    data: () => TABLE_ROW,
  },
  {
    id: "in-app.R.patient",
    role: "receptionist",
    from: () => "/patients",
    to: (ctx) => `/patients/${ctx.patientId}`,
    click: (page, ctx) => inMain(`/patients/${ctx.patientId}`)(page),
    data: (ctx) => ({ selector: "#main h1", text: ctx.patientName }),
  },
  { id: "in-app.R.visits", role: "receptionist", from: () => "/today", to: () => "/visits", click: nav("Visits"), data: () => TABLE_ROW },
  {
    id: "in-app.D.today",
    role: "doctor",
    from: () => "/patients",
    to: () => "/today",
    click: nav("Today"),
    data: () => TODAY_LANE,
  },
  {
    id: "in-app.D.consult-draft",
    role: "doctor",
    from: () => "/today",
    to: (ctx) => `/consultation/${ctx.visitId}`,
    click: (page, ctx) => page.locator(`[data-today-board] a[href="/consultation/${ctx.visitId}"]`).first(),
    data: () => ({ selector: "[data-rx-search]" }),
  },
  {
    id: "in-app.D.consult-sealed",
    role: "doctor",
    from: () => "/visits",
    to: (ctx) => `/consultation/${ctx.sealed!.visitId}`,
    click: (page, ctx) => inMain(`/consultation/${ctx.sealed!.visitId}`)(page),
    data: (ctx) => ({ selector: "#main", text: ctx.sealed!.medicine }),
    sealed: true,
  },
  {
    id: "in-app.D.patient",
    role: "doctor",
    from: () => "/patients",
    to: (ctx) => `/patients/${ctx.patientId}`,
    click: (page, ctx) => inMain(`/patients/${ctx.patientId}`)(page),
    data: (ctx) => ({ selector: "#main h1", text: ctx.patientName }),
  },
  {
    id: "in-app.O.settings-clinic",
    role: "owner",
    from: () => "/today",
    to: () => "/settings/clinic",
    click: nav("Clinic Profile"),
    data: () => ({ selector: "[data-rx-print-settings]" }),
  },
  {
    id: "in-app.O.staff",
    role: "owner",
    from: () => "/today",
    to: () => "/staff",
    click: nav("Staff & Team"),
    data: () => ({ selector: "#main .divide-y > div" }),
  },
  {
    id: "in-app.O.billing-reports",
    role: "owner",
    from: () => "/today",
    to: () => "/billing/reports",
    click: nav("Billing & Reports"),
    data: () => TABLE_ROW,
  },
];

export function fullLoadId(id: string): string {
  return id.replace(/^in-app\./, "full.");
}

/**
 * The full-load twin of an in-app row: the same page, opened by an address, with the same first data element. The in-app Billing reports row is the
 * owner's (the receptionist has the permission but no nav link); its full-load row is the receptionist's, as the plan lists it.
 */
export const FULL_ROWS: readonly PageRowDef[] = [
  ...PAGE_ROWS.filter((r) => r.id !== "in-app.O.billing-reports").map((r) => ({ ...r, id: fullLoadId(r.id) })),
  { ...PAGE_ROWS.find((r) => r.id === "in-app.O.billing-reports")!, id: "full.R.billing-reports", role: "receptionist" as const },
];
