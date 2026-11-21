"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Ban } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";
import { columnEntries, type ColumnEntry, type ScheduleBlockView, type ScheduleData } from "@/features/schedule/schema";
import { formatClinicTime } from "@/lib/datetime/format";
import { AppointmentCard } from "./appointment-card";

/**
 * The day view (V2-08 08-04b, 768 px and up; replaces the v1 `doctor-timeline`): one column per doctor, each a chronological
 * list of the doctor's appointments, blocks (their own and the clinic's) and runs of free slots. A free slot is a link that
 * opens the booking sheet with the doctor, the day and the time filled in (`?book=1&doctor=&date=&time=`, R-13), so a slot click
 * is one action; the slots are the database's own list (`available_slots`), so what the grid offers the booking accepts.
 */
export function blockText(block: Pick<ScheduleBlockView, "allDay" | "time" | "endTime" | "reason">): string {
  const when = block.allDay ? "All day" : `${formatClinicTime(block.time)} – ${formatClinicTime(block.endTime)}`;
  return block.reason ? `${when} · ${block.reason}` : when;
}

export function BlockLine({ block }: { block: ScheduleBlockView }) {
  return (
    <li data-schedule-block={block.id} className="flex items-start gap-2 rounded-md border border-dashed border-border-strong bg-surface-muted px-3 py-2 text-label text-fg-secondary">
      <Ban aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-fg-icon" />
      <span>
        <span className="font-semibold text-fg">{block.doctorId === null ? "Clinic closed" : "Blocked"}</span> · {blockText(block)}
      </span>
    </li>
  );
}

function bookHref(pathname: string, params: { toString(): string }, doctorId: string, date: string, time: string): string {
  const next = new URLSearchParams(params.toString());
  next.set("book", "1");
  next.set("doctor", doctorId);
  next.set("date", date);
  next.set("time", time);
  return `${pathname}?${next.toString()}`;
}

function Entry({ entry, doctorId, data }: { entry: ColumnEntry; doctorId: string; data: ScheduleData }) {
  const pathname = usePathname();
  const params = useSearchParams();
  if (entry.kind === "appointment") return <AppointmentCard appointment={entry.appointment} />;
  if (entry.kind === "block") return <BlockLine block={entry.block} />;
  return (
    <li data-free-run="" className="flex flex-col gap-1.5">
      <p className="text-caption font-semibold tracking-caps text-fg-muted uppercase">Free</p>
      <div className="flex flex-wrap gap-1.5">
        {entry.slots.map((slot) => (
          <Link
            key={slot.time}
            href={bookHref(pathname, params, doctorId, data.date, slot.time)}
            className={buttonClassName({ size: "sm", variant: "secondary" })}
            aria-label={`Book ${formatClinicTime(slot.time)}`}
            data-free-slot={slot.time}
            prefetch={false}
          >
            {formatClinicTime(slot.time)}
          </Link>
        ))}
      </div>
    </li>
  );
}

export function DayGrid({ data }: { data: ScheduleData }) {
  const shown = data.doctorFilter === "all" ? data.doctors : data.doctors.filter((d) => d.id === data.doctorFilter);
  if (shown.length === 0) return <p className="text-body-sm text-fg-muted">No doctor to show. Add a doctor in Staff &amp; Team.</p>;
  return (
    <div data-day-grid="" className="overflow-x-auto overscroll-x-contain">
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(15rem, 1fr))` }}>
        {shown.map((doctor) => {
          const entries = columnEntries(doctor.id, data);
          const count = data.appointments.filter((a) => a.doctorId === doctor.id).length;
          return (
            <section key={doctor.id} aria-label={doctor.name} data-doctor-column={doctor.id} className="flex min-w-0 flex-col gap-2">
              <header className="rounded-md border border-border bg-surface-soft px-3 py-2">
                <h2 className="truncate font-display text-title-3 text-fg">{doctor.name}</h2>
                <p className="text-label text-fg-muted">
                  {doctor.specialty ? `${doctor.specialty.replace(/_/g, " ")} · ` : ""}
                  {count} {count === 1 ? "appointment" : "appointments"}
                </p>
              </header>
              {entries.length === 0 ? (
                <p className="px-1 text-body-sm text-fg-muted">Nothing booked, and no free slot on this day.</p>
              ) : (
                <ul className="flex flex-col gap-2" aria-label={`${doctor.name} on this day`}>
                  {entries.map((entry, i) => (
                    <Entry key={`${entry.kind}-${entry.time}-${i}`} entry={entry} doctorId={doctor.id} data={data} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
