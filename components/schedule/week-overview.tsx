import Link from "next/link";
import { buttonClassName } from "@/components/ui/button";
import { scheduleHref, type ScheduleData } from "@/features/schedule/schema";
import { formatClinicDateWithWeekday } from "@/lib/datetime/format";

/**
 * The week overview (V2-08 08-04b): one doctor, seven days from Monday, with the booked and free counts of each and a link to
 * the day. Free counts are the database's own slot list (`available_slots`). Days in the past show their bookings only.
 */
export function WeekOverview({ data }: { data: ScheduleData }) {
  if (!data.week) {
    return <p className="text-body-sm text-fg-muted">Pick a doctor to see their week.</p>;
  }
  const doctor = data.doctors.find((d) => d.id === data.week!.doctorId);
  return (
    <section aria-label={`Week of ${doctor?.name ?? "the doctor"}`} data-week-overview="" className="flex flex-col gap-2">
      <h2 className="font-display text-title-3 text-fg">{doctor?.name}</h2>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
        {data.week.days.map((day) => {
          const past = day.date < data.today;
          return (
            <li key={day.date} data-week-day={day.date} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <span className="min-w-32 text-body-md font-medium text-fg">
                {formatClinicDateWithWeekday(day.date)}
                {day.date === data.today && <span className="ml-2 text-caption font-semibold text-accent">Today</span>}
              </span>
              <span className="text-body-sm text-fg-secondary tabular-nums">
                {day.booked} booked{past ? "" : ` · ${day.free} free`}
              </span>
              <Link
                href={scheduleHref({ date: day.date, view: "day", doctor: data.week!.doctorId, today: data.today })}
                className={buttonClassName({ size: "sm", variant: "secondary" })}
                aria-label={`Open ${formatClinicDateWithWeekday(day.date)}`}
              >
                Open day
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
