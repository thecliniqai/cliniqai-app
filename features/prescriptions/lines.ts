/**
 * Prescription lines: the pure mapping between a stored `prescription_items` row, the builder's `RxLine`, and the payload of the `change_prescription`
 * command (V2-09c 09C-01, R-2, R-4, R-5). No I/O. Durations are stored as text ("5 days", "1 week", "Continue"); the builder works in days.
 */
import { durationLabel, MAX_DAYS, MIN_DAYS, type Medicine, type RxLine } from "@/lib/clinical/rx";
import type { PrescriptionItem } from "@/lib/db/types";
import type { MedicineSearchResult } from "./schema";
import type { RxAssistEntry } from "@/features/consultation/assist-ranking";

/**
 * Reads a stored duration as a number of days: "5 days", "1 day", "1 week" (7), "2 weeks" (14), "1 month" (30), and the shorthand "5d", "2w", "1m".
 * Anything else ("Continue", "Till review", "x 3 weeks then stop") is null: it stays text.
 */
export function durationToDays(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /^\s*(\d{1,3})\s*(d|day|days|w|week|weeks|m|month|months)\s*$/i.exec(text);
  if (!m) return null;
  const unit = m[2].toLowerCase()[0] as "d" | "w" | "m";
  const days = Number(m[1]) * ({ d: 1, w: 7, m: 30 } as const)[unit];
  return days >= MIN_DAYS && days <= MAX_DAYS ? days : null;
}

/** The text stored for a number of days: "5 days", "1 day". */
export function daysToDuration(days: number): string {
  return durationLabel(days);
}

/** The medicine of a stored line. A line from the catalogue carries its brand id; a custom one has none (its id is its name). */
export function medicineOfItem(item: Pick<PrescriptionItem, "medicine_name" | "generic_name" | "dose_form" | "cdci_brand_id">): Medicine {
  return {
    id: item.cdci_brand_id ?? `custom:${item.medicine_name.toLowerCase()}`,
    name: item.medicine_name,
    form: item.dose_form ?? "",
    generic: item.generic_name ?? item.medicine_name,
    kind: item.cdci_brand_id ? "cdci" : "custom",
  };
}

/** A stored item as a builder line. A duration the days cannot express keeps its text; the timing is "" when none was stored. */
export function itemToLine(item: PrescriptionItem): RxLine {
  const days = durationToDays(item.duration);
  return {
    medicine: medicineOfItem(item),
    frequency: item.dosage,
    timing: item.timing ?? "",
    days: days ?? 0,
    durationText: days === null ? item.duration : undefined,
    instruction: item.special_instructions ?? undefined,
  };
}

/** A search result as the entry row's medicine. A custom row's usual dose is the doctor's stored one, part by part; a CDCI row has none. */
export function medicineFromSearch(row: MedicineSearchResult): Medicine {
  const usual: NonNullable<Medicine["usual"]> = {};
  if (row.kind === "custom") {
    if (row.dosage) usual.frequency = row.dosage;
    if (row.timing) usual.timing = row.timing;
    const days = durationToDays(row.duration);
    if (days !== null) usual.days = days;
  }
  return {
    id: row.id,
    name: row.medicine_name,
    form: row.dose_form ?? "",
    generic: row.generic_name ?? row.medicine_name,
    kind: row.kind,
    substanceIds: row.substance_ids,
    usual: Object.keys(usual).length > 0 ? usual : undefined,
  };
}

/** One line of the command's `add` list. The timing and the instruction are null when empty; a catalogue medicine carries its brand id. */
export interface ChangeLine {
  medicine_name: string;
  generic_name: string | null;
  dose_form: string | null;
  dosage: string;
  timing: string | null;
  duration: string;
  special_instructions: string | null;
  cdci_brand_id: string | null;
}

export interface ChangeUpdate {
  id: string;
  dosage?: string;
  timing?: string | null;
  duration?: string;
  special_instructions?: string | null;
}

