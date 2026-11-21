import type { ReactNode } from "react";
import type { PastVisitEncounter } from "@/features/consultation/actions";
import type { Vitals } from "@/features/consultation/schema";
import { flagWord } from "@/lib/clinical/vitals";
import { vitalCells } from "@/components/clinical/vital-cells";
import { PatientSnapshotView } from "@/components/clinical/patient-snapshot";
import type { PatientSnapshot } from "@/features/consultation/snapshot";
import { cn } from "@/lib/utils";
import { clinicDateLabel } from "./format";
import { HistoryList, type HistoryListProps } from "./history-list";

/**
 * The patient's context (06-UI-SPEC §7, V2-09b 09B-02b): the same content in the patient column (1180 px and up) and in the Patient sheet (768 to 1179
 * from the top bar, below 768 from the Finish bar). Sections with uppercase caption headings: identity, vitals grid, allergies, problems, last
 * visit, history. A read-only view of what is on screen: the vitals follow the draft; nothing here edits the record.
 */
export interface PatientContextProps {
  patient: {
    full_name: string;
    gender: "male" | "female" | "other" | null;
    phone: string;
    uhid?: string | null;
    age: string | null;
    allergies?: string[] | null;
    chronic_conditions?: string[];
  };
  /** The vitals on screen (the draft's). */
  vitals: Vitals | null;
  /** `assist.vitals` (AI-16): a flagged value is drawn in the danger colour with its word ("· high"). Not entitled: plain values. */
  flags: boolean;
  /** The deterministic snapshot (`assist.snapshot`, 09B-04a); when present it replaces the plain last-visit block. */
  snapshot?: PatientSnapshot | null;
  encounters: readonly PastVisitEncounter[];
  timeZone: string;
  onRepeatRx?: HistoryListProps["onRepeatRx"];
  onCopyNotes?: HistoryListProps["onCopyNotes"];
}

export function Caption({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 id={id} className="mb-1.5 text-caption font-semibold tracking-caps text-fg-muted uppercase">
      {children}
    </h3>
  );
}

export function PatientContext({ patient, vitals, flags, snapshot = null, encounters, timeZone, onRepeatRx, onCopyNotes }: PatientContextProps) {
  const last = encounters[0];
  const allergies = patient.allergies;
  const conditions = patient.chronic_conditions ?? [];
  const meta = [patient.age, patient.gender ? { male: "M", female: "F", other: "O" }[patient.gender] : null, patient.uhid ? `ID ${patient.uhid}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div data-patient-context="" className="flex flex-col gap-5">
      <section aria-label="Identity">
        <p className="text-body-md font-semibold text-fg">{patient.full_name}</p>
        {meta ? <p className="text-label text-fg-muted tabular-nums">{meta}</p> : null}
        {patient.phone ? <p className="text-label text-fg-muted tabular-nums">{patient.phone}</p> : null}
      </section>

      <section aria-labelledby="pc-vitals">
        <Caption id="pc-vitals">Vitals</Caption>
        <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
          {vitalCells(vitals).map((cell) => {
            const word = flags ? flagWord(cell.flag) : null;
            return (
              <div key={cell.label}>
                <dt className="text-caption text-fg-muted">{cell.label}</dt>
                <dd className={cn("text-body-md font-semibold tabular-nums", word ? "text-danger-fg" : "text-fg")}>
                  {cell.value ?? <span className="font-normal text-fg-muted">–</span>}
                  {word ? <span className="text-caption font-medium"> · {word.toLowerCase()}</span> : null}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section aria-labelledby="pc-allergies">
        <Caption id="pc-allergies">Allergies</Caption>
        <p className={cn("text-body-sm", allergies && allergies.length > 0 ? "font-semibold text-danger-fg" : "text-fg-secondary")}>
          {allergies && allergies.length > 0 ? allergies.join(", ") : allergies ? "No known allergies" : "Not recorded"}
        </p>
      </section>

      <section aria-labelledby="pc-problems">
        <Caption id="pc-problems">Problems</Caption>
        <p className="text-body-sm text-fg-secondary">{conditions.length > 0 ? conditions.join(", ") : "None recorded"}</p>
      </section>

      {snapshot ? (
        <section aria-labelledby="pc-snapshot">
          <Caption id="pc-snapshot">Snapshot</Caption>
          <PatientSnapshotView snapshot={snapshot} flags={flags} />
        </section>
      ) : (
        <section aria-labelledby="pc-last">
          <Caption id="pc-last">Last visit</Caption>
          {last ? (
            <p className="text-body-sm text-fg-secondary">
              <span className="font-medium text-fg">{clinicDateLabel(last.date, timeZone)}</span>
              {last.diagnoses.length > 0 ? ` · ${last.diagnoses.map((d) => d.diagnosis_name).join(", ")}` : ""}
              {last.prescriptions[0] ? ` · ${last.prescriptions[0].items.length} ${last.prescriptions[0].items.length === 1 ? "medicine" : "medicines"}` : ""}
            </p>
          ) : (
            <p className="text-body-sm text-fg-secondary">First visit in this clinic</p>
          )}
        </section>
      )}

      <section aria-labelledby="pc-history">
        <Caption id="pc-history">History{encounters.length > 0 ? ` (${encounters.length})` : ""}</Caption>
        <HistoryList encounters={encounters} timeZone={timeZone} onRepeatRx={onRepeatRx} onCopyNotes={onCopyNotes} />
      </section>
    </div>
  );
}
