"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Field } from "@/components/ui/field";
import { AgeDobInput } from "@/components/patients/age-dob-input";
import { createPatient, searchPatients } from "@/features/patients/actions";
import { bookAppointment } from "@/features/visits/scheduling";
import { OverbookDialog } from "./overbook-dialog";
import { X, Search, UserPlus, UserCheck, Calendar, Clock } from "lucide-react";
import { Patient, Visit } from "@/lib/db/types";

export interface BookingDrawerDoctor {
  id: string;
  name: string;
  specialty?: string | null;
  default_slot_duration_minutes?: number | null;
}

export interface BookingDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  doctors: BookingDrawerDoctor[];
  defaultDoctorId?: string;
  defaultDate?: string;
  defaultTime?: string;
  defaultReason?: string;
  overrideOffDuty?: boolean;
  overrideBlock?: boolean;
  isOverbookedDefault?: boolean;
}

export function BookingDrawer({
  isOpen,
  onClose,
  onSuccess,
  doctors,
  defaultDoctorId,
  defaultDate,
  defaultTime = "09:00",
  defaultReason = "",
  overrideOffDuty = false,
  overrideBlock = false,
  isOverbookedDefault = false,
}: BookingDrawerProps) {
  const [tab, setTab] = useState<"search" | "new">("search");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form Fields
  const [doctorId, setDoctorId] = useState(defaultDoctorId || doctors[0]?.id || "");
  const [date, setDate] = useState(defaultDate || new Date().toISOString().split("T")[0]);
  const [time, setTime] = useState(defaultTime);
  const [duration, setDuration] = useState(15);
  const [reason, setReason] = useState(defaultReason);

  // Patient Search & Selection
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Patient[]>([]);
  const [chosenPatient, setChosenPatient] = useState<Patient | null>(null);

  // New Patient Form
  const [newPatient, setNewPatient] = useState({
    full_name: "",
    phone: "",
    age: null as number | null,
    date_of_birth: null as string | null,
  });

  // Overbook Dialog State
  const [overbookOpen, setOverbookOpen] = useState(false);
  const [conflictingVisit, setConflictingVisit] = useState<Visit | null>(null);

  const resetPatientState = () => {
    setTab("search");
    setSearchQuery("");
    setSearchResults([]);
    setChosenPatient(null);
    setNewPatient({
      full_name: "",
      phone: "",
      age: null,
      date_of_birth: null,
    });
    setError(null);
    setConflictingVisit(null);
    setOverbookOpen(false);
  };

  useEffect(() => {
    if (isOpen) {
      resetPatientState();
    }
  }, [isOpen]);

  useEffect(() => {
    if (defaultDoctorId) setDoctorId(defaultDoctorId);
    if (defaultDate) setDate(defaultDate);
    if (defaultTime) setTime(defaultTime);
    if (defaultReason) setReason(defaultReason);
  }, [defaultDoctorId, defaultDate, defaultTime, defaultReason, isOpen]);

  // Auto-set duration based on doctor default slot duration
  useEffect(() => {
    if (doctorId && doctors.length > 0) {
      const doc = doctors.find((d) => d.id === doctorId);
      if (doc?.default_slot_duration_minutes) {
        setDuration(doc.default_slot_duration_minutes);
      }
    }
  }, [doctorId, doctors]);

  // Debounced Patient Search
  useEffect(() => {
    if (tab !== "search") return;
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const matches = await searchPatients(searchQuery);
        setSearchResults(matches);
      } catch (err) {
        console.error("Patient search failed:", err);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [searchQuery, tab]);

  if (!isOpen) return null;

  const handleBook = async (isOverbooked: boolean = false) => {
    setLoading(true);
    setError(null);

    try {
      let patientIdToBook = chosenPatient?.id;

      // 1. If new patient tab, create patient first
      if (tab === "new") {
        if (!newPatient.full_name || !newPatient.phone) {
          setError("Patient full name and phone number are required.");
          setLoading(false);
          return;
        }

        const patientRes = await createPatient({
          full_name: newPatient.full_name,
          phone: newPatient.phone,
          age: newPatient.age,
          date_of_birth: newPatient.date_of_birth || null,
          abha_id: null,
        });

        if (!patientRes.success) {
          setError(patientRes.error);
          setLoading(false);
          return;
        }
        patientIdToBook = patientRes.patientId;
      }

      if (!patientIdToBook) {
        setError("Please select or register a patient.");
        setLoading(false);
        return;
      }

      if (!doctorId) {
        setError("Please assign a doctor.");
        setLoading(false);
        return;
      }

      // 2. Compute ISO datetime
      const scheduledIso = new Date(`${date}T${time}:00`).toISOString();

      // 3. Book appointment
      const result = await bookAppointment({
        patient_id: patientIdToBook,
        doctor_id: doctorId,
        scheduled_at: scheduledIso,
        estimated_duration_minutes: duration,
        reason_for_visit: reason || null,
        is_overbooked: isOverbooked || isOverbookedDefault,
        override_off_duty: overrideOffDuty,
        override_block: overrideBlock,
      });

      if (!result.success) {
        if (result.conflict) {
          setConflictingVisit(result.conflictingVisit || null);
          setOverbookOpen(true);
          setLoading(false);
          return;
        }
        setError(result.error);
        setLoading(false);
        return;
      }

      // Success
      setOverbookOpen(false);
      resetPatientState();
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to book appointment.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-gray-900/50 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-drawer-title"
        className="fixed inset-y-0 right-0 z-40 w-full max-w-lg bg-white border-l border-gray-200 shadow-2xl flex flex-col"
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center text-brand-500 border border-brand-100">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h2 id="booking-drawer-title" className="text-base font-bold text-gray-900">
                Schedule Appointment
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Reserve time slot and assign to doctor schedule
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-start gap-2">
              <span className="font-semibold">{error}</span>
            </div>
          )}

          {/* Slot Info Card */}
          <div className="bg-gray-50/70 p-4 rounded-xl border border-gray-200 space-y-3.5">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Slot & Assignment
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Appointment Date" htmlFor="appt-date" required>
                <Input
                  id="appt-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </Field>

              <Field label="Start Time" htmlFor="appt-time" required>
                <div className="relative">
                  <Input
                    id="appt-time"
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    required
                  />
                  <Clock className="w-4 h-4 text-gray-400 absolute right-3 top-3.5 pointer-events-none" />
                </div>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Doctor Assigned" htmlFor="appt-doctor" required>
                <select
                  id="appt-doctor"
                  value={doctorId}
                  onChange={(e) => setDoctorId(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-gray-300 bg-white text-gray-900 shadow-theme-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                >
                  {doctors.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.name.startsWith("Dr.") ? doc.name : `Dr. ${doc.name}`}
                      {doc.specialty ? ` (${doc.specialty})` : ""}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Duration" htmlFor="appt-duration" required>
                <select
                  id="appt-duration"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-gray-300 bg-white text-gray-900 shadow-theme-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                >
                  <option value={15}>15 Minutes</option>
                  <option value={20}>20 Minutes</option>
                  <option value={30}>30 Minutes</option>
                  <option value={45}>45 Minutes</option>
                  <option value={60}>60 Minutes</option>
                  <option value={90}>90 Minutes</option>
                </select>
              </Field>
            </div>

            <Field label="Reason for Visit" htmlFor="appt-reason">
              <Input
                id="appt-reason"
                placeholder="e.g. Regular health checkup, follow-up..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>

          {/* Patient Tabs */}
          <div>
            <div className="flex border-b border-gray-200 mb-4">
              <button
                type="button"
                onClick={() => {
                  setTab("search");
                  setNewPatient({ full_name: "", phone: "", age: null, date_of_birth: null });
                }}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors cursor-pointer ${
                  tab === "search"
                    ? "border-brand-500 text-brand-500"
                    : "border-transparent text-gray-500 hover:text-gray-900"
                }`}
              >
                <Search className="w-4 h-4" />
                <span>Existing Patient</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setTab("new");
                  setChosenPatient(null);
                }}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors cursor-pointer ${
                  tab === "new"
                    ? "border-brand-500 text-brand-500"
                    : "border-transparent text-gray-500 hover:text-gray-900"
                }`}
              >
                <UserPlus className="w-4 h-4" />
                <span>New Patient</span>
              </button>
            </div>

            {/* Existing Patient Search View */}
            {tab === "search" && (
              <div className="space-y-4">
                <Field label="Search by Name or Phone" htmlFor="search-patient">
                  <div className="relative">
                    <Input
                      id="search-patient"
                      placeholder="Type patient name or mobile number..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    <Search className="w-4 h-4 text-gray-400 absolute right-3 top-3.5 pointer-events-none" />
                  </div>
                </Field>

                {chosenPatient ? (
                  <div className="p-3.5 bg-brand-50 border border-brand-200 rounded-xl flex items-center justify-between">
                    <div>
                      <div className="text-[11px] font-bold text-brand-700 uppercase tracking-wider">
                        Selected Patient
                      </div>
                      <div className="text-sm font-bold text-gray-900 mt-0.5">
                        {chosenPatient.full_name}
                      </div>
                      <div className="text-xs text-gray-600 mt-0.5">
                        {chosenPatient.phone}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setChosenPatient(null)}
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {searchResults.length > 0 && (
                      <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden max-h-48 overflow-y-auto bg-white shadow-xs">
                        {searchResults.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setChosenPatient(p)}
                            className="w-full text-left p-3 hover:bg-gray-50 flex items-center justify-between transition-colors cursor-pointer"
                          >
                            <div>
                              <div className="text-sm font-semibold text-gray-900">
                                {p.full_name}
                              </div>
                              <div className="text-xs text-gray-500">
                                {p.phone} • {p.age != null ? `Age ${p.age}` : "Age N/A"}
                              </div>
                            </div>
                            <UserCheck className="w-4 h-4 text-brand-500 shrink-0" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* New Patient Registration View */}
            {tab === "new" && (
              <div className="space-y-4">
                <Field label="Full Name" htmlFor="new-name" required>
                  <Input
                    id="new-name"
                    placeholder="e.g. Ramesh Kumar"
                    value={newPatient.full_name}
                    onChange={(e) => setNewPatient((prev) => ({ ...prev, full_name: e.target.value }))}
                    required
                  />
                </Field>

                <Field label="Mobile Phone" htmlFor="new-phone" required>
                  <PhoneInput
                    id="new-phone"
                    required
                    value={newPatient.phone}
                    onChange={(digits) => setNewPatient((prev) => ({ ...prev, phone: digits }))}
                    disabled={loading}
                  />
                </Field>

                <AgeDobInput
                  ageValue={newPatient.age}
                  dobValue={newPatient.date_of_birth}
                  onAgeChange={(age) => setNewPatient((prev) => ({ ...prev, age }))}
                  onDobChange={(dob) => setNewPatient((prev) => ({ ...prev, date_of_birth: dob }))}
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => handleBook(false)}
            loading={loading}
          >
            Confirm Booking
          </Button>
        </div>
      </div>

      {/* Double-Booking Confirmation Dialog */}
      <OverbookDialog
        isOpen={overbookOpen}
        onClose={() => setOverbookOpen(false)}
        onConfirm={() => handleBook(true)}
        conflictingVisit={conflictingVisit}
        scheduledTimeStr={`${time} on ${date}`}
        loading={loading}
      />
    </>
  );
}
