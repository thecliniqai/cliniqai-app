/**
 * V2-09e 09E-02 (R-20, T-09E-14, T-09E-15): `POST /api/rum`. Authentication, the size and shape limits, the per-user rate limit, and what reaches
 * `public.ops_ingest_rum`: the closed-list samples and the server's own environment and release. The context and the database call are fakes here;
 * the SQL side is `supabase/tests/database/rum_daily.test.sql` and the end-to-end path is `tests/e2e/observability/rum.spec.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/context")>();
  return { ...actual, resolveServiceContext: mocks.resolve };
});

import { NextRequest } from "next/server";
import { POST } from "@/app/api/rum/route";
import { rumBatchLimiter, RUM_BATCHES_PER_MINUTE } from "@/lib/observability/rum/ingest";
import { RUM_MAX_BODY_BYTES } from "@/lib/observability/rum/catalog";

const USER = "00000000-0000-4000-8000-00000000a001";
const TENANT = "00000000-0000-4000-8000-00000000b001";
const SAMPLE = { screen: "today", metric: "lcp", device: "desktop", net: "4g", value: 1800 };

function post(body: unknown, headers: Record<string, string> = {}, raw?: string) {
  return POST(
    new NextRequest("http://localhost:3000/api/rum", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", "sec-fetch-site": "same-origin", ...headers },
      body: raw ?? JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  mocks.resolve.mockReset();
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.resolve.mockResolvedValue({ ok: true, ctx: { userId: USER, tenantId: TENANT, role: "receptionist", actorType: "user", db: { rpc: mocks.rpc } } });
  rumBatchLimiter.reset();
});

describe("POST /api/rum: who may call", () => {
  it("401 without a session, 403 without a membership, 503 when Auth could not answer; nothing is written", async () => {
    mocks.resolve.mockResolvedValueOnce({ ok: false, reason: "unauthenticated", error: "Unauthenticated" });
    expect((await post({ samples: [SAMPLE] })).status).toBe(401);
    mocks.resolve.mockResolvedValueOnce({ ok: false, reason: "no_membership", error: "x" });
    expect((await post({ samples: [SAMPLE] })).status).toBe(403);
    mocks.resolve.mockResolvedValueOnce({ ok: false, reason: "unavailable", error: "x" });
    expect((await post({ samples: [SAMPLE] })).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("any active member is enough, whatever the clinic's access level: the guard asks for the billing-level access, no permission", async () => {
    await post({ samples: [SAMPLE] });
    expect(mocks.resolve).toHaveBeenCalledWith(undefined, "billing");
  });

  it("a cross-origin call is refused before any session work", async () => {
    const res = await post({ samples: [SAMPLE] }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" });
    expect(res.status).toBe(403);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});

describe("POST /api/rum: the body", () => {
  it("accepts a valid batch with 204, private no-store and no body; one database call with the server's own environment and release", async () => {
    const res = await post({ samples: [SAMPLE, { ...SAMPLE, metric: "cls", value: 0.07 }] });
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.text()).toBe("");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = mocks.rpc.mock.calls[0]!;
    expect(fn).toBe("ops_ingest_rum");
    expect(Object.keys(args).sort()).toEqual(["p_environment", "p_release", "p_samples"]);
    expect(args.p_samples).toHaveLength(2);
    // Tenant and user are never part of the call.
    expect(JSON.stringify(args)).not.toContain(USER);
    expect(JSON.stringify(args)).not.toContain(TENANT);
  });

  it("takes the environment and release from the server, never from the browser", async () => {
    await post({ samples: [SAMPLE], environment: "production", release: "deadbeef" });
    expect(mocks.rpc).not.toHaveBeenCalled(); // an unknown top-level key is a 400
    const res = await post({ samples: [SAMPLE] });
    expect(res.status).toBe(204);
    expect(["development", "test", "e2e", "ci", "staging", "production"]).toContain(mocks.rpc.mock.calls[0]![1].p_environment);
    expect(mocks.rpc.mock.calls[0]![1].p_release).not.toBe("deadbeef");
  });

  it("an empty batch is 204 and calls nothing", async () => {
    expect((await post({ samples: [] })).status).toBe(204);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("400 for an unknown key, a value outside a closed list, a non-number, a uuid or a slash where a word belongs, and not-JSON", async () => {
    const bad: unknown[] = [
      { samples: [{ ...SAMPLE, url: "/patients" }] },
      { samples: [{ ...SAMPLE, screen: "11111111-2222-4333-8444-555555555555" }] },
      { samples: [{ ...SAMPLE, screen: "/patients/abc" }] },
      { samples: [{ ...SAMPLE, metric: "page_load" }] },
      { samples: [{ ...SAMPLE, device: "watch" }] },
      { samples: [{ ...SAMPLE, net: "5g" }] },
      { samples: [{ ...SAMPLE, value: "100" }] },
      { samples: [{ ...SAMPLE, value: -1 }] },
      { samples: [{ ...SAMPLE, value: 600_001 }] },
      { samples: [{ ...SAMPLE, metric: "cls", value: 101 }] },
      { samples: [{ screen: "today" }] },
      { samples: "today" },
      { samples: Array.from({ length: 61 }, () => SAMPLE) },
      [SAMPLE],
    ];
    // Every attempt counts toward the per-user limit (a refused body costs the caller too), so each case starts a fresh window.
    for (const body of bad) {
      rumBatchLimiter.reset();
      expect((await post(body)).status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    rumBatchLimiter.reset();
    expect((await post(null, {}, "{not json")).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("accepts exactly 60 samples", async () => {
    expect((await post({ samples: Array.from({ length: 60 }, () => SAMPLE) })).status).toBe(204);
  });

  it("413 for a body over 8 kB, by its declared length and by what it really holds", async () => {
    const big = { samples: [SAMPLE], pad: "x".repeat(RUM_MAX_BODY_BYTES) };
    expect((await post(big, { "content-length": String(JSON.stringify(big).length) })).status).toBe(413);
    expect((await post(big)).status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers a fixed 500 when the database refuses, with nothing of the error in the body", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { code: "22023", message: "rum: refused secret-detail" } });
    const res = await post({ samples: [SAMPLE] });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret-detail");
  });
});

describe("POST /api/rum: flooding", () => {
  it(`429 past ${RUM_BATCHES_PER_MINUTE} batches a minute per user, and another user is not affected`, async () => {
    for (let i = 0; i < RUM_BATCHES_PER_MINUTE; i++) expect((await post({ samples: [SAMPLE] })).status).toBe(204);
    expect((await post({ samples: [SAMPLE] })).status).toBe(429);
    mocks.resolve.mockResolvedValue({ ok: true, ctx: { userId: "00000000-0000-4000-8000-00000000a002", tenantId: TENANT, role: "doctor", actorType: "user", db: { rpc: mocks.rpc } } });
    expect((await post({ samples: [SAMPLE] })).status).toBe(204);
  });

  it("the window slides: a minute later the user may send again", async () => {
    let clock = 1_000_000;
    const { createBatchLimiter } = await import("@/lib/observability/rum/ingest");
    const limiter = createBatchLimiter(() => clock);
    for (let i = 0; i < RUM_BATCHES_PER_MINUTE; i++) expect(limiter.allow("u")).toBe(true);
    expect(limiter.allow("u")).toBe(false);
    clock += 60_001;
    expect(limiter.allow("u")).toBe(true);
  });
});
