/**
 * PO-16 / V2-01 D8 (plan 01-05): `/api/v1/**` sits behind API_V1_ENABLED (default off) and the env schema refuses
 * `true` in production. Pure unit tests: no database, no network.
 *
 * The route table is built by walking `app/api/v1/**\/route.ts`, so a new v1 route is covered without editing this
 * file.
 */
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { proxy, config } from "@/proxy";
import { apiRequestBlocked, apiV1Enabled, isApiV1Path, normaliseRequestPath } from "@/lib/api/enabled";
import { authenticateApiKey } from "@/lib/api/auth";
import { GET as getOpenApi } from "@/app/api/v1/openapi.json/route";
import { GET as getDocs } from "@/app/api/v1/docs/route";
import { parseEnv } from "@/lib/env";

const V1_ROOT = path.resolve(__dirname, "../../app/api/v1");
const SAMPLE_ID = "00000000-0000-4000-8000-000000000123";

function v1RoutePaths(): string[] {
  const files = (fs.readdirSync(V1_ROOT, { recursive: true }) as string[])
    .map((f) => f.split(path.sep).join("/"))
    .filter((f) => f === "route.ts" || f.endsWith("/route.ts"));
  return files
    .map((f) => {
      const dir = f.replace(/\/?route\.ts$/, "");
      const segments = dir ? dir.split("/").map((s) => (/^\[.+\]$/.test(s) ? SAMPLE_ID : s)) : [];
      return ["/api/v1", ...segments].join("/");
    })
    .sort();
}

const ROUTES = v1RoutePaths();
const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

describe("/api/v1 switch (API_V1_ENABLED)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("finds the v1 route files, including docs and openapi.json", () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(15);
    expect(ROUTES).toContain("/api/v1/docs");
    expect(ROUTES).toContain("/api/v1/openapi.json");
    expect(ROUTES).toContain(`/api/v1/visits/${SAMPLE_ID}`);
  });

  describe("flag unset (default) → plain 404 for every route and method", () => {
    for (const route of ROUTES) {
      it(`${route}`, async () => {
        vi.stubEnv("API_V1_ENABLED", undefined);
        for (const method of METHODS) {
          const res = await proxy(new NextRequest(`http://localhost${route}`, { method }));
          expect(res.status, `${method} ${route}`).toBe(404);
          expect(res.headers.get("x-middleware-next")).toBeNull();
          expect(await res.text()).toBe("");
        }
      });
    }
  });

  it("returns 404 for the bare prefix, a trailing slash and non-'true' values", async () => {
    for (const value of [undefined, "false", "TRUE", "1", "yes", ""]) {
      vi.stubEnv("API_V1_ENABLED", value);
      for (const p of ["/api/v1", "/api/v1/", "/api/v1/patients"]) {
        const res = await proxy(new NextRequest(`http://localhost${p}`));
        expect(res.status, `${String(value)} ${p}`).toBe(404);
      }
    }
  });

  it("passes every route through when API_V1_ENABLED=true outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("API_V1_ENABLED", "true");
    for (const route of ROUTES) {
      const res = await proxy(new NextRequest(`http://localhost${route}`, { method: "POST" }));
      expect(res.status, route).toBe(200);
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("stays off in production even when API_V1_ENABLED=true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_V1_ENABLED", "true");
    expect(apiV1Enabled()).toBe(false);
    const res = await proxy(new NextRequest("http://localhost/api/v1/patients"));
    expect(res.status).toBe(404);
  });

  it("does not treat look-alike paths as /api/v1", () => {
    expect(isApiV1Path("/api/v1")).toBe(true);
    expect(isApiV1Path("/api/v1/patients")).toBe(true);
    expect(isApiV1Path("/api/v10/patients")).toBe(false);
    expect(isApiV1Path("/api/v1x")).toBe(false);
  });

  it("the proxy matcher covers every v1 route, including ids with an image extension", () => {
    for (const route of ROUTES) {
      expect(unstable_doesMiddlewareMatch({ config, url: route }), route).toBe(true);
    }
    for (const url of ["/api/v1", "/api/v1/patients/abc.png", "/api/v1/visits/x.svg", "/api/v1/lab-orders/a.webp"]) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(true);
    }
  });
});

