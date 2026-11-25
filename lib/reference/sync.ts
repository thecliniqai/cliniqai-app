import {
  CATALOGUE_SHARDS,
  type CatalogueRow,
  type ReferenceCatalogue,
  type ReferenceManifest,
  type ReferenceShard,
} from "@/features/reference/catalogues";
import type { MetaRecord } from "./idb";

/**
 * The catalogue sync (V2-09e 09E-09, R-5), with its browser parts injected so the rules run in a unit spec. One run:
 *
 * 1. Every wanted catalogue not yet in memory is loaded from the device store when a complete version is stored there (no network: it answers at once and
 *    offline).
 * 2. The manifest (one `GET /api/reference/manifest`): for each wanted catalogue the caller may read whose version differs from the one in memory, the
 *    shards are downloaded (shard 0 first; it says how many there are when the manifest does not), each must carry the manifest's version (a shard of
 *    another version or a 409 means it changed meanwhile; a malformed answer ends that catalogue's run), then stored (all shards and the
 *    meta record in one transaction; older versions deleted) and put in memory. A catalogue that changed while it was read is asked for again from a
 *    fresh manifest (at most {@link MAX_ATTEMPTS} manifest reads in one run).
 * 3. A store that fails (unavailable, over quota) is dropped for the rest of the tab: the catalogue lives in memory only.
 *
 * Runs never overlap (a request during a run is answered by that run, then one more run follows if asked); the UI never waits for one: until a catalogue
 * is in memory its search uses the server route.
 */
export interface ReferenceStorage {
  readMeta(catalogue: ReferenceCatalogue): Promise<MetaRecord | null>;
  readShards(meta: MetaRecord): Promise<CatalogueRow[][] | null>;
  write(meta: MetaRecord, shards: readonly CatalogueRow[][]): Promise<void>;
}

export type ShardAnswer = ReferenceShard | "changed" | null;

export interface SyncDeps {
  /** Opens the device store once; null or a rejection means memory only. */
  openStorage: () => Promise<ReferenceStorage | null>;
  fetchManifest: () => Promise<ReferenceManifest | null>;
  fetchShard: (catalogue: ReferenceCatalogue, version: string, shard: number) => Promise<ShardAnswer>;
  /** The version of `catalogue` held in memory, or null. */
  memoryVersion: (catalogue: ReferenceCatalogue) => string | null;
  /** Puts a complete version in memory. `source` is where it came from (for the e2e marker and RUM, never sent anywhere). */
  setMemory: (catalogue: ReferenceCatalogue, version: string, shards: CatalogueRow[][], source: "device" | "network") => void;
  /** A storage failure (class name only goes to the log). */
  onStorageError?: (err: unknown) => void;
}

export interface ReferenceSync {
  /** Runs (or joins the run in flight and asks for one more). Resolves when the catalogues are as fresh as this run could make them. */
  run: (wanted: readonly ReferenceCatalogue[]) => Promise<void>;
  /** Ends the sync for this document: no further run writes anything. */
  dispose: () => void;
}

/** Manifest reads in one run when a catalogue keeps changing under the download. */
export const MAX_ATTEMPTS = 3;

export function createReferenceSync(deps: SyncDeps): ReferenceSync {
  let storage: Promise<ReferenceStorage | null> | null = null;
  let current: Promise<void> | null = null;
  let again: readonly ReferenceCatalogue[] | null = null;
  let disposed = false;

  const store = () => {
    storage ??= deps.openStorage().catch((err: unknown) => {
      deps.onStorageError?.(err);
      return null;
    });
    return storage;
  };
  const dropStorage = (err: unknown) => {
    deps.onStorageError?.(err);
    storage = Promise.resolve(null);
  };

  async function loadStored(catalogue: ReferenceCatalogue): Promise<void> {
    if (deps.memoryVersion(catalogue) !== null) return;
    const s = await store();
    if (!s || disposed) return;
    try {
      const meta = await s.readMeta(catalogue);
      if (!meta) return;
      const shards = await s.readShards(meta);
      if (shards && !disposed && deps.memoryVersion(catalogue) === null) deps.setMemory(catalogue, meta.version, shards, "device");
    } catch (err) {
      dropStorage(err);
    }
  }

  /** `changed`: the catalogue moved on while it was read (a 409 or a shard of another version); the caller reads the manifest again. */
  async function download(catalogue: ReferenceCatalogue, version: string, listed: number | null): Promise<"done" | "changed" | "failed"> {
    const shards: CatalogueRow[][] = [];
    let total = listed ?? CATALOGUE_SHARDS[catalogue] ?? null;
    for (let shard = 0; total === null || shard < total; shard++) {
      const answer = await deps.fetchShard(catalogue, version, shard);
      if (disposed || answer === null) return "failed";
      if (answer === "changed" || answer.version !== version) return "changed";
      if (answer.shard !== shard || (total !== null && answer.shards !== total)) return "failed";
      total = answer.shards;
      shards.push(answer.rows);
    }
    if (disposed) return "failed";
    const s = await store();
    if (s && !disposed) {
      try {
        await s.write({ catalogue, version, shards: shards.length }, shards);
      } catch (err) {
        dropStorage(err);
      }
    }
    if (!disposed) deps.setMemory(catalogue, version, shards, "network");
    return "done";
  }

  async function once(wanted: readonly ReferenceCatalogue[]): Promise<void> {
    for (const catalogue of wanted) await loadStored(catalogue);
    let pending = wanted;
    // A catalogue that changed while it was read is asked for again from a fresh manifest, a few times at most (a reload in progress settles).
    for (let attempt = 0; attempt < MAX_ATTEMPTS && pending.length > 0 && !disposed; attempt++) {
      const manifest = await deps.fetchManifest().catch(() => null);
      if (!manifest || disposed) return;
      const changed: ReferenceCatalogue[] = [];
      for (const catalogue of pending) {
        const entry = manifest.catalogues[catalogue];
        if (!entry || deps.memoryVersion(catalogue) === entry.version) continue;
        const result = await download(catalogue, entry.version, entry.shards).catch(() => "failed" as const);
        if (disposed) return;
        if (result === "changed") changed.push(catalogue);
      }
      pending = changed;
    }
  }

  function run(wanted: readonly ReferenceCatalogue[]): Promise<void> {
    if (disposed) return Promise.resolve();
    if (current) {
      again = wanted;
      return current;
    }
    current = (async () => {
      try {
        let next: readonly ReferenceCatalogue[] | null = wanted;
        while (next && !disposed) {
          again = null;
          await once(next);
          next = again;
        }
      } finally {
        current = null;
      }
    })();
    return current;
  }

  return {
    run,
    dispose: () => {
      disposed = true;
    },
  };
}
