import { NextResponse, type NextRequest } from "next/server";
import { CONTEXT_FAILURE_MESSAGE, resolveServiceContext } from "@/lib/auth/context";
import { cleanQuery } from "@/features/terminology/abbreviations";
import { searchMedicines } from "@/features/prescriptions/service";
import { MEDICINE_QUERY_MAX, MEDICINE_SEARCH_LIMIT } from "@/features/prescriptions/schema";
import { timedRoute } from "@/lib/observability/server-timing";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/prescriptions/medicines?q=&limit= : the Rx builder's medicine typeahead (V2-09c 09C-01, R-3, T-09C-03). A route handler, not a server action: requests
 * run in parallel and abort per keystroke, so a slow search never queues behind (or in front of) an Rx command (08 R-11, TARGET §3.9).
 * - Session → `resolveServiceContext("prescriptions:edit")` (Q-13: the people who prescribe); the clinic and the doctor come from the session, never from the query
 *   string. The read is `public.search_medicines` on the user's own JWT client (INVOKER: RLS applies; the database applies the doctor's own custom medicines
 *   only). No service-role client. `q` is data: it goes to the database as a parameter, never as SQL text, and `%`, `_` and `\` in it match themselves.
 * - 401 unauthenticated, 403 without the permission or without a membership, 403 `SUBSCRIPTION_LOCKED` for a locked or onboarding clinic (the V2-05 refusal),
 *   503 when Auth could not answer (never a sign-out), 500 when the database could not answer. Error bodies are fixed strings.
 * - 200 `{ results: [{ id, kind, medicine_name, generic_name, dose_form, substance_ids, dosage, timing, duration }] }`, at most 15, in rank order: the doctor's own
 *   custom medicines first, then the catalogue. A custom row carries the doctor's stored dose; a catalogue row never carries a dosage, a timing or a duration.
 *   `tests/prescriptions/medicine-search-route.spec.ts` pins the keys. `Cache-Control: private, no-store`.
 * Rate limiting is V2-12 (accepted until then, as T-08-02).
 */
async function handleGet(request: NextRequest) {
  const resolved = await resolveServiceContext("prescriptions:edit");
  if (!resolved.ok) {
    if (resolved.reason === "unauthenticated") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    if (resolved.reason === "forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
    }
    if (resolved.reason === "locked") {
      return NextResponse.json({ error: resolved.error, code: "SUBSCRIPTION_LOCKED" }, { status: 403, headers: NO_STORE });
    }
    // 06-09d: Supabase Auth could not answer: 503, never 401 (no sign-out during an Auth incident).
    if (resolved.reason === "unavailable") {
      return NextResponse.json({ error: CONTEXT_FAILURE_MESSAGE }, { status: 503, headers: NO_STORE });
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }

  const query = cleanQuery(request.nextUrl.searchParams.get("q") ?? "").slice(0, MEDICINE_QUERY_MAX).trim();
  if (query.length < 1) return NextResponse.json({ results: [] }, { status: 200, headers: NO_STORE });
  const requested = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(requested) && requested >= 1 ? Math.min(Math.trunc(requested), MEDICINE_SEARCH_LIMIT) : MEDICINE_SEARCH_LIMIT;

  const result = await searchMedicines(resolved.ctx, query, limit);
  if (!result.success) {
    return NextResponse.json({ error: "Could not search medicines." }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json({ results: result.results }, { status: 200, headers: NO_STORE });
}

/** V2-09e 09E-02 (R-20): the answer carries `Server-Timing` and the request writes its `request.timing` line. */
export const GET = timedRoute(handleGet);
