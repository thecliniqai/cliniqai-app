"use client";

import React, { useState, useEffect } from "react";
import { AlertTriangle, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reopenVisitForAmendment } from "@/features/consultation/actions";

export interface AmendmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  visitId: string;
  completedDate?: string;
  currentVersion?: number;
  onSuccess?: () => void;
}

export function AmendmentModal({
  isOpen,
  onClose,
  visitId,
  completedDate = "recently",
  currentVersion = 1,
  onSuccess,
}: AmendmentModalProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form state on open
  useEffect(() => {
    if (isOpen) {
      setReason("");
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  // Keyboard navigation: Escape key closes modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose, submitting]);

  if (!isOpen) return null;

  const isReasonValid = reason.trim().length >= 10;
  const nextVersion = currentVersion + 1;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isReasonValid || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await reopenVisitForAmendment(visitId, reason);
      if (res.success) {
        onSuccess?.();
        onClose();
      } else {
        setError(res.error || "Failed to reopen consultation for amendment.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="amendment-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
    >
      {/* Accessible Backdrop */}
      <div
        className="fixed inset-0 bg-gray-900/60 backdrop-blur-xs transition-opacity"
        onClick={() => !submitting && onClose()}
        aria-hidden="true"
      />

      {/* Dialog Card */}
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-gray-200 z-10 overflow-hidden transform transition-all">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-start gap-3 bg-amber-50/50">
          <div className="p-2 rounded-xl bg-amber-100 text-amber-600 shrink-0 mt-0.5">
            <AlertTriangle className="w-5 h-5" />
          </div>

          <div className="flex-1">
            <h2 id="amendment-dialog-title" className="text-base font-semibold text-gray-900">
              Reopen Visit for Clinical Amendment
            </h2>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              This visit was completed and signed on {completedDate}. Editing will create an audited
              revision snapshot (v{nextVersion}) and stamp the revised prescription as amended.
            </p>
          </div>

          <button
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer disabled:opacity-50"
            aria-label="Close amendment dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label
              htmlFor="amendment-reason"
              className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5"
            >
              Reason for Amendment (Required for Medical Records Audit)
            </label>
            <textarea
              id="amendment-reason"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Added antibiotic following patient's callback regarding persistent high fever"
              disabled={submitting}
              className={`w-full p-3 text-sm rounded-xl border transition-colors outline-none resize-none focus:ring-2 focus:ring-[#1769E0]/20 ${
                reason.length > 0 && !isReasonValid
                  ? "border-amber-400 focus:border-amber-500"
                  : "border-gray-300 focus:border-[#1769E0]"
              }`}
            />
            <div className="flex items-center justify-between mt-1.5 text-xs">
              <span
                className={
                  reason.length > 0 && !isReasonValid
                    ? "text-amber-600 font-medium"
                    : "text-gray-500"
                }
              >
                Minimum 10 characters required ({reason.trim().length}/10)
              </span>
              <span className="text-gray-400">Permanently stamped on ℞ PDF</span>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
              {error}
            </div>
          )}

          {/* Action Footer adhering strictly to UI-SPEC Copywriting Contract */}
          <div className="pt-2 flex items-center justify-end gap-3 border-t border-gray-100">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={submitting}
              className="min-h-[44px]"
            >
              Cancel Amendment
            </Button>

            <Button
              type="submit"
              variant="primary"
              disabled={!isReasonValid || submitting}
              startIcon={
                submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <AlertTriangle className="w-4 h-4" />
                )
              }
              className="min-h-[44px] bg-amber-600 hover:bg-amber-700 focus-visible:ring-amber-500"
            >
              {submitting ? "Reopening..." : "Confirm & Reopen for Amendment"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
