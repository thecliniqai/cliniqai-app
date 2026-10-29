"use client";

import React from "react";
import { AlertCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ConflictRecoveryCardProps {
  message?: string;
  doctorName?: string;
  date?: string;
  alternativeSlots?: string[];
  onSelectSlot: (slotTime: string) => void;
  className?: string;
}

export function ConflictRecoveryCard({
  message = "Selected slot is no longer available. Please select an alternative slot below.",
  doctorName,
  date,
  alternativeSlots = ["10:30 AM", "11:15 AM", "04:00 PM"],
  onSelectSlot,
  className,
}: ConflictRecoveryCardProps) {
  return (
    <div
      className={cn(
        "w-full rounded-xl border border-[#F3D39A] bg-[#FFF5E5]/60 p-4 shadow-sm my-2",
        className
      )}
    >
      <div className="flex items-start gap-2.5 mb-3">
        <AlertCircle className="w-4 h-4 text-[#9A5B00] shrink-0 mt-0.5" />
        <div className="text-xs text-[#9A5B00]">
          <span className="font-semibold block mb-0.5">Slot Conflict Detected</span>
          <span>{message}</span>
          {doctorName && date && (
            <span className="block text-[11px] text-gray-600 mt-1">
              Available times with {doctorName} on {date}:
            </span>
          )}
        </div>
      </div>

      <div className="pt-2 border-t border-[#F3D39A]/40">
        <span className="text-[11px] font-semibold text-gray-700 block mb-2">
          Recommended Alternative Slots:
        </span>
        <div className="flex flex-wrap gap-2">
          {alternativeSlots.map((slot) => (
            <button
              key={slot}
              type="button"
              onClick={() => onSelectSlot(slot)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#C7D2FE] bg-white text-xs font-semibold text-[#1769E0] hover:bg-[#EAF2FF] hover:border-[#1769E0] transition-colors cursor-pointer shadow-2xs"
            >
              <Clock className="w-3 h-3 text-[#1769E0]" />
              <span>{slot}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
