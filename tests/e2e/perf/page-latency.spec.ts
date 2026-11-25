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
import { readRunData, storageStatePath } from "../support/run-data";
import { psql } from "../../helpers/sql";
import { armTimer, clearSupabaseLatency, seenAt, setSupabaseLatency, timeFullLoad, timeToVisible, timerEpoch, waitForQuiet, watchEpoch } from "../support/latency";
import { routeLoopbackOnly } from "../fixtures";
import { budgetRow } from "./latency-budgets";
import { endLane, holdBackground, resetLane, runRow, writeReport, LATENCY_MS } from "./latency-run";
import { FULL_ROWS, PAGE_ROWS, pageContext } from "./latency-pages";
import { SAVE_ROWS, TYPEAHEAD_ROWS, typeaheadAct } from "./latency-saves";
import { seedBookedToday, todayName } from "../support/today-data";
import { deletePerfCatalogue, upsertPerfCatalogue } from "../support/perf-catalogue";
import { getAdminClient } from "../../helpers/supabase-admin";
import fs from "node:fs";
import path from "node:path";
import type { CDPSession, Page } from "@playwright/test";
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
        if (LATENCY_MS > 0 && !budgetRow(def.id).zeroCalls) expect(result.depth!.max, def.id).toBeGreaterThanOrEqual(1);
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
  // The medicine row runs on the full-size synthetic catalogue, below.
  for (const def of TYPEAHEAD_ROWS.filter((r) => r.id !== "type.D.medicine")) {
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

/**
 * 09E-11 (R-7, B-4, B-14): the medicine catalogue at real size. The synthetic catalogue (tests/e2e/support/perf-catalogue.ts: 93,911 brands, 10,305
 * generics, 3,283 substances, 1,550 diagnoses) is upserted before these rows and deleted after them (and by the global setup if a run died), so no
 * other row downloads it.
 */
test.describe("medicines on the full-size synthetic catalogue (B-4, B-14)", () => {
  // H-1 (09E-NOTES): blocked until 000129 (the late brand shards of `public.reference_shard` timed out at full size under 000128); now run on every PR
  // (`type.D.medicine` is in the @budget subset).
  test.use({ storageState: storageStatePath("doctor"), timezoneId: "Asia/Kolkata" });
  test.beforeAll(async () => {
    test.setTimeout(TEST_TIMEOUT_MS);
    const admin = getAdminClient();
    await deletePerfCatalogue(admin);
    await upsertPerfCatalogue(admin);
  });
  test.afterAll(async () => {
    test.setTimeout(TEST_TIMEOUT_MS);
    await deletePerfCatalogue(getAdminClient());
  });

  const medicineRow = TYPEAHEAD_ROWS.find((r) => r.id === "type.D.medicine")!;
  const typeRow = budgetRow(medicineRow.id);
  test(`${medicineRow.id}${typeRow.pr ? " @budget" : ""}: ${typeRow.label}`, async ({ page, context }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    const holds = await holdBackground(page);
    const result = await runRow({
      id: medicineRow.id,
      main: "option",
      page,
      context,
      holds,
      prepare: () => medicineRow.prepare(page),
      act: (state) => typeaheadAct(page, state),
    });
    expect(result.ms.median, medicineRow.id).not.toBeNull();
    clearSupabaseLatency();
  });

  const refRow = budgetRow("ref.D.cdci-download");
  test(`${refRow.id}${refRow.pr ? " @budget" : ""}: ${refRow.label}`, async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    // A fresh device (empty IndexedDB, empty HTTP cache): the shell downloads the catalogues after first paint. 4x CPU for the build (R-4).
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    const requests = new Map<string, { url: string; encoding: string; status: number }>();
    const transferred = new Map<string, number>();
    cdp.on("Network.responseReceived", (e) => {
      if (/\/api\/reference\/(substances|medicines)\//.test(e.response.url)) {
        const headers = Object.fromEntries(Object.entries(e.response.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
        requests.set(e.requestId, { url: new URL(e.response.url).pathname, encoding: headers["content-encoding"] ?? "identity", status: e.response.status });
      }
    });
    cdp.on("Network.loadingFinished", (e) => {
      if (requests.has(e.requestId)) transferred.set(e.requestId, e.encodedDataLength);
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    try {
      await page.goto("/today");
      await expect
        .poll(() => page.evaluate(() => performance.getEntriesByName("clinicos.medicine_index").length), { timeout: 5 * 60_000, message: "the medicine index is built" })
        .toBeGreaterThan(0);
      const build = await page.evaluate(() => {
        const m = performance.getEntriesByName("clinicos.medicine_index")[0] as PerformanceMeasure;
        return { buildMs: Math.round(m.duration * 10) / 10, mode: (m.detail as { mode?: string } | null)?.mode ?? null };
      });
      const heap = await workerHeap(cdp);
      await expect.poll(() => storedShards(page, "medicines"), { timeout: 60_000, message: "the medicine catalogue is stored" }).toBeGreaterThan(0);
      const usage = await page.evaluate(async () => (await navigator.storage.estimate()).usage ?? null);

      // One version: the medicine shards' version (substances share it: both are the `cdci` source).
      const all = [...requests.entries()].filter(([id, r]) => r.status === 200 && transferred.has(id)).map(([id, r]) => ({ ...r, bytes: transferred.get(id)! }));
      const version = all.filter((r) => r.url.startsWith("/api/reference/medicines/")).map((r) => r.url.split("/")[4]).pop();
      const ofVersion = all.filter((r) => r.url.split("/")[4] === version);
      const bytes = ofVersion.reduce((n, r) => n + r.bytes, 0);
      const report = {
        row: refRow.id,
        budget: refRow.budget,
        maxBytes: refRow.maxBytes,
        transferredBytes: bytes,
        verdict: bytes <= refRow.maxBytes! ? "within" : "over",
        requests: ofVersion,
        indexedDbUsageBytes: usage,
        indexBuild: { ...build, cpuThrottling: 4 },
        workerHeapUsedBytes: heap,
        note: "bytes = encodedDataLength of each 200 shard response of one cdci version (substances + medicines), HTTP cache disabled; IndexedDB usage from navigator.storage.estimate(); build = the page's clinicos.medicine_index measure; heap = Runtime.getHeapUsage of the worker target (null when it could not be read)",
      };
      fs.mkdirSync(path.join(process.cwd(), "test-results/perf-latency"), { recursive: true });
      fs.writeFileSync(path.join(process.cwd(), "test-results/perf-latency/reference-download.json"), `${JSON.stringify(report, null, 2)}\n`);
      console.log(`[perf-latency] ${refRow.id}: ${bytes} bytes transferred (max ${refRow.maxBytes}), IndexedDB ${usage}, build ${build.buildMs} ms (${build.mode}), worker heap ${heap}`);
      expect(ofVersion.some((r) => r.url.startsWith("/api/reference/medicines/")), "the medicine shards were downloaded").toBe(true);
      expect(bytes, "B-14: bytes transferred for one CDCI version").toBeLessThanOrEqual(refRow.maxBytes!);
    } finally {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    }
  });
});

/** Shard records of `catalogue` in the device store. */
async function storedShards(page: Page, catalogue: string): Promise<number> {
  return page.evaluate(
    (name) =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open("cliniq-reference");
        open.onerror = () => resolve(0);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("meta")) {
            db.close();
            resolve(0);
            return;
          }
          const req = db.transaction("meta", "readonly").objectStore("meta").get(name);
          req.onsuccess = () => {
            db.close();
            resolve((req.result as { shards?: number } | undefined)?.shards ?? 0);
          };
          req.onerror = () => {
            db.close();
            resolve(0);
          };
        };
      }),
    catalogue,
  );
}

