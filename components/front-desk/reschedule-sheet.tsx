"use client";

import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
} from "@/components/ui/responsive-sheet";
import { notify } from "@/components/ui/toast";
import { SaveStatus } from "@/components/clinical/save-status";
import { getRescheduleTarget, rescheduleVisit, type RescheduleTarget } from "@/features/visits/scheduling";
import { isSlotConflictReason } from "@/features/visits/slot-conflicts";
import { saveStatusProps } from "@/lib/commands/save-state";
import { useCommand } from "@/lib/commands/use-command";
import { useClinicTimeZone, useClinicToday } from "@/lib/datetime/client";
import { formatClinicDateWithWeekday, formatClinicTime } from "@/lib/datetime/format";
import { slotInstant } from "./slot-adapter";
import { SlotConflictDialog } from "./slot-conflict-dialog";
import { SlotSection, type SlotPlan } from "./slot-section";
import { useClinicDoctors } from "./use-doctors";

/**
 * RescheduleSheet (V2-08 08-04b, P1-31, R-13, R-15; `?reschedule=<visitId>`, from the row menu of Today and Schedule): moves a
 * booked, confirmed or missed appointment with `reschedule_visit`, through `useCommand` (SaveStatus with Retry). The same
 * slot choice as booking (`SlotSection`), in "move" mode: the visit's own slot is listed again, nothing is preselected, the
 * doctor may change. "Tell the patient" (on by default) queues the patient's message in the same transaction. A slot that is
 * taken, off duty or blocked writes nothing and opens `SlotConflictDialog`; confirming sends the move flagged overbooked.
 */
const MOVABLE = ["booked", "confirmed", "no_show"];

function RescheduleBody({ visitId, onDone }: { visitId: string; onDone: () => void }) {
  const command = useCommand();
  const timeZone = useClinicTimeZone();
  const today = useClinicToday();
  const doctors = useClinicDoctors();
  const [target, setTarget] = useState<RescheduleTarget | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [plan, setPlan] = useState<SlotPlan | null>(null);
  const [notifyPatient, setNotifyPatient] = useState(true);
  const [conflict, setConflict] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getRescheduleTarget(visitId)
      .then((result) => {
        if (!live) return;
        if (!result.ok) return setFailed(result.error.message);
        setTarget(result.value);
        setPlan({ doctorId: result.value.doctorId, date: result.value.date < today ? today : result.value.date, time: null, minutes: null });
      })
      .catch(() => live && setFailed("Couldn't load the appointment."));
    return () => {
      live = false;
    };
  }, [visitId, today]);

  const lastSend = useRef<(() => Promise<unknown>) | null>(null);
  const saveStatus = {
    ...saveStatusProps(command),
    onRetry: command.saveState === "error" ? () => void lastSend.current?.() : undefined,
  };

  const send = async (flags: { overbook: boolean; offDuty: boolean; block: boolean } = { overbook: false, offDuty: false, block: false }) => {
    if (!target || !plan?.time) return;
    lastSend.current = () => send(flags);
    const time = plan.time;
    const result = await command.run((clientRequestId) =>
      rescheduleVisit(
        {
          visit_id: target.visitId,
          new_scheduled_at: slotInstant(plan.date, time, timeZone),
          doctor_id: plan.doctorId,
          estimated_duration_minutes: plan.minutes,
          is_overbooked: flags.overbook,
          override_off_duty: flags.offDuty,
          override_block: flags.block,
          notify: notifyPatient,
        },
        clientRequestId,
      ),
    );
    if (result.ok) {
      notify.success(`${target.patientName} moved to ${formatClinicDateWithWeekday(plan.date)}, ${formatClinicTime(time)}`);
      onDone();
      return;
    }
    if (isSlotConflictReason(result.error.reason)) {
      command.reset();
      setConflict(result.error.reason ?? "SLOT_TAKEN");
    }
  };

  if (failed) return <Alert tone="danger">{failed}</Alert>;
  if (!target || !plan || doctors === null) return <p className="text-body-sm text-fg-muted">Loading appointment…</p>;
  if (!MOVABLE.includes(target.status)) {
    return <Alert tone="warning">Only a booked, confirmed or missed appointment can be moved.</Alert>;
  }
  const changePlan = (next: SlotPlan) => {
    setPlan(next);
    command.reset();
  };

  return (
    <div className="flex flex-col gap-4" data-reschedule-sheet="">
      <div className="rounded-md border border-border bg-surface-soft px-3 py-2.5" data-reschedule-patient="">
        <p className="text-body-md font-semibold text-fg">{target.patientName}</p>
        <p className="text-body-sm text-fg-muted">
          Now {formatClinicDateWithWeekday(target.date)}, {formatClinicTime(target.time)}
        </p>
      </div>
      <SlotSection doctors={doctors} plan={plan} onPlanChange={changePlan} excludeVisitId={target.visitId} />
      <Checkbox checked={notifyPatient} onCheckedChange={(next) => setNotifyPatient(next === true)} label="Tell the patient" />
      {command.error && (
        <Alert tone="danger">
          {command.error.message}
          {command.unresolved && (
            <Button type="button" size="sm" variant="secondary" className="ml-2" onClick={() => command.startOver()}>
              Start over
            </Button>
          )}
        </Alert>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <SaveStatus {...saveStatus} />
        <Button type="button" requiresNetwork disabled={plan.time === null} loading={command.pending} onClick={() => void send()}>
          Move appointment
        </Button>
      </div>
      <SlotConflictDialog reason={conflict} date={plan.date} time={plan.time} verb="Move" onConfirm={() => {
        const reason = conflict;
        setConflict(null);
        void send({ overbook: true, offDuty: reason === "SLOT_OFF_DUTY", block: reason === "SLOT_BLOCKED" });
      }} onCancel={() => setConflict(null)} />
    </div>
  );
}

export interface RescheduleSheetProps {
  /** The visit to move; null closes the sheet. */
  visitId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function RescheduleSheet({ visitId, onOpenChange }: RescheduleSheetProps) {
  return (
    <ResponsiveSheet open={visitId !== null} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent data-reschedule-sheet-root="" aria-describedby={undefined}>
        <ResponsiveSheetHeader title="Move appointment" />
        <ResponsiveSheetBody>{visitId && <RescheduleBody key={visitId} visitId={visitId} onDone={() => onOpenChange(false)} />}</ResponsiveSheetBody>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
