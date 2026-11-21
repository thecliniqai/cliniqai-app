import "server-only";

import type { ServiceContext } from "@/lib/auth/context";
import { findDuplicates, type DuplicateCandidate, type FindDuplicatesParams } from "./service";

export type { DuplicateCandidate as DuplicateMatch, FindDuplicatesParams } from "./service";

/**
 * Advisory duplicate candidates for a patient being registered, in the acting clinic (from `ctx`, never caller input)
 * (V2-08 08-02, R-11): the database function `find_patient_duplicates` under RLS answers the minimal projection (id, name,
 * age and sex, last four digits of the mobile, last visit) with the reasons and a strength. With the clinic's `assist.duplicates`
 * entitlement (Smart Assist, AI-14, 000105) a similar name (case, punctuation, short forms, word order) with the same date of
 * birth or an age within two years also counts, and the same mobile with a similar name is `strong`; without it the 08-02 rules
 * apply and every row is `possible`. It never blocks a registration; the receptionist confirms.
 */
export async function findPotentialDuplicates(ctx: ServiceContext, params: FindDuplicatesParams): Promise<DuplicateCandidate[]> {
  return findDuplicates(ctx, params);
}
