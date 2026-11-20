/**
 * Patient search, the browser's side and the shapes both sides share (V2-08 08-02, R-11, P1-30). No server-only import:
 * client components use {@link fetchPatientHits}, the route and the service use the types.
 *
 * Typeahead is a GET route handler, not a server action: requests run in parallel and abort (Next runs server actions
 * through one queue, `lib/commands/use-command.ts`), so a slow search can never hold up a save. The route answers the
 * minimal projection {@link PatientHit} (`tests/patients/search-route.spec.ts` pins the exact keys): no address, allergies,
 * ABHA or full mobile number.
 */

export const PATIENT_SEARCH_PATH = "/api/patients/search";
/** Rows per search (the database function caps its limit at 25). */
export const PATIENT_SEARCH_LIMIT = 8;
/** The shortest queries the database answers: two letters or three digits. */
export const PATIENT_SEARCH_MIN_LETTERS = 2;
export const PATIENT_SEARCH_MIN_DIGITS = 3;

export type PatientSex = "M" | "F" | "O";

/** What a picker, the palette and the duplicate list show of a patient. `lastVisit` is a clinic-local `YYYY-MM-DD`. */
export interface PatientHit {
  id: string;
  name: string;
  ageSex: { age: string | null; sex: PatientSex | null } | null;
  /** The last four digits of the mobile number only. */
  phoneLast4: string | null;
  lastVisit: string | null;
}

/** The keys of {@link PatientHit}, in order (the route spec compares against this). */
export const PATIENT_HIT_KEYS = ["id", "name", "ageSex", "phoneLast4", "lastVisit"] as const;

export const DUPLICATE_REASONS = ["same_mobile", "same_name_dob", "same_name_age"] as const;
export type DuplicateReason = (typeof DUPLICATE_REASONS)[number];

/** True when the database would answer this query (two letters or three digits; wildcards and punctuation do not count). */
export function isSearchableQuery(query: string): boolean {
  const q = query.replace(/[,()%_*\\]/g, " ").trim();
  const digits = q.replace(/\D/g, "").length;
  const letters = q.replace(/[\d\s\p{P}\p{S}]/gu, "").length;
  return letters >= PATIENT_SEARCH_MIN_LETTERS || digits >= PATIENT_SEARCH_MIN_DIGITS;
}

/** The route's answer was not a list of patients (an error status, or a body of another shape). */
export class PatientSearchError extends Error {
  constructor(readonly status: number) {
    super(`Patient search failed (${status}).`);
    this.name = "PatientSearchError";
  }
}

/**
 * Searches the caller's clinic. Aborting through `signal` rejects with the browser's `AbortError`; any other failure
 * rejects with {@link PatientSearchError} or the network error, so callers show "Couldn't search patients".
 */
export async function fetchPatientHits(query: string, signal?: AbortSignal): Promise<PatientHit[]> {
  const q = query.trim();
  if (!isSearchableQuery(q)) return [];
  const response = await fetch(`${PATIENT_SEARCH_PATH}?q=${encodeURIComponent(q.slice(0, 100))}`, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new PatientSearchError(response.status);
  const body = (await response.json()) as { patients?: unknown };
  if (!Array.isArray(body.patients)) throw new PatientSearchError(response.status);
  return body.patients as PatientHit[];
}
