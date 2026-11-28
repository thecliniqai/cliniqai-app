"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CalendarClock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { STATUS_CHIP_TONE } from "@/components/clinical/status-chip";
import { type GridAppointment, type WeekGrid as Grid } from "@/features/schedule/calendar";
import { scheduleHref, type ScheduleAppointment, type ScheduleData } from "@/features/schedule/schema";
import { formatClinicDateWithWeekday, formatClinicTime, formatDayChip } from "@/lib/datetime/format";
import { displayVisitStatus } from "@/lib/visit-status";
import { cn } from "@/lib/utils";
import { AppointmentCard } from "./appointment-card";
import { blockText } from "./day-grid";
import { inPlace, useScheduleNavigate } from "./navigate";

/**
 * The week time grid (V2-09f 09F; `/schedule?view=week`, 768 px and up): one doctor's Monday-to-Sunday, a time axis down the side and one column per
 * day. A grid row is the doctor's slot length, 44 px tall on a touch screen and 32 px with a fine pointer (DESIGN_SYSTEM §6: 44 px touch targets).
 * Appointments are blocks at their time and length in their status tone (overlapping ones side by side); blocked time is a hatched band; each free slot
 * that has not started is a link to the booking sheet with doctor, date and time filled in (`?book=1&doctor&date&time`; its slots come from this range,
 * no call). An appointment opens its card (the Schedule's `AppointmentCard`: the patient, Confirm and the ⋯ menu) and "Pick a new time": the free slots
 * then become "Move here" links to the reschedule sheet with that slot chosen (`?reschedule=<id>&date&time`), which sends `reschedule_visit` with the
 * version it read (R-19). Esc or "Stop moving" leaves that mode. Every block and slot is reachable by Tab, day by day in time order.
 * Everything on it comes from the week's `schedule_range` answer (live), built by `buildScheduleData`.
 */
interface Moving {
  visitId: string;
  /** The doctor whose week the move started in: a move ends when the doctor filter changes (review M-1). */
  doctorId: string;
  name: string;
  date: string;
  time: string;
}

/** `top`/`height` of something `minutes` long starting at `start`, in grid rows (`--slot-row` tall). */
function place(start: number, minutes: number, grid: Grid): { top: string; height: string } {
  const rows = (start - grid.startMinute) / grid.slotMinutes;
  const span = Math.max(1, minutes / grid.slotMinutes);
  return { top: `calc(var(--slot-row) * ${rows})`, height: `calc(var(--slot-row) * ${span})` };
}

function withParams(pathname: string, params: { toString(): string }, set: Record<string, string>, drop: string[] = []): string {
  const next = new URLSearchParams(params.toString());
  for (const key of drop) next.delete(key);
  for (const [k, v] of Object.entries(set)) next.set(k, v);
  return `${pathname}?${next.toString()}`;
}

