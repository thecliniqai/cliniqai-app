import "server-only";

import type { ServiceContext } from "@/lib/auth/context";
import { parseSnapshot, type LiveSnapshot } from "./domains";

/**
 * The clinic's versions and access level from one statement (`public.clinic_live_state`, 000123; V2-09e 09E-04, R-18), on the caller's own
 * JWT client: the database returns NULL for a clinic the caller is not an active member of. `null` here means "could not be read" (a
 * page then hands the screen no basis, which only costs one extra re-read; it never claims a version it did not read).
 */
export async function readLiveSnapshot(ctx: Pick<ServiceContext, "db" | "tenantId">): Promise<LiveSnapshot | null> {
  const { data, error } = await ctx.db.rpc("clinic_live_state", { p_tenant_id: ctx.tenantId });
  if (error) return null;
  return parseSnapshot(data);
}

