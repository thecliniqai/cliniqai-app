/**
 * The closed field set of the server logger (V2-03 03-09a, ruling R-6, TARGET §3.8, BACKEND H1).
 *
 * PHI safety holds by type rather than by a redaction deny-list: a log line can only carry these fields, none of them
 * free-form objects and none of them a `message`. An error enters a line only through `errorTag(err)` in `code` (its
 * database code or class name, never its message, which can carry row values such as "Key (phone)=(…)").
 *
 * `sanitiseFields` is the runtime defence for callers that bypass the type (`any`): unknown keys are dropped, ids
 * that are not UUIDs are dropped, a `code` outside the allowed shape is dropped, numbers must be finite and strings are
 * cut to {@link MAX_STRING} characters. This module reads no environment.
 */

/** `domain.verb` style, lower case: `auth.email.sent`, `billing.payment_recorded`. */
export const EVENT_PATTERN = /^[a-z0-9]+(\.[a-z0-9_]+)+$/;
/** What `errorTag()` produces: a Postgres/PostgREST code (`23505`, `PGRST116`) or an error class name. */
export const CODE_PATTERN = /^[A-Za-z0-9_.-]{1,40}$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_STRING = 120;
/** Written in place of an `event` that does not match {@link EVENT_PATTERN}; the rejected value is never written. */
export const INVALID_EVENT = "log.invalid_event";

export type LogLevel = "info" | "warn" | "error";

export interface LogFields {
  /** Required. Lower-case dotted name matching {@link EVENT_PATTERN}. */
  event: `${string}.${string}`;
  /** The `x-request-id` the proxy assigned (UUID); `getRequestId()` reads it. */
  requestId?: string;
  /** UUID only. */
  tenantId?: string;
  /** UUID only (auth user id). */
  userId?: string;
  /** Route pattern, e.g. `/api/v1/patients/[id]`; never a concrete path with ids or query values. */
  route?: string;
  /** Server action or operation name. */
  action?: string;
  module?: string;
  /** A short fixed reason (`rate_limited`, `not_found`); never user input or row data. */
  reason?: string;
  /** Only via `errorTag(err)`: ≤ 40 chars of `[A-Za-z0-9_.-]`. */
  code?: string;
  /** HTTP status. */
  status?: number;
  durationMs?: number;
  count?: number;
}

/** A sanitised line body, in the key order it is written. */
export type SafeLogFields = { event: string } & Partial<Record<Exclude<keyof LogFields, "event">, string | number>>;

const UUID_KEYS = ["requestId", "tenantId", "userId"] as const;
const STRING_KEYS = ["route", "action", "module", "reason"] as const;
const NUMBER_KEYS = ["status", "durationMs", "count"] as const;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function truncate(value: string): string {
  return value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value;
}

/**
 * Builds the line body from whatever the caller passed: only the known keys, each validated. Never throws; a non-object
 * input or an invalid `event` yields `{ event: INVALID_EVENT }`.
 */
export function sanitiseFields(input: unknown): SafeLogFields {
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const event = typeof source.event === "string" && EVENT_PATTERN.test(source.event) && source.event.length <= MAX_STRING
    ? source.event
    : INVALID_EVENT;
  const out: SafeLogFields = { event };

  for (const key of UUID_KEYS) {
    if (isUuid(source[key])) out[key] = (source[key] as string).toLowerCase();
  }
  for (const key of STRING_KEYS) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) out[key] = truncate(value);
  }
  if (typeof source.code === "string" && CODE_PATTERN.test(source.code)) out.code = source.code;
  for (const key of NUMBER_KEYS) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}
