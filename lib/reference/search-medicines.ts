import { cleanQuery } from "@/features/terminology/abbreviations";
import { MEDICINE_QUERY_MAX, MEDICINE_SEARCH_LIMIT, type MedicineSearchResult } from "@/features/prescriptions/schema";
import type { CdciMedicineHit, IndexSearchResult } from "./medicine-index";
import { btrimSpaces, leftChars } from "./search-substances";
import { compareCodePointsFast } from "./medicine-index";
import { isSimilar, setSimilarity, trigrams } from "./trigram";

/**
 * The TypeScript twin of `public.search_medicines` (000117, tie-break of 000128; V2-09e 09E-11, R-6, R-7) for ranks 1 to 4, and the doctor's own custom
 * medicines. The parity spec (tests/reference/medicine-search-parity.spec.ts) runs one case table against both.
 *
 * SQL, restated:
 *   limit = least(greatest(coalesce(p_limit, 15), 1), 30); term = lower(btrim(left(p_query, 60)))  (btrim: spaces; %, _ and \ literal)
 *   custom (the caller's own): lower(name) or lower(generic) contains the term, or similarity(lower(name), term) >= 0.3;
 *          group 0, uses = use_count, rank 0; carries its stored dose (dosage, timing, duration), no substance ids
 *   catalogue: ranks 1 to 4 (lib/reference/medicine-index.ts), rank 5 = trigram only; a catalogue row whose lower-cased brand equals a MATCHED
 *          custom medicine's lower-cased name is dropped; group 1; no dose (09C R-4); substance ids from its generic
 *   order by group, uses DESC, rank, lower(name) COLLATE "C", id; limit
 *
 * Ranks 1 to 4 sort before rank 5, so when the device's rows (custom + ranks 1 to 4) fill the limit they ARE the database's answer; otherwise the
 * caller asks the route once and its answer replaces the list (R-7: the database is the authority for the tail).
 *
 * Differences that are accepted and recorded (09E-NOTES): the device knows the doctor's 500 most used custom medicines (the consult's query); a custom
 * row's id is `custom:<lower-cased name>` (the consult's query carries no id; a custom line is added by its name); two custom medicines whose names
 * differ only in case and have the same use count are ordered by name here (the database by their uuid).
 */
export interface CustomMedicine {
  medicine_name: string;
  generic_name: string | null;
  dose_form: string | null;
  default_dosage: string | null;
  default_timing: string | null;
  default_duration: string | null;
  use_count: number;
}

export const MEDICINE_TWIN_DEFAULT_LIMIT = 15;

/** The term the database searches for `p_query`: lower(btrim(left(p_query, 60))). */
export function medicineTerm(pQuery: string | null): string {
  return btrimSpaces(leftChars(pQuery ?? "", 60)).toLowerCase();
}

/**
 * The `p_query` the server path sends for a typed value: the entry row's `fetchMedicines` (trim, 60), the route (`cleanQuery`, 60, trim) and the
 * service (trim, 60, trim), in that order.
 */
export function medicineQueryOf(typed: string): string {
  const sent = typed.trim().slice(0, MEDICINE_QUERY_MAX);
  const routed = cleanQuery(sent).slice(0, MEDICINE_QUERY_MAX).trim();
  return routed.trim().slice(0, MEDICINE_QUERY_MAX).trim();
}

export function twinLimit(limit: number | null | undefined): number {
  return Math.min(Math.max(limit ?? MEDICINE_TWIN_DEFAULT_LIMIT, 1), 30);
}

/** The doctor's own medicines that match `term`, in SQL order (use count, then name), as the route maps them. */
export function matchCustomMedicines(customs: readonly CustomMedicine[], term: string): MedicineSearchResult[] {
  if (term === "") return [];
  const termTrigrams = trigrams(term);
  const hits: Array<{ row: MedicineSearchResult; uses: number; key: string }> = [];
  for (const c of customs) {
    const lower = c.medicine_name.toLowerCase();
    const match = lower.includes(term) || (c.generic_name ?? "").toLowerCase().includes(term) || isSimilar(setSimilarity(trigrams(lower), termTrigrams));
    if (!match) continue;
    hits.push({
      uses: c.use_count,
      key: lower,
      row: {
        id: `custom:${lower}`,
        kind: "custom",
        medicine_name: c.medicine_name,
        generic_name: c.generic_name,
        dose_form: c.dose_form,
        substance_ids: [],
        dosage: c.default_dosage,
        timing: c.default_timing,
        duration: c.default_duration,
      },
    });
  }
  hits.sort((a, b) => b.uses - a.uses || compareCodePointsFast(a.key, b.key) || compareCodePointsFast(a.row.medicine_name, b.row.medicine_name));
  return hits.map((h) => h.row);
}

export function cdciRow(hit: CdciMedicineHit): MedicineSearchResult {
  return { id: hit.id, kind: "cdci", medicine_name: hit.medicine_name, generic_name: hit.generic_name, dose_form: hit.dose_form, substance_ids: hit.substance_ids, dosage: null, timing: null, duration: null };
}

export interface LocalMedicineAnswer {
  rows: MedicineSearchResult[];
  /** True when the rows are the database's whole answer (they fill the limit, or the term is empty); false: ask the route for the tail. */
  complete: boolean;
}

/**
 * The twin for one `p_query`: the custom rows, then ranks 1 to 4 from `searchIndex` (the worker's, or the index itself in a spec), at most `limit`.
 * `searchIndex(term, need, exclude)` answers ranks 1 to 4 leaving out the excluded lower-cased brand names.
 */
export async function searchMedicinesLocal(
  searchIndex: (term: string, need: number, exclude: ReadonlySet<string>) => Promise<IndexSearchResult> | IndexSearchResult,
  customs: readonly CustomMedicine[],
  pQuery: string | null,
  limit: number | null = MEDICINE_TWIN_DEFAULT_LIMIT,
): Promise<LocalMedicineAnswer> {
  const lim = twinLimit(limit);
  const term = medicineTerm(pQuery);
  if (term === "") return { rows: [], complete: true };
  const custom = matchCustomMedicines(customs, term);
  if (custom.length >= lim) return { rows: custom.slice(0, lim), complete: true };
  const need = lim - custom.length;
  const found = await searchIndex(term, need, new Set(custom.map((c) => c.medicine_name.toLowerCase())));
  const rows = [...custom, ...found.rows.slice(0, need).map(cdciRow)];
  return { rows, complete: rows.length >= lim };
}

/** What the Rx field asks of the device for a typed value: the server path's query, the route's limit. */
export function searchMedicinesOnDevice(
  searchIndex: (term: string, need: number, exclude: ReadonlySet<string>) => Promise<IndexSearchResult> | IndexSearchResult,
  customs: readonly CustomMedicine[],
  typed: string,
): Promise<LocalMedicineAnswer> {
  const query = medicineQueryOf(typed);
  if (query === "") return Promise.resolve({ rows: [], complete: true });
  return searchMedicinesLocal(searchIndex, customs, query, MEDICINE_SEARCH_LIMIT);
}
