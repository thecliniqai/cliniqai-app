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
    <div className="overflow-x-auto bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-xl shadow-xs">
      <div className="min-w-[760px]">
        {/* Doctors Header Row */}
        <div className="grid grid-cols-[100px_repeat(auto-fit,minmax(200px,1fr))] border-b border-[var(--border-default)] bg-[var(--surface-subtle)] sticky top-0 z-10">
          <div className="p-3 text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center justify-center border-r border-[var(--border-default)]">
            <Clock className="w-3.5 h-3.5 mr-1" />
            Time
          </div>
          {doctors.map((doc) => (
            <div
              key={doc.id}
              className="p-3 text-sm font-semibold text-[var(--text-primary)] border-r border-[var(--border-default)] last:border-r-0 text-center truncate"
            >
              {doc.name}
            </div>
          ))}
        </div>

        {/* Time Slots Grid */}
        <div className="divide-y divide-[var(--border-default)]">
          {timeSlots.map((timeStr) => {
            const isHourMark = timeStr.endsWith(":00");

            return (
              <div
                key={timeStr}
                className={`grid grid-cols-[100px_repeat(auto-fit,minmax(200px,1fr))] min-h-[48px] ${
                  isHourMark ? "bg-white" : "bg-[var(--surface-primary)]"
                }`}
              >
                {/* Time Label */}
                <div
                  className={`px-2 py-2 text-xs text-[var(--text-secondary)] flex items-center justify-center border-r border-[var(--border-default)] ${
                    isHourMark ? "font-bold text-[var(--text-primary)]" : "font-normal"
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
                      className="p-1 border-r border-[var(--border-default)] last:border-r-0 relative min-h-[48px] flex flex-col justify-center"
                    >
                      {slotVisits.length > 0 ? (
                        <div className="space-y-1">
                          {slotVisits.map((v) => (
                            <div
                              key={v.id}
                              className={`p-2 rounded-md border text-xs flex items-center justify-between gap-2 shadow-2xs ${
                                v.is_overbooked
                                  ? "bg-amber-50 border-amber-300 text-amber-900"
                                  : v.status === "in_consultation"
                                  ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                                  : "bg-blue-50 border-blue-200 text-blue-900"
                              }`}
                            >
                              <div className="truncate flex-1">
                                <div className="font-semibold truncate">
                                  {v.patients?.full_name || "Patient"}
                                </div>
                                <div className="text-[10px] text-[var(--text-secondary)] truncate">
                                  {v.reason_for_visit || "Consultation"} • {v.estimated_duration_minutes}m
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                {v.is_overbooked && (
                                  <span
                                    title="Overbooked slot"
                                    className="p-0.5 rounded text-amber-600"
                                  >
                                    <AlertCircle className="w-3.5 h-3.5" />
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => onCancelVisit(v.id)}
                                  title="Cancel Appointment"
                                  aria-label="Cancel Appointment"
                                  className="p-1 rounded text-[var(--text-muted)] hover:text-red-600 hover:bg-white/60 transition-colors"
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
                          className="w-full h-full min-h-[40px] rounded hover:bg-[var(--surface-subtle)] group flex items-center justify-center text-transparent hover:text-[var(--brand-primary)] text-xs font-semibold transition-colors"
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
