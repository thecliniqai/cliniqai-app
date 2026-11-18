/**
 * V2-03 03-02 (P1-34, ADR-0005 D2 and Verification 4, T-03-01): `getSystemDb(reason)` is the one service-role factory.
 *
 * - Every call writes exactly one PHI-free JSON line `ts, level, event, reason, module` to stdout and nothing else.
 * - The reason is a closed set: a reason outside it (a cast or `any`) throws before a client exists or a line is written.
 * - Without `SUPABASE_SECRET_KEY` it throws (no anon fallback that would look like a working system client).
 * - The client is the service role: it reads a row RLS hides from anon (proves the factory, not a lookalike).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { getSystemDb, REASON_OWNER, SYSTEM_DB_EVENT, type SystemDbReason } from "@/lib/supabase/system";
import { seedTenantWithOwner } from "../helpers/tenants";

let stdout: MockInstance;
let stderr: MockInstance;

function written(spy: MockInstance): string[] {
  return spy.mock.calls.map((call) => String(call[0]));
}

beforeEach(() => {
  stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("getSystemDb(reason): one log line per acquisition", () => {
  it('getSystemDb("jobs.run") writes exactly one line: ts, level, event, reason, module', () => {
    const db = getSystemDb("jobs.run");
    const out = written(stdout);
    stdout.mockRestore();

    expect(typeof db.from).toBe("function");
    expect(out).toHaveLength(1);
    expect(out[0].endsWith("\n")).toBe(true);
    const line = JSON.parse(out[0]) as Record<string, unknown>;
    expect(Object.keys(line).sort()).toEqual(["event", "level", "module", "reason", "ts"]);
    expect(line).toMatchObject({
      level: "info",
      event: SYSTEM_DB_EVENT,
      reason: "jobs.run",
      module: "app/api/jobs/run",
    });
    expect(Number.isNaN(Date.parse(String(line.ts)))).toBe(false);
    expect(written(stderr)).toEqual([]);
  });

  it("writes one line per call, each naming its own reason and owning module", () => {
    const reasons = Object.keys(REASON_OWNER) as SystemDbReason[];
    for (const reason of reasons) getSystemDb(reason);
    const lines = written(stdout).map((l) => JSON.parse(l) as Record<string, unknown>);
    stdout.mockRestore();

    expect(lines).toHaveLength(reasons.length);
    expect(lines.map((l) => [l.event, l.reason, l.module])).toEqual(
      reasons.map((r) => [SYSTEM_DB_EVENT, r, REASON_OWNER[r]])
    );
  });

  it.each(["", "cron", "api_v2", "share.resolve", "toString", "__proto__", "constructor"])(
    "an unknown reason %j throws and writes nothing",
    (reason) => {
      expect(() => getSystemDb(reason as SystemDbReason)).toThrow("getSystemDb: unknown reason");
      expect(written(stdout)).toEqual([]);
      expect(written(stderr)).toEqual([]);
    }
  );

  it("a non-string reason throws", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const reason of [undefined, null, 42, {}] as any[]) {
      expect(() => getSystemDb(reason)).toThrow("getSystemDb: unknown reason");
    }
    expect(written(stdout)).toEqual([]);
  });

  it("without SUPABASE_SECRET_KEY it throws, names the key, never a value, and logs nothing", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(() => getSystemDb("api_v1")).toThrow("SUPABASE_SECRET_KEY is required for the system client");
    expect(written(stdout)).toEqual([]);
  });
});

describe("getSystemDb(reason): the client is the service role", () => {
  it("reads a tenant row that RLS hides from an anon client", async () => {
    stdout.mockRestore();
    const tenant = await seedTenantWithOwner("System DB Probe Clinic");

    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const hidden = await anon.from("tenants").select("id").eq("id", tenant.tenantId);
    expect(hidden.data ?? []).toEqual([]);

    const { data, error } = await getSystemDb("api_v1").from("tenants").select("id, name").eq("id", tenant.tenantId);
    expect(error).toBeNull();
    expect(data).toEqual([{ id: tenant.tenantId, name: "System DB Probe Clinic" }]);
  });
});
