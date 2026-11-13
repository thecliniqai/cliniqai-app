/**
 * The closed field set of the server logger (V2-03 03-09a, ruling R-6, TARGET §3.8, BACKEND H1).
 *
 * PHI safety holds by type rather than by a redaction deny-list: a log line can only carry these fields, none of them
 * free-form objects and none of them a `message`. An error enters a line only through `errorTag(err)` in `code` (its
 * database code or class name, never its message, which can carry row values such as "Key (phone)=(…)").
 *
 * `sanitiseFields` is the runtime defence for callers that bypass the type (`any`, a cast): unknown keys are dropped,
 * ids that are not UUIDs are dropped, `action`/`module`/`reason` outside {@link WORD_PATTERN} or carrying a run of 6+
 * digits are dropped, `route` must pass `routePattern()` (no query, no concrete id or token segment), `code` outside
 * its shape is dropped, `status` must be an integer 100–599 and `count`/`durationMs` non-negative integers up to
 * {@link MAX_COUNT} (`count` an integer) (03-13d M-LOGFIELDS). Values are dropped, never truncated or echoed. This module reads no
 * environment.
 */
import { routePattern } from "@/lib/observability/scrub";

/** `domain.verb` style, lower case: `auth.email.sent`, `billing.payment_recorded`. */
export const EVENT_PATTERN = /^[a-z0-9]+(\.[a-z0-9_]+)+$/;
/** What `errorTag()` produces: a Postgres/PostgREST code (`23505`, `PGRST116`) or an error class name. */
export const CODE_PATTERN = /^[A-Za-z0-9_.-]{1,40}$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_STRING = 120;
/** A run of 6+ digits (phone, Aadhaar, account number) is never written in a word or code field. */
const DIGIT_RUN = /\d{6,}/;
/** `action`, `module`, `reason`: lower-case machine words (no spaces, no `@`, no upper case). */
export const WORD_PATTERN = /^[a-z0-9_.:-]{1,64}$/;
export const MAX_WORD = 64;
/**
 * `module` may also be a lower-case module path (`app/api/cron/webhooks`, `features/sharing/system`: the owners
 * `getSystemDb` names in `REASON_OWNER`): words of {@link WORD_PATTERN}'s alphabet joined by `/`, at most 64 characters.
 */
export const MODULE_PATTERN = /^(?=.{1,64}$)[a-z0-9_.:-]+(?:\/[a-z0-9_.:-]+)*$/;
/** Upper bound for `count` / `durationMs`: phone-sized numbers are refused. */
export const MAX_COUNT = 10_000_000;
/** Written in place of an `event` that does not match {@link EVENT_PATTERN}; the rejected value is never written. */
export const INVALID_EVENT = "log.invalid_event";

export type LogLevel = "info" | "warn" | "error";

/**
 * A short machine word (03-13d M-LOGFIELDS, review C M-1): lower case, `[a-z0-9_.:-]`, at most {@link MAX_WORD}
 * characters. `Lowercase<string>` keeps a plain `string` (an `err.message`, a row value) from compiling; the runtime
 * check in {@link sanitiseFields} drops anything outside {@link WORD_PATTERN}.
 */
export type LogWord = Lowercase<string>;
/**
 * A computed value as a {@link LogWord}: lower-cased; the logger still drops it unless it matches {@link WORD_PATTERN}.
 * Only for values built from fixed parts (a provider name, an enum code), never for an error message or user input.
 */
export function logWord(value: string): LogWord {
  return value.toLowerCase() as LogWord;
}

/** A route pattern: starts with `/`, checked by `routePattern()` at runtime (no query, no concrete id or token). */
export type LogRoute = `/${string}`;

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
  route?: LogRoute;
  /** Server action or operation name. */
  action?: LogWord;
  module?: LogWord;
  /** A short fixed reason (`rate_limited`, `not_found`); never user input or row data. */
  reason?: LogWord;
  /** Only via `errorTag(err)`: ≤ 40 chars of `[A-Za-z0-9_.-]`. */
  code?: string;
  /** HTTP status: an integer 100–599. */
  status?: number;
  /** Non-negative, ≤ {@link MAX_COUNT}. */
  durationMs?: number;
  /** Non-negative integer ≤ {@link MAX_COUNT}. */
  count?: number;
}

/** A sanitised line body, in the key order it is written. */
export type SafeLogFields = { event: string } & Partial<Record<Exclude<keyof LogFields, "event">, string | number>>;

const UUID_KEYS = ["requestId", "tenantId", "userId"] as const;
const WORD_KEYS = ["action", "module", "reason"] as const;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
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
  // A route with a query or fragment is refused outright (routePattern alone would cut it off).
  const route = typeof source.route === "string" && !/[?#]/.test(source.route) ? routePattern(source.route) : null;
  if (route) out.route = route;
  for (const key of WORD_KEYS) {
    const value = source[key];
    const pattern = key === "module" ? MODULE_PATTERN : WORD_PATTERN;
    if (typeof value === "string" && pattern.test(value) && !DIGIT_RUN.test(value)) out[key] = value;
  }
  if (typeof source.code === "string" && CODE_PATTERN.test(source.code) && !DIGIT_RUN.test(source.code)) {
    out.code = source.code;
  }
  const status = source.status;
  if (Number.isInteger(status) && (status as number) >= 100 && (status as number) <= 599) out.status = status as number;
  const duration = source.durationMs;
  if (typeof duration === "number" && Number.isFinite(duration) && duration >= 0 && duration <= MAX_COUNT) {
    out.durationMs = duration;
  }
  const count = source.count;
  if (Number.isInteger(count) && (count as number) >= 0 && (count as number) <= MAX_COUNT) out.count = count as number;
  return out;
}
