import type { CatalogueRow } from "@/features/reference/catalogues";
import { cleanQuery, expandQuery } from "@/features/terminology/abbreviations";
import { DIAGNOSIS_SEARCH_LIMIT, DIAGNOSIS_SEARCH_MIN_CHARS, DIAGNOSIS_SPECIALTIES, type DiagnosisHit, type DiagnosisSpecialty } from "@/features/terminology/search";
import { btrimSpaces, compareCodePoints, leftChars } from "./search-substances";
import { isSimilar, setSimilarity, trigrams } from "./trigram";

/**
 * The TypeScript twin of `public.search_diagnoses` (000114, tie-break of 000128; V2-09e 09E-10, R-6). Same terms, same rows in the same order, same
 * limit: the parity spec (tests/reference/diagnosis-search-parity.spec.ts) runs one case table against both. Catalogue rows are the shard's
 * `[id, name, icd11, snomed, chronic, specialties, synonyms]`; the doctor's own custom diagnoses come from the consult's query (R-8, memory only).
 *
 * SQL, restated:
 *   limit = least(greatest(coalesce(p_limit, 20), 1), 50); no terms (NULL) -> nothing
 *   terms = DISTINCT lower(btrim(left(t, 100))) of p_terms[1:8] WHERE char_length(btrim(t)) >= 2     -- btrim: spaces only
 *   custom (the caller's own): lower(name) contains a term literally OR similarity(lower(name), term) >= 0.3;  group 0, uses = use_count, rank 0
 *   catalogue: rank = the best over the terms of
 *     1 lower(name) = term; 2 lower(name) starts with term; 3 a synonym equals or starts with term; 4 a word of the name starts with term (' ' || term);
 *     5 the name contains term; 6 similarity(lower(name), term) >= 0.3 or similarity(lower(synonym), term) >= 0.3
 *   (%, _ and \ in a term are literal everywhere), kept when the specialty is NULL or among the row's specialties;  group 1, uses 0
 *   one row per lower(name): the custom one, else the best rank
 *   order by group, uses DESC, rank, lower(name) COLLATE "C"; limit
 *
 * Differences that are accepted and recorded (09E-NOTES): the device knows the doctor's 500 most used custom diagnoses (the consult's query), the database
 * all of them; a custom row's id is `custom:<name>` (the consult's query carries no id; the UI adds a diagnosis by its name); two rows with the same
 * lower-cased name, group and rank (the database keeps an arbitrary one) keep the smaller id here.
 */
export interface CustomDiagnosis {
  diagnosis_name: string;
  use_count: number;
}

export const DIAGNOSIS_TWIN_DEFAULT_LIMIT = 20;

interface Prepared {
  lowerName: string[];
  lowerSynonyms: string[][];
  nameTrigrams: (Set<string> | undefined)[];
  synonymTrigrams: (Set<string>[] | undefined)[];
}

const prepared = new WeakMap<readonly CatalogueRow[], Prepared>();

function prepare(rows: readonly CatalogueRow[]): Prepared {
  let p = prepared.get(rows);
  if (!p) {
    p = {
      lowerName: rows.map((r) => (r[1] as string).toLowerCase()),
      lowerSynonyms: rows.map((r) => (r[6] as string[]).map((s) => s.toLowerCase())),
      nameTrigrams: new Array(rows.length),
      synonymTrigrams: new Array(rows.length),
    };
    prepared.set(rows, p);
  }
  return p;
}

/** The terms the database searches for `p_terms`: distinct, lower-cased, at most the first 8 given, 2 or more characters after trimming spaces. */
export function diagnosisTerms(pTerms: readonly (string | null)[] | null): string[] | null {
  if (pTerms === null) return null;
  const out: string[] = [];
  for (const t of pTerms.slice(0, 8)) {
    if (t === null || Array.from(btrimSpaces(t)).length < 2) continue;
    const term = btrimSpaces(leftChars(t, 100)).toLowerCase();
    if (!out.includes(term)) out.push(term);
  }
  return out;
}

interface Candidate {
  hit: DiagnosisHit;
  key: string;
  grp: number;
  uses: number;
  rank: number;
}

/**
 * The twin. `pTerms` is `p_terms` as the service sends it ({@link diagnosisTermsOf}); `customs` the doctor's own list. Returns the rows as the route maps
 * them ({@link DiagnosisHit}).
 */
