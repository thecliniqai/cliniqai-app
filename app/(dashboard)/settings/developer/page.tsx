import { requirePermission } from "@/lib/permissions/guards";
import { listApiKeys } from "@/features/api-keys/actions";
import { listWebhookSubscriptions } from "@/features/webhooks/actions";
import { DeveloperSettingsView } from "@/components/settings/developer/developer-settings-view";
import { Card, CardContent } from "@/components/ui/card";
import { withPageAuth } from "@/lib/auth/page";

export const metadata = {
  title: "Developer Settings",
  description: "Manage tenant API keys, outgoing webhook subscriptions, and developer integrations.",
};

async function DeveloperSettingsPage() {
  try {
    await requirePermission("clinic:manage");
  } catch {
    return (
      <Card className="max-w-2xl border-rose-200 bg-rose-50/50">
        <CardContent className="p-6">
          <h2 className="text-base font-semibold text-danger-fg">Access Denied</h2>
          <p className="text-xs text-rose-600 mt-1 leading-relaxed">
            Developer settings are restricted to Clinic Owners and Administrators. Contact your clinic owner to request access.
          </p>
        </CardContent>
      </Card>
    );
  }

  const [keysRes, subsRes] = await Promise.all([
    listApiKeys(),
    listWebhookSubscriptions(),
  ]);

  return (
    <div className="max-w-5xl py-2">
      <DeveloperSettingsView
        initialKeys={keysRes.keys || []}
        initialSubscriptions={subsRes.subscriptions || []}
      />
    </div>
  );
}

// A missing or revoked session in the loader redirects to /login (V2-05 05-11c), never a server error.
export default withPageAuth(DeveloperSettingsPage);
