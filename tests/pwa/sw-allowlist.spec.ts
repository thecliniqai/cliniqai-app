/**
 * The service worker in a `node:vm` sandbox (V2-06 06-05; PWA_STRATEGY §4 D-1/D-2, §5; T-06-01, T-06-02, T-06-05,
 * T-06-20), as `GET /sw.js` serves it (`lib/pwa/service-worker-source.ts` with a build stamp; 06-05's `public/sw.js`).
 *
 * 06-09a M-OFFLINE: the script carries the build stamp, so two builds are two different workers; the shell cache is
 * `shell-<build>` and `activate` deletes the previous build's; `/offline` is precached with the stylesheets it links and
 * without its scripts, and those stylesheets are served from the shell cache offline (06-05: the static cache, FIFO,
 * evicted first; no stamp, so a device kept the first build's `/offline` for ever).
 *
 * The worker may store only the positive allowlist: the five precached shell URLs (fetched signed out, install refused
 * on a redirect or a non-200) and `/_next/static/**` (cache-first, capped). Navigations are answered from the network
 * and never stored (offline → the precached `/offline`). Everything else gets no `respondWith`: API, RSC (`?_rsc=` or
 * `RSC: 1`), auth and share-token paths, `/_next/image`, cross-origin and non-GET requests. Before 06-05 there was no
 * worker. The kill-switch worker (scripts/pwa/kill-switch-sw.js) parses, deletes every cache and unregisters.
 */
import { describe, expect, it } from "vitest";
import { KILL_SWITCH_SOURCE, loadWorker, req, response, SHELL, SW_SOURCE } from "./sw-harness";
import { serviceWorkerSource } from "@/lib/pwa/service-worker-source";

const PRECACHE = ["/offline", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"];
const STATIC_HEADERS = { "cache-control": "public, max-age=31536000, immutable" };

function okWorker() {
  const sw = loadWorker(SW_SOURCE());
  sw.setFetch(async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url, "http://127.0.0.1:3100");
    if (url.pathname.startsWith("/_next/static/")) return response(`static ${url.pathname}${url.search}`, { headers: STATIC_HEADERS });
    return response(`network ${url.pathname}${url.search}`);
  });
  return sw;
}

describe("sw.js install: precache of the public shell", () => {
  it("precaches exactly the five shell URLs, each fetched signed out with no HTTP cache", async () => {
    const sw = okWorker();
    await sw.install();
    expect(sw.caches.urls().sort()).toEqual(PRECACHE.map((u) => `${SHELL}:${u}`).sort());
    expect(sw.fetchCalls.map((c) => new URL(c.url).pathname)).toEqual(PRECACHE);
    for (const call of sw.fetchCalls) expect(call.init).toMatchObject({ credentials: "omit", cache: "no-store" });
  });

  it.each([
    ["a redirected answer (a login page reached by a redirect)", { redirected: true }],
    ["a non-200 answer", { status: 404 }],
    ["an opaque redirect", { type: "opaqueredirect" }],
  ])("refuses %s: install fails and nothing is cached", async (_name, init) => {
    const sw = loadWorker(SW_SOURCE());
    sw.setFetch(async (input) => {
      const path = new URL(typeof input === "string" ? input : input.url, "http://127.0.0.1:3100").pathname;
      return path === "/offline" ? response("<html>Sign in</html>", init) : response("ok");
    });
    await expect(sw.install()).rejects.toThrow(/precache refused \/offline/);
    expect(sw.caches.urls()).toEqual([]);
  });
});

