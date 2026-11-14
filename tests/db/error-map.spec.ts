/**
 * V2-03 03-07 (TARGET §6, AD-7): Postgres / PostgREST errors map to a stable AppError code with a fixed message.
 * The driver's message, details and hint never reach the result, whatever they contain.
 */
import { describe, expect, it } from "vitest";
import { mapDbError, RPC_REASON_CODES } from "@/lib/db/errors";
import { appError, DEFAULT_APP_ERROR_MESSAGES, type AppErrorCode } from "@/lib/errors/app-error";

// Synthetic driver texts that look like what Postgres puts in a message or detail (row values included).
const ROW_DETAIL = "Key (phone)=(+91 90000 00001) already exists.";

describe("mapDbError: SQLSTATE table", () => {
  const cases: Array<[string, { code: string; message: string; details?: string }, AppErrorCode, string | undefined]> = [
    ["42501 (RLS / revoked EXECUTE / role check)", { code: "42501", message: "permission denied for function record_payment" }, "FORBIDDEN", undefined],
    ["P0002 with a raised reason", { code: "P0002", message: "INVOICE_NOT_FOUND" }, "NOT_FOUND", "INVOICE_NOT_FOUND"],
    ["P0002 with free text", { code: "P0002", message: "query returned no rows for id 42" }, "NOT_FOUND", undefined],
    [
      "23505 unique violation",
      { code: "23505", message: 'duplicate key value violates unique constraint "payments_tenant_command_id"', details: ROW_DETAIL },
      "CONFLICT",
      "PAYMENTS_TENANT_COMMAND_ID",
    ],
    ["23503 foreign key", { code: "23503", message: 'insert violates foreign key constraint "payments_invoice_id_fkey"', details: ROW_DETAIL }, "PRECONDITION_FAILED", undefined],
    ["23514 check", { code: "23514", message: 'new row violates check constraint "payments_amount_check"', details: ROW_DETAIL }, "CONFLICT", "PAYMENTS_AMOUNT_CHECK"],
    ["23P01 exclusion", { code: "23P01", message: 'conflicting key value violates exclusion constraint "visits_no_overlap"' }, "CONFLICT", "VISITS_NO_OVERLAP"],
    ["55P03 lock timeout", { code: "55P03", message: "canceling statement due to lock timeout" }, "CONFLICT", "LOCK_TIMEOUT"],
    // V2-05 05-11c (INT L-3): a deadlock victim or a serialization failure lost to a concurrent write (retry-safe).
    ["40P01 deadlock", { code: "40P01", message: "deadlock detected", details: "Process 101 waits for ShareLock on transaction 9" }, "CONFLICT", "CONCURRENT_WRITE"],
    ["40001 serialization failure", { code: "40001", message: "could not serialize access due to concurrent update" }, "CONFLICT", "CONCURRENT_WRITE"],
    ["P0001 OVERPAYMENT", { code: "P0001", message: "OVERPAYMENT" }, "CONFLICT", "OVERPAYMENT"],
    ["P0001 INVOICE_NOT_PAYABLE", { code: "P0001", message: "INVOICE_NOT_PAYABLE" }, "CONFLICT", "INVOICE_NOT_PAYABLE"],
    ["P0001 ACTOR_INVALID", { code: "P0001", message: "ACTOR_INVALID" }, "FORBIDDEN", "ACTOR_INVALID"],
    ["P0001 AMOUNT_INVALID", { code: "P0001", message: "AMOUNT_INVALID" }, "VALIDATION_FAILED", "AMOUNT_INVALID"],
    ["P0001 METHOD_INVALID", { code: "P0001", message: "METHOD_INVALID" }, "VALIDATION_FAILED", "METHOD_INVALID"],
    ["P0001 INPUT_INVALID", { code: "P0001", message: "INPUT_INVALID" }, "VALIDATION_FAILED", "INPUT_INVALID"],
    ["P0001 IDEMPOTENCY_MISMATCH", { code: "P0001", message: "IDEMPOTENCY_MISMATCH" }, "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_MISMATCH"],
    ["P0001 OUTBOX_SUBJECT_INVALID (a programming fault)", { code: "P0001", message: "OUTBOX_SUBJECT_INVALID" }, "INTERNAL", "OUTBOX_SUBJECT_INVALID"],
    // V2-04 04-03a: the message enqueue RPCs (migration 000035).
    ["P0002 SUBJECT_MISMATCH (subject outside the active clinic)", { code: "P0002", message: "SUBJECT_MISMATCH" }, "NOT_FOUND", "SUBJECT_MISMATCH"],
    ["P0001 SUBJECT_MISMATCH (patient is not the visit's)", { code: "P0001", message: "SUBJECT_MISMATCH" }, "NOT_FOUND", "SUBJECT_MISMATCH"],
    ["P0001 TEMPLATE_NOT_ALLOWED", { code: "P0001", message: "TEMPLATE_NOT_ALLOWED" }, "VALIDATION_FAILED", "TEMPLATE_NOT_ALLOWED"],
    ["P0001 RECIPIENT_NOT_ALLOWED", { code: "P0001", message: "RECIPIENT_NOT_ALLOWED" }, "VALIDATION_FAILED", "RECIPIENT_NOT_ALLOWED"],
    ["P0001 EVENT_NOT_ALLOWED", { code: "P0001", message: "EVENT_NOT_ALLOWED" }, "VALIDATION_FAILED", "EVENT_NOT_ALLOWED"],
    ["P0001 RATE_LIMITED", { code: "P0001", message: "RATE_LIMITED" }, "RATE_LIMITED", "RATE_LIMITED"],
    // V2-04 04-03c (000037): ops.replay_job (postgres only; registered so the map stays complete).
    ["P0001 JOB_NOT_REPLAYABLE", { code: "P0001", message: "JOB_NOT_REPLAYABLE" }, "CONFLICT", "JOB_NOT_REPLAYABLE"],
    ["P0001 unregistered reason", { code: "P0001", message: "SLOT_TAKEN" }, "CONFLICT", "SLOT_TAKEN"],
    ["P0001 free text (an older RAISE)", { code: "P0001", message: "visit 1b2c has 2 live invoices for Synthetic Patient" }, "CONFLICT", undefined],
    ["XX000 internal", { code: "XX000", message: "SPIKE_FAULT" }, "INTERNAL", undefined],
    ["57014 statement timeout", { code: "57014", message: "canceling statement due to statement timeout" }, "INTERNAL", undefined],
    ["PGRST202 unknown function", { code: "PGRST202", message: "Could not find the function public.record_payment" }, "INTERNAL", undefined],
    ["no code", { code: "", message: "fetch failed" }, "INTERNAL", undefined],
  ];

  it.each(cases)("%s", (_name, err, code, reason) => {
    const mapped = mapDbError(err);
    expect(mapped.code).toBe(code);
    expect(mapped.reason).toBe(reason);
    expect(mapped.message).toBe(DEFAULT_APP_ERROR_MESSAGES[code]);
    const serialised = JSON.stringify(mapped);
    if (err.message !== reason) expect(serialised).not.toContain(err.message);
    expect(serialised).not.toContain("+91");
  });

  it("23P01 from visits_no_double_booking (V2-05 05-08) → CONFLICT, reason = the constraint, the caller's fixed text", () => {
    const err = {
      code: "23P01",
      message: 'conflicting key value violates exclusion constraint "visits_no_double_booking"',
      details: "Key (tenant_id, doctor_id, public.visit_slot(scheduled_at, estimated_duration_minutes))=(...) conflicts with existing key",
    };
    const mapped = mapDbError(err, { VISITS_NO_DOUBLE_BOOKING: "Synthetic slot-taken text." });
    expect(mapped).toEqual(appError("CONFLICT", { message: "Synthetic slot-taken text.", reason: "VISITS_NO_DOUBLE_BOOKING" }));
    expect(JSON.stringify(mapped)).not.toContain("Key (");
  });

  it("null, undefined and non-objects map to INTERNAL", () => {
    for (const err of [null, undefined, "boom" as unknown as null, 42 as unknown as null]) {
      expect(mapDbError(err)).toEqual({ code: "INTERNAL", message: DEFAULT_APP_ERROR_MESSAGES.INTERNAL });
    }
  });

  it("an unknown error keeps no driver text in the message, reason or serialised form", () => {
    const err = { code: "XX000", message: `internal error near ${ROW_DETAIL}`, details: ROW_DETAIL, hint: ROW_DETAIL };
    const mapped = mapDbError(err);
    expect(mapped).toEqual({ code: "INTERNAL", message: DEFAULT_APP_ERROR_MESSAGES.INTERNAL });
    expect(Object.keys(mapped).sort()).toEqual(["code", "message"]);
  });

  it("every registered RPC reason maps to its registered code", () => {
    for (const [reason, code] of Object.entries(RPC_REASON_CODES)) {
      expect(mapDbError({ code: "P0001", message: reason })).toMatchObject({ code, reason });
    }
  });
});

