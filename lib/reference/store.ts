"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  parseManifest,
  parseShard,
  REFERENCE_MANIFEST_PATH,
  referenceShardPath,
  type CatalogueRow,
  type ReferenceCatalogue,
} from "@/features/reference/catalogues";
import { reportClientError } from "@/lib/log/client";
import { registerCleanup, type CleanupKind } from "@/lib/pwa/cleanup";
import { openReferenceDb, readMeta, readShards, REFERENCE_DB_NAME, writeCatalogue } from "./idb";
import { endMedicineIndex, loadMedicineShards } from "./medicine-host";
import { createReferenceSync, type ReferenceStorage, type ReferenceSync, type ShardAnswer } from "./sync";

/**
 * The catalogues in memory for this tab, and the browser wiring of the sync (V2-09e 09E-09, R-5). Outside the query layer on purpose (R-14: the catalogue
 * index keeps its own store). Catalogue rows only: nothing of a patient, a clinic or a user is ever put here or in the device store.
 *
 * - {@link startReferenceSync} (the shell's `ReferenceSync`, once per document): the catalogues this role may hold; a sync after first paint, again on
 *   resume or reconnect (at most once a minute), and before the first search ({@link requestReferenceSync}). It registers with `lib/pwa/cleanup.ts`: at
 *   sign-out, lock and clinic switch the memory is emptied, the database connection closed and no later run writes; at sign-out the database is deleted
 *   too (the purge deletes it as well).
 * - {@link useReferenceCatalogue}: `{ status, rows }` for a screen; `status` is `ready` only when a complete version is in memory. The medicine catalogue
 *   (09E-11) is handed to its index (`./medicine-host.ts`, a worker) instead: its `rows` stay empty here, and the Rx field reads `useMedicineIndex`.
 */
export type ReferenceStatus = "ready" | "loading" | "unavailable";

interface Held {
  version: string;
  rows: CatalogueRow[];
  source: "device" | "network";
}

const memory = new Map<ReferenceCatalogue, Held>();
const EMPTY_ROWS: CatalogueRow[] = [];
const listeners = new Set<() => void>();
let wanted: readonly ReferenceCatalogue[] = [];
let sync: ReferenceSync | null = null;
let db: IDBDatabase | null = null;
let lastRun = Number.NEGATIVE_INFINITY;
let ended = false;

/** At most one manifest check per minute from resume and reconnect (a first sync and a sync before the first search are never throttled). */
export const RESYNC_MIN_MS = 60_000;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The version of a catalogue held in memory (tests and the e2e marker read it). */
export function heldVersion(catalogue: ReferenceCatalogue): string | null {
  return memory.get(catalogue)?.version ?? null;
}

function browserStorage(): Promise<ReferenceStorage> {
  return openReferenceDb().then((opened) => {
    if (ended) {
      opened.close();
      throw new Error("ended");
    }
    db = opened;
    return {
      readMeta: (catalogue) => readMeta(opened, catalogue),
      readShards: (meta) => readShards(opened, meta),
      write: (meta, shards) => writeCatalogue(opened, meta, shards),
    };
  });
}

async function fetchJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { method: "GET", credentials: "same-origin", headers: { Accept: "application/json" } });
  const body = res.ok ? ((await res.json()) as unknown) : null;
  return { status: res.status, body };
}

async function fetchShard(catalogue: ReferenceCatalogue, version: string, shard: number): Promise<ShardAnswer> {
  const { status, body } = await fetchJson(referenceShardPath(catalogue, version, shard));
  if (status === 409) return "changed";
  if (status !== 200) return null;
  return parseShard(body, { catalogue, version, shard });
}

function ensureSync(): ReferenceSync {
  sync ??= createReferenceSync({
    openStorage: browserStorage,
    fetchManifest: async () => {
      const { status, body } = await fetchJson(REFERENCE_MANIFEST_PATH);
      return status === 200 ? parseManifest(body) : null;
    },
    fetchShard,
    memoryVersion: heldVersion,
    setMemory: (catalogue, version, shards, source) => {
      if (ended) return;
      if (catalogue === "medicines") {
        // 09E-11 (R-7): the medicine catalogue is held by its index (a worker), not as rows here; this tab keeps only the version.
        loadMedicineShards(version, shards);
        memory.set(catalogue, { version, rows: EMPTY_ROWS, source });
      } else {
        memory.set(catalogue, { version, rows: shards.flat(), source });
      }
      emit();
    },
    onStorageError: (err) => {
      if (!ended) reportClientError("reference.storage_unavailable", err);
    },
  });
  return sync;
}

function runSync(): Promise<void> {
  if (ended || wanted.length === 0) return Promise.resolve();
  lastRun = Date.now();
  return ensureSync().run(wanted);
}

function end(kind: CleanupKind): void {
  ended = true;
  sync?.dispose();
  memory.clear();
  endMedicineIndex();
  db?.close();
  db = null;
  emit();
  // Sign-out: the purge deletes every database it lists; an open this tab started a moment ago may not be listed yet, so the database is also deleted
  // here (queued behind that open, which closes itself once it sees the sync ended). Lock and clinic switch keep it: global catalogue rows only.
  if (kind === "signout") {
    try {
      globalThis.indexedDB?.deleteDatabase(REFERENCE_DB_NAME);
    } catch {
      // No IndexedDB: nothing to delete.
    }
  }
}

/**
 * Starts the sync for this document (the shell calls it once, after first paint). Returns the stop function for an unmount (it does NOT end the sync: a
 * catalogue stays usable while the shell re-renders; only the cleanup registry ends it).
 */
export function startReferenceSync(catalogues: readonly ReferenceCatalogue[]): () => void {
  if (ended) return () => undefined;
  const first = wanted.length === 0;
  wanted = catalogues;
  if (catalogues.length === 0) return () => undefined;
  if (first) {
    registerCleanup((kind) => end(kind));
    const schedule: (cb: () => void) => void =
      typeof window !== "undefined" && typeof window.requestIdleCallback === "function"
        ? (cb) => window.requestIdleCallback(cb, { timeout: 2_000 })
        : (cb) => setTimeout(cb, 0);
    schedule(() => void runSync());
  }
  const onResume = () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastRun < RESYNC_MIN_MS) return;
    void runSync();
  };
  document.addEventListener("visibilitychange", onResume);
  window.addEventListener("online", onResume);
  return () => {
    document.removeEventListener("visibilitychange", onResume);
    window.removeEventListener("online", onResume);
  };
}

/** Before the first search: a catalogue that is not in memory yet is asked for now (joins a run in flight). */
export function requestReferenceSync(catalogue: ReferenceCatalogue): void {
  if (ended || !wanted.includes(catalogue) || memory.has(catalogue)) return;
  void runSync();
}

const EMPTY: readonly CatalogueRow[] = [];

export function useReferenceCatalogue(catalogue: ReferenceCatalogue): { status: ReferenceStatus; rows: readonly CatalogueRow[]; version: string | null } {
  const getSnapshot = useCallback(() => memory.get(catalogue), [catalogue]);
  const held = useSyncExternalStore(subscribe, getSnapshot, () => undefined);
  if (held) return { status: "ready", rows: held.rows, version: held.version };
  return { status: ended || !wanted.includes(catalogue) ? "unavailable" : "loading", rows: EMPTY, version: null };
}

/** Test seam (unit specs only): forget everything this module holds. */
export function resetReferenceStoreForTests(): void {
  memory.clear();
  wanted = [];
  sync?.dispose();
  sync = null;
  db = null;
  lastRun = Number.NEGATIVE_INFINITY;
  ended = false;
}
