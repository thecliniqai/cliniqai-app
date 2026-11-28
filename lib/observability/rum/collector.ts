import {
  deviceOfWidth,
  netOfType,
  RUM_MAX_SAMPLES,
  rumMaxValue,
  screenOfPath,
  type RumMetric,
  type RumSample,
} from "./catalog";
import { publicEnv } from "@/lib/env";

/**
 * The browser side of real-user monitoring (V2-09e 09E-02, R-20): `rum.record(metric, value)` keeps one closed-list sample (screen,
 * metric, device, net, value) and sends them in batches to `POST /api/rum`: when 60 are waiting, every 60 s, and with
 * `navigator.sendBeacon` when the page goes to the background or closes. One sampling decision per session
 * (`NEXT_PUBLIC_RUM_SAMPLE_RATE`, kept in memory for the page's lifetime, never in a storage API: PWA D-3). Never a URL, id, text or time of day; a value that is not a finite number in
 * range is dropped here as well as at the route and in the database. Every call is safe: monitoring never throws into a screen.
 */

export const RUM_ENDPOINT = "/api/rum";
export const RUM_FLUSH_MS = 60_000;
let keptDecision: string | null = null;
/** A click that started a navigation counts for this long; later `DataReady` marks are full loads. */
const NAV_WINDOW_MS = 30_000;

export interface CollectorEnv {
  sampleRate: number;
  now: () => number;
  pathname: () => string;
  width: () => number;
  effectiveType: () => unknown;
  /** Returns whether the batch was handed to the network. */
  send: (body: string, beacon: boolean) => boolean;
  getSession: () => string | null;
  setSession: (value: string) => void;
  random: () => number;
}

export function createCollector(env: CollectorEnv) {
  const buffer: RumSample[] = [];
  let sampled: boolean | null = null;
  let navStart: number | null = null;
  let loadRecorded = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  function isSampled(): boolean {
    if (sampled !== null) return sampled;
    try {
      const kept = env.getSession();
      if (kept === "1" || kept === "0") return (sampled = kept === "1");
    } catch {
      // No sessionStorage (private window): decide once for this page.
    }
    sampled = env.random() < env.sampleRate;
    try {
      env.setSession(sampled ? "1" : "0");
    } catch {
      // kept in memory only
    }
    return sampled;
  }

  function flush(beacon = false): void {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, RUM_MAX_SAMPLES);
    try {
      env.send(JSON.stringify({ samples: batch }), beacon);
    } catch {
      // A lost batch is acceptable; a thrown error is not.
    }
    if (buffer.length > 0) flush(beacon);
  }

  function ensureTimer(): void {
    if (timer !== null) return;
    timer = setInterval(() => flush(false), RUM_FLUSH_MS);
  }

  function record(metric: RumMetric, value: number): void {
    try {
      if (!Number.isFinite(value) || value < 0 || value > rumMaxValue(metric)) return;
      if (!isSampled()) return;
      buffer.push({
        screen: screenOfPath(env.pathname()),
        metric,
        device: deviceOfWidth(env.width()),
        net: netOfType(env.effectiveType()),
        value: Math.round(value * 1000) / 1000,
      });
      ensureTimer();
      if (buffer.length >= RUM_MAX_SAMPLES) flush(false);
    } catch {
      // never into a screen
    }
  }

  return {
    record,
    flush,
    /** A click on an in-app link started a navigation. */
    navigationStarted(): void {
      navStart = env.now();
    },
    /** The screen's first data is on screen: a navigation's end, or the first load's. Returns the metric recorded, if any. */
    dataReady(): "nav_data_ready" | "load_data_ready" | null {
      const now = env.now();
      if (navStart !== null && now - navStart <= NAV_WINDOW_MS) {
        const ms = now - navStart;
        navStart = null;
        record("nav_data_ready", ms);
        return "nav_data_ready";
      }
      navStart = null;
      if (!loadRecorded) {
        loadRecorded = true;
        record("load_data_ready", now);
        return "load_data_ready";
      }
      return null;
    },
    /** A timer for one interaction: `const stop = rum.timer("search_server"); ...; stop()` records the elapsed ms. */
    timer(metric: RumMetric): () => void {
      const t0 = env.now();
      let done = false;
      return () => {
        if (done) return;
        done = true;
        record(metric, env.now() - t0);
      };
    },
    pending: () => buffer.length,
    stop(): void {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}

function browserEnv(sampleRate: number): CollectorEnv {
  return {
    sampleRate,
    now: () => performance.now(),
    pathname: () => window.location.pathname,
    width: () => window.innerWidth,
    effectiveType: () => (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType,
    send: (body, beacon) => {
      if (beacon && typeof navigator.sendBeacon === "function") {
        return navigator.sendBeacon(RUM_ENDPOINT, new Blob([body], { type: "application/json" }));
      }
      void fetch(RUM_ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true, credentials: "same-origin" }).catch(() => undefined);
      return true;
    },
    // Memory only: PWA_STRATEGY D-3 lets a device keep the preference keys and nothing else in any storage (05-cache-audit), so the decision
    // lives as long as the page's scripts (every full load decides again; at the default rate of 1 that changes nothing).
    getSession: () => keptDecision,
    setSession: (value) => {
      keptDecision = value;
    },
    random: () => Math.random(),
  };
}

type Collector = ReturnType<typeof createCollector>;
let shared: Collector | null = null;

const noop: Collector = createCollector({
  sampleRate: 0,
  now: () => 0,
  pathname: () => "/",
  width: () => 1280,
  effectiveType: () => undefined,
  send: () => false,
  getSession: () => null,
  setSession: () => undefined,
  random: () => 1,
});

/** The browser's collector; a no-op on the server. Created on first use with the build's sample rate. */
export function rumCollector(sampleRate: number): Collector {
  if (typeof window === "undefined") return noop;
  return (shared ??= createCollector(browserEnv(sampleRate)));
}

const current = () => rumCollector(publicEnv.NEXT_PUBLIC_RUM_SAMPLE_RATE);

/** What screens and components call: `rum.record`, `rum.timer`, `rum.dataReady`. Safe on the server (no-ops) and never throws. */
export const rum = {
  record(metric: RumMetric, value: number): void {
    current().record(metric, value);
  },
  timer(metric: RumMetric): () => void {
    return current().timer(metric);
  },
  dataReady(): void {
    current().dataReady();
  },
  navigationStarted(): void {
    current().navigationStarted();
  },
  flush(beacon: boolean): void {
    current().flush(beacon);
  },
};
