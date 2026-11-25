import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { CONTEXT_FAILURE_MESSAGE, resolveServiceContext } from "@/lib/auth/context";
import { getReferenceManifest } from "@/features/reference/service";
import { timedRoute } from "@/lib/observability/server-timing";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const REVALIDATE = "private, no-cache";

/**
 * GET /api/reference/manifest : which global reference catalogues the caller may hold on the device, and their versions (V2-09e 09E-09, R-5).
 * - Session only: an active member of a full clinic (`resolveServiceContext()`); the clinic and role come from the session, never from the request. The
 *   catalogues listed are the ones the role's permissions read (substances and diagnoses: consultations:view; medicines: prescriptions:edit); a role
 *   with none gets `{ catalogues: {} }`.
 * - One database call (`reference_catalogues`, global, no PHI), no server cache (PO 2026-11-23). `Cache-Control: private, no-cache` with an ETag: the
 *   browser revalidates every time (304 when nothing changed, still one call to know).
 * - 401 unauthenticated, 403 no membership, 403 `SUBSCRIPTION_LOCKED`, 503 when Auth could not answer, 500 when the database could not answer; fixed bodies,
 *   `no-store`.
 * - 200 `{ catalogues: { <name>: { version, shards } } }` (`shards` null for medicines: shard 0 says how many).
 */
async function handleGet(request: NextRequest) {
  const resolved = await resolveServiceContext();
  if (!resolved.ok) {
    if (resolved.reason === "unauthenticated") return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (resolved.reason === "locked") return NextResponse.json({ error: resolved.error, code: "SUBSCRIPTION_LOCKED" }, { status: 403, headers: NO_STORE });
    if (resolved.reason === "unavailable") return NextResponse.json({ error: CONTEXT_FAILURE_MESSAGE }, { status: 503, headers: NO_STORE });
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }
  const manifest = await getReferenceManifest(resolved.ctx);
  if (!manifest.ok) return NextResponse.json({ error: "The reference catalogues could not be read." }, { status: 500, headers: NO_STORE });
  const body = JSON.stringify(manifest.value);
  const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
  const headers = { "Cache-Control": REVALIDATE, ETag: etag, "Content-Type": "application/json" };
  if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers: { "Cache-Control": REVALIDATE, ETag: etag } });
  return new NextResponse(body, { status: 200, headers });
}

export const GET = timedRoute(handleGet);