export function searchDiagnosesLocal(
  rows: readonly CatalogueRow[],
  customs: readonly CustomDiagnosis[],
  pTerms: readonly (string | null)[] | null,
  specialty: string | null = null,
  limit: number | null = DIAGNOSIS_TWIN_DEFAULT_LIMIT,
): DiagnosisHit[] {
  const lim = Math.min(Math.max(limit ?? DIAGNOSIS_TWIN_DEFAULT_LIMIT, 1), 50);
  const terms = diagnosisTerms(pTerms);
  if (terms === null || terms.length === 0) return [];
  const termTrigrams = terms.map((t) => trigrams(t));
  const byKey = new Map<string, Candidate>();
  const keep = (c: Candidate) => {
    const seen = byKey.get(c.key);
    if (!seen || c.grp < seen.grp || (c.grp === seen.grp && (c.rank < seen.rank || (c.rank === seen.rank && compareCodePoints(c.hit.id, seen.hit.id) < 0)))) {
      byKey.set(c.key, c);
    }
  };

  for (const custom of customs) {
    const lower = custom.diagnosis_name.toLowerCase();
    let match = terms.some((t) => lower.includes(t));
    if (!match) {
      const own = trigrams(lower);
      match = termTrigrams.some((tt) => isSimilar(setSimilarity(own, tt)));
    }
    if (!match) continue;
    keep({
      hit: { id: `custom:${custom.diagnosis_name}`, name: custom.diagnosis_name, icd11: null, snomed: null, chronic: false, custom: true },
      key: lower,
      grp: 0,
      uses: custom.use_count,
      rank: 0,
    });
  }

  const p = prepare(rows);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (specialty !== null && !(row[5] as string[]).includes(specialty)) continue;
    const name = p.lowerName[i]!;
    const synonyms = p.lowerSynonyms[i]!;
    let best = 7;
    for (let k = 0; k < terms.length && best > 1; k++) {
      const term = terms[k]!;
      let rank = 7;
      if (name === term) rank = 1;
      else if (name.startsWith(term)) rank = 2;
      else if (synonyms.some((s) => s === term || s.startsWith(term))) rank = 3;
      else if (name.includes(` ${term}`)) rank = 4;
      else if (name.includes(term)) rank = 5;
      else if (best > 6) {
        const nt = (p.nameTrigrams[i] ??= trigrams(name));
        if (isSimilar(setSimilarity(nt, termTrigrams[k]!))) rank = 6;
        else {
          const st = (p.synonymTrigrams[i] ??= synonyms.map((s) => trigrams(s)));
          if (st.some((s) => isSimilar(setSimilarity(s, termTrigrams[k]!)))) rank = 6;
        }
      }
      if (rank < best) best = rank;
    }
    if (best > 6) continue;
    keep({
      hit: {
        id: row[0] as string,
        name: row[1] as string,
        icd11: (row[2] as string | null) ?? null,
        snomed: (row[3] as string | null) ?? null,
        chronic: row[4] as boolean,
        custom: false,
      },
      key: name,
      grp: 1,
      uses: 0,
      rank: best,
    });
  }

  return [...byKey.values()]
    .sort((a, b) => a.grp - b.grp || b.uses - a.uses || a.rank - b.rank || compareCodePoints(a.key, b.key))
    .slice(0, lim)
    .map((c) => c.hit);
}

/**
 * The `p_terms` the server path sends for a typed value: the section's `fetchDiagnosisHits` (trim, 100), the route (`cleanQuery`, under 2 characters is
 * no search) and the service (`expandQuery` when the clinic has `assist.terminology`, else the cleaned query; under 2 characters is no search). `null`:
 * the server path makes no search (the answer is empty).
 */
export function diagnosisTermsOf(typed: string, expand: boolean): string[] | null {
  const sent = typed.trim();
  if (sent.length < DIAGNOSIS_SEARCH_MIN_CHARS) return null;
  const query = cleanQuery(sent.slice(0, 100));
  if (query.length < 2) return null;
  const terms = expand ? expandQuery(query) : [cleanQuery(query)];
  if (terms.length === 0 || terms[0]!.length < 2) return null;
  return terms;
}

/** The specialty the route passes on: one of the catalogue's specialties, else none. */
export function diagnosisSpecialtyOf(specialty: string | undefined | null): DiagnosisSpecialty | null {
  return specialty && (DIAGNOSIS_SPECIALTIES as readonly string[]).includes(specialty) ? (specialty as DiagnosisSpecialty) : null;
}

/** What the section asks of the device for a typed value: exactly what the route would answer. */
export function searchDiagnosesOnDevice(
  rows: readonly CatalogueRow[],
  customs: readonly CustomDiagnosis[],
  typed: string,
  opts: { expand: boolean; specialty?: string | null },
): DiagnosisHit[] {
  const terms = diagnosisTermsOf(typed, opts.expand);
  if (terms === null) return [];
  return searchDiagnosesLocal(rows, customs, terms, diagnosisSpecialtyOf(opts.specialty), DIAGNOSIS_SEARCH_LIMIT);
}
