import { NextResponse, type NextRequest } from "next/server";
import { CONTEXT_FAILURE_MESSAGE, resolveServiceContext } from "@/lib/auth/context";
import { getTodayBoard } from "@/features/today/queries";
import { resolveMode } from "@/features/today/schema";
import { clinicChangedResponse } from "@/lib/live/clinic-guard";
import { timedRoute } from "@/lib/observability/server-timing";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/today/board?mode=front|triage|doctor : Today's board for the client data layer (V2-09e 09E-03, R-14, T-09E-02, T-09E-04). The live
 * refresh of Today re-reads only this, never the page. Same read as the page's own (`getTodayBoard`), so a role sees exactly what it
 * saw before.
 * - Session → `resolveServiceContext("appointments:view")`; the clinic and the role come from the session, never from the query
 *   string (a `tenant` parameter is ignored); the read is on the user's own JWT client (RLS applies). No service-role client.
 * - `mode` is resolved for the role (`resolveMode`: an unknown or not-allowed mode becomes the role's own); the doctor's mode reads only
 *   that doctor's visits (the session's user, never a parameter).
 * - 401 unauthenticated, 403 without the permission or a membership, 403 `SUBSCRIPTION_LOCKED` for a locked or onboarding clinic,
 *   503 when Auth could not answer (never a sign-out), 500 when the database could not answer. Error bodies are fixed strings.
 * - 409 `CLINIC_CHANGED` (09E-14a) when the client's `x-clinicos-tenant` names another clinic than the session's (a tab left open across a switch); fixed body, after the
 *   permission check, before any read. The header only makes a read fail; the clinic is always the session's.
 * - 200 the board `{ rows, generatedAt, today, timeZone }`. `Cache-Control: private, no-store`; `Server-Timing` through `timedRoute`.
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
  const mode = resolveMode(ctx.role, request.nextUrl.searchParams.get("mode"));
  const result = await getTodayBoard(ctx, { mode, doctorId: mode === "doctor" ? ctx.userId : undefined });
  if (!result.ok) {
    return NextResponse.json({ error: "Today could not be loaded." }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json(result.board, { status: 200, headers: NO_STORE });
}

export const GET = timedRoute(handleGet);
