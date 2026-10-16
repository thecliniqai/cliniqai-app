"use client";

import React, { useState, useEffect, useTransition } from "react";
import {
  Membership,
  DoctorWeeklySchedule,
  DayAvailability,
  DayShiftSchedule,
  DayOfWeek,
  ScheduleBlock,
} from "@/lib/db/types";
import {
  updateDoctorAvailability,
  updateDoctorSlotDuration,
  getDoctorScheduleBlocks,
  deleteDoctorScheduleBlock,
} from "@/features/settings/actions";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BlockTimeModal } from "@/components/calendar/block-time-modal";
import {
  Clock,
  Calendar,
  Save,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Copy,
  Ban,
  CalendarOff,
} from "lucide-react";

export const DEFAULT_WEEKLY_SCHEDULE: DoctorWeeklySchedule = {
  monday: {
    enabled: true,
    shifts: [
      { start: "10:00", end: "13:00" },
      { start: "17:00", end: "21:00" },
    ],
  },
  tuesday: {
    enabled: true,
    shifts: [
      { start: "10:00", end: "13:00" },
      { start: "17:00", end: "21:00" },
    ],
  },
  wednesday: {
    enabled: true,
    shifts: [
      { start: "10:00", end: "13:00" },
      { start: "17:00", end: "21:00" },
    ],
  },
  thursday: {
    enabled: true,
    shifts: [
      { start: "10:00", end: "13:00" },
      { start: "17:00", end: "21:00" },
    ],
  },
  friday: {
    enabled: true,
    shifts: [
      { start: "10:00", end: "13:00" },
      { start: "17:00", end: "21:00" },
    ],
  },
  saturday: {
    enabled: true,
    shifts: [
      { start: "10:00", end: "13:00" },
      { start: "17:00", end: "21:00" },
    ],
  },
  sunday: {
    enabled: false,
    shifts: [],
  },
};

const DAYS_ORDER: { key: DayOfWeek; label: string }[] = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
];

export interface DoctorAvailabilityCardProps {
  membership: Membership;
  onScheduleChange?: (schedule: DoctorWeeklySchedule) => void;
  onSlotDurationChange?: (duration: number) => void;
  standaloneSave?: boolean;
}

