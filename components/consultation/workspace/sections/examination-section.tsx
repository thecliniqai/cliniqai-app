"use client";

import React, { useState } from "react";
import type { ChiefComplaintItem, ClinicalSpecialty, GPSpecialty, SpecialtyData } from "@/features/consultation/schema";
import { EXAM_SIDES } from "@/features/consultation/schema";
import { GENERAL_SIGNS } from "@/features/consultation/catalogue";
import { EXAM_TEMPLATES, examTemplateById } from "@/features/consultation/exam-templates";
import {
  examHasData,
  gpDataHasContent,
  newExam,
  setSystemAbnormal,
  setSystemNote,
  setSystemSide,
  systemText,
  setFindings,
  withExam,
} from "@/features/consultation/exam-text";
import { rankTemplates, type AssistContext } from "@/features/consultation/assist-ranking";
import { ChipGroup } from "@/components/ui/chip-group";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SmartAssistLabel } from "@/components/clinical/smart-assist-label";
import { cn } from "@/lib/utils";

/**
 * The Examination section's template and findings (06-UI-SPEC §7; V2-09b 09B-03, R-9). The exam is entered by taps: a template tile starts every system
 * of the template as normal, "Abnormal" opens the finding tiles of a system (with a side where it matters and a note), and the general signs are
 * tiles. The result is `specialty_data.exam`, mirrored into the `systemic` texts (features/consultation/exam-text.ts). Nothing is diagnostic and nothing
 * is chosen for the doctor.
 *
 * Dental and Child are templates that switch the visit's specialty to the existing odontogram and paediatrics tools (`children`): switching asks first when
 * the findings entered so far would be removed. The vitals editor above this section is the v1 vitals block, unchanged.
 */

export interface ExaminationSectionProps {
  specialty: ClinicalSpecialty;
  specialtyData: SpecialtyData | null;
  readOnly: boolean;
  /** The complaint names added so far (they order the template tiles). */
  complaints: readonly ChiefComplaintItem[];
  /** The calling doctor's learned order (null: the catalogue order, no label). */
  context?: AssistContext | null;
  /** Sets the visit's specialty and its specialty data together (a switch clears the data; a template or a sign changes it). */
  onChange: (specialty: ClinicalSpecialty, data: SpecialtyData | null) => void;
  /** The odontogram or the paediatrics tools, for the visit's specialty when it is not general physician. */
  children?: React.ReactNode;
}

/** The older records' free-text systemic findings, shown while no template exam exists (the exam replaces them once one is chosen). */
const LEGACY_SYSTEMS = [
  { key: "gen", label: "General" },
  { key: "ent", label: "ENT" },
  { key: "cvs", label: "Cardiovascular System (CVS)" },
  { key: "rs", label: "Respiratory System (RS)" },
  { key: "pa", label: "Per Abdomen (PA)" },
  { key: "cns", label: "Central Nervous System (CNS)" },
] as const;

type Confirm = { title: string; description: string; apply: () => void } | null;

function specialtyHasContent(specialty: ClinicalSpecialty, data: SpecialtyData | null): boolean {
  if (!data || data.specialty !== specialty) return false;
  if (data.specialty === "general_physician") return gpDataHasContent(data);
  if (data.specialty === "dental") return (data.odontogram?.length ?? 0) > 0 || (data.general_notes?.trim() ?? "") !== "";
  const birth = data.birth_history;
  return (
    data.head_circumference_cm != null ||
    (data.immunizations_given?.length ?? 0) > 0 ||
    (!!birth && Object.values(birth).some((v) => v !== null && v !== undefined && v !== ""))
  );
}

const SPECIALTY_NAME: Record<ClinicalSpecialty, string> = { general_physician: "general", dental: "Dental", pediatrics: "Child" };

function gpOf(data: SpecialtyData | null): GPSpecialty | undefined {
  return data?.specialty === "general_physician" ? data : undefined;
}

