import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership, NoClinicMembershipError } from "@/lib/auth/tenant";
import { AppLayoutShell } from "@/components/layout/app-layout-shell";

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

  // Fetch tenant name
  const { data: tenant } = await (
    (supabase
      .from("tenants")
      .select("name")
      .eq("id", membership.tenantId)
      .single() as unknown) as Promise<{ data: { name: string } | null; error: unknown }>
  );

  return (
    <AppLayoutShell
      tenantName={tenant?.name || "Clinic"}
      role={membership.role}
      userEmail={user.email || "staff@clinic.com"}
    >
      {children}
    </AppLayoutShell>
  );
}
