/**
 * The state of a consultation record (V2-09a R-2): one predicate, in SQL and here.
 *
 *  - `sealed`   signed and not reopened (`signed_at` set, status other than `in_consultation`): nothing about it changes except through
 *               an amendment. The database enforces it for every writer (migration 000107 and the guards before it); the app only explains it.
 *  - `amending` signed and reopened for amendment (`signed_at` set, status `in_consultation`): the content is editable again, the
 *               signature and the revision number are not; the amendment is finalized by `finalize_visit_amendment`.
 *  - `draft`    everything else.
 *
 * Mirrors the six database guards (`visits_integrity_guard`, `clinical_notes_guard`, the Rx item, diagnosis and follow-up guards and
 * `visit_revisions_append_only`, which all read `signed_at IS NOT NULL AND status <> 'in_consultation'`). The parity spec
 * `tests/consultation/record-state-parity.spec.ts` compares the two on real rows; V2-09b's workspace rebuild must keep this contract.
 */
export type RecordState = "draft" | "amending" | "sealed";

export interface RecordStateInput {
  status?: string | null;
  signed_at?: string | null;
}

export function recordState(visit: RecordStateInput): RecordState {
  if (!visit.signed_at) return "draft";
  return visit.status === "in_consultation" ? "amending" : "sealed";
}

/** The one text a sealed refusal shows the caller (V2-09a R-17): fixed, data-free, never the driver's message. */
export const SIGNED_CONSULTATION_MESSAGE =
  "This consultation is already signed. Reopen it for amendment to make changes.";

/** The fixed names the sealing guards raise (SQLSTATE 42501, no row data): migrations 000068 to 000108. */
const SEALED_REFUSAL_NAMES = [
  "CLINICAL_NOTES_VISIT_SIGNED",
  "PRESCRIPTION_ITEM_VISIT_SIGNED",
  "DIAGNOSIS_VISIT_SIGNED",
  "FOLLOW_UP_VISIT_SIGNED",
  "PRESCRIPTION_VISIT_SIGNED",
  "RX_SEALED",
  "VISIT_SIGNED_FIELD_IMMUTABLE",
  "VISIT_SIGNED_STATUS_FORBIDDEN",
  "VISIT_SIGNED_DELETE_FORBIDDEN",
] as const;

/**
 * True when `err` is a refusal by one of the sealing guards: a Postgres or PostgREST error with SQLSTATE 42501 and one of the
 * fixed names. A plain privilege error (also 42501) is not one. Services map it to {@link SIGNED_CONSULTATION_MESSAGE} and never echo the driver text.
 */
export function isSealedRefusal(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { code, message } = err as { code?: unknown; message?: unknown };
  return code === "42501" && typeof message === "string" && SEALED_REFUSAL_NAMES.some((name) => message.includes(name));
}
