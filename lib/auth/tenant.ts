import { createClient } from "@/lib/supabase/server";
import { UserRole } from "@/lib/db/types";

export class NoClinicMembershipError extends Error {
  constructor(message = "Your account is not linked to a clinic yet") {
    super(message);
    this.name = "NoClinicMembershipError";
  }
}

export class MultipleClinicsSelectionRequiredError extends Error {
  constructor(message = "Multiple clinics found. Please select an active clinic.") {
    super(message);
    this.name = "MultipleClinicsSelectionRequiredError";
  }
}

export interface ActiveMembership {
  tenantId: string;
  role: UserRole;
  userId: string;
}

import { cookies } from "next/headers";

/**
 * Derives the active tenant membership strictly on the server from session and database.
 * Never trust browser-supplied tenant IDs (AGENTS.md §7).
 */
export async function getActiveMembership(explicitTenantId?: string): Promise<ActiveMembership> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Unauthenticated");
  }

  const { data: memberships, error: memError } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .returns<Array<{ tenant_id: string; role: UserRole }>>();

  if (memError) {
    throw new Error(`Failed to resolve clinic membership: ${memError.message}`);
  }

  if (!memberships || memberships.length === 0) {
    throw new NoClinicMembershipError();
  }

  if (memberships.length === 1) {
    return {
      tenantId: memberships[0].tenant_id,
      role: memberships[0].role,
      userId: user.id,
    };
  }

  // Multiple memberships: require explicit tenant selection rather than guessing (Plan 02 / Plan 05)
  let targetTenantId = explicitTenantId;
  if (!targetTenantId) {
    try {
      const cookieStore = await cookies();
      targetTenantId = cookieStore.get("clinic_active_tenant")?.value;
    } catch {
      // In tests or outside Next.js request context
    }
  }

  if (!targetTenantId) {
    throw new MultipleClinicsSelectionRequiredError();
  }

  const match = memberships.find((m) => m.tenant_id === targetTenantId);
  if (!match) {
    throw new Error("Unauthorized: user is not a member of the requested tenant");
  }

  return {
    tenantId: match.tenant_id,
    role: match.role,
    userId: user.id,
  };
}

