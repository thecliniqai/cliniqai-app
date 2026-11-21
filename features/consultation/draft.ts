import type { ChiefComplaintItem, ClinicalSpecialty, SpecialtyData, Vitals } from "./schema";

/**
 * The consult draft as the client holds it and as the save command takes it (V2-09b R-2, R-3): the six `clinical_notes` content columns,
 * `visits.specialty` and the visit's one follow-up. Pure: no server or React import, so the draft saver, the rebase and the server reader share
 * one definition and one notion of "changed".
 *
 * The AI provenance keys of `visits.metadata` are part of the command's patch (kept for V2-12) but not of the client draft: nothing on the
 * screen edits them in this plan.
 */
export const DRAFT_FIELD_KEYS = [
  "vitals",
  "chief_complaints",
  "clinical_notes",
  "specialty_data",
  "investigations_advised",
  "advice",
  "specialty",
  "follow_up",
] as const;

export type DraftFieldKey = (typeof DRAFT_FIELD_KEYS)[number];

export interface DraftFollowUp {
  /** The UI's interval word; the database stores the date and the note only. */
  interval?: "none" | "3_days" | "5_days" | "1_week" | "2_weeks" | "custom";
  follow_up_date: string;
  notes?: string | null;
}

export interface DraftFields {
  vitals: Vitals | null;
  chief_complaints: ChiefComplaintItem[];
  /** The empty note is "" on the client and NULL in the database: the two are the same draft. */
  clinical_notes: string;
  specialty_data: SpecialtyData | Record<string, unknown> | null;
  investigations_advised: string[];
  advice: string[];
  specialty: ClinicalSpecialty;
  follow_up: DraftFollowUp | null;
}

/** What `getConsultationDraft` returns: the draft, its version and the record state it was read in. */
export interface ServerDraft {
  fields: DraftFields;
  draftVersion: number;
  status: string;
  signedAt: string | null;
}

/** The vitals keys that are measurements or readings; `recorded_by` and `recorded_at` are attribution, set by the server and the editor. */
const VITALS_VALUE_KEYS = [
  "systolic",
  "diastolic",
  "pulse",
  "temperature",
  "spo2",
  "weight",
  "height",
  "respiratory_rate",
  "bmi",
  "sugar",
  "sugar_type",
] as const;

/** Key-order independent deep equality over JSON values (`undefined` object members read as absent). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => jsonEqual(item, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!jsonEqual(left[key], right[key])) return false;
  }
  return true;
}

function nonEmptyVitals(v: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (v && typeof v === "object") {
    for (const key of VITALS_VALUE_KEYS) {
      const value = (v as Record<string, unknown>)[key];
      if (value !== null && value !== undefined) out[key] = value;
    }
  }
  return out;
}

/**
 * Whether two values of one draft field are the same draft. Normalises what the screen and the database spell differently: an empty note
 * (`""` and null), empty vitals and specialty data (`{}` and null), a vitals recorder (the server chooses it), the follow-up's interval word
 * (the database does not store it) and absent versus null follow-up notes.
 */
export function draftFieldEqual(key: DraftFieldKey, a: unknown, b: unknown): boolean {
  switch (key) {
    case "clinical_notes":
      return (a ?? "") === (b ?? "");
    case "vitals":
      return jsonEqual(nonEmptyVitals(a), nonEmptyVitals(b));
    case "specialty_data": {
      const left = a && typeof a === "object" && Object.keys(a).length > 0 ? a : null;
      const right = b && typeof b === "object" && Object.keys(b).length > 0 ? b : null;
      return jsonEqual(left, right);
    }
    case "follow_up": {
      const norm = (f: unknown) => {
        if (!f || typeof f !== "object") return null;
        const { follow_up_date, notes } = f as { follow_up_date?: string | null; notes?: string | null };
        return follow_up_date ? { follow_up_date, notes: notes || null } : null;
      };
      return jsonEqual(norm(a), norm(b));
    }
    default:
      return jsonEqual(a, b);
  }
}

/** The keys whose value in `current` differs from `base`. */
export function changedDraftKeys(base: DraftFields, current: DraftFields): DraftFieldKey[] {
  return DRAFT_FIELD_KEYS.filter((key) => !draftFieldEqual(key, base[key], current[key]));
}

/** The wire value of one draft field in the command's patch. */
export function draftPatchValue(key: DraftFieldKey, fields: DraftFields): unknown {
  switch (key) {
    case "clinical_notes":
      return fields.clinical_notes;
    case "follow_up":
      return fields.follow_up && fields.follow_up.follow_up_date ? fields.follow_up : null;
    default:
      return fields[key];
  }
}
