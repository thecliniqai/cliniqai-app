import { createClient } from "@/lib/supabase/server";
import { requireAccessDestination } from "@/lib/auth/access-page";
import { LOCKED_STAFF_PATH } from "@/lib/auth/access-redirect";
import { AccessFact, AccessPageShell } from "@/components/subscription/access-page-shell";
import { en } from "@/messages/en";

export const dynamic = "force-dynamic";

/**
 * `/billing/locked/staff` (V2-05 05-10b; SUB-02, SUB §7.2 item 3): the page of every role other than owner/admin while
 * the clinic is locked. Shows the clinic's name and "contact the owner"; no subscription detail (staff cannot read it,
 * `authz.billing_tenant_ids`) and offers sign-out. Everyone else is redirected by `requireAccessDestination`.
 */
export default async function LockedStaffPage() {
  const { membership } = await requireAccessDestination(LOCKED_STAFF_PATH);
  const t = en.subscription.locked_staff;

  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", membership.tenantId)
    .maybeSingle<{ name: string }>();

  return (
    <AccessPageShell testId="billing-locked-staff" title={t.title}>
      <p>{t.body}</p>
      {tenant?.name ? (
        <dl>
          <AccessFact label={t.clinic}>{tenant.name}</AccessFact>
        </dl>
      ) : null}
    </AccessPageShell>
  );
}
