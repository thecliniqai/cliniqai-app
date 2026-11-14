import { getAdminClient } from "./supabase-admin";

/**
 * Test access to a visit's clinical content (`public.clinical_notes`, V2-05 05-02a). The row is created empty by a
 * trigger when the visit is inserted; the six `visits` columns are cleared and blocked by a CHECK, so specs seed and
 * read the clinical content here (service role, RLS bypassed), never through `visits`. Synthetic data only.
 */

export interface ClinicalNotesRow {
  visit_id: string;
  tenant_id: string;
  vitals: Record<string, unknown>;
  chief_complaints: unknown[];
  clinical_notes: string | null;
  specialty_data: Record<string, unknown>;
  investigations_advised: string[];
  advice: string[];
  updated_at: string;
}

export type ClinicalNotesSeed = Partial<
  Pick<ClinicalNotesRow, "vitals" | "chief_complaints" | "clinical_notes" | "specialty_data" | "investigations_advised" | "advice">
>;

/** The clinical_notes row of `visitId` (throws when it is missing: every visit has one). */
export async function clinicalNotesOf(visitId: string): Promise<ClinicalNotesRow> {
  const { data, error } = await getAdminClient().from("clinical_notes").select("*").eq("visit_id", visitId).single();
  if (error || !data) throw new Error(`clinical_notes read failed for a visit: ${error?.message ?? "no row"}`);
  return data as unknown as ClinicalNotesRow;
}

/** Writes clinical content for a seeded visit (as the service role). */
export async function seedClinicalNotes(visitId: string, content: ClinicalNotesSeed): Promise<void> {
  const { data, error } = await getAdminClient()
    .from("clinical_notes")
    .update(content as never)
    .eq("visit_id", visitId)
    .select("visit_id");
  if (error || !data || data.length !== 1) {
    throw new Error(`clinical_notes seed failed for a visit: ${error?.message ?? "no row"}`);
  }
}
