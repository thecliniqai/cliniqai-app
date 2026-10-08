"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { AgeDobInput } from "@/components/patients/age-dob-input";
import { createPatient } from "@/features/patients/actions";
import { createVisit } from "@/features/visits/actions";
import { checkInVisit } from "@/features/queue/actions";
import { findPotentialDuplicates } from "@/features/patients/dedup";
import { X, Search, UserPlus, UserCheck } from "lucide-react";
import { Patient } from "@/lib/db/types";

export interface DoctorOption {
  id: string;
  name: string;
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
        const matches = await findPotentialDuplicates({
          phone: searchQuery.trim(),
          fullName: searchQuery.trim(),
        });
        setSearchResults(matches.map((m) => m.patient));
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
      // 1. Create walk-in visit
      const visitRes = await createVisit({
        patient_id: patient.id,
        doctor_id: doctorId,
        origin_type: "walk_in",
        reason_for_visit: reason || "Walk-In Consultation",
        estimated_duration_minutes: 15,
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
        estimated_duration_minutes: 15,
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

      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to register walk-in.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div className="relative w-full max-w-lg bg-white h-full shadow-2xl flex flex-col z-10 animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-5 border-b border-[var(--border-default)] flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              Quick Walk-In Registration
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Issue token and check in patient for today&apos;s queue
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Close drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="px-5 pt-3 border-b border-[var(--border-default)] flex gap-4">
          <button
            type="button"
            onClick={() => setTab("search")}
            className={`pb-2.5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              tab === "search"
                ? "border-[var(--brand-primary)] text-[var(--brand-primary)]"
                : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Search className="w-4 h-4" />
            Existing Patient
          </button>
          <button
            type="button"
            onClick={() => setTab("new")}
            className={`pb-2.5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              tab === "new"
                ? "border-[var(--brand-primary)] text-[var(--brand-primary)]"
                : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <UserPlus className="w-4 h-4" />
            New Patient
          </button>
        </div>

        {/* Doctor & Reason selector */}
        <div className="p-5 bg-[var(--surface-subtle)] border-b border-[var(--border-default)] grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-[var(--text-primary)] block mb-1">
              Consulting Doctor *
            </label>
            <select
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              className="w-full h-9 px-2 text-xs rounded-[var(--radius-md)] border border-[var(--border-default)] bg-white text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--border-focus)]"
            >
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  Dr. {d.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-primary)] block mb-1">
              Reason / Symptoms
            </label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Fever, Follow-up"
              className="h-9 text-xs"
            />
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="p-3 mb-4 bg-[var(--status-error-bg)] border border-[var(--status-error-border)] text-[var(--status-error)] text-xs rounded-[var(--radius-md)]">
              {error}
            </div>
          )}

          {tab === "search" ? (
            <div className="space-y-4">
              <Field label="Search by Name or Phone" htmlFor="patient-search">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-3 text-[var(--text-muted)]" />
                  <Input
                    id="patient-search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="e.g. 9876543210 or Ramesh"
                    className="pl-9"
                    autoFocus
                  />
                </div>
              </Field>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  {searchResults.length > 0 ? "Matching Patients" : "Results"}
                </p>

                {searchResults.length === 0 && searchQuery.trim().length >= 3 && (
                  <div className="text-center py-8 text-xs text-[var(--text-muted)]">
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
                      className="block mx-auto mt-2 text-[var(--brand-primary)] font-semibold underline"
                    >
                      Register as New Patient
                    </button>
                  </div>
                )}

                {searchResults.map((p) => (
                  <div
                    key={p.id}
                    className="p-3 rounded-[var(--radius-md)] border border-[var(--border-default)] hover:border-[var(--brand-primary)] flex items-center justify-between gap-3 transition-colors bg-white"
                  >
                    <div>
                      <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                        {p.full_name}
                      </h4>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                        {p.phone} • {p.age != null ? `Age ${p.age}` : "Age N/A"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      onClick={() => handleSearchCheckIn(p)}
                      disabled={loading}
                      className="text-xs h-8"
                    >
                      <UserCheck className="w-3.5 h-3.5 mr-1" />
                      Issue Token
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <form onSubmit={handleNewPatientSubmit} className="space-y-4">
              <Field label="Full Name *" htmlFor="walkin-name">
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

              <Field label="Phone Number *" htmlFor="walkin-phone">
                <Input
                  id="walkin-phone"
                  type="tel"
                  required
                  value={newPatient.phone}
                  onChange={(e) =>
                    setNewPatient({ ...newPatient, phone: e.target.value })
                  }
                  placeholder="9876543210"
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

              <div className="pt-4 flex justify-end gap-2">
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
    </div>
  );
}
