import "server-only";

import { z } from "zod";
import { hasPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { callCommand } from "@/lib/commands/call-command";
import { clientRequestIdSchema } from "@/lib/commands/request-id";
import type { DbErrorMessages } from "@/lib/db/errors";
import { appError, type Result } from "@/lib/errors/app-error";

/**
 * Recording a patient's allergies as one atomic command (V2-09c 09C-02, R-8): `public.record_patient_allergies` (migration 000118) writes the list
 * (`[]` is "No known allergies") and its `patient.allergies_record` audit row in one transaction; the same `client_request_id` replays the first result.
 * patients:edit and consultations:view (the 000055 rule: the front desk cannot change allergies). The list is validated here for the field messages and
 * again by the database.
 */
export const RECORD_ALLERGIES_MESSAGES = {
  NOT_FOUND: "Patient record not found.",
  FORBIDDEN: "Allergies can only be recorded by clinical staff.",
  VALIDATION_FAILED: "Check the allergies: up to 50, each under 200 characters.",
  LOCK_TIMEOUT: "This patient record is being updated. Try again.",
  IDEMPOTENCY_MISMATCH: "This was already submitted with different details. Refresh and try again.",
  INTERNAL: "Failed to record the allergies. Please try again.",
} as const satisfies DbErrorMessages;

export const allergiesInputSchema = z.object({
  patient_id: z.string().uuid(),
  allergies: z.array(z.string().trim().min(1).max(200)).max(50),
  client_request_id: z.string().uuid(),
});
export type RecordAllergiesInput = z.input<typeof allergiesInputSchema>;

const resultSchema = z.object({ patient_id: z.string().uuid(), allergies_count: z.number().int(), replayed: z.boolean() });

export interface RecordAllergiesValue {
  patientId: string;
  allergiesCount: number;
  replayed: boolean;
}

export async function recordPatientAllergies(ctx: ServiceContext, input: RecordAllergiesInput): Promise<Result<RecordAllergiesValue>> {
  const id = clientRequestIdSchema.safeParse(input.client_request_id);
  const parsed = allergiesInputSchema.safeParse(input);
  if (!id.success || !parsed.success) {
    return { ok: false, error: appError("VALIDATION_FAILED", { message: RECORD_ALLERGIES_MESSAGES.VALIDATION_FAILED }) };
  }
  if (!hasPerm(ctx.role, "patients:edit") || !hasPerm(ctx.role, "consultations:view")) {
    return { ok: false, error: appError("FORBIDDEN", { message: RECORD_ALLERGIES_MESSAGES.FORBIDDEN }) };
  }
  const outcome = await callCommand(
    ctx,
    "record_patient_allergies",
    { p_patient_id: parsed.data.patient_id, p_allergies: parsed.data.allergies, p_client_request_id: parsed.data.client_request_id },
    resultSchema,
    RECORD_ALLERGIES_MESSAGES,
    { event: "patients.allergies_record.failed" }
  );
  if (!outcome.ok) return outcome;
  return { ok: true, value: { patientId: outcome.value.patient_id, allergiesCount: outcome.value.allergies_count, replayed: outcome.value.replayed } };
}
