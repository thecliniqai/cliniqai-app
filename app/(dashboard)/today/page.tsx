import { redirect } from "next/navigation";
import { requireServiceContext } from "@/lib/auth/context";
import { redirectIfTenantLocked, withPageAuth } from "@/lib/auth/page";
import { hasPerm } from "@/lib/permissions";
import { getOpenAmendments, getTodayBoard } from "@/features/today/queries";
import { groupIntoLanes, modesOf, nextUp, resolveMode } from "@/features/today/schema";
import { getPatientSnapshot } from "@/features/consultation/service";
import { activeEntitlements } from "@/lib/entitlements/require-entitlement";
import type { SnapshotPanelData } from "@/components/today/patient-snapshot-panel";
import { TodayBoardView } from "@/components/today/today-board";
import { InstallCard } from "@/components/shell/install-card";
import { HydrationBoundary } from "@tanstack/react-query";
import { createRequestQueryClient, dehydrateRequest } from "@/lib/query/server";
import { queryKeys } from "@/lib/query/keys";
import { getTenantTimeZoneAndVersions } from "@/lib/datetime/server";

/**
 * Today (V2-08 08-03a, P1-29; R-10, R-14): the front desk's day in one live screen. The board is read on the server through
 * the user's own session (`getTodayBoard`: explicit columns, RLS decides what a role sees); the client keeps it live
 * (Realtime signals with a polling fallback) by asking for a fresh render. `?mode=front|triage|doctor` (R-14): the default is
 * the role's own (doctor: their queue; nurse: triage; others: the front desk's day); an owner toggles front and doctor. The
 * doctor's mode, for a doctor or a practising owner, reads only that doctor's visits. 08-03b: this screen replaced the v1
 * dashboard (`/`), queue (`/queue`) and cabin (`/cabin`), which now redirect here.
 * V2-09e 09E-03 (R-14): the page still reads the board once on the server (first paint, no spinner) and hands it to the client's
 * query for this clinic and mode (`HydrationBoundary`); every later refresh is one `GET /api/today/board` into the same query.
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
  // 09E-04 (R-18): the clinic's versions are read BEFORE the board, in the statement that reads the clinic's zone (no extra call), so they are a lower
  // bound of what the board holds (research 2.1): the live core re-reads the board only when a version above them arrives. A failed read hands the
  // screen no basis (one extra re-read, never a missed one).
  const { zone, versions } = await getTenantTimeZoneAndVersions(ctx.db, ctx.tenantId);
  const result = await getTodayBoard(ctx, { mode, doctorId: mode === "doctor" ? ctx.userId : undefined, timeZone: zone });
  if (!result.ok) throw new Error("Today could not be loaded.");
  const { board } = result;

  // Doctor mode (V2-09b 09B-04a): the Next patient's snapshot when the clinic has `assist.snapshot`, and the doctor's open amendments. Both are read on the
  // session's own context under RLS; a failed or refused read leaves the panel out.
  let snapshotPanel: SnapshotPanelData | null = null;
  let openAmendments: Awaited<ReturnType<typeof getOpenAmendments>> = [];
  if (mode === "doctor") {
    openAmendments = await getOpenAmendments(ctx);
    let entitled = new Map<string, { enabled: boolean }>();
    try {
      entitled = await activeEntitlements();
    } catch {
      // no Smart Assist for this clinic
    }
    const next = nextUp(groupIntoLanes(board.rows, "doctor"));
    if (next && entitled.get("assist.snapshot")?.enabled === true) {
      const snapshot = await getPatientSnapshot(ctx, next.patientId, next.visitId);
      if (snapshot) snapshotPanel = { patientId: next.patientId, snapshot, flags: entitled.get("assist.vitals")?.enabled === true };
    }
  }

  const queryClient = createRequestQueryClient();
  queryClient.setQueryData(queryKeys.today(ctx.tenantId, mode), board);
  return (
    <HydrationBoundary state={dehydrateRequest(queryClient)}>
      <div className="flex flex-col gap-3">
        <InstallCard />
        <TodayBoardView
          key={mode}
          tenantId={ctx.tenantId}
          mode={mode}
          modes={modesOf(ctx.role)}
          canRegister={hasPerm(ctx.role, "patients:edit")}
          canWalkIn={hasPerm(ctx.role, "appointments:edit")}
          canConsult={hasPerm(ctx.role, "consultations:edit")}
          snapshotPanel={snapshotPanel}
          openAmendments={openAmendments}
          versions={versions ?? undefined}
        />
      </div>
    </HydrationBoundary>
  );
}

// A missing or revoked session in the loader redirects to /login (V2-05 05-11c), never a server error.
export default withPageAuth(TodayPage);
