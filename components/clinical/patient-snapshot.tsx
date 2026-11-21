import { SmartAssistLabel } from "@/components/clinical/smart-assist-label";
import { vitalCells } from "@/components/clinical/vital-cells";
import { flagWord } from "@/lib/clinical/vitals";
import { snapshotText, type PatientSnapshot } from "@/features/consultation/snapshot";
import { cn } from "@/lib/utils";

/**
 * The patient snapshot (V2-09b 09B-04a, R-13, AI-10; AI §5.2 SA-04), a deterministic template over `public.patient_snapshot`: "Last seen 12 Oct 2026 · Dr Rao",
 * its diagnoses and signed Rx lines, earlier visits, "Due follow-up 3 Nov 2026 (no visit since)" and the latest measured vitals with their range flags
 * (when the clinic has `assist.vitals`, AI-16). Smart Assist label, never "AI". Used in the consult's patient column and in Today's doctor mode beside the
 * Next card. Reads only: nothing here edits the record.
 */
export interface PatientSnapshotViewProps {
  snapshot: PatientSnapshot;
  /** `assist.vitals`: a flagged value is drawn in the danger colour with its word. */
  flags: boolean;
  className?: string;
}

export function PatientSnapshotView({ snapshot, flags, className }: PatientSnapshotViewProps) {
  const text = snapshotText(snapshot);
  const cells = text.vitals ? vitalCells({ ...text.vitals.values }) : [];
  return (
    <div data-patient-snapshot="" className={cn("flex flex-col gap-2.5", className)}>
      <p className="flex items-center gap-2 text-label">
        <SmartAssistLabel />
        <span className="text-fg-muted">from signed visits</span>
      </p>
      {text.lastSeen ? (
        <div className="flex flex-col gap-1">
          <p className="text-body-sm font-medium text-fg">{text.lastSeen}</p>
          {text.diagnoses.length > 0 && <p className="text-body-sm text-fg-secondary">{text.diagnoses.join(", ")}</p>}
          {text.rx.length > 0 && (
            <ul aria-label="Medicines at the last visit" className="flex flex-col gap-0.5 text-label text-fg-secondary tabular-nums">
              {text.rx.map((line, i) => (
                <li key={`${line}-${i}`}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-body-sm text-fg-secondary">First visit in this clinic</p>
      )}
      {text.due.map((line) => (
        <p key={line} data-snapshot-due="" className="text-body-sm font-medium text-warning-fg">
          {line}
        </p>
      ))}
      {text.vitals && (
        <div>
          <p className="mb-1 text-caption text-fg-muted">{text.vitals.label}</p>
          <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5">
            {cells
              .filter((c) => c.value !== null)
              .map((cell) => {
                const word = flags ? flagWord(cell.flag) : null;
                return (
                  <div key={cell.label}>
                    <dt className="text-caption text-fg-muted">{cell.label}</dt>
                    <dd className={cn("text-body-sm font-semibold tabular-nums", word ? "text-danger-fg" : "text-fg")}>
                      {cell.value}
                      {word ? <span className="text-caption font-medium"> · {word.toLowerCase()}</span> : null}
                    </dd>
                  </div>
                );
              })}
          </dl>
        </div>
      )}
      {text.earlier.length > 0 && (
        <ul aria-label="Earlier visits" className="flex flex-col gap-0.5 border-t border-border pt-2 text-label text-fg-muted tabular-nums">
          {text.earlier.map((line, i) => (
            <li key={`${line}-${i}`}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
