import { getAdminClient } from "./supabase-admin";

export const TENANT_OWNED_TABLES = [
  "tenants",
  "memberships",
  "invitations",
  "subscriptions",
  "payment_records",
  "patients",
  "audit_logs",
  "consent_records",
] as const;

export type TenantOwnedTable = (typeof TENANT_OWNED_TABLES)[number];

export interface PolicyCatalogRow {
  table_name: string;
  rls_enabled: boolean;
  policy_name: string | null;
  roles: string[] | null;
  cmd: string | null;
  qual: string | null;
  with_check: string | null;
}

/**
 * Asserts that every tenant-owned table in the schema:
 * 1. Has Row Level Security enabled (relrowsecurity = true in pg_class).
 * 2. Has at least one active policy registered in pg_policies.
 * 3. Does NOT contain an insecure unconditional USING(true) or WITH CHECK(true)
 *    bypass for tenant users.
 */
export async function assertRlsCatalog(): Promise<{
  inspectedTables: string[];
  totalPolicies: number;
}> {
  const admin = getAdminClient();

  const { data, error } = await admin
    .rpc("get_tenant_table_rls_policies")
    .returns<PolicyCatalogRow[]>();

  if (error) {
    throw new Error(
      `Failed to query RLS catalog via RPC get_tenant_table_rls_policies: ${error.message}. ` +
      `Ensure migration supabase/migrations/000005_rls_inspection.sql is applied.`
    );
  }

  if (!data || data.length === 0) {
    throw new Error(
      "RLS catalog audit failed: get_tenant_table_rls_policies returned 0 rows. " +
      "No public tables were inspected."
    );
  }

  const tableMap = new Map<string, PolicyCatalogRow[]>();
  for (const row of data) {
    const list = tableMap.get(row.table_name) || [];
    list.push(row);
    tableMap.set(row.table_name, list);
  }

  let totalPoliciesCount = 0;

  for (const expectedTable of TENANT_OWNED_TABLES) {
    const rows = tableMap.get(expectedTable);

    if (!rows || rows.length === 0) {
      throw new Error(
        `RLS catalog violation: expected tenant-owned table "${expectedTable}" was not found in pg_class.`
      );
    }

    // Check relrowsecurity
    const rlsEnabled = rows[0].rls_enabled;
    if (!rlsEnabled) {
      throw new Error(
        `RLS catalog violation: table "${expectedTable}" does NOT have Row Level Security enabled (relrowsecurity is false).`
      );
    }

    // Check policies
    const validPolicies = rows.filter((r) => r.policy_name !== null);
    if (validPolicies.length === 0) {
      throw new Error(
        `RLS catalog violation: table "${expectedTable}" has RLS enabled but has 0 policies defined in pg_policies.`
      );
    }

    totalPoliciesCount += validPolicies.length;

    // Check for unconditional USING(true) / WITH CHECK(true) bypasses
    for (const policy of validPolicies) {
      const isPublicOrAuthenticated =
        !policy.roles ||
        policy.roles.length === 0 ||
        policy.roles.includes("public") ||
        policy.roles.includes("authenticated");

      if (isPublicOrAuthenticated) {
        const qualTrimmed = policy.qual?.trim().toLowerCase();
        const checkTrimmed = policy.with_check?.trim().toLowerCase();

        if (qualTrimmed === "true" || qualTrimmed === "(true)") {
          throw new Error(
            `RLS catalog violation: table "${expectedTable}" has insecure unconditional policy ` +
            `"${policy.policy_name}" with qual USING(true). Tenant isolation is bypassed!`
          );
        }

        if (checkTrimmed === "true" || checkTrimmed === "(true)") {
          throw new Error(
            `RLS catalog violation: table "${expectedTable}" has insecure unconditional policy ` +
            `"${policy.policy_name}" with WITH CHECK(true). Tenant isolation is bypassed!`
          );
        }
      }
    }
  }

  return {
    inspectedTables: [...TENANT_OWNED_TABLES],
    totalPolicies: totalPoliciesCount,
  };
}
