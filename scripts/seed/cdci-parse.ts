/**
 * Pure parsing helpers of the CDCI load (V2-09c 09C-02, R-6, R-7). No side effects and no environment: `scripts/seed-cdci.ts` loads `.env` and creates an
 * admin client when imported, so the specs import only this module.
 */

/**
 * The substance ids of a generic from `GenericMaster.txt` column 3: ids joined by `+` ("S12+S40"). Trimmed, empty parts and repeats dropped, the order of
 * first appearance kept. A missing or blank field has none (the medicine is then checked against allergies by name only).
 */
export function parseGenericSubstanceIds(field: string | null | undefined): string[] {
  if (field == null) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of field.split("+")) {
    const id = part.trim();
    if (id !== "" && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
