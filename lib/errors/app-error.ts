/**
 * The standard error type (TARGET_ARCHITECTURE §6; V2-03 03-07, AD-7). Isomorphic and dependency-free.
 *
 * `message` is safe and user-presentable: it never carries a driver message, row data or PHI. `reason` is a machine
 * sub-code (`OVERPAYMENT`, `INVOICE_NOT_FOUND`) taken only from the closed upper-snake shape. `cause` stays on the
 * server: it is never serialised to a client (log its `errorTag`, never the object).
 */
export const APP_ERROR_CODES = [
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "RATE_LIMITED",
  "IDEMPOTENCY_MISMATCH",
  "DEPENDENCY_FAILED",
  "INTERNAL",
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export interface AppError {
  code: AppErrorCode;
  message: string;
  reason?: string;
  fieldErrors?: Record<string, string[]>;
  cause?: unknown;
}

export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

/** Default safe messages; a use-case may pass its own (fixed) text per code or reason. */
export const DEFAULT_APP_ERROR_MESSAGES: Readonly<Record<AppErrorCode, string>> = {
  VALIDATION_FAILED: "Some details are not valid.",
  UNAUTHENTICATED: "Please sign in again.",
  FORBIDDEN: "You do not have permission to perform this action.",
  NOT_FOUND: "Not found or access denied.",
  CONFLICT: "This record changed while saving. Refresh and try again.",
  PRECONDITION_FAILED: "A related record is missing. Refresh and try again.",
  RATE_LIMITED: "Too many attempts. Wait a minute and try again.",
  IDEMPOTENCY_MISMATCH: "This request was already submitted with different details.",
  DEPENDENCY_FAILED: "A service is unavailable. Try again shortly.",
  INTERNAL: "Something went wrong. Try again.",
};

/** A machine reason: upper snake case, at most 64 characters. Anything else is dropped, never echoed. */
const REASON_SHAPE = /^[A-Z][A-Z0-9_]{0,63}$/;

export function isAppErrorReason(value: unknown): value is string {
  return typeof value === "string" && REASON_SHAPE.test(value);
}

export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === "string" && (APP_ERROR_CODES as readonly string[]).includes(value);
}

export function appError(
  code: AppErrorCode,
  options: { message?: string; reason?: string; fieldErrors?: Record<string, string[]>; cause?: unknown } = {}
): AppError {
  const error: AppError = { code, message: options.message ?? DEFAULT_APP_ERROR_MESSAGES[code] };
  if (options.reason !== undefined && isAppErrorReason(options.reason)) error.reason = options.reason;
  if (options.fieldErrors) error.fieldErrors = options.fieldErrors;
  // Not enumerable: JSON serialisation and object spread (a server action result) never carry the cause.
  if (options.cause !== undefined) {
    Object.defineProperty(error, "cause", { value: options.cause, enumerable: false, writable: false });
  }
  return error;
}
