/**
 * V2-09c 09C-02 (R-6, T-09C-03): `GET /api/terminology/substances?q=`, the allergy editor's substance typeahead. 401 without a session, 403 without
 * consultations:view (a receptionist) or a membership, 403 SUBSCRIPTION_LOCKED, 503 when Auth cannot answer, the exact keys, `no-store`, a prefix before a
 * word before the term inside, at most 12 rows, and hostile input as data (`%`, `_` and `\` match themselves). Local stack with a seeded user's own JWT
 * client (the pattern of tests/prescriptions/medicine-search-route.spec.ts). Synthetic data only.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { SUBSTANCE_HIT_KEYS, SUBSTANCE_SEARCH_LIMIT } from "@/features/terminology/substances";
import { addMemberToTenant, seedAccessFixtureClinic, seedTenantWithOwner, signInSeededUser, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";

const mockState = vi.hoisted(() => ({ client: null as unknown, authDown: false }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (mockState.authDown) return { auth: { getUser: async () => ({ data: { user: null }, error: { status: 503, message: "unavailable" } }) } };
    return mockState.client;
  },
}));

import { GET } from "@/app/api/terminology/substances/route";

const search = (q: string | null) => GET(new NextRequest(`http://localhost/api/terminology/substances${q === null ? "" : `?q=${encodeURIComponent(q)}`}`));
const names = async (res: Response) => ((await res.json()) as { results: Array<{ name: string }> }).results.map((r) => r.name);

const admin = getAdminClient();
let clinic: SeededTenant;
let doctor: SeededTenant;
let receptionist: SeededTenant;

const SUBSTANCES = [
  { id: "test-sub-09c-route-1", substance_name: "Qzxsubroute Alpha" },
  { id: "test-sub-09c-route-2", substance_name: "Beta Qzxsubroute" },
  { id: "test-sub-09c-route-3", substance_name: "Gamma qzxsubroute acid" },
  { id: "test-sub-09c-route-4", substance_name: "Qzxsubroute 50% Special" },
  { id: "test-sub-09c-route-5", substance_name: "Qzxsubroute_Under" },
  { id: "test-sub-09c-route-6", substance_name: "Qzxsubroute\\Slash" },
  ...Array.from({ length: 20 }, (_, i) => ({ id: `test-sub-09c-route-b${String(i).padStart(2, "0")}`, substance_name: `Qzxsubbulk ${String(i).padStart(2, "0")}` })),
];

beforeAll(async () => {
  clinic = await seedTenantWithOwner("Substance Route A");
  doctor = await addMemberToTenant(clinic.tenantId, "doctor");
  receptionist = await addMemberToTenant(clinic.tenantId, "receptionist");
  const up = await admin.from("cdci_substances").upsert(SUBSTANCES, { onConflict: "id" });
  if (up.error) throw new Error(up.error.message);
}, 120_000);

describe("GET /api/terminology/substances", () => {
  it("401 without a session, no-store, a fixed body", async () => {
    mockState.client = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const res = await search("qzxsubroute");
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("403 for a signed-in user with no clinic and SUBSCRIPTION_LOCKED for a locked clinic", async () => {
    mockState.client = await signInSeededUser((await seedAccessFixtureClinic("onboarding", "Substance Route Onboarding", ["owner"])).users[0].email);
    expect((await search("qzxsubroute")).status).toBe(403);
    mockState.client = await signInSeededUser((await seedAccessFixtureClinic("locked", "Substance Route Locked", ["owner"])).users[0].email);
    const locked = await search("qzxsubroute");
    expect(locked.status).toBe(403);
    expect(await locked.json()).toMatchObject({ code: "SUBSCRIPTION_LOCKED" });
  });

  it("403 for a receptionist (no consultations:view): the body holds no substance", async () => {
    mockState.client = receptionist.client;
    const res = await search("qzxsubroute");
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.stringify(await res.json())).not.toContain("Qzxsubroute");
  });

  it("503 when Auth cannot answer", async () => {
    mockState.authDown = true;
    try {
      const res = await search("qzxsubroute");
      expect(res.status).toBe(503);
    } finally {
      mockState.authDown = false;
    }
  });

  it("200 with exactly the documented keys, no-store, ranked: prefix, then word prefix, then inside", async () => {
    mockState.client = doctor.client;
    const res = await search("qzxsubroute");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = (await res.json()) as { results: Array<Record<string, unknown>> };
    expect(Object.keys(body)).toEqual(["results"]);
    for (const row of body.results) expect(Object.keys(row)).toEqual([...SUBSTANCE_HIT_KEYS]);
    const list = body.results.map((r) => r.name);
    expect(list.slice(0, 4).sort()).toEqual(["Qzxsubroute 50% Special", "Qzxsubroute Alpha", "Qzxsubroute\\Slash", "Qzxsubroute_Under"].sort());
    expect(list.slice(4)).toEqual(["Beta Qzxsubroute", "Gamma qzxsubroute acid"]);
  });

  it("the result is capped at 12; an empty or missing query is an empty list", async () => {
    mockState.client = doctor.client;
    expect(await names(await search("qzxsubbulk"))).toHaveLength(SUBSTANCE_SEARCH_LIMIT);
    for (const res of [await search(null), await search(""), await search("   ")]) {
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ results: [] });
    }
  });

  it("%, _ and \\ match themselves; hostile input is data", async () => {
    mockState.client = doctor.client;
    expect(await names(await search("50%"))).toEqual(["Qzxsubroute 50% Special"]);
    expect(await names(await search("route_u"))).toEqual(["Qzxsubroute_Under"]);
    expect(await names(await search("route\\s"))).toEqual(["Qzxsubroute\\Slash"]);
    for (const q of ["'; drop table cdci_substances; --", '"},{"x":"y"}', "\u0000qzx", "(a & !b)", "q".repeat(5000)]) {
      expect((await search(q)).status, q.slice(0, 20)).toBe(200);
    }
  });
});