describe("mapDbError: fixed messages", () => {
  const messages = { OVERPAYMENT: "The amount is more than the balance due.", NOT_FOUND: "Invoice not found.", INTERNAL: "Failed." };

  it("a reason message wins over the code message", () => {
    expect(mapDbError({ code: "P0001", message: "OVERPAYMENT" }, messages).message).toBe(messages.OVERPAYMENT);
  });

  it("falls back to the code message, then the default", () => {
    expect(mapDbError({ code: "P0002", message: "INVOICE_NOT_FOUND" }, messages).message).toBe(messages.NOT_FOUND);
    expect(mapDbError({ code: "XX000", message: "boom" }, messages).message).toBe(messages.INTERNAL);
    expect(mapDbError({ code: "42501", message: "denied" }, messages).message).toBe(DEFAULT_APP_ERROR_MESSAGES.FORBIDDEN);
  });

  it("a reason of the wrong shape is dropped, never used as a message key or echoed", () => {
    const mapped = mapDbError({ code: "P0001", message: "overpayment of 500" }, { "overpayment of 500": "x" });
    expect(mapped).toEqual({ code: "CONFLICT", message: DEFAULT_APP_ERROR_MESSAGES.CONFLICT });
  });
});

describe("appError", () => {
  it("keeps the cause off the wire (not enumerable, not serialised)", () => {
    const cause = new Error(ROW_DETAIL);
    const err = appError("INTERNAL", { cause });
    expect(err.cause).toBe(cause);
    expect(JSON.stringify(err)).not.toContain("+91");
    expect({ ...err }).not.toHaveProperty("cause");
  });

  it("drops a reason that is not upper snake case", () => {
    expect(appError("CONFLICT", { reason: "Key (phone)=(x)" })).not.toHaveProperty("reason");
    expect(appError("CONFLICT", { reason: "SLOT_TAKEN" }).reason).toBe("SLOT_TAKEN");
  });
});
