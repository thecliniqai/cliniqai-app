/**
 * V2-09b 09B-04a (R-11, T-09B-06): `GET /api/terminology/diagnoses?q=&specialty=`, the consult's diagnosis typeahead. 401 without a session, 403 without
 * `consultations:view` or a membership, 403 SUBSCRIPTION_LOCKED for a locked clinic, the exact response keys, `Cache-Control: private, no-store`, only the
 * caller's own custom diagnoses, hostile input as data (quotes, SQL text, array syntax, wildcards, oversized), and the abbreviation expansion only for a
 * clinic entitled to `assist.terminology`. Local stack: `createClient()` from `@/lib/supabase/server` is replaced by a seeded user's own JWT client (the
 * pattern of tests/patients/search-route.spec.ts), so membership, entitlements and RLS resolve for real. Synthetic data only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { DIAGNOSIS_HIT_KEYS, DIAGNOSIS_SEARCH_LIMIT } from "@/features/terminology/search";
import { addMemberToTenant, seedAccessFixtureClinic, seedTenantWithOwner, signInSeededUser, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";

const mockState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockState.client,
}));

import { GET } from "@/app/api/terminology/diagnoses/route";

const get = (query: string) => GET(new NextRequest(`http://localhost/api/terminology/diagnoses${query}`));
const search = (q: string | null, extra = "") => get(q === null ? (extra ? `?${extra}` : "") : `?q=${encodeURIComponent(q)}${extra ? `&${extra}` : ""}`);

const admin = getAdminClient();
const catalogueIds: string[] = [];
let clinic: SeededTenant;
let otherClinic: SeededTenant;
let doctor: SeededTenant;
let otherDoctor: SeededTenant;
let receptionist: SeededTenant;

beforeAll(async () => {
  clinic = await seedTenantWithOwner("Diagnosis Route A");
  otherClinic = await seedTenantWithOwner("Diagnosis Route B");
  doctor = await addMemberToTenant(clinic.tenantId, "doctor");
  otherDoctor = await addMemberToTenant(clinic.tenantId, "doctor");
  receptionist = await addMemberToTenant(clinic.tenantId, "receptionist");
  const rows = [
    { name: "Synthetic route hypertension", icd11_code: "BA00", snomed_concept_id: "38341003", synonyms: ["HTN"], specialties: ["general_physician"], is_chronic: true },
    { name: "Synthetic route diabetes mellitus type 2", icd11_code: "5A11", synonyms: [], specialties: ["general_physician"], is_chronic: true },
    ...Array.from({ length: 20 }, (_, i) => ({ name: `Synthetic route bulk ${String(i).padStart(2, "0")}`, icd11_code: null, synonyms: [], specialties: ["general_physician"], is_chronic: false })),
  ];
  const { data, error } = await admin.from("opd_diagnoses").insert(rows).select("id");
  if (error) throw new Error(error.message);
  catalogueIds.push(...(data ?? []).map((d) => d.id));
  const custom = await admin.from("doctor_custom_diagnoses").insert([
    { tenant_id: clinic.tenantId, doctor_id: doctor.userId, diagnosis_name: "Synthetic route my own hypertension", specialty: "general_physician", use_count: 7 },
    { tenant_id: clinic.tenantId, doctor_id: otherDoctor.userId, diagnosis_name: "Synthetic route other doctor hypertension", specialty: "general_physician", use_count: 40 },
    { tenant_id: otherClinic.tenantId, doctor_id: otherClinic.userId, diagnosis_name: "Synthetic route clinic B hypertension", specialty: "general_physician", use_count: 40 },
  ]);
  if (custom.error) throw new Error(custom.error.message);
}, 120_000);

afterAll(async () => {
  if (catalogueIds.length > 0) await admin.from("opd_diagnoses").delete().in("id", catalogueIds);
});

describe("GET /api/terminology/diagnoses", () => {
  it("401 without a session, no-store, a fixed body", async () => {
    mockState.client = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const res = await search("route hypertension");
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("403 for a signed-in user with no clinic", async () => {
    mockState.client = await signInSeededUser((await seedAccessFixtureClinic("onboarding", "Diagnosis Route Onboarding", ["owner"])).users[0].email);
    const res = await search("route hypertension");
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.stringify(await res.json())).not.toContain("hypertension");
  });

  it("403 SUBSCRIPTION_LOCKED for a locked clinic", async () => {
    const locked = await seedAccessFixtureClinic("locked", "Diagnosis Route Locked", ["owner"]);
    mockState.client = await signInSeededUser(locked.users[0].email);
    const res = await search("route hypertension");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "SUBSCRIPTION_LOCKED" });
  });

  it("403 for a receptionist (no consultations:view), and the body holds no diagnosis", async () => {
    mockState.client = receptionist.client;
    const res = await search("route hypertension");
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.stringify(await res.json())).not.toContain("hypertension");
  });

  it("200 for the doctor with exactly the documented keys, no-store, the doctor's own custom row first", async () => {
    mockState.client = doctor.client;
    const res = await search("route hypertension");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const text = await res.text();
    const body = JSON.parse(text) as { results: Array<Record<string, unknown>> };
    expect(Object.keys(body)).toEqual(["results"]);
    for (const hit of body.results) expect(Object.keys(hit)).toEqual([...DIAGNOSIS_HIT_KEYS]);
    expect(body.results.map((r) => r.name)).toEqual(["Synthetic route my own hypertension", "Synthetic route hypertension"]);
    expect(body.results[0]).toMatchObject({ custom: true, icd11: null });
    expect(body.results[1]).toMatchObject({ custom: false, icd11: "BA00", snomed: "38341003", chronic: true });
    // No identifier of a clinic, a doctor or a user, no other doctor's or clinic's custom row.
    expect(text).not.toContain("other doctor");
    expect(text).not.toContain("clinic B");
    for (const secret of [doctor.userId, clinic.tenantId, otherClinic.tenantId]) expect(text).not.toContain(secret);
  });

  it("the clinic and the doctor come from the session, whatever the query string adds", async () => {
    mockState.client = doctor.client;
    const res = await search("route hypertension", `tenant_id=${otherClinic.tenantId}&tenant=${otherClinic.tenantId}&doctor_id=${otherDoctor.userId}`);
    const body = (await res.json()) as { results: Array<{ name: string }> };
    expect(body.results.map((r) => r.name)).toEqual(["Synthetic route my own hypertension", "Synthetic route hypertension"]);
  });

  it("another clinic's owner sees only their own custom row", async () => {
    mockState.client = otherClinic.client;
    const body = (await (await search("route hypertension")).json()) as { results: Array<{ name: string }> };
    expect(body.results.map((r) => r.name)).toEqual(["Synthetic route clinic B hypertension", "Synthetic route hypertension"]);
  });

  it("the abbreviation expansion applies for a clinic entitled to assist.terminology, and not when it is overridden off", async () => {
    mockState.client = doctor.client;
    const on = (await (await search("htn")).json()) as { results: Array<{ name: string }> };
    expect(on.results.map((r) => r.name)).toContain("Synthetic route hypertension");
    // t2dm is not a synonym of anything here: only its expansion ("type 2 diabetes mellitus") can find a row.
    const expanded = (await (await search("t2dm")).json()) as { results: Array<{ name: string }> };
    expect(expanded.results.map((r) => r.name)).toEqual(["Synthetic route diabetes mellitus type 2"]);

    const off = await admin.from("tenant_entitlement_overrides").insert({
      tenant_id: clinic.tenantId,
      key: "assist.terminology",
      enabled: false,
      reason: "Synthetic test: Smart Assist terminology off",
    });
    expect(off.error).toBeNull();
    try {
      const plain = (await (await search("t2dm")).json()) as { results: Array<{ name: string }> };
      expect(plain.results).toEqual([]);
      // Typed words are still searched as typed (a synonym still matches).
      const typed = (await (await search("htn")).json()) as { results: Array<{ name: string }> };
      expect(typed.results.map((r) => r.name)).toContain("Synthetic route hypertension");
    } finally {
      await admin.from("tenant_entitlement_overrides").delete().eq("tenant_id", clinic.tenantId).eq("key", "assist.terminology");
    }
  });

  it("the specialty parameter filters; an unknown value is ignored", async () => {
    mockState.client = doctor.client;
    const gp = (await (await search("route hypertension", "specialty=general_physician")).json()) as { results: unknown[] };
    expect(gp.results).toHaveLength(2);
    const dental = (await (await search("route diabetes", "specialty=dental")).json()) as { results: unknown[] };
    expect(dental.results).toEqual([]);
    const unknown = (await (await search("route diabetes", "specialty=%27%3B%20drop%20table")).json()) as { results: unknown[] };
    expect(unknown.results).toHaveLength(1);
  });

  it("hostile input is data: quotes, SQL text, array syntax and wildcards answer 200 with an empty list, never an error", async () => {
    mockState.client = doctor.client;
    for (const q of ["'; drop table opd_diagnoses; --", '"},{"x":"y"}', "{a,b}", "\\", "%%", "__", "a".repeat(5000)]) {
      const res = await search(q);
      expect(res.status, q.slice(0, 20)).toBe(200);
      const body = (await res.json()) as { results: unknown[] };
      expect(body.results, q.slice(0, 20)).toEqual([]);
    }
    // A control character (a NUL cannot be stored in a text) is a space, not a 500: "ab" is found inside "diabetes".
    for (const q of ["\u0000ab", "ab\ncd", "\u0007\u0007"]) {
      expect((await search(q)).status, JSON.stringify(q)).toBe(200);
    }
    // The table is still there.
    const { count } = await admin.from("opd_diagnoses").select("id", { count: "exact", head: true });
    expect(count).toBeGreaterThanOrEqual(22);
  });

  it("an empty, missing or one-letter query answers 200 with an empty list", async () => {
    mockState.client = doctor.client;
    for (const q of [null, "", "r", " "]) {
      const res = await search(q);
      expect(res.status, String(q)).toBe(200);
      expect(await res.json()).toEqual({ results: [] });
    }
  });

  it(`answers at most ${DIAGNOSIS_SEARCH_LIMIT} rows`, async () => {
    mockState.client = doctor.client;
    const body = (await (await search("synthetic route bulk")).json()) as { results: unknown[] };
    expect(body.results).toHaveLength(DIAGNOSIS_SEARCH_LIMIT);
  });
});
