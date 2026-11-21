/**
 * V2-08 08-05 (AI-14, R-18): the Smart Assist duplicate rules of `public.find_patient_duplicates` (000105) through
 * `findPotentialDuplicates`, against the local stack. One existing patient and one patient being registered per case, in a clinic of
 * its own so cases cannot match each other: the short forms (Mohd, Md, Kr, Smt, Dr), transliteration (Meena/Mina, Aarti/Arti),
 * word order, case and punctuation, family numbers and children sharing a guardian's mobile, the strong/possible split, and the
 * date-of-birth and age evidence. Without the `assist.duplicates` entitlement the 08-02 rules apply and every row is "possible".
 * Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { findPotentialDuplicates } from "@/features/patients/dedup-service";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedTenantWithOwner } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { seedPatient } from "../helpers/front-desk-commands";

interface Existing {
  name: string;
  age?: number;
  dob?: string;
}
interface Incoming {
  name?: string;
  /** Same mobile as the existing patient (true) or another (false/absent). */
  sameMobile?: boolean;
  /** The mobile as typed (default: the existing patient's, plain). */
  typedMobile?: string;
  age?: number;
  dob?: string;
}
type Outcome = "strong" | "possible" | "none";

const MOBILE = "9811100777";
const OTHER_MOBILE = "9899900888";

// [label, existing, incoming, expected]
const CASES: Array<[string, Existing, Incoming, Outcome]> = [
  ["same mobile and the same name", { name: "Sunil Narine" }, { name: "Sunil Narine", sameMobile: true }, "strong"],
  ["Mohd is Mohammed", { name: "Mohammed Rafi" }, { name: "Mohd Rafi", sameMobile: true }, "strong"],
  ["Md. and word order: Rafi Khan Mohammad", { name: "Rafi Khan Mohammad" }, { name: "Md. Rafi Khan", sameMobile: true }, "strong"],
  ["Kr is Kumar", { name: "Rakesh Kumar Sharma" }, { name: "Rakesh Kr Sharma", sameMobile: true }, "strong"],
  ["Smt is Shrimati", { name: "Shrimati Meena Devi" }, { name: "Smt Meena Devi", sameMobile: true }, "strong"],
  ["Dr is dropped", { name: "Anil Gupta" }, { name: "Dr. Anil Gupta", sameMobile: true }, "strong"],
  ["swapped order", { name: "Rakesh Sharma" }, { name: "Sharma Rakesh", sameMobile: true }, "strong"],
  ["transliteration Meena and Mina", { name: "Meena Devi" }, { name: "Mina Devi", sameMobile: true }, "strong"],
  ["transliteration Aarti and Arti", { name: "Aarti Verma" }, { name: "Arti Verma", sameMobile: true }, "strong"],
  ["a longer form of the first name (Priya, Priyanka)", { name: "Priyanka Singh" }, { name: "Priya Singh", sameMobile: true }, "strong"],
  ["case, spacing and punctuation", { name: "sunil narine" }, { name: "  SUNIL   NARINE. ", sameMobile: true }, "strong"],
  ["the mobile as typed with +91 and spaces", { name: "Sunil Narine" }, { name: "Sunil Narine", sameMobile: true, typedMobile: "+91 98111 00777" }, "strong"],
  ["a family number: another person on the same mobile", { name: "Kavita Rao", age: 62 }, { name: "Arjun Rao", sameMobile: true, age: 31 }, "possible"],
  ["a child registered on a guardian's mobile", { name: "Sunita Sharma", age: 38 }, { name: "Aryan Sharma", sameMobile: true, age: 7 }, "possible"],
  ["the mobile alone, no name typed yet", { name: "Sunil Narine" }, { sameMobile: true }, "possible"],
  ["a similar name with the same date of birth, another mobile", { name: "Sunil Narine", dob: "1985-06-15" }, { name: "Narine Sunil", dob: "1985-06-15" }, "strong"],
  ["a short form with the same date of birth", { name: "Mohammed Rafi", dob: "1990-02-03" }, { name: "Mohd Rafi", dob: "1990-02-03" }, "strong"],
  ["a similar name and an age within two years, another mobile", { name: "Rakesh Sharma", age: 40 }, { name: "Rakesh Kr Sharma", age: 42 }, "possible"],
  ["a similar name and an age three years apart", { name: "Rakesh Sharma", age: 40 }, { name: "Rakesh Sharma", age: 43 }, "none"],
  ["a similar name alone, another mobile", { name: "Sunil Narine", age: 41 }, { name: "Sunil Narine" }, "none"],
  ["a different name with the same date of birth", { name: "Sunil Narine", dob: "1985-06-15" }, { name: "Ramesh Iyer", dob: "1985-06-15" }, "none"],
  ["different first names, the same surname and age", { name: "Rahul Sharma", age: 30 }, { name: "Rohit Sharma", age: 30 }, "none"],
  ["different surnames, the same first name and age", { name: "Anil Gupta", age: 30 }, { name: "Anil Kumar", age: 30 }, "none"],
  ["nothing in common", { name: "Sunil Narine", age: 41 }, { name: "Zainab Qureshi", age: 41 }, "none"],
];

