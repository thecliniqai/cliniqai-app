import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/auth/tenant";
import { getQueueForDate } from "@/features/queue/actions";
import { QueueView } from "@/components/queue/queue-view";
import { DoctorOption } from "@/components/queue/walk-in-drawer";

interface QueuePageProps {
  searchParams: Promise<{
    date?: string;
    doctor?: string;
  }>;
}

export default async function QueuePage(props: QueuePageProps) {
  const searchParams = await props.searchParams;
  const supabase = await createClient();

  let membership;
  try {
    membership = await getActiveMembership();
  } catch {
    redirect("/login");
  }

  // Today's date YYYY-MM-DD default
  const today = new Date().toISOString().split("T")[0];
  const currentDate = searchParams.date || today;
  const selectedDoctorId = searchParams.doctor || "all";

  // Fetch doctors/staff memberships for tenant
  const { data: memberRows } = await supabase
    .from("memberships")
    .select("id, user_id, role")
    .eq("tenant_id", membership.tenantId);

  interface MemberRow {
    id: string;
    user_id: string;
    role: string;
  }

  const doctors: DoctorOption[] = ((memberRows as MemberRow[] | null) || []).map((m) => ({
    id: m.user_id,
    name: m.role === "doctor" ? `Dr. (${m.user_id.slice(0, 8)})` : `Staff (${m.user_id.slice(0, 8)})`,
  }));

  // Fetch live queue items
  const queueResult = await getQueueForDate(
    currentDate,
    selectedDoctorId === "all" ? undefined : selectedDoctorId
  );

  const initialItems = queueResult.success ? queueResult.items : [];

  return (
    <div className="max-w-6xl mx-auto py-2">
      <QueueView
        initialItems={initialItems}
        currentDate={currentDate}
        doctors={doctors}
        selectedDoctorId={selectedDoctorId}
      />
    </div>
  );
}
