/**
 * V2-08 08-02 (R-11, P1-30, P2-08): `public.search_patients` through `searchPatients` (the service the search route and the
 * palette use), against the local stack: ranking, the minimal projection (nothing but the keys below, the last four digits
 * of the mobile number only), only the caller's clinic, no results for a clinic without full access, no wildcard oracle,
 * short queries empty. Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { searchPatients } from "@/features/patients/service";
import { PATIENT_HIT_KEYS } from "@/features/patients/search";
import { addMemberToTenant, seedAccessFixtureClinic, seedTenantWithOwner, signInSeededUser, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";
import { seedPatient } from "../helpers/front-desk-commands";
import { DEFAULT_CLINIC_TZ, todayInTz } from "@/lib/datetime";

let a: SeededTenant;
let b: SeededTenant;
let receptionist: SeededTenant;
let nurse: SeededTenant;
const ids: Record<string, string> = {};

const names = async (t: SeededTenant, q: string) => {
  const r = await searchPatients(ctxFor(t), q);
  if (!r.ok) throw new Error("search failed");
  return r.patients.map((p) => p.name);
};

beforeAll(async () => {
  a = await seedTenantWithOwner("Search Clinic A");
  b = await seedTenantWithOwner("Search Clinic B");
  receptionist = await addMemberToTenant(a.tenantId, "receptionist");
  nurse = await addMemberToTenant(a.tenantId, "nurse");
  ids.exact = await seedPatient(a, { full_name: "Zorya Quill Exact", phone: "+919812340001", date_of_birth: "1984-03-10", sex: "female" });
  ids.partial = await seedPatient(a, { full_name: "Zorya Quill Partial", phone: "+919812340002", age: 7, sex: "male" });
  ids.contains = await seedPatient(a, { full_name: "Ninad Quill Contains", phone: "+919812345678" });
  ids.abha = await seedPatient(a, { full_name: "Ninad Abha Holder", phone: "+919822200000", abha_id: "91-7777-8888-9999" });
  ids.deleted = await seedPatient(a, { full_name: "Zorya Quill Deleted", phone: "+919812340003", is_deleted: true });
  await seedPatient(b, { full_name: "Zorya Quill Exact", phone: "+919812340001", sex: "female" });
});

describe("search_patients (service)", () => {
  it("returns exactly the projection keys; the last four digits only; age from the date of birth or the stored age; nothing else", async () => {
    const r = await searchPatients(ctxFor(receptionist), "9812340001");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patients).toHaveLength(1);
    const [p] = r.patients;
    expect(Object.keys(p)).toEqual([...PATIENT_HIT_KEYS]);
    expect(p).toMatchObject({ id: ids.exact, name: "Zorya Quill Exact", phoneLast4: "0001", lastVisit: null });
    expect(p.ageSex?.sex).toBe("F");
    expect(p.ageSex?.age).toMatch(/^\d+ y$/);
    expect(JSON.stringify(r.patients)).not.toContain("9812340001");
    expect(JSON.stringify(r.patients)).not.toContain("1984");

    const byAge = await searchPatients(ctxFor(receptionist), "Zorya Quill Partial");
    expect(byAge.ok && byAge.patients).toEqual([{ id: ids.partial, name: "Zorya Quill Partial", ageSex: { age: "7 y", sex: "M" }, phoneLast4: "0002", lastVisit: null }]);
  });

  it("ranks an exact mobile number first, then digits contained in a mobile number, then a name prefix, then a substring", async () => {
    // "9812340001" is exact for one patient; "98123" is contained in four mobile numbers (rank 2) and names have no digits.
    const exact = await names(receptionist, "9812340001");
    expect(exact).toEqual(["Zorya Quill Exact"]);
    const contained = await names(receptionist, "98123");
    expect(contained.sort()).toEqual(["Ninad Quill Contains", "Zorya Quill Exact", "Zorya Quill Partial"]);

    const prefixFirst = await names(receptionist, "quill");
    // "Zorya Quill ..." matches a word prefix (rank 3) in all three names; the order inside a rank is last visit, then name.
    expect(prefixFirst).toEqual(["Ninad Quill Contains", "Zorya Quill Exact", "Zorya Quill Partial"]);

    const substring = await names(receptionist, "orya");
    expect(substring).toEqual(["Zorya Quill Exact", "Zorya Quill Partial"]);
    const prefix = await names(receptionist, "zorya");
    expect(prefix).toEqual(["Zorya Quill Exact", "Zorya Quill Partial"]);
  });

  it("digits inside a name query are not a mobile fragment: the exact name is the only answer, and a number-only query still finds the mobile (000104)", async () => {
    // The synthetic names of the e2e lane end in a hex tag ("... dcc7a1" holds the digits 7 and 1; "q5a7c1" holds 5, 7, 1). Before
    // 000104 those digits were also searched as the mobile fragment "571": a patient whose number contains it matched with rank 2 and
    // outranked the exact name, and "Register as new patient" (offered only when nothing matches) never appeared.
    const tagged = await seedPatient(a, { full_name: "Zeno Quill q5a7c1", phone: "+919000000001" });
    await seedPatient(a, { full_name: "Plain Bystander", phone: "+919871234571" });
    const r = await searchPatients(ctxFor(receptionist), "Zeno Quill q5a7c1");
    expect(r.ok && r.patients.map((p) => p.id)).toEqual([tagged]);
    expect(await names(receptionist, "A Zeno Quill q5a7c1 new")).toEqual([]);
    // A query of digits and separators is still a mobile fragment.
    expect(await names(receptionist, "98712 3457")).toEqual(["Plain Bystander"]);
  });

  it("the last visit is the clinic-local date of a waiting, in-consultation or completed visit, and orders equal ranks", async () => {
    const { visitId, patientId } = await visitFor(a, ids.partial);
    expect(visitId).toBeTruthy();
    const r = await searchPatients(ctxFor(receptionist), "zorya");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patients.map((p) => p.name)).toEqual(["Zorya Quill Partial", "Zorya Quill Exact"]);
    expect(r.patients[0].id).toBe(patientId);
    expect(r.patients[0].lastVisit).toBe(todayInTz(DEFAULT_CLINIC_TZ));
    expect(r.patients[1].lastVisit).toBeNull();
  });

  it("finds an ABHA fragment, ignores deleted patients, and never lists another clinic's patients", async () => {
    expect(await names(receptionist, "7777-8888")).toEqual(["Ninad Abha Holder"]);
    expect(await names(receptionist, "Deleted")).toEqual([]);
    const fromB = await names(b, "Zorya");
    expect(fromB).toEqual(["Zorya Quill Exact"]);
    const inA = await searchPatients(ctxFor(receptionist), "Zorya Quill Exact");
    expect(inA.ok && inA.patients.map((p) => p.id)).toEqual([ids.exact]);
  });

  it("receptionist and nurse (patients:view) may search; the answer is the same list", async () => {
    expect(await names(nurse, "Ninad")).toEqual(await names(receptionist, "Ninad"));
    expect((await names(nurse, "Ninad")).length).toBe(2);
  });

  it("one letter, two digits, wildcards, blanks and a wildcard inside a name find nothing (no wildcard oracle)", async () => {
    for (const q of ["Z", "98", "%%", "__", "**", "%_", "_%_", "\\%", "% %", "*_", "   ", "", "Zo%ya", "Z_rya"]) {
      expect(await names(receptionist, q), JSON.stringify(q)).toEqual([]);
    }
    expect(await names(receptionist, "Zorya")).toHaveLength(2);
  });

  it("a locked clinic has no results at all", async () => {
    const locked = await seedAccessFixtureClinic("locked", "Search Locked Clinic", ["owner"]);
    await seedPatient({ tenantId: locked.tenantId, userId: locked.users[0].userId }, { full_name: "Zorya Quill Locked", phone: "+919812340077" });
    const client = await signInSeededUser(locked.users[0].email);
    const r = await searchPatients(
      { userId: locked.users[0].userId, tenantId: locked.tenantId, role: "owner", actorType: "user", db: client as never },
      "Zorya"
    );
    expect(r).toEqual({ ok: true, patients: [] });
  });
});

async function visitFor(t: SeededTenant, patientId: string): Promise<{ visitId: string; patientId: string }> {
  const { data, error } = await getAdminClient()
    .from("visits")
    .insert({ tenant_id: t.tenantId, patient_id: patientId, doctor_id: t.userId, origin_type: "walk_in", status: "waiting", estimated_duration_minutes: 15, created_by: t.userId })
    .select("id")
    .single();
  if (error || !data) throw new Error(`visit insert: ${error?.message}`);
  return { visitId: (data as { id: string }).id, patientId };
}
