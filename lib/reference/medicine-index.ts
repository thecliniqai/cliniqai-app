import type { CatalogueRow } from "@/features/reference/catalogues";

/**
 * The on-device medicine index (V2-09e 09E-11, R-7): a columnar index of the CDCI medicine shards, built once per catalogue version (in the worker,
 * `lib/reference/worker.ts`, or on the main thread in idle slices when no worker can start), and the search of ranks 1 to 4 of `public.search_medicines`
 * (000117, tie-break 000128) over it. Pure: no DOM, no I/O.
 *
 * Shards: 0 = generics `[id, name, substance_ids]`; 1..n = brands `[id, brand_name, generic_row, dose_form]` (generic_row = the generic's position in
 * shard 0). Layout:
 * - brands sorted once by (lower(brand_name) in code point order, id): the order every rank lists its rows in (`lower(name) COLLATE "C", id`);
 * - one string of the sorted lower-cased brand names separated by U+0001 and the start of each in it (`indexOf` finds every occurrence of a term;
 *   a binary search over the starts gives its brand), and the same for the generics;
 * - per brand its generic's position (or -1), id, name and dose form; per generic its name and substance ids.
 *
 * SQL ranks 1 to 4 for the lower-cased, trimmed term (%, _ and \ literal): 1 the brand starts with it; 2 a word of the brand does (' ' || term);
 * 3 the generic starts with it or a word of it does; 4 the brand or the generic contains it. Rank 5 (trigram similarity ≥ 0.3 on 93,911 brands) is
 * not computed here: the caller asks the server for the tail (R-7).
 */
export interface MedicineIndex {
  version: string;
  brands: number;
  /** Sorted position -> brand fields. */
  ids: string[];
  names: string[];
  forms: (string | null)[];
  /** Sorted position -> generic position (-1: none). */
  genericOf: Int32Array;
  lowerNames: string[];
  brandText: string;
  brandStarts: Int32Array;
  genericNames: string[];
  genericSubstances: string[][];
  genericText: string;
  genericStarts: Int32Array;
}

/** A catalogue row the search returns (the route's shape, `kind: "cdci"`: no dose, 09C R-4). */
export interface CdciMedicineHit {
  id: string;
  medicine_name: string;
  generic_name: string | null;
  dose_form: string | null;
  substance_ids: string[];
}

const SEP = "\u0001";

/**
 * Code point order of two strings (UTF-8 byte order, i.e. `COLLATE "C"`), without allocating: UTF-16 code unit order, with surrogates moved above the
 * rest of the BMP (the only place the two orders differ).
 */
