"use client";

import { useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import type { ScheduleData, ScheduleView as View } from "@/features/schedule/schema";
import { isScheduleView } from "@/features/schedule/schema";
import { Agenda } from "./agenda";
import { BlockTimeDialog } from "./block-time-dialog";
import { DayGrid } from "./day-grid";
import { ScheduleHead } from "./schedule-head";
import { WaitlistSheet } from "./waitlist-sheet";
import { WeekOverview } from "./week-overview";

/**
 * The Schedule screen (V2-08 08-04b; `/schedule?date&view=day|week|agenda&doctor`): the head, then the day grid (doctor
 * columns, 768 px and up), the agenda (the phone default) or the week overview. With no `view` in the address the width
 * decides: agenda below 768 px, day from 768 px. The booking, reschedule, cancel and no-show UIs are the shared front-desk
 * parts (`FrontDeskSheets` in the dashboard layout and the row menu); this screen owns the waitlist sheet and the block-time
 * dialog.
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

export function ScheduleView({ data }: { data: ScheduleData }) {
  const params = useSearchParams();
  const wide = useWide();
  const asked = params.get("view");
  const view: View = isScheduleView(asked) ? asked : wide ? "day" : "agenda";
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  return (
    <div data-schedule="" data-schedule-view={view} className="flex flex-col gap-4">
      <ScheduleHead data={data} view={view} onOpenWaitlist={() => setWaitlistOpen(true)} onOpenBlock={() => setBlockOpen(true)} />
      {view === "day" && <DayGrid data={data} />}
      {view === "agenda" && <Agenda data={data} />}
      {view === "week" && <WeekOverview data={data} />}
      <WaitlistSheet open={waitlistOpen} onOpenChange={setWaitlistOpen} data={data} />
      <BlockTimeDialog
        open={blockOpen}
        onOpenChange={setBlockOpen}
        doctors={data.doctors.map((d) => ({ id: d.id, name: d.name }))}
        initialDate={data.date}
      />
    </div>
  );
}
