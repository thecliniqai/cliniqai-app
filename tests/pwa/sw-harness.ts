/**
 * A `node:vm` sandbox for the service worker (`lib/pwa/service-worker-source.ts`, served by `app/sw.js/route.ts`; 06-05's
 * `public/sw.js` until 06-09a) and the runbook's kill switch (V2-06 06-05, T-06-01/T-06-05). The worker runs
 * against in-memory stand-ins for `self`, `caches`, `clients`, the registration and `fetch`, so a spec can fire
 * `install`/`activate`/`fetch`/`message` and read exactly what was stored and which requests got `respondWith`.
 * Requests are plain objects (Node's `Request` refuses `mode: "navigate"`); responses are Node's `Response`.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { serviceWorkerSource } from "@/lib/pwa/service-worker-source";

export const ORIGIN = "http://127.0.0.1:3100";

export interface FakeRequest {
  url: string;
  method: string;
  mode: string;
  headers: Headers;
}

export function req(pathOrUrl: string, init: { method?: string; mode?: string; headers?: Record<string, string> } = {}): FakeRequest {
  return {
    url: new URL(pathOrUrl, ORIGIN).href,
    method: init.method ?? "GET",
    mode: init.mode ?? "cors",
    headers: new Headers(init.headers ?? {}),
  };
}

/** One in-memory cache: insertion-ordered URL → Response (what the Cache API's `keys()` order gives). */
export class FakeCache {
  readonly entries = new Map<string, Response>();
  async match(request: FakeRequest | string): Promise<Response | undefined> {
    const key = typeof request === "string" ? new URL(request, ORIGIN).href : request.url;
    return this.entries.get(key)?.clone();
  }
  async put(request: FakeRequest | string, response: Response): Promise<void> {
    const key = typeof request === "string" ? new URL(request, ORIGIN).href : request.url;
    this.entries.delete(key);
    this.entries.set(key, response);
  }
  async keys(): Promise<FakeRequest[]> {
    return [...this.entries.keys()].map((url) => req(url));
  }
  async delete(request: FakeRequest | string): Promise<boolean> {
    const key = typeof request === "string" ? new URL(request, ORIGIN).href : request.url;
    return this.entries.delete(key);
  }
}

export class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name)!;
  }
  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }
  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }
  async match(request: FakeRequest | string, options: { cacheName?: string } = {}): Promise<Response | undefined> {
    const names = options.cacheName ? [options.cacheName] : [...this.stores.keys()];
    for (const name of names) {
      const hit = await this.stores.get(name)?.match(request);
      if (hit) return hit;
    }
    return undefined;
  }
  /** Every stored URL as `<cache>:<path+query>`. */
  urls(): string[] {
    const out: string[] = [];
    for (const [name, cache] of this.stores) {
      for (const url of cache.entries.keys()) {
        const u = new URL(url);
        out.push(`${name}:${u.pathname}${u.search}`);
      }
    }
    return out;
  }
}

type FetchImpl = (input: FakeRequest | string, init?: RequestInit) => Promise<Response>;

/** `Response` with a settable `type`/`redirected`, as a browser fetch would report them. */
export function response(body: string, init: ResponseInit & { type?: string; redirected?: boolean } = {}): Response {
  const res = new Response(body, { status: init.status ?? 200, headers: init.headers });
  Object.defineProperty(res, "type", { value: init.type ?? "basic" });
  Object.defineProperty(res, "redirected", { value: init.redirected ?? false });
  return res;
}

export interface Worker {
  caches: FakeCacheStorage;
  fetchCalls: Array<{ url: string; init?: RequestInit }>;
  setFetch(impl: FetchImpl): void;
  skipWaitingCalls: number;
  claimed: boolean;
  unregistered: boolean;
  navigationPreloadEnabled: boolean;
  navigated: string[];
  install(): Promise<void>;
  activate(): Promise<void>;
  message(data: unknown): void;
  /** Fires `fetch`; `responded` is false when the worker did not call respondWith. */
  fetch(request: FakeRequest, preloadResponse?: Promise<Response | undefined>): Promise<{ responded: boolean; response?: Response }>;
}

