import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/auth/tenant";
import { getVisitsForDate } from "@/features/visits/actions";
import { getWaitlistForDate } from "@/features/waitlist/actions";
import { CalendarView } from "@/components/calendar/calendar-view";
import { TimelineVisit } from "@/components/calendar/doctor-timeline";

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

  // Fetch doctors/staff memberships for tenant
  interface MemberRow {
    id: string;
    user_id: string;
    role: string;
  }

  const { data: memberRows } = await supabase
    .from("memberships")
    .select("id, user_id, role")
    .eq("tenant_id", membership.tenantId);

  const doctors = ((memberRows as MemberRow[] | null) || []).map((m) => ({
    id: m.user_id,
    name: m.role === "doctor" ? `Dr. (${m.user_id.slice(0, 8)})` : `Staff (${m.user_id.slice(0, 8)})`,
  }));

  // Fetch visits for date
  const visitsRes = await getVisitsForDate(currentDate);
  const visits = (visitsRes.success ? visitsRes.visits : []) as TimelineVisit[];

  // Fetch active waitlist entries for date
  const waitlistRes = await getWaitlistForDate(currentDate);
  const waitlistEntries = waitlistRes.success ? waitlistRes.entries : [];

  return (
    <div className="max-w-7xl mx-auto py-2">
      <CalendarView
        doctors={doctors}
        visits={visits}
        waitlistEntries={waitlistEntries}
        currentDate={currentDate}
      />
    </div>
  );
}