describe("06-09a M-OFFLINE: build stamp and a self-contained /offline", () => {
  const OFFLINE_HTML =
    '<!DOCTYPE html><html lang="en-IN"><head><link rel="stylesheet" href="/_next/static/chunks/app.css" data-precedence="next"/>' +
    '<link rel="preload" as="script" fetchPriority="low" href="/_next/static/chunks/a.js"/>' +
    '<link rel="stylesheet" href="https://cdn.example/x.css"/><link rel="manifest" href="/manifest.webmanifest"/>' +
    '<script src="/_next/static/chunks/a.js" async=""></script></head><body><main class="min-h-app">You&#x27;re offline</main>' +
    "<script>self.__next_f.push([1,\"payload\"])</script></body></html>";

  function offlineWorker(build?: string) {
    const sw = loadWorker(SW_SOURCE(build));
    sw.setFetch(async (input) => {
      const url = new URL(typeof input === "string" ? input : input.url, "http://127.0.0.1:3100");
      if (url.pathname === "/offline") return response(OFFLINE_HTML, { headers: { "content-type": "text/html" } });
      if (url.pathname === "/_next/static/chunks/app.css") return response(".min-h-app{min-height:100dvh}", { headers: { "content-type": "text/css" } });
      return response(`network ${url.pathname}`);
    });
    return sw;
  }

  it("two builds are two different scripts (the browser installs the second); the stamp names the shell cache", () => {
    const a = serviceWorkerSource("build-a");
    const b = serviceWorkerSource("build-b");
    expect(a).not.toBe(b);
    expect(a).toContain('const BUILD = "build-a";');
    expect(a.replace("build-a", "build-b")).toBe(b);
    for (const bad of ["", "a b", "x".repeat(65), '"; alert(1); "', "../x"]) expect(() => serviceWorkerSource(bad)).toThrow(/invalid build stamp/);
  });

  it("install precaches the five shell URLs plus the same-origin stylesheet /offline links, signed out", async () => {
    const sw = offlineWorker();
    await sw.install();
    expect(sw.caches.urls().sort()).toEqual([...PRECACHE, "/_next/static/chunks/app.css"].map((u) => `${SHELL}:${u}`).sort());
    expect(sw.fetchCalls.map((c) => new URL(c.url).pathname)).not.toContain("/x.css");
    for (const call of sw.fetchCalls) expect(call.init).toMatchObject({ credentials: "omit", cache: "no-store" });
  });

  it("the stored /offline has no script and no script preload, keeps its stylesheet link and names its build", async () => {
    const sw = offlineWorker();
    await sw.install();
    const html = await (await sw.caches.match("/offline", { cacheName: SHELL }))!.text();
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/as="script"/);
    expect(html).toContain('<link rel="stylesheet" href="/_next/static/chunks/app.css"');
    expect(html).toContain('<html data-sw-build="build-a" lang="en-IN">');
    expect(html).toContain("You&#x27;re offline");
  });

  it("offline, the stylesheet is answered from the shell cache with no network call", async () => {
    const sw = offlineWorker();
    await sw.install();
    const calls = sw.fetchCalls.length;
    sw.setFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const r = await sw.fetch(req("/_next/static/chunks/app.css"));
    expect(await r.response!.text()).toBe(".min-h-app{min-height:100dvh}");
    expect(sw.fetchCalls.length).toBe(calls + 0);
  });

  it("a refused stylesheet (non-200) fails install like any precache entry: nothing is cached", async () => {
    const sw = loadWorker(SW_SOURCE());
    sw.setFetch(async (input) => {
      const path = new URL(typeof input === "string" ? input : input.url, "http://127.0.0.1:3100").pathname;
      if (path === "/offline") return response(OFFLINE_HTML);
      if (path.endsWith(".css")) return response("nope", { status: 404 });
      return response("ok");
    });
    await expect(sw.install()).rejects.toThrow(/precache refused \/_next\/static\/chunks\/app\.css/);
    expect(sw.caches.urls()).toEqual([]);
  });

  it("a second build's worker replaces the first build's shell on activate; its /offline names the new build", async () => {
    const first = offlineWorker("build-a");
    await first.install();
    await first.activate();
    const second = loadWorker(SW_SOURCE("build-b"));
    // Same device: the second worker sees the first one's caches.
    for (const [name, cache] of first.caches.stores) second.caches.stores.set(name, cache);
    second.setFetch(async (input) => {
      const url = new URL(typeof input === "string" ? input : input.url, "http://127.0.0.1:3100");
      if (url.pathname === "/offline") return response(OFFLINE_HTML.replace("app.css", "app2.css"));
      if (url.pathname.endsWith(".css")) return response(".x{}");
      return response("ok");
    });
    await second.install();
    await second.activate();
    expect(await second.caches.keys()).toEqual(["shell-build-b"]);
    const html = await (await second.caches.match("/offline", { cacheName: "shell-build-b" }))!.text();
    expect(html).toContain('data-sw-build="build-b"');
    expect(html).toContain("/_next/static/chunks/app2.css");
  });
});

