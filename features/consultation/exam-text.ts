import type { ExamState, ExamSystemState, GPSpecialty } from "./schema";
import { examTemplateById, type ExamSystemDef, type ExamTemplate } from "./exam-templates";

/**
 * Pure helpers of the structured exam (V2-09b 09B-03, R-9): building and editing `specialty_data.exam`, and mirroring it into the `systemic` texts and
 * leaving `general_exam` alone, so every reader that predates the exam (the summary pane, the DPDP export, an older build) keeps working.
 * No React, no I/O.
 *
 * The mirrored text of a system is, while it is normal, "Normal: <the template's normal text>"; once marked abnormal,
 * "Abnormal: <findings, comma separated> (<side>) · <note>" with the parts that are empty left out, and "Abnormal" alone when nothing was chosen.
 */

/** `systemic` keys the mirror writes. A template system with another key (`oral`) is not mirrored. */
export const MIRRORED_SYSTEMS = ["gen", "ent", "cvs", "rs", "pa", "cns"] as const;
type MirroredSystem = (typeof MIRRORED_SYSTEMS)[number];

const SYSTEMIC_MAX = 500;

export function normalSystem(): ExamSystemState {
  return { abnormal: false, findings: [], side: null, note: null };
}

/** A fresh exam for a template: every system starts normal ("all findings start normal"). */
export function newExam(template: ExamTemplate): ExamState {
  const systems: Record<string, ExamSystemState> = {};
  for (const system of template.systems) systems[system.key] = normalSystem();
  return { template_id: template.id, systems };
}

/** The text of one system for the note. */
export function systemText(def: ExamSystemDef, state: ExamSystemState | undefined): string {
  if (!state || !state.abnormal) return `Normal: ${def.normal}`;
  const found = state.findings.join(", ");
  const withSide = found && state.side ? `${found} (${state.side})` : found;
  const note = state.note?.trim() ?? "";
  const parts = [withSide, note].filter((p) => p.length > 0);
  return parts.length === 0 ? "Abnormal" : `Abnormal: ${parts.join(" · ")}`;
}

/** Does the exam hold anything the doctor entered (an abnormal system, a finding or a note)? Switching or clearing a template asks first when it does. */
export function examHasData(exam: ExamState | null | undefined): boolean {
  if (!exam) return false;
  return Object.values(exam.systems).some((s) => s.abnormal || s.findings.length > 0 || (s.note?.trim() ?? "") !== "");
}

function updateSystem(exam: ExamState, key: string, change: (current: ExamSystemState) => ExamSystemState): ExamState {
  const current = exam.systems[key] ?? normalSystem();
  return { ...exam, systems: { ...exam.systems, [key]: change(current) } };
}

/** Normal or Abnormal. Back to Normal drops the findings, the side and the note of that system. */
export function setSystemAbnormal(exam: ExamState, key: string, abnormal: boolean): ExamState {
  return updateSystem(exam, key, (s) => (abnormal ? { ...s, abnormal: true } : normalSystem()));
}

/** The findings chosen for a system (the order they were tapped in). Choosing one makes the system abnormal; clearing them all leaves it abnormal. */
export function setFindings(exam: ExamState, key: string, findings: readonly string[]): ExamState {
  return updateSystem(exam, key, (s) => ({ ...s, abnormal: s.abnormal || findings.length > 0, findings: [...findings] }));
}

export function setSystemSide(exam: ExamState, key: string, side: ExamSystemState["side"]): ExamState {
  return updateSystem(exam, key, (s) => ({ ...s, side: side ?? null }));
}

export function setSystemNote(exam: ExamState, key: string, note: string): ExamState {
  return updateSystem(exam, key, (s) => ({ ...s, note: note === "" ? null : note.slice(0, 200) }));
}

/** The `systemic` texts an exam mirrors to, for the systems of its template that have a `systemic` key. */
export function mirrorExam(exam: ExamState): Partial<Record<MirroredSystem, string>> {
  const template = examTemplateById(exam.template_id);
  const out: Partial<Record<MirroredSystem, string>> = {};
  if (!template) return out;
  for (const def of template.systems) {
    if ((MIRRORED_SYSTEMS as readonly string[]).includes(def.key)) {
      out[def.key as MirroredSystem] = systemText(def, exam.systems[def.key]).slice(0, SYSTEMIC_MAX);
    }
  }
  return out;
}

/**
 * The GP `specialty_data` with the exam set (or cleared with `null`) and the `systemic` texts mirrored. `general_exam` and the `systemic` keys the
 * exam does not cover are kept. Clearing removes the keys the cleared exam's template mirrored (the texts were its own), and the `exam` object itself.
 */
