"use client";

import { AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { overbookCauseText } from "@/features/visits/slot-conflicts";
import { formatClinicDateWithWeekday, formatClinicTime } from "@/lib/datetime/format";

/**
 * SlotConflictDialog (V2-08 08-04b, G-4, R-15): the slot the staff member chose is not free (`SLOT_TAKEN`, `SLOT_OFF_DUTY`
 * or `SLOT_BLOCKED`, the reasons the booking and reschedule commands raise). The dialog says which and asks whether to book it
 * anyway; confirming re-sends the command with the overbook flag (and the matching override), so the visit is flagged on the
 * schedule. Nothing was written when the dialog opens. Replaces the v1 overbook and soft-block dialogs.
 */
export interface SlotConflictDialogProps {
  /** The command's refusal reason; null closes the dialog. */
  reason: string | null;
  date: string;
  /** Clinic wall-clock `HH:mm`. */
  time: string | null;
  /** "Move" or "Book": the verb of the confirm button. */
  verb: "Book" | "Move";
  onConfirm: () => void;
  onCancel: () => void;
}

export function SlotConflictDialog({ reason, date, time, verb, onConfirm, onCancel }: SlotConflictDialogProps) {
  const text = overbookCauseText(reason ?? undefined);
  const when = time ? `${formatClinicTime(time)}, ${formatClinicDateWithWeekday(date)}` : "this time";
  return (
    <AlertDialog open={reason !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent data-slot-conflict={reason ?? ""}>
        <AlertDialogTitle>{text.title}</AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="flex flex-col gap-2">
            <p className="flex items-start gap-2 font-semibold text-fg">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-fg" />
              {text.headline}
            </p>
            <p>{text.detail(when)}.</p>
            <p>{text.question}</p>
          </div>
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Choose another time</AlertDialogCancel>
          <AlertDialogAction variant="danger" onClick={onConfirm}>
            {reason === "SLOT_TAKEN" || reason === null ? "Confirm overbooking" : `${verb} anyway`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
