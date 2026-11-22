/**
 * V2-09c 09C-01 (R-3, T-09C-03): `GET /api/prescriptions/medicines?q=&limit=`, the Rx builder's medicine typeahead. 401 without a session, 403 without
 * `prescriptions:edit` (nurse, receptionist) or a membership, 403 SUBSCRIPTION_LOCKED for a locked clinic, 503 when Auth cannot answer, the exact response
 * keys, `Cache-Control: private, no-store`, the caller's own custom medicines first and never another doctor's, no CDCI row carrying a dosage, timing or duration,
 * and hostile input as data (quotes, SQL text, tsquery syntax, wildcards, oversized): `%`, `_` and `\` match themselves. Local stack: `createClient()` from
 * `@/lib/supabase/server` is replaced by a seeded user's own JWT client (the pattern of tests/terminology/diagnosis-search-route.spec.ts). Synthetic data only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { MEDICINE_SEARCH_KEYS, MEDICINE_SEARCH_LIMIT } from "@/features/prescriptions/schema";
import { addMemberToTenant, seedAccessFixtureClinic, seedTenantWithOwner, signInSeededUser, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";

const mockState = vi.hoisted(() => ({ client: null as unknown, authDown: false }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (mockState.authDown) {
      return { auth: { getUser: async () => ({ data: { user: null }, error: { status: 503, message: "unavailable" } }) } };
    }
    return mockState.client;
  },
}));

import { GET } from "@/app/api/prescriptions/medicines/route";

const get = (query: string) => GET(new NextRequest(`http://localhost/api/prescriptions/medicines${query}`));
const search = (q: string | null, extra = "") => get(q === null ? (extra ? `?${extra}` : "") : `?q=${encodeURIComponent(q)}${extra ? `&${extra}` : ""}`);
type Row = Record<string, unknown> & { medicine_name: string };
const names = async (res: Response) => ((await res.json()) as { results: Row[] }).results.map((r) => r.medicine_name);

const admin = getAdminClient();
let clinic: SeededTenant;
let otherClinic: SeededTenant;
let doctor: SeededTenant;
let otherDoctor: SeededTenant;
let nurse: SeededTenant;
let receptionist: SeededTenant;

const CDCI = [
  { id: "test-cdci-09c-route-1", brand_name: "Qzxroute Alpha 500", generic_name: "Qzxrouteol 500 mg", dose_form: "Tablet" },
  { id: "test-cdci-09c-route-2", brand_name: "Qzxroute Beta 250", generic_name: "Qzxroutein 250 mg", dose_form: "Capsule" },
  { id: "test-cdci-09c-route-3", brand_name: "Qzxroute 50% Special", generic_name: "Qzxroutam", dose_form: "Syrup" },
  { id: "test-cdci-09c-route-4", brand_name: "Qzxroute_Under", generic_name: "Qzxroutum", dose_form: "Syrup" },
  { id: "test-cdci-09c-route-5", brand_name: "Qzxroute\\Slash", generic_name: "Qzxroutex", dose_form: "Syrup" },
  ...Array.from({ length: 20 }, (_, i) => ({ id: `test-cdci-09c-route-b${String(i).padStart(2, "0")}`, brand_name: `Qzxbulk Medicine ${String(i).padStart(2, "0")}`, generic_name: "Qzxbulkol", dose_form: "Tablet" })),
];

beforeAll(async () => {
  clinic = await seedTenantWithOwner("Medicine Route A");
  otherClinic = await seedTenantWithOwner("Medicine Route B");
  doctor = await addMemberToTenant(clinic.tenantId, "doctor");
  otherDoctor = await addMemberToTenant(clinic.tenantId, "doctor");
  nurse = await addMemberToTenant(clinic.tenantId, "nurse");
  receptionist = await addMemberToTenant(clinic.tenantId, "receptionist");
  const cat = await admin.from("cdci_medicines_search").upsert(
    CDCI.map((r) => ({ ...r, product_name: r.brand_name, supplier_name: "Synthetic Labs" })),
    { onConflict: "id" }
  );
  if (cat.error) throw new Error(cat.error.message);
  const custom = await admin.from("doctor_custom_medicines").insert([
    { tenant_id: clinic.tenantId, doctor_id: doctor.userId, medicine_name: "Qzxroute My Own Mix", generic_name: "Qzxroute mix", dose_form: "Syrup", default_dosage: "1-0-1", default_timing: "After food", default_duration: "3 days", use_count: 7 },
    { tenant_id: clinic.tenantId, doctor_id: doctor.userId, medicine_name: "Qzxroute Own Sparse", dose_form: "Drops", default_dosage: "1-0-0", use_count: 2 },
    { tenant_id: clinic.tenantId, doctor_id: otherDoctor.userId, medicine_name: "Qzxroute Other Doctor Mix", default_dosage: "1-1-1", default_duration: "2 days", use_count: 40 },
    { tenant_id: otherClinic.tenantId, doctor_id: otherClinic.userId, medicine_name: "Qzxroute Clinic B Mix", default_dosage: "1-1-1", use_count: 40 },
  ]);
  if (custom.error) throw new Error(custom.error.message);
}, 120_000);

afterAll(() => {
  mockState.authDown = false;
});

describe("GET /api/prescriptions/medicines: who may search", () => {
  it("401 without a session, no-store, a fixed body", async () => {
    mockState.client = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const res = await search("qzxroute");
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("403 for a signed-in user with no clinic", async () => {
    mockState.client = await signInSeededUser((await seedAccessFixtureClinic("onboarding", "Medicine Route Onboarding", ["owner"])).users[0].email);
    const res = await search("qzxroute");
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain("Qzxroute");
  });

  it("403 SUBSCRIPTION_LOCKED for a locked clinic", async () => {
    const locked = await seedAccessFixtureClinic("locked", "Medicine Route Locked", ["owner"]);
    mockState.client = await signInSeededUser(locked.users[0].email);
    const res = await search("qzxroute");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "SUBSCRIPTION_LOCKED" });
  });

  it.each([
    ["nurse", () => nurse],
    ["receptionist", () => receptionist],
  ])("403 for a %s (no prescriptions:edit), no-store, and the body holds no medicine", async (_role, pick) => {
    mockState.client = pick().client;
    const res = await search("qzxroute");
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.stringify(await res.json())).not.toContain("Qzxroute");
  });

  it("503 when Auth cannot answer (never a 401, so a session is not signed out during an incident)", async () => {
    mockState.authDown = true;
    try {
      const res = await search("qzxroute");
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    } finally {
      mockState.authDown = false;
    }
  });
});

describe("GET /api/prescriptions/medicines: the answer", () => {
  it("200 with exactly the documented keys, no-store; the doctor's own custom medicines first with the stored dose, then the catalogue with none", async () => {
    mockState.client = doctor.client;
    const res = await search("qzxroute");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const text = await res.text();
    const body = JSON.parse(text) as { results: Row[] };
    expect(Object.keys(body)).toEqual(["results"]);
    for (const row of body.results) expect(Object.keys(row)).toEqual([...MEDICINE_SEARCH_KEYS]);
    expect(body.results.slice(0, 2).map((r) => r.medicine_name)).toEqual(["Qzxroute My Own Mix", "Qzxroute Own Sparse"]);
    expect(body.results[0]).toMatchObject({ kind: "custom", generic_name: "Qzxroute mix", dose_form: "Syrup", substance_ids: [], dosage: "1-0-1", timing: "After food", duration: "3 days" });
    // A stored null stays null: nothing is filled in.
    expect(body.results[1]).toMatchObject({ kind: "custom", dosage: "1-0-0", timing: null, duration: null });
    for (const row of body.results.filter((r) => r.kind === "cdci")) expect([row.dosage, row.timing, row.duration]).toEqual([null, null, null]);
    expect(text).not.toContain("Other Doctor Mix");
    expect(text).not.toContain("Clinic B Mix");
    for (const secret of [doctor.userId, clinic.tenantId, otherClinic.tenantId]) expect(text).not.toContain(secret);
  });

  it("the clinic and the doctor come from the session, whatever the query string adds", async () => {
    mockState.client = doctor.client;
    const res = await search("qzxroute", `tenant_id=${otherClinic.tenantId}&p_tenant_id=${otherClinic.tenantId}&doctor_id=${otherDoctor.userId}&p_doctor_id=${otherDoctor.userId}`);
    const list = await names(res);
    expect(list).toContain("Qzxroute My Own Mix");
    expect(list).not.toContain("Qzxroute Other Doctor Mix");
    expect(list).not.toContain("Qzxroute Clinic B Mix");
  });

  it("another doctor sees only their own custom medicine; another clinic's owner only theirs", async () => {
    mockState.client = otherDoctor.client;
    expect((await names(await search("qzxroute"))).slice(0, 1)).toEqual(["Qzxroute Other Doctor Mix"]);
    expect(await names(await search("qzxroute"))).not.toContain("Qzxroute My Own Mix");
    mockState.client = otherClinic.client;
    const list = await names(await search("qzxroute"));
    expect(list[0]).toBe("Qzxroute Clinic B Mix");
    expect(list).not.toContain("Qzxroute My Own Mix");
  });

  it("the catalogue rows come in rank order and the result is capped at 15", async () => {
    mockState.client = doctor.client;
    const list = await names(await search("qzxbulk"));
    expect(list).toHaveLength(MEDICINE_SEARCH_LIMIT);
    expect(list).toEqual([...list].sort());
    const limited = await names(await search("qzxbulk", "limit=3"));
    expect(limited).toHaveLength(3);
    expect(await names(await search("qzxbulk", "limit=500"))).toHaveLength(MEDICINE_SEARCH_LIMIT);
  });

  it("a generic and a word inside the brand are found; a misspelling is found by similarity", async () => {
    mockState.client = doctor.client;
    expect(await names(await search("qzxrouteol"))).toContain("Qzxroute Alpha 500");
    expect(await names(await search("alpha"))).toContain("Qzxroute Alpha 500");
    expect(await names(await search("qzxrout alpa"))).toContain("Qzxroute Alpha 500");
  });

  it("an empty or missing query is an empty list, not an error", async () => {
    mockState.client = doctor.client;
    for (const res of [await search(null), await search(""), await search("   ")]) {
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ results: [] });
    }
  });
});

describe("GET /api/prescriptions/medicines: hostile input is data", () => {
  it("%, _ and \\ in the query match themselves, not everything", async () => {
    mockState.client = doctor.client;
    expect(await names(await search("50%"))).toEqual(["Qzxroute 50% Special"]);
    expect(await names(await search("route_u"))).toEqual(["Qzxroute_Under"]);
    expect(await names(await search("route\\s"))).toEqual(["Qzxroute\\Slash"]);
    expect(await names(await search("%"))).toEqual(["Qzxroute 50% Special"]);
  });

  it.each([
    ["an open parenthesis", "(qzxroute"],
    ["an exclamation mark", "!qzxroute"],
    ["an ampersand", "qzxroute & beta"],
    ["a colon and a star", "qzxroute:*"],
    ["tsquery operators", "(qzxroute & !beta) | alpha:*"],
    ["SQL text", "'; drop table cdci_medicines_search; --"],
    ["array syntax", '"},{"x":"y"}'],
    ["a NUL character", "\u0000qzx"],
    ["a quote", "o'brien"],
    ["a 5,000-character query", "q".repeat(5_000)],
  ])("%s answers 200, never a 500", async (_name, q) => {
    mockState.client = doctor.client;
    const res = await search(q);
    expect(res.status).toBe(200);
    expect(Array.isArray(((await res.json()) as { results: unknown[] }).results)).toBe(true);
  });
});
