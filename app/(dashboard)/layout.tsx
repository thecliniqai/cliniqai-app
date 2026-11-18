import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership, getTenantAccessLevel, NoClinicMembershipError } from "@/lib/auth/tenant";
import { accessRedirect } from "@/lib/auth/access-redirect";
import { AppLayoutShell } from "@/components/layout/app-layout-shell";
import { resolveTimeZone } from "@/lib/datetime";
import { ClinicTimeZoneProvider } from "@/lib/datetime/client";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let membership;
  try {
    membership = await getActiveMembership();
  } catch (error) {
    if (error instanceof NoClinicMembershipError) {
      redirect("/clinic/new");
    }
    throw error;
  }

  // V2-05 05-10b (SUB-02, SUB §7.2 item 3): a clinic without full access sees only its locked or onboarding page
  // (`lib/auth/access-redirect.ts`: owner/admin → /billing/locked, other roles → /billing/locked/staff, onboarding →
  // /onboarding/billing). The level comes from the database (`my_tenant_access`); a lookup failure throws (fail
  // closed). This is the UX on top of the database stop (RLS, storage, definer RPCs and guards, 05-10a), not the
  // control itself. The destinations are outside this layout, so they never loop, and the proxy does not query the
  // database (SUB §7.2 item 5): PWA assets and every non-dashboard path are never redirected by this rule.
  const destination = accessRedirect(membership.role, await getTenantAccessLevel(membership.tenantId));
  if (destination) {
    redirect(destination);
  }

  // Fetch tenant name and zone
  const { data: tenant } = await (
    (supabase
      .from("tenants")
      .select("name, timezone")
      .eq("id", membership.tenantId)
      .single() as unknown) as Promise<{ data: { name: string; timezone: string | null } | null; error: unknown }>
  );

  // Every client component below reads the clinic's zone from here (V2-03 03-05); the browser zone is never used.
  return (
    <ClinicTimeZoneProvider timeZone={resolveTimeZone(tenant?.timezone)}>
      <AppLayoutShell
        tenantName={tenant?.name || "Clinic"}
        role={membership.role}
        userEmail={user.email || "staff@clinic.com"}
      >
        {children}
      </AppLayoutShell>
    </ClinicTimeZoneProvider>
  );
}
