"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Field } from "@/components/ui/field";
import { AgeDobInput } from "@/components/patients/age-dob-input";
import { createPatient, searchPatients } from "@/features/patients/actions";
import { createVisit } from "@/features/visits/actions";
import { checkInVisit } from "@/features/queue/actions";
import { X, Search, UserPlus, UserCheck } from "lucide-react";
import { Patient } from "@/lib/db/types";

export interface DoctorOption {
  id: string;
  name: string;
  specialty?: string | null;
  default_slot_duration_minutes?: number | null;
}

export interface WalkInDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  doctors: DoctorOption[];
}

export function WalkInDrawer({
  isOpen,
  onClose,
  onSuccess,
  doctors,
}: WalkInDrawerProps) {
  const [tab, setTab] = useState<"search" | "new">("search");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Patient[]>([]);

  // New patient form state
  const [newPatient, setNewPatient] = useState({
    full_name: "",
    phone: "",
    age: null as number | null,
    date_of_birth: "",
  });

  // Common visit state
  const [doctorId, setDoctorId] = useState<string>(doctors[0]?.id || "");
  const [reason, setReason] = useState("");

  const resetForm = () => {
    setTab("search");
    setSearchQuery("");
    setSearchResults([]);
    setNewPatient({
      full_name: "",
      phone: "",
      age: null,
      date_of_birth: "",
    });
    setReason("");
    setError(null);
  };

  useEffect(() => {
    if (isOpen) {
      resetForm();
    }
  }, [isOpen]);

  // Sync default doctor when doctors load
  useEffect(() => {
    if (!doctorId && doctors.length > 0) {
      setDoctorId(doctors[0].id);
    }
  }, [doctors, doctorId]);

  // Search effect
  useEffect(() => {
    if (tab !== "search" || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const patients = await searchPatients(searchQuery.trim());
        setSearchResults(patients);
      } catch (err) {
        console.error("Patient search failed:", err);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, tab]);

  if (!isOpen) return null;

  const handleSearchCheckIn = async (patient: Patient) => {
    if (!doctorId) {
      setError("Please select a consulting doctor.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const selectedDoc = doctors.find((d) => d.id === doctorId);
      const durationMins = selectedDoc?.default_slot_duration_minutes || 15;

      // 1. Create walk-in visit
      const visitRes = await createVisit({
        patient_id: patient.id,
        doctor_id: doctorId,
        origin_type: "walk_in",
        reason_for_visit: reason || "Walk-In Consultation",
        estimated_duration_minutes: durationMins,
        is_overbooked: false,
      });

      if (!visitRes.success) {
        setError(visitRes.error);
        setLoading(false);
        return;
      }

      // 2. Check into queue
      const queueRes = await checkInVisit(visitRes.visitId);
      if (!queueRes.success) {
        setError(queueRes.error);
        setLoading(false);
        return;
      }

      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add to queue.");
    } finally {
      setLoading(false);
    }
  };

  const handleNewPatientSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!doctorId) {
      setError("Please select a consulting doctor.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const selectedDoc = doctors.find((d) => d.id === doctorId);
      const durationMins = selectedDoc?.default_slot_duration_minutes || 15;

      // 1. Create Patient
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

      // 2. Create Visit
      const visitRes = await createVisit({
        patient_id: patientRes.patientId,
        doctor_id: doctorId,
        origin_type: "walk_in",
        reason_for_visit: reason || "Walk-In Consultation",
        estimated_duration_minutes: durationMins,
        is_overbooked: false,
      });

      if (!visitRes.success) {
        setError(visitRes.error);
        setLoading(false);
        return;
      }

      // 3. Issue Token & Check In
      const queueRes = await checkInVisit(visitRes.visitId);
      if (!queueRes.success) {
        setError(queueRes.error);
        setLoading(false);
        return;
      }

      resetForm();
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to register walk-in.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-gray-900/50 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-40 w-full max-w-lg bg-white border-l border-gray-200 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-100 text-brand-600 flex items-center justify-center">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">
                Quick Walk-In Registration
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Issue token and check in patient for today&apos;s queue
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
            aria-label="Close drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="px-6 pt-3 border-b border-gray-200 flex gap-4">
          <button
            type="button"
            onClick={() => setTab("search")}
            className={`pb-2.5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
              tab === "search"
                ? "border-brand-500 text-brand-500"
                : "border-transparent text-gray-500 hover:text-gray-900"
            }`}
          >
            <Search className="w-4 h-4" />
            Existing Patient
          </button>
          <button
            type="button"
            onClick={() => setTab("new")}
            className={`pb-2.5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
              tab === "new"
                ? "border-brand-500 text-brand-500"
                : "border-transparent text-gray-500 hover:text-gray-900"
            }`}
          >
            <UserPlus className="w-4 h-4" />
            New Patient
          </button>
        </div>

        {/* Doctor & Reason selector */}
        <div className="p-5 bg-gray-50/70 border-b border-gray-200 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">
              Consulting Doctor *
            </label>
            <select
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              className="w-full h-11 px-3 text-sm rounded-lg border border-gray-300 bg-white text-gray-900 shadow-theme-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
            >
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name.startsWith("Dr.") ? d.name : `Dr. ${d.name}`}
                  {d.specialty ? ` (${d.specialty})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">
              Reason / Symptoms
            </label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Fever, Follow-up"
            />
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="p-3.5 mb-4 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-start gap-2">
              <span className="font-semibold">{error}</span>
            </div>
          )}

          {tab === "search" ? (
            <div className="space-y-4">
              <Field label="Search by Name or Phone" htmlFor="patient-search">
                <div className="relative">
                  <Input
                    id="patient-search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="e.g. 9876543210 or Ramesh"
                    autoFocus
                  />
                  <Search className="w-4 h-4 text-gray-400 absolute right-3 top-3.5 pointer-events-none" />
                </div>
              </Field>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {searchResults.length > 0 ? "Matching Patients" : "Results"}
                </p>

                {searchResults.length === 0 && searchQuery.trim().length >= 3 && (
                  <div className="text-center py-8 text-xs text-gray-500">
                    No patients found matching &quot;{searchQuery}&quot;.
                    <button
                      type="button"
                      onClick={() => {
                        setTab("new");
                        setNewPatient((prev) => ({
                          ...prev,
                          phone: /^\d+$/.test(searchQuery) ? searchQuery : "",
                          full_name: /^\d+$/.test(searchQuery) ? "" : searchQuery,
                        }));
                      }}
                      className="block mx-auto mt-2 text-brand-600 font-semibold underline cursor-pointer"
                    >
                      Register as New Patient
                    </button>
                  </div>
                )}

                {searchResults.map((p) => (
                  <div
                    key={p.id}
                    className="p-3.5 rounded-xl border border-gray-200 hover:border-gray-300 flex items-center justify-between gap-3 transition-colors bg-white shadow-2xs"
                  >
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">
                        {p.full_name}
                      </h4>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {p.phone} • {p.age != null ? `Age ${p.age}` : "Age N/A"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      onClick={() => handleSearchCheckIn(p)}
                      disabled={loading}
                      className="text-xs h-9 px-3.5 gap-1.5"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      Issue Token
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <form onSubmit={handleNewPatientSubmit} className="space-y-4">
              <Field label="Full Name" htmlFor="walkin-name" required>
                <Input
                  id="walkin-name"
                  required
                  value={newPatient.full_name}
                  onChange={(e) =>
                    setNewPatient({ ...newPatient, full_name: e.target.value })
                  }
                  placeholder="e.g. Meera Devi"
                />
              </Field>

              <Field label="Phone Number" htmlFor="walkin-phone" required>
                <PhoneInput
                  id="walkin-phone"
                  required
                  value={newPatient.phone}
                  onChange={(digits) =>
                    setNewPatient((prev) => ({ ...prev, phone: digits }))
                  }
                  disabled={loading}
                />
              </Field>

              <AgeDobInput
                ageValue={newPatient.age}
                dobValue={newPatient.date_of_birth}
                onAgeChange={(age) =>
                  setNewPatient((prev) => ({ ...prev, age }))
                }
                onDobChange={(dob) =>
                  setNewPatient((prev) => ({
                    ...prev,
                    date_of_birth: dob || "",
                  }))
                }
                disabled={loading}
              />

              <div className="pt-4 flex justify-end gap-3 border-t border-gray-100">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onClose}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={loading}>
                  {loading ? "Registering..." : "Register & Issue Token"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
