"use client";

import React from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { Visit } from "@/lib/db/types";

export interface OverbookDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  conflictingVisit?: Visit | null;
  scheduledTimeStr?: string;
  loading?: boolean;
}

export function OverbookDialog({
  isOpen,
  onClose,
  onConfirm,
  conflictingVisit,
  scheduledTimeStr,
  loading = false,
}: OverbookDialogProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Slot Already Booked"
      description="Double-booking conflict detected (D-06)"
      maxWidth="md"
    >
      <div className="space-y-4">
        {/* Warning Callout */}
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center text-amber-700 shrink-0 mt-0.5">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="text-sm text-amber-900 leading-relaxed">
            <p className="font-semibold text-amber-950">
              Another appointment is already scheduled
            </p>
            <p className="mt-1 text-xs text-amber-800">
              A booking exists at{" "}
              <span className="font-semibold text-amber-950">
                {scheduledTimeStr || "this time"}
              </span>
              {conflictingVisit?.reason_for_visit && (
                <span> ({conflictingVisit.reason_for_visit})</span>
              )}
              .
            </p>
          </div>
        </div>

        <p className="text-xs text-gray-600 leading-relaxed">
          Would you like to intentionally overbook this doctor&apos;s slot? Overbooked appointments will be flagged on the schedule and marked for special triage.
        </p>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={onConfirm}
            loading={loading}
            className="bg-amber-600 hover:bg-amber-700 text-white border-transparent focus:ring-amber-500"
          >
            Confirm Overbooking
          </Button>
        </div>
      </div>
    </Modal>
  );
}

