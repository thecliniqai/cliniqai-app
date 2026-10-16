"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { AlertTriangle, Clock, ShieldAlert } from "lucide-react";

export interface SoftBlockOverrideDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (emergencyNote: string) => void;
  doctorName: string;
  timeStr: string;
  isOffDuty?: boolean;
  isBlocked?: boolean;
  blockReason?: string;
}

export function SoftBlockOverrideDialog({
  isOpen,
  onClose,
  onConfirm,
  doctorName,
  timeStr,
  isOffDuty,
  isBlocked,
  blockReason,
}: SoftBlockOverrideDialogProps) {
  const [emergencyReason, setEmergencyReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (!emergencyReason.trim()) {
      setError("Please provide an emergency justification note.");
      return;
    }
    setError(null);
    onConfirm(emergencyReason.trim());
    setEmergencyReason("");
  };

  const title = isBlocked
    ? "Doctor Schedule Blocked"
    : "Doctor Is Off-Duty";

  const description = isBlocked
    ? `Dr. ${doctorName.replace(/^(Dr\.|Staff)\s*/i, "")} has blocked this time slot (${blockReason || "Time off / Surgery"}).`
    : `This time slot (${timeStr}) falls outside Dr. ${doctorName.replace(/^(Dr\.|Staff)\s*/i, "")}'s scheduled working shifts.`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      maxWidth="md"
    >
      <div className="space-y-4 pt-2">
        <div className="p-3.5 bg-amber-50/80 border border-amber-200 rounded-xl flex items-start gap-3">
          <div className="p-1.5 rounded-lg bg-amber-100 text-amber-800 shrink-0 mt-0.5">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="text-xs text-amber-950">
            <p className="font-semibold">{description}</p>
            <p className="text-amber-800 mt-1">
              Booking during blocked or off-duty hours requires administrative override and will be logged in the audit trail.
            </p>
          </div>
        </div>

        <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 text-xs text-gray-700 flex items-center justify-between">
          <span className="font-medium text-gray-600">Selected Slot:</span>
          <span className="font-bold text-gray-900 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-gray-500" />
            {timeStr}
          </span>
        </div>

        <Field
          label="Emergency Justification *"
          htmlFor="override-reason"
          error={error || undefined}
          helpText="Reason for urgent booking during off-duty hours."
        >
          <textarea
            id="override-reason"
            rows={3}
            placeholder="e.g. Acute chest pain, critical post-op complication, emergency walk-in approved by doctor"
            value={emergencyReason}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
              setEmergencyReason(e.target.value);
              if (error) setError(null);
            }}
            className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1769E0]/20 focus:border-[#1769E0]"
          />
        </Field>

        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-gray-100">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="text-xs font-semibold"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleConfirm}
            className="text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1.5"
          >
            <ShieldAlert className="w-4 h-4" />
            <span>Confirm Emergency Booking</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
