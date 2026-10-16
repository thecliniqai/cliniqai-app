"use client";

import React, { useState, useTransition, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DoctorTimeline, TimelineVisit, TimelineDoctor, SlotStatus } from "./doctor-timeline";
import { BookingDrawer } from "./booking-drawer";
import { WaitlistDrawer } from "./waitlist-drawer";
import { BlockTimeModal } from "./block-time-modal";
import { SoftBlockOverrideDialog } from "./soft-block-override-dialog";
import { Button } from "@/components/ui/button";
import { cancelVisit } from "@/features/visits/actions";
import { WaitlistEntryWithPatient } from "@/features/waitlist/actions";
import { ScheduleBlock } from "@/lib/db/types";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  UserPlus,
  Clock,
  CheckCircle2,
  UserCheck,
  Ban,
  Users,
} from "lucide-react";

export interface CalendarViewProps {
  doctors: TimelineDoctor[];
  visits: TimelineVisit[];
  waitlistEntries: WaitlistEntryWithPatient[];
  scheduleBlocks?: ScheduleBlock[];
  currentDate: string;
}

export function CalendarView({
  doctors,
  visits,
  waitlistEntries,
  scheduleBlocks = [],
  currentDate,
}: CalendarViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // Drawers and modals state
  const [isBookingOpen, setIsBookingOpen] = useState(false);
  const [isWaitlistOpen, setIsWaitlistOpen] = useState(false);
  const [isBlockTimeOpen, setIsBlockTimeOpen] = useState(false);

  // Doctor multi-selection filter pills
  const [selectedDoctorIds, setSelectedDoctorIds] = useState<string[]>(["all"]);

  // Selected slot for booking drawer
  const [bookingDoctorId, setBookingDoctorId] = useState<string | undefined>(undefined);
  const [bookingTime, setBookingTime] = useState<string>("09:00");
  const [bookingReason, setBookingReason] = useState<string>("");
  const [overrideOffDuty, setOverrideOffDuty] = useState(false);
  const [overrideBlock, setOverrideBlock] = useState(false);
  const [isOverbookedDefault, setIsOverbookedDefault] = useState(false);

  // Soft-block override dialog state
  const [softBlockState, setSoftBlockState] = useState<{
    isOpen: boolean;
    doctorId: string;
    doctorName: string;
    timeStr: string;
    isOffDuty?: boolean;
    isBlocked?: boolean;
    blockReason?: string;
  }>({
    isOpen: false,
    doctorId: "",
    doctorName: "",
    timeStr: "09:00",
  });

  // Auto-promotion notification state
  const [promotionNotice, setPromotionNotice] = useState<string | null>(null);

  // Filtered doctors based on selection
  const visibleDoctors = useMemo(() => {
    if (selectedDoctorIds.includes("all")) {
      return doctors;
    }
    return doctors.filter((doc) => selectedDoctorIds.includes(doc.id));
  }, [doctors, selectedDoctorIds]);

  const toggleDoctorFilter = (doctorId: string, event: React.MouseEvent) => {
    if (doctorId === "all") {
      setSelectedDoctorIds(["all"]);
      return;
    }

    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      // Multi-select toggle
      let next: string[];
      if (selectedDoctorIds.includes("all")) {
        next = [doctorId];
      } else if (selectedDoctorIds.includes(doctorId)) {
        next = selectedDoctorIds.filter((id) => id !== doctorId);
        if (next.length === 0) next = ["all"];
      } else {
        next = [...selectedDoctorIds, doctorId];
      }
      setSelectedDoctorIds(next);
    } else {
      // Single select toggle
      if (selectedDoctorIds.length === 1 && selectedDoctorIds[0] === doctorId) {
        setSelectedDoctorIds(["all"]);
      } else {
        setSelectedDoctorIds([doctorId]);
      }
    }
  };

  const navigateDate = (deltaDays: number) => {
    const current = new Date(currentDate);
    current.setDate(current.getDate() + deltaDays);
    const nextDate = current.toISOString().split("T")[0];

    const params = new URLSearchParams(searchParams.toString());
    params.set("date", nextDate);
    startTransition(() => {
      router.push(`/calendar?${params.toString()}`);
    });
  };

  const setToday = () => {
    const today = new Date().toISOString().split("T")[0];
    const params = new URLSearchParams(searchParams.toString());
    params.set("date", today);
    startTransition(() => {
      router.push(`/calendar?${params.toString()}`);
    });
  };

  const handleRefresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const handleSlotClick = (docId: string, timeStr: string, slotStatus?: SlotStatus) => {
    const doc = doctors.find((d) => d.id === docId);
    const docName = doc?.name || "Doctor";

    if (slotStatus?.isBlocked || slotStatus?.isOffDuty) {
      // Trigger soft-block override dialog
      setSoftBlockState({
        isOpen: true,
        doctorId: docId,
        doctorName: docName,
        timeStr: timeStr,
        isOffDuty: slotStatus.isOffDuty,
        isBlocked: slotStatus.isBlocked,
        blockReason: slotStatus.blockReason,
      });
      return;
    }

    // Normal slot booking
    setBookingDoctorId(docId);
    setBookingTime(timeStr);
    setBookingReason("");
    setOverrideOffDuty(false);
    setOverrideBlock(false);
    setIsOverbookedDefault(false);
    setIsBookingOpen(true);
  };

  const handleConfirmSoftBlockOverride = (emergencyNote: string) => {
    const { doctorId, timeStr, isOffDuty, isBlocked } = softBlockState;
    setSoftBlockState((prev) => ({ ...prev, isOpen: false }));

    setBookingDoctorId(doctorId);
    setBookingTime(timeStr);
    setBookingReason(`[EMERGENCY OVERRIDE] ${emergencyNote}`);
    setOverrideOffDuty(Boolean(isOffDuty));
    setOverrideBlock(Boolean(isBlocked));
    setIsOverbookedDefault(true);
    setIsBookingOpen(true);
  };

  const handleCancelVisit = async (visitId: string) => {
    if (!confirm("Are you sure you want to cancel this appointment?")) return;

    try {
      const res = await cancelVisit(visitId);
      if (res.success) {
        if (res.autoPromoted) {
          setPromotionNotice(
            "Appointment was cancelled. A waitlisted patient was automatically promoted into this vacated slot!"
          );
        }
        handleRefresh();
      } else {
        alert(res.error);
      }
    } catch {
      alert("Failed to cancel appointment.");
    }
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
      {/* Promotion Notification Banner */}
      {promotionNotice && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-emerald-900 text-sm shadow-xs animate-in fade-in">
          <div className="flex items-center gap-2.5 font-medium">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{promotionNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setPromotionNotice(null)}
            className="text-emerald-700 hover:text-emerald-900 font-semibold text-xs ml-4 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-gray-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Doctor Timeline & Calendar
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Multi-doctor day schedule with split shifts, schedule blocks, and emergency overrides.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsBlockTimeOpen(true)}
            className="flex items-center gap-1.5 font-semibold text-xs border-amber-200 text-amber-900 hover:bg-amber-50"
          >
            <Ban className="w-3.5 h-3.5 text-amber-600" />
            <span>+ Block Time</span>
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={() => setIsWaitlistOpen(true)}
            className="flex items-center gap-2 font-semibold text-xs"
          >
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            <span>+ Waitlist</span>
          </Button>

          <Button
            type="button"
            variant="primary"
            onClick={() => {
              setBookingDoctorId(undefined);
              setBookingTime("09:00");
              setBookingReason("");
              setOverrideOffDuty(false);
              setOverrideBlock(false);
              setIsOverbookedDefault(false);
              setIsBookingOpen(true);
            }}
            className="flex items-center gap-2 font-semibold text-xs shadow-theme-xs"
          >
            <UserPlus className="w-4 h-4" />
            <span>+ Book Appointment</span>
          </Button>
        </div>
      </div>

      {/* Date Switcher & Summary Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-3.5 rounded-2xl border border-gray-200 shadow-xs">
        {/* Date Navigator */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigateDate(-1)}
            aria-label="Previous Day"
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={setToday}
            className="px-4 min-h-[44px] flex items-center gap-2 text-sm font-semibold text-gray-900 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors cursor-pointer"
          >
            <Calendar className="w-4 h-4 text-[#1769E0]" />
            <span>{formatDisplayDate(currentDate)}</span>
          </button>

          <button
            type="button"
            onClick={() => navigateDate(1)}
            aria-label="Next Day"
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Waitlist Status Pill */}
        <div className="flex items-center gap-2">
          <div className="text-xs font-semibold px-3 py-1.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            <span>{waitlistEntries.length} on Waitlist for Today</span>
          </div>
        </div>
      </div>

      {/* Doctor Filter Pills */}
      {doctors.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs font-semibold text-gray-500 mr-1 flex items-center gap-1">
            <Users className="w-3.5 h-3.5" />
            Doctors:
          </span>

          {/* All Doctors Pill */}
          <button
            type="button"
            onClick={(e) => toggleDoctorFilter("all", e)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer border ${
              selectedDoctorIds.includes("all")
                ? "bg-[#1769E0] text-white border-[#1769E0] shadow-2xs"
                : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
            }`}
          >
            All Doctors ({doctors.length})
          </button>

          {/* Individual Doctor Pills */}
          {doctors.map((doc) => {
            const isSelected =
              !selectedDoctorIds.includes("all") && selectedDoctorIds.includes(doc.id);

            return (
              <button
                key={doc.id}
                type="button"
                onClick={(e) => toggleDoctorFilter(doc.id, e)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer border ${
                  isSelected
                    ? "bg-[#1769E0] text-white border-[#1769E0] font-semibold shadow-2xs"
                    : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                }`}
                title={doc.specialty ? `${doc.name} (${doc.specialty})` : doc.name}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isSelected ? "bg-white" : "bg-emerald-500"
                  }`}
                />
                <span>{doc.name}</span>
                {doc.specialty && (
                  <span
                    className={`text-[10px] ${
                      isSelected ? "text-blue-100" : "text-gray-400"
                    }`}
                  >
                    • {doc.specialty}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Waitlist Mini-Strip if entries exist */}
      {waitlistEntries.length > 0 && (
        <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 shadow-2xs">
          <div className="font-bold flex items-center gap-1.5 mb-2 text-amber-950">
            <UserCheck className="w-4 h-4 text-amber-700" />
            <span>Eligible for Auto-Promotion on Cancellation:</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {waitlistEntries.map((e) => (
              <span
                key={e.id}
                className="inline-flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-lg border border-amber-200 text-amber-950 font-medium shadow-2xs"
              >
                <span>{e.patient?.full_name || "Patient"}</span>
                {e.priority > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 rounded text-amber-800 font-bold">
                    P{e.priority}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Main Multi-Doctor Schedule Timeline */}
      <DoctorTimeline
        doctors={visibleDoctors}
        visits={visits}
        scheduleBlocks={scheduleBlocks}
        currentDate={currentDate}
        onSlotClick={handleSlotClick}
        onCancelVisit={handleCancelVisit}
      />

      {/* Booking Drawer */}
      <BookingDrawer
        isOpen={isBookingOpen}
        onClose={() => setIsBookingOpen(false)}
        onSuccess={() => {
          setIsBookingOpen(false);
          handleRefresh();
        }}
        doctors={doctors}
        defaultDoctorId={bookingDoctorId}
        defaultDate={currentDate}
        defaultTime={bookingTime}
        defaultReason={bookingReason}
        overrideOffDuty={overrideOffDuty}
        overrideBlock={overrideBlock}
        isOverbookedDefault={isOverbookedDefault}
      />

      {/* Waitlist Drawer */}
      <WaitlistDrawer
        isOpen={isWaitlistOpen}
        onClose={() => setIsWaitlistOpen(false)}
        onSuccess={() => {
          setIsWaitlistOpen(false);
          handleRefresh();
        }}
        doctors={doctors}
        defaultDate={currentDate}
      />

      {/* Block Time Modal */}
      <BlockTimeModal
        isOpen={isBlockTimeOpen}
        onClose={() => setIsBlockTimeOpen(false)}
        onSuccess={() => {
          setIsBlockTimeOpen(false);
          handleRefresh();
        }}
        doctors={doctors}
        initialDate={currentDate}
      />

      {/* Soft-Block Emergency Override Dialog */}
      <SoftBlockOverrideDialog
        isOpen={softBlockState.isOpen}
        onClose={() => setSoftBlockState((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={handleConfirmSoftBlockOverride}
        doctorName={softBlockState.doctorName}
        timeStr={softBlockState.timeStr}
        isOffDuty={softBlockState.isOffDuty}
        isBlocked={softBlockState.isBlocked}
        blockReason={softBlockState.blockReason}
      />
    </div>
  );
}
