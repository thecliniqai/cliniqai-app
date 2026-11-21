/**
 * V2-08 08-02 (R-11, AI-14 basic rule): `public.find_patient_duplicates` through `findPotentialDuplicates` (the service
 * behind the register sheet's lookup), against the local stack: the existing rules (same mobile; same name with the same date
 * of birth or an age within two years) in the minimal projection with the reasons, a shared family mobile listing everyone on
 * it with age and sex, and only the caller's clinic. Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { findPotentialDuplicates } from "@/features/patients/dedup-service";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { seedPatient } from "../helpers/front-desk-commands";

let a: SeededTenant;
let b: SeededTenant;
let receptionist: SeededTenant;
const ids: Record<string, string> = {};

beforeAll(async () => {
  a = await seedTenantWithOwner("Dedup Clinic A");
  b = await seedTenantWithOwner("Dedup Clinic B");
  receptionist = await addMemberToTenant(a.tenantId, "receptionist");
  ids.sunil = await seedPatient(a, { full_name: "Sunil Narine", phone: "+919811122233", date_of_birth: "1985-06-15", age: 41, sex: "male" });
  ids.motherA = await seedPatient(a, { full_name: "Kavita Rao Family", phone: "+919811100001", age: 62, sex: "female" });
  ids.sonA = await seedPatient(a, { full_name: "Arjun Rao Family", phone: "+919811100001", age: 9, sex: "male" });
  ids.deleted = await seedPatient(a, { full_name: "Gone Patient", phone: "+919811100002", is_deleted: true });
  await seedPatient(b, { full_name: "Sunil Narine", phone: "+919811122233", date_of_birth: "1985-06-15", age: 41 });
});

describe("find_patient_duplicates (service)", () => {
  it("the same mobile matches however it is typed, with the minimal projection and the reason", async () => {
    for (const phone of ["9811122233", "+91 98111 22233", "919811122233", " 98111-22233 "]) {
      const matches = await findPotentialDuplicates(ctxFor(receptionist), { phone, fullName: "Different Name" });
      expect(matches, phone).toHaveLength(1);
      expect(matches[0]).toMatchObject({ id: ids.sunil, name: "Sunil Narine", phoneLast4: "2233", reasons: ["same_mobile"], lastVisit: null });
      expect(matches[0].ageSex?.sex).toBe("M");
      expect(Object.keys(matches[0]).sort()).toEqual(["ageSex", "id", "lastVisit", "name", "phoneLast4", "reasons", "strength"]);
      expect(JSON.stringify(matches)).not.toContain("9811122233");
      expect(JSON.stringify(matches)).not.toContain("1985");
    }
  });

  it("a shared family mobile lists everyone on it, with age and sex, so they can be told apart", async () => {
    const matches = await findPotentialDuplicates(ctxFor(receptionist), { phone: "9811100001" });
    expect(matches.map((m) => [m.name, m.ageSex?.age, m.ageSex?.sex, m.reasons])).toEqual(
      expect.arrayContaining([
        ["Kavita Rao Family", "62 y", "F", ["same_mobile"]],
        ["Arjun Rao Family", "9 y", "M", ["same_mobile"]],
      ])
    );
    expect(matches).toHaveLength(2);
  });

  it("the same name (any case) with an age within two years is a candidate; with an age further away it is not", async () => {
    const near = await findPotentialDuplicates(ctxFor(receptionist), { phone: "9999900000", fullName: "  sunil NARINE ", age: 42 });
    expect(near.map((m) => [m.id, m.reasons])).toEqual([[ids.sunil, ["same_name_age"]]]);
    const edge = await findPotentialDuplicates(ctxFor(receptionist), { fullName: "Sunil Narine", age: 43 });
    expect(edge.map((m) => m.id)).toEqual([ids.sunil]);
    const far = await findPotentialDuplicates(ctxFor(receptionist), { phone: "9999900000", fullName: "Sunil Narine", age: 20 });
    expect(far).toEqual([]);
  });

  it("the same name with the same date of birth is a candidate whatever the age; a different date is not", async () => {
    const dob = await findPotentialDuplicates(ctxFor(receptionist), { fullName: "Sunil Narine", dob: "1985-06-15", age: 20 });
    expect(dob.map((m) => [m.id, m.reasons])).toEqual([[ids.sunil, ["same_name_dob"]]]);
    const both = await findPotentialDuplicates(ctxFor(receptionist), { fullName: "Sunil Narine", dob: "1985-06-15", age: 41 });
    expect(both[0].reasons).toEqual(["same_name_dob", "same_name_age"]);
    expect(await findPotentialDuplicates(ctxFor(receptionist), { fullName: "Sunil Narine", dob: "1990-01-01" })).toEqual([]);
  });

  it("the same mobile and the same name give one row with both reasons, mobile matches first", async () => {
    const matches = await findPotentialDuplicates(ctxFor(receptionist), { phone: "9811122233", fullName: "Sunil Narine", age: 41 });
    expect(matches).toHaveLength(1);
    expect(matches[0].reasons).toEqual(["same_mobile", "same_name_age"]);
  });

  it("nothing for a name alone, a short name, a number that is not an Indian mobile, deleted patients or another clinic", async () => {
    expect(await findPotentialDuplicates(ctxFor(receptionist), { fullName: "Sunil Narine" })).toEqual([]);
    expect(await findPotentialDuplicates(ctxFor(receptionist), { fullName: "Su", age: 41 })).toEqual([]);
    expect(await findPotentialDuplicates(ctxFor(receptionist), { phone: "5811122233" })).toEqual([]);
    expect(await findPotentialDuplicates(ctxFor(receptionist), { phone: "9811100002" })).toEqual([]);
    const fromB = await findPotentialDuplicates(ctxFor(b), { phone: "9811122233" });
    expect(fromB).toHaveLength(1);
    expect(fromB[0].id).not.toBe(ids.sunil);
    expect(await findPotentialDuplicates(ctxFor(receptionist), {})).toEqual([]);
  });

  it("unusable inputs are dropped, never an error (a bad date, a negative age, a long name)", async () => {
    const matches = await findPotentialDuplicates(ctxFor(receptionist), {
      phone: "9811122233",
      dob: "not-a-date",
      age: -4,
      fullName: "x".repeat(500),
    });
    expect(matches.map((m) => m.id)).toEqual([ids.sunil]);
  });
});