describe("sw.js activate", () => {
  it("deletes every cache except static-v1 and this build's shell (an older build's shell goes), enables navigation preload and claims the clients", async () => {
    const sw = okWorker();
    for (const name of ["static-v0", "shell-v1", "shell-build-0", "pages", "static-v1", SHELL]) await sw.caches.open(name);
    await sw.activate();
    expect((await sw.caches.keys()).sort()).toEqual([SHELL, "static-v1"]);
    expect(sw.navigationPreloadEnabled).toBe(true);
    expect(sw.claimed).toBe(true);
  });
});

describe("sw.js fetch: what gets respondWith and what is stored", () => {
  it("navigation: the network answer is returned and never stored", async () => {
    const sw = okWorker();
    const r = await sw.fetch(req("/patients/abc", { mode: "navigate" }));
    expect(r.responded).toBe(true);
    expect(await r.response!.text()).toBe("network /patients/abc");
    expect(sw.caches.urls()).toEqual([]);
  });

  it("navigation: the navigation-preload response is used when present (no second fetch)", async () => {
    const sw = okWorker();
    const r = await sw.fetch(req("/queue", { mode: "navigate" }), Promise.resolve(response("preloaded /queue")));
    expect(await r.response!.text()).toBe("preloaded /queue");
    expect(sw.fetchCalls).toEqual([]);
    expect(sw.caches.urls()).toEqual([]);
  });

  it("navigation offline: the precached /offline page answers; nothing new is stored", async () => {
    const sw = okWorker();
    await sw.install();
    sw.setFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const r = await sw.fetch(req("/patients", { mode: "navigate" }), Promise.reject(new TypeError("Failed to fetch")));
    expect(r.responded).toBe(true);
    expect(await r.response!.text()).toBe("network /offline"); // no <html> tag in this stand-in: nothing to stamp
    expect(sw.caches.urls().every((u) => u.startsWith(`${SHELL}:`))).toBe(true);
    expect(sw.caches.urls()).toHaveLength(PRECACHE.length);
  });

  it("/_next/static: cache-first, keyed with the query (?dpl=), served from the cache the second time", async () => {
    const sw = okWorker();
    const first = await sw.fetch(req("/_next/static/chunks/app.js?dpl=one"));
    expect(first.responded).toBe(true);
    expect(await first.response!.text()).toBe("static /_next/static/chunks/app.js?dpl=one");
    expect(sw.caches.urls()).toEqual(["static-v1:/_next/static/chunks/app.js?dpl=one"]);
    const calls = sw.fetchCalls.length;
    const second = await sw.fetch(req("/_next/static/chunks/app.js?dpl=one"));
    expect(await second.response!.text()).toBe("static /_next/static/chunks/app.js?dpl=one");
    expect(sw.fetchCalls.length).toBe(calls);
    await sw.fetch(req("/_next/static/chunks/app.js?dpl=two"));
    expect(sw.caches.urls()).toContain("static-v1:/_next/static/chunks/app.js?dpl=two");
  });

  it("/_next/static answers that are not plain cacheable 200s are passed on but not stored", async () => {
    const sw = loadWorker(SW_SOURCE());
    const answers: Record<string, Response> = {
      "/_next/static/a.js": response("x", { status: 404 }),
      "/_next/static/b.js": response("x", { headers: { "cache-control": "private, no-store" } }),
      "/_next/static/c.js": response("x", { redirected: true, headers: STATIC_HEADERS }),
    };
    sw.setFetch(async (input) => answers[new URL(typeof input === "string" ? input : input.url).pathname]);
    for (const p of Object.keys(answers)) expect((await sw.fetch(req(p))).responded).toBe(true);
    expect(sw.caches.urls()).toEqual([]);
  });

  it("caps static-v1 at 200 entries, evicting the oldest first", async () => {
    const sw = okWorker();
    for (let i = 0; i < 205; i++) await sw.fetch(req(`/_next/static/chunks/${i}.js`));
    const urls = sw.caches.urls();
    expect(urls).toHaveLength(200);
    expect(urls[0]).toBe("static-v1:/_next/static/chunks/5.js");
    expect(urls).toContain("static-v1:/_next/static/chunks/204.js");
  });

  it.each([
    ["an API GET", req("/api/patients/abc/export")],
    ["an RSC fetch by query", req("/patients/abc?_rsc=1x2y")],
    ["an RSC fetch by header", req("/patients/abc", { headers: { RSC: "1" } })],
    ["an RSC fetch for the root by query", req("/?_rsc=abc")],
    ["an RSC-marked request under /_next/static", req("/_next/static/x.js?_rsc=1")],
    ["/auth (fetch)", req("/auth/signout")],
    ["a share-token page fetch", req("/r/sometoken")],
    ["a reschedule page fetch", req("/reschedule/sometoken")],
    ["a report view fetch", req("/reports/view?t=x")],
    ["/_next/image", req("/_next/image?url=%2Flogo.png&w=64&q=75")],
    ["the manifest (fetched by the page)", req("/manifest.webmanifest")],
    ["a cross-origin GET (Supabase REST)", req("http://127.0.0.1:54321/rest/v1/patients?select=*")],
    ["a cross-origin static-looking path", req("https://cdn.example/_next/static/x.js")],
    ["a Server Action POST", req("/patients", { method: "POST", headers: { "Next-Action": "abc" } })],
    ["a POST navigation (form sign-out)", req("/auth/signout", { method: "POST", mode: "navigate" })],
    ["a non-GET under /_next/static", req("/_next/static/x.js", { method: "HEAD" })],
  ])("%s gets no respondWith and nothing is stored", async (_name, request) => {
    const sw = okWorker();
    const r = await sw.fetch(request);
    expect(r.responded).toBe(false);
    expect(sw.fetchCalls).toEqual([]);
    expect(sw.caches.urls()).toEqual([]);
  });
});

