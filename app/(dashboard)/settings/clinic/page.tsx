import { getClinicProfile } from "@/features/clinics/profile";
import { ALLOWED_SPECIALTIES } from "@/features/clinics/constants";
import { updateClinicProfileAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Building2, Save } from "lucide-react";

export default async function ClinicSettingsPage() {
  const profile = await getClinicProfile();

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
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="pb-2 border-b border-gray-200">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Clinic Profile
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Manage clinic public details, practice specialties, and operational timezone.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center text-brand-600 border border-brand-100">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <CardTitle>Clinic Identity & Operations</CardTitle>
              <CardDescription>
                Public organization information visible on appointment slips and receipts
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form action={updateClinicProfileAction} className="space-y-5">
            <Field label="Clinic Name" htmlFor="name" required>
              <Input
                id="name"
                name="name"
                type="text"
                required
                defaultValue={profile.name}
                placeholder="e.g. City Health Clinic"
              />
            </Field>

            <Field label="Physical Address" htmlFor="address">
              <Input
                id="address"
                name="address"
                type="text"
                defaultValue={profile.address || ""}
                placeholder="Suite 101, Main Healthcare Complex"
              />
            </Field>

            <Field
              label="Practice Specialties"
              htmlFor="specialties"
              help="Select all medical disciplines offered at this facility."
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-2 p-3 bg-gray-50/50 rounded-xl border border-gray-200">
                {ALLOWED_SPECIALTIES.map((spec) => {
                  const checked = profile.specialties?.includes(spec);
                  return (
                    <label key={spec} className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        name="specialties"
                        value={spec}
                        defaultChecked={checked}
                        className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500/20 cursor-pointer"
                      />
                      <span>{spec}</span>
                    </label>
                  );
                })}
              </div>
            </Field>

            <Field label="Operational Timezone" htmlFor="timezone" required>
              <Input
                id="timezone"
                name="timezone"
                type="text"
                required
                defaultValue={profile.timezone || "Asia/Kolkata"}
              />
            </Field>

            <div className="pt-2">
              <Button type="submit" variant="primary" className="w-full sm:w-auto">
                <Save className="w-4 h-4 mr-2" />
                Save Clinic Profile
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

