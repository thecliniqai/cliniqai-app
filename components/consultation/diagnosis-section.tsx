"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  searchDiagnoses,
  addConsultationDiagnosis,
  removeConsultationDiagnosis,
  updateDiagnosisNote,
} from "@/features/terminology/actions";
import {
  ConsultationDiagnosisItem,
  DiagnosisSearchResult,
} from "@/features/terminology/schema";
import { ClinicalSpecialty } from "@/features/consultation/schema";
import {
  Search,
  Plus,
  Trash2,
  FileText,
  AlertCircle,
  CheckCircle2,
  BookmarkCheck,
  ChevronRight,
  X,
  Sparkles,
} from "lucide-react";

interface DiagnosisSectionProps {
  visitId: string;
  patientId: string;
  specialty?: ClinicalSpecialty;
  initialDiagnoses?: ConsultationDiagnosisItem[];
  onDiagnosesChange?: (diagnoses: ConsultationDiagnosisItem[]) => void;
  disabled?: boolean;
}

const SPECIALTY_QUICK_DIAGNOSES: Record<
  ClinicalSpecialty,
  { name: string; icd11?: string; snomed?: string; isChronic?: boolean }[]
> = {
  general_physician: [
    { name: "Acute Upper Respiratory Tract Infection", icd11: "CA40", snomed: "54150009" },
    { name: "Viral Fever", icd11: "MG26", snomed: "386661006" },
    { name: "Acute Gastroenteritis", icd11: "1A40.0", snomed: "442436004" },
    { name: "Essential Hypertension", icd11: "BA00", snomed: "59621000", isChronic: true },
    { name: "Type 2 Diabetes Mellitus", icd11: "5A11", snomed: "44054006", isChronic: true },
    { name: "Acute Bronchitis", icd11: "CA42", snomed: "10509002" },
    { name: "Allergic Rhinitis", icd11: "CA08.0", snomed: "61582004" },
    { name: "Migraine", icd11: "8A80", snomed: "37796009" },
  ],
  dental: [
    { name: "Dental Caries", icd11: "DA08.0", snomed: "80967001" },
    { name: "Gingivitis", icd11: "DA01.0", snomed: "66383009" },
    { name: "Pulpitis", icd11: "DA02.0", snomed: "78848006" },
    { name: "Chronic Periodontitis", icd11: "DA01.1", snomed: "235003009", isChronic: true },
    { name: "Periapical Abscess", icd11: "DA02.2", snomed: "55129006" },
    { name: "Impacted Tooth", icd11: "DA07.0", snomed: "37163004" },
    { name: "Aphthous Stomatitis", icd11: "DA03.0", snomed: "427617000" },
    { name: "Tooth Wear / Attrition", icd11: "DA08.2", snomed: "234976004" },
  ],
  pediatrics: [
    { name: "Acute Upper Respiratory Tract Infection", icd11: "CA40", snomed: "54150009" },
    { name: "Viral Gastroenteritis", icd11: "1A40.0", snomed: "442436004" },
    { name: "Acute Bronchiolitis", icd11: "CA43", snomed: "420038006" },
    { name: "Acute Otitis Media", icd11: "AA00", snomed: "65363002" },
    { name: "Febrile Convulsion", icd11: "8A68.0", snomed: "41497008" },
    { name: "Chickenpox (Varicella)", icd11: "1E90", snomed: "38907003" },
    { name: "Hand, Foot and Mouth Disease", icd11: "1F03", snomed: "70417006" },
    { name: "Childhood Asthma", icd11: "CA23", snomed: "195967001", isChronic: true },
  ],
};

