import type { SupabaseClient } from "@supabase/supabase-js";

import type { AppError } from "@/lib/errors/app-error";
import { mapDbError, unaffectedRowsError, type DbErrorLike } from "@/lib/db/errors";
import type { ClinicalNotes } from "@/lib/db/types";

/**
 * The clinical content of a visit lives in `public.clinical_notes` (V2-05 05-02a, rulings R-2…R-5), one row per visit
 * (PK `visit_id`, composite FK to `visits (tenant_id, id)`), created empty by a trigger when the visit is inserted.
 * The column names are the ones `visits` had (R-4), so mappers keep their field names. RLS: SELECT needs
 * `consultations:view`; UPDATE needs `consultations:edit`, or `vitals:edit` for `vitals` only (guard trigger).
 *
 * The six `visits` columns are cleared and blocked by the `visits_clinical_content_moved` CHECK until 05-b0 drops them:
 * never read or write clinical content through `visits`.
 *
 * Reads embed the row in the visit select with {@link clinicalNotesEmbed} and flatten it with
 * {@link withClinicalNotes}; when RLS hides the row (receptionist, admin) the embed is `null` and every field reads as
 * absent (`null`). Writes go through {@link updateClinicalNotes}, which reports a write RLS filtered as FORBIDDEN.
 */

/** The moved columns, in the order `visits` had them. */
export const CLINICAL_NOTE_FIELDS = [
  "vitals",
  "chief_complaints",
  "clinical_notes",
  "specialty_data",
  "investigations_advised",
  "advice",
] as const;

export type ClinicalNoteField = (typeof CLINICAL_NOTE_FIELDS)[number];

/** The key the embed is returned under in a visit row (`notes:clinical_notes(...)`): avoids the `clinical_notes` column. */
export const CLINICAL_NOTES_EMBED_KEY = "notes";

/**
 * PostgREST embed of the visit's clinical_notes row, for a select on `visits` (one-to-one over the composite FK).
 * `fields` defaults to every moved column.
 */
export function clinicalNotesEmbed(fields: readonly ClinicalNoteField[] = CLINICAL_NOTE_FIELDS): string {
  return `${CLINICAL_NOTES_EMBED_KEY}:clinical_notes(${fields.join(", ")})`;
}

/** The clinical content of one visit as the app reads it: each field `null` when absent or hidden by RLS. */
export type ClinicalContent = {
  [K in ClinicalNoteField]: ClinicalNotes[K] | null;
};

const ABSENT: ClinicalContent = {
  vitals: null,
  chief_complaints: null,
  clinical_notes: null,
  specialty_data: null,
  investigations_advised: null,
  advice: null,
};

/** The embedded notes of a visit row: an object, a one-element array (older PostgREST shapes) or `null`. */
export function embeddedClinicalNotes(row: unknown): Partial<ClinicalNotes> | null {
  if (!row || typeof row !== "object") return null;
  const embed = (row as Record<string, unknown>)[CLINICAL_NOTES_EMBED_KEY];
  const value = Array.isArray(embed) ? embed[0] : embed;
  return value && typeof value === "object" ? (value as Partial<ClinicalNotes>) : null;
}

/** Normalises a clinical_notes row (or its absence) to {@link ClinicalContent}. */
export function clinicalContent(notes: Partial<ClinicalNotes> | null | undefined): ClinicalContent {
  if (!notes) return { ...ABSENT };
  const out: ClinicalContent = { ...ABSENT };
  for (const field of CLINICAL_NOTE_FIELDS) {
    const value = notes[field];
    if (value !== undefined && value !== null) (out as Record<ClinicalNoteField, unknown>)[field] = value;
  }
  return out;
}

/**
 * A visit row selected with {@link clinicalNotesEmbed}, with the embedded notes flattened onto it under the original
 * column names (and the embed key removed). The legacy `visits` columns a `*` select still returns are overwritten,
 * so nothing reads them.
 */
export function withClinicalNotes<T extends object>(row: T): Omit<T, typeof CLINICAL_NOTES_EMBED_KEY> & ClinicalContent {
  const { [CLINICAL_NOTES_EMBED_KEY]: _embed, ...rest } = row as T & Record<string, unknown>;
  void _embed;
  return { ...(rest as Omit<T, typeof CLINICAL_NOTES_EMBED_KEY>), ...clinicalContent(embeddedClinicalNotes(row)) };
}

/** The fields a caller may write; `updated_at` is maintained by the table's guard trigger. */
export type ClinicalNotesPatch = Partial<Pick<ClinicalNotes, ClinicalNoteField>>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

/**
 * Updates the clinical_notes row of `visitId` in `tenantId`. Returns `error: null` and the updated content on success,
 * or an {@link AppError}: the mapped database error (a nurse writing anything but vitals → FORBIDDEN from the guard),
 * or FORBIDDEN (`ROW_NOT_AFFECTED`) when RLS filtered the write to 0 rows (the caller's role may not change the
 * notes). `raw` carries the driver error for logging by tag only.
 */
export async function updateClinicalNotes(
  db: AnyClient,
  tenantId: string,
  visitId: string,
  patch: ClinicalNotesPatch,
): Promise<{ error: AppError | null; raw?: DbErrorLike; content?: ClinicalContent }> {
  const { data, error } = await db
    .from("clinical_notes")
    .update(patch)
    .eq("visit_id", visitId)
    .eq("tenant_id", tenantId)
    .select(["visit_id", ...CLINICAL_NOTE_FIELDS].join(", "));
  if (error) return { error: mapDbError(error), raw: error };
  const refused = unaffectedRowsError(data);
  if (refused) return { error: refused };
  const row = (Array.isArray(data) ? data[0] : null) as Partial<ClinicalNotes> | null;
  return { error: null, content: clinicalContent(row) };
}
