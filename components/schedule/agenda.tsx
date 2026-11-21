"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { buttonClassName } from "@/components/ui/button";
import { sortAgenda, type ScheduleData } from "@/features/schedule/schema";
import { AppointmentCard } from "./appointment-card";
import { BlockLine } from "./day-grid";

/**
 * The agenda (V2-08 08-04b; the phone default): the day's appointments of the shown doctors in time order, one card each
 * with the doctor's name, the clinic's blocks above them. Empty days say so and offer "Book appointment".
 */
export function Agenda({ data }: { data: ScheduleData }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const appointments = sortAgenda(data.appointments);
  const book = new URLSearchParams(params.toString());
  book.set("book", "1");
  return (
    <div data-agenda="" className="flex flex-col gap-2">
      {data.blocks.length > 0 && (
        <ul aria-label="Blocked time" className="flex flex-col gap-2">
          {data.blocks.map((block) => (
            <BlockLine key={block.id} block={block} />
          ))}
        </ul>
      )}
      {appointments.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center">
          <p className="text-body-md font-semibold text-fg">No appointments on this day</p>
          {data.canEdit && (
            <Link href={`${pathname}?${book.toString()}`} className={buttonClassName({ variant: "secondary", className: "mt-3" })}>
              Book the first one
            </Link>
          )}
        </div>
      ) : (
        <ul aria-label="Appointments" className="flex flex-col gap-2">
          {appointments.map((a) => (
            <AppointmentCard key={a.visitId} appointment={a} showDoctor />
          ))}
        </ul>
      )}
    </div>
  );
}