export function compareCodePointsFast(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let x = a.charCodeAt(i);
    let y = b.charCodeAt(i);
    if (x === y) continue;
    if (x >= 0xd800) x = x <= 0xdfff ? x + 0x2000 : x - 0x800;
    if (y >= 0xd800) y = y <= 0xdfff ? y + 0x2000 : y - 0x800;
    return x < y ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/** The steps of a build, so the main-thread fallback can run them in idle slices. Each `next()` does one bounded step. */
export function* buildMedicineIndexSteps(version: string, shards: readonly (readonly CatalogueRow[])[]): Generator<void, MedicineIndex> {
  const generics = shards[0] ?? [];
  const brandRows: CatalogueRow[] = [];
  for (let s = 1; s < shards.length; s++) for (const row of shards[s]!) brandRows.push(row);
  yield;
  const lower = brandRows.map((r) => (r[1] as string).toLowerCase());
  yield;
  const order = Array.from({ length: brandRows.length }, (_, i) => i);
  order.sort((x, y) => compareCodePointsFast(lower[x]!, lower[y]!) || compareCodePointsFast(brandRows[x]![0] as string, brandRows[y]![0] as string));
  yield;
  const n = order.length;
  const ids = new Array<string>(n);
  const names = new Array<string>(n);
  const forms = new Array<string | null>(n);
  const lowerNames = new Array<string>(n);
  const genericOf = new Int32Array(n);
  const brandStarts = new Int32Array(n + 1);
  let offset = 0;
  for (let p = 0; p < n; p++) {
    const row = brandRows[order[p]!]!;
    ids[p] = row[0] as string;
    names[p] = row[1] as string;
    forms[p] = (row[3] as string | null) ?? null;
    const g = row[2] as number | null;
    genericOf[p] = g === null || g >= generics.length ? -1 : g;
    lowerNames[p] = lower[order[p]!]!;
    brandStarts[p] = offset;
    offset += lowerNames[p]!.length + 1;
  }
  brandStarts[n] = offset;
  const brandText = lowerNames.join(SEP) + SEP;
  yield;
  const genericNames = generics.map((g) => g[1] as string);
  const genericSubstances = generics.map((g) => g[2] as string[]);
  const genericLower = genericNames.map((g) => g.toLowerCase());
  const genericStarts = new Int32Array(genericLower.length + 1);
  offset = 0;
  for (let i = 0; i < genericLower.length; i++) {
    genericStarts[i] = offset;
    offset += genericLower[i]!.length + 1;
  }
  genericStarts[genericLower.length] = offset;
  const genericText = genericLower.join(SEP) + SEP;
  return { version, brands: n, ids, names, forms, genericOf, lowerNames, brandText, brandStarts, genericNames, genericSubstances, genericText, genericStarts };
}

/** Builds the index at once (the worker, the unit specs). */
export function buildMedicineIndex(version: string, shards: readonly (readonly CatalogueRow[])[]): MedicineIndex {
  const steps = buildMedicineIndexSteps(version, shards);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/** The entry whose start is the largest one at or before `offset`. */
function entryAt(starts: Int32Array, count: number, offset: number): number {
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * For each entry of `text` (`starts`), the best rank of `term` in it: `atStart` when it starts the entry, `atWord` after a space, `inside` otherwise;
 * 0 when absent.
 */
function rankEntries(text: string, starts: Int32Array, count: number, term: string, atStart: number, atWord: number, inside: number): Uint8Array {
  const out = new Uint8Array(count);
  if (count === 0) return out;
  let from = 0;
  for (;;) {
    const at = text.indexOf(term, from);
    if (at < 0) break;
    const e = entryAt(starts, count, at);
    const rank = at === starts[e] ? atStart : text.charCodeAt(at - 1) === 32 ? atWord : inside;
    if (out[e] === 0 || rank < out[e]!) out[e] = rank;
    from = at + 1;
  }
  return out;
}

export interface IndexSearchResult {
  /** The catalogue rows of ranks 1 to 4, in SQL order, at most `need`. */
  rows: CdciMedicineHit[];
  /** How many catalogue rows of ranks 1 to 4 there are (counting stops at `need`). */
  matched: number;
}

/**
 * Ranks 1 to 4 for a lower-cased, trimmed term: at most `need` rows in SQL order, leaving out the brands whose lower-cased name is in `exclude` (a
 * custom medicine of the doctor that matched the query has that name: SQL drops the catalogue row).
 */
export function searchMedicineIndex(index: MedicineIndex, term: string, need: number, exclude: ReadonlySet<string> = new Set()): IndexSearchResult {
  if (term === "" || need <= 0) return { rows: [], matched: 0 };
  const brandRank = rankEntries(index.brandText, index.brandStarts, index.brands, term, 1, 2, 4);
  const genericRank = rankEntries(index.genericText, index.genericStarts, index.genericNames.length, term, 3, 3, 4);
  const buckets: number[][] = [[], [], [], [], []];
  let matched = 0;
  for (let p = 0; p < index.brands; p++) {
    let rank = brandRank[p]!;
    const g = index.genericOf[p]!;
    if (g >= 0) {
      const gr = genericRank[g]!;
      if (gr !== 0 && (rank === 0 || gr < rank)) rank = gr;
    }
    if (rank === 0) continue;
    if (exclude.size > 0 && exclude.has(index.lowerNames[p]!)) continue;
    if (matched < need) matched++;
    const bucket = buckets[rank]!;
    if (bucket.length < need) bucket.push(p);
    // Rank 1 is full: nothing later can come before these rows.
    if (rank === 1 && bucket.length >= need) break;
  }
  const rows: CdciMedicineHit[] = [];
  for (let r = 1; r <= 4 && rows.length < need; r++) {
    for (const p of buckets[r]!) {
      if (rows.length >= need) break;
      const g = index.genericOf[p]!;
      rows.push({
        id: index.ids[p]!,
        medicine_name: index.names[p]!,
        generic_name: g >= 0 ? index.genericNames[g]! : null,
        dose_form: index.forms[p]!,
        substance_ids: g >= 0 ? [...index.genericSubstances[g]!] : [],
      });
    }
  }
  return { rows, matched };
}
