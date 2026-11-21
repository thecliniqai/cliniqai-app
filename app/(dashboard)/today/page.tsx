import { redirect } from "next/navigation";
import { requireServiceContext } from "@/lib/auth/context";
import { redirectIfTenantLocked, withPageAuth } from "@/lib/auth/page";
import { hasPerm } from "@/lib/permissions";
import { formatClinicDateWithWeekday } from "@/lib/datetime/format";
import { getTodayBoard } from "@/features/today/queries";
import { modesOf, resolveMode } from "@/features/today/schema";
import { TodayBoardView } from "@/components/today/today-board";
import { InstallCard } from "@/components/shell/install-card";

/**
 * Today (V2-08 08-03a, P1-29; R-10, R-14): the front desk's day in one live screen. The board is read on the server through
 * the user's own session (`getTodayBoard`: explicit columns, RLS decides what a role sees); the client keeps it live
 * (Realtime signals with a polling fallback) by asking for a fresh render. `?mode=front|triage|doctor` (R-14): the default is
 * the role's own (doctor: their queue; nurse: triage; others: the front desk's day); an owner toggles front and doctor. The
 * doctor's mode, for a doctor or a practising owner, reads only that doctor's visits. 08-03b: this screen replaced the v1
 * dashboard (`/`), queue (`/queue`) and cabin (`/cabin`), which now redirect here.
 */
async function TodayPage(props: { searchParams: Promise<{ mode?: string }> }) {
  const { mode: requested } = await props.searchParams;
  let ctx;
  try {
    ctx = await requireServiceContext("appointments:view");
  } catch (err) {
    // 05-10b: a clinic that is not `full` goes to its locked/onboarding page, not to sign-in.
    await redirectIfTenantLocked(err);
    redirect("/login");
  }

  const mode = resolveMode(ctx.role, requested);
  const result = await getTodayBoard(ctx, { mode, doctorId: mode === "doctor" ? ctx.userId : undefined });
  if (!result.ok) throw new Error("Today could not be loaded.");
  const { board } = result;

  const zone = board.timeZone === "Asia/Kolkata" ? "IST" : board.timeZone;
  return (
    <div className="flex flex-col gap-3">
      <InstallCard />
      <TodayBoardView
        key={mode}
        board={board}
        tenantId={ctx.tenantId}
        mode={mode}
        modes={modesOf(ctx.role)}
        canRegister={hasPerm(ctx.role, "patients:edit")}
        canWalkIn={hasPerm(ctx.role, "appointments:edit")}
        canConsult={hasPerm(ctx.role, "consultations:edit")}
        dateLine={`${formatClinicDateWithWeekday(board.today)} · clinic time (${zone})`}
      />
    </div>
  );
}

// A missing or revoked session in the loader redirects to /login (V2-05 05-11c), never a server error.
export default withPageAuth(TodayPage);
