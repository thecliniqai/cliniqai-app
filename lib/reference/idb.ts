import { isCatalogue, isVersion, type CatalogueRow, type ReferenceCatalogue } from "@/features/reference/catalogues";

/**
 * The one IndexedDB database the app keeps (V2-09e 09E-09, R-5; C-2 answered yes: `cliniq-reference`, global catalogue rows only, deleted at sign-out by
 * `lib/pwa/purge.ts`, which deletes every database). A small promise wrapper over the platform API (no dependency). Two stores:
 * - `meta` (key `catalogue`): `{ catalogue, version, shards }`, written only once every shard of that version is stored (a catalogue with a meta record
 *   is complete);
 * - `rows` (key `key` = `<catalogue>:<version>:<shard>`): `{ key, catalogue, version, shard, rows }`, one record per shard, the rows as the route answered
 *   them (arrays of catalogue fields; no patient, clinic or user data).
 * Unavailable IndexedDB (a privacy mode, a blocked or failing open) and a full quota are {@link ReferenceStorageError}: the sync then keeps the catalogue
 * in memory for the tab.
 */
export const REFERENCE_DB_NAME = "cliniq-reference";
export const REFERENCE_DB_VERSION = 1;
export const META_STORE = "meta";
export const ROWS_STORE = "rows";

export interface MetaRecord {
  catalogue: ReferenceCatalogue;
  version: string;
  shards: number;
}
export interface ShardRecord {
  key: string;
  catalogue: ReferenceCatalogue;
  version: string;
  shard: number;
  rows: CatalogueRow[];
}

/** Any failure of the device store: the caller falls back to memory only. `quota` when the browser refused for space. */
export class ReferenceStorageError extends Error {
  constructor(readonly kind: "unavailable" | "quota" | "failed") {
    super(`reference storage ${kind}`);
    this.name = "ReferenceStorageError";
  }
}

function storageError(err: unknown): ReferenceStorageError {
  if (err instanceof ReferenceStorageError) return err;
  const name = err instanceof DOMException || (err instanceof Error && "name" in err) ? (err as { name: string }).name : "";
  if (name === "QuotaExceededError") return new ReferenceStorageError("quota");
  if (name === "SecurityError" || name === "InvalidStateError" || name === "UnknownError") return new ReferenceStorageError("unavailable");
  return new ReferenceStorageError("failed");
}

export function shardKey(catalogue: ReferenceCatalogue, version: string, shard: number): string {
  return `${catalogue}:${version}:${shard}`;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(storageError(req.error));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(storageError(tx.error));
    tx.onabort = () => reject(storageError(tx.error));
  });
}

/** Opens (creating on first use) the database. A blocked open (another tab holds an older schema) counts as unavailable. */
export function openReferenceDb(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      if (!factory) throw new ReferenceStorageError("unavailable");
      req = factory.open(REFERENCE_DB_NAME, REFERENCE_DB_VERSION);
    } catch (err) {
      reject(storageError(err));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "catalogue" });
      if (!db.objectStoreNames.contains(ROWS_STORE)) db.createObjectStore(ROWS_STORE, { keyPath: "key" });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab deleting the database (a sign-out) or upgrading it: let it go at once.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(storageError(req.error));
    req.onblocked = () => reject(new ReferenceStorageError("unavailable"));
  });
}

/** The stored meta record of `catalogue` (only a complete catalogue has one), or null. */
export async function readMeta(db: IDBDatabase, catalogue: ReferenceCatalogue): Promise<MetaRecord | null> {
  try {
    const value = (await request(db.transaction(META_STORE, "readonly").objectStore(META_STORE).get(catalogue))) as unknown;
    if (typeof value !== "object" || value === null) return null;
    const m = value as Partial<MetaRecord>;
    if (!isCatalogue(m.catalogue) || !isVersion(m.version) || typeof m.shards !== "number" || !Number.isInteger(m.shards) || m.shards < 1) return null;
    return { catalogue: m.catalogue, version: m.version, shards: m.shards };
  } catch (err) {
    throw storageError(err);
  }
}

/** The shards of a complete stored version, in shard order; null when one is missing (the version is then downloaded again). */
export async function readShards(db: IDBDatabase, meta: MetaRecord): Promise<CatalogueRow[][] | null> {
  try {
    const store = db.transaction(ROWS_STORE, "readonly").objectStore(ROWS_STORE);
    const out: CatalogueRow[][] = [];
    for (let shard = 0; shard < meta.shards; shard++) {
      const value = (await request(store.get(shardKey(meta.catalogue, meta.version, shard)))) as ShardRecord | undefined;
      if (!value || !Array.isArray(value.rows)) return null;
      out.push(value.rows);
    }
    return out;
  } catch (err) {
    throw storageError(err);
  }
}

/** Stores every shard of a version, then its meta record, in one transaction (all or nothing), and deletes the catalogue's other versions. */
export async function writeCatalogue(db: IDBDatabase, meta: MetaRecord, shards: readonly CatalogueRow[][]): Promise<void> {
  try {
    const tx = db.transaction([META_STORE, ROWS_STORE], "readwrite");
    const finished = done(tx);
    const rows = tx.objectStore(ROWS_STORE);
    const keep = new Set<string>();
    shards.forEach((shardRows, shard) => {
      const key = shardKey(meta.catalogue, meta.version, shard);
      keep.add(key);
      rows.put({ key, catalogue: meta.catalogue, version: meta.version, shard, rows: shardRows } satisfies ShardRecord);
    });
    const range = IDBKeyRange.bound(`${meta.catalogue}:`, `${meta.catalogue}:￿`);
    const cursor = rows.openKeyCursor(range);
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      if (!keep.has(String(c.primaryKey))) rows.delete(c.primaryKey);
      c.continue();
    };
    tx.objectStore(META_STORE).put(meta satisfies MetaRecord);
    await finished;
  } catch (err) {
    throw storageError(err);
  }
}
