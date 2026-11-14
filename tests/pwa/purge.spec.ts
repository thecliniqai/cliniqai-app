/**
 * `purgeDeviceState()` and the Cache Storage allowlist (V2-06 06-05; PWA_STRATEGY §4 D-2, D-3, D-5; T-06-03), in Node
 * with in-memory stand-ins for `caches`, `Storage` and `indexedDB`. Before 06-05 there was no purge: a sign-out left
 * every cache entry, session key, unknown local key and database on the device.
 */
import { describe, expect, it } from "vitest";
import { isAllowlistedCacheUrl, purgeDeviceState, SHELL_PATHS, SW_CACHE_NAMES } from "@/lib/pwa/purge";
import { FakeCacheStorage, SW_SOURCE } from "./sw-harness";

const ORIGIN = "http://127.0.0.1:3100";

class MemoryStorage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
  keys() {
    return [...this.data.keys()];
  }
}

class FakeIndexedDb {
  names = new Set<string>();
  async databases() {
    return [...this.names].map((name) => ({ name, version: 1 }));
  }
  deleteDatabase(name: string) {
    const request: { onsuccess?: () => void; onerror?: () => void; onblocked?: () => void; error: null } = { error: null };
    queueMicrotask(() => {
      this.names.delete(name);
      request.onsuccess?.();
    });
    return request as unknown as IDBOpenDBRequest;
  }
}

describe("Cache Storage allowlist (D-2)", () => {
  it.each([
    [`${ORIGIN}/_next/static/x.js?dpl=1`, true],
    [`${ORIGIN}/_next/static/chunks/app/page-abc.js`, true],
    [`${ORIGIN}/_next/static/css/app.css`, true],
    [`${ORIGIN}/offline`, true],
    [`${ORIGIN}/manifest.webmanifest`, true],
    [`${ORIGIN}/icon-192.png`, true],
    [`${ORIGIN}/icon-maskable-512.png`, true],
    [`${ORIGIN}/patients`, false],
    [`${ORIGIN}/patients/0b9f1c1e-2a5d-4c1b-9d7e-1f2a3b4c5d6e`, false],
    [`${ORIGIN}/api/x`, false],
    [`${ORIGIN}/?_rsc=1`, false],
    [`${ORIGIN}/`, false],
    [`${ORIGIN}/offline?_rsc=abc`, false],
    [`${ORIGIN}/offline/x`, false],
    [`${ORIGIN}/_next/static/x.js?_rsc=1`, false],
    [`${ORIGIN}/_next/image?url=%2Fx.png`, false],
    [`${ORIGIN}/auth/signout`, false],
    ["https://evil.example/_next/static/x.js", false],
    ["http://127.0.0.1:54321/rest/v1/patients", false],
    ["not a url", false],
  ])("%s → %s", (url, kept) => {
    expect(isAllowlistedCacheUrl(url, ORIGIN)).toBe(kept);
  });

  it("names the same caches and shell URLs as public/sw.js", () => {
    const sw = SW_SOURCE();
    expect(/const STATIC_CACHE = "([^"]+)"/.exec(sw)?.[1]).toBe(SW_CACHE_NAMES[0]);
    expect(/const SHELL_CACHE = "([^"]+)"/.exec(sw)?.[1]).toBe(SW_CACHE_NAMES[1]);
    expect(JSON.parse(/const PRECACHE = (\[[^\]]+\]);/.exec(sw)?.[1] ?? "null")).toEqual([...SHELL_PATHS]);
  });
});

describe("purgeDeviceState", () => {
  async function device() {
    const caches = new FakeCacheStorage();
    const statics = await caches.open("static-v1");
    await statics.put(`${ORIGIN}/_next/static/x.js?dpl=1`, new Response("js"));
    await statics.put(`${ORIGIN}/patients?_rsc=1`, new Response("rsc payload"));
    const shell = await caches.open("shell-v1");
    await shell.put(`${ORIGIN}/offline`, new Response("offline"));
    await shell.put(`${ORIGIN}/api/x`, new Response("api"));
    await (await caches.open("next-data")).put(`${ORIGIN}/patients`, new Response("html"));
    const session = new MemoryStorage();
    session.setItem("draft", "x");
    const local = new MemoryStorage();
    local.setItem("clinicos.pref.density", "compact");
    local.setItem("clinicos.pref.installDismissedUntil", "1");
    local.setItem("supabase.auth.token", "x");
    local.setItem("lastPatient", "x");
    local.setItem("clinicos.pref.unknown", "x");
    const idb = new FakeIndexedDb();
    idb.names.add("keyval-store");
    idb.names.add("cache");
    return { caches, session, local, idb };
  }

  it("keeps only allowlisted cache entries and pref keys; clears sessionStorage; deletes every IndexedDB database", async () => {
    const d = await device();
    const result = await purgeDeviceState({
      origin: ORIGIN,
      caches: d.caches as unknown as CacheStorage,
      sessionStorage: d.session,
      localStorage: d.local,
      indexedDB: d.idb as unknown as IDBFactory,
    });
    expect(result.failed).toEqual([]);
    expect(d.caches.urls().sort()).toEqual(["shell-v1:/offline", "static-v1:/_next/static/x.js?dpl=1"]);
    expect(await d.caches.keys()).not.toContain("next-data");
    expect(d.session.length).toBe(0);
    expect(d.local.keys().sort()).toEqual(["clinicos.pref.density", "clinicos.pref.installDismissedUntil"]);
    expect(d.idb.names.size).toBe(0);
  });

  it("a failing step is reported by name and the other steps still run", async () => {
    const d = await device();
    const result = await purgeDeviceState({
      origin: ORIGIN,
      caches: {
        keys: async () => {
          throw new Error("SecurityError");
        },
        open: async () => {
          throw new Error("unused");
        },
        delete: async () => false,
      },
      sessionStorage: d.session,
      localStorage: d.local,
      indexedDB: d.idb as unknown as IDBFactory,
    });
    expect(result.failed).toEqual(["caches"]);
    expect(d.session.length).toBe(0);
    expect(d.local.keys()).not.toContain("lastPatient");
    expect(d.idb.names.size).toBe(0);
  });

  it("missing browser objects (blocked storage, no indexedDB.databases) are skipped, not errors", async () => {
    expect(await purgeDeviceState({ origin: ORIGIN })).toEqual({ failed: [] });
    const result = await purgeDeviceState({
      origin: ORIGIN,
      indexedDB: { deleteDatabase: () => null } as unknown as IDBFactory,
    });
    expect(result.failed).toEqual([]);
  });
});
