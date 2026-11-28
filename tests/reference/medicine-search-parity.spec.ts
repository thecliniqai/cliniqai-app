/**
 * V2-09e 09E-11 (R-6, R-7): the on-device medicine search is a twin of `public.search_medicines` (000117, tie-break 000128) for the doctor's own custom
 * medicines and catalogue ranks 1 to 4. One case table runs against both: the twin over the medicine shards the doctor's device downloads
 * (`public.reference_shard` through the doctor's own JWT client, built into the columnar index) with the doctor's custom medicines as the consult's query
 * holds them (`consult_screen`'s list), and the SQL function through the same client.
 *   - When the device's rows fill the limit (`complete`), they ARE the SQL answer: same rows, same order, same fields.
 *   - When they do not (the trigram tail, rank 5, is the server's), the device's rows equal the SQL answer's first rows, and every SQL row after them is one
 *     the device could not rank (no custom, no catalogue row of ranks 1 to 4): the route's answer then replaces the list (`R-7`), which is the SQL answer.
 * Then the device path as the Rx field runs it (`searchMedicinesOnDevice`) against the server path as the route runs it (`searchMedicines`).
 *
 * Synthetic rows only (`test-ref-med-*` brands, `test-ref-gen-*` generics, `test-ref-sub-med-*` substances; consistent across the CDCI tables, as the real
 * load is), upserted and never deleted (global reference fixtures). Every fixture but one (`Zqvtyporow`, the trigram tail) holds the `qzxmed`
 * token, in made-up words only; the shards are read again before each SQL call.
 * A custom row has no id on the device (the consult's query carries none): rows are compared as `custom:<lower-cased name>` for a custom row.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";
import { parseShard, type CatalogueRow } from "@/features/reference/catalogues";
import { searchMedicines } from "@/features/prescriptions/service";
import type { MedicineSearchResult } from "@/features/prescriptions/schema";
import { buildMedicineIndex, compareCodePointsFast, searchMedicineIndex, type MedicineIndex } from "@/lib/reference/medicine-index";
import { medicineQueryOf, searchMedicinesLocal, searchMedicinesOnDevice, type CustomMedicine } from "@/lib/reference/search-medicines";
import { compareCodePoints } from "@/lib/reference/search-substances";

const admin = getAdminClient();
let clinic: SeededTenant;
let doctor: SeededTenant;
let otherDoctor: SeededTenant;
let customs: CustomMedicine[] = [];

const SUBSTANCES = [
  { id: "test-ref-sub-med-1", substance_name: "Qzxmedsub One" },
  { id: "test-ref-sub-med-2", substance_name: "Qzxmedsub Two" },
];
const GENERICS: Record<string, { name: string; subs: string[] }> = {
  g1: { name: "Qzxmedol 500 mg", subs: ["test-ref-sub-med-1"] },
  g2: { name: "Qzxmedin 250 mg", subs: ["test-ref-sub-med-2"] },
  g3: { name: "Paraqzxmed Combo", subs: ["test-ref-sub-med-1", "test-ref-sub-med-2"] },
  g4: { name: "Zzother Generic", subs: [] },
  g5: { name: "Éqzxmed Génerique", subs: [] },
};
const BRANDS: Array<{ n: string; brand: string; g: keyof typeof GENERICS | null; form?: string }> = [
  { n: "01", brand: "Qzxmed Alphz 500", g: "g1", form: "Tablet" },
  { n: "02", brand: "Qzxmed Betz 250", g: "g2", form: "Capsule" },
  { n: "03", brand: "Alphz Qzxmed", g: "g4" },
  { n: "04", brand: "Xqzxmedx", g: "g4" },
  { n: "05", brand: "Zz Brnd Onq", g: "g1" },
  { n: "06", brand: "Zz Brnd Twq", g: "g3" },
  { n: "07", brand: "Qzxmed 5% Crezm", g: "g4" },
  { n: "08", brand: "Qzxmed_under", g: "g4" },
  { n: "09", brand: "Qzxmed\\slash", g: "g4" },
  { n: "10", brand: "Qzxmedxx qzxmed%a", g: "g4" },
  { n: "11", brand: "Qzxmedzu qzxmed_u", g: "g4" },
  { n: "12", brand: "Ämoxqzxmed", g: "g4" },
  { n: "13", brand: "Éclair qzxmed", g: "g4" },
  { n: "14", brand: "Qzxmedtie-b", g: "g4" },
  { n: "15", brand: "Qzxmedtiea", g: "g4" },
  { n: "16", brand: "Qzxmedsame", g: "g4" },
  { n: "17", brand: "qzxmedsame", g: "g4" },
  { n: "18", brand: "Qzxmed Mine", g: "g4" },
  { n: "19", brand: "Zqvtyporow", g: "g4" },
  { n: "20", brand: "Qzxmed No Generic", g: null },
  { n: "21", brand: "Zz Brnd Accq", g: "g5" },
  ...Array.from({ length: 20 }, (_, i) => ({ n: `l${String(i).padStart(2, "0")}`, brand: `Qzxmedlim ${String(19 - i).padStart(2, "0")}`, g: "g4" as const })),
];
const MY_CUSTOM = [
  { medicine_name: "qzxmed mine", generic_name: "Custom gen", dose_form: "Syrup", default_dosage: "1-0-1", default_timing: "After food", default_duration: "5 days", use_count: 4 },
  { medicine_name: "Qzxmed Custom Syrup", generic_name: null, dose_form: null, default_dosage: "0-0-1", default_timing: null, default_duration: "3 days", use_count: 7 },
  { medicine_name: "Zz Custom By Generic", generic_name: "qzxmedol custom", dose_form: "Tablet", default_dosage: "1-1-1", default_timing: null, default_duration: "7 days", use_count: 2 },
  { medicine_name: "Qzxmedcustomtypo", generic_name: null, dose_form: null, default_dosage: "1-0-0", default_timing: null, default_duration: "2 days", use_count: 1 },
];
const OTHER_CUSTOM = [{ medicine_name: "Qzxmed Other Own", generic_name: null, dose_form: null, default_dosage: "1-0-1", default_timing: null, default_duration: "5 days", use_count: 9 }];

const brandId = (n: string) => `test-ref-med-${n}`;
const genericId = (g: string) => `test-ref-gen-${g}`;

async function readIndex(): Promise<MedicineIndex> {
  const read = async (shard: number) => {
    const res = await doctor.client.rpc("reference_shard", { p_tenant_id: clinic.tenantId, p_catalogue: "medicines", p_shard: shard });
    if (res.error) throw new Error(res.error.message);
    const parsed = parseShard(res.data, { catalogue: "medicines", version: (res.data as { version: string }).version, shard });
    if (!parsed) throw new Error(`medicine shard ${shard} did not parse`);
    return parsed;
  };
  const first = await read(0);
  const shards: CatalogueRow[][] = [first.rows];
  for (let s = 1; s < first.shards; s++) {
    const next = await read(s);
    if (next.version !== first.version) return readIndex();
    shards.push(next.rows);
  }
  return buildMedicineIndex(first.version, shards);
}

beforeAll(async () => {
  clinic = await seedTenantWithOwner("Medicine Parity");
  doctor = await addMemberToTenant(clinic.tenantId, "doctor");
  otherDoctor = await addMemberToTenant(clinic.tenantId, "doctor");
  const must = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`${label}: ${error.message}`);
  };
  must("substances", (await admin.from("cdci_substances").upsert(SUBSTANCES, { onConflict: "id" })).error);
  must(
    "generics",
    (await admin.from("cdci_generics").upsert(Object.entries(GENERICS).map(([g, v]) => ({ id: genericId(g), generic_name: v.name, substance_ids: v.subs })), { onConflict: "id" })).error,
  );
  must("brands", (await admin.from("cdci_brands").upsert(BRANDS.map((b) => ({ id: brandId(b.n), brand_name: b.brand, generic_id: b.g ? genericId(b.g) : null })), { onConflict: "id" })).error);
  must(
    "search rows",
    (
      await admin.from("cdci_medicines_search").upsert(
        BRANDS.map((b) => ({ id: brandId(b.n), brand_name: b.brand, generic_name: b.g ? GENERICS[b.g]!.name : null, dose_form: b.form ?? null, product_name: b.brand, supplier_name: "Synthetic Labs" })),
        { onConflict: "id" },
      )
    ).error,
  );
  const own = (t: SeededTenant, list: typeof MY_CUSTOM) => list.map((c) => ({ ...c, tenant_id: clinic.tenantId, doctor_id: t.userId }));
  must("customs", (await admin.from("doctor_custom_medicines").insert([...own(doctor, MY_CUSTOM), ...own(otherDoctor, OTHER_CUSTOM)])).error);
  // The doctor's own list as consult_screen puts it in the consult's query (000124): own rows, use count, then name, at most 500.
  const list = await admin
    .from("doctor_custom_medicines")
    .select("medicine_name, generic_name, dose_form, default_dosage, default_timing, default_duration, use_count")
    .eq("tenant_id", clinic.tenantId)
    .eq("doctor_id", doctor.userId)
    .order("use_count", { ascending: false })
    .order("medicine_name")
    .limit(500);
  must("custom list", list.error);
  customs = list.data ?? [];
}, 120_000);

type Compared = Omit<MedicineSearchResult, "id"> & { key: string };
const compared = (r: MedicineSearchResult): Compared => {
  const { id, ...rest } = r;
  return { key: r.kind === "custom" ? `custom:${r.medicine_name.toLowerCase()}` : id, ...rest, substance_ids: [...r.substance_ids].sort() };
};

async function sql(query: string | null, limit?: number | null): Promise<Compared[]> {
  const args: Record<string, unknown> = { p_tenant_id: clinic.tenantId, p_query: query };
  if (limit !== undefined) args.p_limit = limit;
  const { data, error } = await doctor.client.rpc("search_medicines", args as never);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<MedicineSearchResult & { substance_ids: string[] | null }>).map((r) => compared({ ...r, substance_ids: r.substance_ids ?? [] }));
}

async function device(index: MedicineIndex, query: string | null, limit?: number | null) {
  const answer = await searchMedicinesLocal((term, need, exclude) => searchMedicineIndex(index, term, need, exclude), customs, query, limit === undefined ? undefined : limit);
  return { rows: answer.rows.map(compared), complete: answer.complete };
}

const CASES: Array<{ name: string; query: string | null; limit?: number | null; expect?: "complete" | "tail" }> = [
  { name: "brand prefix", query: "qzxmed alphz" },
  { name: "brand prefix, other case", query: "QZXMED ALPHZ" },
  { name: "a word of the brand", query: "alphz qzx" },
  { name: "the term inside a brand", query: "qzxmedx" },
  { name: "generic prefix", query: "qzxmedol" },
  { name: "a word of the generic", query: "qzxmedin 250" },
  { name: "inside the generic", query: "aqzxmed com" },
  { name: "non-ASCII generic", query: "éqzxmed g" },
  { name: "% matches itself", query: "qzxmed 5%" },
  { name: "% is not a wildcard in the prefix rank", query: "qzxmed%a" },
  { name: "_ matches itself", query: "qzxmed_u" },
  { name: "\\ matches itself", query: "qzxmed\\s" },
  { name: "non-ASCII lower-case", query: "ämoxqzx" },
  { name: "non-ASCII upper-case", query: "ÄMOXQZXMED" },
  { name: "non-ASCII word", query: "éclair qzx" },
  { name: "custom first by use count, then the catalogue (fills the limit)", query: "qzxmed", expect: "complete" },
  { name: "a custom name equal to a brand: the custom row only", query: "qzxmed mine" },
  { name: "a custom matched by its generic", query: "qzxmedol cus" },
  { name: "another doctor's custom is never present", query: "qzxmed other own" },
  { name: "ties: '-' before letters (C order)", query: "qzxmedtie" },
  { name: "identical names: by id", query: "qzxmedsame" },
  { name: "a brand with no generic", query: "qzxmed no gen" },
  { name: "the route's limit (15), filled locally", query: "qzxmedlim", limit: 15, expect: "complete" },
  { name: "limit 5", query: "qzxmedlim", limit: 5, expect: "complete" },
  { name: "limit 0 is 1", query: "qzxmedlim", limit: 0, expect: "complete" },
  { name: "limit 50 is 30", query: "qzxmed", limit: 50 },
  { name: "limit null is 15", query: "qzxmedlim", limit: null, expect: "complete" },
  { name: "the tail: a trigram-only match needs the server", query: "zqvtyporaw", expect: "tail" },
  { name: "the tail: a custom trigram match is local, the catalogue one is not", query: "qzxmedcustomtypp", expect: "tail" },
  { name: "spaces around the query (btrim)", query: "   qzxmed alphz   " },
  { name: "a tab is not trimmed", query: "\tqzxmed alphz" },
  { name: "61 characters: cut at 60", query: `qzxmedlim${" ".repeat(51)}x` },
  { name: "empty", query: "", expect: "complete" },
  { name: "spaces only", query: "    ", expect: "complete" },
  { name: "null", query: null, expect: "complete" },
  { name: "no match", query: "qzxmednothing", expect: "tail" },
];

describe("search_medicines twin: one case table against SQL", () => {
  it("has the plan's breadth (at least 30 cases); the shards hold every synthetic brand with its generic and substances", async () => {
    expect(CASES.length).toBeGreaterThanOrEqual(30);
    const index = await readIndex();
    for (const b of BRANDS) {
      const p = index.ids.indexOf(brandId(b.n));
      expect(p, b.brand).toBeGreaterThanOrEqual(0);
      const g = index.genericOf[p]!;
      expect(g >= 0 ? index.genericNames[g] : null).toBe(b.g ? GENERICS[b.g]!.name : null);
    }
    expect(customs.map((c) => c.medicine_name)).toEqual(["Qzxmed Custom Syrup", "qzxmed mine", "Zz Custom By Generic", "Qzxmedcustomtypo"]);
  });

  it.each(CASES)("$name", async ({ query, limit, expect: kind }) => {
    const index = await readIndex();
    const expected = await sql(query, limit);
    const local = await device(index, query, limit);
    if (kind) expect(local.complete ? "complete" : "tail").toBe(kind);
    if (local.complete) {
      expect(local.rows).toEqual(expected);
    } else {
      // The device's rows are the SQL answer's first rows; the rest is the tail the route answers (it replaces the list).
      expect(expected.slice(0, local.rows.length)).toEqual(local.rows);
      expect(local.rows.length).toBeLessThan(expected.length + 1);
    }
  });

  it("the cases are not vacuous: most return rows, some need the tail, and the controls hold", async () => {
    let nonEmpty = 0;
    for (const c of CASES) if ((await sql(c.query, c.limit)).length > 0) nonEmpty++;
    expect(nonEmpty).toBeGreaterThanOrEqual(25);
    const all = await sql("qzxmed");
    expect(all.slice(0, 4).map((r) => r.key)).toEqual(["custom:qzxmed custom syrup", "custom:qzxmed mine", "custom:zz custom by generic", "custom:qzxmedcustomtypo"]);
    expect(all[0]).toMatchObject({ kind: "custom", dosage: "0-0-1", duration: "3 days", substance_ids: [] });
    const mine = await sql("qzxmed mine");
    expect(mine[0]!.key).toBe("custom:qzxmed mine");
    expect(mine.map((r) => r.key)).not.toContain(brandId("18"));
    expect((await sql("qzxmed other own")).map((r) => r.medicine_name)).not.toContain("Qzxmed Other Own");
    expect((await sql("qzxmedtie")).filter((r) => r.kind === "cdci").slice(0, 2).map((r) => r.key)).toEqual([brandId("14"), brandId("15")]);
    expect((await sql("zqvtyporaw")).map((r) => r.key)).toContain(brandId("19"));
    expect((await sql("qzxmedol")).find((r) => r.key === brandId("01"))).toMatchObject({ dosage: null, substance_ids: ["test-ref-sub-med-1"] });
    // The tail case's last rows are ones the device cannot rank.
    const index = await readIndex();
    const tail = await device(index, "zqvtyporaw");
    expect(tail.complete).toBe(false);
    expect(tail.rows).toEqual([]);
    expect((await sql("zqvtyporaw")).length).toBeGreaterThan(tail.rows.length);
  });
});

describe("the index rests on", () => {
  it("compareCodePointsFast is code point order (C), like compareCodePoints", () => {
    const pairs: Array<[string, string]> = [["ﬁ", "\u{1D538}"], ["a-b", "aa"], ["ab", "ab"], ["ab", "abc"], ["\u{1F600}", "�"], ["é", "f"]];
    for (const [a, b] of pairs) expect(compareCodePointsFast(a, b)).toBe(compareCodePoints(a, b));
  });

  it("builds brands in (lower name, id) order with each brand's generic, and searches ranks 1 to 4 within `need`", () => {
    const index = buildMedicineIndex("00000000-0000-4000-8000-000000000001", [
      [["g-a", "Alpha generic", ["s1"]]],
      [["b-2", "beta", 0, null], ["b-1", "Beta", null, "Tablet"], ["b-3", "alpha beta", 0, null]],
    ]);
    expect(index.ids).toEqual(["b-3", "b-1", "b-2"]);
    expect(index.genericOf[0]).toBe(0);
    expect(index.genericOf[1]).toBe(-1);
    expect(searchMedicineIndex(index, "beta", 10).rows.map((r) => r.id)).toEqual(["b-1", "b-2", "b-3"]);
    expect(searchMedicineIndex(index, "beta", 1)).toMatchObject({ rows: [{ id: "b-1" }], matched: 1 });
    expect(searchMedicineIndex(index, "alpha", 10).rows.map((r) => r.id)).toEqual(["b-3", "b-2"]);
    expect(searchMedicineIndex(index, "beta", 10, new Set(["beta"])).rows.map((r) => r.id)).toEqual(["b-3"]);
  });
});

describe("the device path answers what the route's server path answers", () => {
  const typed = ["qzxmed alphz", "  Qzxmed Al ", "QZXMED\u0007ALPHZ", "qzxmed   alphz", "ämoxqzxmed", "qzxmed%a", "qzxmedlim", "qzxmed", `qzxmedlim${"x".repeat(70)}`, "zqvtyporaw", "  "];
  it.each(typed)("typed %j", async (value) => {
    const index = await readIndex();
    const routed = medicineQueryOf(value);
    const server = await searchMedicines(ctxFor(doctor), routed);
    if (!server.success) throw new Error("the server path failed");
    const expected = routed === "" ? [] : server.results.map(compared);
    const local = await searchMedicinesOnDevice((term, need, exclude) => searchMedicineIndex(index, term, need, exclude), customs, value);
    const rows = local.rows.map(compared);
    if (local.complete) expect(rows).toEqual(expected);
    else expect(expected.slice(0, rows.length)).toEqual(rows);
  });
});
