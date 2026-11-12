import type { RecordVitalsInput, SaveConsultationDraftInput } from "@/features/consultation/schema";

/**
 * Typed input builders for service calls (V2-02 plan 02-04).
 *
 * The services take the schemas' parsed (output) types, so fields with a zod `.default(...)` are required at the
 * type level. The builders fill them with exactly the defaults the schema would apply, so runtime behaviour is the
 * same as sending a partial object, and a schema change surfaces here as a type error instead of being hidden.
 */

type DraftOverrides = Pick<SaveConsultationDraftInput, "visit_id"> & Partial<SaveConsultationDraftInput>;

/** A `saveConsultationDraft` input with the schema defaults filled in. */
export function consultationDraftInput(overrides: DraftOverrides): SaveConsultationDraftInput {
  return {
    chief_complaints: [],
    specialty: "general_physician",
    investigations_advised: [],
    advice: [],
    ...overrides,
  };
}

/**
 * Vitals carrying a caller-chosen `recorded_by`, which is NOT an input field (ADR-0005 D1, SEC-02: the recorder is
 * always the session user and zod strips a caller-sent value). Only for tests that assert the server ignores it;
 * the cast is deliberate so the forged field reaches the service exactly as a malicious client would send it.
 */
export function vitalsWithForgedRecorder(vitals: RecordVitalsInput, recordedBy: string): RecordVitalsInput {
  return { ...vitals, recorded_by: recordedBy } as unknown as RecordVitalsInput;
}
