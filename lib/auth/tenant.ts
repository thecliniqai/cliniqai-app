import { createClient } from "@/lib/supabase/server";
import { UserRole } from "@/lib/db/types";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

export class NoClinicMembershipError extends Error {
  constructor(message = "Your account is not linked to a clinic yet") {
    super(message);
    this.name = "NoClinicMembershipError";
  }
}

/**
 * No signed-in user: the session is missing, or it was revoked elsewhere (sign-out, password reset or change) while its
 * access token is still valid, which `proxy.ts` (local JWT check) admits and GoTrue then refuses. The message stays
 * "Unauthenticated" (callers match it). Page loaders turn it into a redirect to sign-in (`lib/auth/page.ts`, V2-05
 * 05-11c), never a server error.
 */
export class UnauthenticatedError extends Error {
  constructor() {
    super("Unauthenticated");
    this.name = "UnauthenticatedError";
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
    throw new UnauthenticatedError();
  }

  const { data: memberships, error: memError } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .returns<Array<{ tenant_id: string; role: UserRole }>>();

  if (memError) {
    // Database text never leaves the server (IR-L1); only the error code is logged.
    log.error({ event: "auth.membership_lookup.failed", code: errorTag(memError), requestId: await getRequestId(), userId: user.id });
    throw new Error("Failed to resolve clinic membership.");
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

