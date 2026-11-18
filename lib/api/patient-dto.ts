/**
 * What `/api/v1/patients/*` may write (V2-05 05a re-verification N-6; plan 05-11d).
 *
 * `allergies` and `chronic_conditions` are clinical fields: in the app, changing them needs `consultations:view`
 * (`patients_clinical_fields_guard`, R-8), which admins do not hold. API keys are created by admins and hold no clinical
 * access (R-9, as for `/api/v1/visits`), and the v1 routes write with the system client, where the guard does not run.
 * So a PUT that carries either field is refused with 403, never applied or silently dropped. A clinical API scope
 * (read and write) is a P1-37 decision.
 */
export const V1_PATIENT_CLINICAL_FIELDS: readonly string[] = ["allergies", "chronic_conditions"];

/** Fixed `/api/v1` answer for a clinical patient field written through an API key (403). */
export const PATIENT_CLINICAL_ACCESS_DENIED = {
  code: "CLINICAL_ACCESS_DENIED",
  message:
    "API keys have no clinical access: allergies and chronic conditions cannot be changed through /api/v1.",
} as const;

/** True when `body` carries a clinical patient field (present with any value, `null` included). */
export function hasPatientClinicalField(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return V1_PATIENT_CLINICAL_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(body, field));
}
