/**
 * Client render errors into the error sink (V2-06 06-04a, ruling R-3; V2-03 R-29 carry-over; threats T-06-09, T-06-10).
 *
 * A route error boundary (`components/shell/route-error.tsx`) reports an uncaught render error through the
 * `reportClientRenderError` server action with two values only: the error's class name and the route **pattern** the
 * browser computed. This module turns them into the closed `ops.error_events` shape (`ErrorEvent`) and decides what
 * may be stored:
 *
 * - `error_name` is `client.` + the name as {@link errorNameOf} keeps it (NAME_PATTERN, nothing identifier-shaped),
 *   else `client.Error`; a stored name never exceeds the 80 characters the database keeps.
 * - `route_path` is the input as {@link routePattern} keeps it; a value with a query or fragment, a concrete segment
 *   (UUID-shaped, 6+ digits, an `@`) or anything `routePattern` refuses is replaced by {@link CLIENT_ROUTE_FALLBACK}.
 * - `message` is `""` and `frames` is `[]`: the browser's message and stack never leave it. `digest`, `method` and
 *   `request_id` are null (a digest error was already recorded by the server's `onRequestError`).
 *
 * {@link admitClientKey} bounds what clients can spend of the sink: per server instance and UTC day at most
 * {@link CLIENT_KEYS_PER_DAY} distinct (route, name) keys from clients, so a member sending made-up names cannot use up
 * the database's daily new-fingerprint cap (500) and blind the sink to server errors. Pure apart from that counter.
 */
import type { AppEnv } from "@/lib/env";
import { errorNameOf, type ErrorEvent } from "./error-event";
import { routePattern } from "./scrub";

export const CLIENT_NAME_PREFIX = "client.";
/** Input bounds the action's schema enforces. */
export const MAX_CLIENT_NAME = 80;
export const MAX_CLIENT_ROUTE = 200;
/** What a refused route is stored as: the root of the route groups. */
export const CLIENT_ROUTE_FALLBACK = "/" as const;
/** The database keeps error names of at most 80 characters (NAME_PATTERN); a longer one would become `Error`. */
const MAX_STORED_NAME = 80;
const UUID_SHAPED = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const IDENTIFIER_SHAPED = /\d{6,}|@/;

/** The stored error name for a client-reported class name. */
export function clientErrorName(name: unknown): string {
  const safe = errorNameOf({ name }) ?? "Error";
  const stored = `${CLIENT_NAME_PREFIX}${safe}`;
  return stored.length <= MAX_STORED_NAME ? stored : `${CLIENT_NAME_PREFIX}Error`;
}

/** The stored route for a client-reported route pattern; anything concrete or malformed becomes the fallback. */
export function clientRoutePattern(route: unknown): `/${string}` {
  if (typeof route !== "string" || /[?#]/.test(route)) return CLIENT_ROUTE_FALLBACK;
  const pattern = routePattern(route);
  if (!pattern) return CLIENT_ROUTE_FALLBACK;
  for (const segment of pattern.slice(1).split("/")) {
    if (UUID_SHAPED.test(segment) || IDENTIFIER_SHAPED.test(segment)) return CLIENT_ROUTE_FALLBACK;
  }
  return pattern;
}

export interface ClientRenderReport {
  name: string;
  route: string;
}

export interface ClientEventMeta {
  environment: AppEnv;
  release: string | null;
}

/** The stored event for one client render error. Never throws. */
export function buildClientRenderEvent(report: ClientRenderReport, meta: ClientEventMeta): ErrorEvent {
  return {
    environment: meta.environment,
    release: meta.release && /^[0-9a-f]{7,40}$/.test(meta.release) ? meta.release : null,
    route_path: clientRoutePattern(report.route),
    route_type: "render",
    method: null,
    error_name: clientErrorName(report.name),
    error_code: null,
    digest: null,
    message: "",
    frames: [],
    request_id: null,
  };
}

export const CLIENT_KEYS_PER_DAY = 50;
const DAY_MS = 86_400_000;
let clientDay = -1;
const clientKeys = new Set<string>();

/** Clears the per-instance client key counter (tests). */
export function resetClientKeyState(): void {
  clientDay = -1;
  clientKeys.clear();
}

/** Whether a client event's (route, name) key may reach the sink today on this instance; records it when it may. */
export function admitClientKey(event: ErrorEvent, now: number = Date.now()): boolean {
  const day = Math.floor(now / DAY_MS);
  if (day !== clientDay) {
    clientDay = day;
    clientKeys.clear();
  }
  const key = `${event.route_path ?? "-"}|${event.error_name}`;
  if (clientKeys.has(key)) return true;
  if (clientKeys.size >= CLIENT_KEYS_PER_DAY) return false;
  clientKeys.add(key);
  return true;
}
