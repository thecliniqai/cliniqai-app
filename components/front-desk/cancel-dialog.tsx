"use client";

import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { notify } from "@/components/ui/toast";
import { SaveStatus } from "@/components/clinical/save-status";
import { cancelVisit } from "@/features/visits/scheduling";
import { CANCEL_REASON_CODES, type CancelReasonCode } from "@/features/visits/schema";
import { saveStatusProps } from "@/lib/commands/save-state";
import { useConfirmedCall } from "@/lib/query/mutations";
import { useAfterSave } from "@/lib/query/after-save";
import { withStatus } from "@/features/today/schema";
import { useRowChanged } from "@/lib/live/use-row-changed";

/**
 * CancelDialog (V2-08 08-04b, P1-31, R-15): cancels an appointment with `cancel_visit`, one command: the status, the reason
 * (a closed code and an optional note), the waitlist promotion into the vacated slot, the optional message to the patient and
 * the webhook event commit together. "Tell the patient" is on by default. A waitlisted patient booked into the slot is told in a
 * notice ("A waitlisted patient was booked into the vacated slot"). The safe action (Keep appointment) has the first focus.
 */
export const CANCEL_REASON_LABELS: Record<CancelReasonCode, string> = {
  patient_request: "Patient asked to cancel",
  doctor_unavailable: "Doctor is unavailable",
  clinic_closed: "Clinic is closed",
  duplicate: "Booked twice",
  other: "Other reason",
};

function CancelBody({ visitId, name, rowVersion, onDone, onClose }: { visitId: string; name: string; rowVersion: number; onDone: () => void; onClose: () => void }) {
  const { command, run } = useConfirmedCall();
  const afterSave = useAfterSave();
  const rowChanged = useRowChanged();
  const [reason, setReason] = useState<CancelReasonCode>("patient_request");
  const [note, setNote] = useState("");
  const [tell, setTell] = useState(true);
  const lastSend = useRef<(() => Promise<unknown>) | null>(null);

  const send = async () => {
    lastSend.current = send;
    const result = await run((clientRequestId) =>
      cancelVisit(
        { visit_id: visitId, reason_code: reason, reason_note: note.trim() || null, notify: tell, promote_waitlist: true, expected_version: rowVersion },
        clientRequestId,
      ),
    );
    if (!result.ok) {
      // The visit moved on elsewhere (09E-07, R-19): the screen behind re-reads, the fixed message stays in the dialog, nothing was cancelled.
      rowChanged(result.error);
      return;
    }
    // The answer is written into Today's board; a waitlist promotion adds a visit to a later slot, so a promoted slot also reads the board again.
    if (result.value.autoPromoted) afterSave.refreshScreens();
    else afterSave.patchToday((board) => withStatus(board, visitId, "cancelled", result.value.rowVersion));
    notify.success(
      result.value.autoPromoted
        ? `${name}'s appointment was cancelled. A waitlisted patient was booked into the vacated slot.`
        : `${name}'s appointment was cancelled.`,
    );
    onDone();
  };
  const edited = () => command.reset();
  const saveStatus = { ...saveStatusProps(command), onRetry: command.saveState === "error" ? () => void lastSend.current?.() : undefined };

  return (
    <>
      <AlertDialogTitle>Cancel this appointment?</AlertDialogTitle>
      <AlertDialogDescription>{name}&apos;s appointment will be cancelled and the slot freed.</AlertDialogDescription>
      <Field label="Reason">
        <NativeSelect
          value={reason}
          onChange={(event) => {
            setReason(event.target.value as CancelReasonCode);
            edited();
          }}
        >
          {CANCEL_REASON_CODES.map((code) => (
            <option key={code} value={code}>
              {CANCEL_REASON_LABELS[code]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Note" optional hint="Stays on the visit; the patient is never sent it.">
        <Input
          value={note}
          maxLength={500}
          onChange={(event) => {
            setNote(event.target.value);
            edited();
          }}
        />
      </Field>
      <Checkbox
        checked={tell}
        onCheckedChange={(next) => {
          setTell(next === true);
          edited();
        }}
        label="Tell the patient"
      />
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
      <AlertDialogFooter>
        <SaveStatus {...saveStatus} />
        <AlertDialogCancel onClick={onClose}>Keep appointment</AlertDialogCancel>
        <Button type="button" variant="danger" requiresNetwork loading={command.pending} onClick={() => void send()}>
          Cancel appointment
        </Button>
      </AlertDialogFooter>
    </>
  );
}

export interface CancelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  visitId: string;
  name: string;
  /** The visit's `row_version` the screen shows (09E-07, R-19). */
  rowVersion: number;
}

export function CancelDialog({ open, onOpenChange, visitId, name, rowVersion }: CancelDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-cancel-dialog="">
        {open && <CancelBody visitId={visitId} name={name} rowVersion={rowVersion} onDone={() => onOpenChange(false)} onClose={() => onOpenChange(false)} />}
      </AlertDialogContent>
    </AlertDialog>
  );
}
