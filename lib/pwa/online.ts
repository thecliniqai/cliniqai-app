"use client";

import { useSyncExternalStore } from "react";
import { useClinicTimeZone } from "@/lib/datetime/client";

/**
 * Online state for the PWA shell (PWA_STRATEGY §3.6; V2-06 06-05 step 9). `navigator.onLine` plus the `online` /
 * `offline` events, through `useSyncExternalStore` (no effect-driven state). `useStaleSince()` gives the clinic-time
 * moment of the last network response the page received, for the banner's "showing data from 10:42"; data already on
 * screen stays in memory and nothing is persisted (D-3).
 *
 * 06-09a (IND L-4): the time is the last successful data response (the page's own document, then every `fetch` (RSC
 * payloads, Server Actions, /api) Resource Timing reports with a response; static chunks served from the worker's
 * cache are not data), not "when the offline event was seen": 06-05 kept that in
 * module state that only listeners updated, so a device that went offline and online while no banner was mounted
 * showed the old moment on the next outage. The response time only moves forward and needs no listener to stay true.
 */
let lastResponseAt: number | null = null;
let tracking = false;
const listeners = new Set<() => void>();

interface TimingEntry {
  responseEnd: number;
  /** "navigation" for the document; "fetch" / "xmlhttprequest" for data; anything else (script, css, img) is not data. */
  initiatorType?: string;
  entryType?: string;
  /** Chromium/Firefox: 0 for a network error. Absent in WebKit. */
  responseStatus?: number;
}

const DATA_INITIATORS = new Set(["fetch", "xmlhttprequest", "navigation"]);

/** The epoch-ms instant `entry`'s data response finished, or null (not data, or no response: a network error). */
export function responseTimeOf(entry: TimingEntry, timeOrigin: number): number | null {
  const kind = entry.entryType === "navigation" ? "navigation" : entry.initiatorType;
  if (!kind || !DATA_INITIATORS.has(kind)) return null;
  if (!(entry.responseEnd > 0)) return null;
  if (typeof entry.responseStatus === "number" && entry.responseStatus === 0) return null;
  return Math.round(timeOrigin + entry.responseEnd);
}

function noteEntries(entries: readonly TimingEntry[]) {
  const origin = performance.timeOrigin;
  for (const entry of entries) {
    const at = responseTimeOf(entry, origin);
    if (at !== null && (lastResponseAt === null || at > lastResponseAt)) lastResponseAt = at;
  }
}

/** Starts following Resource Timing once per page (kept for the page's life, so no response is missed). */
function startTracking() {
  if (tracking) return;
  tracking = true;
  try {
    noteEntries(performance.getEntriesByType("navigation") as unknown as TimingEntry[]);
    if (typeof PerformanceObserver === "function") {
      new PerformanceObserver((list) => noteEntries(list.getEntries() as unknown as TimingEntry[])).observe({
        type: "resource",
        buffered: true,
      });
    }
  } catch {
    // No Resource Timing: the time stays unknown and the banner shows no time.
  }
}

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  startTracking();
  if (listeners.size === 0) {
    window.addEventListener("offline", notify);
    window.addEventListener("online", notify);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("offline", notify);
      window.removeEventListener("online", notify);
    }
  };
}

const onlineSnapshot = () => navigator.onLine;
/** Server render: assume online (the banner never renders on the server). */
const serverOnline = () => true;

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, onlineSnapshot, serverOnline);
}

const sinceSnapshot = () => (navigator.onLine ? null : lastResponseAt);
const serverSince = () => null;

/** The store behind the hooks (tests/pwa/online.spec.ts drives it with stand-in globals). */
export const onlineStore = { subscribe, sinceSnapshot };

/** "10:42 am" in the clinic's zone for the last response received, or null while online (or when unknown). */
export function useStaleSince(): string | null {
  const timeZone = useClinicTimeZone();
  const since = useSyncExternalStore(subscribe, sinceSnapshot, serverSince);
  return since === null ? null : formatClinicTime(since, timeZone);
}

/** Hours and minutes of `instant` in `timeZone` (en-IN, e.g. "10:42 am"). */
export function formatClinicTime(instant: number | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone, hour: "numeric", minute: "2-digit" }).format(instant);
}
