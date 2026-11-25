import { redirect } from "next/navigation";
import { HydrationBoundary } from "@tanstack/react-query";
import { requireServiceContext } from "@/lib/auth/context";
import { redirectIfTenantLocked, withPageAuth } from "@/lib/auth/page";
import { DEFAULT_CLINIC_TZ, isYmd, resolveTimeZone, todayInTz } from "@/lib/datetime";
import { getScheduleRange } from "@/features/schedule/queries";
import { rangeOfDate, rangeVersions } from "@/features/schedule/range";
import { ScheduleView } from "@/components/schedule/schedule-view";
import { createRequestQueryClient, dehydrateRequest } from "@/lib/query/server";
import { queryKeys } from "@/lib/query/keys";

export const dynamic = "force-dynamic";

/**
 * Schedule (V2-08 08-04b, P1-31; R-14): one clinic day as doctor columns, an agenda or a week overview, with booking,
 * moving, cancelling, no-show, waitlist and blocked time. `/calendar` redirects here (`next.config.ts`); a doctor with no `?doctor=` sees their own day.
 * V2-09e 09E-12 (R-10): the page reads the Monday-to-Sunday week that holds the date in ONE call (`schedule_range`: zone, versions, clinicians, blocks,
 * visits, waitlist and the free slots from SQL) and hands it to the client's range query (`HydrationBoundary`); the day, agenda and week views are built
 * from it on the device, a change of day or week is the query (no page render), the adjacent weeks are prefetched, and the screen is live (R-18).
 * With no `?date=` the date is the clinic's today. The zone is in the answer, so the page reads the week of today in the default zone (Asia/Kolkata) and
 * reads again only when the clinic's own today falls in another week (a clinic in another zone, around midnight between Sunday and Monday): one call
 * almost always, never a wrong week.
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

  const asked = isYmd(params.date) ? params.date : null;
  let date = asked ?? todayInTz(DEFAULT_CLINIC_TZ);
  let range = rangeOfDate(date);
  let result = await getScheduleRange(ctx, { ...range, withSlots: true });
  if (result.ok && !asked) {
    date = todayInTz(resolveTimeZone(result.range.zone));
    const own = rangeOfDate(date);
    if (own.from !== range.from) {
      range = own;
      result = await getScheduleRange(ctx, { ...range, withSlots: true });
    }
  }
  if (!result.ok) throw new Error("The schedule could not be loaded.");

  const queryClient = createRequestQueryClient();
  queryClient.setQueryData(queryKeys.scheduleRange(ctx.tenantId, range.from, range.to, true), result.range);
  return (
    <HydrationBoundary state={dehydrateRequest(queryClient)}>
      <ScheduleView
        tenantId={ctx.tenantId}
        role={ctx.role}
        userId={ctx.userId}
        initialDate={date}
        defaultDoctor={ctx.role === "doctor" ? ctx.userId : undefined}
        versions={rangeVersions(result.range) ?? undefined}
      />
    </HydrationBoundary>
  );
}

// A missing or revoked session in the loader redirects to /login (V2-05 05-11c), never a server error.
export default withPageAuth(SchedulePage);
