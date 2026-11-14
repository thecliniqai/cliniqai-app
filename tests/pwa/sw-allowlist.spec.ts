/**
 * `public/sw.js` in a `node:vm` sandbox (V2-06 06-05; PWA_STRATEGY §4 D-1/D-2, §5; T-06-01, T-06-02, T-06-05, T-06-20).
 *
 * The worker may store only the positive allowlist: the five precached shell URLs (fetched signed out, install refused
 * on a redirect or a non-200) and `/_next/static/**` (cache-first, capped). Navigations are answered from the network
 * and never stored (offline → the precached `/offline`). Everything else gets no `respondWith`: API, RSC (`?_rsc=` or
 * `RSC: 1`), auth and share-token paths, `/_next/image`, cross-origin and non-GET requests. Before 06-05 there was no
 * worker. The runbook's kill-switch body parses, deletes every cache and unregisters.
 */
import { describe, expect, it } from "vitest";
import { killSwitchSource, loadWorker, req, response, SW_SOURCE } from "./sw-harness";

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
    expect(sw.caches.urls().sort()).toEqual(PRECACHE.map((u) => `shell-v1:${u}`).sort());
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

describe("sw.js activate", () => {
  it("deletes every cache except static-v1 and shell-v1, enables navigation preload and claims the clients", async () => {
    const sw = okWorker();
    for (const name of ["static-v0", "shell-v0", "pages", "static-v1", "shell-v1"]) await sw.caches.open(name);
    await sw.activate();
    expect((await sw.caches.keys()).sort()).toEqual(["shell-v1", "static-v1"]);
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
    expect(await r.response!.text()).toBe("network /offline");
    expect(sw.caches.urls().every((u) => u.startsWith("shell-v1:"))).toBe(true);
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

describe("kill switch (docs/runbooks/pwa.md)", () => {
  it("parses, takes over at once, deletes every cache, unregisters and reloads open windows", async () => {
    const sw = loadWorker(killSwitchSource(), { windowClients: ["http://127.0.0.1:3100/patients"] });
    for (const name of ["static-v1", "shell-v1", "anything"]) await sw.caches.open(name);
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
