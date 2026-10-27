"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { Visit, Patient, DoctorWeeklySchedule, ScheduleBlock, DayOfWeek } from "@/lib/db/types";
import { Clock, Plus, AlertCircle, XCircle, Stethoscope, Ban, Coffee, Check, CheckCircle2, Loader2 } from "lucide-react";

export interface TimelineVisit extends Visit {
  patients?: Patient | null;
}

export interface TimelineDoctor {
  id: string;
  name: string;
  specialty?: string | null;
  default_slot_duration_minutes?: number | null;
  availability_schedule?: DoctorWeeklySchedule | null;
}

export interface SlotStatus {
  isOffDuty?: boolean;
  isBlocked?: boolean;
  blockReason?: string;
}

export interface DoctorTimelineProps {
  doctors: TimelineDoctor[];
  visits: TimelineVisit[];
  scheduleBlocks?: ScheduleBlock[];
  currentDate: string;
  onSlotClick: (doctorId: string, timeStr: string, slotStatus?: SlotStatus) => void;
  onCancelVisit: (visitId: string) => void;
  onConfirmVisit?: (visitId: string) => void;
  confirmingId?: string | null;
}

const DAY_NAMES: DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export function DoctorTimeline({
  doctors,
  visits,
  scheduleBlocks = [],
  currentDate,
  onSlotClick,
  onCancelVisit,
  onConfirmVisit,
  confirmingId,
}: DoctorTimelineProps) {
  // Day of week for currentDate
  const dayKey = useMemo<DayOfWeek>(() => {
    const d = new Date(`${currentDate}T00:00:00`);
    return DAY_NAMES[d.getDay()] || "monday";
  }, [currentDate]);

  // Compute dynamic start and end hours based on active doctor shifts
  const { startHour, endHour } = useMemo(() => {
    let earliestHour = 8;
    let latestHour = 20;

    for (const doc of doctors) {
      const schedule = doc.availability_schedule;
      if (!schedule) continue;

      const dayConfig = schedule[dayKey];
      if (!dayConfig || !dayConfig.enabled) continue;

      for (const shift of dayConfig.shifts) {
        if (!shift.start || !shift.end) continue;
        const [sH] = shift.start.split(":").map(Number);
        const [eH, eM] = shift.end.split(":").map(Number);

        if (!isNaN(sH) && sH < earliestHour) earliestHour = Math.max(6, sH);
        const effectiveEnd = eM > 0 ? eH + 1 : eH;
        if (!isNaN(effectiveEnd) && effectiveEnd > latestHour) {
          latestHour = Math.min(23, effectiveEnd);
        }
      }
    }

    // Also expand hours if any visits are scheduled outside shift hours (e.g. emergency override)
    for (const v of visits) {
      if (!v.scheduled_at || v.status === "cancelled") continue;
      const vDate = new Date(v.scheduled_at);
      const vH = vDate.getHours();
      if (!isNaN(vH)) {
        if (vH < earliestHour) earliestHour = Math.max(0, vH);
        const dur = v.estimated_duration_minutes || 15;
        const endH = Math.ceil((vH * 60 + vDate.getMinutes() + dur) / 60);
        if (endH > latestHour) latestHour = Math.min(24, endH);
      }
    }

    return { startHour: earliestHour, endHour: latestHour };
  }, [doctors, dayKey, visits]);

  // Generate 15-minute time slots between dynamic startHour and endHour
  const timeSlots = useMemo(() => {
    const slots: string[] = [];
    for (let hour = startHour; hour < endHour; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const hStr = hour.toString().padStart(2, "0");
        const mStr = minute.toString().padStart(2, "0");
        slots.push(`${hStr}:${mStr}`);
      }
    }
    return slots;
  }, [startHour, endHour]);

  const formatSlotLabel = (timeStr: string) => {
    const [h, m] = timeStr.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
  };

  // Find visits starting exactly at this doctor + slot
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

  // Check if slot is occupied by an ongoing multi-slot visit that started earlier
  const findOngoingVisitForSlot = (doctorId: string, timeStr: string) => {
    const [h, m] = timeStr.split(":").map(Number);
    const slotMins = h * 60 + m;

    return visits.find((v) => {
      if (!v.scheduled_at || v.doctor_id !== doctorId || v.status === "cancelled") return false;
      const vDate = new Date(v.scheduled_at);
      const vH = vDate.getHours();
      const vM = vDate.getMinutes();
      const vStartMins = vH * 60 + vM;
      const vDuration = v.estimated_duration_minutes || 15;
      const vEndMins = vStartMins + vDuration;

      return slotMins > vStartMins && slotMins < vEndMins;
    });
  };

  // Check slot status: off-duty vs blocked
  const getSlotStatus = (doc: TimelineDoctor, timeStr: string): SlotStatus => {
    const [h, m] = timeStr.split(":").map(Number);
    const slotMins = h * 60 + m;

    // 1. Check schedule blocks (doctor specific or clinic-wide)
    const slotStartTs = new Date(`${currentDate}T${timeStr}:00`).getTime();
    const slotEndTs = slotStartTs + 15 * 60000;

    for (const block of scheduleBlocks) {
      if (block.doctor_id && block.doctor_id !== doc.id) continue;

      if (block.all_day) {
        const sDate = block.start_time.split("T")[0];
        const eDate = block.end_time.split("T")[0];
        if (currentDate >= sDate && currentDate <= eDate) {
          return {
            isBlocked: true,
            blockReason: block.reason || (block.doctor_id ? "Doctor on leave" : "Clinic closed"),
          };
        }
      } else {
        const bStartTs = new Date(block.start_time).getTime();
        const bEndTs = new Date(block.end_time).getTime();
        if (bStartTs < slotEndTs && bEndTs > slotStartTs) {
          return {
            isBlocked: true,
            blockReason: block.reason || "Time blocked",
          };
        }
      }
    }

    // 2. Check doctor's working shifts
    const schedule = doc.availability_schedule;
    if (schedule) {
      const dayConfig = schedule[dayKey];
      if (!dayConfig || !dayConfig.enabled) {
        return { isOffDuty: true };
      }

      let inShift = false;
      for (const shift of dayConfig.shifts) {
        const [shH, shM] = shift.start.split(":").map(Number);
        const [ehH, ehM] = shift.end.split(":").map(Number);
        const shiftStartMins = shH * 60 + shM;
        const shiftEndMins = ehH * 60 + ehM;

        if (slotMins >= shiftStartMins && slotMins < shiftEndMins) {
          inShift = true;
          break;
        }
      }

      if (!inShift) {
        return { isOffDuty: true };
      }
    }

    return {};
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
                <div className="text-[11px] text-gray-500 font-medium truncate">
                  {doc.specialty ? `${doc.specialty} • ` : ""}
                  {doc.default_slot_duration_minutes || 15}m slots
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
                  const ongoingVisit = slotVisits.length === 0 ? findOngoingVisitForSlot(doc.id, timeStr) : null;
                  const status = getSlotStatus(doc, timeStr);

                  return (
                    <div
                      key={doc.id}
                      className={`p-1.5 border-r border-gray-100 last:border-r-0 relative min-h-[52px] flex flex-col justify-center ${
                        status.isBlocked
                          ? "bg-[repeating-linear-gradient(45deg,#f9fafb,#f9fafb_10px,#f3f4f6_10px,#f3f4f6_20px)]"
                          : status.isOffDuty
                          ? "bg-gray-100/40"
                          : ""
                      }`}
                    >
                      {/* Active Appointment Starting at this slot */}
                      {slotVisits.length > 0 ? (
                        <div className="space-y-1.5">
                          {slotVisits.map((v) => {
                            const isAlreadyConfirmed =
                              v.status === "confirmed" ||
                              v.status === "waiting" ||
                              v.status === "in_consultation" ||
                              v.status === "completed" ||
                              Boolean(v.metadata?.patient_confirmed) ||
                              Boolean(v.metadata?.clinic_confirmed);

                            const isConfirmed = isAlreadyConfirmed && v.status !== "in_consultation" && v.status !== "waiting" && v.status !== "completed";
                            const isSoftBook = v.status === "booked" && !isAlreadyConfirmed;
                            const isInConsultation = v.status === "in_consultation";
                            const isConfirming = confirmingId === v.id;

                            return (
                              <div
                                key={v.id}
                                className={`p-2.5 rounded-xl border text-xs flex flex-col gap-2 shadow-2xs transition-all ${
                                  v.is_overbooked
                                    ? isSoftBook
                                      ? "bg-amber-50/70 border-dashed border-amber-400 text-amber-950"
                                      : "bg-amber-50 border-solid border-amber-300 text-amber-950"
                                    : isSoftBook
                                    ? "bg-sky-50/60 border-dashed border-sky-300 text-sky-950"
                                    : isInConsultation
                                    ? "bg-emerald-50 border-solid border-emerald-300 text-emerald-950"
                                    : "bg-brand-50/80 border-solid border-brand-200 text-brand-950"
                                }`}
                              >
                                {/* Top Row: Patient Name & Overbooked icon */}
                                <div className="flex items-start justify-between gap-1.5">
                                  <div className="truncate flex-1">
                                    <div className="font-semibold text-gray-900 truncate flex items-center gap-1.5">
                                      <span className="truncate">{v.patients?.full_name || "Patient"}</span>
                                      {v.is_overbooked && (
                                        <span
                                          title="Overbooked / Off-duty emergency slot"
                                          className="shrink-0 p-0.5 rounded text-amber-700 bg-amber-100"
                                        >
                                          <AlertCircle className="w-3 h-3" />
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[11px] text-gray-600 truncate mt-0.5 flex items-center gap-1.5">
                                      <span className="truncate">{v.reason_for_visit || "Consultation"}</span>
                                      <span className="shrink-0 px-1 py-0.2 rounded bg-white/70 border border-gray-200 font-medium text-[10px] text-gray-700">
                                        {v.estimated_duration_minutes || 15}m
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {/* Bottom Row: Status Badge & Actions */}
                                <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-gray-200/50">
                                  {/* Status Badge */}
                                  <div className="flex items-center gap-1">
                                    {isSoftBook ? (
                                      <span
                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-100/90 border border-amber-300 text-amber-900 text-[10px] font-semibold"
                                        title="Soft-booked appointment (unconfirmed)"
                                      >
                                        <Clock className="w-2.5 h-2.5 text-amber-700" />
                                        <span>Soft Book</span>
                                      </span>
                                    ) : isConfirmed ? (
                                      <span
                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-100/90 border border-emerald-300 text-emerald-900 text-[10px] font-semibold"
                                        title="Confirmed appointment"
                                      >
                                        <CheckCircle2 className="w-2.5 h-2.5 text-emerald-700" />
                                        <span>Confirmed</span>
                                      </span>
                                    ) : isInConsultation ? (
                                      <span
                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-100 border border-emerald-300 text-emerald-900 text-[10px] font-semibold"
                                        title="Currently in consultation"
                                      >
                                        <Stethoscope className="w-2.5 h-2.5 text-emerald-700" />
                                        <span>In Progress</span>
                                      </span>
                                    ) : null}
                                  </div>

                                  {/* Action Buttons */}
                                  <div className="flex items-center gap-1 shrink-0">
                                    {isSoftBook && onConfirmVisit && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onConfirmVisit(v.id);
                                        }}
                                        disabled={isConfirming}
                                        title="Confirm appointment manually"
                                        className="px-2 py-0.5 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-[10px] flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
                                      >
                                        {isConfirming ? (
                                          <Loader2 className="w-3 h-3 animate-spin" />
                                        ) : (
                                          <Check className="w-3 h-3" />
                                        )}
                                        <span>Confirm</span>
                                      </button>
                                    )}

                                    <Link
                                      href={`/consultation/${v.id}`}
                                      className="p-1 rounded-lg text-[#1769E0] hover:text-[#155cc0] hover:bg-white/90 transition-colors cursor-pointer"
                                      title={
                                        v.status === "in_consultation"
                                          ? "Resume Consultation"
                                          : "Start Consultation"
                                      }
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Stethoscope className="w-3.5 h-3.5" />
                                    </Link>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onCancelVisit(v.id);
                                      }}
                                      title="Cancel Appointment"
                                      aria-label="Cancel Appointment"
                                      className="p-1 rounded-lg text-gray-400 hover:text-red-600 hover:bg-white/80 transition-colors cursor-pointer"
                                    >
                                      <XCircle className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : ongoingVisit ? (
                        /* Ongoing Consultation Span from Previous Slot */
                        <div className="px-2.5 py-1.5 rounded-lg bg-brand-50/40 border border-dashed border-brand-200 text-[11px] text-brand-800 flex items-center justify-between">
                          <span className="truncate font-medium">
                            ↳ {ongoingVisit.patients?.full_name || "Patient"} (in progress)
                          </span>
                          <span className="text-[10px] font-semibold text-brand-600 shrink-0">
                            {ongoingVisit.estimated_duration_minutes}m
                          </span>
                        </div>
                      ) : status.isBlocked ? (
                        /* Blocked Time Slot */
                        <button
                          type="button"
                          onClick={() => onSlotClick(doc.id, timeStr, status)}
                          className="w-full h-full min-h-[38px] px-2 py-1 rounded-lg border border-dashed border-amber-300 bg-amber-50/50 hover:bg-amber-100/70 transition-colors flex items-center justify-between text-left cursor-pointer group"
                          title="Click to override block for emergency"
                        >
                          <div className="flex items-center gap-1.5 text-amber-900 truncate">
                            <Ban className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                            <span className="text-[11px] font-medium truncate">
                              {status.blockReason || "Blocked"}
                            </span>
                          </div>
                          <span className="text-[10px] font-bold text-amber-700 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            Override
                          </span>
                        </button>
                      ) : status.isOffDuty ? (
                        /* Off Duty / Shift Break Slot */
                        <button
                          type="button"
                          onClick={() => onSlotClick(doc.id, timeStr, status)}
                          className="w-full h-full min-h-[38px] px-2 py-1 rounded-lg border border-transparent hover:border-dashed hover:border-gray-300 hover:bg-gray-200/50 transition-colors flex items-center justify-between text-left cursor-pointer group"
                          title="Click to override off-duty for emergency"
                        >
                          <div className="flex items-center gap-1.5 text-gray-400 truncate">
                            <Coffee className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <span className="text-[11px] font-medium truncate">Off Duty</span>
                          </div>
                          <span className="text-[10px] font-bold text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            Emergency
                          </span>
                        </button>
                      ) : (
                        /* Standard Available Slot */
                        <button
                          type="button"
                          onClick={() => onSlotClick(doc.id, timeStr, {})}
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
