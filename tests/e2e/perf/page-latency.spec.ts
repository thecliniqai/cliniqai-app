/**
 * V2-09e 09E-01 (R-2 to R-4): the latency lane. Every main screen, typeahead and save is measured with `PERF_LATENCY_MS` (default 300) added to
 * every Supabase call: the calls it makes (Kong), its round-trip depth (the intervals the injection recorded) and its time (inside the page).
 * `npm run perf:latency` (project `perf-latency`, desktop-chrome, one worker, no retries); `-- --grep @budget` is the per-PR subset; `PERF_LATENCY_MS=0`
 * is the reference run (nothing delayed; calls only).
 *
 * Calls and depth block against `latency-budgets.ts` (the baseline's ceilings); milliseconds are reported in `test-results/perf-latency/summary.{json,md}`
 * and never fail a test. The calibration (every recorded call lasted the injected delay; the recorded count equals Kong's) is enforced on every sample.
 * A failing row is root-caused like a flaky test, never re-run to green.
 */
import { expect, test } from "../fixtures";
import { storageStatePath } from "../support/run-data";
import { clearSupabaseLatency, timeToVisible } from "../support/latency";
import { budgetRow } from "./latency-budgets";
import { endLane, holdBackground, resetLane, runRow, writeReport, LATENCY_MS } from "./latency-run";
import { PAGE_ROWS, pageContext } from "./latency-pages";

test.describe.configure({ mode: "serial", retries: 0 });
test.beforeEach(() => test.skip(test.info().project.name !== "perf-latency", "the latency lane runs in the perf-latency project only"));
test.beforeAll(() => resetLane());
test.afterAll(() => {
  writeReport();
  endLane();
});

test.describe("page rows, in-app (B-1, B-2)", () => {
  for (const def of PAGE_ROWS) {
    test.describe(def.role, () => {
      test.use({ storageState: storageStatePath(def.role) });
      const row = budgetRow(def.id);
      test(`${def.id}${row.pr ? " @budget" : ""}: ${row.label}`, async ({ page, context }) => {
        test.setTimeout(10 * 60_000);
        const ctx = pageContext();
        const holds = await holdBackground(page);
        const result = await runRow({
          id: def.id,
          main: "data",
          page,
          context,
          holds,
          prepare: async () => {
            await page.goto(def.from);
            await page.waitForLoadState("networkidle");
            return ctx;
          },
          act: async () => {
            const link = def.link ? def.link(page, ctx) : null;
            if (!link) throw new Error(`${def.id}: no link`);
            const { skeletonMs, dataMs } = await timeToVisible(page, () => link.click(), def.data(ctx));
            const to = new URL(def.to(ctx), "http://x");
            await page.waitForURL((u) => u.pathname === to.pathname);
            return { skeleton: skeletonMs, data: dataMs };
          },
        });
        expect(result.samples.length).toBeGreaterThan(0);
        // The tracer's own acceptance: a navigation made calls, waited for them (depth >= 1 above 0 ms) and took time.
        if (LATENCY_MS > 0) expect(result.depth!.max, def.id).toBeGreaterThanOrEqual(1);
        expect(result.ms.median, def.id).not.toBeNull();
        clearSupabaseLatency();
      });
    });
  }
});
