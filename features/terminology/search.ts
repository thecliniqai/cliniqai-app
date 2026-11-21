/**
 * Diagnosis search, the browser's side and the shapes both sides share (V2-09b 09B-04a, R-11, AI-07). No server-only import: the consult's combobox uses
 * {@link fetchDiagnosisHits}; the route and the service use the types.
 *
 * Typeahead is a GET route handler, not a server action: requests run in parallel and abort (Next runs server actions through one queue, 08 R-11,
 * TARGET §3.9), so a slow search can never hold up a draft save. The route answers the minimal projection {@link DiagnosisHit}
 * (`tests/terminology/diagnosis-search-route.spec.ts` pins the exact keys).
 */

export const DIAGNOSIS_SEARCH_PATH = "/api/terminology/diagnoses";
/** Rows per search (the database function caps its limit at 50). */
export const DIAGNOSIS_SEARCH_LIMIT = 12;
export const DIAGNOSIS_SEARCH_MIN_CHARS = 2;

export const DIAGNOSIS_SPECIALTIES = ["general_physician", "dental", "pediatrics"] as const;
export type DiagnosisSpecialty = (typeof DIAGNOSIS_SPECIALTIES)[number];

/** What the combobox shows and adds of a diagnosis: the catalogue's (ICD-11 code, SNOMED id, chronic flag) or the doctor's own custom one. */
export interface DiagnosisHit {
  id: string;
  name: string;
  icd11: string | null;
  snomed: string | null;
  chronic: boolean;
  custom: boolean;
}

/** The keys of {@link DiagnosisHit}, in order (the route spec compares against this). */
export const DIAGNOSIS_HIT_KEYS = ["id", "name", "icd11", "snomed", "chronic", "custom"] as const;

/** The route's answer was not a list of diagnoses (an error status, or a body of another shape). */
export class DiagnosisSearchError extends Error {
  constructor(readonly status: number) {
    super(`Diagnosis search failed (${status}).`);
    this.name = "DiagnosisSearchError";
  }
}

/**
 * Searches the caller's catalogue and own custom diagnoses. Aborting through `signal` rejects with the browser's `AbortError`; any other failure rejects
 * with {@link DiagnosisSearchError} or the network error, so the caller shows "Couldn't search diagnoses".
 */
export async function fetchDiagnosisHits(query: string, specialty: DiagnosisSpecialty | undefined, signal?: AbortSignal): Promise<DiagnosisHit[]> {
  const q = query.trim();
  if (q.length < DIAGNOSIS_SEARCH_MIN_CHARS) return [];
  const params = new URLSearchParams({ q: q.slice(0, 100) });
  if (specialty) params.set("specialty", specialty);
  const response = await fetch(`${DIAGNOSIS_SEARCH_PATH}?${params.toString()}`, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new DiagnosisSearchError(response.status);
  const body = (await response.json()) as { results?: unknown };
  if (!Array.isArray(body.results)) throw new DiagnosisSearchError(response.status);
  return body.results as DiagnosisHit[];
}
