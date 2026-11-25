/**
 * V2-09e 09E-01 (R-2, R-4): the latency budgets, one row per measure. The lane (`page-latency.spec.ts`, `npm run perf:latency`) measures every row
 * with 300 ms added to every Supabase call; the PR lane's request-budget spec reads its ceilings from here too.
 *
 * - `maxCalls` and `maxDepth` BLOCK (deterministic): a sample whose Supabase calls exceed `maxCalls`, or whose round-trip depth exceeds `maxDepth`,
 *   fails. They start at the measured baseline (`latency-ceilings.json`, written from the baseline lane's JSON by `scripts/perf/latency-ceilings.mjs`;
 *   never typed) and each plan lowers its rows in the commit that meets the target. Raising one is a PO question.
 * - `targetMs` and `maxMs` are REPORTED, never enforced: wall clock on shared runners would flake (decision 8).
 * - `owner` is the plan that brings the row to its target; `budget` is the B-n tag of the plan's budget table.
 *
 * Rows that no plan has built yet are listed with `kind: "later"` so the table is complete from the first commit; they are measured when their plan lands.
 */
import ceilings from "./latency-ceilings.json";

export type BudgetKind =
  | "page-in-app" // click on a link, skeleton, first data element (B-1, B-2)
  | "page-full" // page.goto, first data element (B-3)
  | "typeahead" // last keystroke, first option (B-4, B-5)
  | "save" // click or Enter, pending, confirmed (B-6, B-7, B-8)
  | "live" // a change in another browser, visible here (B-11)
  | "background" // a request the shell makes on its own
  | "request-budget" // the PR lane's per-path ceilings (V2-09d)
  | "reference" // the reference catalogue download (B-14): bytes, blocking
  | "later";

export interface CeilingSource {
  maxCalls: number;
  maxDepth: number;
  /** Where the numbers come from: the baseline summary's entry (`summary.json` path#row id). Never typed. */
  source: string;
}

export interface BudgetRow {
  id: string;
  kind: BudgetKind;
  /** The B-n tag in the plan's budget table. */
  budget: string;
  label: string;
  /** Report-only (ms). */
  targetMs?: number;
  maxMs?: number;
  /** Report-only (ms): the layout skeleton visible after the click (B-2). */
  skeletonTargetMs?: number;
  /** The plan that brings the row to its target. */
  owner: string;
  /** Per-path ceilings of a `request-budget` row (the V2-09d spec): `"GET /auth/v1/user" -> 0`. */
  byPath?: Record<string, number>;
  /** Part of the per-PR `@budget` subset (R-4). */
  pr?: boolean;
  /**
   * `save` rows (09E-08, B-7): the RSC page requests the save may cause (blocking, default 0). The Schedule is a server-rendered screen until 09E-12, so a
   * save made there refreshes its route once; sign and finish reads the sealed record once (`router.refresh`); a start navigates to the consult.
   */
  maxRsc?: number;
  /** `reference` rows (09E-11, B-14): the most bytes the browser may transfer for one catalogue version (blocking). */
  maxBytes?: number;
}

const ONE_SECOND = { targetMs: 1_000, maxMs: 1_300, skeletonTargetMs: 150 };
const FULL_LOAD = { targetMs: 1_500, maxMs: 2_000 };
const TYPEAHEAD = { targetMs: 100, maxMs: 150 };
const SAVE_CONFIRMED = { targetMs: 500, maxMs: 700 };
const SAVE_REVERSIBLE = { targetMs: 100, maxMs: 150 };

