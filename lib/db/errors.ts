import { appError, isAppErrorReason, type AppError, type AppErrorCode } from "@/lib/errors/app-error";

/**
 * Postgres / PostgREST error → {@link AppError} (TARGET_ARCHITECTURE §6; V2-03 03-07, AD-7).
 *
 * | SQLSTATE            | AppError                                                                  |
 * |---------------------|---------------------------------------------------------------------------|
 * | 23505               | CONFLICT, reason = the constraint name (upper snake) when present         |
 * | 23503               | PRECONDITION_FAILED                                                       |
 * | 23514, 23P01        | CONFLICT, reason = the constraint name                                    |
 * | 42501               | FORBIDDEN (RLS, a revoked EXECUTE, or an RPC's role check)                |
 * | P0001               | the code registered for the raised reason in {@link RPC_REASON_CODES}; an |
 * |                     | unregistered reason → CONFLICT                                            |
 * | P0002               | NOT_FOUND, reason = the raised reason                                     |
 * | 55P03               | CONFLICT, reason LOCK_TIMEOUT (an RPC's lock_timeout expired)             |
 * | anything else       | INTERNAL                                                                  |
 *
 * The returned message is always a fixed text (the caller's `messages` or the default for the code): never the
 * driver's message, details or hint, which can carry row values. A reason is kept only when it has the closed
 * upper-snake shape (an atomic-command RPC raises `RAISE EXCEPTION 'OVERPAYMENT' USING ERRCODE = 'P0001'`); other
 * raised text is dropped.
 */
export interface DbErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

/** Machine reasons raised by the atomic-command RPCs (`RAISE … USING ERRCODE = 'P0001'`) and their codes. */
export const RPC_REASON_CODES: Readonly<Record<string, AppErrorCode>> = {
  ACTOR_INVALID: "FORBIDDEN",
  AMOUNT_INVALID: "VALIDATION_FAILED",
  METHOD_INVALID: "VALIDATION_FAILED",
  INPUT_INVALID: "VALIDATION_FAILED",
  IDEMPOTENCY_MISMATCH: "IDEMPOTENCY_MISMATCH",
  INVOICE_NOT_PAYABLE: "CONFLICT",
  OVERPAYMENT: "CONFLICT",
  OUTBOX_SUBJECT_INVALID: "INTERNAL",
};

/** Fixed texts keyed by reason (checked first) or by code. */
export type DbErrorMessages = Partial<Record<AppErrorCode | string, string>>;

const CONSTRAINT_IN_MESSAGE = /constraint "([a-z][a-z0-9_]{0,62})"/;

function constraintReason(err: DbErrorLike): string | undefined {
  const name = CONSTRAINT_IN_MESSAGE.exec(err.message ?? "")?.[1];
  return name ? name.toUpperCase() : undefined;
}

function raisedReason(err: DbErrorLike): string | undefined {
  return isAppErrorReason(err.message) ? err.message : undefined;
}

function classify(err: DbErrorLike): { code: AppErrorCode; reason?: string } {
  switch (err.code) {
    case "23505":
    case "23514":
    case "23P01":
      return { code: "CONFLICT", reason: constraintReason(err) };
    case "23503":
      return { code: "PRECONDITION_FAILED" };
    case "42501":
      return { code: "FORBIDDEN" };
    case "P0001": {
      const reason = raisedReason(err);
      return { code: (reason && RPC_REASON_CODES[reason]) || "CONFLICT", reason };
    }
    case "P0002":
      return { code: "NOT_FOUND", reason: raisedReason(err) };
    case "55P03":
      return { code: "CONFLICT", reason: "LOCK_TIMEOUT" };
    default:
      return { code: "INTERNAL" };
  }
}

export function mapDbError(err: DbErrorLike | null | undefined, messages: DbErrorMessages = {}): AppError {
  const { code, reason } = err && typeof err === "object" ? classify(err) : { code: "INTERNAL" as const };
  const message = (reason !== undefined ? messages[reason] : undefined) ?? messages[code];
  return appError(code, { message, reason });
}
