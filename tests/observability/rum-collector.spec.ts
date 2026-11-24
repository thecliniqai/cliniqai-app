/**
 * V2-09e 09E-02 (R-20, T-09E-14): the browser collector (`lib/observability/rum/collector.ts`) and the closed lists (`catalog.ts`). Samples hold
 * a screen word, a metric word, a device class, a network class and a number; nothing else. One sampling decision per session, batches of at most
 * 60, a flush every 60 s and on hide. Synthetic values only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deviceOfWidth,
  netOfType,
  RUM_MAX_SAMPLES,
  RUM_METRICS,
  RUM_SCREENS,
  rumMaxValue,
  screenOfPath,
} from "@/lib/observability/rum/catalog";
import { createCollector, RUM_FLUSH_MS, type CollectorEnv } from "@/lib/observability/rum/collector";
import { rumBatchSchema } from "@/lib/observability/rum/ingest";

const ID = "0b0e4c1a-2d3e-4f50-8a6b-7c8d9e0f1a2b";

function fixture(over: Partial<CollectorEnv> = {}) {
  const sent: Array<{ body: string; beacon: boolean }> = [];
  let clock = 0;
  const store = new Map<string, string>();
  const env: CollectorEnv = {
    sampleRate: 1,
    now: () => clock,
    pathname: () => "/today",
    width: () => 1280,
    effectiveType: () => "4g",
    send: (body, beacon) => (sent.push({ body, beacon }), true),
    getSession: () => store.get("k") ?? null,
    setSession: (v) => void store.set("k", v),
    random: () => 0.5,
    ...over,
  };
  return { collector: createCollector(env), sent, tick: (ms: number) => void (clock += ms), store, env };
}

const batches = (sent: Array<{ body: string }>) => sent.map((s) => JSON.parse(s.body) as { samples: Array<Record<string, unknown>> });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("closed lists", () => {
  it("map a path to a screen word and never keep the path: ids, tokens and unknown paths fall into a word", () => {
    expect(screenOfPath("/")).toBe("today");
    expect(screenOfPath("/today?x=1")).toBe("today");
    expect(screenOfPath("/schedule")).toBe("schedule");
    expect(screenOfPath("/patients")).toBe("patients");
    expect(screenOfPath(`/patients/${ID}`)).toBe("patient");
    expect(screenOfPath(`/consultation/${ID}`)).toBe("consult");
    expect(screenOfPath("/visits")).toBe("visits");
    expect(screenOfPath("/billing/reports")).toBe("billing");
    expect(screenOfPath("/settings/clinic")).toBe("settings");
    expect(screenOfPath("/staff")).toBe("staff");
    expect(screenOfPath(`/r/${ID}`)).toBe("other");
    expect(screenOfPath("/profile")).toBe("other");
    for (const p of ["/", "/patients/9000000001", `/x/${ID}`]) expect(RUM_SCREENS).toContain(screenOfPath(p));
  });

  it("classify the device by width and the network by effectiveType", () => {
    expect([360, 767, 768, 1023, 1024, 1920].map(deviceOfWidth)).toEqual(["phone", "phone", "tablet", "tablet", "desktop", "desktop"]);
    expect(deviceOfWidth(Number.NaN)).toBe("phone");
    expect(["slow-2g", "2g", "3g", "4g", "5g", "wifi", undefined, 4, null].map(netOfType)).toEqual(["slow-2g", "2g", "3g", "4g", "unknown", "unknown", "unknown", "unknown", "unknown"]);
  });

  it("give every metric the database's range", () => {
    expect(rumMaxValue("lcp")).toBe(600_000);
    expect(rumMaxValue("cls")).toBe(100);
    expect(rumMaxValue("live_dropped")).toBe(1000);
    expect(RUM_METRICS).toHaveLength(15);
  });
});

describe("the collector", () => {
  it("keeps closed-list samples and sends them as one batch the route accepts", () => {
    const { collector, sent } = fixture();
    collector.record("lcp", 1800.12345);
    collector.record("cls", 0.07);
    collector.flush();
    const [batch] = batches(sent);
    expect(batch!.samples).toEqual([
      { screen: "today", metric: "lcp", device: "desktop", net: "4g", value: 1800.123 },
      { screen: "today", metric: "cls", device: "desktop", net: "4g", value: 0.07 },
    ]);
    expect(rumBatchSchema.safeParse(batch).success).toBe(true);
    for (const s of batch!.samples) expect(Object.keys(s).sort()).toEqual(["device", "metric", "net", "screen", "value"]);
  });

  it("drops a value that is not a finite number in the metric's range (nothing is sent for it)", () => {
    const { collector, sent } = fixture();
    for (const v of [Number.NaN, Infinity, -1, 600_001]) collector.record("lcp", v);
    collector.record("cls", 101);
    collector.record("live_dropped", 1001);
    collector.flush();
    expect(sent).toEqual([]);
  });

  it("sends at 60 waiting, in batches of at most 60", () => {
    const { collector, sent } = fixture();
    for (let i = 0; i < RUM_MAX_SAMPLES; i++) collector.record("inp", i);
    expect(batches(sent)).toHaveLength(1);
    expect(batches(sent)[0]!.samples).toHaveLength(RUM_MAX_SAMPLES);
    expect(collector.pending()).toBe(0);
  });

  it("flushes every 60 s with a fetch and on hide with a beacon", () => {
    const { collector, sent } = fixture();
    collector.record("fcp", 900);
    vi.advanceTimersByTime(RUM_FLUSH_MS);
    expect(sent.map((s) => s.beacon)).toEqual([false]);
    collector.record("fcp", 910);
    collector.flush(true);
    expect(sent.map((s) => s.beacon)).toEqual([false, true]);
    collector.stop();
  });

  it("makes one sampling decision per session and keeps it", () => {
    const first = fixture({ sampleRate: 0.5, random: () => 0.9 });
    first.collector.record("lcp", 100);
    first.collector.flush();
    expect(first.sent).toEqual([]);
    expect(first.store.get("k")).toBe("0");
    // A later page of the same session reads the stored decision, whatever the dice say now.
    const later = fixture({ sampleRate: 0.5, random: () => 0.1, getSession: () => "0", setSession: () => undefined });
    later.collector.record("lcp", 100);
    later.collector.flush();
    expect(later.sent).toEqual([]);
    const yes = fixture({ sampleRate: 0.5, random: () => 0.1 });
    yes.collector.record("lcp", 100);
    yes.collector.flush();
    expect(batches(yes.sent)).toHaveLength(1);
  });

  it("sampling still works without sessionStorage (decided once for the page)", () => {
    const { collector, sent } = fixture({
      getSession: () => {
        throw new Error("blocked");
      },
      setSession: () => {
        throw new Error("blocked");
      },
    });
    collector.record("lcp", 100);
    collector.flush();
    expect(batches(sent)).toHaveLength(1);
  });

  it("never throws into a screen, whatever the network does", () => {
    const { collector } = fixture({
      send: () => {
        throw new Error("offline");
      },
    });
    expect(() => {
      collector.record("lcp", 100);
      collector.flush();
    }).not.toThrow();
  });

  it("times a navigation from the click to the screen's data, and a full load from navigation start; once each", () => {
    const { collector, sent, tick } = fixture();
    tick(1200);
    expect(collector.dataReady()).toBe("load_data_ready");
    expect(collector.dataReady()).toBeNull();
    tick(10_000);
    collector.navigationStarted();
    tick(340);
    expect(collector.dataReady()).toBe("nav_data_ready");
    collector.flush();
    expect(batches(sent)[0]!.samples.map((s) => [s.metric, s.value])).toEqual([["load_data_ready", 1200], ["nav_data_ready", 340]]);
  });

  it("ignores a click whose screen never reported data within 30 s (it was not a navigation)", () => {
    const { collector, tick } = fixture();
    collector.dataReady();
    collector.navigationStarted();
    tick(31_000);
    expect(collector.dataReady()).toBeNull();
  });

  it("times an interaction with timer(): keystroke to first option", () => {
    const { collector, sent, tick } = fixture();
    const stop = collector.timer("search_server");
    tick(420);
    stop();
    stop();
    collector.flush();
    expect(batches(sent)[0]!.samples).toEqual([{ screen: "today", metric: "search_server", device: "desktop", net: "4g", value: 420 }]);
  });

  it("takes the screen at the time of the sample, from the current path", () => {
    let path = "/today";
    const { collector, sent } = fixture({ pathname: () => path });
    collector.record("ttfb", 80);
    path = `/consultation/${ID}`;
    collector.record("ttfb", 90);
    collector.flush();
    expect(batches(sent)[0]!.samples.map((s) => s.screen)).toEqual(["today", "consult"]);
    expect(sent[0]!.body).not.toContain(ID);
  });
});
