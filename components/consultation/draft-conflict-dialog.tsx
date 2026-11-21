"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { DraftFieldKey } from "@/features/consultation/draft";

/** The names the doctor sees for the draft fields in the conflict prompt. */
export const DRAFT_FIELD_LABELS: Readonly<Record<DraftFieldKey, string>> = {
  vitals: "Vitals",
  chief_complaints: "Complaints",
  clinical_notes: "Notes",
  specialty_data: "Examination",
  investigations_advised: "Investigations",
  advice: "Advice",
  specialty: "Specialty",
  follow_up: "Follow-up",
};

/**
 * "This consultation was changed in another tab or device" (V2-09b R-5): the same field was changed here and there. Nothing is overwritten
 * silently. "Use the other version" is the safe action (initial focus): the other copy replaces these fields here. "Keep mine" saves this screen's
 * values over the other change, and the audit row says so (`conflict_overwrite`). The prompt has no outside dismissal: one of the two choices is needed.
 */
export function DraftConflictDialog({
  fields,
  onUseTheirs,
  onKeepMine,
}: {
  fields: readonly DraftFieldKey[] | null;
  onUseTheirs: () => void;
  onKeepMine: () => void;
}) {
  return (
    <AlertDialog open={fields !== null && fields.length > 0}>
      <AlertDialogContent onEscapeKeyDown={(event) => event.preventDefault()}>
        <AlertDialogTitle>This consultation was changed in another tab or device</AlertDialogTitle>
        <AlertDialogDescription>
          The same part was edited in both places: {(fields ?? []).map((key) => DRAFT_FIELD_LABELS[key]).join(", ")}. Choose which version to keep. Other parts
          were merged already.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onUseTheirs}>Use the other version</AlertDialogCancel>
          <AlertDialogAction onClick={onKeepMine}>Keep mine</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
