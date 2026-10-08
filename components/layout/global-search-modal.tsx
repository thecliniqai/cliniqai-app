"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { searchPatients } from "@/features/patients/actions";
import { Patient } from "@/lib/db/types";
import {
  Search,
  User,
  ShieldCheck,
  UserPlus,
  ArrowRight,
  X,
  Loader2,
} from "lucide-react";

export interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GlobalSearchModal({ isOpen, onClose }: GlobalSearchModalProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Auto-focus and reset state on open
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
      setLoading(false);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Handle global escape & shortcut
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  // Debounced search
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const patients = await searchPatients(trimmed);
        setResults(patients);
        setSelectedIndex(0);
      } catch (err) {
        console.error("Global search failed:", err);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  // Keyboard navigation through search results
  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        results.length > 0 ? (prev + 1) % results.length : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        results.length > 0
          ? (prev - 1 + results.length) % results.length
          : 0
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results.length > 0 && results[selectedIndex]) {
        const selectedPatient = results[selectedIndex];
        onClose();
        router.push(`/patients/${selectedPatient.id}`);
      }
    }
  };

  const handleSelectPatient = (patientId: string) => {
    onClose();
    router.push(`/patients/${patientId}`);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-14 sm:pt-20 px-4 pb-4 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-gray-900/50 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Search Palette Card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Global Search Palette"
        className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden transform transition-all z-10 flex flex-col max-h-[85vh]"
      >
        {/* Search Input Bar */}
        <div className="relative flex items-center border-b border-gray-200 px-4 py-3.5 bg-white">
          <Search className="w-5 h-5 text-gray-400 shrink-0 me-3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search patients by name, phone, or ABHA ID..."
            className="w-full text-base bg-transparent text-gray-900 placeholder:text-gray-400 focus:outline-none"
          />
          {loading && (
            <Loader2 className="w-4 h-4 text-[#1769E0] animate-spin shrink-0 me-2" />
          )}
          {query && !loading && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0 me-2"
              aria-label="Clear query"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium text-gray-400 hover:text-gray-600 px-2 py-1 rounded bg-gray-100 border border-gray-200 shrink-0"
          >
            ESC
          </button>
        </div>

        {/* Results / Empty states */}
        <div className="flex-1 overflow-y-auto p-2 min-h-[140px] max-h-[460px]">
          {/* Default state when query is empty */}
          {!query.trim() && (
            <div className="py-10 px-6 text-center">
              <div className="w-12 h-12 rounded-full bg-blue-50 text-[#1769E0] flex items-center justify-center mx-auto mb-3">
                <Search className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-semibold text-gray-900 mb-1">
                Search Clinic Patients
              </h4>
              <p className="text-xs text-gray-500 max-w-sm mx-auto">
                Type a patient name, phone number (e.g. 9876543210), or National Health ID (ABHA) to instantly locate records.
              </p>
              <div className="mt-5 flex items-center justify-center gap-4 text-[11px] text-gray-400">
                <span>
                  <strong className="text-gray-600 font-medium">↑↓</strong> Navigate
                </span>
                <span>•</span>
                <span>
                  <strong className="text-gray-600 font-medium">↵</strong> Select
                </span>
                <span>•</span>
                <span>
                  <strong className="text-gray-600 font-medium">esc</strong> Close
                </span>
              </div>
            </div>
          )}

          {/* Loading state indicator */}
          {query.trim() && loading && results.length === 0 && (
            <div className="py-12 text-center text-xs text-gray-500 flex flex-col items-center gap-2">
              <Loader2 className="w-5 h-5 text-[#1769E0] animate-spin" />
              <span>Searching patient records...</span>
            </div>
          )}

          {/* Results list */}
          {query.trim() && results.length > 0 && (
            <div className="space-y-1">
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 flex items-center justify-between">
                <span>Patients ({results.length})</span>
                <span className="normal-case text-gray-400 text-[10px]">
                  Press Enter to open profile
                </span>
              </div>
              {results.map((patient, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <div
                    key={patient.id}
                    onClick={() => handleSelectPatient(patient.id)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`flex items-center justify-between p-3 rounded-xl transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-blue-50/80 border border-blue-200/80"
                        : "hover:bg-gray-50 border border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                          isSelected
                            ? "bg-[#1769E0] text-white"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {patient.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-gray-900 truncate">
                            {patient.full_name}
                          </span>
                          {patient.abha_id && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                              <ShieldCheck className="w-3 h-3" />
                              <span>ABHA</span>
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2.5 text-xs text-gray-500 mt-0.5">
                          <span className="font-mono tabular-nums">
                            {patient.phone}
                          </span>
                          {(patient.age !== null || patient.sex) && (
                            <>
                              <span>•</span>
                              <span>
                                {patient.age !== null ? `${patient.age}y` : ""}
                                {patient.age !== null && patient.sex ? " · " : ""}
                                {patient.sex ? patient.sex.charAt(0).toUpperCase() : ""}
                              </span>
                            </>
                          )}
                          {patient.abha_id && (
                            <>
                              <span>•</span>
                              <span className="truncate max-w-[140px] text-gray-400">
                                {patient.abha_id}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 ms-3">
                      <span
                        className={`text-xs font-medium flex items-center gap-1 ${
                          isSelected ? "text-[#1769E0]" : "text-gray-400"
                        }`}
                      >
                        <span>View</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* No results empty state */}
          {query.trim() && !loading && results.length === 0 && (
            <div className="py-10 px-6 text-center">
              <div className="w-10 h-10 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center mx-auto mb-2.5">
                <User className="w-5 h-5" />
              </div>
              <h4 className="text-sm font-semibold text-gray-900 mb-1">
                No patients found
              </h4>
              <p className="text-xs text-gray-500 max-w-xs mx-auto mb-4">
                No patient matches &quot;{query}&quot; in phone numbers, names, or ABHA records.
              </p>
              <Link
                href="/patients/new"
                onClick={onClose}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg text-white bg-[#1769E0] hover:bg-[#1253b3] transition-colors shadow-theme-xs"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Register &quot;{query}&quot; as New Patient</span>
              </Link>
            </div>
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-[10px] font-mono">
                ↑
              </kbd>
              <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-[10px] font-mono">
                ↓
              </kbd>
              <span className="text-gray-400 ms-0.5">navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-[10px] font-mono">
                ↵
              </kbd>
              <span className="text-gray-400 ms-0.5">select</span>
            </span>
          </div>

          <Link
            href="/patients/new"
            onClick={onClose}
            className="flex items-center gap-1 font-medium text-[#1769E0] hover:underline cursor-pointer"
          >
            <UserPlus className="w-3 h-3" />
            <span>New Patient Intake</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
