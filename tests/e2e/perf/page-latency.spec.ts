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
import { armTimer, clearSupabaseLatency, seenAt, setSupabaseLatency, timeFullLoad, timeToVisible, timerEpoch, waitForQuiet, watchEpoch } from "../support/latency";
import { routeLoopbackOnly } from "../fixtures";
import { budgetRow } from "./latency-budgets";
import { endLane, holdBackground, resetLane, runRow, writeReport, LATENCY_MS } from "./latency-run";
import { FULL_ROWS, PAGE_ROWS, pageContext } from "./latency-pages";
import { SAVE_ROWS, TYPEAHEAD_ROWS, typeaheadAct } from "./latency-saves";
import { seedBookedToday, todayName } from "../support/today-data";
import { filterToday, openToday, rowInLane } from "../support/today-page";

/** One row (warm-up and every sample) must finish inside this; a hung step fails the row instead of the whole job. */
const TEST_TIMEOUT_MS = Number(process.env.PERF_LATENCY_TEST_TIMEOUT_MS ?? 10 * 60_000);

test.describe.configure({ retries: 0 });
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
        test.setTimeout(TEST_TIMEOUT_MS);
        const ctx = await pageContext(Boolean(def.sealed));
        const holds = await holdBackground(page);
        const result = await runRow({
          id: def.id,
          main: "data",
          page,
          context,
          holds,
          prepare: async () => {
            await page.goto(def.from(ctx));
            await page.waitForLoadState("networkidle");
            return ctx;
          },
          act: async () => {
            const link = def.click(page, ctx);
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

test.describe("page rows, full load (B-3)", () => {
  for (const def of FULL_ROWS) {
    test.describe(def.role, () => {
      test.use({ storageState: storageStatePath(def.role) });
      const row = budgetRow(def.id);
      test(`${def.id}${row.pr ? " @budget" : ""}: ${row.label}`, async ({ page, context }) => {
        test.setTimeout(TEST_TIMEOUT_MS);
        const ctx = await pageContext(Boolean(def.sealed));
        const holds = await holdBackground(page);
        const result = await runRow({
          id: def.id,
          main: "data",
          page,
          context,
          holds,
          prepare: async () => {
            await page.goto("about:blank");
            return ctx;
          },
          act: async () => {
            const { dataMs, responseEndMs } = await timeFullLoad(page, def.to(ctx), def.data(ctx));
            return { data: dataMs, responseEnd: responseEndMs };
          },
        });
        expect(result.samples.length).toBeGreaterThan(0);
        expect(new URL(page.url()).pathname, `${def.id} landed where it was sent`).toBe(new URL(def.to(ctx), "http://x").pathname);
        clearSupabaseLatency();
      });
    });
  }
});

test.describe("typeahead rows (B-4, B-5)", () => {
  for (const def of TYPEAHEAD_ROWS) {
    test.describe(def.role, () => {
      test.use({ storageState: storageStatePath(def.role), timezoneId: "Asia/Kolkata" });
      const row = budgetRow(def.id);
      test(`${def.id}${row.pr ? " @budget" : ""}: ${row.label}`, async ({ page, context }) => {
        test.setTimeout(TEST_TIMEOUT_MS);
        const holds = await holdBackground(page);
        const result = await runRow({
          id: def.id,
          main: "option",
          page,
          context,
          holds,
          prepare: () => def.prepare(page),
          act: (state) => typeaheadAct(page, state),
        });
        expect(result.ms.median, def.id).not.toBeNull();
        clearSupabaseLatency();
      });
    });
  }
});

test.describe("save rows (B-6, B-7, B-8)", () => {
  for (const def of SAVE_ROWS) {
    test.describe(def.role, () => {
      test.use({ storageState: storageStatePath(def.role), timezoneId: "Asia/Kolkata" });
      const row = budgetRow(def.id);
      test(`${def.id}${row.pr ? " @budget" : ""}: ${row.label}`, async ({ page, context }) => {
        test.setTimeout(TEST_TIMEOUT_MS);
        const holds = await holdBackground(page);
        const result = await runRow({
          id: def.id,
          main: "confirmed",
          page,
          context,
          holds,
          prepare: () => def.prepare(page),
          act: (state) => def.act(page, state),
        });
        expect(result.ms.median, def.id).not.toBeNull();
        clearSupabaseLatency();
      });
    });
  }
});

test.describe("live (B-11)", () => {
  test.use({ storageState: storageStatePath("receptionist") });
  test("live.R.check-in-elsewhere: a check-in made in a second browser moves the row here", async ({ page, context, browser }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    const blocked: string[] = [];
    const other = await browser.newContext({ storageState: storageStatePath("receptionist") });
    await routeLoopbackOnly(other, blocked);
    await setSupabaseLatency(other, LATENCY_MS);
    const second = await other.newPage();
    // This page keeps its live refresh (the liveness probe is not held); the second browser holds its own.
    const holds = await holdBackground(page, { health: false });
    await holdBackground(second);
    try {
      await runRow({
        id: "live.R.check-in-elsewhere",
        main: "visible",
        idle: "quiet",
        page,
        context,
        holds,
        prepare: async () => {
          const name = todayName("PerfLive");
          await seedBookedToday(name);
          for (const p of [page, second]) {
            await openToday(p);
            // A live screen keeps its channel and liveness probe going: wait for the server to be quiet, not for the network.
            await waitForQuiet(1_500);
            await filterToday(p, name);
          }
          await expect(rowInLane(page, "booked", name)).toBeVisible();
          return { name };
        },
        act: async (state) => {
          const { name } = state as { name: string };
          await watchEpoch(page, { selector: '[data-lane="waiting"] [data-queue-row]', text: name });
          await armTimer(second, {}, { event: "click" });
          await rowInLane(second, "booked", name).getByRole("button", { name: `Check in ${name}` }).click();
          const seen = await seenAt(page);
          const zero = await timerEpoch(second);
          return { visible: Math.round((seen - zero) * 10) / 10 };
        },
      });
    } finally {
      await other.close();
    }
    expect(blocked, "the second browser reached only loopback").toEqual([]);
    clearSupabaseLatency();
  });
});

test.describe("background requests (R-4)", () => {
  test.use({ storageState: storageStatePath("receptionist") });
  test("bg.session-status: the shell's status check, counted on its own", async ({ page, context }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    // Nothing is held here: the request is the measure.
    const holds = { status: false };
    await page.route("**/api/health", (route) => route.fulfill({ status: 503, body: "" }));
    const result = await runRow({
      id: "bg.session-status",
      main: "data",
      page,
      context,
      holds,
      prepare: async () => {
        await page.goto("/patients");
        await page.waitForLoadState("networkidle");
        return null;
      },
      act: async () => {
        const ms = await page.evaluate(async () => {
          const t0 = performance.now();
          const res = await fetch("/api/session-status", { credentials: "include", cache: "no-store" });
          await res.arrayBuffer();
          if (!res.ok) throw new Error(`session-status answered ${res.status}`);
          return Math.round((performance.now() - t0) * 10) / 10;
        });
        return { data: ms };
      },
    });
    expect(result.calls.max, "the status check reads the database").toBeGreaterThan(0);
    clearSupabaseLatency();
  });
});
