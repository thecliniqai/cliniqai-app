/**
 * Health and readiness probes (D-18; V2-03 03-01, P1-15, C50 g). DB lane: the readiness route runs against the local
 * stack through an anon client (what the cookie client is for a signed-out caller).
 *
 * - `/api/health`: liveness only, plus `region` and `release` from the platform names (null locally, shape-checked).
 * - `/api/ready`: one `readiness_probe()` RPC; the body holds only the allow-listed keys with booleans and counts; no
 *   service role (it still answers 200 when `@/lib/supabase/system` throws on import); providers reported from the env
 *   schema; a failure is a 503 carrying no error text, logged with an error code only.
 * - The proxy passes both probes through without a session refresh.
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";

const state = vi.hoisted(() => ({ client: null as unknown }));

// The service-role factory must not be reachable from the readiness route at all.
vi.mock("@/lib/supabase/system", () => {
  throw new Error("readiness must not import the service-role client");
});

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => state.client };
});

const { GET: getHealth } = await import("@/app/api/health/route");
const { GET: getReady } = await import("@/app/api/ready/route");
const { proxy } = await import("@/proxy");

function anonClient() {
  return createSupabaseClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const READY_KEYS = ["checks", "correlationId", "latestMigration", "outbox", "providers", "status", "timestamp"];

describe("GET /api/health (liveness)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 200 with status, uptime, and null region/release when the platform sets none", async () => {
    vi.stubEnv("VERCEL_REGION", undefined);
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", undefined);
    const res = await getHealth();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["region", "release", "status", "timestamp", "uptime"]);
    expect(body).toMatchObject({ status: "ok", region: null, release: null });
    expect(typeof body.uptime).toBe("number");
  });

  it("reports Vercel's region and the deployed commit (R-26, R-30)", async () => {
    vi.stubEnv("VERCEL_REGION", "bom1");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef0123456789abcdef01234567");
    const body = await (await getHealth()).json();
    expect(body.region).toBe("bom1");
    expect(body.release).toBe("0123456789abcdef0123456789abcdef01234567");
  });

  it("drops platform values that are not a region or a SHA", async () => {
    vi.stubEnv("VERCEL_REGION", "<script>");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "not a sha");
    const body = await (await getHealth()).json();
    expect(body.region).toBeNull();
    expect(body.release).toBeNull();
  });
});

describe("GET /api/ready (readiness RPC, no service role)", () => {
  beforeEach(() => {
    state.client = anonClient();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns 200 with only the allow-listed keys, booleans and counts (admin import throws)", async () => {
    const res = await getReady();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(READY_KEYS);
    expect(body.status).toBe("ready");
    expect(body.checks).toEqual({ database: "ok" });
    expect(Object.keys(body.outbox).sort()).toEqual(["messagesFailed24h", "messagesPending", "webhooksFailed24h", "webhooksPending"]);
    for (const value of Object.values(body.outbox)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value as number).toBeGreaterThanOrEqual(0);
    }
    expect(body.latestMigration).toMatch(/^\d{6}$/);
    expect(Number(body.latestMigration)).toBeGreaterThanOrEqual(25);
    expect(typeof body.correlationId).toBe("string");
  });

  it("reports AI, messaging and email from the env schema, never by calling a provider", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    // The test lane: messaging dev, AI off, email disabled (03-11b).
    let body = await (await getReady()).json();
    expect(body.providers).toEqual({ ai: "disabled", messaging: "disabled", email: "disabled" });

    // Mailpit is a local catcher, not a configured provider.
    vi.stubEnv("EMAIL_PROVIDER", "mailpit");
    vi.stubEnv("MAILPIT_API_URL", "http://127.0.0.1:54324");
    vi.stubEnv("EMAIL_FROM", "no-reply@auth.example.com");
    body = await (await getReady()).json();
    expect(body.providers.email).toBe("disabled");

    // SES with a complete (synthetic, assembled at runtime) configuration.
    vi.stubEnv("EMAIL_PROVIDER", "ses");
    vi.stubEnv("SES_ACCESS_KEY_ID", ["AKIA", "SYNTHETIC0000000"].join(""));
    vi.stubEnv("SES_SECRET_ACCESS_KEY", "synthetic-not-real-".repeat(3));
    vi.stubEnv("SEND_EMAIL_HOOK_SECRET", `v1,whsec_${Buffer.from("synthetic-not-real-hook-key-32b!").toString("base64")}`);

    vi.stubEnv("MESSAGING_PROVIDER", "msg91");
    vi.stubEnv("MSG91_AUTH_KEY", "x");
    vi.stubEnv("AI_ENABLED", "true");
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("AI_API_KEY", "x");
    vi.stubEnv("AI_MODEL_NAME", "m");
    vi.stubEnv("AI_BASE_URL", "http://127.0.0.1:9/v1");
    body = await (await getReady()).json();
    expect(body.providers).toEqual({ ai: "configured", messaging: "configured", email: "configured" });

    const providerCalls = fetchSpy.mock.calls.filter(([url]) => String(url).startsWith("http://127.0.0.1:9"));
    expect(providerCalls).toEqual([]);
  });

  it("returns 503 with no error text when the RPC fails, logging only an error code", async () => {
    const secret = "FATAL: connection to postgresql://synthetic_user:LEAK-password@internal-db:5432 failed";
    state.client = { rpc: async () => ({ data: null, error: { message: secret, code: "XX000" } }) };
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const res = await getReady();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(READY_KEYS);
    expect(body).toMatchObject({ status: "not_ready", checks: { database: "error" }, outbox: null, latestMigration: null });
    expect(JSON.stringify(body)).not.toContain("LEAK-password");
    expect(JSON.stringify(body)).not.toContain("internal-db");

    const logged = stderr.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(logged).toContain('"event":"ready.probe_failed"');
    expect(logged).toContain('"code":"XX000"');
    expect(logged).not.toContain("LEAK-password");
  });

  it("returns 503 when the client throws, and when the RPC answers an unexpected shape", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    state.client = {
      rpc: async () => {
        throw new Error("LEAK-thrown");
      },
    };
    let res = await getReady();
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("LEAK-thrown");

    state.client = { rpc: async () => ({ data: { db: true, messages_pending: "LEAK-row" }, error: null }) };
    res = await getReady();
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("LEAK-row");
  });
});

describe("proxy: probes bypass the session refresh (T-06-19)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("bypasses Supabase auth session refresh for /api/v1 routes when the API is on", async () => {
    vi.stubEnv("API_V1_ENABLED", "true");
    const res = await proxy(new NextRequest("http://localhost:3000/api/v1/patients"));
    expect(res.status).toBe(200);
  });

  it.each(["/api/health", "/api/ready"])("passes %s straight through", async (p) => {
    const res = await proxy(new NextRequest(`http://localhost:3000${p}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
