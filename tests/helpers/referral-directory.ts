import { getAdminClient } from "./supabase-admin";

/**
 * Lists a synthetic clinic in the referral directory (V2-05 05-06, migration 000062): an in-network referral may only
 * name a listed clinic as its target (`REFERRAL_TARGET_NOT_LISTED` otherwise), so a spec that seeds or creates one
 * lists the target first. Service role on the local stack only (the test env guard refuses any other URL).
 */
export async function listInReferralDirectory(tenantId: string, listed = true): Promise<void> {
  const { error } = await getAdminClient().from("tenants").update({ referral_directory_listed: listed }).eq("id", tenantId);
  if (error) throw new Error(`listInReferralDirectory failed: ${error.code ?? "unknown"}`);
}
