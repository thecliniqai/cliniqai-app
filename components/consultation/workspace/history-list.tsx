"use client";

import { Copy, Pill, RotateCcw } from "lucide-react";
import type { PastVisitEncounter } from "@/features/consultation/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/variants";
import { clinicDateLabel } from "./format";

/**
 * The patient's past encounters (V2-09b 09B-02b; replaces the v1 history drawer): date in the clinic zone, vitals, complaints, diagnoses, notes with
 * "Copy" and the signed Rx with "Repeat this Rx". The two actions are passed only while the record is editable. "Repeat this Rx" is offered for a signed visit
 * and is one `repeat_visit_plan` command (V2-09c R-10: the database copies the signed lines); Copy appends the prior note to the note field.
 */
export interface HistoryListProps {
  encounters: readonly PastVisitEncounter[];
  timeZone: string;
  /** Repeats the Rx of the signed visit `sourceVisitId` as one command (V2-09c R-10). */
  onRepeatRx?: (sourceVisitId: string) => void;
  onCopyNotes?: (notes: string) => void;
}

const SPECIALTY_LABEL: Record<string, string> = { dental: "Dental", pediatrics: "Pediatrics" };

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="mb-1 text-caption font-semibold tracking-caps text-fg-muted uppercase">{children}</p>;
}

export function HistoryList({ encounters, timeZone, onRepeatRx, onCopyNotes }: HistoryListProps) {
  if (encounters.length === 0) {
    return (
      <div data-history-empty="">
        <p className="text-body-sm font-medium text-fg">No past consultations</p>
        <p className="mt-0.5 text-label text-fg-muted">This patient has no recorded prior consultations or prescriptions in this clinic.</p>
      </div>
    );
  }
  return (
    <ol data-history-list="" className="flex flex-col gap-3">
      {encounters.map((enc) => {
        const rx = enc.prescriptions?.[0];
        const vitals = enc.vitals;
        return (
          <li key={enc.visitId} className="flex flex-col gap-2.5 rounded-md border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-body-sm font-semibold text-fg">{clinicDateLabel(enc.date, timeZone)}</span>
              <span className="text-label text-fg-muted">{SPECIALTY_LABEL[enc.specialty] ?? "General physician"}</span>
            </div>

            {vitals && (vitals.systolic || vitals.pulse || vitals.temperature || vitals.weight) ? (
              <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-label text-fg-secondary tabular-nums">
                {vitals.systolic && vitals.diastolic ? <span>BP {vitals.systolic}/{vitals.diastolic}</span> : null}
                {vitals.pulse ? <span>Pulse {vitals.pulse}</span> : null}
                {vitals.temperature ? <span>Temp {vitals.temperature}°F</span> : null}
                {vitals.weight ? <span>Weight {vitals.weight} kg</span> : null}
              </p>
            ) : null}

            {enc.chiefComplaints && enc.chiefComplaints.length > 0 ? (
              <div>
                <Caption>Complaints</Caption>
                <p className="text-body-sm text-fg">
                  {enc.chiefComplaints.map((c) => `${c.symptom}${c.duration_val ? ` (${c.duration_val} ${c.duration_unit})` : ""}`).join(", ")}
                </p>
              </div>
            ) : null}

            {enc.diagnoses && enc.diagnoses.length > 0 ? (
              <div>
                <Caption>Diagnoses</Caption>
                <p className="text-body-sm text-fg">
                  {enc.diagnoses.map((d) => `${d.diagnosis_name}${d.icd11_code ? ` (${d.icd11_code})` : ""}`).join(", ")}
                </p>
              </div>
            ) : null}

            {enc.clinicalNotes ? (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <Caption>Notes</Caption>
                  {onCopyNotes && (
                    <button
                      type="button"
                      onClick={() => onCopyNotes(enc.clinicalNotes!)}
                      aria-label={`Copy notes of ${clinicDateLabel(enc.date, timeZone)}`}
                      className={cn(
                        "mb-1 inline-flex min-h-6 cursor-pointer items-center gap-1 rounded-sm px-1 text-label font-medium text-accent-fg hover:underline max-lg:min-h-control max-lg:min-w-control",
                        FOCUS_RING,
                      )}
                    >
                      <Copy aria-hidden="true" className="size-3" /> Copy
                    </button>
                  )}
                </div>
                <p className="line-clamp-4 text-body-sm whitespace-pre-wrap text-fg-secondary">{enc.clinicalNotes}</p>
              </div>
            ) : null}

            {rx ? (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <Caption>
                    <span className="inline-flex items-center gap-1">
                      <Pill aria-hidden="true" className="size-3" />
                      Prescription (v{rx.version})
                    </span>
                  </Caption>
                  {onRepeatRx && rx.items.length > 0 && enc.status === "completed" && enc.signedAt && (
                    <Button type="button" variant="secondary" size="sm" startIcon={<RotateCcw />} onClick={() => onRepeatRx(enc.visitId)}>
                      Repeat this Rx
                    </Button>
                  )}
                </div>
                <ul className="flex flex-col gap-1">
                  {rx.items.map((item, i) => (
                    <li key={item.id || i} className="flex items-baseline justify-between gap-2 rounded-sm bg-surface-soft px-2 py-1 text-label">
                      <span className="font-medium text-fg">{item.medicine_name}</span>
                      <span className="shrink-0 text-fg-secondary">
                        {item.dosage} · {item.duration}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
