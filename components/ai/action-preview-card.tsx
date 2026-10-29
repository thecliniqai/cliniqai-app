"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AlertCircle, Calendar, Clock, DollarSign, Loader2, User, Stethoscope } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ActionPreviewCardDetails {
  patient_name: string;
  phone?: string;
  doctor_name: string;
  doctor_id?: string;
  patient_id?: string;
  appointment_id?: string;
  date?: string;
  start_time?: string;
  old_date_time?: string;
  new_date?: string;
  new_start_time?: string;
  scheduled_at?: string;
  reason?: string;
  fee?: number;
  outside_shift_warning?: boolean;
  consultation_type?: "in_person" | "teleconsult";
}

export interface ActionPreviewCardProps {
  actionType: "book_appointment" | "reschedule_appointment" | "cancel_appointment";
  details: ActionPreviewCardDetails;
  onConfirm?: () => Promise<void> | void;
  onCancel?: () => void;
  initialStatus?: "preview" | "confirmed" | "cancelled";
  className?: string;
}

export function ActionPreviewCard({
  actionType,
  details,
  onConfirm,
  onCancel,
  initialStatus = "preview",
  className,
}: ActionPreviewCardProps) {
  const [status, setStatus] = useState<"preview" | "loading" | "confirmed" | "cancelled">(initialStatus);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isCancellation = actionType === "cancel_appointment";
  const isReschedule = actionType === "reschedule_appointment";

  const handleConfirm = async () => {
    if (status === "loading" || status === "confirmed" || status === "cancelled") return;
    setStatus("loading");
    setErrorMsg(null);

    try {
      if (onConfirm) {
        await onConfirm();
      }
      if (isCancellation) {
        setStatus("cancelled");
      } else {
        setStatus("confirmed");
      }
    } catch (err: any) {
      console.error("[ActionPreviewCard] Execution error:", err);
      setErrorMsg(err?.message || "Failed to execute action. Please retry.");
      setStatus("preview");
    }
  };

  const handleCancelAction = () => {
    if (status === "loading") return;
    onCancel?.();
  };

  // Formatted date and time display
  let slotDisplay = "Scheduled slot";
  if (details.date && details.start_time) {
    try {
      const d = new Date(`${details.date}T${details.start_time}:00`);
      const datePart = d.toLocaleDateString("en-US", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      slotDisplay = `${datePart} • ${details.start_time}`;
    } catch {
      slotDisplay = `${details.date} • ${details.start_time}`;
    }
  } else if (isReschedule && details.new_date && details.new_start_time) {
    slotDisplay = `New Slot: ${details.new_date} • ${details.new_start_time}`;
  } else if (details.scheduled_at) {
    slotDisplay = details.scheduled_at;
  }

  return (
    <div
      className={cn(
        "w-full rounded-xl border border-[#E4E5E7] bg-white p-4 shadow-sm transition-all my-2",
        className
      )}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-[#F1F2F4] pb-2 mb-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#1769E0]">
          <span className="flex h-2 w-2 rounded-full bg-[#1769E0]" />
          {isCancellation
            ? "Cancellation Preview"
            : isReschedule
            ? "Reschedule Preview"
            : "Appointment Booking Preview"}
        </div>
        <span className="text-[11px] text-gray-500 font-medium">Requires Confirmation</span>
      </div>

      {/* Outside shift warning badge */}
      {details.outside_shift_warning && (
        <div className="flex items-center gap-2 rounded-lg border border-[#F3D39A] bg-[#FFF5E5] px-3 py-2 text-xs font-medium text-[#9A5B00] mb-3">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Schedule Warning: Outside doctor active shift hours</span>
        </div>
      )}

      {/* Details grid */}
      <div className="space-y-2 text-sm text-[#17181A]">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-gray-500 text-xs">
            <User className="w-3.5 h-3.5" /> Patient
          </span>
          <span className="font-semibold text-right">
            {details.patient_name} {details.phone ? `(${details.phone})` : ""}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-gray-500 text-xs">
            <Stethoscope className="w-3.5 h-3.5" /> Doctor
          </span>
          <span className="font-semibold text-right">{details.doctor_name}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-gray-500 text-xs">
            <Calendar className="w-3.5 h-3.5" /> Slot
          </span>
          <span className="font-semibold text-right">{slotDisplay}</span>
        </div>

        {details.fee !== undefined && !isCancellation && (
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-gray-500 text-xs">
              <DollarSign className="w-3.5 h-3.5" /> Fee
            </span>
            <span className="font-semibold text-right">₹{details.fee}</span>
          </div>
        )}

        {isCancellation && details.reason && (
          <div className="flex items-start justify-between text-xs pt-1 border-t border-gray-100">
            <span className="text-gray-500">Reason</span>
            <span className="text-right text-gray-700 italic max-w-[200px] truncate">{details.reason}</span>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="mt-3 text-xs text-[#B42318] bg-[#FDECEA] p-2 rounded border border-[#F2B8B5]">
          {errorMsg}
        </div>
      )}

      {/* Action / State Area */}
      <div className="mt-4 pt-3 border-t border-[#F1F2F4]">
        {status === "confirmed" ? (
          <div className="flex items-center justify-between rounded-lg border border-[#BDE5CF] bg-[#EAF7F0] px-3 py-2 text-xs font-semibold text-[#18794E]">
            <span>✓ Confirmed on Calendar • Slot Locked</span>
            <Link
              href="/calendar"
              className="text-[#1769E0] hover:underline font-medium text-xs inline-flex items-center gap-1"
            >
              Open in Calendar ↗
            </Link>
          </div>
        ) : status === "cancelled" ? (
          <div className="flex items-center justify-between rounded-lg border border-[#F2B8B5] bg-[#FDECEA] px-3 py-2 text-xs font-semibold text-[#B42318]">
            <span>✕ Appointment Cancelled • Slot Released</span>
            <Link
              href="/calendar"
              className="text-gray-600 hover:underline font-medium text-xs inline-flex items-center gap-1"
            >
              View Calendar ↗
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={status === "loading"}
              onClick={handleConfirm}
              className={cn(
                "flex-1 h-9 px-3 rounded-lg text-xs font-semibold text-white transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed",
                isCancellation
                  ? "bg-[#B42318] hover:bg-[#911C13]"
                  : "bg-[#1769E0] hover:bg-[#0F5AB8]"
              )}
            >
              {status === "loading" ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Executing action...</span>
                </>
              ) : isCancellation ? (
                "Cancel Appointment Slot"
              ) : isReschedule ? (
                "Confirm Reschedule"
              ) : (
                "Confirm Appointment Booking"
              )}
            </button>

            <button
              type="button"
              disabled={status === "loading"}
              onClick={handleCancelAction}
              className="h-9 px-3 rounded-lg border border-[#C9CCD1] bg-white text-xs font-medium text-[#52565B] hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel Booking Action
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
