import { createClient } from "@/lib/supabase/server";
import { requireAccessDestination } from "@/lib/auth/access-page";
import { ONBOARDING_BILLING_PATH } from "@/lib/auth/access-redirect";
import { AccessFact, AccessPageShell } from "@/components/subscription/access-page-shell";
import { en } from "@/messages/en";

export const dynamic = "force-dynamic";

/**
 * `/onboarding/billing` (V2-05 05-10b, interim; SUB-02, SUB §7.2 item 3, AUTH §3.1 resume rule): every member of a
 * clinic whose subscription is `incomplete` (level `onboarding`) lands here, which is where every clinic created by
 * `create_clinic_with_owner` starts. The billing profile and the trial checkout (AUTH-07/SUB-03) replace this page in
 * V2-13b; until then it says so to the owner/admin and "contact the owner" to everyone else, and offers sign-out.
 */
export default async function OnboardingBillingPage() {
  const { membership } = await requireAccessDestination(ONBOARDING_BILLING_PATH);
  const t = en.subscription.onboarding;
  const managesBilling = membership.role === "owner" || membership.role === "admin";

  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", membership.tenantId)
    .maybeSingle<{ name: string }>();

  return (
    <AccessPageShell testId="onboarding-billing" title={t.title}>
      <p>{managesBilling ? t.owner_body : t.staff_body}</p>
      {tenant?.name ? (
        <dl>
          <AccessFact label={t.clinic}>{tenant.name}</AccessFact>
        </dl>
      ) : null}
    </AccessPageShell>
  );
}
