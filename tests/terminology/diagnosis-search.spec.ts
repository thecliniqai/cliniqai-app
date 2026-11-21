/**
 * V2-09b 09B-04a (R-11, AI-07): the diagnosis search. Two layers:
 *   - `expandQuery` and the abbreviation table (pure): HTN, T2DM, URTI, AGE and the rest expand to their text, never to an id; history markers are not
 *     diagnoses; punctuation and case do not matter; at most three terms.
 *   - `searchDiagnoses` over `public.search_diagnoses` against the real database with the caller's own client (RLS applies): synthetic catalogue rows are
 *     seeded as the service role and removed afterwards. A ranking table of the cases the plan names (abbreviations, synonyms, a one-letter typo through
 *     trigram, prefix before infix, the doctor's custom first, the specialty filter, not entitled gives the typed words only). The function itself is
 *     covered by pgTAP `diagnosis_search_snapshot.test.sql`.
 * Synthetic data only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ABBREVIATIONS, expandQuery, lookupAbbreviation, MAX_SEARCH_TERMS } from "@/features/terminology/abbreviations";
import { searchDiagnoses } from "@/features/terminology/service";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";

describe("expandQuery and the abbreviation table", () => {
  it.each([
    ["htn", ["htn", "hypertension"]],
    ["HTN", ["HTN", "hypertension"]],
    ["t2dm", ["t2dm", "type 2 diabetes mellitus"]],
    ["URTI", ["URTI", "upper respiratory tract infection"]],
    ["age", ["age", "acute gastroenteritis"]],
    ["aom", ["aom", "acute otitis media"]],
    ["uti", ["uti", "urinary tract infection"]],
    ["  t2dm   control ", ["t2dm control", "type 2 diabetes mellitus control"]],
    ["htn, t2dm", ["htn, t2dm", "hypertension type 2 diabetes mellitus"]],
    ["copd exacerbation", ["copd exacerbation", "chronic obstructive pulmonary disease exacerbation"]],
    ["hypertension", ["hypertension"]],
    ["fever", ["fever"]],
    ["", []],
    ["   ", []],
  ])("%j gives %j", (query, expected) => {
    expect(expandQuery(query)).toEqual(expected);
  });

  it("a history marker (c/o, k/c/o, o/e, f/u, adv) is not a diagnosis: it is searched as typed", () => {
    for (const marker of ["c/o", "k/c/o", "o/e", "h/o", "f/u", "adv"]) expect(expandQuery(marker)).toEqual([marker]);
    expect(lookupAbbreviation("k/c/o")?.expansion).toBe("known case of");
  });

  it("an abbreviation maps to text, never to an identifier or a code", () => {
    for (const a of ABBREVIATIONS) {
      expect(a.expansion).toMatch(/^[a-z0-9][a-z0-9\- ]+$/);
      expect(a.abbr).toMatch(/^[a-z0-9/]+$/);
    }
    expect(new Set(ABBREVIATIONS.map((a) => a.abbr)).size).toBe(ABBREVIATIONS.length);
    expect(ABBREVIATIONS.length).toBeGreaterThanOrEqual(40);
  });

  it("lookup ignores case and surrounding punctuation, and never matches part of a word", () => {
    expect(lookupAbbreviation("(HTN)")?.abbr).toBe("htn");
    expect(lookupAbbreviation("htn,")?.abbr).toBe("htn");
    expect(lookupAbbreviation("htns")).toBeNull();
    expect(lookupAbbreviation("")).toBeNull();
  });

  it("returns at most three terms and cuts the query at 100 characters", () => {
    expect(expandQuery("htn ".repeat(60)).every((t) => t.length <= 100)).toBe(true);
    expect(expandQuery("htn").length).toBeLessThanOrEqual(MAX_SEARCH_TERMS);
  });
});

const admin = getAdminClient();
const catalogueIds: string[] = [];
let clinic: SeededTenant;
let doctor: SeededTenant;
let otherDoctor: SeededTenant;
let nurse: SeededTenant;
let receptionist: SeededTenant;

async function seedCatalogue(rows: Array<{ name: string; icd11?: string; synonyms?: string[]; specialties?: string[]; chronic?: boolean }>) {
  const { data, error } = await admin
    .from("opd_diagnoses")
    .insert(rows.map((r) => ({ name: r.name, icd11_code: r.icd11 ?? null, synonyms: r.synonyms ?? [], specialties: r.specialties ?? ["general_physician"], is_chronic: r.chronic ?? false })))
    .select("id");
  if (error) throw new Error(error.message);
  catalogueIds.push(...(data ?? []).map((d) => d.id));
}

beforeAll(async () => {
  clinic = await seedTenantWithOwner("CI Diagnosis Search Clinic");
  doctor = await addMemberToTenant(clinic.tenantId, "doctor");
  otherDoctor = await addMemberToTenant(clinic.tenantId, "doctor");
  nurse = await addMemberToTenant(clinic.tenantId, "nurse");
  receptionist = await addMemberToTenant(clinic.tenantId, "receptionist");
  await seedCatalogue([
    { name: "Hypertension", icd11: "BA00", synonyms: ["HTN", "high blood pressure"], chronic: true },
    { name: "Hypertension, secondary", icd11: "BA04", chronic: true },
    { name: "Elevated BP", synonyms: ["hypertension screening"] },
    { name: "Pulmonary hypertension", icd11: "BB01" },
    { name: "Prehypertension" },
    { name: "Type 2 diabetes mellitus", icd11: "5A11", chronic: true },
    { name: "Acute upper respiratory tract infection", icd11: "CA07" },
    { name: "Acute gastroenteritis", icd11: "1A40" },
    { name: "Acute otitis media", icd11: "AA00", specialties: ["pediatrics", "general_physician"] },
    { name: "Dental caries", icd11: "DA08.0", synonyms: ["cavity"], specialties: ["dental"] },
    { name: "Urinary tract infection", icd11: "GC08" },
  ]);
  const custom = await admin.from("doctor_custom_diagnoses").insert([
    { tenant_id: clinic.tenantId, doctor_id: doctor.userId, diagnosis_name: "My hypertension protocol", specialty: "general_physician", use_count: 9 },
    { tenant_id: clinic.tenantId, doctor_id: otherDoctor.userId, diagnosis_name: "Other doctor hypertension note", specialty: "general_physician", use_count: 30 },
  ]);
  if (custom.error) throw new Error(custom.error.message);
}, 120_000);

afterAll(async () => {
  if (catalogueIds.length > 0) await admin.from("opd_diagnoses").delete().in("id", catalogueIds);
});

async function names(who: SeededTenant, input: Parameters<typeof searchDiagnoses>[1]): Promise<string[]> {
  const res = await searchDiagnoses(ctxFor(who), input);
  if (!res.success) throw new Error(res.error);
  return res.results.map((r) => r.name);
}

describe("searchDiagnoses: the ranking table", () => {
  const catalogueRanked = ["Hypertension", "Hypertension, secondary", "Elevated BP", "Pulmonary hypertension", "Prehypertension"];

  it("exact name, then name prefix, then synonym, then a word of the name, then inside the name; the doctor's own custom first", async () => {
    expect(await names(doctor, { query: "hypertension" })).toEqual(["My hypertension protocol", ...catalogueRanked]);
  });
  it("another doctor of the same clinic gets their own custom row and none of the first doctor's", async () => {
    expect(await names(otherDoctor, { query: "hypertension" })).toEqual(["Other doctor hypertension note", ...catalogueRanked]);
  });
  it("a nurse (consultations:view) has no custom rows of their own, and sees nobody else's", async () => {
    expect(await names(nurse, { query: "hypertension" })).toEqual(catalogueRanked);
  });
  it("a receptionist is refused: no rows, no error text from the database", async () => {
    const res = await searchDiagnoses(ctxFor(receptionist), { query: "hypertension" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).not.toMatch(/search_diagnoses|permission denied|row-level/i);
  });
  it("a synonym finds the diagnosis typed alone (HTN is a synonym of Hypertension)", async () => {
    expect(await names(nurse, { query: "htn" })).toEqual(["Hypertension"]);
  });
  it("an abbreviation that is not a synonym is found through its expansion only when entitled (expand)", async () => {
    expect(await names(nurse, { query: "t2dm", expand: true })).toEqual(["Type 2 diabetes mellitus"]);
    expect(await names(nurse, { query: "t2dm", expand: false })).toEqual([]);
    expect(await names(nurse, { query: "t2dm" })).toEqual([]);
  });
  it.each([
    ["urti", "Acute upper respiratory tract infection"],
    ["age", "Acute gastroenteritis"],
    ["aom", "Acute otitis media"],
    ["uti", "Urinary tract infection"],
  ])("%s expands and finds %s", async (query, expected) => {
    expect(await names(nurse, { query, expand: true })).toContain(expected);
  });
  it("'uti' without the expansion does not find the diagnosis of another name", async () => {
    expect(await names(nurse, { query: "uti", expand: false })).not.toContain("Urinary tract infection");
  });
  it("a one-letter typo is found through trigram similarity", async () => {
    const found = await names(nurse, { query: "hypertensn" });
    expect(found).toContain("Hypertension");
  });
  it("prefix ranks before infix: 'Hypertension, secondary' is listed before 'Prehypertension'", async () => {
    const found = await names(nurse, { query: "hypertension" });
    expect(found.indexOf("Hypertension, secondary")).toBeLessThan(found.indexOf("Prehypertension"));
  });
  it("case does not matter", async () => {
    expect(await names(nurse, { query: "HYPERTENSION" })).toEqual(catalogueRanked);
  });
  it("the specialty filter keeps tagged diagnoses and drops the others", async () => {
    expect(await names(nurse, { query: "cavity", specialty: "dental" })).toEqual(["Dental caries"]);
    expect(await names(nurse, { query: "cavity", specialty: "pediatrics" })).toEqual([]);
    expect(await names(nurse, { query: "otitis", specialty: "pediatrics" })).toEqual(["Acute otitis media"]);
    expect(await names(nurse, { query: "otitis", specialty: "dental" })).toEqual([]);
  });
  it("the result carries the ICD-11 code, the chronic flag and the custom flag", async () => {
    const res = await searchDiagnoses(ctxFor(doctor), { query: "hypertension" });
    if (!res.success) throw new Error(res.error);
    expect(res.results[0]).toMatchObject({ name: "My hypertension protocol", custom: true, icd11: null });
    expect(res.results.find((r) => r.name === "Hypertension")).toMatchObject({ icd11: "BA00", chronic: true, custom: false });
  });
  it("wildcards in the query match themselves: '%%' and '__' match nothing (pgTAP covers an underscore inside a name)", async () => {
    expect(await names(nurse, { query: "%%" })).toEqual([]);
    expect(await names(nurse, { query: "__" })).toEqual([]);
  });
  it("a one-character query is no query", async () => {
    expect(await names(nurse, { query: "h" })).toEqual([]);
  });
  it("the limit applies", async () => {
    expect(await names(nurse, { query: "hypertension", limit: 2 })).toEqual(["Hypertension", "Hypertension, secondary"]);
  });
});
