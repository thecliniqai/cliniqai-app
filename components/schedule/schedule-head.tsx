"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Ban, ChevronLeft, ChevronRight, Clock, UserPlus } from "lucide-react";
import { Button, buttonClassName } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/chip-group";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { scheduleHref, type ScheduleData, type ScheduleView } from "@/features/schedule/schema";
import { addDaysYmd } from "@/lib/datetime";
import { formatClinicDateWithWeekday } from "@/lib/datetime/format";

/**
 * The head of the Schedule (V2-08 08-04b; IA §3.4): the date with previous, next and Today (a week at a time in the week
 * view) and a "Go to date" field, the view switch (Day, Agenda, Week), the doctor filter (chips; one doctor is always chosen
 * in the week view), and the actions Book appointment (`?book=1`, a link, R-13), Waitlist and Block time. Every address
 * (`?date&view&doctor`) is a shareable link.
 */
export interface ScheduleHeadProps {
  data: ScheduleData;
  view: ScheduleView;
  onOpenWaitlist: () => void;
  onOpenBlock: () => void;
}

const VIEW_OPTIONS = [
  { value: "day", label: "Day" },
  { value: "agenda", label: "Agenda" },
  { value: "week", label: "Week" },
] as const;

export function ScheduleHead({ data, view, onOpenWaitlist, onOpenBlock }: ScheduleHeadProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const step = view === "week" ? 7 : 1;
  const href = (over: { date?: string; view?: ScheduleView | null; doctor?: string | null }) =>
    scheduleHref({
      date: over.date ?? data.date,
      // The view stays what the URL said (absent = by width).
      view: over.view !== undefined ? over.view : ((params.get("view") as ScheduleView | null) ?? null),
      doctor: over.doctor !== undefined ? over.doctor : data.doctorFilter,
      today: data.today,
    });
  const bookParams = new URLSearchParams(params.toString());
  bookParams.set("book", "1");
  const doctorItems = [
    ...(view === "week" ? [] : [{ value: "all", label: "All doctors" }]),
    ...data.doctors.map((d) => ({ value: d.id, label: d.name })),
  ];
  const doctorValue = view === "week" ? (data.week?.doctorId ?? data.doctors[0]?.id ?? "") : data.doctorFilter;

  return (
    <header className="flex flex-col gap-3" data-schedule-head="">
      <h1 className="sr-only">Schedule</h1>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <Link href={href({ date: addDaysYmd(data.date, -step) })} className={buttonClassName({ variant: "secondary" })} aria-label={view === "week" ? "Previous week" : "Previous day"}>
            <ChevronLeft aria-hidden="true" className="size-4" />
          </Link>
          <Link href={href({ date: data.today })} className={buttonClassName({ variant: "secondary" })}>
            Today
          </Link>
          <Link href={href({ date: addDaysYmd(data.date, step) })} className={buttonClassName({ variant: "secondary" })} aria-label={view === "week" ? "Next week" : "Next day"}>
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
        <p className="text-body-md font-semibold text-fg" data-schedule-date="">
          {formatClinicDateWithWeekday(data.date)}
        </p>
        <div className="w-40">
          <Input
            type="date"
            aria-label="Go to date"
            value={data.date}
            onChange={(event) => event.target.value && router.push(href({ date: event.target.value }))}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 max-md:w-full md:ml-auto">
          {data.canEdit && (
            <Link href={`${pathname}?${bookParams.toString()}`} className={buttonClassName({ variant: "primary" })} data-schedule-action="book">
              <UserPlus aria-hidden="true" className="size-4" />
              Book appointment
            </Link>
          )}
          <Button type="button" variant="secondary" startIcon={<Clock aria-hidden="true" />} onClick={onOpenWaitlist}>
            Waitlist ({data.waitlist.length})
          </Button>
          {data.block.allowed && (
            <Button type="button" variant="secondary" startIcon={<Ban aria-hidden="true" />} onClick={onOpenBlock}>
              Block time
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          aria-label="View"
          value={view}
          onValueChange={(next) => router.push(href({ view: next as ScheduleView }))}
          options={VIEW_OPTIONS}
        />
        {data.doctors.length > 1 && (
          <ChipGroup
            type="single"
            aria-label="Doctor"
            value={doctorValue}
            onValueChange={(next) => router.push(href({ doctor: next }))}
            items={doctorItems}
          />
        )}
      </div>
    </header>
  );
}
