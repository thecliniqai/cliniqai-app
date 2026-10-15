import { getClinicProfileWithMembership } from "@/features/clinics/profile";
import { ClinicProfileForm } from "@/components/settings/clinic-profile-form";
import { Card, CardContent } from "@/components/ui/card";

export default async function ClinicSettingsPage() {
  const { tenant: profile, membership } = await getClinicProfileWithMembership();

  if (!profile) {
    return (
      <Card className="max-w-2xl border-red-200 bg-red-50/50">
        <CardContent className="p-6">
          <h2 className="text-base font-bold text-red-700">Access Denied</h2>
          <p className="text-xs text-red-600 mt-1">
            You do not have permission to view or manage clinic profile settings.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="pb-2 border-b border-gray-200">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Clinic Profile &amp; Settings
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Manage practice configuration, doctor credentials, and default OPD consultation fees.
        </p>
      </div>

      <ClinicProfileForm initialTenant={profile} initialOwnerMembership={membership} />
    </div>
  );
}
