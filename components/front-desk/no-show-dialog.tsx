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

/**
 * NoShowDialog (V2-08 08-04b, R-15): marks an appointment whose time has passed as a no-show with `mark_no_show` (one
 * command). A no-show who arrives later is checked in from Today (R-8) or moved to a new time (Move appointment).
 */
function NoShowBody({ visitId, name, onDone }: { visitId: string; name: string; onDone: () => void }) {
  const command = useCommand();
  const lastSend = useRef<(() => Promise<unknown>) | null>(null);
  const send = async () => {
    lastSend.current = send;
    const result = await command.run((clientRequestId) => markNoShow(visitId, clientRequestId));
    if (!result.ok) return;
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
}

export function NoShowDialog({ open, onOpenChange, visitId, name }: NoShowDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-no-show-dialog="">
        {open && <NoShowBody visitId={visitId} name={name} onDone={() => onOpenChange(false)} />}
      </AlertDialogContent>
    </AlertDialog>
  );
}
