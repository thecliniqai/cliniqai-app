"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { getTenantAccessLevel } from "@/lib/auth/tenant";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { markAction } from "@/lib/observability/db-timing";

/** `tenant_subscriptions.status` (SUB §6.1). */
export type SubscriptionStatus =
  | "incomplete"
  | "trialing"
  | "active"
  | "past_due"
  | "expired"
  | "archived"
  | "purged";

/** `public.my_tenant_access` (SUB §6.2): what the clinic may do right now. */
export type AccessLevel = "full" | "locked" | "onboarding" | "none";

export interface SubscriptionOverview {
  /** The clinic's subscription row (one per clinic, created `incomplete` with the clinic); null if unreadable. */
  subscription: {
    status: SubscriptionStatus;
    trialEnd: string | null;
    currentPeriodEnd: string | null;
    accessEndsAt: string | null;
    compUntil: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  /** The access level at the time of the request, from the database (never computed in the app). */
  accessLevel: AccessLevel | null;
}

const STATUSES = new Set<string>(["incomplete", "trialing", "active", "past_due", "expired", "archived", "purged"]);
const LEVELS = new Set<string>(["full", "locked", "onboarding", "none"]);

/**
 * The SaaS subscription of the active clinic (V2-05 05-09c; SUB-01, replaces the v1 `subscriptions` /
 * `payment_records` reads). Owner and admin only: SaaS billing is clinic management (SUB §7.1), and RLS on
 * `tenant_subscriptions` admits exactly the owner and admin of the active clinic (`authz.billing_tenant_ids()`). The
 * access level comes from the caller-bound wrapper `my_tenant_access` (no time parameter, own clinics only).
 */
export async function getSubscriptionOverview(): Promise<SubscriptionOverview> {
  await markAction("billing_subscription.get_subscription_overview");
  const supabase = await createClient();
  // SUB §6.2 (05-10a): the owner of a locked or onboarding clinic must still see the subscription.
  const session = await requirePermission(supabase, "clinic:manage", "billing");

  const { data: row, error: rowError } = await supabase
    .from("tenant_subscriptions")
    .select("status, trial_end, current_period_end, access_ends_at, comp_until, cancel_at_period_end")
    .eq("tenant_id", session.tenantId)
    .maybeSingle();
  if (rowError) {
    log.error({ event: "billing.subscription_load.failed", code: errorTag(rowError), requestId: await getRequestId() });
  }

  // V2-09d: the shared lookup, fresh from the database (never the session-context cookie) and once per request; a failure
  // is logged there (`auth.access_level_lookup.failed`) and shows as an unknown level here.
  let level: string | null = null;
  try {
    level = await getTenantAccessLevel(session.tenantId, { fresh: true });
  } catch {
    level = null;
  }

  return {
    subscription:
      row && STATUSES.has(row.status)
        ? {
            status: row.status as SubscriptionStatus,
            trialEnd: row.trial_end,
            currentPeriodEnd: row.current_period_end,
            accessEndsAt: row.access_ends_at,
            compUntil: row.comp_until,
            cancelAtPeriodEnd: row.cancel_at_period_end,
          }
        : null,
    // `getTenantAccessLevel` reads an unknown value as `none` (fail closed); the page shows it as such.
    accessLevel: typeof level === "string" && LEVELS.has(level) ? (level as AccessLevel) : null,
  };
}
