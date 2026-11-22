/**
 * CDCI substance search for the allergy editor, the browser's side and the shapes both sides share (V2-09c 09C-02, R-6). No server-only import: the
 * editor's combobox uses {@link fetchSubstances}; the route and the service use the types. A GET route handler, not a server action (it aborts with each
 * keystroke, 08 R-11, TARGET §3.9).
 */
export const SUBSTANCE_SEARCH_PATH = "/api/terminology/substances";
export const SUBSTANCE_SEARCH_LIMIT = 12;
export const SUBSTANCE_QUERY_MAX = 60;

export interface SubstanceHit {
  id: string;
  name: string;
}
/** The keys of {@link SubstanceHit}, in order (the route spec and the guard manifest compare against this). */
export const SUBSTANCE_HIT_KEYS = ["id", "name"] as const;

export class SubstanceSearchError extends Error {
  constructor(readonly status: number) {
    super(`Substance search failed (${status}).`);
    this.name = "SubstanceSearchError";
  }
}

export async function fetchSubstances(query: string, signal?: AbortSignal): Promise<SubstanceHit[]> {
  const q = query.trim().slice(0, SUBSTANCE_QUERY_MAX);
  if (q === "") return [];
  const response = await fetch(`${SUBSTANCE_SEARCH_PATH}?${new URLSearchParams({ q }).toString()}`, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new SubstanceSearchError(response.status);
  const body = (await response.json()) as { results?: unknown };
  if (!Array.isArray(body.results)) throw new SubstanceSearchError(response.status);
  return body.results as SubstanceHit[];
}
