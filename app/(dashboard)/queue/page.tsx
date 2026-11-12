import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getQueueForDate } from "@/features/queue/actions";
import { getTenantDoctorDirectory } from "@/features/staff/service";
import { requireServiceContext } from "@/lib/auth/context";
import { QueueView } from "@/components/queue/queue-view";
import { DoctorOption } from "@/components/queue/walk-in-drawer";
import { isYmd } from "@/lib/datetime";
import { getTenantToday } from "@/lib/datetime/server";

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
    membership = await requireServiceContext();
  } catch {
    redirect("/login");
  }

  // The clinic's day in its own zone (V2-03 03-05); an unusable ?date= falls back to it.
  const { today } = await getTenantToday(supabase, membership.tenantId);
  const currentDate = isYmd(searchParams.date) ? searchParams.date : today;
  const selectedDoctorId = searchParams.doctor || "all";

  // Fetch resolved doctors for tenant
  const doctorDirectory = await getTenantDoctorDirectory(membership);

  const doctors: DoctorOption[] = doctorDirectory.map((d) => ({
    id: d.id,
    name: d.name,
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
