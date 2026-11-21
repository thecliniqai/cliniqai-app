import { PatientSnapshotView } from "@/components/clinical/patient-snapshot";
import type { PatientSnapshot } from "@/features/consultation/snapshot";

/**
 * The snapshot of the Next patient, beside the Next card in Today's doctor mode (V2-09b 09B-04a, R-13, AI-10; the V2-08 hand-off). 768 px and up; below it
 * the consult's own patient context has the same lines. Deterministic (`public.patient_snapshot`), gated by `assist.snapshot`: not entitled, the panel is not
 * drawn at all.
 */
export interface SnapshotPanelData {
  patientId: string;
  snapshot: PatientSnapshot;
  /** `assist.vitals`: range flags on the latest vitals. */
  flags: boolean;
}

export function PatientSnapshotPanel({ name, data }: { name: string; data: SnapshotPanelData }) {
  return (
    <aside aria-label="Patient snapshot" data-snapshot-panel="" className="hidden rounded-lg border border-border bg-surface px-4 py-3.5 md:block">
      <p className="mb-2 text-caption font-semibold tracking-caps text-fg-muted uppercase">Snapshot · {name}</p>
      <PatientSnapshotView snapshot={data.snapshot} flags={data.flags} />
    </aside>
  );
}