describe("sw.js messages", () => {
  it("SKIP_WAITING activates a waiting worker (06-06's safe-point update); anything else is ignored", async () => {
    const sw = okWorker();
    sw.message({ type: "something-else" });
    sw.message(null);
    expect(sw.skipWaitingCalls).toBe(0);
    sw.message({ type: "SKIP_WAITING" });
    expect(sw.skipWaitingCalls).toBe(1);
  });
});

describe("kill switch (scripts/pwa/kill-switch-sw.js, deployed per the PWA runbook)", () => {
  it("parses, takes over at once, deletes every cache, unregisters and reloads open windows", async () => {
    const sw = loadWorker(KILL_SWITCH_SOURCE(), { windowClients: ["http://127.0.0.1:3100/patients"] });
    for (const name of ["static-v1", SHELL, "anything"]) await sw.caches.open(name);
    await sw.install();
    expect(sw.skipWaitingCalls).toBe(1);
    await sw.activate();
    expect(await sw.caches.keys()).toEqual([]);
    expect(sw.unregistered).toBe(true);
    expect(sw.navigated).toEqual(["http://127.0.0.1:3100/patients"]);
    // It answers nothing: every request goes to the network.
    expect((await sw.fetch(req("/_next/static/x.js"))).responded).toBe(false);
  });
});
