import { NextResponse, type NextRequest } from "next/server";
import { CONTEXT_FAILURE_MESSAGE, resolveServiceContext } from "@/lib/auth/context";
import { readLiveSnapshot } from "@/lib/live/server";
import { clinicChangedResponse } from "@/lib/live/clinic-guard";
import { timedRoute } from "@/lib/observability/server-timing";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/live/state : the clinic's four versions and its access level (V2-09e 09E-04, R-18, T-09E-05). The heartbeat of the live screens (every 12 s
 * while one is visible), the check on (re)subscribe, on a visible tab, on `online` and on resume, and the way a device whose Realtime was refused still
 * converges within about 15 s.
 * - Session only: any active member of the session's clinic, whatever the role and whatever the clinic's access level (a locked clinic's device must learn
 *   it: `access` is not `full`, and the client takes the existing lock path). The clinic comes from the session, never from the request (a `tenant`
 *   parameter is ignored); the read is `public.clinic_live_state` on the user's own JWT client (RLS applies, no service-role client).
 * - 401 unauthenticated, 403 no membership, 503 when Auth could not answer (never a sign-out), 500 when the database could not answer. Fixed error bodies.
 * - 409 `CLINIC_CHANGED` (09E-14a) when `x-clinicos-tenant` names another clinic than the session's; fixed body, no data.
 * - 200 `{ versions: { schedule, queue, billing, settings }, access }`: numbers and one word, no id, no name, no PHI. `private, no-store`;
 *   `Server-Timing` through `timedRoute`.
 */
async function handleGet(request: NextRequest) {
  const resolved = await resolveServiceContext(undefined, "billing");
  if (!resolved.ok) {
    if (resolved.reason === "unauthenticated") return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (resolved.reason === "unavailable") return NextResponse.json({ error: CONTEXT_FAILURE_MESSAGE }, { status: 503, headers: NO_STORE });
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }
  const changed = clinicChangedResponse(request, resolved.ctx.tenantId, NO_STORE);
  if (changed) return changed;
  const snapshot = await readLiveSnapshot(resolved.ctx);
  if (!snapshot) return NextResponse.json({ error: "The live state could not be read." }, { status: 500, headers: NO_STORE });
  return NextResponse.json(snapshot, { status: 200, headers: NO_STORE });
}

export const GET = timedRoute(handleGet);
