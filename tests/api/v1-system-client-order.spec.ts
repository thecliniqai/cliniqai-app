/**
 * V2-03 03-13c (review B L-5, triage Low "/api/v1 authenticates before taking the system client"). Every `/api/v1`
 * handler checks the API switch and the shape of the Bearer key BEFORE it acquires the service-role client, so an
 * unauthenticated or switched-off request (including one that bypasses the proxy) never calls `getSystemDb`, never
 * writes a `db.system_acquired` line, and cannot be turned from a 404/401 into a 500 by a missing secret.
 *
 * The route table is built by walking `app/api/v1/**\/route.ts`, so a new v1 route is covered without editing this file.
 * Pure unit test: `@/lib/supabase/system` is replaced by a spy that throws, so any acquisition fails the case.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const acquired = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("@/lib/supabase/system", () => ({
  SYSTEM_DB_EVENT: "db.system_acquired",
  getSystemDb: (reason: string) => {
    acquired.calls.push(reason);
    throw new Error("system client acquired before authentication");
  },
}));

const V1_ROOT = path.resolve(__dirname, "../../app/api/v1");
const SAMPLE_ID = "00000000-0000-4000-8000-000000000123";
const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;
// A well-formed but unknown key, assembled at run time (gitleaks' clinicos-api-key rule matches the literal shape).
const WELL_FORMED_KEY = `Bearer ${["clq", "live", "0".repeat(48)].join("_")}`;

function v1RouteFiles(): string[] {
  return (fs.readdirSync(V1_ROOT, { recursive: true }) as string[])
    .map((f) => f.split(path.sep).join("/"))
    .filter((f) => f === "route.ts" || f.endsWith("/route.ts"))
    .sort();
}

/** Handlers of the files that authenticate with an API key (docs and openapi.json are public and never do). */
async function keyHandlers() {
  const out: Array<[string, string, (req: NextRequest, ctx: unknown) => Promise<Response>]> = [];
  for (const file of v1RouteFiles()) {
    const source = fs.readFileSync(path.join(V1_ROOT, file), "utf8");
    if (!source.includes("authenticateApiKey")) continue;
    const mod = (await import(path.join(V1_ROOT, file))) as Record<string, unknown>;
    for (const method of METHODS) {
      const handler = mod[method];
      if (typeof handler === "function") out.push([file, method, handler as never]);
    }
  }
  return out;
}

function request(file: string, method: string, authorization?: string) {
  const dir = file.replace(/\/?route\.ts$/, "").replace(/\[[^\]]+\]/g, SAMPLE_ID);
  return new NextRequest(`http://localhost/api/v1/${dir}`, {
    method,
    headers: authorization ? { authorization } : {},
    body: method === "GET" || method === "DELETE" ? undefined : "{}",
  });
}

const ctx = { params: Promise.resolve({ id: SAMPLE_ID }) };

afterEach(() => {
  vi.unstubAllEnvs();
  acquired.calls = [];
});

describe("/api/v1: no system client before authentication (review B L-5)", () => {
  it("finds every key-authenticated handler", async () => {
    expect((await keyHandlers()).length).toBeGreaterThanOrEqual(20);
  });

  it("switch off: every handler answers 404 without acquiring the system client", async () => {
    vi.stubEnv("API_V1_ENABLED", "false");
    for (const [file, method, handler] of await keyHandlers()) {
      const res = await handler(request(file, method, WELL_FORMED_KEY), ctx);
      expect(res.status, `${method} ${file}`).toBe(404);
    }
    expect(acquired.calls).toEqual([]);
  });

  it("switch on: a malformed or missing key is 401 without acquiring the system client", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("API_V1_ENABLED", "true");
    for (const [file, method, handler] of await keyHandlers()) {
      for (const authorization of ["Bearer not-a-key", "Bearer clq_live_short", "Bearer  "]) {
        const res = await handler(request(file, method, authorization), ctx);
        expect(res.status, `${method} ${file} (${authorization})`).toBe(401);
      }
    }
    expect(acquired.calls).toEqual([]);
  });

  it("switch on: a well-formed key is looked up through the system client named api_v1", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("API_V1_ENABLED", "true");
    const [[file, method, handler]] = await keyHandlers();
    await expect(
      handler(request(file, method, WELL_FORMED_KEY), ctx),
    ).rejects.toThrow(/system client acquired/);
    expect(acquired.calls).toEqual(["api_v1"]);
  });
});
