import { getClinicProfile } from "@/features/clinics/profile";
import { ALLOWED_SPECIALTIES } from "@/features/clinics/constants";
import { updateClinicProfileAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

export default async function ClinicSettingsPage() {
  const profile = await getClinicProfile();

  if (!profile) {
    return (
      <div className="p-6 bg-white border border-[#E5E4E0] rounded-lg">
        <h2 className="text-lg font-semibold text-red-600">Access Denied</h2>
        <p className="text-sm text-[#666] mt-1">
          You do not have permission to view or manage clinic profile settings.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#1A1A1A]">Clinic Profile</h1>
        <p className="text-sm text-[#666] mt-1">
          Manage clinic public details, practice specialties, and operational hours.
        </p>
      </div>

      <div className="bg-white border border-[#E5E4E0] rounded-lg p-6">
        <form action={updateClinicProfileAction} className="space-y-6">
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
            <div className="grid grid-cols-2 gap-2 mt-2">
              {ALLOWED_SPECIALTIES.map((spec) => {
                const checked = profile.specialties?.includes(spec);
                return (
                  <label key={spec} className="flex items-center gap-2 text-sm text-[#1A1A1A] cursor-pointer">
                    <input
                      type="checkbox"
                      name="specialties"
                      value={spec}
                      defaultChecked={checked}
                      className="w-4 h-4 rounded border-[#D1D0CB] text-[#1769E0] focus:ring-[#1769E0]"
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

          <Button type="submit" variant="primary" className="w-full sm:w-auto">
            Save Clinic Profile
          </Button>
        </form>
      </div>
    </div>
  );
}