describe("AR2-H2: encoded and look-alike paths cannot get past the switch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Next decodes the pathname when it matches an app route (`/api/v%31/patients` reaches `/api/v1/patients`), while the
  // proxy sees the raw path. Every one of these must be a 404 while the API is off.
  const ENCODED = [
    "/api/v%31/patients",
    "/api/v%31/openapi.json",
    "/api/v%31/docs",
    "/api/v%31/lab-orders",
    `/api/v%31/visits/${SAMPLE_ID}`,
    "/api%2Fv1/appointments",
    "/api%2fv1/patients",
    "/api/v1%2Fpatients",
    "/%61pi/v1/patients",
    "/api/v%2531/patients",
    "/api/v%25%33%31/patients",
    "/api%252Fv1/patients",
    "/API/v1/patients",
    "/Api/V1",
    "/api/V1/openapi.json",
    "/api/v1/",
    "/api/v%31/",
    "/api%5Cv1/patients",
    "/api%5cv1%5cpatients",
    "/api/x/%2e%2e/v1/patients",
    "/api/v1/%2e/patients",
    "/api/v%",
    "/api/v%E0%A4/patients",
    "/api/%",
  ];

  it.each(ENCODED)("%s → 404 with the flag off", async (p) => {
    for (const value of [undefined, "false"]) {
      vi.stubEnv("API_V1_ENABLED", value);
      for (const method of METHODS) {
        const res = await proxy(new NextRequest(`http://localhost${p}`, { method }));
        expect(res.status, `${method} ${p} (${String(value)})`).toBe(404);
        expect(res.headers.get("x-middleware-next")).toBeNull();
      }
    }
  });

  it("the proxy runs for the encoded forms (matcher)", () => {
    for (const url of [
      "/api/v%31/patients",
      "/api%2Fv1/appointments",
      "/api/v%31/patients/x.png",
      "/api/v%31/visits/x.svg",
      "/api/anything/x.webp",
      "/api",
      "/API/v1/patients",
    ]) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(true);
    }
    // Static assets outside /api stay excluded: top-level image files only since 03-13a (review D L-4), so a nested
    // `/images/hero.webp` runs the proxy like any page path.
    for (const url of ["/logo.png", "/hero.webp", "/_next/static/chunk.js"]) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(false);
    }
  });

  it("normaliseRequestPath decodes repeatedly and resolves separators and dot segments", () => {
    expect(normaliseRequestPath("/api/v%2531/patients")).toBe("/api/v1/patients");
    expect(normaliseRequestPath("/api%5Cv1//patients/")).toBe("/api/v1/patients");
    expect(normaliseRequestPath("/api/x/%2e%2e/v1")).toBe("/api/v1");
    expect(normaliseRequestPath("/api/v%")).toBeNull();
  });

  it("ordinary /api routes and pages are not blocked, with the flag off or on", () => {
    for (const value of [undefined, "true"]) {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("API_V1_ENABLED", value);
      for (const p of [
        "/api/health",
        "/api/r/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "/api/reschedule/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "/api/webhooks/messaging/msg91",
        "/api/v10/patients",
        "/patients/%E0%A4%85",
        "/reports/view",
      ]) {
        expect(apiRequestBlocked(p), `${p} (${String(value)})`).toBe(false);
      }
    }
  });

  it("with the flag on, encoded forms of v1 pass through (the API behaves the same either way)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("API_V1_ENABLED", "true");
    const res = await proxy(new NextRequest("http://localhost/api/v%31/patients"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    // `%` or a backslash left after decoding is refused for every /api path, on or off.
    expect((await proxy(new NextRequest("http://localhost/api/v%/patients"))).status).toBe(404);
    expect((await proxy(new NextRequest("http://localhost/api%5Cv1/patients"))).status).toBe(404);
  });
});

