import { getMyProfile } from "@/features/settings/actions";
import { UserProfileForm } from "@/components/profile/user-profile-form";

export const metadata = {
  title: "My Profile · ClinicOS",
  description: "Manage your personal information and clinical practice credentials",
};

export default async function ProfilePage() {
  const { user, membership, tenant } = await getMyProfile();

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="pb-2 border-b border-gray-200">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          My Profile &amp; Clinical Credentials
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Manage your account identity, mobile number, medical council registration, and degrees.
        </p>
      </div>

      <UserProfileForm
        user={user}
        membership={membership}
        clinicName={tenant.name}
      />
    </div>
  );
}
