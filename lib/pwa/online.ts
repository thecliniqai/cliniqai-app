"use client";

import { useSyncExternalStore } from "react";
import { useClinicTimeZone } from "@/lib/datetime/client";

/**
 * Online state for the PWA shell (PWA_STRATEGY §3.6; V2-06 06-05 step 9). `navigator.onLine` plus the `online` /
 * `offline` events, through `useSyncExternalStore` (no effect-driven state). `useStaleSince()` gives the clinic-time
 * moment the app went offline, for the banner's "showing data from 10:42"; data already on screen stays in memory and
 * nothing is persisted (D-3).
 */
let offlineSince: number | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function onOffline() {
  offlineSince ??= Date.now();
  notify();
}

function onOnline() {
  offlineSince = null;
  notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    if (!navigator.onLine) offlineSince ??= Date.now();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    }
  };
}

const onlineSnapshot = () => navigator.onLine;
/** Server render: assume online (the banner never renders on the server). */
const serverOnline = () => true;

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, onlineSnapshot, serverOnline);
}

const sinceSnapshot = () => (navigator.onLine ? null : offlineSince);
const serverSince = () => null;

/** "10:42 am" in the clinic's zone for the moment the app went offline, or null while online. */
export function useStaleSince(): string | null {
  const timeZone = useClinicTimeZone();
  const since = useSyncExternalStore(subscribe, sinceSnapshot, serverSince);
  return since === null ? null : formatClinicTime(since, timeZone);
}

/** Hours and minutes of `instant` in `timeZone` (en-IN, e.g. "10:42 am"). */
export function formatClinicTime(instant: number | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone, hour: "numeric", minute: "2-digit" }).format(instant);
}
