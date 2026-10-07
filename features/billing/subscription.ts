"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { Subscription, PaymentRecord } from "@/lib/db/types";

export interface SubscriptionOverview {
  subscription: Subscription | null;
  payments: PaymentRecord[];
}

export async function getSubscriptionOverview(): Promise<SubscriptionOverview> {
  const supabase = await createClient();

  // 1. Enforce RBAC guard: Owner and Admin only
  const session = await requirePermission(supabase, "billing:view");

  // 2. Fetch subscription under RLS (RLS ensures only owner/admin of session.tenantId can read)
  const { data: subData, error: subError } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("tenant_id", session.tenantId)
    .returns<Subscription | null>()
    .maybeSingle();

  if (subError) {
    console.error("[features/billing/subscription] Error fetching subscription:", subError);
  }

  // 3. Fetch payment history under RLS
  const { data: paymentsData, error: paymentsError } = await supabase
    .from("payment_records")
    .select("*")
    .eq("tenant_id", session.tenantId)
    .order("paid_at", { ascending: false })
    .returns<PaymentRecord[]>();

  if (paymentsError) {
    console.error("[features/billing/subscription] Error fetching payments:", paymentsError);
  }

  return {
    subscription: subData || null,
    payments: paymentsData || [],
  };
}
