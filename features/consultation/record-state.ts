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
