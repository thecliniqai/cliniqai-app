import { NextResponse, type NextRequest } from "next/server";
import { CONTEXT_FAILURE_MESSAGE, resolveServiceContext } from "@/lib/auth/context";
import { readSessionBootstrap } from "@/features/session/queries";
import { clinicChangedResponse } from "@/lib/live/clinic-guard";
import { timedRoute } from "@/lib/observability/server-timing";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/session/bootstrap : the session bootstrap for the client data layer (V2-09e 09E-13, R-13, T-09E-10). The shell holds it in memory for the
 * session and reads it again here when the clinic's `settings` version moves (a signal or a check), on resume and on reconnect; a full load hydrates it from
 * the layout's own read instead.
 * - Session → `resolveServiceContext()`: any active member of the session's clinic, whatever the role; a locked or onboarding clinic is refused (its users
 *   are on the locked pages, outside the shell). The clinic comes from the session, never from the request (a `tenant` parameter is ignored); the read is
 *   `public.session_bootstrap` on the user's own JWT client (RLS applies, no service-role client).
 * - 401 unauthenticated, 403 no membership, 403 `SUBSCRIPTION_LOCKED`, 503 when Auth could not answer (never a sign-out), 500 when the database could not
 *   answer, 409 `CLINIC_CHANGED` when `x-clinicos-tenant` names another clinic than the session's (before the read). Fixed error bodies.
 * - 200 the allow-listed bootstrap `{ profile, clinic, role, doctors, clinics, rx_print, versions }` (zod strict: nothing else is ever answered).
 *   `private, no-store`; `Server-Timing` through `timedRoute`.
 */
async function handleGet(request: NextRequest) {
  const resolved = await resolveServiceContext();
  if (!resolved.ok) {
    if (resolved.reason === "unauthenticated") return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (resolved.reason === "locked") {
      return NextResponse.json({ error: resolved.error, code: "SUBSCRIPTION_LOCKED" }, { status: 403, headers: NO_STORE });
    }
    if (resolved.reason === "unavailable") return NextResponse.json({ error: CONTEXT_FAILURE_MESSAGE }, { status: 503, headers: NO_STORE });
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }
  const changed = clinicChangedResponse(request, resolved.ctx.tenantId, NO_STORE);
  if (changed) return changed;
  const bootstrap = await readSessionBootstrap(resolved.ctx.db, resolved.ctx.tenantId);
  if (!bootstrap) return NextResponse.json({ error: "The session could not be loaded." }, { status: 500, headers: NO_STORE });
  return NextResponse.json(bootstrap, { status: 200, headers: NO_STORE });
}

export const GET = timedRoute(handleGet);
