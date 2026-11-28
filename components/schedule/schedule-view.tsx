"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import type { UserRole } from "@/lib/db/types";
import { isYmd } from "@/lib/datetime";
import type { Versions } from "@/lib/live/domains";
import type { ScheduleView as View } from "@/features/schedule/schema";
import { isScheduleView } from "@/features/schedule/schema";
import { buildScheduleData, rangesFor, serverNowOf } from "@/features/schedule/range";
import { ScheduleSkeleton } from "@/components/shell/skeletons/schedule-skeleton";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Agenda } from "./agenda";
import { BlockTimeDialog } from "./block-time-dialog";
import { DayGrid } from "./day-grid";
import { ScheduleHead } from "./schedule-head";
import { MonthView } from "./month-view";
import { useScheduleRange } from "./use-schedule-range";
import { WaitlistSheet } from "./waitlist-sheet";
import { WeekGrid } from "./week-grid";
import { WeekOverview } from "./week-overview";

/**
 * The Schedule screen (V2-08 08-04b; `/schedule?date&view=day|week|agenda&doctor`): the head, then the day grid (doctor
 * columns, 768 px and up), the agenda (the phone default) or the week overview. With no `view` in the address the width
 * decides: agenda below 768 px, day from 768 px. The booking, reschedule, cancel and no-show UIs are the shared front-desk
 * parts (`FrontDeskSheets` in the dashboard layout and the row menu); this screen owns the waitlist sheet and the block-time
 * dialog.
 * V2-09e 09E-12 (R-10): the screen reads the week that holds the date from the range query (hydrated by the page) and builds the view on the device
 * (`buildScheduleData`). A change of day, week, view or doctor updates the address with `history.pushState` (no page render) and reads the query; a week
 * the device holds shows with no call. Slots whose start has passed are hidden by the device clock corrected to the server's time (display only).
 * PR 2 review I-2: a week the device does not hold and could not read shows why and a way forward instead of the loading skeleton: "Try again" (a re-read)
 * after a failed read, and an offline message while the read waits for the network (it runs again by itself on reconnect). A held week whose re-read failed
 * keeps showing what it has.
 * V2-09f (09F): the week view is a time grid from 768 px (the overview list below); the month view reads the six weeks of the month WITHOUT slots (one
 * `schedule_range` of 42 days, the cap). A settled week prefetches the month of its date and a settled month the week of its date (and the months
 * around it), so switching week and month is 0 calls.
 */
const WIDE = "(min-width: 768px)";

function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

export interface ScheduleViewProps {
  tenantId: string;
  role: UserRole;
  userId: string;
  /** The date the page read (the address's, or the clinic's today): the date shown while the address names none. */
  initialDate: string;
  /** The doctor shown when the address names none (a doctor sees their own day). */
  defaultDoctor?: string;
  /** The clinic versions of the page's read (exact: same statement). */
  versions?: Versions;
}

export function ScheduleView({ tenantId, role, userId, initialDate, defaultDoctor, versions }: ScheduleViewProps) {
  const params = useSearchParams();
  const wide = useWide();
  const asked = params.get("view");
  const view: View = isScheduleView(asked) ? asked : wide ? "day" : "agenda";
  const askedDate = params.get("date");
  const date = isYmd(askedDate) ? askedDate : initialDate;
  const doctor = params.get("doctor") ?? defaultDoctor ?? "all";
  const month = view === "month";
  const { range, ahead } = useMemo(() => rangesFor(date, month), [date, month]);
  const { data: raw, isError, fetchStatus, refetch } = useScheduleRange(tenantId, range, ahead, versions);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const data = useMemo(
    () => (raw ? buildScheduleData(raw, { date, doctor, week: view === "week", month, role, userId, now: serverNowOf(raw) }) : null),
    [raw, date, doctor, view, month, role, userId],
  );
  if (!data) {
    if (fetchStatus === "paused") return <ScheduleUnavailable offline onRetry={() => void refetch()} />;
    if (isError && fetchStatus === "idle") return <ScheduleUnavailable onRetry={() => void refetch()} />;
    return <ScheduleSkeleton />;
  }
  return (
    <div data-schedule="" data-schedule-view={view} data-schedule-range={`${range.from}..${range.to}`} className="flex flex-col gap-4">
      <ScheduleHead data={data} view={view} onOpenWaitlist={() => setWaitlistOpen(true)} onOpenBlock={() => setBlockOpen(true)} />
      {view === "day" && <DayGrid data={data} />}
      {view === "agenda" && <Agenda data={data} />}
      {view === "week" && <div data-week-view="">{wide ? <WeekGrid data={data} /> : <WeekOverview data={data} />}</div>}
      {view === "month" && <MonthView data={data} />}
      <WaitlistSheet open={waitlistOpen} onOpenChange={setWaitlistOpen} data={data} />
      <BlockTimeDialog
        open={blockOpen}
        onOpenChange={setBlockOpen}
        doctors={data.doctors.map((d) => ({ id: d.id, name: d.name }))}
        doctorId={data.block.doctorId ?? undefined}
        initialDate={data.date}
      />
    </div>
  );
}

/** The Schedule's state when its week could not be read (I-2): a failed read offers a re-read; offline says the week loads once the device reconnects. */
function ScheduleUnavailable({ offline = false, onRetry }: { offline?: boolean; onRetry: () => void }) {
  return (
    <div data-schedule-unavailable={offline ? "offline" : "failed"} role="status">
      <EmptyState
        headingLevel={2}
        title={offline ? "You're offline" : "The schedule could not be loaded"}
        description={offline ? "This week will load when you reconnect." : "Try again, or come back to it in a moment."}
        action={
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
