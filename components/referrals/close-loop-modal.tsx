"use client";

import React, { useState } from "react";
import { X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { closeReferralLoop } from "@/features/referrals/actions";
import { ReferralItem } from "@/features/referrals/types";

export interface CloseLoopModalProps {
  referral: ReferralItem;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CloseLoopModal({
  referral,
  isOpen,
  onClose,
  onSuccess,
}: CloseLoopModalProps) {
  const [returnDate, setReturnDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [closureNotes, setClosureNotes] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!closureNotes.trim()) {
      setError("Please document clinical findings or specialist follow-up notes.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await closeReferralLoop({
        referral_id: referral.id,
        closure_notes: closureNotes.trim(),
        return_date: returnDate || null,
      });

      if (!res.success) {
        setError(res.error || "Failed to close referral loop.");
        setIsSubmitting(false);
        return;
      }

      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="close-loop-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 overflow-y-auto"
    >
      <div className="bg-white rounded-2xl shadow-theme-lg border border-gray-200 max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-[#F8FAFC]">
          <div>
            <h2
              id="close-loop-title"
              className="text-base font-bold text-gray-900"
            >
              Close Referral Loop
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Patient:{" "}
              <span className="font-semibold text-gray-800">
                {referral.patient?.full_name || "Patient"}
              </span>{" "}
              • Ref: {referral.id.slice(0, 8).toUpperCase()}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content & Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="rounded-xl border border-rose-300 bg-rose-50 p-3.5 text-xs text-rose-800 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Specialist Context Banner */}
          <div className="rounded-xl border border-blue-200 bg-[#EAF2FF] p-3 text-xs text-blue-900">
            <div className="font-bold">
              Referred to: Dr. {referral.referred_to_name}
            </div>
            <div className="text-blue-800 mt-0.5">
              {referral.referred_to_specialty
                ? `${referral.referred_to_specialty} • `
                : ""}
              {referral.referred_to_facility || "External Specialist"}
            </div>
            {referral.reason_for_referral && (
              <div className="mt-1 pt-1 border-t border-blue-200/60 text-[11px] text-blue-700">
                <span className="font-semibold">Reason:</span> {referral.reason_for_referral}
              </div>
            )}
          </div>

          {/* Return Date */}
          <div>
            <label
              htmlFor="return-date-input"
              className="block text-xs font-semibold text-gray-700 mb-1"
            >
              Return / Review Date
            </label>
            <input
              id="return-date-input"
              type="date"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-xl border border-gray-300 text-xs text-gray-900 bg-white focus:outline-none focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0]"
            />
          </div>

          {/* Specialist Findings & Follow-up Plan */}
          <div>
            <label
              htmlFor="closure-notes-input"
              className="block text-xs font-semibold text-gray-700 mb-1"
            >
              Specialist Findings & Ongoing Care Plan <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="closure-notes-input"
              rows={4}
              required
              value={closureNotes}
              onChange={(e) => setClosureNotes(e.target.value)}
              placeholder="e.g. Patient underwent 2D Echo showing EF 58%, trivial MR. Started on Beta-blocker. Routine 3-month review advised..."
              className="w-full p-3 rounded-xl border border-gray-300 text-xs text-gray-900 bg-white placeholder:text-gray-400 focus:outline-none focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0]"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Documenting loop closure marks the referral as completed and attaches return notes to the patient visit history.
            </p>
          </div>

          {/* Footer CTAs */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="min-h-[44px] px-4 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !closureNotes.trim()}
              className="min-h-[44px] px-4 rounded-xl bg-[#1769E0] hover:bg-[#155cc0] text-white text-xs font-semibold flex items-center gap-2 shadow-theme-xs transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Completing...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Save & Complete Referral</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