async function setup(existing: Existing) {
  const tenant = await seedTenantWithOwner("Duplicate Rules Clinic");
  const id = await seedPatient(tenant, {
    full_name: existing.name,
    phone: `+91${MOBILE}`,
    age: existing.age ?? null,
    date_of_birth: existing.dob ?? null,
  });
  return { tenant, id };
}

describe("find_patient_duplicates with Smart Assist (AI-14)", () => {
  it.each(CASES)("%s", async (_label, existing, incoming, expected) => {
    const { tenant, id } = await setup(existing);
    const matches = await findPotentialDuplicates(ctxFor(tenant), {
      phone: incoming.sameMobile ? (incoming.typedMobile ?? MOBILE) : OTHER_MOBILE,
      fullName: incoming.name ?? null,
      age: incoming.age ?? null,
      dob: incoming.dob ?? null,
    });
    if (expected === "none") {
      expect(matches).toEqual([]);
      return;
    }
    expect(matches.map((m) => [m.id, m.strength])).toEqual([[id, expected]]);
  });

  it("strong candidates come before possible ones, and the same mobile before a name-only match", async () => {
    const tenant = await seedTenantWithOwner("Duplicate Rules Order");
    const family = await seedPatient(tenant, { full_name: "Kavita Rao", phone: `+91${MOBILE}`, age: 62 });
    const same = await seedPatient(tenant, { full_name: "Sunil Narine", phone: `+91${MOBILE}`, age: 41 });
    const nameOnly = await seedPatient(tenant, { full_name: "Narine Sunil", phone: "+919811100111", date_of_birth: "1985-06-15" });
    const matches = await findPotentialDuplicates(ctxFor(tenant), { phone: MOBILE, fullName: "Sunil Narine", dob: "1985-06-15", age: 41 });
    expect(matches.map((m) => [m.id, m.strength])).toEqual([
      [same, "strong"],
      [nameOnly, "strong"],
      [family, "possible"],
    ]);
  });

  it("a candidate carries the reasons that make it one, and only the minimal projection", async () => {
    const tenant = await seedTenantWithOwner("Duplicate Rules Reasons");
    await seedPatient(tenant, { full_name: "Mohammed Rafi", phone: `+91${MOBILE}`, date_of_birth: "1990-02-03", age: 35 });
    const [match] = await findPotentialDuplicates(ctxFor(tenant), { phone: MOBILE, fullName: "Md Rafi", dob: "1990-02-03", age: 36 });
    expect(match?.reasons).toEqual(["same_mobile", "same_name_dob", "same_name_age"]);
    expect(Object.keys(match!).sort()).toEqual(["ageSex", "id", "lastVisit", "name", "phoneLast4", "reasons", "strength"]);
  });

  it("deleted patients and other clinics never match", async () => {
    const tenant = await seedTenantWithOwner("Duplicate Rules Scope A");
    const other = await seedTenantWithOwner("Duplicate Rules Scope B");
    await seedPatient(tenant, { full_name: "Sunil Narine", phone: `+91${MOBILE}`, is_deleted: true });
    await seedPatient(other, { full_name: "Sunil Narine", phone: `+91${MOBILE}` });
    expect(await findPotentialDuplicates(ctxFor(tenant), { phone: MOBILE, fullName: "Sunil Narine" })).toEqual([]);
  });
});

describe("find_patient_duplicates without the assist.duplicates entitlement", () => {
  async function notEntitled() {
    const tenant = await seedTenantWithOwner("Duplicate Rules Basic");
    const { error } = await getAdminClient().from("tenant_entitlement_overrides").insert({
      tenant_id: tenant.tenantId,
      key: "assist.duplicates",
      enabled: false,
      reason: "Synthetic test: Smart Assist duplicates off",
    });
    expect(error).toBeNull();
    return tenant;
  }

  it("applies the 08-02 rules: same mobile, or the same name (exactly) with the date of birth or an age within two years; every row is possible", async () => {
    const tenant = await notEntitled();
    const mobile = await seedPatient(tenant, { full_name: "Mohammed Rafi", phone: `+91${MOBILE}`, age: 50 });
    const named = await seedPatient(tenant, { full_name: "Sunil Narine", phone: "+919811100222", age: 41 });
    // The short form on the same mobile: the mobile rule, possible (no name similarity without Smart Assist).
    const byMobile = await findPotentialDuplicates(ctxFor(tenant), { phone: MOBILE, fullName: "Mohd Rafi" });
    expect(byMobile.map((m) => [m.id, m.strength, m.reasons])).toEqual([[mobile, "possible", ["same_mobile"]]]);
    // The exact name with an age within two years: the basic name rule, possible.
    const byName = await findPotentialDuplicates(ctxFor(tenant), { phone: OTHER_MOBILE, fullName: "sunil narine", age: 42 });
    expect(byName.map((m) => [m.id, m.strength, m.reasons])).toEqual([[named, "possible", ["same_name_age"]]]);
    // A similar (not equal) name finds nothing without Smart Assist.
    expect(await findPotentialDuplicates(ctxFor(tenant), { phone: OTHER_MOBILE, fullName: "Narine Sunil", age: 42 })).toEqual([]);
  });
});
