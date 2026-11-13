import { redirect } from "next/navigation";
import { getVisitsForDate } from "@/features/visits/service";
import { getWaitlistForDate } from "@/features/waitlist/service";
import { getTenantDoctorDirectory } from "@/features/staff/service";
import { requireServiceContext } from "@/lib/auth/context";
import { getScheduleBlocksForDate } from "@/features/visits/scheduling-service";
import { CalendarView } from "@/components/calendar/calendar-view";
import { TimelineVisit } from "@/components/calendar/doctor-timeline";
import { isYmd } from "@/lib/datetime";
import { getTenantToday } from "@/lib/datetime/server";

export const dynamic = "force-dynamic";

interface CalendarPageProps {
  searchParams: Promise<{
    date?: string;
  }>;
}

export default async function CalendarPage(props: CalendarPageProps) {
  const searchParams = await props.searchParams;

  let membership;
  try {
    membership = await requireServiceContext();
  } catch {
    redirect("/login");
  }

  // The clinic's day in its own zone (V2-03 03-05); an unusable ?date= falls back to it.
  const { today } = await getTenantToday(membership.db, membership.tenantId);
  const currentDate = isYmd(searchParams.date) ? searchParams.date : today;

  // Fetch resolved doctor directory for tenant
  const doctorDirectory = await getTenantDoctorDirectory(membership);

  const doctors = doctorDirectory.map((d) => ({
    id: d.id,
    name: d.name,
    specialty: d.specialty,
    default_slot_duration_minutes: d.default_slot_duration_minutes,
    availability_schedule: d.availability_schedule,
  }));

  // Fetch visits for date
  const visitsRes = await getVisitsForDate(membership, currentDate);
  const visits = (visitsRes.success ? visitsRes.visits : []) as TimelineVisit[];

  // Fetch active waitlist entries for date
  const waitlistRes = await getWaitlistForDate(membership, currentDate);
  const waitlistEntries = waitlistRes.success ? waitlistRes.entries : [];

  // Fetch schedule blocks for date
  const scheduleBlocks = await getScheduleBlocksForDate(membership, currentDate);

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