export function DoctorAvailabilityCard({
  membership,
  onScheduleChange,
  onSlotDurationChange,
  standaloneSave = true,
}: DoctorAvailabilityCardProps) {
  const [isPending, startTransition] = useTransition();

  const [schedule, setSchedule] = useState<DoctorWeeklySchedule>(
    membership.availability_schedule || DEFAULT_WEEKLY_SCHEDULE
  );
  const [slotDuration, setSlotDuration] = useState<number>(
    membership.default_slot_duration_minutes || 15
  );

  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  const [isBlockModalOpen, setIsBlockModalOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Load upcoming blocks
  useEffect(() => {
    let mounted = true;
    getDoctorScheduleBlocks(membership.user_id).then((data) => {
      if (mounted) setBlocks(data);
    });
    return () => {
      mounted = false;
    };
  }, [membership.user_id]);

  const handleDayToggle = (day: DayOfWeek) => {
    setSchedule((prev) => {
      const current = prev[day];
      const willEnable = !current.enabled;
      const updatedDay: DayAvailability = {
        enabled: willEnable,
        shifts:
          willEnable && (!current.shifts || current.shifts.length === 0)
            ? [
                { start: "10:00", end: "13:00" },
                { start: "17:00", end: "21:00" },
              ]
            : current.shifts,
      };
      const nextSchedule = { ...prev, [day]: updatedDay };
      if (onScheduleChange) onScheduleChange(nextSchedule);
      return nextSchedule;
    });
  };

  const handleShiftChange = (
    day: DayOfWeek,
    shiftIndex: number,
    field: "start" | "end",
    val: string
  ) => {
    setSchedule((prev) => {
      const currentDay = prev[day];
      const updatedShifts = [...currentDay.shifts];
      updatedShifts[shiftIndex] = {
        ...updatedShifts[shiftIndex],
        [field]: val,
      };
      const nextSchedule = {
        ...prev,
        [day]: { ...currentDay, shifts: updatedShifts },
      };
      if (onScheduleChange) onScheduleChange(nextSchedule);
      return nextSchedule;
    });
  };

  const handleAddShift = (day: DayOfWeek) => {
    setSchedule((prev) => {
      const currentDay = prev[day];
      if (currentDay.shifts.length >= 2) return prev;
      const updatedShifts: DayShiftSchedule[] = [
        ...currentDay.shifts,
        { start: "17:00", end: "21:00" },
      ];
      const nextSchedule = {
        ...prev,
        [day]: { ...currentDay, shifts: updatedShifts },
      };
      if (onScheduleChange) onScheduleChange(nextSchedule);
      return nextSchedule;
    });
  };

  const handleRemoveShift = (day: DayOfWeek, shiftIndex: number) => {
    setSchedule((prev) => {
      const currentDay = prev[day];
      const updatedShifts = currentDay.shifts.filter((_, idx) => idx !== shiftIndex);
      const nextSchedule = {
        ...prev,
        [day]: {
          ...currentDay,
          shifts: updatedShifts,
          enabled: updatedShifts.length > 0,
        },
      };
      if (onScheduleChange) onScheduleChange(nextSchedule);
      return nextSchedule;
    });
  };

  const copyMondayToWeekdays = () => {
    const mondayConfig = schedule.monday;
    setSchedule((prev) => {
      const next = {
        ...prev,
        tuesday: JSON.parse(JSON.stringify(mondayConfig)),
        wednesday: JSON.parse(JSON.stringify(mondayConfig)),
        thursday: JSON.parse(JSON.stringify(mondayConfig)),
        friday: JSON.parse(JSON.stringify(mondayConfig)),
      };
      if (onScheduleChange) onScheduleChange(next);
      return next;
    });
  };

  const copyMondayToSaturday = () => {
    const mondayConfig = schedule.monday;
    setSchedule((prev) => {
      const next = {
        ...prev,
        saturday: JSON.parse(JSON.stringify(mondayConfig)),
      };
      if (onScheduleChange) onScheduleChange(next);
      return next;
    });
  };

  const handleSaveStandalone = () => {
    setStatusMessage(null);
    startTransition(async () => {
      // 1. Update availability schedule
      const resSchedule = await updateDoctorAvailability({
        membership_id: membership.id,
        availability_schedule: schedule,
      });

      if (!resSchedule.success) {
        setStatusMessage({ type: "error", text: resSchedule.error });
        return;
      }

      // 2. Update default slot duration
      const resDuration = await updateDoctorSlotDuration({
        membership_id: membership.id,
        default_slot_duration_minutes: slotDuration,
      });

      if (!resDuration.success) {
        setStatusMessage({ type: "error", text: resDuration.error });
        return;
      }

      setStatusMessage({
        type: "success",
        text: "Weekly shifts and appointment slot duration saved successfully.",
      });
    });
  };

  const handleDeleteBlock = (blockId: string) => {
    deleteDoctorScheduleBlock(blockId).then((res) => {
      if (res.success) {
        setBlocks((prev) => prev.filter((b) => b.id !== blockId));
      }
    });
  };

  return (
    <Card className="rounded-2xl border-gray-200 bg-white shadow-theme-xs">
      <CardHeader className="border-b border-gray-100 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-[#1769E0]">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold text-gray-900">
                Doctor Shifts & Availability
              </CardTitle>
              <CardDescription className="text-xs text-gray-500">
                Weekly working hours, split shifts (morning & evening), and appointment slot durations
              </CardDescription>
            </div>
          </div>

          {/* Slot Duration Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-600">Slot Duration:</span>
            <select
              value={slotDuration}
              onChange={(e) => {
                const val = Number(e.target.value);
                setSlotDuration(val);
                if (onSlotDurationChange) onSlotDurationChange(val);
              }}
              className="h-9 px-3 rounded-lg border border-gray-200 bg-gray-50 text-xs font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1769E0]/20"
            >
              <option value={15}>15 mins (Default)</option>
              <option value={20}>20 mins</option>
              <option value={30}>30 mins</option>
              <option value={45}>45 mins</option>
              <option value={60}>60 mins</option>
            </select>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-5 space-y-6">
        {statusMessage && (
          <div
            className={`p-3.5 rounded-xl text-xs flex items-center gap-2.5 ${
              statusMessage.type === "success"
                ? "bg-green-50 border border-green-200 text-green-800"
                : "bg-red-50 border border-red-200 text-red-700"
            }`}
          >
            {statusMessage.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-green-600" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            )}
            <span className="font-medium">{statusMessage.text}</span>
          </div>
        )}

        {/* Quick Presets */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-gray-50 border border-gray-100 rounded-xl">
          <span className="text-xs font-medium text-gray-700">Quick Shortcuts:</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyMondayToWeekdays}
              className="px-2.5 py-1 text-xs font-medium rounded-lg bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors flex items-center gap-1.5 cursor-pointer shadow-theme-xs"
            >
              <Copy className="w-3.5 h-3.5 text-[#1769E0]" />
              <span>Apply Monday to Mon–Fri</span>
            </button>
            <button
              type="button"
              onClick={copyMondayToSaturday}
              className="px-2.5 py-1 text-xs font-medium rounded-lg bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors flex items-center gap-1.5 cursor-pointer shadow-theme-xs"
            >
              <Copy className="w-3.5 h-3.5 text-gray-500" />
              <span>Copy to Saturday</span>
            </button>
          </div>
        </div>

        {/* Days Table */}
        <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
          {DAYS_ORDER.map(({ key, label }) => {
            const dayConf = schedule[key];
            const isEnabled = dayConf.enabled;

            return (
              <div
                key={key}
                className={`p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 transition-colors ${
                  isEnabled ? "bg-white" : "bg-gray-50/70"
                }`}
              >
                {/* Day Name & Toggle */}
                <div className="flex items-center gap-3 w-40 shrink-0">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={() => handleDayToggle(key)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#1769E0]" />
                  </label>
                  <span
                    className={`text-sm font-semibold ${
                      isEnabled ? "text-gray-900" : "text-gray-400"
                    }`}
                  >
                    {label}
                  </span>
                </div>

                {/* Shifts Editor */}
                {isEnabled ? (
                  <div className="flex-1 flex flex-wrap items-center gap-3">
                    {dayConf.shifts.map((shift, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-1.5 bg-gray-50 px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs"
                      >
                        <span className="font-semibold text-gray-600">
                          {idx === 0 ? "Shift 1" : "Shift 2"}:
                        </span>
                        <input
                          type="time"
                          value={shift.start}
                          step="900"
                          onChange={(e) =>
                            handleShiftChange(key, idx, "start", e.target.value)
                          }
                          className="bg-white border border-gray-200 rounded px-1.5 py-0.5 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-[#1769E0]"
                        />
                        <span className="text-gray-400">to</span>
                        <input
                          type="time"
                          value={shift.end}
                          step="900"
                          onChange={(e) =>
                            handleShiftChange(key, idx, "end", e.target.value)
                          }
                          className="bg-white border border-gray-200 rounded px-1.5 py-0.5 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-[#1769E0]"
                        />
                        {dayConf.shifts.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveShift(key, idx)}
                            className="p-1 text-gray-400 hover:text-red-600 rounded transition-colors cursor-pointer"
                            title="Remove shift"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}

                    {dayConf.shifts.length < 2 && (
                      <button
                        type="button"
                        onClick={() => handleAddShift(key)}
                        className="px-2.5 py-1 text-xs font-semibold rounded-lg text-[#1769E0] bg-blue-50 hover:bg-blue-100 transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Evening Shift</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 text-xs font-medium text-gray-400 italic">
                    Closed / Day Off
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Blocked Times & Time-off Section */}
        <div className="pt-2 border-t border-gray-100 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                <Ban className="w-4 h-4 text-amber-600" />
                <span>Time-Off & Vacation Blocks</span>
              </h4>
              <p className="text-xs text-gray-500">
                Scheduled leaves, surgeries, or personal blocks that prevent appointments
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsBlockModalOpen(true)}
              className="text-xs h-8 px-3 rounded-lg border-gray-200 text-gray-700 hover:bg-gray-50 flex items-center gap-1.5 cursor-pointer"
            >
              <CalendarOff className="w-3.5 h-3.5 text-red-500" />
              <span>Block Time / Date</span>
            </Button>
          </div>

          {blocks.length === 0 ? (
            <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 text-center text-xs text-gray-500">
              No active time-off blocks. Doctor is available per weekly shifts.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {blocks.map((b) => {
                const sDate = new Date(b.start_time).toLocaleDateString("en-IN", {
                  month: "short",
                  day: "numeric",
                });
                const eDate = new Date(b.end_time).toLocaleDateString("en-IN", {
                  month: "short",
                  day: "numeric",
                });
                const sTime = new Date(b.start_time).toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                });
                const eTime = new Date(b.end_time).toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                });

                return (
                  <div
                    key={b.id}
                    className="p-3 rounded-xl bg-amber-50/70 border border-amber-200/80 flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-amber-950">
                          {b.all_day ? (sDate === eDate ? sDate : `${sDate} – ${eDate}`) : `${sDate}, ${sTime} – ${eTime}`}
                        </span>
                        {b.all_day && (
                          <Badge color="warning" size="sm" className="text-[10px] px-1.5 py-0">
                            Full Day
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-amber-800 mt-0.5">
                        {b.reason || "Doctor unavailable"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteBlock(b.id)}
                      className="p-1.5 text-amber-700 hover:text-red-700 rounded-lg hover:bg-amber-100/60 transition-colors cursor-pointer"
                      title="Remove block"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Standalone Save Button */}
        {standaloneSave && (
          <div className="flex justify-end pt-3 border-t border-gray-100">
            <Button
              type="button"
              onClick={handleSaveStandalone}
              disabled={isPending}
              className="h-10 px-5 rounded-xl bg-[#1769E0] text-white hover:bg-[#155cc0] font-semibold text-xs shadow-theme-xs cursor-pointer flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              <span>{isPending ? "Saving..." : "Save Availability Settings"}</span>
            </Button>
          </div>
        )}
      </CardContent>

      {/* Block Time Modal */}
      <BlockTimeModal
        isOpen={isBlockModalOpen}
        onClose={() => setIsBlockModalOpen(false)}
        doctorId={membership.user_id}
        doctorName={membership.full_name || undefined}
        onSuccess={(newBlock) => {
          setBlocks((prev) => [...prev, newBlock]);
        }}
      />
    </Card>
  );
}
