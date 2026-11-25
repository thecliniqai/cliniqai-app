import { NextResponse, type NextRequest } from "next/server";
import { CONTEXT_FAILURE_MESSAGE, resolveServiceContext } from "@/lib/auth/context";
import { CATALOGUE_PERMISSION, isCatalogue, isVersion, parseShardIndex } from "@/features/reference/catalogues";
import { getReferenceShard } from "@/features/reference/service";
import { hasPerm } from "@/lib/permissions";
import { timedRoute } from "@/lib/observability/server-timing";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
/** A shard URL names its version, and any write to a catalogue changes the version (000128): the answer never changes. Browser only (`private`). */
const IMMUTABLE = "private, max-age=31536000, immutable";

interface RouteContext {
  params: Promise<{ catalogue?: string; version?: string; shard?: string }>;
}

/**
 * GET /api/reference/{catalogue}/{version}/{shard} : one shard of a global reference catalogue for the device (V2-09e 09E-09, R-5).
 * - Session: an active member of a full clinic whose role holds the catalogue's permission (substances and diagnoses: consultations:view; medicines:
 *   prescriptions:edit); the clinic comes from the session. The read is `public.reference_shard` on the user's own JWT client (INVOKER; it checks the
 *   permission again). One database call, no server cache.
 * - 404 for an unknown catalogue, a version that is not a uuid, a shard that is not an index or is out of range; 409 `CATALOGUE_CHANGED` (`no-store`) when
 *   the version is not the current one (the device reads the manifest again); 401, 403, 403 `SUBSCRIPTION_LOCKED`, 503, 500 as every session route.
 * - 200 `{ catalogue, version, shard, shards, rows }` with `Cache-Control: private, max-age=31536000, immutable`: catalogue rows only, no PHI, nothing
 *   of any clinic. Sign-out's `Clear-Site-Data: "cache"` empties the browser's HTTP cache.
 */
async function handleGet(_request: NextRequest, { params }: RouteContext) {
  const resolved = await resolveServiceContext();
  if (!resolved.ok) {
    if (resolved.reason === "unauthenticated") return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (resolved.reason === "locked") return NextResponse.json({ error: resolved.error, code: "SUBSCRIPTION_LOCKED" }, { status: 403, headers: NO_STORE });
    if (resolved.reason === "unavailable") return NextResponse.json({ error: CONTEXT_FAILURE_MESSAGE }, { status: 503, headers: NO_STORE });
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }
  const { catalogue, version, shard: rawShard } = await params;
  const shard = parseShardIndex(rawShard);
  if (!isCatalogue(catalogue) || !isVersion(version) || shard === null) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  if (!hasPerm(resolved.ctx.role, CATALOGUE_PERMISSION[catalogue])) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });

  const result = await getReferenceShard(resolved.ctx, catalogue, shard);
  if (!result.ok) return NextResponse.json({ error: "The reference catalogue could not be read." }, { status: 500, headers: NO_STORE });
  if (result.value === null) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  if (result.value.version !== version) {
    return NextResponse.json({ error: "The catalogue changed.", code: "CATALOGUE_CHANGED" }, { status: 409, headers: NO_STORE });
  }
  return NextResponse.json(result.value, { status: 200, headers: { "Cache-Control": IMMUTABLE } });
}

export const GET = timedRoute(handleGet);
