import { getSubscriptionOverview, type AccessLevel, type SubscriptionStatus } from "@/features/billing/subscription";
import { Badge, type BadgeColor } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { CreditCard, Calendar } from "lucide-react";
import { withPageAuth } from "@/lib/auth/page";

const STATUS_LABEL: Record<SubscriptionStatus, { label: string; color: BadgeColor }> = {
  incomplete: { label: "Setup incomplete", color: "warning" },
  trialing: { label: "Free trial", color: "info" },
  active: { label: "Active", color: "success" },
  past_due: { label: "Payment due", color: "warning" },
  expired: { label: "Expired", color: "error" },
  archived: { label: "Archived", color: "error" },
  purged: { label: "Closed", color: "gray" },
};

const ACCESS_LABEL: Record<AccessLevel, string> = {
  full: "Full access",
  locked: "Locked: billing, export and account pages only",
  onboarding: "Setup required",
  none: "No access",
};

// SUB §10.3: subscription times are shown in IST.
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="text-sm font-medium text-gray-900">{children}</dd>
    </div>
  );
}

function DateValue({ iso }: { iso: string }) {
  return (
    <span className="flex items-center gap-1.5 tabular-nums">
      <Calendar className="w-3.5 h-3.5 text-fg-subtle" aria-hidden="true" />
      {formatDate(iso)}
    </span>
  );
}

async function BillingSettingsPage() {
  let overview;
  try {
    overview = await getSubscriptionOverview();
  } catch {
    return (
      <Card className="max-w-3xl border-red-200 bg-red-50/50">
        <CardContent className="p-6">
          <h2 className="text-base font-bold text-red-700">Access Denied</h2>
          <p className="text-xs text-red-600 mt-1">
            Billing details are restricted to Clinic Owners and Administrators.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { subscription, accessLevel } = overview;
  const compActive = subscription?.compUntil ? new Date(subscription.compUntil).getTime() > Date.now() : false;

  return (
    <div className="space-y-6 max-w-3xl" data-testid="billing-settings">
      <div className="pb-2 border-b border-gray-200">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Subscription & Billing</h1>
        <p className="text-sm text-gray-600 mt-0.5">Your clinic&apos;s plan status and access dates.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent-subtle flex items-center justify-center text-accent-fg border border-accent-border">
              <CreditCard className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <CardTitle>Current Subscription</CardTitle>
              <CardDescription>Status and access for this clinic workspace</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {subscription ? (
            <dl className="divide-y divide-gray-100" data-testid="subscription-overview">
              <Row label="Status">
                <Badge color={STATUS_LABEL[subscription.status].color} size="sm">
                  {STATUS_LABEL[subscription.status].label}
                </Badge>
              </Row>
              <Row label="Access">{accessLevel ? ACCESS_LABEL[accessLevel] : "Unknown"}</Row>
              {subscription.trialEnd && (
                <Row label="Trial ends">
                  <DateValue iso={subscription.trialEnd} />
                </Row>
              )}
              {subscription.currentPeriodEnd && (
                <Row label="Current period ends">
                  <DateValue iso={subscription.currentPeriodEnd} />
                </Row>
              )}
              {subscription.accessEndsAt && (
                <Row label="Access until">
                  <DateValue iso={subscription.accessEndsAt} />
                </Row>
              )}
              {compActive && subscription.compUntil && (
                <Row label="Complimentary access until">
                  <DateValue iso={subscription.compUntil} />
                </Row>
              )}
              {subscription.cancelAtPeriodEnd && <Row label="Renewal">Cancels at the end of the period</Row>}
            </dl>
          ) : (
            <p className="text-xs text-gray-500 py-4 text-center">No subscription record found for this clinic.</p>
          )}
          <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600" role="note">
            Plan management arrives with billing (V2-13b).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// A missing or revoked session in the loader redirects to /login (V2-05 05-11c), never a server error.
export default withPageAuth(BillingSettingsPage);
