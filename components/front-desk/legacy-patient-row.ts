import type { PatientHit } from "@/features/patients/search";

/**
 * What the v1 walk-in, booking and waitlist drawers show of a search result (V2-08 08-02): name, a masked mobile number and
 * the age. They moved from `select *` rows to the minimal search projection ({@link PatientHit}); the drawers leave in 08-03b
 * (walk-in) and 08-04b (booking, waitlist), and this adapter with them.
 */
export interface LegacyPatientRow {
  id: string;
  full_name: string;
  /** `+91 ••••• •3210`, or an empty string. */
  phone: string;
  /** `42 y`, or null. */
  age: string | null;
}

export function toLegacyPatientRow(hit: PatientHit): LegacyPatientRow {
  return {
    id: hit.id,
    full_name: hit.name,
    phone: hit.phoneLast4 ? `+91 ••••• •${hit.phoneLast4}` : "",
    age: hit.ageSex?.age ?? null,
  };
}
