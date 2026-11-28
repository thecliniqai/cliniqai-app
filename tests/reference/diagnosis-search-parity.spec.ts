/**
 * V2-09e 09E-10 (R-6): the on-device diagnosis search is a twin of `public.search_diagnoses` (000114, tie-break 000128). One case table runs against
 * both: the twin over the diagnosis shard the doctor's device downloads (`public.reference_shard` through the doctor's own JWT client) with the doctor's
 * custom diagnoses as the consult's query holds them (`consult_screen`'s list: own rows, by use count, then name, 500 at most), and the SQL function
 * through the same client. Same rows in the same order at the same limit. Then the device path as the section runs it (`searchDiagnosesOnDevice`)
 * against the server path as the route runs it (`searchDiagnoses`, the service the route calls) for typed values, with and without the abbreviation
 * expansion, with and without a specialty.
 *
 * Synthetic rows only (fixed `e10e…` uuids, upserted, never deleted: global reference fixtures). Every fixture holds the `qzxdx` token and only made-up
 * words, so no other spec's query (fever, hypertension, otitis, dental, ...) reaches them, even by trigram. The shard is read
 * again right before each SQL call, so a catalogue row another spec file writes meanwhile is on both sides.
 *
 * A custom row has no id on the device (the consult's query carries none): rows are compared as `custom:<name>` for a custom row, the id otherwise.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";
import { parseShard, type CatalogueRow } from "@/features/reference/catalogues";
import { searchDiagnoses } from "@/features/terminology/service";
import { cleanQuery } from "@/features/terminology/abbreviations";
import { DIAGNOSIS_SEARCH_LIMIT } from "@/features/terminology/search";
import { diagnosisSpecialtyOf, diagnosisTermsOf, searchDiagnosesLocal, searchDiagnosesOnDevice, type CustomDiagnosis } from "@/lib/reference/search-diagnoses";

const admin = getAdminClient();
let clinic: SeededTenant;
let doctor: SeededTenant;
let otherDoctor: SeededTenant;

const uuid = (n: number) => `e10e0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Row = { n: number; name: string; synonyms?: string[]; specialties?: string[] | null; chronic?: boolean; icd11?: string; snomed?: string };
const CATALOGUE: Row[] = [
  { n: 1, name: "Qzxdx Pyrol", synonyms: ["Qzxdx Pyrexol"], icd11: "QZ01", snomed: "100001" },
  { n: 2, name: "Qzxdx Pyrol Chronol", chronic: true },
  { n: 3, name: "Acutol Qzxdx Pyrol" },
  { n: 4, name: "Viralqzxdx" },
  { n: 5, name: "Qzxdx Hypertol", synonyms: ["Qzxdx Zhtn", "Qzxdx Highbp"], chronic: true, icd11: "QZ05" },
  { n: 6, name: "Qzxdx Dentol Carol", specialties: ["dental"] },
  { n: 7, name: "Qzxdx Otol", specialties: ["pediatrics", "general_physician"] },
  { n: 8, name: "Qzxdx Ämox Allergol" },
  { n: 9, name: "Qzxdx Éclair Syndrome" },
  { n: 10, name: "Qzxdx tie-b" },
  { n: 11, name: "Qzxdx tiea" },
  { n: 12, name: "Qzxdx 50% Burn" },
  { n: 13, name: "Qzxdx_under" },
  { n: 14, name: "Qzxdx\\slash" },
  { n: 15, name: "Qzxdx Mine" },
  { n: 16, name: "Qzxdxtypo" },
  { n: 17, name: "Qzxdxsyn Base", synonyms: ["Qzxdxsynonymword"] },
  { n: 18, name: "Qzxdx No Specialty", specialties: null },
  { n: 19, name: "Qzxdx Other Doctor" },
  ...Array.from({ length: 25 }, (_, i): Row => ({ n: 100 + i, name: `Qzxdxlim ${String(24 - i).padStart(2, "0")}` })),
];
const MY_CUSTOM = [
  { diagnosis_name: "qzxdx mine", use_count: 3 },
  { diagnosis_name: "Qzxdx Custom Pyrol", use_count: 5 },
  { diagnosis_name: "Qzxdx Rare", use_count: 1 },
  { diagnosis_name: "Qzxdxcustomtypo", use_count: 2 },
];
const OTHER_CUSTOM = [{ diagnosis_name: "Qzxdx Other Doctor Own", use_count: 9 }];

let customs: CustomDiagnosis[] = [];

async function shardRows(): Promise<CatalogueRow[]> {
  const shard = await doctor.client.rpc("reference_shard", { p_tenant_id: clinic.tenantId, p_catalogue: "diagnoses", p_shard: 0 });
  if (shard.error) throw new Error(shard.error.message);
  const parsed = parseShard(shard.data, { catalogue: "diagnoses", version: (shard.data as { version: string }).version, shard: 0 });
  if (!parsed) throw new Error("the diagnosis shard did not parse");
  return parsed.rows;
}

beforeAll(async () => {
  clinic = await seedTenantWithOwner("Diagnosis Parity");
  doctor = await addMemberToTenant(clinic.tenantId, "doctor");
  otherDoctor = await addMemberToTenant(clinic.tenantId, "doctor");
  const up = await admin.from("opd_diagnoses").upsert(
    CATALOGUE.map((r) => ({
      id: uuid(r.n),
      name: r.name,
      synonyms: r.synonyms ?? [],
      specialties: r.specialties === undefined ? ["general_physician"] : r.specialties,
      is_chronic: r.chronic ?? false,
      icd11_code: r.icd11 ?? null,
      snomed_concept_id: r.snomed ?? null,
    })),
    { onConflict: "id" },
  );
  if (up.error) throw new Error(up.error.message);
  const own = (t: SeededTenant, list: typeof MY_CUSTOM) => list.map((c) => ({ tenant_id: clinic.tenantId, doctor_id: t.userId, diagnosis_name: c.diagnosis_name, use_count: c.use_count }));
  const ins = await admin.from("doctor_custom_diagnoses").insert([...own(doctor, MY_CUSTOM), ...own(otherDoctor, OTHER_CUSTOM)]);
  if (ins.error) throw new Error(ins.error.message);
  // The doctor's own list as consult_screen puts it in the consult's query (000124): own rows, use count, then name, at most 500.
  const list = await admin
    .from("doctor_custom_diagnoses")
    .select("diagnosis_name, use_count")
    .eq("tenant_id", clinic.tenantId)
    .eq("doctor_id", doctor.userId)
    .order("use_count", { ascending: false })
    .order("diagnosis_name")
    .limit(500);
  if (list.error) throw new Error(list.error.message);
  customs = list.data;
}, 120_000);

const keyOf = (r: { id: string; name: string; custom: boolean }) => (r.custom ? `custom:${r.name}` : r.id);

async function sql(terms: (string | null)[] | null, specialty: string | null, limit?: number | null) {
  const args: Record<string, unknown> = { p_tenant_id: clinic.tenantId, p_terms: terms, p_specialty: specialty };
  if (limit !== undefined) args.p_limit = limit;
  const { data, error } = await doctor.client.rpc("search_diagnoses", args as never);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string; name: string; icd11_code: string | null; snomed_concept_id: string | null; is_chronic: boolean; is_custom: boolean }>).map(
    (r) => ({ key: keyOf({ id: r.id, name: r.name, custom: r.is_custom }), name: r.name, icd11: r.icd11_code, snomed: r.snomed_concept_id, chronic: r.is_chronic, custom: r.is_custom }),
  );
}

const CASES: Array<{ name: string; terms: (string | null)[] | null; specialty?: string | null; limit?: number | null }> = [
  { name: "exact name", terms: ["qzxdx pyrol"] },
  { name: "exact name, other case", terms: ["QZXDX PYROL"] },
  { name: "name prefix", terms: ["qzxdx pyr"] },
  { name: "a word of the name", terms: ["pyrol chr"] },
  { name: "inside a word", terms: ["iralqzx"] },
  { name: "synonym equal", terms: ["qzxdx pyrexol"] },
  { name: "synonym prefix", terms: ["qzxdx pyre"] },
  { name: "second synonym prefix", terms: ["qzxdx highb"] },
  { name: "abbreviation expanded (assist.terminology on)", terms: diagnosisTermsOf("qzxdx htn", true) },
  { name: "abbreviation as typed (off)", terms: diagnosisTermsOf("qzxdx htn", false) },
  { name: "specialty general_physician", terms: ["qzxdx d"], specialty: "general_physician" },
  { name: "specialty dental", terms: ["qzxdx d"], specialty: "dental" },
  { name: "specialty pediatrics", terms: ["qzxdx o"], specialty: "pediatrics" },
  { name: "a row with no specialties and a specialty asked", terms: ["qzxdx no"], specialty: "general_physician" },
  { name: "no specialty asked", terms: ["qzxdx d"] },
  { name: "custom first by use count", terms: ["qzxdx"] },
  { name: "custom and catalogue with the same name: the custom one only", terms: ["qzxdx mine"] },
  { name: "another doctor's custom is never present", terms: ["qzxdx other doctor"] },
  { name: "trigram only, catalogue", terms: ["qzxdxtypp"] },
  { name: "trigram only, custom", terms: ["qzxdxcustomtypp"] },
  { name: "trigram on a synonym", terms: ["qzxdxsynonymwrd"] },
  { name: "ties: '-' before letters (C order)", terms: ["qzxdx tie"] },
  { name: "% matches itself", terms: ["qzxdx 50%"] },
  { name: "_ matches itself", terms: ["qzxdx_u"] },
  { name: "\\ matches itself", terms: ["qzxdx\\s"] },
  { name: "non-ASCII lower-case", terms: ["qzxdx ämox"] },
  { name: "non-ASCII upper-case", terms: ["QZXDX ÉCLAIR"] },
  { name: "the route's limit (12)", terms: ["qzxdxlim"], limit: DIAGNOSIS_SEARCH_LIMIT },
  { name: "limit 5", terms: ["qzxdxlim"], limit: 5 },
  { name: "limit 0 is 1", terms: ["qzxdxlim"], limit: 0 },
  { name: "limit 60 is 50", terms: ["qzxdx"], limit: 60 },
  { name: "limit null is 20", terms: ["qzxdxlim"], limit: null },
  { name: "the default limit (20)", terms: ["qzxdxlim"] },
  { name: "a one-character term is ignored", terms: ["q", "qzxdx pyrol"] },
  { name: "only the first 8 terms", terms: ["zz1", "zz2", "zz3", "zz4", "zz5", "zz6", "zz7", "zz8", "qzxdx pyrol"] },
  { name: "duplicate terms", terms: ["qzxdx pyrol", "QZXDX PYROL", " qzxdx pyrol "] },
  { name: "the best rank over the terms", terms: ["qzxdx otol", "qzxdx pyrol"] },
  { name: "spaces around a term (btrim)", terms: ["   qzxdx pyrol   "] },
  { name: "a tab is not trimmed", terms: ["\tqzxdx pyrol"] },
  { name: "a term over 100 characters is cut", terms: [`qzxdxlim${" ".repeat(95)}zzz`] },
  { name: "a NULL term is skipped", terms: [null, "qzxdx pyrol"] },
  { name: "no terms", terms: [] },
  { name: "NULL terms", terms: null },
  { name: "no match", terms: ["qzxdxnothing"] },
];

describe("search_diagnoses twin: one case table against SQL", () => {
  it("has the plan's breadth (at least 30 cases) and the shard holds every synthetic row", async () => {
    expect(CASES.length).toBeGreaterThanOrEqual(30);
    const ids = new Set((await shardRows()).map((r) => r[0]));
    expect(CATALOGUE.every((r) => ids.has(uuid(r.n)))).toBe(true);
    expect(customs.map((c) => c.diagnosis_name)).toEqual(["Qzxdx Custom Pyrol", "qzxdx mine", "Qzxdxcustomtypo", "Qzxdx Rare"]);
  });

  it.each(CASES)("$name", async ({ terms, specialty, limit }) => {
    const rows = await shardRows();
    const expected = await sql(terms, specialty ?? null, limit);
    const local = searchDiagnosesLocal(rows, customs, terms, specialty ?? null, limit === undefined ? undefined : limit);
    expect(local.map((h) => ({ key: keyOf(h), name: h.name, icd11: h.icd11, snomed: h.snomed, chronic: h.chronic, custom: h.custom }))).toEqual(expected);
  });

  it("the cases are not vacuous: most return rows; custom, synonym, trigram and specialty cases do what their names say", async () => {
    let nonEmpty = 0;
    for (const c of CASES) if ((await sql(c.terms, c.specialty ?? null, c.limit)).length > 0) nonEmpty++;
    expect(nonEmpty).toBeGreaterThanOrEqual(30);
    const first = await sql(["qzxdx"], null);
    expect(first.slice(0, 4).map((r) => r.key)).toEqual(["custom:Qzxdx Custom Pyrol", "custom:qzxdx mine", "custom:Qzxdxcustomtypo", "custom:Qzxdx Rare"]);
    const mine = (await sql(["qzxdx mine"], null)).map((r) => r.key);
    expect(mine[0]).toBe("custom:qzxdx mine");
    expect(mine).not.toContain(uuid(15));
    const other = (await sql(["qzxdx other doctor"], null)).map((r) => r.name);
    expect(other[0]).toBe("Qzxdx Other Doctor");
    expect(other).not.toContain("Qzxdx Other Doctor Own");
    expect((await sql(["qzxdxtypp"], null)).map((r) => r.key)).toContain(uuid(16));
    // The specialty filters the catalogue only (the doctor's own diagnoses are not filed by it).
    expect((await sql(["qzxdx d"], "dental", null)).filter((r) => !r.custom).map((r) => r.key)).toEqual([uuid(6)]);
    expect((await sql(["qzxdx tie"], null)).filter((r) => !r.custom).slice(0, 2).map((r) => r.key)).toEqual([uuid(10), uuid(11)]);
    expect((await sql(diagnosisTermsOf("qzxdx htn", true), null)).map((r) => r.key)).toContain(uuid(5));
  });
});

describe("the device path answers what the route's server path answers", () => {
  const typed: Array<[string, boolean, string | undefined]> = [
    ["qzxdx pyrol", false, "general_physician"],
    ["  Qzxdx Pyr ", true, "general_physician"],
    ["qzxdx htn", true, "general_physician"],
    ["qzxdx htn", false, "general_physician"],
    ["QZXDX\u0007PYROL", false, undefined],
    ["qzxdx   d", false, "dental"],
    ["qzxdx d", false, "orthopaedics"],
    ["qzxdxlim", true, undefined],
    [`qzxdxlim${"x".repeat(120)}`, false, undefined],
    ["q", true, undefined],
    ["   ", false, undefined],
  ];
  it.each(typed)("typed %j, expand %s, specialty %s", async (value, expand, specialty) => {
    const rows = await shardRows();
    // fetchDiagnosisHits (trim, under 2 characters no request, 100), then the route (cleanQuery, under 2 characters answers []), then the service.
    const sent = value.trim();
    const query = cleanQuery(sent.slice(0, 100));
    let expected: Array<{ key: string; name: string }> = [];
    if (sent.length >= 2 && query.length >= 2) {
      const server = await searchDiagnoses(ctxFor(doctor), { query, specialty: diagnosisSpecialtyOf(specialty) ?? undefined, limit: DIAGNOSIS_SEARCH_LIMIT, expand });
      if (!server.success) throw new Error("the server path failed");
      expected = server.results.map((h) => ({ key: keyOf(h), name: h.name }));
    }
    const local = searchDiagnosesOnDevice(rows, customs, value, { expand, specialty }).map((h) => ({ key: keyOf(h), name: h.name }));
    expect(local).toEqual(expected);
  });
});
