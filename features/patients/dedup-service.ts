import "server-only";

import type { ServiceContext } from "@/lib/auth/context";
import { findDuplicates, type DuplicateCandidate, type FindDuplicatesParams } from "./service";

export type { DuplicateCandidate as DuplicateMatch, FindDuplicatesParams } from "./service";

/**
 * Advisory duplicate candidates for a patient being registered, in the acting clinic (from `ctx`, never caller input)
 * (V2-08 08-02, R-11): the database function `find_patient_duplicates` under RLS answers the minimal projection (id, name,
 * age and sex, last four digits of the mobile, last visit) with the reasons: same mobile, or the same name with the same
 * date of birth or an age within two years. It never blocks a registration; the receptionist confirms. 08-05 replaces the
 * function body with the AI-14 rules (Smart Assist), the shape stays.
 */
export async function findPotentialDuplicates(ctx: ServiceContext, params: FindDuplicatesParams): Promise<DuplicateCandidate[]> {
  return findDuplicates(ctx, params);
}