export function WeekGrid({ data }: { data: ScheduleData }) {
  const grid = data.week?.grid ?? null;
  const pathname = usePathname();
  const params = useSearchParams();
  const navigate = useScheduleNavigate();
  const [movingState, setMoving] = useState<Moving | null>(null);
  // A move belongs to the week it started in: another doctor's slots never become its targets (the sheet would move it to its own doctor).
  const moving = movingState && grid && movingState.doctorId === grid.doctorId ? movingState : null;

  // Esc leaves the move mode (unless a dialog or sheet is open: it closes that instead).
  useEffect(() => {
    if (!moving) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("[role=dialog], [role=alertdialog]")) return;
      setMoving(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moving]);

  if (!grid) return <p className="text-body-sm text-fg-muted">Pick a doctor to see their week.</p>;
  const doctor = data.doctors.find((d) => d.id === grid.doctorId);
  const hours = Array.from({ length: (grid.endMinute - grid.startMinute) / 60 + 1 }, (_, i) => grid.startMinute + i * 60);
  const totalRows = (grid.endMinute - grid.startMinute) / grid.slotMinutes;
  const hourLabel = (m: number) => formatClinicTime(`${String(Math.floor(m / 60) % 24).padStart(2, "0")}:00`);

  return (
    <section aria-label={`Week of ${doctor?.name ?? "the doctor"}`} data-week-grid="" className="flex flex-col gap-2">
      <h2 className="font-display text-title-3 text-fg">{doctor?.name}</h2>
      {moving && (
        <div role="status" data-move-mode="" className="flex flex-wrap items-center gap-2 rounded-md border border-accent bg-surface-soft px-3 py-2 text-body-sm text-fg">
          <CalendarClock aria-hidden="true" className="size-4 shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            Moving <span className="font-semibold">{moving.name}</span> ({formatClinicDateWithWeekday(moving.date)}, {formatClinicTime(moving.time)}). Choose a
            free slot.
          </span>
          <Button type="button" variant="secondary" startIcon={<X aria-hidden="true" />} onClick={() => setMoving(null)}>
            Stop moving
          </Button>
        </div>
      )}
      <div
        data-week-grid-scroll=""
        className="max-h-[70dvh] overflow-auto overscroll-contain rounded-lg border border-border bg-surface [--slot-row:2.75rem] pointer-fine:[--slot-row:2rem]"
      >
        <div className="grid min-w-[56rem]" style={{ gridTemplateColumns: "3.75rem repeat(7, minmax(7rem, 1fr))" }}>
          <div aria-hidden="true" className="sticky top-0 left-0 z-30 border-b border-border bg-surface" />
          {grid.days.map((day) => {
            const href = scheduleHref({ date: day.date, view: "day", doctor: grid.doctorId, today: data.today });
            const isToday = day.date === data.today;
            return (
              <div key={day.date} className="sticky top-0 z-20 border-b border-l border-border bg-surface px-1 py-1.5 text-center">
                <Link
                  href={href}
                  prefetch={false}
                  onClick={inPlace(navigate, href)}
                  data-week-grid-day={day.date}
                  aria-label={`${formatDayChip(day.date)}: open ${formatClinicDateWithWeekday(day.date)}`}
                  aria-current={isToday ? "date" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center justify-center rounded-md px-2 text-label font-semibold pointer-fine:min-h-8 hover:bg-surface-muted",
                    isToday ? "text-accent" : "text-fg",
                  )}
                >
                  {formatDayChip(day.date)}
                </Link>
              </div>
            );
          })}

          {/* The time axis. */}
          <div aria-hidden="true" className="sticky left-0 z-10 bg-surface" style={{ height: `calc(var(--slot-row) * ${totalRows})` }}>
            {hours.slice(0, -1).map((m) => (
              <span key={m} className="absolute right-2 -translate-y-0 text-caption text-fg-muted tabular-nums" style={{ top: place(m, 0, grid).top }}>
                {hourLabel(m)}
              </span>
            ))}
          </div>

          {grid.days.map((day) => {
            const past = day.date < data.today;
            type Item = { start: number; key: string; node: ReactNode };
            const items: Item[] = [];
            for (const a of day.appointments) {
              items.push({
                start: a.start,
                key: `a-${a.appointment.visitId}`,
                node: <AppointmentBlock key={`a-${a.appointment.visitId}`} item={a} grid={grid} date={day.date} canMove={data.canEdit} onMove={setMoving} />,
              });
            }
            for (const f of day.free) {
              const label = `${formatClinicDateWithWeekday(day.date)}, ${formatClinicTime(f.slot.time)}`;
              const href = moving
                ? withParams(pathname, params, { reschedule: moving.visitId, date: day.date, time: f.slot.time }, ["book"])
                : withParams(pathname, params, { book: "1", doctor: grid.doctorId, date: day.date, time: f.slot.time }, ["reschedule"]);
              items.push({
                start: f.start,
                key: `f-${f.slot.time}`,
                node: data.canEdit ? (
                  <li key={`f-${f.slot.time}`} className="absolute inset-x-1" style={place(f.start, f.slot.minutes, grid)}>
                    <Link
                      href={href}
                      prefetch={false}
                      onClick={(event) => {
                        inPlace(navigate, href)(event);
                        if (moving) setMoving(null);
                      }}
                      data-free-slot={f.slot.time}
                      data-free-slot-date={day.date}
                      aria-label={moving ? `Move ${moving.name} to ${label}` : `Book ${label}`}
                      className={cn(
                        "flex h-full items-center rounded-sm border border-dashed px-1.5 text-caption tabular-nums focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
                        moving
                          ? "border-accent bg-surface-soft font-semibold text-accent hover:bg-surface-muted"
                          : "border-border-strong text-fg-secondary hover:bg-surface-muted",
                      )}
                    >
                      {formatClinicTime(f.slot.time)}
                    </Link>
                  </li>
                ) : (
                  <li key={`f-${f.slot.time}`} className="absolute inset-x-1 flex items-center px-1.5 text-caption text-fg-muted tabular-nums" style={place(f.start, f.slot.minutes, grid)}>
                    <span className="sr-only">Free </span>
                    {formatClinicTime(f.slot.time)}
                  </li>
                ),
              });
            }
            items.sort((x, y) => x.start - y.start || x.key.localeCompare(y.key));
            return (
              <section
                key={day.date}
                aria-label={formatClinicDateWithWeekday(day.date)}
                data-week-grid-column={day.date}
                className={cn("relative isolate border-l border-border", past && "bg-surface-soft")}
                style={{ height: `calc(var(--slot-row) * ${totalRows})` }}
              >
                {hours.slice(1, -1).map((m) => (
                  <div key={m} aria-hidden="true" className="absolute inset-x-0 border-t border-border" style={{ top: place(m, 0, grid).top }} />
                ))}
                {day.blocks.length > 0 && (
                  <ul aria-label={`Blocked time, ${formatClinicDateWithWeekday(day.date)}`}>
                    {day.blocks.map(({ block, start, end }) => (
                      <li
                        key={block.id}
                        data-schedule-block={block.id}
                        className="absolute inset-x-0 overflow-hidden border-y border-dashed border-border-strong bg-surface-muted bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--color-border)_6px_7px)] px-1.5 py-0.5 text-caption text-fg-secondary"
                        style={place(start, end - start, grid)}
                      >
                        <span className="font-semibold text-fg">{block.doctorId === null ? "Clinic closed" : "Blocked"}</span> · {blockText(block)}
                      </li>
                    ))}
                  </ul>
                )}
                {items.length > 0 && <ul aria-label={`Appointments and free slots, ${formatClinicDateWithWeekday(day.date)}`}>{items.map((i) => i.node)}</ul>}
              </section>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function AppointmentBlock({
  item,
  grid,
  date,
  canMove,
  onMove,
}: {
  item: GridAppointment;
  grid: Grid;
  date: string;
  canMove: boolean;
  onMove: (moving: Moving) => void;
}) {
  const a: ScheduleAppointment = item.appointment;
  const status = displayVisitStatus(a.status);
  const [open, setOpen] = useState(false);
  const width = 100 / item.lanes;
  const pos = place(item.start, item.end - item.start, grid);
  const movable = canMove && a.actions.includes("reschedule");
  return (
    <li
      data-appointment={a.visitId}
      data-status={a.status}
      className="absolute z-10 px-0.5"
      style={{ ...pos, left: `${item.lane * width}%`, width: `${width}%` }}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${a.name}, ${formatClinicTime(a.time)} to ${formatClinicTime(a.endTime)}, ${status.label}${a.overbooked ? ", overbooked" : ""}`}
            data-appointment-block=""
            className={cn(
              "flex h-full w-full flex-col items-start overflow-hidden rounded-sm border-l-4 px-1.5 py-0.5 text-left text-caption focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
              STATUS_CHIP_TONE[status.tone],
              a.overbooked && "ring-1 ring-warning-fg ring-inset",
            )}
            style={{ borderLeftColor: `var(--color-status-${status.tone}-border, currentColor)` }}
          >
            <span className="font-semibold tabular-nums">{formatClinicTime(a.time)}</span>
            <span className="w-full truncate">{a.name}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80">
          <ul data-appointment-popover="">
            <AppointmentCard appointment={a} />
          </ul>
          {movable && (
            <Button
              type="button"
              variant="secondary"
              className="mt-2 w-full"
              startIcon={<CalendarClock aria-hidden="true" />}
              data-pick-new-time=""
              onClick={() => {
                setOpen(false);
                onMove({ visitId: a.visitId, doctorId: grid.doctorId, name: a.name, date, time: a.time });
              }}
            >
              Pick a new time on the grid
            </Button>
          )}
        </PopoverContent>
      </Popover>
    </li>
  );
}

