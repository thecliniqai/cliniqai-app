"use server";

import { requireServiceContext } from "@/lib/auth/context";
import * as dedupService from "./dedup-service";
import type { DuplicateMatch, FindDuplicatesParams } from "./dedup-service";
import { markAction } from "@/lib/observability/db-timing";

/**
 * Potential duplicates of a new patient within the caller's clinic (minimal projection and reasons, V2-08 08-02). The tenant
 * comes only from the session (ADR-0005 D1). Throws when unauthenticated or not permitted, as before.
 */
export async function findPotentialDuplicates(params: FindDuplicatesParams): Promise<DuplicateMatch[]> {
  await markAction("patients_dedup.find_potential_duplicates");
  const ctx = await requireServiceContext("patients:view");
  return dedupService.findPotentialDuplicates(ctx, params);
}