export function ExaminationSection({ specialty, specialtyData, readOnly, complaints, context = null, onChange, children }: ExaminationSectionProps) {
  const [confirm, setConfirm] = useState<Confirm>(null);
  const gp = specialty === "general_physician" ? gpOf(specialtyData) : undefined;
  const exam = gp?.exam ?? null;
  const template = examTemplateById(exam?.template_id);

  const ranked = rankTemplates({ templates: EXAM_TEMPLATES, context, added: complaints.map((c) => c.symptom) });
  const anySuggested = ranked.some((r) => r.suggested);
  const selectedId = specialty === "dental" ? "dental" : specialty === "pediatrics" ? "child" : (exam?.template_id ?? "");

  const ask = (title: string, description: string, apply: () => void) => setConfirm({ title, description, apply });

  const selectTemplate = (id: string) => {
    const next = examTemplateById(id);
    if (!next || id === selectedId) return;
    if (next.specialty) {
      const target: ClinicalSpecialty = next.specialty;
      const doSwitch = () => onChange(target, null);
      if (specialtyHasContent(specialty, specialtyData)) {
        ask(
          `Switch to ${next.name}?`,
          `The ${SPECIALTY_NAME[specialty]} findings entered so far will be removed from this note.`,
          doSwitch,
        );
      } else doSwitch();
      return;
    }
    const start = () => onChange("general_physician", withExam(specialty === "general_physician" ? gpOf(specialtyData) : undefined, newExam(next)));
    const losing = specialty === "general_physician" ? examHasData(exam) : specialtyHasContent(specialty, specialtyData);
    if (losing) {
      ask(`Switch to ${next.name}?`, "The findings entered for the current template will be cleared. The general signs are kept.", start);
    } else start();
  };

  const clearTemplate = () => {
    const clear = () => onChange("general_physician", withExam(gp, null));
    if (examHasData(exam)) ask("Clear the template?", "The findings entered for it will be cleared. The general signs are kept.", clear);
    else clear();
  };

  const updateExam = (change: (current: NonNullable<typeof exam>) => NonNullable<typeof exam>) => {
    if (!exam) return;
    onChange("general_physician", withExam(gp, change(exam)));
  };

  const generalExam = {
    pallor: false,
    icterus: false,
    cyanosis: false,
    clubbing: false,
    lymphadenopathy: false,
    edema: false,
    ...(gp?.general_exam ?? {}),
  };
  const presentSigns = GENERAL_SIGNS.filter((s) => generalExam[s.key]).map((s) => s.key as string);

  const legacy = !exam && gp?.systemic ? LEGACY_SYSTEMS.filter((s) => (gp.systemic?.[s.key] ?? "").trim() !== "") : [];

  return (
    <div className="flex flex-col gap-5">
      <div data-exam-templates="" data-smart-assist={anySuggested ? "on" : "off"}>
        <p className="mb-2 flex flex-wrap items-center gap-x-2 text-label font-semibold text-fg-secondary">
          Template
          <span aria-hidden="true">·</span>
          <span className="font-normal text-fg-muted">all findings start normal</span>
          {anySuggested && (
            <>
              <span aria-hidden="true">·</span>
              <SmartAssistLabel />
            </>
          )}
        </p>
        <ChipGroup
          type="single"
          variant="tile"
          aria-label="Examination template"
          disabled={readOnly}
          value={selectedId}
          onValueChange={selectTemplate}
          items={ranked.map((r) => ({ value: r.template.id, label: r.template.name, meta: r.suggested ? "suggested" : undefined }))}
        />
      </div>

      {specialty === "general_physician" && exam && template && (
        <div data-exam="" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-body-sm">
            <span>
              <b className="font-semibold text-fg">{template.name}</b>
              <span className="text-fg-muted"> · {template.systems.length} systems, all normal unless marked</span>
            </span>
            {!readOnly && (
              <Button type="button" variant="ghost" size="sm" onClick={clearTemplate}>
                Clear template
              </Button>
            )}
          </div>
          {template.systems.map((def) => {
            const state = exam.systems[def.key] ?? { abnormal: false, findings: [], side: null, note: null };
            return (
              <div
                key={def.key}
                data-exam-system={def.key}
                data-abnormal={state.abnormal ? "true" : "false"}
                className={cn("flex flex-col gap-2 rounded-md border bg-surface px-3 py-2.5", state.abnormal ? "border-finding-abnormal-border" : "border-border")}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-label font-semibold text-fg-secondary">{def.label}</p>
                    <p data-exam-text="" className="text-body-sm text-fg">
                      {systemText(def, state).replace(/^(Normal|Abnormal): /, "")}
                    </p>
                  </div>
                  <SegmentedControl
                    aria-label={`${def.label} finding`}
                    disabled={readOnly}
                    value={state.abnormal ? "abnormal" : "normal"}
                    onValueChange={(v) => updateExam((e) => setSystemAbnormal(e, def.key, v === "abnormal"))}
                    options={[
                      { value: "normal", label: "Normal" },
                      { value: "abnormal", label: "Abnormal" },
                    ]}
                  />
                </div>
                {state.abnormal && (
                  <div className="flex flex-col gap-2">
                    <ChipGroup
                      type="multiple"
                      variant="tile"
                      abnormal
                      aria-label={`${def.label} findings`}
                      disabled={readOnly}
                      value={state.findings}
                      onValueChange={(next) => updateExam((e) => setFindings(e, def.key, next))}
                      items={def.findings.map((f) => ({ value: f, label: f }))}
                    />
                    {def.side && (
                      <div className="flex items-center gap-2">
                        <span className="text-label text-fg-muted">Side</span>
                        <ChipGroup
                          type="single"
                          variant="option"
                          aria-label={`${def.label} side`}
                          disabled={readOnly}
                          value={state.side ?? ""}
                          onValueChange={(side) => updateExam((e) => setSystemSide(e, def.key, side as (typeof EXAM_SIDES)[number]))}
                          items={EXAM_SIDES.map((s) => ({ value: s, label: s }))}
                        />
                      </div>
                    )}
                    <Input
                      type="text"
                      aria-label={`${def.label} note`}
                      placeholder="Add a note (optional)"
                      maxLength={200}
                      disabled={readOnly}
                      value={state.note ?? ""}
                      onChange={(e) => updateExam((x) => setSystemNote(x, def.key, e.target.value))}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {legacy.length > 0 && gp && (
        <div data-exam-legacy="" className="flex flex-col gap-2">
          <p className="text-label font-semibold text-fg-secondary">Examination findings entered as text</p>
          {legacy.map((s) => (
            <div key={s.key} className="flex flex-col gap-1">
              <label htmlFor={`exam-${s.key}`} className="text-label text-fg-muted">
                {s.label}
              </label>
              <Textarea
                id={`exam-${s.key}`}
                rows={2}
                disabled={readOnly}
                value={gp.systemic?.[s.key] ?? ""}
                onChange={(e) => onChange("general_physician", { ...gp, systemic: { ...gp.systemic, [s.key]: e.target.value } })}
              />
            </div>
          ))}
        </div>
      )}

      {specialty === "general_physician" && (
        <div data-general-signs="">
          <p className="mb-2 text-label font-semibold text-fg-secondary">General signs · tap any that are present</p>
          <ChipGroup
            type="multiple"
            variant="tile"
            abnormal
            aria-label="General signs"
            disabled={readOnly}
            value={presentSigns}
            onValueChange={(next) => {
              const updated = { ...generalExam };
              for (const s of GENERAL_SIGNS) updated[s.key] = next.includes(s.key);
              onChange("general_physician", { ...(gp ?? { specialty: "general_physician" }), specialty: "general_physician", general_exam: updated });
            }}
            items={GENERAL_SIGNS.map((s) => ({ value: s.key, label: s.label }))}
          />
        </div>
      )}

      {specialty !== "general_physician" && children}

      <AlertDialog open={confirm !== null}>
        <AlertDialogContent onEscapeKeyDown={() => setConfirm(null)}>
          <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm?.description}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirm(null)}>Keep what I entered</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                confirm?.apply();
                setConfirm(null);
              }}
            >
              Switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
