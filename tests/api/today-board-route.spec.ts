/**
 * V2-09e 09E-03 (R-14, T-09E-02, T-09E-04): `GET /api/today/board?mode=`, the board read of the client data layer. 401 without a session,
 * 403 for a user with no clinic, 403 SUBSCRIPTION_LOCKED for a locked clinic, `Cache-Control: private, no-store` (`Server-Timing` is checked in the e2e: it needs a request scope), the exact
 * response keys (the board and each row's `TODAY_ROW_KEYS`), only the caller's clinic whatever the query string adds, and the doctor's
 * mode reading only that doctor's own visits. Local stack: the server client is replaced by a seeded user's own JWT client
 * (the pattern of tests/patients/search-route.spec.ts). Synthetic data only.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { TODAY_ROW_KEYS } from "@/features/today/schema";
import { seedAccessFixtureClinic, seedTenantWithOwner, signInSeededUser, addMemberToTenant, type SeededTenant } from "../helpers/tenants";
import { seedVisit } from "../helpers/billing-commands";

const mockState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockState.client,
}));

import { GET } from "@/app/api/today/board/route";

const board = (query = "") => GET(new NextRequest(`http://localhost/api/today/board${query}`));

let a: SeededTenant;
let b: SeededTenant;
let doctor: SeededTenant;
let receptionist: SeededTenant;
let visitOfOwner: string;
let visitOfDoctor: string;
let visitOfB: string;

beforeAll(async () => {
  a = await seedTenantWithOwner("Route Board A");
  b = await seedTenantWithOwner("Route Board B");
  doctor = await addMemberToTenant(a.tenantId, "doctor");
  receptionist = await addMemberToTenant(a.tenantId, "receptionist");
  visitOfOwner = (await seedVisit(a, a.userId)).visitId;
  visitOfDoctor = (await seedVisit(a, doctor.userId)).visitId;
  visitOfB = (await seedVisit(b, b.userId)).visitId;
});

describe("GET /api/today/board", () => {
  it("401 without a session, and the body holds no data", async () => {
    mockState.client = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const res = await board();
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("403 for a signed-in user with no clinic", async () => {
    mockState.client = await signInSeededUser((await seedAccessFixtureClinic("onboarding", "Route Board Onboarding", ["owner"])).users[0].email);
    const res = await board();
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.stringify(await res.json())).not.toContain("rows");
  });

  it("403 SUBSCRIPTION_LOCKED for a locked clinic", async () => {
    const locked = await seedAccessFixtureClinic("locked", "Route Board Locked", ["owner"]);
    mockState.client = await signInSeededUser(locked.users[0].email);
    const res = await board();
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toMatchObject({ code: "SUBSCRIPTION_LOCKED" });
  });

  it("200 with no-store and exactly the board's keys and each row's projection", async () => {
    mockState.client = receptionist.client;
    const res = await board("?mode=front");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = (await res.json()) as { rows: Array<Record<string, unknown>> };
    expect(Object.keys(body)).toEqual(["rows", "generatedAt", "today", "timeZone"]);
    expect(body.rows.map((r) => r.visitId).sort()).toEqual([visitOfOwner, visitOfDoctor].sort());
    for (const row of body.rows) expect(Object.keys(row).sort()).toEqual([...TODAY_ROW_KEYS].sort());
  });

  it("only the caller's clinic: clinic B's visit is never listed to A, whatever the query string adds", async () => {
    mockState.client = receptionist.client;
    const res = await board(`?mode=front&tenant=${b.tenantId}&tenant_id=${b.tenantId}&tenantId=${b.tenantId}`);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(visitOfB);
    expect(text).not.toContain(b.tenantId);
  });

  it("the doctor's mode reads only that doctor's visits; a mode the role may not use falls back to its own", async () => {
    mockState.client = doctor.client;
    const own = (await (await board("?mode=doctor")).json()) as { rows: Array<{ visitId: string }> };
    expect(own.rows.map((r) => r.visitId)).toEqual([visitOfDoctor]);
    // A receptionist asking for the doctor's mode gets the front desk's day, not a doctor's queue.
    mockState.client = receptionist.client;
    const asReception = (await (await board("?mode=doctor")).json()) as { rows: Array<{ visitId: string }> };
    expect(asReception.rows.map((r) => r.visitId).sort()).toEqual([visitOfOwner, visitOfDoctor].sort());
    const junk = await board("?mode=%00;drop");
    expect(junk.status).toBe(200);
  });
});
