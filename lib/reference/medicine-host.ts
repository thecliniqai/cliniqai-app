"use client";

import { useSyncExternalStore } from "react";
import type { CatalogueRow } from "@/features/reference/catalogues";
import { reportClientError } from "@/lib/log/client";
import { buildMedicineIndexSteps, searchMedicineIndex, type IndexSearchResult, type MedicineIndex } from "./medicine-index";
import type { WorkerRequest, WorkerResponse } from "./worker";

/**
 * The browser side of the medicine index (V2-09e 09E-11, R-7): the index lives in a Web Worker (`./worker.ts`, bundled by Next); when no worker can
 * start (or it fails), it is built on the main thread in idle slices and searched there (recorded in 09E-NOTES). Fed by the reference store when the
 * medicine catalogue's shards are in (from the device store or the network; the main thread then lets go of the rows); ended by the store's cleanup
 * (sign-out, lock, clinic switch). One build per catalogue version.
 *
 * The build time is a `performance.measure` named `clinicos.medicine_index` (the latency lane reads it; nothing is sent anywhere).
 */
export type MedicineIndexStatus = "idle" | "building" | "ready";

interface Snapshot {
  status: MedicineIndexStatus;
  version: string | null;
  mode: "worker" | "main" | null;
}

let snapshot: Snapshot = { status: "idle", version: null, mode: null };
const listeners = new Set<() => void>();
let worker: Worker | null = null;
let workerBroken = false;
let mainIndex: MedicineIndex | null = null;
let pendingShards: { version: string; shards: CatalogueRow[][] } | null = null;
let nextId = 0;
const waiting = new Map<number, (result: IndexSearchResult) => void>();
let started = 0;
let ended = false;

function set(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const l of listeners) l();
}

function settleAll() {
  for (const resolve of waiting.values()) resolve({ rows: [], matched: 0 });
  waiting.clear();
}

function measureBuild(mode: "worker" | "main") {
  try {
    performance.measure("clinicos.medicine_index", { start: started, end: performance.now(), detail: { mode } });
  } catch {
    // No User Timing: nothing to record.
  }
}

function onMessage(event: MessageEvent<WorkerResponse>) {
  const msg = event.data;
  if (msg.type === "result") {
    const resolve = waiting.get(msg.id);
    waiting.delete(msg.id);
    resolve?.({ rows: msg.rows, matched: msg.matched });
    return;
  }
  if (!pendingShards || msg.version !== pendingShards.version) return;
  if (msg.type === "loaded") {
    pendingShards = null;
    measureBuild("worker");
    set({ status: "ready", version: msg.version, mode: "worker" });
  } else {
    fallBack();
  }
}

function startWorker(): Worker | null {
  if (worker || workerBroken) return worker;
  try {
    if (typeof Worker === "undefined") throw new Error("no Worker");
    worker = new Worker(new URL("./worker.ts", import.meta.url));
    worker.onmessage = onMessage;
    worker.onerror = () => fallBack();
    return worker;
  } catch (err) {
    workerBroken = true;
    reportClientError("reference.medicine_worker_unavailable", err);
    return null;
  }
}

/** The worker could not start or failed: the index is built on the main thread, in idle slices. */
function fallBack() {
  workerBroken = true;
  worker?.terminate();
  worker = null;
  settleAll();
  const job = pendingShards;
  if (!job || ended) {
    // A worker that failed after its build: the index it held is gone (the route answers until the next version is in).
    if (!mainIndex && !ended) set({ status: "idle", version: null, mode: null });
    return;
  }
  const steps = buildMedicineIndexSteps(job.version, job.shards);
  const idle: (cb: () => void) => void =
    typeof window !== "undefined" && typeof window.requestIdleCallback === "function"
      ? (cb) => window.requestIdleCallback(cb, { timeout: 500 })
      : (cb) => setTimeout(cb, 0);
  const step = () => {
    if (ended || pendingShards !== job) return;
    const next = steps.next();
    if (!next.done) {
      idle(step);
      return;
    }
    mainIndex = next.value;
    pendingShards = null;
    measureBuild("main");
    set({ status: "ready", version: job.version, mode: "main" });
  };
  idle(step);
}

/** A complete version of the medicine catalogue is in (the store calls this): build its index, unless that version is already indexed. */
export function loadMedicineShards(version: string, shards: CatalogueRow[][]): void {
  if (ended || snapshot.version === version || pendingShards?.version === version) return;
  pendingShards = { version, shards };
  started = performance.now();
  set({ status: snapshot.status === "ready" ? "ready" : "building" });
  const w = startWorker();
  if (w) w.postMessage({ type: "load", version, shards } satisfies WorkerRequest);
  else fallBack();
}

/** Ranks 1 to 4 for a lower-cased, trimmed term (see `searchMedicineIndex`). Answers nothing when no index is ready. */
export function searchMedicineCatalogue(term: string, need: number, exclude: ReadonlySet<string>): Promise<IndexSearchResult> {
  if (snapshot.status !== "ready") return Promise.resolve({ rows: [], matched: 0 });
  if (mainIndex && snapshot.mode === "main") return Promise.resolve(searchMedicineIndex(mainIndex, term, need, exclude));
  if (!worker) return Promise.resolve({ rows: [], matched: 0 });
  const id = ++nextId;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    worker!.postMessage({ type: "search", id, term, need, exclude: [...exclude] } satisfies WorkerRequest);
  });
}

/** Ends the index for this document (the store's cleanup): the worker stops, the index is dropped, nothing later builds. */
export function endMedicineIndex(): void {
  ended = true;
  worker?.terminate();
  worker = null;
  mainIndex = null;
  pendingShards = null;
  settleAll();
  set({ status: "idle", version: null, mode: null });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const SERVER: Snapshot = { status: "idle", version: null, mode: null };

/** The index's state for a screen: `ready` once a version is built and searchable. */
export function useMedicineIndex(): Snapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER,
  );
}

/** Test seam (unit specs only). */
export function resetMedicineHostForTests(): void {
  endMedicineIndex();
  ended = false;
  workerBroken = false;
}
