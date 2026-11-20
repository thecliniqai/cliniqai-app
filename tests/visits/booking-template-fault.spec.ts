/**
 * V2-07 07-04a G-5: a template or configuration fault in the booking message (TEMPLATE_NOT_ALLOWED from the command) is not
 * "check the details": the booking rolled back for a reason the user cannot fix. The service maps it to INTERNAL with a fixed
 * configuration text and logs it with an error tag only (no PHI, no ids of the patient). Unit-level: the command call is
 * replaced, so no database is needed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appError } from "@/lib/errors/app-error";

const callCommand = vi.fn();
const logError = vi.fn();
vi.mock("@/lib/commands/call-command", () => ({ callCommand: (...args: unknown[]) => callCommand(...args) }));
vi.mock("@/lib/log", () => ({
  log: { error: (...args: unknown[]) => logError(...args), warn: vi.fn(), info: vi.fn() },
  errorTag: () => "tag",
}));
vi.mock("@/lib/log/request-id", () => ({ getRequestId: async () => "req-test" }));

import { BOOKING_COMMAND_MESSAGES, BOOKING_MESSAGE_CONFIG_MESSAGE, registerAndBook } from "@/features/visits/scheduling-service";
import type { ServiceContext } from "@/lib/auth/context";

const ctx = { role: "receptionist", tenantId: "00000000-0000-4000-8000-0000000000a1", userId: "00000000-0000-4000-8000-0000000000b1", db: {} } as unknown as ServiceContext;
const input = {
  patient_id: "00000000-0000-4000-8000-0000000000c1",
  doctor_id: "00000000-0000-4000-8000-0000000000d1",
  scheduled_at: "2031-03-04T05:30:00.000Z",
  estimated_duration_minutes: 15,
};

beforeEach(() => {
  callCommand.mockReset();
  logError.mockReset();
});

describe("registerAndBook: a template fault", () => {
  it("TEMPLATE_NOT_ALLOWED is INTERNAL with the fixed configuration text, logged by tag only", async () => {
    callCommand.mockResolvedValue({ ok: false, error: appError("VALIDATION_FAILED", { message: BOOKING_COMMAND_MESSAGES.VALIDATION_FAILED, reason: "TEMPLATE_NOT_ALLOWED" }) });
    const res = await registerAndBook(ctx, input, "00000000-0000-4000-8000-0000000000e1");
    expect(res).toMatchObject({ ok: false, error: { code: "INTERNAL", message: BOOKING_MESSAGE_CONFIG_MESSAGE, reason: "TEMPLATE_NOT_ALLOWED" } });
    expect(BOOKING_MESSAGE_CONFIG_MESSAGE).not.toBe(BOOKING_COMMAND_MESSAGES.VALIDATION_FAILED);
    expect(logError).toHaveBeenCalledTimes(1);
    const fields = logError.mock.calls[0][0] as Record<string, unknown>;
    expect(fields).toMatchObject({ event: "visits.register_and_book.template_not_allowed", code: "TEMPLATE_NOT_ALLOWED", requestId: "req-test", tenantId: ctx.tenantId });
    expect(JSON.stringify(fields)).not.toContain(input.patient_id);
  });

  it("any other refusal passes through unchanged and is not logged here", async () => {
    const refusal = { ok: false, error: appError("CONFLICT", { message: BOOKING_COMMAND_MESSAGES.SLOT_TAKEN, reason: "SLOT_TAKEN" }) };
    callCommand.mockResolvedValue(refusal);
    expect(await registerAndBook(ctx, input, "00000000-0000-4000-8000-0000000000e2")).toBe(refusal);
    expect(logError).not.toHaveBeenCalled();
  });
});
