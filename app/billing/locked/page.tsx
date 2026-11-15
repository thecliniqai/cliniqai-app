import { createClient } from "@/lib/supabase/server";
import { requireAccessDestination } from "@/lib/auth/access-page";
import { LOCKED_OWNER_PATH } from "@/lib/auth/access-redirect";
import { getSubscriptionOverview, type SubscriptionOverview } from "@/features/billing/subscription";
import { AccessFact, AccessPageShell, formatIstDateTime } from "@/components/subscription/access-page-shell";
import { en } from "@/messages/en";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

export const dynamic = "force-dynamic";

/**
 * `/billing/locked` (V2-05 05-10b; SUB-02, SUB §7.2 item 3): the owner's and admin's page while the clinic is locked
 * (or its level is unreadable). Shows the clinic, the subscription status, when access ended, that the data is safe
 * and where renewal and export will open; offers sign-out. Reads only what a locked owner/admin may read: `tenants`
 * (member helper) and the subscription (billing helper, `getSubscriptionOverview` with `access: "billing"`). Members
 * of a `full` clinic, other roles and onboarding clinics are redirected by `requireAccessDestination`.
 */
export default async function LockedOwnerPage() {
  const { membership } = await requireAccessDestination(LOCKED_OWNER_PATH);
  const t = en.subscription.locked;

  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", membership.tenantId)
    .maybeSingle<{ name: string }>();

  let overview: SubscriptionOverview | null = null;
  try {
    overview = await getSubscriptionOverview();
  } catch (err) {
    // A purged clinic (level `none`) has no billing access: the page still renders, without the subscription facts.
    log.warn({ event: "billing.locked_page.subscription_unavailable", code: errorTag(err), requestId: await getRequestId() });
  }
  const subscription = overview?.subscription ?? null;

  return (
    <AccessPageShell testId="billing-locked" title={t.title}>
      <p>{t.intro}</p>
      <dl className="divide-y divide-gray-100" data-testid="billing-locked-facts">
        <AccessFact label={t.clinic}>{tenant?.name ?? t.unknown}</AccessFact>
        <AccessFact label={t.status}>
          {subscription ? en.subscription.status[subscription.status] : t.unknown}
        </AccessFact>
        <AccessFact label={t.access_ended}>
          {subscription?.accessEndsAt ? (
            <span className="tabular-nums">{formatIstDateTime(subscription.accessEndsAt)}</span>
          ) : (
            t.unknown
          )}
        </AccessFact>
      </dl>
      <p className="rounded-lg bg-gray-50 px-3 py-2" role="note">
        {t.data_safe}
      </p>
      <p>{t.renewal}</p>
    </AccessPageShell>
  );
}
