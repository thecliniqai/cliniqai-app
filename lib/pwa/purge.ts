import { isDevicePrefKey } from "@/lib/pwa/device-prefs";

/**
 * Device purge on every exit path (PWA_STRATEGY §4 D-2, D-3, D-5; V2-06 06-05; T-06-03). Leaves only what the service
 * worker's allowlist may hold and the `clinicos.pref.*` preferences; everything else a page or a library may have put
 * on the device goes:
 *
 * - Cache Storage: every cache not named like the worker's (`static-v1`, `shell-<build>`) is deleted; inside those,
 *   every entry outside the allowlist (`/_next/static/**` without `_rsc`, and the five shell URLs) is deleted.
 * - `sessionStorage`: cleared.
 * - `localStorage`: every key outside `lib/pwa/device-prefs.ts` removed.
 * - IndexedDB: every database deleted.
 *
 * Each step runs even when an earlier one failed; the result names the steps that failed (never any stored value).
 * The names below must equal the worker's (`lib/pwa/service-worker-source.ts`; tests/pwa/purge.spec.ts compares them).
 * Since 06-09a the shell cache is named per build (`shell-<stamp>`); the worker deletes older ones on activate.
 */
export const STATIC_CACHE_NAME = "static-v1";
export const SHELL_CACHE_PREFIX = "shell-";
const SHELL_CACHE_NAME = /^shell-[A-Za-z0-9_-]{1,64}$/;

/** True for a cache the worker owns: `static-v1` or a build's `shell-<stamp>`. */
export function isWorkerCacheName(name: string): boolean {
  return name === STATIC_CACHE_NAME || SHELL_CACHE_NAME.test(name);
}
export const SHELL_PATHS = ["/offline", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"] as const;

const SHELL: ReadonlySet<string> = new Set(SHELL_PATHS);

/** True when `url` (absolute) may stay in Cache Storage on a device of `origin` (D-2). */
export function isAllowlistedCacheUrl(url: string, origin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.origin !== origin) return false;
  if (parsed.pathname.startsWith("/_next/static/")) return !parsed.searchParams.has("_rsc");
  return SHELL.has(parsed.pathname) && parsed.search === "";
}

/** The browser objects the purge touches (injected so the unit spec runs in Node with stand-ins). */
export interface PurgeTargets {
  origin: string;
  caches?: Pick<CacheStorage, "keys" | "open" | "delete">;
  sessionStorage?: Pick<Storage, "clear">;
  localStorage?: Pick<Storage, "length" | "key" | "removeItem">;
  indexedDB?: Pick<IDBFactory, "databases" | "deleteDatabase">;
}

export type PurgeStep = "caches" | "sessionStorage" | "localStorage" | "indexedDB";

export interface PurgeResult {
  failed: PurgeStep[];
}

async function purgeCaches(caches: NonNullable<PurgeTargets["caches"]>, origin: string): Promise<void> {
  for (const name of await caches.keys()) {
    if (!isWorkerCacheName(name)) {
      await caches.delete(name);
      continue;
    }
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      if (!isAllowlistedCacheUrl(request.url, origin)) await cache.delete(request);
    }
  }
}

function purgeLocalStorage(storage: NonNullable<PurgeTargets["localStorage"]>): void {
  const doomed: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null && !isDevicePrefKey(key)) doomed.push(key);
  }
  for (const key of doomed) storage.removeItem(key);
}

function deleteDatabase(factory: NonNullable<PurgeTargets["indexedDB"]>, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("indexedDB delete failed"));
    // Another tab holds it open: the deletion completes when that tab closes it; do not wait for that.
    request.onblocked = () => resolve();
  });
}

async function purgeIndexedDb(factory: NonNullable<PurgeTargets["indexedDB"]>): Promise<void> {
  if (typeof factory.databases !== "function") return;
  for (const db of await factory.databases()) {
    if (db.name) await deleteDatabase(factory, db.name);
  }
}

export async function purgeDeviceState(targets: PurgeTargets = browserTargets()): Promise<PurgeResult> {
  const failed: PurgeStep[] = [];
  const step = async (name: PurgeStep, run: () => unknown) => {
    try {
      await run();
    } catch {
      failed.push(name);
    }
  };
  if (targets.caches) await step("caches", () => purgeCaches(targets.caches!, targets.origin));
  if (targets.sessionStorage) await step("sessionStorage", () => targets.sessionStorage!.clear());
  if (targets.localStorage) await step("localStorage", () => purgeLocalStorage(targets.localStorage!));
  if (targets.indexedDB) await step("indexedDB", () => purgeIndexedDb(targets.indexedDB!));
  return { failed };
}

/** The real browser objects; any the browser blocks (privacy modes) is skipped. */
export function browserTargets(): PurgeTargets {
  const read = <T>(get: () => T): T | undefined => {
    try {
      return get() ?? undefined;
    } catch {
      return undefined;
    }
  };
  return {
    origin: window.location.origin,
    caches: read(() => window.caches),
    sessionStorage: read(() => window.sessionStorage),
    localStorage: read(() => window.localStorage),
    indexedDB: read(() => window.indexedDB),
  };
}
