import { NextResponse, type NextRequest } from "next/server";
import { CONTEXT_FAILURE_MESSAGE, resolveServiceContext } from "@/lib/auth/context";
import { getScheduleRange } from "@/features/schedule/queries";
import { isRangeOk } from "@/features/schedule/range";
import { clinicChangedResponse } from "@/lib/live/clinic-guard";
import { timedRoute } from "@/lib/observability/server-timing";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/schedule/range?from=YYYY-MM-DD&to=YYYY-MM-DD[&slots=0] : the Schedule of a range of clinic dates for the client data layer (V2-09e 09E-12, R-10,
 * T-09E-02). The Schedule's day and week changes, its prefetch of the adjacent range and its live re-reads are this one read, never the page.
 * - Session → `resolveServiceContext("appointments:view")`; the clinic and the role come from the session, never from the query string (a `tenant`
 *   parameter is ignored); the read is on the user's own JWT client (RLS applies). No service-role client.
 * - `from` and `to` are clinic dates, in order, at most 42 days (400 `INVALID_RANGE` otherwise, fixed body, before any read); `slots=0` leaves the free
 *   slots out (a month grid needs counts, not slots); anything else includes them.
 * - 401 unauthenticated, 403 without the permission or a membership, 403 `SUBSCRIPTION_LOCKED` for a locked or onboarding clinic, 503 when Auth could not
 *   answer (never a sign-out), 500 when the database could not answer. 403 `ACCESS_REFUSED` when the database refused the read after the session check
 *   (a permission, access or active-clinic change in between; PR 2 review N5: not an outage, logged at info). 409 `CLINIC_CHANGED` when the client's `x-clinicos-tenant` names another clinic than
 *   the session's (after the permission check, before any read). Error bodies are fixed strings.
 * - 200 the range `{ from, to, zone, server_now, versions, clinicians, blocks, visits, waitlist, slots? }`. `Cache-Control: private, no-store` (patient
 *   names); `Server-Timing` through `timedRoute`.
 */
async function handleGet(request: NextRequest) {
  const resolved = await resolveServiceContext("appointments:view");
  if (!resolved.ok) {
    if (resolved.reason === "unauthenticated") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    if (resolved.reason === "locked") {
      return NextResponse.json({ error: resolved.error, code: "SUBSCRIPTION_LOCKED" }, { status: 403, headers: NO_STORE });
    }
    if (resolved.reason === "unavailable") {
      return NextResponse.json({ error: CONTEXT_FAILURE_MESSAGE }, { status: 503, headers: NO_STORE });
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }

  const ctx = resolved.ctx;
  const changed = clinicChangedResponse(request, ctx.tenantId, NO_STORE);
  if (changed) return changed;
  const params = request.nextUrl.searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (!isRangeOk(from, to)) {
    return NextResponse.json({ error: "The range is not valid.", code: "INVALID_RANGE" }, { status: 400, headers: NO_STORE });
  }
  const result = await getScheduleRange(ctx, { from, to, withSlots: params.get("slots") !== "0" });
  if (!result.ok) {
    if (result.reason === "refused") {
      return NextResponse.json({ error: "Forbidden", code: "ACCESS_REFUSED" }, { status: 403, headers: NO_STORE });
    }
    return NextResponse.json({ error: "The schedule could not be loaded." }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json(result.range, { status: 200, headers: NO_STORE });
}

export const GET = timedRoute(handleGet);
