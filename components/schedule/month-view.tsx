"use client";

import Link from "next/link";
import { Ban } from "lucide-react";
import { scheduleHref, type ScheduleData } from "@/features/schedule/schema";
import { formatClinicDateWithWeekday, formatMonthYear } from "@/lib/datetime/format";
import { cn } from "@/lib/utils";
import { inPlace, useScheduleNavigate } from "./navigate";

/**
 * The month view (V2-09f 09F; `/schedule?view=month`, every width): the six Monday-first weeks that hold the month, one cell per day with its booked
 * count for the doctor filter ("All doctors" allowed), "Today" and a closed mark (a clinic-wide all-day block, or the filtered doctor's own). A tap on a
 * day opens that day (the day view from 768 px, the agenda below: the address leaves the view to the width). The counts come from the month's
 * `schedule_range` answer read WITHOUT slots (42 days, the range cap): free slots are the week and day views' business. Live like the other views.
 * A table: the weekday headers name each column for a screen reader, and each day is one link with its full date and count.
 */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function dayLabel(date: string, booked: number, closed: "clinic" | "doctor" | null, today: boolean): string {
  const parts = [`${booked} booked`];
  if (closed === "clinic") parts.push("clinic closed");
  if (closed === "doctor") parts.push("doctor blocked all day");
  return `${today ? "Today, " : ""}${formatClinicDateWithWeekday(date)}: ${parts.join(", ")}`;
}

export function MonthView({ data }: { data: ScheduleData }) {
  const navigate = useScheduleNavigate();
  const days = data.month ?? [];
  const weeks = Array.from({ length: Math.ceil(days.length / 7) }, (_, i) => days.slice(i * 7, i * 7 + 7));
  const title = formatMonthYear(data.date);
  return (
    <section aria-label={title} data-month-view="" className="flex flex-col gap-2">
      {/* The head already shows the month; the heading names the region for a screen reader. */}
      <h2 className="sr-only">{title}</h2>
      <table className="w-full table-fixed border-collapse overflow-hidden rounded-lg border border-border bg-surface">
        <caption className="sr-only">Appointments booked each day of {title}</caption>
        <thead>
          <tr>
            {WEEKDAYS.map((w) => (
              <th key={w} scope="col" className="border-b border-border py-1.5 text-caption font-semibold text-fg-muted">
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]!.date}>
              {week.map((day) => {
                const href = scheduleHref({ date: day.date, view: null, doctor: data.doctorFilter, today: data.today });
                const isToday = day.date === data.today;
                return (
                  <td key={day.date} className="h-16 border border-border p-0 align-top md:h-24">
                    <Link
                      href={href}
                      prefetch={false}
                      onClick={inPlace(navigate, href)}
                      data-month-day={day.date}
                      data-booked={day.booked}
                      aria-label={dayLabel(day.date, day.booked, day.closed, isToday)}
                      aria-current={isToday ? "date" : undefined}
                      className={cn(
                        "flex h-full min-h-11 flex-col items-start gap-0.5 p-1 hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus md:p-2",
                        !day.inMonth && "bg-surface-soft",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex size-6 items-center justify-center rounded-pill text-label tabular-nums",
                          isToday ? "bg-accent font-semibold text-fg-on-accent" : day.inMonth ? "text-fg" : "text-fg-muted",
                        )}
                      >
                        {Number(day.date.slice(8))}
                      </span>
                      {day.booked > 0 && (
                        <span className="rounded-pill bg-status-booked-bg px-1.5 text-caption font-semibold text-status-booked-fg tabular-nums">
                          {day.booked}
                          <span className="max-md:hidden"> booked</span>
                        </span>
                      )}
                      {day.closed && (
                        <span className="inline-flex items-center gap-1 text-caption text-fg-secondary">
                          <Ban aria-hidden="true" className="size-3" />
                          <span className="max-md:hidden">{day.closed === "clinic" ? "Closed" : "Blocked"}</span>
                        </span>
                      )}
                    </Link>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
