import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership, NoClinicMembershipError } from "@/lib/auth/tenant";
import { DashboardNav } from "@/components/dashboard/nav";

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
    <div className="min-h-screen bg-[#F7F6F3] flex flex-col">
      <DashboardNav
        tenantName={tenant?.name || "Clinic"}
        role={membership.role}
      />
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 md:p-8">
        {children}
      </main>
    </div>
  );
}
