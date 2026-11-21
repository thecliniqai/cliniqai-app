import { redirect } from "next/navigation";
import { requireServiceContext } from "@/lib/auth/context";
import { redirectIfTenantLocked, withPageAuth } from "@/lib/auth/page";
import { isYmd } from "@/lib/datetime";
import { getSchedule } from "@/features/schedule/queries";
import { isScheduleView } from "@/features/schedule/schema";
import { ScheduleView } from "@/components/schedule/schedule-view";

export const dynamic = "force-dynamic";

/**
 * Schedule (V2-08 08-04b, P1-31; R-14): one clinic day as doctor columns, an agenda or a week overview, with booking,
 * moving, cancelling, no-show, waitlist and blocked time. Read on the server through the user's own session
 * (`getSchedule`: explicit columns, RLS decides). `/calendar` redirects here (`next.config.ts`); a doctor with no `?doctor=` sees their own day.
 */
async function SchedulePage(props: { searchParams: Promise<{ date?: string; view?: string; doctor?: string }> }) {
  const params = await props.searchParams;
  let ctx;
  try {
    ctx = await requireServiceContext("appointments:view");
  } catch (err) {
    // 05-10b: a clinic that is not `full` goes to its locked/onboarding page, not to sign-in.
    await redirectIfTenantLocked(err);
    redirect("/login");
  }

  const view = isScheduleView(params.view) ? params.view : null;
  const doctor = params.doctor ?? (ctx.role === "doctor" ? ctx.userId : undefined);
  const result = await getSchedule(ctx, { date: isYmd(params.date) ? params.date : undefined, doctor, week: view === "week" });
  if (!result.ok) throw new Error("The schedule could not be loaded.");
  return <ScheduleView data={result.data} />;
}

// A missing or revoked session in the loader redirects to /login (V2-05 05-11c), never a server error.
export default withPageAuth(SchedulePage);
