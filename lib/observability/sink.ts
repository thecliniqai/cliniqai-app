/**
 * Error sink (V2-03 03-09b, P1-25, FT-07, ruling R-7). {@link reportRequestError} is what `instrumentation.ts`
 * `onRequestError` calls: it builds the scrubbed event, writes one `request.error` log line, and, when
 * `ERROR_INGEST_KEY` is set, POSTs the event to `public.ops_ingest_error` on the project's own Postgres (India-resident,
 * C39) with the publishable key. Plain `fetch`: no Supabase client factory and no service role (ADR-0005 D4 unchanged).
 *
 * It never throws and never waits more than {@link SINK_TIMEOUT_MS}: error reporting must not change the response.
 */
import "server-only";
import { deploymentInfo, serverEnv } from "@/lib/env-server";
import { errorTag, log } from "@/lib/log";
import { buildErrorEvent, type ErrorContext, type ErrorEvent, type ErrorRequest } from "./error-event";

export const SINK_TIMEOUT_MS = 2000;
export const INGEST_RPC_PATH = "/rest/v1/rpc/ops_ingest_error";

export type SinkOutcome = "sent" | "disabled" | "refused" | "failed" | "dropped";

/**
 * Flood bound (03-13d; review C L-1). The sink's row key (fingerprint) includes the scrubbed message, so one bug whose
 * text varies per request (positions, counts, ports) makes a new row per request and can use up the database's daily
 * cap of new fingerprints, blinding the sink for every other error that day. Per server instance and UTC day, one
 * (route, error name, code) may send at most {@link FLOOD_DISTINCT_PER_KEY} distinct messages; repeats of a message
 * already sent still go through (they only count). At most {@link FLOOD_MAX_KEYS} keys are tracked per day.
 */
export const FLOOD_DISTINCT_PER_KEY = 25;
export const FLOOD_MAX_KEYS = 1000;
const DAY_MS = 86_400_000;
let floodDay = -1;
const floodSeen = new Map<string, Set<string>>();
const floodLogged = new Set<string>();

/** Clears the per-instance flood state (tests). */
export function resetSinkFloodState(): void {
  floodDay = -1;
  floodSeen.clear();
  floodLogged.clear();
}

/** Whether `event` may be sent under the flood bound; records it when it may. */
export function admitToSink(event: ErrorEvent, now: number = Date.now()): boolean {
  const day = Math.floor(now / DAY_MS);
  if (day !== floodDay) {
    floodDay = day;
    floodSeen.clear();
    floodLogged.clear();
  }
  const key = `${event.route_path ?? "-"}|${event.error_name}|${event.error_code ?? "-"}`;
  const fingerprint = `${event.message}|${event.frames[0] ?? ""}`;
  let seen = floodSeen.get(key);
  if (!seen) {
    if (floodSeen.size >= FLOOD_MAX_KEYS) return false;
    seen = new Set();
    floodSeen.set(key, seen);
  }
  if (seen.has(fingerprint)) return true;
  if (seen.size >= FLOOD_DISTINCT_PER_KEY) return false;
  seen.add(fingerprint);
  return true;
}

/** Writes one event to the sink. Never throws. */
export async function sendErrorEvent(event: ErrorEvent, fetchImpl: typeof fetch = fetch): Promise<SinkOutcome> {
  let env;
  try {
    env = serverEnv();
  } catch {
    return "disabled";
  }
  if (!env.ERROR_INGEST_KEY) return "disabled";
  try {
    const url = new URL(INGEST_RPC_PATH, env.NEXT_PUBLIC_SUPABASE_URL);
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ p_ingest_key: env.ERROR_INGEST_KEY, p_event: event }),
      signal: AbortSignal.timeout(SINK_TIMEOUT_MS),
      cache: "no-store",
    });
    // The body is never read into a log: it could echo the event.
    await response.body?.cancel().catch(() => undefined);
    if (response.ok) return "sent";
    log.warn({ event: "observability.sink.refused", requestId: event.request_id ?? undefined, status: response.status });
    return "refused";
  } catch (err) {
    log.warn({ event: "observability.sink.failed", requestId: event.request_id ?? undefined, code: errorTag(err) });
    return "failed";
  }
}

/**
 * The `onRequestError` body: build, log, send. `root` is the repository root used for relative frame paths
 * (`process.cwd()` in a running server).
 */
export async function reportRequestError(
  err: unknown,
  request: ErrorRequest | undefined,
  context: ErrorContext | undefined,
  options: { root?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ event: ErrorEvent | null; outcome: SinkOutcome }> {
  let event: ErrorEvent;
  try {
    let environment: ErrorEvent["environment"] = "development";
    try {
      environment = serverEnv().APP_ENV;
    } catch {
      // An environment the schema refuses never booted in a deployment; keep the event, tier unknown → development.
    }
    event = buildErrorEvent(err, request, context, {
      environment,
      release: deploymentInfo().release,
      root: options.root ?? process.cwd(),
    });
  } catch {
    log.error({ event: "request.error", code: errorTag(err) });
    return { event: null, outcome: "failed" };
  }
  log.error({
    event: "request.error",
    requestId: event.request_id ?? undefined,
    route: event.route_path ?? undefined,
    code: event.error_code ?? event.error_name,
  });
  if (!admitToSink(event)) {
    const key = `${event.route_path ?? "-"}|${event.error_name}|${event.error_code ?? "-"}`;
    if (!floodLogged.has(key)) {
      floodLogged.add(key);
      log.warn({
        event: "observability.sink.flood_dropped",
        requestId: event.request_id ?? undefined,
        route: event.route_path ?? undefined,
        code: event.error_code ?? event.error_name,
      });
    }
    return { event, outcome: "dropped" };
  }
  const outcome = await sendErrorEvent(event, options.fetchImpl);
  return { event, outcome };
}
