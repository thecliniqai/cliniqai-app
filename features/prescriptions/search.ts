/**
 * Medicine search, the browser's side (V2-09c 09C-01, R-3, R-5). No server-only import: the Rx entry row uses {@link fetchMedicines}; the route and the
 * service share the row type from `./schema`.
 *
 * Typeahead is a GET route handler, not a server action: requests run in parallel and abort (Next runs server actions through one queue, 08 R-11,
 * TARGET §3.9), so a slow search can never hold up an Rx command.
 */
import type { Medicine } from "@/lib/clinical/rx";
import { medicineFromSearch } from "./lines";
import { MEDICINE_QUERY_MAX, type MedicineSearchResult } from "./schema";

export const MEDICINE_SEARCH_PATH = "/api/prescriptions/medicines";

/** The route's answer was not a list of medicines (an error status, or a body of another shape). */
export class MedicineSearchError extends Error {
  constructor(readonly status: number) {
    super(`Medicine search failed (${status}).`);
    this.name = "MedicineSearchError";
  }
}

/**
 * Searches the CDCI catalogue and the calling doctor's own custom medicines. Aborting through `signal` rejects with the browser's `AbortError`; any other
 * failure rejects with {@link MedicineSearchError} or the network error, so the entry row shows "Couldn't search medicines".
 */
export async function fetchMedicines(query: string, signal?: AbortSignal): Promise<Medicine[]> {
  const q = query.trim().slice(0, MEDICINE_QUERY_MAX);
  if (q === "") return [];
  const response = await fetch(`${MEDICINE_SEARCH_PATH}?${new URLSearchParams({ q }).toString()}`, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new MedicineSearchError(response.status);
  const body = (await response.json()) as { results?: unknown };
  if (!Array.isArray(body.results)) throw new MedicineSearchError(response.status);
  return (body.results as MedicineSearchResult[]).map(medicineFromSearch);
}
