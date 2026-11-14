import { getMyProfile } from "@/features/settings/actions";
import { UserProfileForm } from "@/components/profile/user-profile-form";
import { ChangePasswordForm } from "@/components/profile/change-password-form";
import { withPageAuth } from "@/lib/auth/page";

export const metadata = {
  title: "My Profile · ClinicOS",
  description: "Manage your personal information and clinical practice credentials",
};

async function ProfilePage() {
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

      {/* 03-12a (AUTH-04b): change password; FT-05 and other-device sign-out run in the server action. */}
      <ChangePasswordForm email={user.email} />
    </div>
  );
}

// A missing or revoked session in the loader redirects to /login (V2-05 05-11c), never a server error.
export default withPageAuth(ProfilePage);
