"use client";

import React, { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { QueueCard, QueueItem } from "./queue-card";
import { WalkInDrawer, DoctorOption } from "./walk-in-drawer";
import { CheckoutDrawer } from "./checkout-drawer";
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
  const [checkoutItem, setCheckoutItem] = useState<QueueItem | null>(null);
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-gray-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Live Reception Queue
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Real-time patient flow, token numbers, and clinical consult progression.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="primary"
            onClick={() => setIsWalkInOpen(true)}
            className="flex items-center gap-2 font-semibold shadow-theme-xs"
          >
            <UserPlus className="w-4 h-4" />
            <span>+ Add Walk-In</span>
          </Button>
        </div>
      </div>

      {/* Date & Doctor Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-3.5 rounded-2xl border border-gray-200 shadow-xs">
        {/* Date Switcher */}
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

        {/* Doctor Filter Dropdown */}
        <div className="flex items-center gap-2.5">
          <label htmlFor="doctor-filter" className="text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
            Doctor:
          </label>
          <select
            id="doctor-filter"
            value={doctorFilter}
            onChange={(e) => handleDoctorChange(e.target.value)}
            className="h-11 px-3.5 text-sm rounded-lg border border-gray-300 bg-white text-gray-900 shadow-theme-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Today */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Total Today
            </div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {totalCount}
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-500">
            <Users className="w-5 h-5" />
          </div>
        </div>

        {/* Waiting */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-amber-700 uppercase tracking-wider">
              Waiting in Queue
            </div>
            <div className="text-2xl font-bold text-amber-600 mt-1">
              {waitingCount}
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        {/* With Doctor */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-brand-700 uppercase tracking-wider">
              With Doctor
            </div>
            <div className="text-2xl font-bold text-brand-600 mt-1">
              {inConsultCount}
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-brand-50 border border-brand-200 flex items-center justify-center text-brand-600">
            <Stethoscope className="w-5 h-5" />
          </div>
        </div>

        {/* Completed */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">
              Completed
            </div>
            <div className="text-2xl font-bold text-emerald-600 mt-1">
              {completedCount}
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Main Queue Feed */}
      <div className="space-y-3">
        {filteredItems.length === 0 ? (
          <div className="bg-white border border-gray-200 border-dashed rounded-2xl p-12 text-center shadow-xs">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-400 mb-4">
              <Users className="w-7 h-7" />
            </div>
            <h3 className="text-base font-semibold text-gray-900">
              No patients in queue for {formatDisplayDate(currentDate)}
            </h3>
            <p className="text-sm text-gray-500 max-w-md mx-auto mt-1 mb-6">
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
                onCheckout={(it) => setCheckoutItem(it)}
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

      {/* Reception Checkout Drawer */}
      <CheckoutDrawer
        isOpen={Boolean(checkoutItem)}
        onClose={() => setCheckoutItem(null)}
        onSuccess={() => {
          handleRefresh();
        }}
        queueItem={checkoutItem}
      />
    </div>
  );
}