export interface PrescriptionChanges {
  add?: ChangeLine[];
  update?: ChangeUpdate[];
  remove?: string[];
  /** V2-09c 09C-02 (R-7): the reason to prescribe a medicine that matches a recorded allergy (5 to 300 characters). */
  allergy_override_reason?: string;
}

/** Whether a line can be sent: a frequency and a duration (days or a kept text) are required, a timing is not. */
export function lineComplete(line: Pick<RxLine, "frequency" | "days" | "durationText">): boolean {
  return line.frequency.trim() !== "" && (Boolean(line.durationText) || (line.days >= MIN_DAYS && line.days <= MAX_DAYS));
}

/** A builder line as an `add` line. A generic equal to the name is not sent (it carried no information). */
export function lineToAdd(line: RxLine): ChangeLine {
  const brand = line.medicine.kind === "cdci" ? line.medicine.id : null;
  const generic = line.medicine.generic.trim();
  return {
    medicine_name: line.medicine.name.trim(),
    generic_name: generic && generic !== line.medicine.name.trim() ? generic : null,
    dose_form: line.medicine.form.trim() && line.medicine.form !== "Custom" ? line.medicine.form.trim() : null,
    dosage: line.frequency.trim(),
    timing: line.timing.trim() || null,
    duration: line.durationText && line.days < MIN_DAYS ? line.durationText : daysToDuration(line.days),
    special_instructions: line.instruction?.trim() || null,
    cdci_brand_id: brand,
  };
}

/** A stored item as an `add` line (Undo of a remove, a template, a repeat): the stored values exactly, nothing added. */
export function itemToAdd(item: Pick<PrescriptionItem, "medicine_name" | "generic_name" | "dose_form" | "dosage" | "timing" | "duration" | "special_instructions" | "cdci_brand_id">): ChangeLine {
  return {
    medicine_name: item.medicine_name,
    generic_name: item.generic_name ?? null,
    dose_form: item.dose_form ?? null,
    dosage: item.dosage,
    timing: item.timing ?? null,
    duration: item.duration,
    special_instructions: item.special_instructions ?? null,
    cdci_brand_id: item.cdci_brand_id ?? null,
  };
}

/** The dose fields of an edited line, for the `update` list. Only what differs from the stored item is sent; null when nothing changed. */
export function lineToUpdate(item: PrescriptionItem, line: RxLine): ChangeUpdate | null {
  const next = lineToAdd(line);
  const update: ChangeUpdate = { id: item.id };
  if (next.dosage !== item.dosage) update.dosage = next.dosage;
  if (next.timing !== (item.timing ?? null)) update.timing = next.timing;
  if (next.duration !== item.duration) update.duration = next.duration;
  if (next.special_instructions !== (item.special_instructions ?? null)) update.special_instructions = next.special_instructions;
  return Object.keys(update).length > 1 ? update : null;
}

/** The stored item a successful add produces, built from what was sent and what the command answered (the ids are the database's). */
export function itemFromAdd(line: ChangeLine, id: string, prescriptionId: string, sortOrder: number): PrescriptionItem {
  return {
    id,
    prescription_id: prescriptionId,
    medicine_name: line.medicine_name,
    generic_name: line.generic_name,
    dose_form: line.dose_form,
    dosage: line.dosage,
    timing: line.timing,
    duration: line.duration,
    special_instructions: line.special_instructions,
    cdci_brand_id: line.cdci_brand_id,
    cdci_generic_id: null,
    sort_order: sortOrder,
    created_at: new Date().toISOString(),
  };
}

/** The key that tells two sends apart: the same changes keep the same request id after a failure (idempotent retry), other changes start a new one. */
export function changesKey(visitId: string, changes: PrescriptionChanges): string {
  return JSON.stringify([visitId, changes.add ?? [], changes.update ?? [], changes.remove ?? [], changes.allergy_override_reason ?? null]);
}

