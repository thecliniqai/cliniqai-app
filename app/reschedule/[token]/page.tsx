"use client";

import React, { useState, useEffect } from "react";
import {
  Calendar,
  Clock,
  User,
  CheckCircle2,
  AlertCircle,
  Building2,
  Phone,
  ChevronRight,
  ArrowRight,
} from "lucide-react";

interface ReschedulePageProps {
  params: Promise<{ token: string }>;
}

interface AppointmentDetails {
  id: string;
  patient_name: string;
  doctor_name: string;
  doctor_specialty: string;
  current_scheduled_at: string;
  clinic: {
    name: string;
    phone: string | null;
    address: string | null;
  };
}

export default function PublicReschedulePage({ params }: ReschedulePageProps) {
  const [token, setToken] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [appointment, setAppointment] = useState<AppointmentDetails | null>(null);
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [confirmedNewTime, setConfirmedNewTime] = useState<string | null>(null);

  useEffect(() => {
    params.then((p) => {
      setToken(p.token);
      loadSlots(p.token);
    });
  }, [params]);

  const loadSlots = async (tok: string, date?: string) => {
    try {
      setLoading(true);
      setError(null);
      const url = `/api/reschedule/${tok}${date ? `?date=${date}` : ""}`;
      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || "Unable to load appointment details.");
        return;
      }

      setAppointment(data.appointment);
      setAvailableSlots(data.available_slots || []);
      setSelectedDate(data.selected_date);
    } catch {
      setError("Failed to connect to the clinic server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = (dateStr: string) => {
    setSelectedSlot(null);
    setSelectedDate(dateStr);
    if (token) {
      loadSlots(token, dateStr);
    }
  };

  const handleConfirmReschedule = async () => {
    if (!selectedSlot || !token) return;

    try {
      setSubmitting(true);
      setError(null);

      const res = await fetch(`/api/reschedule/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newScheduledAt: selectedSlot }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || "Failed to confirm reschedule.");
        return;
      }

      setConfirmedNewTime(data.new_scheduled_at || selectedSlot);
    } catch {
      setError("An unexpected network error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Generate next 5 days for date selector
  const dateOptions = Array.from({ length: 5 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i + 1);
    return {
      isoDate: d.toISOString().split("T")[0],
      displayDay: d.toLocaleDateString("en-IN", { weekday: "short" }),
      displayDate: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
    };
  });

  const formatSlotTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata",
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F7F6F3] flex items-center justify-center p-4">
        <div className="max-w-[480px] w-full bg-white rounded-xl border border-[#E5E7EB] p-8 text-center space-y-3 shadow-xs">
          <div className="w-8 h-8 border-3 border-[#1769E0] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-[#4B5563] font-medium">Loading appointment options...</p>
        </div>
      </div>
    );
  }

  if (error && !appointment) {
    return (
      <div className="min-h-screen bg-[#F7F6F3] flex items-center justify-center p-4">
        <div className="max-w-[480px] w-full bg-white rounded-xl border border-amber-200 bg-amber-50/50 p-6 text-center shadow-xs">
          <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-semibold text-amber-950 mb-2">Unable to Reschedule</h1>
          <p className="text-sm text-amber-900 leading-relaxed mb-4">{error}</p>
        </div>
      </div>
    );
  }

  if (confirmedNewTime && appointment) {
    return (
      <div className="min-h-screen bg-[#F7F6F3] flex items-center justify-center p-4">
        <div className="max-w-[480px] w-full bg-white rounded-xl border border-[#E5E7EB] p-6 text-center space-y-5 shadow-xs">
          <div className="w-14 h-14 rounded-full bg-emerald-50 text-[#16A34A] flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8" />
          </div>

          <div>
            <h1 className="text-xl font-bold text-[#111827]">Appointment Rescheduled</h1>
            <p className="text-xs text-[#6B7280] mt-1">We have updated your consultation time.</p>
          </div>

          <div className="bg-[#F9FAFB] rounded-lg p-4 border border-[#E5E7EB] text-left space-y-2">
            <div className="flex items-center gap-2 text-xs text-[#4B5563]">
              <User className="w-4 h-4 text-[#1769E0]" />
              <span>Doctor: <strong className="font-semibold text-[#111827]">Dr. {appointment.doctor_name}</strong></span>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#4B5563]">
              <Calendar className="w-4 h-4 text-[#1769E0]" />
              <span>
                New Time: <strong className="font-semibold text-[#16A34A]">
                  {new Date(confirmedNewTime).toLocaleString("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Kolkata",
                  })}
                </strong>
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#4B5563]">
              <Building2 className="w-4 h-4 text-[#1769E0]" />
              <span>{appointment.clinic.name}</span>
            </div>
          </div>

          <p className="text-xs text-[#4B5563]">
            A confirmation message has been queued to your WhatsApp number.
          </p>

          {appointment.clinic.phone && (
            <a
              href={`tel:${appointment.clinic.phone}`}
              className="inline-flex items-center justify-center gap-2 w-full h-11 rounded-lg border border-gray-200 text-xs font-semibold text-[#111827] hover:bg-gray-50 transition-colors"
            >
              <Phone className="w-3.5 h-3.5 text-[#1769E0]" />
              Call Clinic Desk
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F6F3] py-8 px-4">
      <main className="max-w-[480px] w-full mx-auto space-y-4">
        {/* Clinic & Doctor Header */}
        <header className="bg-white rounded-xl border border-[#E5E7EB] p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-5 h-5 text-[#1769E0]" />
                <h1 className="text-base font-bold text-[#111827]">{appointment?.clinic.name}</h1>
              </div>
              <p className="text-xs text-[#4B5563]">
                Doctor: <strong className="font-semibold text-[#111827]">Dr. {appointment?.doctor_name}</strong> ({appointment?.doctor_specialty})
              </p>
            </div>
            {appointment?.clinic.phone && (
              <a
                href={`tel:${appointment.clinic.phone}`}
                className="shrink-0 p-2 rounded-lg bg-gray-50 border border-gray-200 text-[#1769E0] hover:bg-gray-100"
                title="Call Clinic"
              >
                <Phone className="w-4 h-4" />
              </a>
            )}
          </div>
        </header>

        {/* Current Scheduled Time Note */}
        {appointment?.current_scheduled_at && (
          <div className="bg-white rounded-xl border border-[#E5E7EB] p-4 text-xs text-[#4B5563] shadow-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600" />
              <span>Current Time:</span>
            </div>
            <span className="font-semibold text-[#111827]">
              {new Date(appointment.current_scheduled_at).toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Asia/Kolkata",
              })}
            </span>
          </div>
        )}

        {/* Step 1: Select Date */}
        <section className="bg-white rounded-xl border border-[#E5E7EB] p-5 shadow-xs space-y-3">
          <h2 className="text-sm font-semibold text-[#111827] flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#1769E0]" />
            1. Select Date
          </h2>

          <div className="grid grid-cols-5 gap-2">
            {dateOptions.map((opt) => {
              const isSelected = selectedDate === opt.isoDate;
              return (
                <button
                  key={opt.isoDate}
                  type="button"
                  onClick={() => handleDateChange(opt.isoDate)}
                  className={`p-2.5 rounded-lg border text-center transition-all min-h-[58px] flex flex-col items-center justify-center ${
                    isSelected
                      ? "bg-[#1769E0] text-white border-[#1769E0] shadow-xs"
                      : "bg-gray-50 text-[#4B5563] border-gray-200 hover:bg-gray-100"
                  }`}
                >
                  <span className={`text-[10px] uppercase font-bold ${isSelected ? "text-blue-100" : "text-[#6B7280]"}`}>
                    {opt.displayDay}
                  </span>
                  <span className="text-xs font-semibold mt-0.5">{opt.displayDate}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Step 2: Select Slot */}
        <section className="bg-white rounded-xl border border-[#E5E7EB] p-5 shadow-xs space-y-3">
          <h2 className="text-sm font-semibold text-[#111827] flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#1769E0]" />
            2. Available Times
          </h2>

          {availableSlots.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#6B7280] bg-gray-50 rounded-lg border border-dashed border-gray-200">
              No available slots for this date. Please pick another day or call the clinic.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {availableSlots.map((slot) => {
                const isSelected = selectedSlot === slot;
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setSelectedSlot(slot)}
                    className={`h-11 px-3 rounded-lg border text-xs font-semibold transition-all ${
                      isSelected
                        ? "bg-[#1769E0] text-white border-[#1769E0] shadow-xs"
                        : "bg-gray-50 text-[#111827] border-gray-200 hover:bg-blue-50 hover:border-blue-200"
                    }`}
                  >
                    {formatSlotTime(slot)}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Step 3: Confirmation Button */}
        <button
          type="button"
          disabled={!selectedSlot || submitting}
          onClick={handleConfirmReschedule}
          className="w-full h-12 rounded-lg bg-[#1769E0] text-white font-semibold text-sm hover:bg-[#0F5AB8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-xs"
        >
          {submitting ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Confirming New Time...</span>
            </>
          ) : (
            <>
              <span>Confirm New Appointment Time</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </main>
    </div>
  );
}
