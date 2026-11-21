"use client";

import Link from "next/link";
import { Check, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { StatusChip } from "@/components/clinical/status-chip";
import { RowMenu } from "@/components/front-desk/row-menu";
import { confirmAppointment } from "@/features/visits/scheduling";
import type { ScheduleAppointment } from "@/features/schedule/schema";
import { useCommand } from "@/lib/commands/use-command";
import { formatClinicTime } from "@/lib/datetime/format";

/**
 * One appointment on the Schedule (V2-08 08-04b): the time range, the patient (a link to the record), the doctor (agenda
 * only), the status chip, "Overbooked" and "Confirmed" flags, Confirm (one command, `confirm_appointment`) for a booked visit and the ⋯ menu
 * (Move, Mark as no-show, Cancel). There is no consult action here: a consultation starts from Today. Used by the day grid
 * and the agenda.
 */
export function AppointmentCard({ appointment: a, showDoctor = false }: { appointment: ScheduleAppointment; showDoctor?: boolean }) {
  const confirm = useCommand();
  const onConfirm = async () => {
    const result = await confirm.run((id) => confirmAppointment(a.visitId, id));
    if (!result.ok) notify.error(`Couldn't confirm ${a.name}. ${result.error.message}`, { retry: () => void onConfirm() });
  };
  return (
    <li
      data-appointment={a.visitId}
      data-status={a.status}
      className="flex flex-col gap-1.5 rounded-md border border-border bg-surface px-3 py-2.5"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-label font-medium text-fg-muted tabular-nums">
            {formatClinicTime(a.time)} – {formatClinicTime(a.endTime)}
          </p>
          <Link href={`/patients/${a.patientId}`} className="block truncate text-body-md font-medium text-fg underline-offset-2 hover:underline" data-patient-name="">
            {a.name}
          </Link>
          {showDoctor && <p className="truncate text-label text-fg-muted">{a.doctorName}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <StatusChip status={a.status} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {a.overbooked && (
          <span className="inline-flex h-pill items-center gap-1 rounded-pill bg-warning-bg px-1.75 text-caption font-semibold text-warning-fg">
            <TriangleAlert aria-hidden="true" className="size-3" strokeWidth={2} />
            Overbooked
          </span>
        )}
        {a.status === "booked" && a.confirmed && (
          <span className="inline-flex h-pill items-center gap-1 rounded-pill bg-success-bg px-1.75 text-caption font-semibold text-success-fg">
            <Check aria-hidden="true" className="size-3" strokeWidth={2} />
            Confirmed
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {a.canConfirm && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              requiresNetwork
              loading={confirm.pending}
              startIcon={<Check aria-hidden="true" />}
              onClick={() => void onConfirm()}
              aria-label={`Confirm ${a.name}`}
              data-row-action="confirm"
            >
              Confirm
            </Button>
          )}
          <RowMenu visitId={a.visitId} name={a.name} actions={a.actions} />
        </div>
      </div>
    </li>
  );
}