/** Every measure of the latency lane. The role letter in an id: R receptionist, D doctor, O owner. */
export const BUDGET_ROWS: readonly BudgetRow[] = [
  // B-1, B-2: in-app, link click to the first data element
  { id: "in-app.R.today", kind: "page-in-app", budget: "B-1", label: "Receptionist: Today (nav link)", ...ONE_SECOND, owner: "09E-06", pr: true },
  { id: "in-app.R.schedule-day", kind: "page-in-app", budget: "B-1", label: "Receptionist: Schedule, day (nav link)", ...ONE_SECOND, owner: "09E-12", pr: true },
  { id: "in-app.R.schedule-week", kind: "page-in-app", budget: "B-1", label: "Receptionist: Schedule, week (view switch)", ...ONE_SECOND, owner: "09E-12" },
  { id: "in-app.R.patients", kind: "page-in-app", budget: "B-1", label: "Receptionist: Patients (nav link)", ...ONE_SECOND, owner: "09E-06", pr: true },
  { id: "in-app.R.patient", kind: "page-in-app", budget: "B-1", label: "Receptionist: a patient (row link)", ...ONE_SECOND, owner: "09E-06" },
  { id: "in-app.R.visits", kind: "page-in-app", budget: "B-1", label: "Receptionist: Visits (nav link)", ...ONE_SECOND, owner: "09E-06" },
  { id: "in-app.D.today", kind: "page-in-app", budget: "B-1", label: "Doctor: Today, doctor mode (nav link)", ...ONE_SECOND, owner: "09E-06" },
  { id: "in-app.D.consult-draft", kind: "page-in-app", budget: "B-1", label: "Doctor: a consult in draft (Open consult)", ...ONE_SECOND, owner: "09E-05", pr: true },
  { id: "in-app.D.consult-sealed", kind: "page-in-app", budget: "B-1", label: "Doctor: a sealed consult (Visits row link)", ...ONE_SECOND, owner: "09E-05" },
  { id: "in-app.D.patient", kind: "page-in-app", budget: "B-1", label: "Doctor: a patient (Patients row link)", ...ONE_SECOND, owner: "09E-06" },
  { id: "in-app.O.settings-clinic", kind: "page-in-app", budget: "B-1", label: "Owner: Settings, clinic (nav link)", ...ONE_SECOND, owner: "09E-06" },
  { id: "in-app.O.staff", kind: "page-in-app", budget: "B-1", label: "Owner: Staff (nav link)", ...ONE_SECOND, owner: "09E-06" },
  { id: "in-app.O.billing-reports", kind: "page-in-app", budget: "B-1", label: "Owner: Billing reports (nav link; the receptionist has the permission but no link)", ...ONE_SECOND, owner: "09E-06" },

  // B-3: full load of the same pages
  { id: "full.R.today", kind: "page-full", budget: "B-3", label: "Receptionist: Today, full load", ...FULL_LOAD, owner: "09E-06" },
  { id: "full.R.schedule-day", kind: "page-full", budget: "B-3", label: "Receptionist: Schedule, day, full load", ...FULL_LOAD, owner: "09E-12" },
  { id: "full.R.schedule-week", kind: "page-full", budget: "B-3", label: "Receptionist: Schedule, week, full load", ...FULL_LOAD, owner: "09E-12" },
  { id: "full.R.patients", kind: "page-full", budget: "B-3", label: "Receptionist: Patients, full load", ...FULL_LOAD, owner: "09E-06" },
  { id: "full.R.patient", kind: "page-full", budget: "B-3", label: "Receptionist: a patient, full load", ...FULL_LOAD, owner: "09E-06" },
  { id: "full.R.visits", kind: "page-full", budget: "B-3", label: "Receptionist: Visits, full load", ...FULL_LOAD, owner: "09E-06" },
  { id: "full.R.billing-reports", kind: "page-full", budget: "B-3", label: "Receptionist: Billing reports, full load", ...FULL_LOAD, owner: "09E-06" },
  { id: "full.D.today", kind: "page-full", budget: "B-3", label: "Doctor: Today, full load", ...FULL_LOAD, owner: "09E-06" },
  { id: "full.D.consult-draft", kind: "page-full", budget: "B-3", label: "Doctor: a consult in draft, full load", ...FULL_LOAD, owner: "09E-05" },
  { id: "full.D.consult-sealed", kind: "page-full", budget: "B-3", label: "Doctor: a sealed consult, full load", ...FULL_LOAD, owner: "09E-05" },
  { id: "full.D.patient", kind: "page-full", budget: "B-3", label: "Doctor: a patient, full load", ...FULL_LOAD, owner: "09E-06" },
  { id: "full.O.settings-clinic", kind: "page-full", budget: "B-3", label: "Owner: Settings, clinic, full load", ...FULL_LOAD, owner: "09E-06" },
  { id: "full.O.staff", kind: "page-full", budget: "B-3", label: "Owner: Staff, full load", ...FULL_LOAD, owner: "09E-06" },

  // B-4, B-5: typeahead (the last keystroke to the first option)
  { id: "type.D.medicine", kind: "typeahead", budget: "B-4", label: "Doctor: medicine search (Rx field, on the device, full-size synthetic catalogue)", ...TYPEAHEAD, owner: "09E-11", pr: true },
  { id: "type.D.diagnosis", kind: "typeahead", budget: "B-4", label: "Doctor: diagnosis search (on the device)", ...TYPEAHEAD, owner: "09E-10", pr: true },
  { id: "type.D.substance", kind: "typeahead", budget: "B-4", label: "Doctor: allergy substance search (on the device)", ...TYPEAHEAD, owner: "09E-09", pr: true },
  { id: "type.R.patient-today", kind: "typeahead", budget: "B-5", label: "Receptionist: patient search on Today (walk-in)", targetMs: 700, maxMs: 900, owner: "measured, not changed" },
  { id: "type.R.patient-register", kind: "typeahead", budget: "B-5", label: "Receptionist: patient search in the booking sheet", targetMs: 700, maxMs: 900, owner: "measured, not changed" },

  // B-6, B-7, B-8: saves (click or Enter, the pending state, the server-confirmed state)
  { id: "save.R.check-in", kind: "save", budget: "B-7", label: "Receptionist: check in", ...SAVE_CONFIRMED, owner: "09E-08", pr: true },
  { id: "save.R.register-book", kind: "save", maxRsc: 1, budget: "B-7", label: "Receptionist: register and book", ...SAVE_CONFIRMED, owner: "09E-08" },
  { id: "save.R.book", kind: "save", maxRsc: 1, budget: "B-7", label: "Receptionist: book from Schedule", ...SAVE_CONFIRMED, owner: "09E-08" },
  { id: "save.R.reschedule", kind: "save", maxRsc: 1, budget: "B-7", label: "Receptionist: reschedule", ...SAVE_CONFIRMED, owner: "09E-08" },
  { id: "save.R.cancel", kind: "save", maxRsc: 1, budget: "B-7", label: "Receptionist: cancel", ...SAVE_CONFIRMED, owner: "09E-08" },
  { id: "save.R.collect", kind: "save", budget: "B-7", label: "Receptionist: collect payment", ...SAVE_CONFIRMED, owner: "09E-08" },
  { id: "save.D.start-consult", kind: "save", maxRsc: 2, budget: "B-7", label: "Doctor: start consult", ...SAVE_CONFIRMED, owner: "09E-08" },
  { id: "save.D.draft-autosave", kind: "save", budget: "B-6", label: "Doctor: draft autosave", ...SAVE_REVERSIBLE, owner: "09E-08" },
  { id: "save.D.add-diagnosis", kind: "save", budget: "B-6", label: "Doctor: add a diagnosis", ...SAVE_REVERSIBLE, owner: "09E-08" },
  { id: "save.D.add-rx-line", kind: "save", budget: "B-6", label: "Doctor: add an Rx line by keyboard", ...SAVE_REVERSIBLE, owner: "09E-08", pr: true },
  { id: "save.D.edit-rx-line", kind: "save", budget: "B-6", label: "Doctor: edit an Rx line", ...SAVE_REVERSIBLE, owner: "09E-08" },
  { id: "save.D.allergies", kind: "save", budget: "B-7", label: "Doctor: record allergies", ...SAVE_CONFIRMED, owner: "09E-08" },
  { id: "save.D.sign-finish", kind: "save", maxRsc: 1, budget: "B-8", label: "Doctor: sign and finish", targetMs: 1_000, maxMs: 1_400, owner: "09E-08" },

  // B-11: a change made in another browser
  { id: "live.R.check-in-elsewhere", kind: "live", budget: "B-11", label: "Receptionist: a check-in made in a second browser moves the row", targetMs: 2_000, maxMs: 3_000, owner: "09E-04" },

  // B-11, the board's own re-read (09E-03): one `GET /api/today/board` into the board's query, at the current service's calls and depth until 09E-06 lowers it to 1 and 1.
  { id: "live.today.refresh", kind: "live", budget: "B-11", label: "Receptionist: Today's refresh (a signal or a resume) is one board read", owner: "09E-06" },

  // B-14: the CDCI reference download (09E-11): bytes transferred per version block; IndexedDB bytes, the worker's index build at 4x CPU and its heap are
  // reported. "0 calls during use" is the medicine typeahead row above.
  {
    id: "ref.D.cdci-download",
    kind: "reference",
    budget: "B-14",
    label: "Doctor: CDCI reference download, one version (substances + medicines, full-size synthetic catalogue)",
    targetMs: 1_500,
    maxBytes: 1_600_000,
    owner: "09E-11",
  },

  // Background requests the shell makes on its own (held during every measured window, R-4)
  { id: "bg.session-status", kind: "background", budget: "R-4", label: "The shell's session status check (on load, resume, every 5 min)", owner: "09E-13" },

  // The V2-09d request-budget spec's per-path ceilings (PR lane; the spec reads them from here)
  {
    id: "request.in-app.patients",
    kind: "request-budget",
    budget: "09D",
    label: "In-app navigation to Patients: no identity or context call",
    owner: "09E-06",
    byPath: { "GET /auth/v1/user": 0, "POST /rest/v1/rpc/my_tenant_access": 0, "GET /rest/v1/memberships": 0 },
  },
  {
    id: "request.in-app.today",
    kind: "request-budget",
    budget: "09D",
    label: "In-app navigation to Today: the doctor directory is the one memberships read",
    owner: "09E-06",
    byPath: { "GET /auth/v1/user": 0, "POST /rest/v1/rpc/my_tenant_access": 0, "GET /rest/v1/memberships": 1 },
  },
  {
    id: "request.full.today",
    kind: "request-budget",
    budget: "09D",
    label: "Full load of Today: the on-load status check is the only Auth and access-level call",
    owner: "09E-06",
    byPath: { "GET /auth/v1/user": 1, "POST /rest/v1/rpc/my_tenant_access": 1, "GET /rest/v1/memberships": 3 },
  },

  // Owned by later plans; listed so the table is complete (measured when the plan lands)
  { id: "later.schedule-adjacent", kind: "later", budget: "B-9", label: "Schedule: an adjacent day or week, prefetched", targetMs: 100, maxMs: 150, owner: "09E-12" },
  { id: "later.schedule-range", kind: "later", budget: "B-10", label: "Schedule: any other range up to 42 days", targetMs: 600, maxMs: 800, owner: "09E-12" },
  { id: "later.live-dropped-signal", kind: "later", budget: "B-12", label: "A change with the signal dropped, recovered by the heartbeat", targetMs: 15_000, owner: "09E-04" },
  { id: "later.heartbeat", kind: "later", budget: "B-13", label: "Heartbeat: 1 call per 12 s while a live screen is visible, 0 while hidden", owner: "09E-04" },
  { id: "later.first-load-js", kind: "later", budget: "B-15", label: "First-load JS of /today and /consultation/[id]", owner: "09E-03" },
];

export function budgetRow(id: string): BudgetRow {
  const row = BUDGET_ROWS.find((r) => r.id === id);
  if (!row) throw new Error(`latency budgets: no row "${id}"`);
  return row;
}

/** The blocking ceilings of a lane row (from the baseline JSON), or null before the baseline has been taken. */
export function ceilingOf(id: string): CeilingSource | null {
  return (ceilings.rows as Record<string, CeilingSource | undefined>)[id] ?? null;
}

/** A `request-budget` row's ceiling for one path (0 when the path is not listed: any call to it is over budget). */
export function pathCeiling(id: string, key: string): number {
  const row = budgetRow(id);
  if (row.kind !== "request-budget" || !row.byPath) throw new Error(`latency budgets: "${id}" is not a request-budget row`);
  return row.byPath[key] ?? 0;
}
