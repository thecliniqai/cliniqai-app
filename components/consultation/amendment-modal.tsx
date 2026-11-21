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
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { reopenVisitForAmendment } from "@/features/consultation/actions";
import { useCommand } from "@/lib/commands/use-command";

export interface AmendmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  visitId: string;
  /** When the signed version was signed, in the clinic's zone; shown in the explanation. */
  completedDate?: string;
  /** The signed version being amended; the amendment becomes `currentVersion + 1`. */
  currentVersion?: number;
  onSuccess?: () => void;
}

/** The amendment reason is 10 to 500 characters (the audit row holds it, whose values are bounded at 500; V2-07 07-04a F-11). */
export const AMENDMENT_REASON_MIN = 10;
export const AMENDMENT_REASON_MAX = 500;

/**
 * Reopen a signed consultation for amendment (V2-09a R-16; moved onto the V2-06 `Dialog`, closing the 06-08 backlog row). The reason
 * is mandatory (10 to 500 characters) and is stamped on the amended prescription; the database snapshots the signed version when the
 * command runs. The form exists only while the dialog is open: closing unmounts it, so opening it again starts with an empty
 * reason, no error and a fresh command runner (a new `client_request_id`). Focus is trapped, Escape and the Close button close it,
 * and focus returns to the Amend button (Radix, `Dialog`).
 */
export function AmendmentModal({
  isOpen,
  onClose,
  ...rest
}: AmendmentModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      {isOpen && <AmendmentForm onClose={onClose} {...rest} />}
    </Dialog>
  );
}

function AmendmentForm({
  onClose,
  visitId,
  completedDate = "recently",
  currentVersion = 1,
  onSuccess,
}: Omit<AmendmentModalProps, "isOpen">) {
  const [reason, setReason] = useState("");
  // One client_request_id per amendment submit: a retry after an error re-sends it (the server replays or runs fresh).
  const reopen = useCommand();

  // 09A-06a (review B-4): while the reopen is in flight the dialog cannot be dismissed (Escape, an outside click and the Close button are held).
  const holdWhilePending = (event: Event) => {
    if (reopen.pending) event.preventDefault();
  };

  const trimmed = reason.trim();
  const isReasonValid =
    trimmed.length >= AMENDMENT_REASON_MIN &&
    trimmed.length <= AMENDMENT_REASON_MAX;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isReasonValid || reopen.pending) return;
    const res = await reopen.run((clientRequestId) =>
      reopenVisitForAmendment(visitId, trimmed, clientRequestId)
    );
    if (res.ok) {
      onSuccess?.();
      onClose();
    }
  };

  return (
    // `dirty`: a typed reason is not thrown away by a stray outside click or Escape without asking first.
    <DialogContent
      size="lg"
      dirty={reason.length > 0}
      closeLabel="Close amendment dialog"
      showClose={!reopen.pending}
      onEscapeKeyDown={holdWhilePending}
      onInteractOutside={holdWhilePending}
      data-amendment-dialog=""
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Reopen Visit for Clinical Amendment</DialogTitle>
          <DialogDescription>
            This visit was completed and signed on {completedDate}. Editing
            keeps the signed version (v{currentVersion}) as an audited revision
            and stamps the amended prescription as v{currentVersion + 1}.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field
            label="Reason for Amendment (Required for Medical Records Audit)"
            required
            hint={`Minimum ${AMENDMENT_REASON_MIN} characters required (${trimmed.length}/${AMENDMENT_REASON_MIN}). Permanently stamped on the ℞ PDF.`}
          >
            <Textarea
              value={reason}
              maxLength={AMENDMENT_REASON_MAX}
              rows={4}
              placeholder="e.g. Added antibiotic following patient's callback regarding persistent high fever"
              onChange={(event) => {
                setReason(event.target.value);
                // Edited after a failed attempt: the next submit is a new request.
                if (reopen.error) reopen.reset();
              }}
            />
          </Field>
          {reopen.error && (
            <Alert tone="danger">
              {reopen.error.message ||
                "Failed to reopen consultation for amendment."}
              {reopen.unresolved && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="ml-2"
                  onClick={() => reopen.startOver()}
                >
                  Start over
                </Button>
              )}
            </Alert>
          )}
        </DialogBody>
        {/* Footer adhering to the UI-SPEC copywriting contract. */}
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={reopen.pending}
          >
            Cancel Amendment
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!isReasonValid}
            loading={reopen.pending}
          >
            Confirm &amp; Reopen for Amendment
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