/** Loads `source` (a service-worker script) into a fresh sandbox. */
export function loadWorker(source: string, opts: { navigationPreload?: boolean; windowClients?: string[] } = {}): Worker {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const caches = new FakeCacheStorage();
  const state = {
    fetchCalls: [] as Array<{ url: string; init?: RequestInit }>,
    impl: (async () => response("", { status: 404 })) as FetchImpl,
    skipWaitingCalls: 0,
    claimed: false,
    unregistered: false,
    navigationPreloadEnabled: false,
    navigated: [] as string[],
  };
  const registration = {
    navigationPreload:
      opts.navigationPreload === false
        ? undefined
        : {
            enable: async () => {
              state.navigationPreloadEnabled = true;
            },
          },
    unregister: async () => {
      state.unregistered = true;
      return true;
    },
  };
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    registration,
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    skipWaiting: async () => {
      state.skipWaitingCalls += 1;
    },
    clients: {
      claim: async () => {
        state.claimed = true;
      },
      matchAll: async () =>
        (opts.windowClients ?? []).map((url) => ({
          url,
          navigate: async (to: string) => {
            state.navigated.push(to);
          },
        })),
    },
  };
  const fetchFn = (input: FakeRequest | string, init?: RequestInit) => {
    const url = typeof input === "string" ? new URL(input, ORIGIN).href : input.url;
    state.fetchCalls.push({ url, init });
    return state.impl(input, init);
  };
  const context = vm.createContext({
    self,
    caches,
    fetch: fetchFn,
    URL,
    Response,
    Headers,
    Promise,
    Error,
    console: { log() {}, warn() {}, error() {} },
  });
  new vm.Script(source, { filename: "sw.js" }).runInContext(context);

  const fire = async (type: string, extra: Record<string, unknown>) => {
    const waits: Promise<unknown>[] = [];
    const event = { ...extra, waitUntil: (p: Promise<unknown>) => waits.push(p) };
    for (const fn of listeners.get(type) ?? []) fn(event);
    await Promise.all(waits);
    return event;
  };

  return {
    caches,
    get fetchCalls() {
      return state.fetchCalls;
    },
    setFetch: (impl) => {
      state.impl = impl;
    },
    get skipWaitingCalls() {
      return state.skipWaitingCalls;
    },
    get claimed() {
      return state.claimed;
    },
    get unregistered() {
      return state.unregistered;
    },
    get navigationPreloadEnabled() {
      return state.navigationPreloadEnabled;
    },
    get navigated() {
      return state.navigated;
    },
    install: async () => {
      await fire("install", {});
    },
    activate: async () => {
      await fire("activate", {});
    },
    message: (data) => {
      for (const fn of listeners.get("message") ?? []) fn({ data });
    },
    fetch: async (request, preloadResponse) => {
      let responded: Promise<Response> | undefined;
      await fire("fetch", {
        request,
        preloadResponse: preloadResponse ?? Promise.resolve(undefined),
        respondWith: (p: Promise<Response>) => {
          responded = Promise.resolve(p);
        },
      });
      if (!responded) return { responded: false };
      return { responded: true, response: await responded };
    },
  };
}

/** The worker exactly as `GET /sw.js` serves it for build `build`. */
export const SW_SOURCE = (build = TEST_BUILD) => serviceWorkerSource(build);
export const TEST_BUILD = "build-a";
export const SHELL = `shell-${TEST_BUILD}`;

/** The kill-switch worker the runbook tells operators to deploy as `public/sw.js` in place of the route (scripts/pwa/kill-switch-sw.js). */
export const KILL_SWITCH_SOURCE = () => fs.readFileSync(path.join(process.cwd(), "scripts/pwa/kill-switch-sw.js"), "utf8");
