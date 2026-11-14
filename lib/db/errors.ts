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
  // V2-04 04-03a (migration 000035): the message enqueue RPCs. A subject outside the caller's active clinic is raised
  // as P0002 (not found); a patient that is not the visit's patient as P0001, mapped to the same code.
  SUBJECT_MISMATCH: "NOT_FOUND",
  TEMPLATE_NOT_ALLOWED: "VALIDATION_FAILED",
  RECIPIENT_NOT_ALLOWED: "VALIDATION_FAILED",
  // V2-04 04-03b (migration 000036): the webhook enqueue RPCs. An event outside the closed set (or a subject not in the
  // event's state) and the test-ping limit (5 per clinic per 60 s).
  EVENT_NOT_ALLOWED: "VALIDATION_FAILED",
  RATE_LIMITED: "RATE_LIMITED",
  // V2-04 04-03c (migration 000037): ops.replay_job refuses a job that is missing, not dead, or an erased unmatched reply.
  JOB_NOT_REPLAYABLE: "CONFLICT",
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

/** Reason of {@link unaffectedRowsError}: the write matched no row the caller may change. */
export const ROW_NOT_AFFECTED = "ROW_NOT_AFFECTED";

/**
 * A DELETE (or UPDATE) that RLS may filter (V2-05 05-04, R-22, T-05-07). PostgREST answers a write whose rows the
 * caller's policies exclude with success and 0 rows, so a service that only checks `error` reports a silent no-op as
 * done (research Pitfall 11). Request the affected rows with `.select("id")` on the write and pass them here: fewer
 * than `expected` → FORBIDDEN with reason {@link ROW_NOT_AFFECTED} (the service read the row first, so it exists for
 * the caller; their role in the active clinic may not change it). Write the audit row only when this returns null.
 */
export function unaffectedRowsError(rows: unknown, expected = 1, messages: DbErrorMessages = {}): AppError | null {
  const affected = Array.isArray(rows) ? rows.length : 0;
  if (affected >= expected) return null;
  return appError("FORBIDDEN", { message: messages[ROW_NOT_AFFECTED] ?? messages.FORBIDDEN, reason: ROW_NOT_AFFECTED });
}
