"use server";

import { requireServiceContext } from "@/lib/auth/context";
import * as dedupService from "./dedup-service";
import type { DuplicateMatch, FindDuplicatesParams } from "./dedup-service";

export type { DuplicateMatch, FindDuplicatesParams } from "./dedup-service";

/**
 * Potential duplicates of a new patient within the caller's clinic. The tenant comes only from the session
 * (ADR-0005 D1). Throws when unauthenticated or not permitted, as before.
 */
export async function findPotentialDuplicates(params: FindDuplicatesParams): Promise<DuplicateMatch[]> {
  const ctx = await requireServiceContext("patients:view");
  return dedupService.findPotentialDuplicates(ctx, params);
}
