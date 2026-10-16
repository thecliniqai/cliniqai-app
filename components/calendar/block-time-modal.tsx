"use client";

import React, { useState, useTransition } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Clock, Calendar, AlertCircle, Ban } from "lucide-react";
import { createScheduleBlock } from "@/features/visits/scheduling";
import { ScheduleBlock } from "@/lib/db/types";

export interface BlockTimeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (newBlock: ScheduleBlock) => void;
  doctorId?: string;
  doctorName?: string;
  doctors?: { id: string; name: string }[];
  initialDate?: string;
}

export function BlockTimeModal({
  isOpen,
  onClose,
  onSuccess,
  doctorId,
  doctorName,
  doctors = [],
  initialDate,
}: BlockTimeModalProps) {
  const [isPending, startTransition] = useTransition();

  const todayStr = initialDate || new Date().toISOString().split("T")[0];

  const [mode, setMode] = useState<"time" | "day" | "range">("time");
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(doctorId || (doctors[0]?.id || ""));
  const [date, setDate] = useState<string>(todayStr);
  const [startTime, setStartTime] = useState<string>("14:00");
  const [endTime, setEndTime] = useState<string>("17:00");
  const [startDate, setStartDate] = useState<string>(todayStr);
  const [endDate, setEndDate] = useState<string>(todayStr);
  const [reason, setReason] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const reasonPresets = [
    "Surgery",
    "On Leave / Vacation",
    "Personal Break",
    "Medical Conference / CME",
    "Clinic Maintenance",
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let startIso: string;
    let endIso: string;
    let isAllDay = false;

    if (mode === "time") {
      if (startTime >= endTime) {
        setError("End time must be after start time.");
        return;
      }
      // Combine date and time into ISO strings in local clinic timezone (+05:30)
      startIso = `${date}T${startTime}:00+05:30`;
      endIso = `${date}T${endTime}:00+05:30`;
    } else if (mode === "day") {
      isAllDay = true;
      startIso = `${date}T00:00:00+05:30`;
      endIso = `${date}T23:59:59+05:30`;
    } else {
      // range
      if (startDate > endDate) {
        setError("End date must be on or after start date.");
        return;
      }
      isAllDay = true;
      startIso = `${startDate}T00:00:00+05:30`;
      endIso = `${endDate}T23:59:59+05:30`;
    }

    startTransition(async () => {
      const targetDoctor = selectedDoctorId === "clinic" || !selectedDoctorId ? null : selectedDoctorId;
      const res = await createScheduleBlock({
        doctor_id: targetDoctor,
        start_time: startIso,
        end_time: endIso,
        reason: reason.trim() || (isAllDay ? "Day Off / Leave" : "Blocked Time"),
        all_day: isAllDay,
      });

      if (!res.success) {
        setError(res.error || "Failed to block time.");
        return;
      }

      if (onSuccess && res.block) {
        onSuccess(res.block);
      }
      onClose();
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Block Doctor Time / Date"
      description="Prevent appointment bookings during leaves, breaks, or surgeries"
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        {/* Doctor Selection if admin or multiple doctors available */}
        {doctors.length > 1 && (
          <Field label="Doctor / Scope" htmlFor="block-doctor-select">
            <select
              id="block-doctor-select"
              value={selectedDoctorId}
              onChange={(e) => setSelectedDoctorId(e.target.value)}
              className="w-full h-10 px-3.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1769E0]/20 focus:border-[#1769E0]"
            >
              {doctors.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.name}
                </option>
              ))}
              <option value="clinic">Entire Clinic (All Doctors)</option>
            </select>
          </Field>
        )}

        {/* Mode Selector */}
        <div className="grid grid-cols-3 gap-2 p-1 bg-gray-100 rounded-xl">
          <button
            type="button"
            onClick={() => setMode("time")}
            className={`py-2 px-3 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
              mode === "time"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Time Window</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("day")}
            className={`py-2 px-3 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
              mode === "day"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Full Day</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("range")}
            className={`py-2 px-3 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
              mode === "range"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <Ban className="w-3.5 h-3.5" />
            <span>Date Range</span>
          </button>
        </div>

        {/* Time Window Mode Inputs */}
        {mode === "time" && (
          <div className="space-y-3">
            <Field label="Date" htmlFor="block-time-date">
              <Input
                id="block-time-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start Time" htmlFor="block-start-time">
                <Input
                  id="block-start-time"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  step="900"
                  required
                />
              </Field>
              <Field label="End Time" htmlFor="block-end-time">
                <Input
                  id="block-end-time"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  step="900"
                  required
                />
              </Field>
            </div>
          </div>
        )}

        {/* Full Day Mode */}
        {mode === "day" && (
          <Field label="Day to Block" htmlFor="block-day-date">
            <Input
              id="block-day-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </Field>
        )}

        {/* Date Range Mode */}
        {mode === "range" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start Date" htmlFor="block-range-start">
              <Input
                id="block-range-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </Field>
            <Field label="End Date" htmlFor="block-range-end">
              <Input
                id="block-range-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </Field>
          </div>
        )}

        {/* Reason Field & Quick Presets */}
        <div className="space-y-1.5">
          <Field label="Reason (Optional)" htmlFor="block-reason">
            <Input
              id="block-reason"
              type="text"
              placeholder="e.g. In Operation Theatre, Vacation, CME"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {reasonPresets.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setReason(preset)}
                className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors cursor-pointer"
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isPending}
            className="bg-red-600 hover:bg-red-700 text-white font-medium"
          >
            {isPending ? "Blocking Time..." : "Confirm Block"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