describe("AR2-H2: the v1 handlers enforce the switch themselves (proxy bypassed)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function routeModulePath(route: string): string {
    const rel = route
      .replace(/^\/api\/v1/, "")
      .split("/")
      .filter(Boolean)
      .map((s) => (s === SAMPLE_ID ? "[id]" : s));
    return path.join(V1_ROOT, ...rel, "route.ts");
  }

  it("every exported method of every v1 route returns a bare 404 when the flag is off", async () => {
    vi.stubEnv("API_V1_ENABLED", undefined);
    let calls = 0;
    for (const route of ROUTES) {
      const mod = (await import(routeModulePath(route))) as Record<string, unknown>;
      for (const method of METHODS) {
        const handler = mod[method];
        if (typeof handler !== "function") continue;
        const req = new NextRequest(`http://localhost${route}`, {
          method,
          headers: { authorization: "Bearer clq_live_000000000000000000000000000000000000000000000000" },
          body: method === "GET" || method === "DELETE" ? undefined : "{}",
        });
        const res = (await handler(req, { params: Promise.resolve({ id: SAMPLE_ID }) })) as Response;
        expect(res.status, `${method} ${route}`).toBe(404);
        expect(await res.text(), `${method} ${route}`).toBe("");
        calls++;
      }
    }
    expect(calls).toBeGreaterThanOrEqual(20);
  });

  it("authenticateApiKey answers 404 before touching the database when the flag is off", async () => {
    vi.stubEnv("API_V1_ENABLED", "false");
    const from = vi.fn();
    const res = await authenticateApiKey(
      { from } as never,
      new NextRequest("http://localhost/api/v1/patients", {
        headers: { authorization: "Bearer clq_live_000000000000000000000000000000000000000000000000" },
      })
    );
    expect(res.success).toBe(false);
    if (!res.success) expect(res.response.status).toBe(404);
    expect(from).not.toHaveBeenCalled();
  });

  it("docs and openapi.json are 404 when off and served when on", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("API_V1_ENABLED", undefined);
    expect((await getOpenApi()).status).toBe(404);
    expect((await getDocs()).status).toBe(404);
    vi.stubEnv("API_V1_ENABLED", "true");
    expect((await getOpenApi()).status).toBe(200);
    expect((await getDocs()).status).toBe(200);
  });

  it("the handlers stay off in production even with API_V1_ENABLED=true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_V1_ENABLED", "true");
    expect((await getOpenApi()).status).toBe(404);
  });
});

describe("env schema: API_V1_ENABLED", () => {
  const base = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "anon-test-key",
  };
  // A production build (here the e2e tier: offline providers, loopback URLs) per V2-03 03-01.
  const productionBuild = {
    ...base,
    NODE_ENV: "production",
    APP_ENV: "e2e",
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100",
    MESSAGING_PROVIDER: "dev",
  };

  it("defaults to off", () => {
    expect(parseEnv(productionBuild).API_V1_ENABLED).toBe(false);
    expect(parseEnv({ ...base, NODE_ENV: "test", API_V1_ENABLED: "" }).API_V1_ENABLED).toBe(false);
  });

  it("accepts 'true' outside production", () => {
    expect(parseEnv({ ...base, NODE_ENV: "development", API_V1_ENABLED: "true" }).API_V1_ENABLED).toBe(true);
    expect(parseEnv({ ...base, NODE_ENV: "test", API_V1_ENABLED: "true" }).API_V1_ENABLED).toBe(true);
  });

  it("refuses 'true' in production", () => {
    expect(() => parseEnv({ ...productionBuild, API_V1_ENABLED: "true" })).toThrow(/API_V1_ENABLED/);
  });

  it("refuses values other than 'true' and 'false'", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "test", API_V1_ENABLED: "1" })).toThrow(/API_V1_ENABLED/);
  });
});

