/**
 * The error-sink event (V2-03 03-09b, P1-25, TARGET §3.8). {@link buildErrorEvent} turns what Next hands
 * `onRequestError` into the closed field set of `ops.error_events`: error class name, SQLSTATE/code, Next digest,
 * scrubbed message, `file:line` frames, the route **pattern** and type, method, request id, tier and release.
 *
 * Never stored: the concrete request path (`request.path` carries share tokens and the query string, T-03-14), headers
 * other than the proxy's `x-request-id` UUID, cookies, bodies, the raw message or the stack's function names. Pure: reads
 * no environment (tier and release are passed in).
 */
import type { AppEnv } from "@/lib/env";
import { isUuid } from "@/lib/log/fields";
import { REQUEST_ID_HEADER } from "@/lib/log/request-id";
import { routePattern, scrubFrames, scrubMessage } from "./scrub";

/** Exactly the keys `public.ops_ingest_error` accepts (snake_case, as stored). */
export interface ErrorEvent {
  environment: AppEnv;
  release: string | null;
  route_path: string | null;
  route_type: "render" | "route" | "action" | "proxy" | null;
  method: string | null;
  error_name: string;
  error_code: string | null;
  digest: string | null;
  message: string;
  frames: string[];
  request_id: string | null;
}

export const ERROR_EVENT_KEYS: ReadonlyArray<keyof ErrorEvent> = [
  "environment",
  "release",
  "route_path",
  "route_type",
  "method",
  "error_name",
  "error_code",
  "digest",
  "message",
  "frames",
  "request_id",
];

/** The request as Next passes it to `onRequestError`. */
export interface ErrorRequest {
  path?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
}

/** The context Next passes to `onRequestError`. */
export interface ErrorContext {
  routePath?: string;
  routeType?: string;
}

const NAME_PATTERN = /^[A-Za-z0-9_.$-]{1,80}$/;
const CODE_PATTERN = /^[A-Za-z0-9_.-]{1,40}$/;
const DIGEST_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const METHOD_PATTERN = /^[A-Z]{1,10}$/;
const RELEASE_PATTERN = /^[0-9a-f]{7,40}$/;
const ROUTE_TYPES = new Set(["render", "route", "action", "proxy"]);

function field(err: unknown, key: string): unknown {
  return err !== null && typeof err === "object" ? (err as Record<string, unknown>)[key] : undefined;
}

function shaped(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

/** The proxy-assigned request id from the request headers, if it is a UUID. */
export function requestIdFrom(request: ErrorRequest | undefined): string | null {
  const raw = request?.headers?.[REQUEST_ID_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isUuid(value) ? value.toLowerCase() : null;
}

export interface EventMeta {
  environment: AppEnv;
  release: string | null;
  /** Repository root, for relative frame paths. */
  root: string;
}

/** Builds the stored event. Never throws; an unrecognisable error becomes `{ error_name: "Error", message: "" }`. */
export function buildErrorEvent(
  err: unknown,
  request: ErrorRequest | undefined,
  context: ErrorContext | undefined,
  meta: EventMeta,
): ErrorEvent {
  const name = shaped(field(err, "name"), NAME_PATTERN) ?? (err instanceof Error ? "Error" : "NonError");
  const code = field(err, "code");
  const routeType = context?.routeType;
  return {
    environment: meta.environment,
    release: shaped(meta.release, RELEASE_PATTERN),
    route_path: routePattern(context?.routePath),
    route_type: typeof routeType === "string" && ROUTE_TYPES.has(routeType) ? (routeType as ErrorEvent["route_type"]) : null,
    method: shaped(request?.method?.toUpperCase(), METHOD_PATTERN),
    error_name: name,
    error_code: shaped(typeof code === "number" ? String(code) : code, CODE_PATTERN),
    digest: shaped(field(err, "digest"), DIGEST_PATTERN),
    message: scrubMessage(field(err, "message")),
    frames: scrubFrames(field(err, "stack"), meta.root),
    request_id: requestIdFrom(request),
  };
}