export function withExam(data: GPSpecialty | undefined, exam: ExamState | null): GPSpecialty {
  const base: GPSpecialty = { ...(data ?? { specialty: "general_physician" }), specialty: "general_physician" };
  const systemic: Record<string, string | null | undefined> = { ...(base.systemic ?? {}) };
  const previous = base.exam ? examTemplateById(base.exam.template_id) : null;
  if (previous) {
    for (const def of previous.systems) if ((MIRRORED_SYSTEMS as readonly string[]).includes(def.key)) delete systemic[def.key];
  }
  const next: GPSpecialty = { ...base };
  if (exam) {
    Object.assign(systemic, mirrorExam(exam));
    next.exam = exam;
  } else {
    delete next.exam;
  }
  if (Object.keys(systemic).length > 0) next.systemic = systemic;
  else delete next.systemic;
  return next;
}

/**
 * The `systemic` keys whose typed text a template would replace (09B-06a, review A-2): with no structured exam yet, a legacy free-text finding (a v1
 * draft, or an amendment of a visit signed before V2-09b) for a system the template mirrors would be overwritten by "Normal: ...". Empty when there is
 * an exam (its texts are the exam's own mirror) or nothing typed.
 */
export function legacyTextReplacedBy(data: GPSpecialty | undefined, template: ExamTemplate): MirroredSystem[] {
  if (!data || data.exam) return [];
  const typed = data.systemic ?? {};
  return template.systems
    .map((def) => def.key)
    .filter((key): key is MirroredSystem => (MIRRORED_SYSTEMS as readonly string[]).includes(key) && ((typed as Record<string, string | null | undefined>)[key] ?? "").trim() !== "");
}

/** Does the GP data hold anything the doctor entered (signs, an exam with data, or free systemic text)? Switching the specialty asks first when it does. */
export function gpDataHasContent(data: GPSpecialty | undefined): boolean {
  if (!data) return false;
  if (Object.values(data.general_exam ?? {}).some(Boolean)) return true;
  // With an exam the `systemic` texts are its mirror (a fresh template reads "Normal: ..." everywhere), so only what the doctor entered counts.
  if (data.exam) return examHasData(data.exam);
  return Object.values(data.systemic ?? {}).some((t) => (t ?? "").trim() !== "");
}

/** What the printed prescription says about the examination (V2-09c 09C-04, R-12; 09B R-14): the general signs, the abnormal systems, the normal ones in one line. */
export interface ExamPrintLines {
  /** "Pallor, Icterus" when the general signs are marked, else null. */
  general: string | null;
  /** One line per abnormal system: "RS: Crepts, Wheeze (Right) · note", or "RS: Abnormal" when nothing was chosen. */
  abnormal: string[];
  /** "CVS, PA" - the systems of the template that were examined and are normal, else null. */
  normal: string | null;
}

const GENERAL_SIGNS: ReadonlyArray<readonly [keyof NonNullable<GPSpecialty["general_exam"]>, string]> = [
  ["pallor", "Pallor"],
  ["icterus", "Icterus"],
  ["cyanosis", "Cyanosis"],
  ["clubbing", "Clubbing"],
  ["lymphadenopathy", "Lymphadenopathy"],
  ["edema", "Edema"],
];

/**
 * The exam of a visit's `specialty_data` as print lines, or null when it holds nothing the doctor entered. Only the general physician's structured exam is
 * printed (a dental chart or a paediatric growth record has its own tools). Pure; nothing is invented: an unknown template or system is left out, a system
 * that is normal prints its LABEL in the normal line (not the template's boilerplate text).
 */
export function examPrintLines(specialtyData: unknown): ExamPrintLines | null {
  if (!specialtyData || typeof specialtyData !== "object") return null;
  const data = specialtyData as Partial<GPSpecialty>;
  if (data.specialty !== undefined && data.specialty !== "general_physician") return null;
  const signs = data.general_exam
    ? GENERAL_SIGNS.filter(([key]) => data.general_exam?.[key] === true).map(([, label]) => label)
    : [];
  const exam = data.exam;
  const template = exam && typeof exam.template_id === "string" ? examTemplateById(exam.template_id) : null;
  const abnormal: string[] = [];
  const normal: string[] = [];
  if (exam && template && exam.systems && typeof exam.systems === "object") {
    for (const def of template.systems) {
      const state = exam.systems[def.key];
      if (!state) continue;
      if (!state.abnormal) {
        normal.push(def.label);
        continue;
      }
      const found = (state.findings ?? []).join(", ");
      const withSide = found && state.side ? `${found} (${state.side})` : found;
      const note = state.note?.trim() ?? "";
      const parts = [withSide, note].filter((p) => p.length > 0);
      abnormal.push(`${def.label}: ${parts.length === 0 ? "Abnormal" : parts.join(" · ")}`);
    }
  }
  if (signs.length === 0 && abnormal.length === 0 && normal.length === 0) return null;
  return { general: signs.length > 0 ? signs.join(", ") : null, abnormal, normal: normal.length > 0 ? normal.join(", ") : null };
}
