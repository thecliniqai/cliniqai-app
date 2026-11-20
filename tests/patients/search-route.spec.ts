/**
 * V2-08 08-02 (R-11, T-08-02): `GET /api/patients/search?q=`, the typeahead of the picker and the command palette.
 * 401 without a session, 403 without `patients:view` or a membership, 403 SUBSCRIPTION_LOCKED for a locked clinic, the exact
 * response keys (no address, allergies, ABHA or full mobile number), `Cache-Control: private, no-store`, only the caller's
 * clinic. Local stack: `createClient()` from `@/lib/supabase/server` is replaced by a seeded user's own JWT client (the
 * pattern of tests/security/dpdp-export-route.spec.ts), so membership and RLS resolve for real. Synthetic data only.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { PATIENT_HIT_KEYS } from "@/features/patients/search";
import { seedAccessFixtureClinic, seedTenantWithOwner, signInSeededUser, addMemberToTenant, type SeededTenant } from "../helpers/tenants";
import { seedPatient } from "../helpers/front-desk-commands";

const mockState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockState.client,
}));

import { GET } from "@/app/api/patients/search/route";

const search = (q: string | null) =>
  GET(new NextRequest(q === null ? "http://localhost/api/patients/search" : `http://localhost/api/patients/search?q=${encodeURIComponent(q)}`));

let a: SeededTenant;
let b: SeededTenant;
let receptionist: SeededTenant;
let nurse: SeededTenant;
let patientA: string;

beforeAll(async () => {
  a = await seedTenantWithOwner("Route Search A");
  b = await seedTenantWithOwner("Route Search B");
  receptionist = await addMemberToTenant(a.tenantId, "receptionist");
  nurse = await addMemberToTenant(a.tenantId, "nurse");
  patientA = await seedPatient(a, {
    full_name: "Synthetic Routeone Searchable",
    phone: "+919833300001",
    date_of_birth: "1990-02-03",
    sex: "female",
    abha_id: "91-1111-2222-3333",
    allergies: ["Synthetic allergen"],
    address: { line1: "12 Synthetic Lane", city: "Testville" },
  });
  await seedPatient(b, { full_name: "Synthetic Routeone Elsewhere", phone: "+919833300009" });
});

describe("GET /api/patients/search", () => {
  it("401 without a session, and the body has no ids or patient data", async () => {
    mockState.client = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const res = await search("Routeone");
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("403 for a signed-in user with no clinic", async () => {
    const outsider = await signInSeededUser((await seedAccessFixtureClinic("onboarding", "Route Search Onboarding", ["owner"])).users[0].email);
    mockState.client = outsider;
    const res = await search("Routeone");
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.stringify(await res.json())).not.toContain("Routeone");
  });

  it("403 SUBSCRIPTION_LOCKED for a locked clinic", async () => {
    const locked = await seedAccessFixtureClinic("locked", "Route Search Locked", ["owner"]);
    mockState.client = await signInSeededUser(locked.users[0].email);
    const res = await search("Routeone");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "SUBSCRIPTION_LOCKED" });
  });

  it("200 with exactly the projection keys: no address, allergies, ABHA, date of birth or full mobile number", async () => {
    mockState.client = receptionist.client;
    const res = await search("Routeone Searchable");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const text = await res.text();
    const body = JSON.parse(text) as { patients: Array<Record<string, unknown>> };
    expect(Object.keys(body)).toEqual(["patients"]);
    expect(body.patients).toHaveLength(1);
    expect(Object.keys(body.patients[0])).toEqual([...PATIENT_HIT_KEYS]);
    expect(body.patients[0]).toMatchObject({ id: patientA, name: "Synthetic Routeone Searchable", phoneLast4: "0001", lastVisit: null });
    for (const secret of ["Testville", "Synthetic Lane", "Synthetic allergen", "91-1111", "1990-02-03", "9833300001"]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("finds by mobile number and by ABHA fragment; a nurse (patients:view) may search too", async () => {
    mockState.client = nurse.client;
    for (const q of ["9833300001", "+91 98333 00001", "2222-3333"]) {
      const res = await search(q);
      expect(res.status, q).toBe(200);
      const body = (await res.json()) as { patients: Array<{ id: string }> };
      expect(body.patients.map((p) => p.id), q).toEqual([patientA]);
    }
  });

  it("only the caller's clinic: clinic B's patient is never listed to A, whatever the query string adds", async () => {
    mockState.client = receptionist.client;
    for (const q of ["Routeone Elsewhere", "9833300009"]) {
      const res = await search(q);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ patients: [] });
    }
    const forged = await GET(new NextRequest(`http://localhost/api/patients/search?q=Routeone&tenant=${b.tenantId}&tenant_id=${b.tenantId}`));
    const forgedBody = (await forged.json()) as { patients: Array<{ name: string }> };
    expect(forgedBody.patients.map((p) => p.name)).toEqual(["Synthetic Routeone Searchable"]);
  });

  it("an empty, missing, one-letter or wildcard query answers 200 with an empty list", async () => {
    mockState.client = receptionist.client;
    for (const q of [null, "", "R", "98", "%%", "__"]) {
      const res = await search(q);
      expect(res.status, String(q)).toBe(200);
      expect(await res.json(), String(q)).toEqual({ patients: [] });
    }
  });

  it("answers at most eight patients", async () => {
    const many = await seedTenantWithOwner("Route Search Many");
    for (let i = 0; i < 10; i++) await seedPatient(many, { full_name: `Synthetic Manyhits ${i}`, phone: `+91983330${String(1000 + i)}` });
    mockState.client = many.client;
    const body = (await (await search("Manyhits")).json()) as { patients: unknown[] };
    expect(body.patients).toHaveLength(8);
  });
});
