import { NextResponse } from "next/server";
import { CONCURRENT_WRITE, mapDbError, type DbErrorLike, type DbErrorMessages } from "@/lib/db/errors";
import type { AppErrorCode } from "@/lib/errors/app-error";
import { errorTag, log, logWord } from "@/lib/log";
import { getRequestId, newRequestId } from "@/lib/log/request-id";

export interface ApiSuccessResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    correlation_id?: string;
  };
}

/**
 * Uniform success response envelope: { data: T, meta?: Record<string, unknown> }
 * Complies with AGENTS.md §11, D-03, and Phase 06 contract.
 */
export function apiSuccess<T>(
  data: T,
  meta?: Record<string, unknown>,
  status: number = 200,
  headers?: HeadersInit
): NextResponse<ApiSuccessResponse<T>> {
  const body: ApiSuccessResponse<T> = { data };
  if (meta && Object.keys(meta).length > 0) {
    body.meta = meta;
  }
  return NextResponse.json(body, { status, headers });
}

/**
 * Uniform error response envelope: { error: { code, message, details?, correlation_id? } }
 * Sanitises internal database errors per AGENTS.md §12.
 *
 * V2-03 03-09a (BACKEND H2): `correlation_id` is the request id `proxy.ts` assigned (`x-request-id`), so a client's
 * error report, the response header and the server log line share one id. Async because the id is read through
 * `headers()`. Outside a request scope (a handler called directly) a fresh id is used.
 */
export async function apiError(
  code: string,
  message: string,
  status: number = 400,
  details?: unknown,
  headers?: HeadersInit
): Promise<NextResponse<ApiErrorResponse>> {
  const correlationId = (await getRequestId()) ?? newRequestId();
  let sanitizedMessage = message;
  let sanitizedDetails = details;

  // Sanitize 5xx and internal database errors to prevent leaking schema or SQL errors
  if (status >= 500 || code === "DATABASE_ERROR" || code === "INTERNAL_ERROR") {
    // The message and details can carry row values (e.g. "Key (phone)=(...)"): the log gets the envelope code only.
    log.error({ event: "api.v1.failed", requestId: correlationId, reason: logWord(code), status });
    sanitizedMessage = "An internal database error occurred.";
    sanitizedDetails = undefined;
  }

  const responseBody: ApiErrorResponse = {
    error: {
      code,
      message: sanitizedMessage,
      ...(sanitizedDetails !== undefined ? { details: sanitizedDetails } : {}),
      ...(status >= 500 || code === "DATABASE_ERROR" ? { correlation_id: correlationId } : {}),
    },
  };

  return NextResponse.json(responseBody, { status, headers });
}

/**
 * Envelope code and HTTP status for each {@link AppErrorCode} a database error maps to (V2-05 05a review INT L-4,
 * IND L8; plan 05-11c). 23503 (a referenced row is missing, e.g. a doctor or visit of another clinic) is the caller's
 * input: 422, not 500.
 */
const API_DB_STATUS: Readonly<Record<AppErrorCode, { code: string; status: number }>> = {
  VALIDATION_FAILED: { code: "VALIDATION_ERROR", status: 422 },
  PRECONDITION_FAILED: { code: "VALIDATION_ERROR", status: 422 },
  CONFLICT: { code: "CONFLICT", status: 409 },
  IDEMPOTENCY_MISMATCH: { code: "CONFLICT", status: 409 },
  FORBIDDEN: { code: "FORBIDDEN", status: 403 },
  NOT_FOUND: { code: "NOT_FOUND", status: 404 },
  RATE_LIMITED: { code: "RATE_LIMIT_EXCEEDED", status: 429 },
  UNAUTHENTICATED: { code: "UNAUTHORIZED", status: 401 },
  DEPENDENCY_FAILED: { code: "SERVICE_UNAVAILABLE", status: 503 },
  INTERNAL: { code: "DATABASE_ERROR", status: 500 },
};

/** The fixed `/api/v1` texts for a database error, keyed by reason (checked first) or by code. */
export const API_DB_MESSAGES: Readonly<DbErrorMessages> = {
  VALIDATION_FAILED: "A value in the request is not valid.",
  PRECONDITION_FAILED: "A referenced record does not exist in this clinic.",
  CONFLICT: "The request conflicts with the current state of the record.",
  [CONCURRENT_WRITE]: "Another request changed this record at the same time. Try again.",
  IDEMPOTENCY_MISMATCH: "The request conflicts with the current state of the record.",
  FORBIDDEN: "This API key may not perform this action.",
  NOT_FOUND: "Not found in the active clinic.",
  RATE_LIMITED: "Too many requests. Try again shortly.",
  UNAUTHENTICATED: "Invalid or revoked API key",
  DEPENDENCY_FAILED: "A service is unavailable. Try again shortly.",
  INTERNAL: "An internal database error occurred.",
};

/**
 * The `/api/v1` answer for a failed database call or an unexpected throw (V2-05 05a review INT L-4, IND L8; plan
 * 05-11c). The error goes through `mapDbError` (lib/db/errors.ts) and the response carries only a fixed text and the
 * mapped status: never the driver message, a constraint name, a key tuple or the details. The log line carries the
 * error's tag (SQLSTATE or error name) and `event`, nothing else. `messages` may override a text per reason or code
 * (fixed strings only).
 */
export async function apiDbError(
  err: unknown,
  headers?: HeadersInit,
  options: { event?: `${string}.${string}`; messages?: DbErrorMessages } = {}
): Promise<NextResponse<ApiErrorResponse>> {
  const dbErr = err && typeof err === "object" && !(err instanceof Error) ? (err as DbErrorLike) : null;
  const mapped = mapDbError(dbErr, { ...API_DB_MESSAGES, ...options.messages });
  const { code, status } = API_DB_STATUS[mapped.code];
  log.warn({ event: options.event ?? "api.v1.db_error", requestId: (await getRequestId()) ?? undefined, code: errorTag(err), reason: logWord(mapped.reason ?? mapped.code) });
  return apiError(code, mapped.message, status, undefined, headers);
}
