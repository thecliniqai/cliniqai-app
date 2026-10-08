"use client";

import React from "react";
import { Visit, Patient } from "@/lib/db/types";
import { Clock, Plus, AlertCircle, XCircle } from "lucide-react";

export interface TimelineVisit extends Visit {
  patients?: Patient | null;
}

export interface DoctorTimelineProps {
  doctors: Array<{ id: string; name: string }>;
  visits: TimelineVisit[];
  currentDate: string;
  onSlotClick: (doctorId: string, timeStr: string) => void;
  onCancelVisit: (visitId: string) => void;
}

export function DoctorTimeline({
  doctors,
  visits,
  onSlotClick,
  onCancelVisit,
}: DoctorTimelineProps) {
  // Generate 15-minute time slots between 09:00 and 18:00 (9 AM to 6 PM)
  const timeSlots: string[] = [];
  for (let hour = 9; hour < 18; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      const hStr = hour.toString().padStart(2, "0");
      const mStr = minute.toString().padStart(2, "0");
      timeSlots.push(`${hStr}:${mStr}`);
    }
  }

  const formatSlotLabel = (timeStr: string) => {
    const [h, m] = timeStr.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
  };

  // Find visits matching doctor and slot interval
  const findVisitsForSlot = (doctorId: string, timeStr: string) => {
    return visits.filter((v) => {
      if (!v.scheduled_at) return false;
      if (v.doctor_id !== doctorId) return false;
      if (v.status === "cancelled") return false;

      const vTime = new Date(v.scheduled_at);
      const vH = vTime.getHours().toString().padStart(2, "0");
      const vM = vTime.getMinutes().toString().padStart(2, "0");
      const vSlot = `${vH}:${vM}`;
      return vSlot === timeStr;
    });
  };

  return (
    <div className="overflow-x-auto bg-white border border-gray-200 rounded-2xl shadow-xs">
      <div className="min-w-[780px]">
        {/* Doctors Header Row */}
        <div className="grid grid-cols-[110px_repeat(auto-fit,minmax(210px,1fr))] border-b border-gray-200 bg-gray-50/80 sticky top-0 z-10 backdrop-blur-xs">
          <div className="p-3.5 text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center justify-center border-r border-gray-200">
            <Clock className="w-3.5 h-3.5 mr-1.5 text-gray-400" />
            Time
          </div>
          {doctors.map((doc) => (
            <div
              key={doc.id}
              className="p-3 border-r border-gray-200 last:border-r-0 flex items-center justify-center gap-2.5 truncate"
            >
              <div className="w-8 h-8 rounded-full bg-brand-50 border border-brand-200 text-brand-600 font-bold text-xs flex items-center justify-center shrink-0">
                {doc.name.replace(/^(Dr\.|Staff)\s*/i, "").charAt(0) || "D"}
              </div>
              <div className="text-left truncate">
                <div className="text-sm font-semibold text-gray-900 truncate">
                  {doc.name}
                </div>
                <div className="text-[11px] text-gray-500 font-medium">
                  Available Today
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Time Slots Grid */}
        <div className="divide-y divide-gray-100">
          {timeSlots.map((timeStr) => {
            const isHourMark = timeStr.endsWith(":00");

            return (
              <div
                key={timeStr}
                className={`grid grid-cols-[110px_repeat(auto-fit,minmax(210px,1fr))] min-h-[52px] ${
                  isHourMark ? "bg-white" : "bg-gray-50/20"
                }`}
              >
                {/* Time Label */}
                <div
                  className={`px-3 py-2 text-xs flex items-center justify-center border-r border-gray-100 ${
                    isHourMark
                      ? "font-bold text-gray-900 bg-gray-50/50"
                      : "font-normal text-gray-500"
                  }`}
                >
                  {formatSlotLabel(timeStr)}
                </div>

                {/* Columns for each doctor */}
                {doctors.map((doc) => {
                  const slotVisits = findVisitsForSlot(doc.id, timeStr);

                  return (
                    <div
                      key={doc.id}
                      className="p-1.5 border-r border-gray-100 last:border-r-0 relative min-h-[52px] flex flex-col justify-center"
                    >
                      {slotVisits.length > 0 ? (
                        <div className="space-y-1.5">
                          {slotVisits.map((v) => (
                            <div
                              key={v.id}
                              className={`p-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 shadow-2xs transition-all ${
                                v.is_overbooked
                                  ? "bg-amber-50 border-amber-300 text-amber-950"
                                  : v.status === "in_consultation"
                                  ? "bg-emerald-50 border-emerald-300 text-emerald-950"
                                  : "bg-brand-50/80 border-brand-200 text-brand-950"
                              }`}
                            >
                              <div className="truncate flex-1">
                                <div className="font-semibold text-gray-900 truncate">
                                  {v.patients?.full_name || "Patient"}
                                </div>
                                <div className="text-[11px] text-gray-600 truncate mt-0.5">
                                  {v.reason_for_visit || "Consultation"} • {v.estimated_duration_minutes}m
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                {v.is_overbooked && (
                                  <span
                                    title="Overbooked slot"
                                    className="p-1 rounded text-amber-600 bg-amber-100/80"
                                  >
                                    <AlertCircle className="w-3.5 h-3.5" />
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => onCancelVisit(v.id)}
                                  title="Cancel Appointment"
                                  aria-label="Cancel Appointment"
                                  className="p-1 rounded-lg text-gray-400 hover:text-red-600 hover:bg-white/80 transition-colors cursor-pointer"
                                >
                                  <XCircle className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSlotClick(doc.id, timeStr)}
                          className="w-full h-full min-h-[44px] rounded-lg hover:border hover:border-dashed hover:border-brand-300 hover:bg-brand-50/30 group flex items-center justify-center text-transparent hover:text-brand-600 text-xs font-semibold transition-all cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5 mr-1" />
                          <span>Book</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
