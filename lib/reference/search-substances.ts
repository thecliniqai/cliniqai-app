import type { CatalogueRow } from "@/features/reference/catalogues";
import type { SubstanceHit } from "@/features/terminology/substances";

/**
 * The TypeScript twin of `public.search_substances` (000118, tie-break of 000128; V2-09e 09E-09, R-6). Same input, same ids, same order, same limit: the
 * parity spec (tests/reference/substance-search-parity.spec.ts) runs one case table against both. Rows are the catalogue's shard rows `[id, name]`.
 *
 * SQL, restated:
 *   limit = least(greatest(coalesce(p_limit, 12), 1), 30); term = lower(btrim(left(p_query, 60)))   -- btrim: spaces only; left: 60 characters
 *   rows whose lower(name) contains the term literally (LIKE '%' || escaped || '%')
 *   order by 0 when lower(btrim(name)) = term
 *            1 when lower(name) LIKE escaped || '%'       -- a literal prefix: %, _ and \ match themselves everywhere
 *            2 when lower(name) LIKE '% ' || escaped || '%'
 *            3 otherwise,
 *         then lower(name) COLLATE "C" (code point order), then id
 */
export const SUBSTANCE_TWIN_DEFAULT_LIMIT = 12;

/** First `n` characters (code points, as PostgreSQL's `left`). */
export function leftChars(text: string, n: number): string {
  return Array.from(text).slice(0, n).join("");
}

/** PostgreSQL's one-argument `btrim`: spaces only. */
export function btrimSpaces(text: string): string {
  return text.replace(/^ +| +$/g, "");
}

/** Code point order of two strings (UTF-8 byte order, i.e. `COLLATE "C"` for UTF-8 text). */
export function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

interface Ranked {
  id: string;
  name: string;
  rank: number;
  key: string;
}

/** The twin. `rows` are `[id, name]` rows; returns the hits as the route maps them (`{ id, name }`). */
export function searchSubstancesLocal(rows: readonly CatalogueRow[], query: string | null, limit: number | null = SUBSTANCE_TWIN_DEFAULT_LIMIT): SubstanceHit[] {
  const lim = Math.min(Math.max(limit ?? SUBSTANCE_TWIN_DEFAULT_LIMIT, 1), 30);
  const term = btrimSpaces(leftChars(query ?? "", 60)).toLowerCase();
  if (term === "") return [];
  const ranked: Ranked[] = [];
  for (const row of rows) {
    const id = row[0] as string;
    const name = row[1] as string;
    const lower = name.toLowerCase();
    if (!lower.includes(term)) continue;
    let rank = 3;
    if (btrimSpaces(name).toLowerCase() === term) rank = 0;
    else if (lower.startsWith(term)) rank = 1;
    else if (lower.includes(` ${term}`)) rank = 2;
    ranked.push({ id, name, rank, key: lower });
  }
  ranked.sort((a, b) => a.rank - b.rank || compareCodePoints(a.key, b.key) || compareCodePoints(a.id, b.id));
  return ranked.slice(0, lim).map(({ id, name }) => ({ id, name }));
}

/**
 * The query the server path would search for a typed value: the editor's `fetchSubstances` (trim, 60), the route (`cleanQuery`, 60, trim) and the service
 * (`cleanQuery`, 60, trim) in that order, so the device answers exactly what the route would have answered.
 */
export function substanceQueryOf(typed: string, clean: (q: string) => string): string {
  const sent = typed.trim().slice(0, 60);
  const routed = clean(sent).slice(0, 60).trim();
  return clean(routed).slice(0, 60).trim();
}
