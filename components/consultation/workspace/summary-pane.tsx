"use client";

import type { ReactNode } from "react";
import type { ChiefComplaintItem, SpecialtyData } from "@/features/consultation/schema";
import type { ConsultationDiagnosisItem } from "@/features/terminology/schema";
import type { PrescriptionItem } from "@/lib/db/types";
import { formatClinicDateWithWeekday } from "@/lib/datetime/format";
import { ResponsiveSheet, ResponsiveSheetBody, ResponsiveSheetContent, ResponsiveSheetHeader } from "@/components/ui/responsive-sheet";
import { Caption } from "./patient-context";

/**
 * The summary pane (06-UI-SPEC §7, V2-09b 09B-02b): a read-only rendering of the draft on screen, "as the patient will see it": complaints, findings,
 * diagnoses, Rx lines, investigations, advice and the follow-up date in the clinic zone. 272 px from 1280 px (closed by default to 1439, open from
 * 1440, the "Summary" toggle); a drawer below 1280 px (from the Finish bar). It edits nothing, and it is built from the in-memory draft, not from the
 * server copy, so it shows what the doctor typed a moment ago.
 */
export interface SummaryContent {
  complaints: readonly ChiefComplaintItem[];
  specialtyData: SpecialtyData | null;
  diagnoses: readonly ConsultationDiagnosisItem[];
  rxItems: readonly PrescriptionItem[];
  investigations: readonly string[];
  advice: readonly string[];
  /** `YYYY-MM-DD` of the follow-up, or null for none. */
  followUpDate: string | null;
}

const PICCLE_LABEL: Record<string, string> = {
  pallor: "Pallor",
  icterus: "Icterus",
  cyanosis: "Cyanosis",
  clubbing: "Clubbing",
  lymphadenopathy: "Lymphadenopathy",
  edema: "Edema",
};

/** The findings lines of the exam: the general signs present, the systemic texts typed, the teeth recorded. */
export function findingLines(data: SpecialtyData | null): string[] {
  if (!data) return [];
  if (data.specialty === "general_physician") {
    const lines: string[] = [];
    const signs = Object.entries(data.general_exam ?? {})
      .filter(([, present]) => present === true)
      .map(([key]) => PICCLE_LABEL[key] ?? key);
    if (signs.length > 0) lines.push(`Signs: ${signs.join(", ")}`);
    for (const [key, label] of [["gen", "General"], ["ent", "ENT"], ["cvs", "CVS"], ["rs", "RS"], ["pa", "PA"], ["cns", "CNS"]] as const) {
      const text = data.systemic?.[key]?.trim();
      if (text) lines.push(`${label}: ${text}`);
    }
    return lines;
  }
  if (data.specialty === "dental") {
    const lines = data.odontogram?.map((t) => `Tooth ${t.tooth_number}: ${t.condition_tags.join(", ")}`) ?? [];
    if (data.general_notes?.trim()) lines.push(data.general_notes.trim());
    return lines;
  }
  return [];
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <Caption>{title}</Caption>
      {children}
    </section>
  );
}

function Lines({ items }: { items: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-0.5 text-body-sm text-fg">
      {items.map((item, i) => (
        <li key={`${item}-${i}`}>{item}</li>
      ))}
    </ul>
  );
}

export function SummaryBody({ content }: { content: SummaryContent }) {
  const complaints = content.complaints.map((c) => `${c.symptom}${c.duration_val ? ` (${c.duration_val} ${c.duration_unit})` : ""}`);
  const findings = findingLines(content.specialtyData);
  const rx = content.rxItems.map((item) => `${item.medicine_name} · ${item.dosage} · ${item.duration}`);
  const empty = complaints.length + findings.length + content.diagnoses.length + rx.length + content.investigations.length + content.advice.length === 0 && !content.followUpDate;
  return (
    <div data-summary-body="" className="flex flex-col gap-4">
      {empty ? <p className="text-body-sm text-fg-muted">Nothing to show yet. What you add appears here as the patient will see it.</p> : null}
      {complaints.length > 0 && (
        <Block title="Complaints">
          <Lines items={complaints} />
        </Block>
      )}
      {findings.length > 0 && (
        <Block title="Findings">
          <Lines items={findings} />
        </Block>
      )}
      {content.diagnoses.length > 0 && (
        <Block title="Diagnosis">
          <Lines items={content.diagnoses.map((d) => d.diagnosis_name)} />
        </Block>
      )}
      {rx.length > 0 && (
        <Block title="Medicines">
          <Lines items={rx} />
        </Block>
      )}
      {content.investigations.length > 0 && (
        <Block title="Tests">
          <Lines items={content.investigations} />
        </Block>
      )}
      {content.advice.length > 0 && (
        <Block title="Advice">
          <Lines items={content.advice} />
        </Block>
      )}
      {content.followUpDate ? (
        <Block title="Follow-up">
          <p className="text-body-sm text-fg">{formatClinicDateWithWeekday(content.followUpDate)}</p>
        </Block>
      ) : null}
    </div>
  );
}

/** The pane beside the note (1280 px and up; the workspace decides whether it is open). */
export function SummaryPane({ content }: { content: SummaryContent }) {
  return (
    <aside
      aria-label="Summary"
      data-summary-pane=""
      className="hidden min-h-0 w-assist-pane shrink-0 overflow-y-auto overscroll-contain border-l border-border bg-surface px-4 pt-3.5 pb-6 xl:block"
    >
      <p className="mb-3 text-label font-semibold text-fg-secondary">Summary · as the patient will see it</p>
      <SummaryBody content={content} />
    </aside>
  );
}

/** Below 1280 px: the same content in a drawer (opened from the Finish bar on a phone). */
export function SummarySheet({ open, onOpenChange, content }: { open: boolean; onOpenChange: (open: boolean) => void; content: SummaryContent }) {
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent data-summary-sheet="">
        <ResponsiveSheetHeader title="Summary" description="As the patient will see it" />
        <ResponsiveSheetBody>
          <SummaryBody content={content} />
        </ResponsiveSheetBody>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
