import { NextResponse, type NextRequest } from "next/server";
import { CONTEXT_FAILURE_MESSAGE, resolveServiceContext } from "@/lib/auth/context";
import { cleanQuery } from "@/features/terminology/abbreviations";
import { searchSubstances } from "@/features/terminology/service";
import { SUBSTANCE_QUERY_MAX, SUBSTANCE_SEARCH_LIMIT } from "@/features/terminology/substances";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/terminology/substances?q= : the allergy editor's substance typeahead (V2-09c 09C-02, R-6, SA-07). A route handler, not a server action: it aborts
 * with each keystroke and runs beside other commands (08 R-11, TARGET §3.9).
 * - Session → `resolveServiceContext("consultations:view")` (the roles that record and read allergies; a receptionist has no consultations:view); the clinic
 *   comes from the session, never from the query string. The read is `public.search_substances` on the user's own JWT client (INVOKER). `q` is data: `%`,
 *   `_` and `\` in it match themselves.
 * - 401 unauthenticated, 403 without the permission or a membership, 403 `SUBSCRIPTION_LOCKED`, 503 when Auth could not answer (never a sign-out), 500 when
 *   the database could not answer. Error bodies are fixed strings.
 * - 200 `{ results: [{ id, name }] }`, at most 12, in rank order. `Cache-Control: private, no-store`. Rate limiting is V2-12 (accepted until then, T-09C-13).
 */
export async function GET(request: NextRequest) {
  const resolved = await resolveServiceContext("consultations:view");
  if (!resolved.ok) {
    if (resolved.reason === "unauthenticated") return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (resolved.reason === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
    if (resolved.reason === "locked") return NextResponse.json({ error: resolved.error, code: "SUBSCRIPTION_LOCKED" }, { status: 403, headers: NO_STORE });
    if (resolved.reason === "unavailable") return NextResponse.json({ error: CONTEXT_FAILURE_MESSAGE }, { status: 503, headers: NO_STORE });
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }
  const query = cleanQuery(request.nextUrl.searchParams.get("q") ?? "").slice(0, SUBSTANCE_QUERY_MAX).trim();
  if (query.length < 1) return NextResponse.json({ results: [] }, { status: 200, headers: NO_STORE });
  const result = await searchSubstances(resolved.ctx, query, SUBSTANCE_SEARCH_LIMIT);
  if (!result.success) return NextResponse.json({ error: "Could not search substances." }, { status: 500, headers: NO_STORE });
  return NextResponse.json({ results: result.results }, { status: 200, headers: NO_STORE });
}
