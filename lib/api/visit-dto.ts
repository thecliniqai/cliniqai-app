import { CLINICAL_NOTE_FIELDS } from "@/lib/db/clinical-notes";

/**
 * What `/api/v1/visits/*` reads and returns (V2-05 05a review M-APINOTES: IND M5, RLS L-2; plan 05-11c).
 *
 * API keys are created by admins (`clinic:manage`), and admins hold no clinical permission (ruling R-9), so the key
 * principal has no clinical access either: the visit routes select only these columns (never `clinical_notes`, never
 * the six cleared `visits` clinical columns), and refuse a body that carries clinical content or signs the visit. A
 * clinical API scope is a P1-37 decision.
 */
export const V1_VISIT_COLUMNS = [
  "id",
  "tenant_id",
  "patient_id",
  "doctor_id",
  "origin_type",
  "status",
  "scheduled_at",
  "estimated_duration_minutes",
  "reason_for_visit",
  "is_overbooked",
  "specialty",
  "created_by",
  "created_at",
  "updated_at",
  "signed_at",
  "signed_by",
].join(", ");

/** Body fields that are clinical content (the `clinical_notes` columns). */
export const V1_CLINICAL_BODY_FIELDS: readonly string[] = CLINICAL_NOTE_FIELDS;

/** Fixed `/api/v1` answer for clinical content or a sign-off through an API key (403). */
export const CLINICAL_ACCESS_DENIED = {
  code: "CLINICAL_ACCESS_DENIED",
  message:
    "API keys have no clinical access: vitals, complaints, notes, advice and investigations cannot be read or written, and a visit cannot be completed (signed) through /api/v1.",
} as const;

/** True when `body` carries any clinical field (present with any value, `null` included). */
export function hasClinicalField(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return V1_CLINICAL_BODY_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(body, field));
}
