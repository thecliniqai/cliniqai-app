import "server-only";

import { createClient } from "@/lib/supabase/server";
import { assertTenantAccess, getActiveMembership } from "@/lib/auth/tenant";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

/**
 * Feature gating by entitlement (V2-05 05-10a; SUB-02, SUB §6.3; PO-21, PO-25). The active clinic's entitlements come
 * from `my_entitlements` (05-09a: the caller's own clinic only; an unexpired override decides, else the trial plan
 * while `trialing`, else the base plan), never from caller input. A clinic that is not `full` has no feature: the
 * access check runs first (TenantLockedError).
 *
 * No caller yet in V2-05: AI features (V2-12) call `requireEntitlement("ai.scribe")` before any provider request.
 * Fail closed: a lookup error or an unknown key reads as "not entitled".
 */
export interface EntitlementValue {
  enabled: boolean;
  /** The plan's or override's limit (null = unlimited / not metered). */
  limit: number | null;
}

/** Every entitlement of the active clinic, by key (only what `my_entitlements` returns). */
export async function activeEntitlements(): Promise<Map<string, EntitlementValue>> {
  const membership = await getActiveMembership();
  await assertTenantAccess(membership, "full");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_entitlements", { p_tenant: membership.tenantId });
  if (error) {
    log.error({ event: "entitlements.lookup.failed", code: errorTag(error), requestId: await getRequestId() });
    return new Map();
  }
  const out = new Map<string, EntitlementValue>();
  for (const row of (data ?? []) as Array<{ key: string; enabled: boolean; limit_value: number | null }>) {
    out.set(row.key, { enabled: row.enabled === true, limit: typeof row.limit_value === "number" ? row.limit_value : null });
  }
  return out;
}

/** True when the active clinic is `full` and holds `key` enabled (e.g. `ai.scribe` while trialing, PO-21). */
export async function requireEntitlement(key: string): Promise<boolean> {
  return (await activeEntitlements()).get(key)?.enabled === true;
}