/** The used heap of the page's dedicated worker (Runtime.getHeapUsage through a non-flat CDP session to the worker target), or null. */
async function workerHeap(cdp: CDPSession): Promise<number | null> {
  try {
    const { targetInfos } = (await cdp.send("Target.getTargets")) as { targetInfos: Array<{ targetId: string; type: string }> };
    const target = targetInfos.find((t) => t.type === "worker");
    if (!target) return null;
    const { sessionId } = (await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: false })) as { sessionId: string };
    const answer = new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 5_000);
      cdp.on("Target.receivedMessageFromTarget", (e: { sessionId: string; message: string }) => {
        if (e.sessionId !== sessionId) return;
        const msg = JSON.parse(e.message) as { id?: number; result?: { usedSize?: number } };
        if (msg.id === 1) {
          clearTimeout(timer);
          resolve(msg.result?.usedSize ?? null);
        }
      });
    });
    await cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id: 1, method: "Runtime.getHeapUsage" }) });
    return await answer;
  } catch {
    return null;
  }
}

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

  test("live.today.refresh: Today's refresh (a signal) is one board read (09E-03, 09E-04)", async ({ page, context }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    const holds = await holdBackground(page);
    const result = await runRow({
      id: "live.today.refresh",
      main: "refresh",
      idle: "quiet",
      page,
      context,
      holds,
      prepare: async () => {
        await openToday(page);
        // The channel has joined and its catch-up check has answered (the badge says Live), so that check is not a call of the measured window (09E-06).
        await expect(page.locator("[data-live-status]")).toHaveText("Live", { timeout: 20_000 });
        await waitForQuiet(1_500);
        // The page's own check on subscription must be over.
        await page.waitForTimeout(2_200);
      },
      act: async () => {
        // 09E-04 (R-18): a refresh happens when a clinic version moved. The change is made in the database directly (psql, not through Kong, so it is no
        // call of the window): a visit of the clinic gets another length, the signal reaches the page, and the board is read once.
        const started = Date.now();
        const answered = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/today/board");
        psql(
          `update public.visits set estimated_duration_minutes = case when estimated_duration_minutes = 20 then 25 else 20 end where id = '${readRunData().tenantA.visitId}'`,
        );
        await answered;
        return { refresh: Date.now() - started };
      },
    });
    expect(result.samples.length).toBeGreaterThan(0);
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
