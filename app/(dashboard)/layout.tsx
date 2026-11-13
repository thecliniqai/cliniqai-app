import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership, NoClinicMembershipError } from "@/lib/auth/tenant";
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
