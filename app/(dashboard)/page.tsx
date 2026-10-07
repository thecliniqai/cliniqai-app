import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership, NoClinicMembershipError } from "@/lib/auth/tenant";

export default async function DashboardPage() {
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

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, id")
    .eq("id", membership.tenantId)
    .maybeSingle<{ name: string; id: string }>();

  return (
    <main className="min-h-screen p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-6 border-b border-[var(--border-default)] gap-4">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--brand-primary)]">
            Active Tenant
          </span>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">
            {tenant?.name || "Clinic Dashboard"}
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5">
            Role: <span className="font-medium text-[var(--text-primary)] capitalize">{membership.role}</span> · Logged in as {user.email}
          </p>
        </div>
      </header>

      <section className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-[var(--radius-lg)] border border-[var(--border-default)] shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Daily Queue</h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            0 patients checked in today
          </p>
        </div>

        <div className="bg-white p-6 rounded-[var(--radius-lg)] border border-[var(--border-default)] shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Appointments</h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            No appointments scheduled
          </p>
        </div>

        <div className="bg-white p-6 rounded-[var(--radius-lg)] border border-[var(--border-default)] shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Clinic Staff</h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            1 active member ({membership.role})
          </p>
        </div>
      </section>
    </main>
  );
}
