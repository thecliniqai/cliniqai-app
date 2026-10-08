"use client";

import React, { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DoctorTimeline, TimelineVisit } from "./doctor-timeline";
import { BookingDrawer } from "./booking-drawer";
import { WaitlistDrawer } from "./waitlist-drawer";
import { Button } from "@/components/ui/button";
import { cancelVisit } from "@/features/visits/actions";
import { WaitlistEntryWithPatient } from "@/features/waitlist/actions";
import { Calendar, ChevronLeft, ChevronRight, UserPlus, Clock, CheckCircle2, UserCheck } from "lucide-react";

export interface CalendarViewProps {
  doctors: Array<{ id: string; name: string }>;
  visits: TimelineVisit[];
  waitlistEntries: WaitlistEntryWithPatient[];
  currentDate: string;
}

export function CalendarView({
  doctors,
  visits,
  waitlistEntries,
  currentDate,
}: CalendarViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // Drawers state
  const [isBookingOpen, setIsBookingOpen] = useState(false);
  const [isWaitlistOpen, setIsWaitlistOpen] = useState(false);

  // Selected slot for booking drawer
  const [bookingDoctorId, setBookingDoctorId] = useState<string | undefined>(undefined);
  const [bookingTime, setBookingTime] = useState<string>("09:00");

  // Auto-promotion notification state
  const [promotionNotice, setPromotionNotice] = useState<string | null>(null);

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

  const handleSlotClick = (docId: string, timeStr: string) => {
    setBookingDoctorId(docId);
    setBookingTime(timeStr);
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
            Multi-doctor day schedule with double-booking safeguards and waitlist promotion.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setIsWaitlistOpen(true)}
            className="flex items-center gap-2 font-semibold"
          >
            <Clock className="w-4 h-4 text-amber-600" />
            <span>+ Waitlist</span>
          </Button>

          <Button
            type="button"
            variant="primary"
            onClick={() => {
              setBookingDoctorId(undefined);
              setBookingTime("09:00");
              setIsBookingOpen(true);
            }}
            className="flex items-center gap-2 font-semibold shadow-theme-xs"
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
            <Calendar className="w-4 h-4 text-brand-500" />
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

      {/* Waitlist Mini-Strip if entries exist */}
      {waitlistEntries.length > 0 && (
        <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 shadow-2xs">
          <div className="font-bold flex items-center gap-1.5 mb-2 text-amber-950">
            <UserCheck className="w-4 h-4 text-amber-700" />
            <span>Eligible for Auto-Promotion on Cancellation (D-08):</span>
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
        doctors={doctors}
        visits={visits}
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
    </div>
  );
}
