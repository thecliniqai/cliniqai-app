"use client";

import React, { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { finalizeVisitAmendment } from "@/features/consultation/actions";
import { useCommand } from "@/lib/commands/use-command";

export interface FinalizeAmendmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  visitId: string;
  /** The signed version being amended; finalizing signs `fromVersion + 1`. */
  fromVersion: number;
  /** Saves the form first, so the notes on screen are what gets signed. A failed save stops the finalize. */
  onBeforeFinalize?: () => Promise<{
    success: boolean;
    error?: string;
  } | void> | void;
  onSuccess?: () => void;
}

/**
 * Confirmation for `finalize_visit_amendment` (V2-09a R-16): the open amendment is signed as the next version, the prescription is re-issued
 * (event, PDF archived once and hashed) and the consultation is sealed again. One command through `useCommand`: a retry after a lost
 * response replays the first result. The form is saved first; nothing is finalized when the save fails.
 */
export function FinalizeAmendmentDialog({
  open,
  onOpenChange,
  ...rest
}: FinalizeAmendmentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <FinalizeBody onClose={() => onOpenChange(false)} {...rest} />}
    </Dialog>
  );
}

function FinalizeBody({
  onClose,
  visitId,
  fromVersion,
  onBeforeFinalize,
  onSuccess,
}: Omit<FinalizeAmendmentDialogProps, "open" | "onOpenChange"> & {
  onClose: () => void;
}) {
  const finalize = useCommand();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const submit = async () => {
    if (saving || finalize.pending) return;
    setSaveError(null);
    setSaving(true);
    try {
      const saved = await onBeforeFinalize?.();
      if (saved && !saved.success) {
        setSaveError(
          saved.error || "The changes could not be saved. Try again."
        );
        return;
      }
    } finally {
      setSaving(false);
    }
    const res = await finalize.run((clientRequestId) =>
      finalizeVisitAmendment(visitId, clientRequestId)
    );
    if (res.ok) {
      onSuccess?.();
      onClose();
    }
  };

  const error = saveError ?? finalize.error?.message ?? null;

  return (
    <DialogContent size="md" closeLabel="Close">
      <DialogHeader>
        <DialogTitle>Finalize amendment</DialogTitle>
        <DialogDescription>
          Your changes are signed as version {fromVersion + 1}. Version{" "}
          {fromVersion} stays on record as an audited revision, the amended
          prescription is issued again and a new PDF is stored. The consultation
          becomes read-only again.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        {error && (
          <Alert tone="danger">
            {error}
            {finalize.unresolved && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="ml-2"
                onClick={() => finalize.startOver()}
              >
                Start over
              </Button>
            )}
          </Alert>
        )}
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          variant="secondary"
          onClick={onClose}
          disabled={saving || finalize.pending}
        >
          Keep editing
        </Button>
        <Button
          type="button"
          variant="primary"
          loading={saving || finalize.pending}
          requiresNetwork
          onClick={() => void submit()}
        >
          Finalize amendment
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
