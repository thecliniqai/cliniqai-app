"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, X } from "lucide-react";
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
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="overbook-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in"
    >
      <div className="w-full max-w-md bg-[var(--surface-primary)] rounded-xl border border-[var(--border-default)] shadow-xl p-6 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--status-warning-bg)] border border-[var(--status-warning-border)] flex items-center justify-center text-[var(--status-warning-text)] shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 id="overbook-title" className="text-lg font-bold text-[var(--text-primary)]">
                Slot Already Booked
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                Double-booking conflict detected (D-06)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-md hover:bg-[var(--surface-subtle)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Message */}
        <div className="bg-[var(--surface-subtle)] border border-[var(--border-default)] rounded-lg p-3 text-sm text-[var(--text-secondary)]">
          <p>
            Another appointment is already scheduled at{" "}
            <span className="font-semibold text-[var(--text-primary)]">
              {scheduledTimeStr || "this time"}
            </span>
            {conflictingVisit?.reason_for_visit && (
              <span> ({conflictingVisit.reason_for_visit})</span>
            )}
            .
          </p>
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            Would you like to intentionally overbook this doctor&apos;s slot? Overbooked appointments will be flagged on the schedule.
          </p>
        </div>

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
            className="bg-amber-600 hover:bg-amber-700 text-white border-transparent"
          >
            Confirm Overbooking
          </Button>
        </div>
      </div>
    </div>
  );
}
