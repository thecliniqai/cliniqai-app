"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { addToWaitlist } from "@/features/waitlist/actions";
import { findPotentialDuplicates } from "@/features/patients/dedup";
import { createPatient } from "@/features/patients/actions";
import { AgeDobInput } from "@/components/patients/age-dob-input";
import { X, Clock, Search, UserPlus, UserCheck } from "lucide-react";
import { Patient } from "@/lib/db/types";

export interface WaitlistDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  doctors: Array<{ id: string; name: string }>;
  defaultDate: string;
}

export function WaitlistDrawer({
  isOpen,
  onClose,
  onSuccess,
  doctors,
  defaultDate,
}: WaitlistDrawerProps) {
  const [tab, setTab] = useState<"search" | "new">("search");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form Fields
  const [targetDate, setTargetDate] = useState(defaultDate);
  const [doctorId, setDoctorId] = useState<string>("any");
  const [priority, setPriority] = useState(0);
  const [timeWindow, setTimeWindow] = useState("Morning (9 AM - 1 PM)");
  const [notes, setNotes] = useState("");

  // Existing Patient Search
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

  useEffect(() => {
    if (defaultDate) setTargetDate(defaultDate);
  }, [defaultDate, isOpen]);

  // Debounced Search
  useEffect(() => {
    if (tab !== "search") return;
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const isNumeric = /^\+?[\d\s-]+$/.test(searchQuery);
        const matches = await findPotentialDuplicates(
          isNumeric ? { phone: searchQuery } : { fullName: searchQuery }
        );
        setSearchResults(matches.map((m) => m.patient));
      } catch {
        // Search error handling
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery, tab]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);

    try {
      let patientIdToWaitlist = chosenPatient?.id;

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
        patientIdToWaitlist = patientRes.patientId;
      }

      if (!patientIdToWaitlist) {
        setError("Please select or register a patient.");
        setLoading(false);
        return;
      }

      const res = await addToWaitlist({
        patient_id: patientIdToWaitlist,
        doctor_id: doctorId === "any" ? null : doctorId,
        target_date: targetDate,
        time_window: timeWindow || null,
        priority: priority,
        notes: notes || null,
      });

      if (!res.success) {
        setError(res.error);
        setLoading(false);
        return;
      }

      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add to waitlist.");
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
        aria-labelledby="waitlist-drawer-title"
        className="fixed inset-y-0 right-0 z-40 w-full max-w-lg bg-white border-l border-gray-200 shadow-2xl flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600 border border-amber-200">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 id="waitlist-drawer-title" className="text-base font-bold text-gray-900">
                Add Patient to Waitlist
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Eligible for automatic promotion on slot cancellation
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

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-start gap-2">
              <span className="font-semibold">{error}</span>
            </div>
          )}

          <div className="bg-gray-50/70 p-4 rounded-xl border border-gray-200 space-y-3.5">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Waitlist Preferences
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Target Date" htmlFor="wl-date" required>
                <Input
                  id="wl-date"
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  required
                />
              </Field>

              <Field label="Doctor Preference" htmlFor="wl-doctor">
                <select
                  id="wl-doctor"
                  value={doctorId}
                  onChange={(e) => setDoctorId(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-gray-300 bg-white text-gray-900 shadow-theme-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                >
                  <option value="any">Any Available Doctor</option>
                  {doctors.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Time Window" htmlFor="wl-window">
                <select
                  id="wl-window"
                  value={timeWindow}
                  onChange={(e) => setTimeWindow(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-gray-300 bg-white text-gray-900 shadow-theme-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                >
                  <option value="Morning (9 AM - 1 PM)">Morning (9 AM - 1 PM)</option>
                  <option value="Afternoon (1 PM - 5 PM)">Afternoon (1 PM - 5 PM)</option>
                  <option value="Evening (5 PM - 8 PM)">Evening (5 PM - 8 PM)</option>
                  <option value="Anytime">Anytime</option>
                </select>
              </Field>

              <Field label="Priority" htmlFor="wl-priority">
                <select
                  id="wl-priority"
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-gray-300 bg-white text-gray-900 shadow-theme-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                >
                  <option value={0}>Normal (0)</option>
                  <option value={5}>High (5)</option>
                  <option value={10}>Urgent / VIP (10)</option>
                </select>
              </Field>
            </div>

            <Field label="Notes / Special Request" htmlFor="wl-notes">
              <Input
                id="wl-notes"
                placeholder="e.g. Needs immediate slot if someone cancels..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </div>

          {/* Patient Selection Tabs */}
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

            {tab === "search" && (
              <div className="space-y-4">
                <Field label="Search by Name or Phone" htmlFor="wl-search">
                  <div className="relative">
                    <Input
                      id="wl-search"
                      placeholder="Type patient name or mobile number..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    <Search className="w-4 h-4 text-gray-400 absolute right-3 top-3.5 pointer-events-none" />
                  </div>
                </Field>

                {chosenPatient ? (
                  <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between">
                    <div>
                      <div className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">
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
                                {p.phone}
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

            {tab === "new" && (
              <div className="space-y-4">
                <Field label="Full Name" htmlFor="wl-new-name" required>
                  <Input
                    id="wl-new-name"
                    placeholder="e.g. Meera Bai"
                    value={newPatient.full_name}
                    onChange={(e) => setNewPatient((prev) => ({ ...prev, full_name: e.target.value }))}
                    required
                  />
                </Field>

                <Field label="Mobile Phone" htmlFor="wl-new-phone" required>
                  <Input
                    id="wl-new-phone"
                    type="tel"
                    placeholder="+919876543210"
                    value={newPatient.phone}
                    onChange={(e) => setNewPatient((prev) => ({ ...prev, phone: e.target.value }))}
                    required
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
            onClick={handleSubmit}
            loading={loading}
            className="bg-amber-600 hover:bg-amber-700 text-white border-transparent focus:ring-amber-500"
          >
            Add to Waitlist
          </Button>
        </div>
      </div>
    </>
  );
}
