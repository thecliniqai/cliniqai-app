/**
 * V2-09e 09E-11 (R-7, B-4, B-14): a full-size SYNTHETIC reference catalogue for the latency lane: 93,911 brands, 10,305 generics, 3,283 substances and
 * 1,550 diagnoses, the counts of the real CDCI and OPD files, with name lengths drawn from their measured distributions (the quantiles below were read
 * once from supabase/seed-data with no database and no network; 09E-NOTES). The local stack holds only test fixtures (`seed:cdci` targets the hosted
 * project and is never run), so the device's download, index and search are measured at real size on made-up names.
 *
 * Deterministic (a seeded generator): the same rows every run. Ids are `perf-*` (CDCI text ids) and `e11e…` uuids (diagnoses), upserted by the lane's
 * medicine rows and deleted after them ({@link deletePerfCatalogue}). Made-up words only, so no other spec's query reaches them. Two families of
 * 20 brands, `Perfrow Alpha NN` and `Perfrow Alpine NN`, are what the lane's medicine typeahead row types (the last key keeps only one family).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const PERF_COUNTS = { brands: 93_911, generics: 10_305, substances: 3_283, diagnoses: 1_550 } as const;

/** Name length quantiles at 0, 5, 10, 20, ..., 90, 95, 99, 100 % (measured from the real files, 2026-11-25). */
const Q_POINTS = [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100];
const LENGTHS = {
  brand: [15, 23, 24, 25, 26, 28, 34, 37, 40, 47, 53, 64, 77, 122],
  generic: [22, 28, 30, 35, 40, 45, 50, 56, 63, 73, 87, 106, 138, 258],
  substance: [3, 8, 9, 10, 11, 12, 14, 17, 19, 22, 25, 28, 35, 47],
  diagnosis: [5, 17, 21, 30, 47, 50, 52, 54, 54, 56, 58, 59, 63, 64],
};
/** Substances per generic (same quantile points). */
const SUBS_PER_GENERIC = [1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 4, 7];

/** H-1 (09E-NOTES): "perfrow alp" lists Alpha first (name order fills the limit of 15 with Alpha), the next key "i" keeps only Alpine, so the measured key
 * changes what is on screen. (09E-11 had them the other way round: the dropped family was never on screen, found when the row first ran.) */
export const PERF_FAMILY = { keep: "Perfrow Alpine", drop: "Perfrow Alpha", size: 20 } as const;