export function DiagnosisSection({
  visitId,
  patientId,
  specialty = "general_physician",
  initialDiagnoses = [],
  onDiagnosesChange,
  disabled = false,
}: DiagnosisSectionProps) {
  const [diagnoses, setDiagnoses] = useState<ConsultationDiagnosisItem[]>(initialDiagnoses);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DiagnosisSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [activeEditingNoteId, setActiveEditingNoteId] = useState<string | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync internal diagnoses when initialDiagnoses changes
  useEffect(() => {
    setDiagnoses(initialDiagnoses);
  }, [initialDiagnoses]);

  // Click outside listener for autocomplete dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([]);
      setIsDropdownOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await searchDiagnoses({
          query: query.trim(),
          specialty,
          limit: 15,
        });
        if (res.success) {
          setSearchResults(res.results);
          setIsDropdownOpen(true);
        }
      } catch (err) {
        console.error("Diagnosis search error:", err);
      } finally {
        setIsSearching(false);
      }
    }, 120);

    return () => clearTimeout(timer);
  }, [query, specialty]);

  // Handle adding a diagnosis
  const handleAddDiagnosis = async (
    name: string,
    icd11?: string | null,
    snomed?: string | null,
    isCustom = false,
    isChronic = false
  ) => {
    if (disabled) return;
    setErrorMsg(null);

    // Optimistic UI update
    const tempId = `temp-${Date.now()}`;
    const newDiagnosis: ConsultationDiagnosisItem = {
      id: tempId,
      visit_id: visitId,
      patient_id: patientId,
      diagnosis_name: name,
      icd11_code: icd11 || null,
      snomed_concept_id: snomed || null,
      is_custom: isCustom,
      is_chronic: isChronic,
      notes: null,
      created_at: new Date().toISOString(),
    };

    const nextList = [...diagnoses, newDiagnosis];
    setDiagnoses(nextList);
    onDiagnosesChange?.(nextList);
    setQuery("");
    setIsDropdownOpen(false);

    try {
      const res = await addConsultationDiagnosis({
        visit_id: visitId,
        patient_id: patientId,
        diagnosis_name: name,
        icd11_code: icd11,
        snomed_concept_id: snomed,
        is_custom: isCustom,
        is_chronic: isChronic,
      });

      if (res.success) {
        // Replace tempId with server-generated ID
        const resolvedList = nextList.map((d) =>
          d.id === tempId ? { ...d, id: res.diagnosisId } : d
        );
        setDiagnoses(resolvedList);
        onDiagnosesChange?.(resolvedList);
      } else {
        // Revert on error
        const reverted = diagnoses.filter((d) => d.id !== tempId);
        setDiagnoses(reverted);
        onDiagnosesChange?.(reverted);
        setErrorMsg(res.error || "Failed to add diagnosis.");
      }
    } catch (err: unknown) {
      const reverted = diagnoses.filter((d) => d.id !== tempId);
      setDiagnoses(reverted);
      onDiagnosesChange?.(reverted);
      setErrorMsg(err instanceof Error ? err.message : "Failed to record diagnosis.");
    }
  };

  // Handle removing a diagnosis
  const handleRemoveDiagnosis = async (id: string) => {
    if (disabled) return;
    setErrorMsg(null);

    const prevList = [...diagnoses];
    const nextList = diagnoses.filter((d) => d.id !== id);
    setDiagnoses(nextList);
    onDiagnosesChange?.(nextList);

    try {
      const res = await removeConsultationDiagnosis(id, visitId);
      if (!res.success) {
        setDiagnoses(prevList);
        onDiagnosesChange?.(prevList);
        setErrorMsg(res.error || "Failed to remove diagnosis.");
      }
    } catch (err: unknown) {
      setDiagnoses(prevList);
      onDiagnosesChange?.(prevList);
      setErrorMsg(err instanceof Error ? err.message : "Failed to remove diagnosis.");
    }
  };

  // Handle updating inline diagnosis note
  const handleSaveNote = async (id: string, notes: string) => {
    if (disabled) return;
    const cleaned = notes.trim() || null;
    const nextList = diagnoses.map((d) => (d.id === id ? { ...d, notes: cleaned } : d));
    setDiagnoses(nextList);
    onDiagnosesChange?.(nextList);
    setActiveEditingNoteId(null);

    try {
      await updateDiagnosisNote(id, visitId, cleaned);
    } catch (err) {
      console.error("Failed to update diagnosis note:", err);
    }
  };

  const quickDiagnoses = SPECIALTY_QUICK_DIAGNOSES[specialty] || SPECIALTY_QUICK_DIAGNOSES.general_physician;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-brand-600" aria-hidden="true" />
          <h3 className="text-sm font-bold text-gray-900">
            Diagnosis & Clinical Coding (ICD-11 / SNOMED CT)
          </h3>
        </div>
        <span className="text-xs text-gray-500 font-medium">
          {diagnoses.length} {diagnoses.length === 1 ? "condition" : "conditions"} coded
        </span>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-rose-600 hover:text-rose-800 font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 1-Tap Specialty Quick Chips */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Quick OPD Diagnoses ({specialty.replace("_", " ")}):
        </label>
        <div className="flex flex-wrap gap-1.5">
          {quickDiagnoses.map((item) => {
            const isAdded = diagnoses.some(
              (d) => d.diagnosis_name.toLowerCase() === item.name.toLowerCase()
            );
            return (
              <button
                key={item.name}
                type="button"
                disabled={disabled || isAdded}
                onClick={() =>
                  handleAddDiagnosis(
                    item.name,
                    item.icd11,
                    item.snomed,
                    false,
                    item.isChronic ?? false
                  )
                }
                className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 ${
                  isAdded
                    ? "bg-emerald-50 text-emerald-800 border-emerald-300 opacity-80 cursor-default"
                    : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100 hover:border-gray-300"
                }`}
              >
                {isAdded ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                ) : (
                  <Plus className="h-3 w-3 text-gray-400" />
                )}
                <span>{item.name}</span>
                {item.icd11 && (
                  <span className="text-[10px] text-gray-400 font-mono">[{item.icd11}]</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Fast Autocomplete Search Bar */}
      <div className="relative">
        <div className="relative">
          <Search className="h-4 w-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            disabled={disabled}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              if (searchResults.length > 0) setIsDropdownOpen(true);
            }}
            placeholder="Search diagnosis name, ICD-11, SNOMED CT, or custom condition..."
            className="w-full min-h-[44px] pl-10 pr-10 rounded-lg border border-gray-300 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 bg-white"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded"
              aria-label="Clear diagnosis search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Dropdown Results */}
        {isDropdownOpen && (
          <div
            ref={dropdownRef}
            className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-gray-200 rounded-xl shadow-lg z-40 max-h-72 overflow-y-auto divide-y divide-gray-100"
          >
            {searchResults.map((item) => (
              <button
                key={`${item.id}-${item.name}`}
                type="button"
                onClick={() =>
                  handleAddDiagnosis(
                    item.name,
                    item.icd11_code,
                    item.snomed_concept_id,
                    item.is_custom,
                    item.is_chronic
                  )
                }
                className="w-full min-h-[44px] p-3 text-left hover:bg-gray-50 flex items-center justify-between transition-colors"
              >
                <div className="min-w-0 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-900">{item.name}</span>
                    {item.is_custom && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                        Doctor Custom
                      </span>
                    )}
                    {item.is_chronic && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                        Chronic
                      </span>
                    )}
                  </div>
                  {item.category && (
                    <span className="text-[11px] text-gray-400 block truncate">
                      {item.category}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {item.icd11_code && (
                    <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-mono text-[10px]">
                      ICD: {item.icd11_code}
                    </span>
                  )}
                  {item.snomed_concept_id && (
                    <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono text-[10px]">
                      SNOMED: {item.snomed_concept_id}
                    </span>
                  )}
                </div>
              </button>
            ))}

            {/* Custom Diagnosis Fallback Option */}
            {query.trim().length > 1 && (
              <button
                type="button"
                onClick={() => handleAddDiagnosis(query.trim(), null, null, true, false)}
                className="w-full min-h-[44px] p-3 text-left hover:bg-brand-50/60 bg-gray-50/50 flex items-center gap-2 transition-colors text-brand-700"
              >
                <Plus className="h-4 w-4 text-brand-600" />
                <span className="text-xs font-semibold">
                  + Add custom diagnosis: &quot;{query.trim()}&quot;
                </span>
                <span className="text-[11px] text-gray-400 ml-auto font-normal">
                  Saves to personal doctor catalog
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Selected Diagnoses Container */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Selected Diagnoses:
        </h4>

        {diagnoses.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-xs text-gray-500 bg-gray-50/30">
            No diagnoses selected yet. Choose from quick OPD conditions above or type to search.
          </div>
        ) : (
          <div className="space-y-2">
            {diagnoses.map((item) => {
              const isEditingNote = activeEditingNoteId === item.id;
              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-gray-200 bg-white p-3 shadow-xs space-y-2 transition-all"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-bold text-gray-900">{item.diagnosis_name}</span>
                      {item.icd11_code && (
                        <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-mono text-[10px]">
                          ICD-11: {item.icd11_code}
                        </span>
                      )}
                      {item.snomed_concept_id && (
                        <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono text-[10px]">
                          SNOMED: {item.snomed_concept_id}
                        </span>
                      )}
                      {item.is_chronic && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-semibold flex items-center gap-1">
                          <BookmarkCheck className="h-3 w-3 text-amber-600" />
                          Chronic
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Add Note Button */}
                      {!isEditingNote && (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveEditingNoteId(item.id);
                            setEditingNoteValue(item.notes || "");
                          }}
                          className="min-h-[32px] px-2 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
                        >
                          {item.notes ? "Edit Note" : "+ Note"}
                        </button>
                      )}

                      {/* Remove Button */}
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => handleRemoveDiagnosis(item.id)}
                        aria-label="Remove diagnosis"
                        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Existing Note Display */}
                  {item.notes && !isEditingNote && (
                    <p className="text-xs text-gray-600 italic bg-gray-50 p-2 rounded border border-gray-100">
                      Note: {item.notes}
                    </p>
                  )}

                  {/* Inline Note Editor */}
                  {isEditingNote && (
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        value={editingNoteValue}
                        onChange={(e) => setEditingNoteValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleSaveNote(item.id, editingNoteValue);
                          } else if (e.key === "Escape") {
                            setActiveEditingNoteId(null);
                          }
                        }}
                        placeholder="e.g. Mild flare-up, symptoms onset 3 days ago"
                        className="flex-1 min-h-[36px] px-2.5 rounded border border-gray-300 text-xs text-gray-900 focus:outline-none focus:border-brand-500"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveNote(item.id, editingNoteValue)}
                        className="min-h-[36px] px-3 rounded bg-gray-900 text-white text-xs font-semibold hover:bg-gray-800"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveEditingNoteId(null)}
                        className="min-h-[36px] px-2 text-xs text-gray-500 hover:text-gray-700"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
