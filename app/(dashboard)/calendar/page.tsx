import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/auth/tenant";
import { getVisitsForDate } from "@/features/visits/actions";
import { getWaitlistForDate } from "@/features/waitlist/actions";
import { getTenantDoctorDirectory } from "@/features/staff/actions";
import { getScheduleBlocksForDate } from "@/features/visits/scheduling";
import { CalendarView } from "@/components/calendar/calendar-view";
import { TimelineVisit } from "@/components/calendar/doctor-timeline";

export const dynamic = "force-dynamic";

interface CalendarPageProps {
  searchParams: Promise<{
    date?: string;
  }>;
}

export default async function CalendarPage(props: CalendarPageProps) {
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

  // Fetch resolved doctor directory for tenant
  const doctorDirectory = await getTenantDoctorDirectory(supabase, {
    userId: membership.userId,
    tenantId: membership.tenantId,
  });

  const doctors = doctorDirectory.map((d) => ({
    id: d.id,
    name: d.name,
    specialty: d.specialty,
    default_slot_duration_minutes: d.default_slot_duration_minutes,
    availability_schedule: d.availability_schedule,
  }));

  // Fetch visits for date
  const visitsRes = await getVisitsForDate(currentDate);
  const visits = (visitsRes.success ? visitsRes.visits : []) as TimelineVisit[];

  // Fetch active waitlist entries for date
  const waitlistRes = await getWaitlistForDate(currentDate);
  const waitlistEntries = waitlistRes.success ? waitlistRes.entries : [];

  // Fetch schedule blocks for date
  const scheduleBlocks = await getScheduleBlocksForDate(
    currentDate,
    undefined,
    supabase,
    { userId: membership.userId, tenantId: membership.tenantId }
  );

  return (
    <div className="max-w-7xl mx-auto py-2">
      <CalendarView
        doctors={doctors}
        visits={visits}
        waitlistEntries={waitlistEntries}
        scheduleBlocks={scheduleBlocks}
        currentDate={currentDate}
      />
    </div>
  );
}
