"use client";

import React, { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { QueueCard, QueueItem } from "./queue-card";
import { WalkInDrawer, DoctorOption } from "./walk-in-drawer";
import { Button } from "@/components/ui/button";
import { UserPlus, Calendar, ChevronLeft, ChevronRight, Users, Clock, Stethoscope, CheckCircle2 } from "lucide-react";

interface QueueViewProps {
  initialItems: QueueItem[];
  currentDate: string;
  doctors: DoctorOption[];
  selectedDoctorId?: string;
}

export function QueueView({
  initialItems,
  currentDate,
  doctors,
  selectedDoctorId = "all",
}: QueueViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const [isWalkInOpen, setIsWalkInOpen] = useState(false);
  const [doctorFilter, setDoctorFilter] = useState(selectedDoctorId);

  // Compute stats
  const totalCount = initialItems.length;
  const waitingCount = initialItems.filter((i) => i.visit.status === "waiting").length;
  const inConsultCount = initialItems.filter((i) => i.visit.status === "in_consultation").length;
  const completedCount = initialItems.filter((i) => i.visit.status === "completed").length;

  // Filter items by doctor if selected
  const filteredItems = doctorFilter === "all"
    ? initialItems
    : initialItems.filter((i) => i.visit.doctor_id === doctorFilter);

  const navigateDate = (deltaDays: number) => {
    const current = new Date(currentDate);
    current.setDate(current.getDate() + deltaDays);
    const nextDate = current.toISOString().split("T")[0];
    
    const params = new URLSearchParams(searchParams.toString());
    params.set("date", nextDate);
    if (doctorFilter !== "all") {
      params.set("doctor", doctorFilter);
    }
    startTransition(() => {
      router.push(`/queue?${params.toString()}`);
    });
  };

  const setToday = () => {
    const today = new Date().toISOString().split("T")[0];
    const params = new URLSearchParams(searchParams.toString());
    params.set("date", today);
    if (doctorFilter !== "all") {
      params.set("doctor", doctorFilter);
    }
    startTransition(() => {
      router.push(`/queue?${params.toString()}`);
    });
  };

  const handleDoctorChange = (docId: string) => {
    setDoctorFilter(docId);
    const params = new URLSearchParams(searchParams.toString());
    if (docId === "all") {
      params.delete("doctor");
    } else {
      params.set("doctor", docId);
    }
    startTransition(() => {
      router.push(`/queue?${params.toString()}`);
    });
  };

  const handleRefresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const formatDisplayDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    const today = new Date().toISOString().split("T")[0];
    const isToday = dateStr === today;

    const formatted = d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

    return isToday ? `Today (${formatted})` : formatted;
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[var(--border-default)]">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            Live Reception Queue
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5">
            Real-time patient flow, token numbers, and clinical consult progression.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="primary"
            onClick={() => setIsWalkInOpen(true)}
            className="flex items-center gap-2 shadow-sm font-semibold"
          >
            <UserPlus className="w-4 h-4" />
            <span>+ Add Walk-In</span>
          </Button>
        </div>
      </div>

      {/* Date & Doctor Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[var(--surface-primary)] p-3 rounded-lg border border-[var(--border-default)]">
        {/* Date Switcher */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigateDate(-1)}
            aria-label="Previous Day"
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={setToday}
            className="px-3 min-h-[44px] flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)] rounded-md border border-[var(--border-default)] hover:bg-[var(--surface-subtle)] transition-colors"
          >
            <Calendar className="w-4 h-4 text-[var(--brand-primary)]" />
            <span>{formatDisplayDate(currentDate)}</span>
          </button>

          <button
            type="button"
            onClick={() => navigateDate(1)}
            aria-label="Next Day"
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)] transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Doctor Filter Dropdown */}
        <div className="flex items-center gap-2">
          <label htmlFor="doctor-filter" className="text-xs font-medium text-[var(--text-secondary)] whitespace-nowrap">
            Filter by Doctor:
          </label>
          <select
            id="doctor-filter"
            value={doctorFilter}
            onChange={(e) => handleDoctorChange(e.target.value)}
            className="h-11 px-3 text-sm rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
          >
            <option value="all">All Doctors ({initialItems.length})</option>
            {doctors.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* High-Density Stats Counters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-[var(--surface-primary)] p-4 rounded-lg border border-[var(--border-default)] flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
              Total Today
            </div>
            <div className="text-2xl font-bold text-[var(--text-primary)] mt-1">
              {totalCount}
            </div>
          </div>
          <div className="w-10 h-10 rounded-full bg-[var(--surface-subtle)] flex items-center justify-center text-[var(--text-secondary)]">
            <Users className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-[var(--surface-primary)] p-4 rounded-lg border border-[var(--border-default)] flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-[var(--status-warning-text)] uppercase tracking-wider">
              Waiting in Queue
            </div>
            <div className="text-2xl font-bold text-[var(--status-warning-text)] mt-1">
              {waitingCount}
            </div>
          </div>
          <div className="w-10 h-10 rounded-full bg-[var(--status-warning-bg)] border border-[var(--status-warning-border)] flex items-center justify-center text-[var(--status-warning-text)]">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-[var(--surface-primary)] p-4 rounded-lg border border-[var(--border-default)] flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-emerald-700 uppercase tracking-wider">
              With Doctor
            </div>
            <div className="text-2xl font-bold text-emerald-700 mt-1">
              {inConsultCount}
            </div>
          </div>
          <div className="w-10 h-10 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
            <Stethoscope className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-[var(--surface-primary)] p-4 rounded-lg border border-[var(--border-default)] flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
              Completed
            </div>
            <div className="text-2xl font-bold text-[var(--text-primary)] mt-1">
              {completedCount}
            </div>
          </div>
          <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Main Queue Feed */}
      <div className="space-y-3">
        {filteredItems.length === 0 ? (
          <div className="bg-[var(--surface-primary)] border border-[var(--border-default)] border-dashed rounded-lg p-12 text-center">
            <div className="w-14 h-14 mx-auto rounded-full bg-[var(--surface-subtle)] flex items-center justify-center text-[var(--text-muted)] mb-4">
              <Users className="w-7 h-7" />
            </div>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">
              No patients in queue for {formatDisplayDate(currentDate)}
            </h3>
            <p className="text-sm text-[var(--text-secondary)] max-w-md mx-auto mt-1 mb-6">
              There are currently no scheduled appointments or waiting walk-in patients.
              Add a walk-in patient or check in an appointment to begin.
            </p>
            <Button
              type="button"
              variant="primary"
              onClick={() => setIsWalkInOpen(true)}
              className="inline-flex items-center gap-2"
            >
              <UserPlus className="w-4 h-4" />
              <span>Add Walk-In Patient</span>
            </Button>
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredItems.map((item) => (
              <QueueCard
                key={item.visit.id}
                item={item}
                onRefresh={handleRefresh}
              />
            ))}
          </div>
        )}
      </div>

      {/* Walk-in Drawer */}
      <WalkInDrawer
        isOpen={isWalkInOpen}
        onClose={() => setIsWalkInOpen(false)}
        onSuccess={() => {
          setIsWalkInOpen(false);
          handleRefresh();
        }}
        doctors={doctors}
      />
    </div>
  );
}
