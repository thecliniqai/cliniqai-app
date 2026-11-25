"use client";

import { useRef } from "react";
import { Alert } from "@/components/ui/alert";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { SaveStatus } from "@/components/clinical/save-status";
import { markNoShow } from "@/features/visits/scheduling";
import { saveStatusProps } from "@/lib/commands/save-state";
import { useCommand } from "@/lib/commands/use-command";
import { useRowChanged } from "@/lib/live/use-row-changed";

/**
 * NoShowDialog (V2-08 08-04b, R-15): marks an appointment whose time has passed as a no-show with `mark_no_show` (one
 * command). A no-show who arrives later is checked in from Today (R-8) or moved to a new time (Move appointment).
 */
function NoShowBody({ visitId, name, rowVersion, onDone }: { visitId: string; name: string; rowVersion: number; onDone: () => void }) {
  const command = useCommand();
  const rowChanged = useRowChanged();
  const lastSend = useRef<(() => Promise<unknown>) | null>(null);
  const send = async () => {
    lastSend.current = send;
    const result = await command.run((clientRequestId) => markNoShow(visitId, clientRequestId, rowVersion));
    if (!result.ok) {
      // The visit moved on elsewhere (09E-07, R-19): the screen behind re-reads, the fixed message stays in the dialog, nothing was written.
      rowChanged(result.error);
      return;
    }
    notify.success(`${name} marked as a no-show.`);
    onDone();
  };
  const saveStatus = { ...saveStatusProps(command), onRetry: command.saveState === "error" ? () => void lastSend.current?.() : undefined };
  return (
    <>
      <AlertDialogTitle>Mark as no-show?</AlertDialogTitle>
      <AlertDialogDescription>
        {name} did not arrive for this appointment. If they come later you can still check them in or move the appointment.
      </AlertDialogDescription>
      {command.error && <Alert tone="danger">{command.error.message}</Alert>}
      <AlertDialogFooter>
        <SaveStatus {...saveStatus} />
        <AlertDialogCancel onClick={onDone}>Keep appointment</AlertDialogCancel>
        <Button type="button" variant="danger" requiresNetwork loading={command.pending} onClick={() => void send()}>
          Mark as no-show
        </Button>
      </AlertDialogFooter>
    </>
  );
}

export interface NoShowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  visitId: string;
  name: string;
  /** The visit's `row_version` the screen shows (09E-07, R-19). */
  rowVersion: number;
}

export function NoShowDialog({ open, onOpenChange, visitId, name, rowVersion }: NoShowDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-no-show-dialog="">
        {open && <NoShowBody visitId={visitId} name={name} rowVersion={rowVersion} onDone={() => onOpenChange(false)} />}
      </AlertDialogContent>
    </AlertDialog>
  );
}
