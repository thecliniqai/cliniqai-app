import { NextResponse, type NextRequest } from "next/server";
import { CONTEXT_FAILURE_MESSAGE, resolveServiceContext } from "@/lib/auth/context";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { deploymentInfo, serverEnv } from "@/lib/env-server";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { RUM_MAX_BODY_BYTES } from "@/lib/observability/rum/catalog";
import { rumBatchLimiter, rumBatchSchema } from "@/lib/observability/rum/ingest";
import { timedRoute } from "@/lib/observability/server-timing";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

function appOrigin(): string | null {
  try {
    return new URL(serverEnv().NEXT_PUBLIC_APP_URL).origin;
  } catch {
    return null;
  }
}

/**
 * POST /api/rum : the browser's real-user timings (V2-09e 09E-02, R-20, T-09E-14, T-09E-15). Batches of at most 60 samples, each a closed-list
 * `{ screen, metric, device, net, value }` (`lib/observability/rum/ingest.ts`), added to the histograms of `ops.rum_daily` through
 * `public.ops_ingest_rum` on the caller's own JWT client (no service role). Nothing identifying is stored: tenant and user are used only to
 * authenticate and rate-limit, never written.
 * - Same origin only (a cross-origin call is 403: `sendBeacon` and `fetch` from the app send `Origin`); session required, any active member of a
 *   clinic whatever its access level (a locked clinic's screens are measured too): 401 unauthenticated, 403 no membership, 503 when Auth could not answer.
 * - Body at most 8 kB (413), JSON in the strict shape (400: an unknown key, a value outside a closed list, a non-number, a uuid or a `/` where a
 *   word belongs), 429 past 10 batches a minute per user.
 * - The environment and release come from the server's deployment info, never from the browser.
 * - 204, `Cache-Control: private, no-store`. Error bodies are fixed strings.
 */
async function handlePost(request: NextRequest) {
  if (!isSameOriginRequest(request.headers, appOrigin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }
  const resolved = await resolveServiceContext(undefined, "billing");
  if (!resolved.ok) {
    if (resolved.reason === "unauthenticated") return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (resolved.reason === "unavailable") return NextResponse.json({ error: CONTEXT_FAILURE_MESSAGE }, { status: 503, headers: NO_STORE });
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > RUM_MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Too large" }, { status: 413, headers: NO_STORE });
  }
  if (!rumBatchLimiter.allow(resolved.ctx.userId)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: NO_STORE });
  }
  // The declared length can be missing or wrong: the body is read with its own bound.
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > RUM_MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Too large" }, { status: 413, headers: NO_STORE });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });
  }
  const parsed = rumBatchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });
  if (parsed.data.samples.length === 0) return new NextResponse(null, { status: 204, headers: NO_STORE });

  let environment: string = "development";
  try {
    environment = serverEnv().APP_ENV;
  } catch {
    // An environment the schema refuses never booted in a deployment: keep the sample under the default tier.
  }
  const { error } = await resolved.ctx.db.rpc("ops_ingest_rum", {
    p_environment: environment,
    p_release: deploymentInfo().release ?? "",
    p_samples: parsed.data.samples,
  });
  if (error) {
    log.error({ event: "rum.ingest.failed", code: errorTag(error), requestId: await getRequestId() });
    return NextResponse.json({ error: "Could not record timings." }, { status: 500, headers: NO_STORE });
  }
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}

export const POST = timedRoute(handlePost);