function generator(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(q: readonly number[], u: number): number {
  const p = u * 100;
  for (let i = 1; i < Q_POINTS.length; i++) {
    if (p <= Q_POINTS[i]!) {
      const lo = Q_POINTS[i - 1]!;
      const f = (p - lo) / (Q_POINTS[i]! - lo);
      return Math.round(q[i - 1]! + f * (q[i]! - q[i - 1]!));
    }
  }
  return q[q.length - 1]!;
}

const SYLLABLES = ["zor", "vex", "pra", "quil", "dax", "mur", "tel", "ziv", "kor", "bex", "lum", "nar", "phy", "trax", "ob", "yl", "en", "ix", "ol", "um", "cep", "rif", "sul", "tor"];
const FORMS = ["Tablet", "Capsule", "Syrup", "Injection", "Cream", "Drops", "Suspension", "Gel", "Ointment", "Inhaler"];
const UNITS = ["mg", "mg/mL", "microgram", "g", "IU", "%"];

export interface PerfCatalogue {
  substances: Array<{ id: string; substance_name: string }>;
  generics: Array<{ id: string; generic_name: string; substance_ids: string[] }>;
  brands: Array<{ id: string; brand_name: string; generic_id: string | null }>;
  search: Array<{ id: string; brand_name: string; generic_name: string | null; dose_form: null; product_name: string; supplier_name: string }>;
  diagnoses: Array<{ id: string; name: string; synonyms: string[]; specialties: string[]; is_chronic: boolean; icd11_code: string | null; snomed_concept_id: null }>;
}

const pad = (n: number, w = 6) => String(n).padStart(w, "0");

/** The synthetic catalogue (about 100k rows; built in well under a second). */
export function perfCatalogue(): PerfCatalogue {
  const rnd = generator(0x09e11);
  // A vocabulary of made-up words; words are drawn with a skew (a few common, many rare), as drug and diagnosis names are.
  const vocab: string[] = [];
  for (let i = 0; i < 200; i++) {
    let w = "";
    const parts = 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < parts; k++) w += SYLLABLES[Math.floor(rnd() * SYLLABLES.length)];
    vocab.push(w[0]!.toUpperCase() + w.slice(1));
  }
  const word = () => vocab[Math.floor(vocab.length * rnd() ** 8)]!;
  const strength = () => `${[5, 10, 20, 25, 40, 50, 100, 250, 500, 650, 1000][Math.floor(rnd() * 11)]} ${UNITS[Math.floor(rnd() * UNITS.length)]}`;
  const nameOf = (length: number, extras: () => string[], first?: string) => {
    const words: string[] = first ? [first] : [];
    while (words.join(" ").length < length - 8) words.push(word());
    const out = [...words, ...extras()].join(" ");
    return out.length > length ? out.slice(0, length).trimEnd() : out;
  };

  const substances = Array.from({ length: PERF_COUNTS.substances }, (_, i) => ({ id: `perf-s-${pad(i)}`, substance_name: nameOf(Math.max(3, quantile(LENGTHS.substance, rnd())), () => []) }));
  const generics = Array.from({ length: PERF_COUNTS.generics }, (_, i) => {
    const subs = quantile(SUBS_PER_GENERIC, rnd());
    const substance_ids = Array.from({ length: subs }, () => substances[Math.floor(rnd() * substances.length)]!.id);
    const generic_name = nameOf(quantile(LENGTHS.generic, rnd()), () => [strength(), rnd() < 0.5 ? "oral" : "", FORMS[Math.floor(rnd() * FORMS.length)]!.toLowerCase()].filter(Boolean));
    return { id: `perf-g-${pad(i)}`, generic_name, substance_ids: [...new Set(substance_ids)] };
  });
  const brands: PerfCatalogue["brands"] = [];
  const familyStart = PERF_COUNTS.brands - 2 * PERF_FAMILY.size;
  for (let i = 0; i < PERF_COUNTS.brands; i++) {
    let brand_name: string | undefined;
    if (i >= familyStart) {
      const k = i - familyStart;
      brand_name = `${k < PERF_FAMILY.size ? PERF_FAMILY.keep : PERF_FAMILY.drop} ${pad(k % PERF_FAMILY.size, 2)}`;
    }
    // Six real brands name no generic; so do six here.
    const generic = i < 6 ? null : generics[Math.floor(rnd() * generics.length)]!;
    if (i < familyStart) {
      // Real brand names often carry their generic's first word (and its strength): half of them do here.
      const first = generic && rnd() < 0.5 ? generic.generic_name.split(" ")[0] : undefined;
      brand_name = nameOf(quantile(LENGTHS.brand, rnd()), () => [rnd() < 0.6 ? strength() : "", rnd() < 0.3 ? FORMS[Math.floor(rnd() * FORMS.length)]! : ""].filter(Boolean), first);
    }
    brands.push({ id: `perf-b-${pad(i)}`, brand_name: brand_name!, generic_id: generic?.id ?? null });
  }
  const genericName = new Map(generics.map((g) => [g.id, g.generic_name]));
  const search = brands.map((b) => ({
    id: b.id,
    brand_name: b.brand_name,
    generic_name: b.generic_id ? genericName.get(b.generic_id)! : null,
    dose_form: null,
    product_name: b.brand_name,
    supplier_name: "Synthetic Labs",
  }));
  const diagnoses = Array.from({ length: PERF_COUNTS.diagnoses }, (_, i) => ({
    id: `e11e0000-0000-4000-8000-${pad(i, 12)}`,
    name: nameOf(quantile(LENGTHS.diagnosis, rnd()), () => []),
    synonyms: rnd() < 0.3 ? [nameOf(12, () => [])] : [],
    specialties: ["general_physician"],
    is_chronic: rnd() < 0.2,
    icd11_code: rnd() < 0.8 ? `ZZ${pad(i, 4)}` : null,
    snomed_concept_id: null,
  }));
  return { substances, generics, brands, search, diagnoses };
}

const CHUNK = 5_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = SupabaseClient<any, any, any>;

async function upsertAll(admin: AdminClient, table: string, rows: readonly object[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await admin.from(table).upsert(rows.slice(i, i + CHUNK) as never, { onConflict: "id" });
    if (error) throw new Error(`perf catalogue (${table}): ${error.message}`);
  }
}

/** Upserts the synthetic catalogue as the service role (the local stack only). */
export async function upsertPerfCatalogue(admin: AdminClient): Promise<PerfCatalogue> {
  const c = perfCatalogue();
  await upsertAll(admin, "cdci_substances", c.substances);
  await upsertAll(admin, "cdci_generics", c.generics);
  await upsertAll(admin, "cdci_brands", c.brands);
  await upsertAll(admin, "cdci_medicines_search", c.search);
  await upsertAll(admin, "opd_diagnoses", c.diagnoses);
  return c;
}

/** Deletes every synthetic row (ids `perf-*`, diagnoses `e11e0000-…`). */
export async function deletePerfCatalogue(admin: AdminClient): Promise<void> {
  for (const table of ["cdci_medicines_search", "cdci_brands", "cdci_generics", "cdci_substances"]) {
    const { error } = await admin.from(table).delete().like("id", "perf-%");
    if (error) throw new Error(`perf catalogue delete (${table}): ${error.message}`);
  }
  const { error } = await admin.from("opd_diagnoses").delete().gte("id", "e11e0000-0000-4000-8000-000000000000").lte("id", "e11e0000-0000-4000-8000-ffffffffffff");
  if (error) throw new Error(`perf catalogue delete (opd_diagnoses): ${error.message}`);
}