/**
 * A line of a saved protocol template (or of a past visit's Rx) as an `add` line: the values it holds, nothing added. A template line with no dose
 * (an old, partly saved one) stays out: the command needs a dosage and a duration.
 */
export function templateItemToAdd(item: {
  medicine_name?: string | null;
  generic_name?: string | null;
  dose_form?: string | null;
  dosage?: string | null;
  timing?: string | null;
  duration?: string | null;
  special_instructions?: string | null;
  cdci_brand_id?: string | null;
}): ChangeLine | null {
  const name = item.medicine_name?.trim();
  const dosage = item.dosage?.trim();
  const duration = item.duration?.trim();
  if (!name || !dosage || !duration) return null;
  return {
    medicine_name: name,
    generic_name: item.generic_name?.trim() || null,
    dose_form: item.dose_form?.trim() || null,
    dosage,
    timing: item.timing?.trim() || null,
    duration,
    special_instructions: item.special_instructions?.trim() || null,
    cdci_brand_id: item.cdci_brand_id?.trim() || null,
  };
}

/** Whether a favourite or bundle entry has a complete usual dose: a frequency and a duration (the timing may be null). Only then can one tap add it. */
export function rxEntryHasUsual(entry: Pick<RxAssistEntry, "usual">): boolean {
  return Boolean(entry.usual && entry.usual.dosage.trim() !== "" && entry.usual.duration.trim() !== "");
}

/**
 * A favourite or bundle entry as an `add` line (V2-09c R-9): the doctor's own stored usual dose exactly, nothing added and nothing invented (a null timing
 * stays null, no instruction). Null when the usual is not complete: the screen then opens the dose builder instead.
 */
export function rxEntryToAdd(entry: RxAssistEntry): ChangeLine | null {
  if (!entry.usual || !rxEntryHasUsual(entry)) return null;
  return {
    medicine_name: entry.name,
    generic_name: entry.generic_name,
    dose_form: entry.dose_form,
    dosage: entry.usual.dosage.trim(),
    timing: entry.usual.timing?.trim() || null,
    duration: entry.usual.duration.trim(),
    special_instructions: null,
    cdci_brand_id: entry.cdci_brand_id,
  };
}

/** A favourite or bundle entry as the entry row's medicine, with the usual parts the doctor stored (the dose builder opens with them; the rest stays empty). */
export function rxEntryToMedicine(entry: RxAssistEntry): Medicine {
  const usual: NonNullable<Medicine["usual"]> = {};
  if (entry.usual?.dosage.trim()) usual.frequency = entry.usual.dosage.trim();
  if (entry.usual?.timing?.trim()) usual.timing = entry.usual.timing.trim();
  if (entry.usual?.duration.trim()) {
    const days = durationToDays(entry.usual.duration);
    if (days !== null) usual.days = days;
    else usual.durationText = entry.usual.duration.trim();
  }
  return {
    id: entry.cdci_brand_id ?? `custom:${entry.name.toLowerCase()}`,
    name: entry.name,
    form: entry.dose_form ?? "",
    generic: entry.generic_name ?? entry.name,
    kind: entry.cdci_brand_id ? "cdci" : "custom",
    substanceIds: entry.substance_ids,
    usual: Object.keys(usual).length > 0 ? usual : undefined,
  };
}

/** A past visit's stored line (the history list) as the entry row's medicine, for the dose builder of a line "Same as last visit" left for the doctor. */
export function pastItemToMedicine(item: {
  medicine_name: string;
  generic_name?: string | null;
  dose_form?: string | null;
  dosage: string;
  timing?: string | null;
  duration: string;
  cdci_brand_id?: string | null;
}): Medicine {
  return rxEntryToMedicine({
    name: item.medicine_name,
    generic_name: item.generic_name ?? null,
    dose_form: item.dose_form ?? null,
    cdci_brand_id: item.cdci_brand_id ?? null,
    substance_ids: [],
    n: 1,
    usual: { dosage: item.dosage, timing: item.timing ?? null, duration: item.duration },
  });
}
