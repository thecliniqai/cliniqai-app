import { NextResponse, type NextRequest } from "next/server";
import { CONTEXT_FAILURE_MESSAGE, resolveServiceContext } from "@/lib/auth/context";
import { searchPatients } from "@/features/patients/service";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/patients/search?q= : the patient typeahead of the picker and the command palette (V2-08 08-02, R-11, P1-30,
 * T-08-02). A route handler, not a server action: requests run in parallel and abort, so a slow search never queues
 * behind (or in front of) a save.
 * - Session → `resolveServiceContext("patients:view")`; the clinic comes from the session, never from the query string;
 *   the read is `public.search_patients` on the user's own JWT client (INVOKER: RLS applies). No service-role client.
 * - 401 unauthenticated, 403 without the permission or without a membership, 403 `SUBSCRIPTION_LOCKED` for a locked or
 *   onboarding clinic (the V2-05 refusal), 503 when Auth could not answer (never a sign-out), 500 when the database could
 *   not answer. Error bodies are fixed strings.
 * - 200 `{ patients: [{ id, name, ageSex, phoneLast4, lastVisit }] }`, at most 8, in rank order: no address, allergies, ABHA
 *   or full mobile number (`tests/patients/search-route.spec.ts` pins the keys). `Cache-Control: private, no-store`.
 * Rate limiting is V2-12 (accepted until then, T-08-02).
 */
export async function GET(request: NextRequest) {
  const resolved = await resolveServiceContext("patients:view");
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

  const query = request.nextUrl.searchParams.get("q") ?? "";
  const result = await searchPatients(resolved.ctx, query);
  if (!result.ok) {
    return NextResponse.json({ error: "Could not search patients." }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json({ patients: result.patients }, { status: 200, headers: NO_STORE });
}
