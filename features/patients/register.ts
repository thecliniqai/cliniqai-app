import "server-only";

import { z } from "zod";
import { hasPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { callCommand } from "@/lib/commands/call-command";
import { clientRequestIdSchema } from "@/lib/commands/request-id";
import type { DbErrorMessages } from "@/lib/db/errors";
import { appError, type Result } from "@/lib/errors/app-error";
import { newPatientPayload, patientSchema, type NewPatientInput } from "./schema";

/**
 * Patient registration as one atomic command (V2-08 08-02, R-6, R-12): `public.register_patient` (migration 000101) inserts
 * the validated patient with its `patient.create` audit row and, when the objection is set, the objection stamp and audit
 * row, in one transaction; the same `client_request_id` replays the first result and writes nothing new. `patients:edit`
 * (every clinic role). The input is validated here first for the field messages; the database validates the same rules
 * again and never trusts this mapping.
 */

/** Fixed, data-free texts by reason or code for `register_patient`. The driver message never reaches the caller. */
export const REGISTER_PATIENT_MESSAGES = {
  NOT_FOUND: "Clinic not found.",
  FORBIDDEN: "You do not have permission to register patients.",
  VALIDATION_FAILED: "Please check the patient details.",
  LOCK_TIMEOUT: "The patient list is busy. Try again.",
  IDEMPOTENCY_MISMATCH: "This was already submitted with different details. Refresh and try again.",
  INTERNAL: "Failed to register the patient.",
} as const satisfies DbErrorMessages;

const registerPatientResultSchema = z.object({
  patient_id: z.string().uuid(),
  replayed: z.boolean(),
});

export interface RegisterPatientValue {
  patientId: string;
  /** True when this client_request_id was already registered: nothing new was written. */
  replayed: boolean;
}

export async function registerPatient(
  ctx: ServiceContext,
  input: NewPatientInput,
  clientRequestId: string
): Promise<Result<RegisterPatientValue>> {
  const id = clientRequestIdSchema.safeParse(clientRequestId);
  const parsed = patientSchema.safeParse(input);
  if (!id.success || !parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0]?.toString() || "form";
        (fieldErrors[field] ||= []).push(issue.message);
      }
    }
    return {
      ok: false,
      error: appError("VALIDATION_FAILED", {
        message: !parsed.success
          ? (parsed.error.issues[0]?.message ?? REGISTER_PATIENT_MESSAGES.VALIDATION_FAILED)
          : REGISTER_PATIENT_MESSAGES.VALIDATION_FAILED,
        fieldErrors: Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined,
      }),
    };
  }
  if (!hasPerm(ctx.role, "patients:edit")) {
    return { ok: false, error: appError("FORBIDDEN", { message: REGISTER_PATIENT_MESSAGES.FORBIDDEN }) };
  }

  const outcome = await callCommand(
    ctx,
    "register_patient",
    { p_patient: newPatientPayload(parsed.data), p_client_request_id: clientRequestId },
    registerPatientResultSchema,
    REGISTER_PATIENT_MESSAGES,
    { event: "patients.register_patient.failed" }
  );
  if (!outcome.ok) return outcome;
  return { ok: true, value: { patientId: outcome.value.patient_id, replayed: outcome.value.replayed } };
}
