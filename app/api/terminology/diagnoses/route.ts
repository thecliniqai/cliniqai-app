import { NextResponse, type NextRequest } from "next/server";
import { CONTEXT_FAILURE_MESSAGE, resolveServiceContext } from "@/lib/auth/context";
import { activeEntitlements } from "@/lib/entitlements/require-entitlement";
import { cleanQuery } from "@/features/terminology/abbreviations";
import { searchDiagnoses } from "@/features/terminology/service";
import { DIAGNOSIS_SEARCH_LIMIT, DIAGNOSIS_SPECIALTIES, type DiagnosisSpecialty } from "@/features/terminology/search";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/terminology/diagnoses?q=&specialty= : the consult's diagnosis typeahead (V2-09b 09B-04a, R-11, AI-07, T-09B-06). A route handler, not a
 * server action: requests run in parallel and abort, so a slow search never queues behind (or in front of) a draft save (08 R-11, TARGET §3.9).
 * - Session → `resolveServiceContext("consultations:view")`; the clinic and the doctor come from the session, never from the query string. The read is
 *   `public.search_diagnoses` on the user's own JWT client (INVOKER: RLS applies; the database applies the doctor's own custom diagnoses only). No
 *   service-role client. `q` and `specialty` are data: the terms go to the database as a parameter array, never as SQL text, and `%`, `_` and `\` in
 *   them match themselves.
 * - The abbreviation expansion (HTN, T2DM, URTI, ...) applies only when the clinic is entitled to `assist.terminology`, resolved here from the session
 *   (`activeEntitlements`); not entitled, the typed words are searched as typed.
 * - 401 unauthenticated, 403 without the permission or without a membership, 403 `SUBSCRIPTION_LOCKED` for a locked or onboarding clinic (the V2-05
 *   refusal), 503 when Auth could not answer (never a sign-out), 500 when the database could not answer. Error bodies are fixed strings.
 * - 200 `{ results: [{ id, name, icd11, snomed, chronic, custom }] }`, at most 12, in rank order: the doctor's own custom diagnoses first, then the
 *   catalogue. `tests/terminology/diagnosis-search-route.spec.ts` pins the keys. `Cache-Control: private, no-store`.
 * Rate limiting is V2-12 (accepted until then, as T-08-02).
 */
export async function GET(request: NextRequest) {
  const resolved = await resolveServiceContext("consultations:view");
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

  const query = cleanQuery(request.nextUrl.searchParams.get("q") ?? "");
  if (query.length < 2) return NextResponse.json({ results: [] }, { status: 200, headers: NO_STORE });
  const requested = request.nextUrl.searchParams.get("specialty");
  const specialty = (DIAGNOSIS_SPECIALTIES as readonly string[]).includes(requested ?? "") ? (requested as DiagnosisSpecialty) : undefined;

  let expand = false;
  try {
    expand = (await activeEntitlements()).get("assist.terminology")?.enabled === true;
  } catch {
    // no Smart Assist expansion for this clinic: the typed words are searched
  }

  const result = await searchDiagnoses(resolved.ctx, { query, specialty, limit: DIAGNOSIS_SEARCH_LIMIT, expand });
  if (!result.success) {
    return NextResponse.json({ error: "Could not search diagnoses." }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json({ results: result.results }, { status: 200, headers: NO_STORE });
}
