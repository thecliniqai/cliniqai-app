/**
 * Client render errors into the error sink (V2-06 06-04a, ruling R-3; V2-03 R-29 carry-over; 06-09a M-ERRCAP, C L-1,
 * C L-2; threats T-06-09, T-06-10).
 *
 * A route error boundary (`components/shell/route-error.tsx`) reports an uncaught render error through the
 * `reportClientRenderError` server action with two values only: the error's class name and the route **pattern** the
 * browser computed. Both are attacker-controlled (any member can call the action directly), so neither is stored as
 * sent; each is looked up in a closed list:
 *
 * - `error_name` is `client.` + the name when it is one of {@link CLIENT_ERROR_NAMES} (the built-in classes a render
 *   can throw, Next's `ChunkLoadError`, the diag page's error), else `client.Error`.
 * - `route_path` is the input when it is one of the dashboard's own route patterns ({@link CLIENT_ROUTE_PATTERNS},
 *   generated from `app/(dashboard)/`), else {@link CLIENT_ROUTE_FALLBACK}.
 * - `message` is `""` and `frames` is `[]`: the browser's message and stack never leave it. `digest`, `method` and
 *   `request_id` are null (a digest error was already recorded by the server's `onRequestError`).
 *
 * So nothing a caller types reaches `ops.error_events` or the log (06-04a only filtered by shape: split phone numbers,
 * names and diagnoses passed), and the client keyspace is at most {@link CLIENT_KEYSPACE} fingerprints a day across
 * every server instance, well inside the database's shared daily new-fingerprint cap (500): clients cannot blind the
 * sink to server errors whatever the number of instances. No migration (R-33). Rows still carry no tenant or user (R-3).
 *
 * {@link admitClientReport} also bounds volume per server instance and UTC day: at most {@link CLIENT_KEYS_PER_DAY}
 * distinct keys; a key reported again within {@link CLIENT_REPEAT_WINDOW_MS} is dropped without a log line or a write
 * (C L-1); the first refusal of the day is reported once so an operator sees the cap was hit (C L-2).
 */
import type { AppEnv } from "@/lib/env";
import type { ErrorEvent } from "./error-event";
import { CLIENT_ROUTE_PATTERNS } from "./client-routes";

export const CLIENT_NAME_PREFIX = "client.";
/** Input bounds the action's schema enforces. */
export const MAX_CLIENT_NAME = 80;
export const MAX_CLIENT_ROUTE = 200;
/** What a refused route is stored as: the root of the route groups. */
export const CLIENT_ROUTE_FALLBACK = "/" as const;
/** What a name outside the list is stored as. */
export const CLIENT_NAME_FALLBACK = "Error" as const;

/** The class names a client report may store (anything else is `client.Error`). */
export const CLIENT_ERROR_NAMES = [
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "AbortError",
  "ChunkLoadError",
  "DiagClientRenderError",
] as const;

const NAMES: ReadonlySet<string> = new Set(CLIENT_ERROR_NAMES);
const ROUTES: ReadonlySet<string> = new Set([...CLIENT_ROUTE_PATTERNS, CLIENT_ROUTE_FALLBACK]);

/** Every distinct (route, name) key clients can produce: the bound on their share of the daily fingerprint cap. */
export const CLIENT_KEYSPACE = NAMES.size * ROUTES.size;

/** The stored error name for a client-reported class name. */
export function clientErrorName(name: unknown): string {
  return `${CLIENT_NAME_PREFIX}${typeof name === "string" && NAMES.has(name) ? name : CLIENT_NAME_FALLBACK}`;
}

/** The stored route for a client-reported route pattern; anything not a dashboard route pattern becomes the fallback. */
export function clientRoutePattern(route: unknown): `/${string}` {
  return typeof route === "string" && ROUTES.has(route) ? (route as `/${string}`) : CLIENT_ROUTE_FALLBACK;
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
/** A key reported again within this window on the same instance is dropped silently (C L-1). */
export const CLIENT_REPEAT_WINDOW_MS = 60_000;
const DAY_MS = 86_400_000;
let clientDay = -1;
/** key → last time it was let through. */
const clientKeys = new Map<string, number>();
let capReported = false;

/** Clears the per-instance client key counter (tests). */
export function resetClientKeyState(): void {
  clientDay = -1;
  clientKeys.clear();
  capReported = false;
}

/**
 * What to do with one client event on this instance (and records it):
 * - `new` / `repeat`: log it and send it to the sink;
 * - `debounced`: the same key went through less than {@link CLIENT_REPEAT_WINDOW_MS} ago: nothing;
 * - `cap-reached`: a new key after {@link CLIENT_KEYS_PER_DAY} today, the first such refusal: one counter log line;
 * - `dropped`: later refusals the same day: nothing.
 */
export type ClientAdmission = "new" | "repeat" | "debounced" | "cap-reached" | "dropped";

export function admitClientReport(event: ErrorEvent, now: number = Date.now()): ClientAdmission {
  const day = Math.floor(now / DAY_MS);
  if (day !== clientDay) {
    clientDay = day;
    clientKeys.clear();
    capReported = false;
  }
  const key = `${event.route_path ?? "-"}|${event.error_name}`;
  const last = clientKeys.get(key);
  if (last !== undefined) {
    if (now - last < CLIENT_REPEAT_WINDOW_MS) return "debounced";
    clientKeys.set(key, now);
    return "repeat";
  }
  if (clientKeys.size >= CLIENT_KEYS_PER_DAY) {
    if (capReported) return "dropped";
    capReported = true;
    return "cap-reached";
  }
  clientKeys.set(key, now);
  return "new";
}
