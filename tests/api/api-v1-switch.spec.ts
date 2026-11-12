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
import { middleware, config } from "@/middleware";
import { apiV1Enabled, isApiV1Path } from "@/lib/api/enabled";
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
          const res = await middleware(new NextRequest(`http://localhost${route}`, { method }));
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
        const res = await middleware(new NextRequest(`http://localhost${p}`));
        expect(res.status, `${String(value)} ${p}`).toBe(404);
      }
    }
  });

  it("passes every route through when API_V1_ENABLED=true outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("API_V1_ENABLED", "true");
    for (const route of ROUTES) {
      const res = await middleware(new NextRequest(`http://localhost${route}`, { method: "POST" }));
      expect(res.status, route).toBe(200);
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("stays off in production even when API_V1_ENABLED=true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_V1_ENABLED", "true");
    expect(apiV1Enabled()).toBe(false);
    const res = await middleware(new NextRequest("http://localhost/api/v1/patients"));
    expect(res.status).toBe(404);
  });

  it("does not treat look-alike paths as /api/v1", () => {
    expect(isApiV1Path("/api/v1")).toBe(true);
    expect(isApiV1Path("/api/v1/patients")).toBe(true);
    expect(isApiV1Path("/api/v10/patients")).toBe(false);
    expect(isApiV1Path("/api/v1x")).toBe(false);
  });

  it("the middleware matcher covers every v1 route, including ids with an image extension", () => {
    for (const route of ROUTES) {
      expect(unstable_doesMiddlewareMatch({ config, url: route }), route).toBe(true);
    }
    for (const url of ["/api/v1", "/api/v1/patients/abc.png", "/api/v1/visits/x.svg", "/api/v1/lab-orders/a.webp"]) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(true);
    }
  });
});

describe("env schema: API_V1_ENABLED", () => {
  const base = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test-key",
  };

  it("defaults to 'false'", () => {
    expect(parseEnv({ ...base, NODE_ENV: "production" }).API_V1_ENABLED).toBe("false");
    expect(parseEnv({ ...base, NODE_ENV: "test", API_V1_ENABLED: "" }).API_V1_ENABLED).toBe("false");
  });

  it("accepts 'true' outside production", () => {
    expect(parseEnv({ ...base, NODE_ENV: "development", API_V1_ENABLED: "true" }).API_V1_ENABLED).toBe("true");
    expect(parseEnv({ ...base, NODE_ENV: "test", API_V1_ENABLED: "true" }).API_V1_ENABLED).toBe("true");
  });

  it("refuses 'true' in production", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "production", API_V1_ENABLED: "true" })).toThrow(/API_V1_ENABLED/);
  });

  it("refuses values other than 'true' and 'false'", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "test", API_V1_ENABLED: "1" })).toThrow(/API_V1_ENABLED/);
  });
});
