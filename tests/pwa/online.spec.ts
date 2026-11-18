/**
 * The offline banner's "showing data from …" time (V2-06 06-05 step 9; 06-09a IND L-4): the last successful data
 * response, from Resource Timing, driven here with stand-in `window`, `navigator`, `performance` and
 * `PerformanceObserver`. 06-05 kept "when the offline event was seen" in state only listeners updated, so a device that
 * went offline and back online while no banner was mounted showed the first outage's time on the next one (the last
 * case below fails on 06-05's lib/pwa/online.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const T0 = Date.UTC(2026, 10, 14, 5, 0, 0);
let observerCallback: ((list: { getEntries(): unknown[] }) => void) | null;
let nav: { onLine: boolean };

beforeEach(() => {
  vi.resetModules();
  observerCallback = null;
  nav = { onLine: true };
  const events = new EventTarget();
  vi.stubGlobal("window", events);
  vi.stubGlobal("navigator", nav);
  vi.stubGlobal("performance", {
    timeOrigin: T0,
    getEntriesByType: (type: string) => (type === "navigation" ? [{ entryType: "navigation", responseEnd: 1_000 }] : []),
  });
  vi.stubGlobal(
    "PerformanceObserver",
    class {
      constructor(cb: (list: { getEntries(): unknown[] }) => void) {
        observerCallback = cb;
      }
      observe() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function store() {
  return (await import("@/lib/pwa/online")).onlineStore;
}

function resource(entries: unknown[]) {
  observerCallback?.({ getEntries: () => entries });
}

describe("responseTimeOf", () => {
  it("counts the document and fetches with a response; not scripts, styles or network errors", async () => {
    const { responseTimeOf } = await import("@/lib/pwa/online");
    expect(responseTimeOf({ entryType: "navigation", responseEnd: 500 }, T0)).toBe(T0 + 500);
    expect(responseTimeOf({ initiatorType: "fetch", responseEnd: 900.4, responseStatus: 200 }, T0)).toBe(T0 + 900);
    expect(responseTimeOf({ initiatorType: "xmlhttprequest", responseEnd: 10 }, T0)).toBe(T0 + 10);
    expect(responseTimeOf({ initiatorType: "script", responseEnd: 10, responseStatus: 200 }, T0)).toBeNull();
    expect(responseTimeOf({ initiatorType: "link", responseEnd: 10 }, T0)).toBeNull();
    expect(responseTimeOf({ initiatorType: "fetch", responseEnd: 10, responseStatus: 0 }, T0)).toBeNull();
    expect(responseTimeOf({ initiatorType: "fetch", responseEnd: 0 }, T0)).toBeNull();
  });
});

describe("onlineStore", () => {
  it("online: no time; offline: the last data response", async () => {
    const s = await store();
    const stop = s.subscribe(() => undefined);
    expect(s.sinceSnapshot()).toBeNull();
    resource([{ initiatorType: "fetch", responseEnd: 60_000, responseStatus: 200 }]);
    nav.onLine = false;
    expect(s.sinceSnapshot()).toBe(T0 + 60_000);
    stop();
  });

  it("a later response counts even when it arrived while no banner was mounted; an earlier one never moves the time back", async () => {
    const s = await store();
    // First outage, banner mounted.
    nav.onLine = false;
    const stop = s.subscribe(() => undefined);
    expect(s.sinceSnapshot()).toBe(T0 + 1_000);
    stop();
    // Back online with no listener; the page fetches data, then goes offline again.
    nav.onLine = true;
    resource([{ initiatorType: "fetch", responseEnd: 3_600_000, responseStatus: 200 }]);
    resource([{ initiatorType: "fetch", responseEnd: 2_000, responseStatus: 200 }]);
    nav.onLine = false;
    const again = s.subscribe(() => undefined);
    expect(s.sinceSnapshot()).toBe(T0 + 3_600_000);
    again();
  });
});
