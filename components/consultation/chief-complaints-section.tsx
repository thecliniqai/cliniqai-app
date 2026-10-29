"use client";

import React, { useState } from "react";
import { Plus, X, Clock, FileText } from "lucide-react";
import { ChiefComplaintItem } from "@/features/consultation/schema";

export interface ChiefComplaintsSectionProps {
  complaints: ChiefComplaintItem[];
  clinicalNotes: string;
  onComplaintsChange: (updated: ChiefComplaintItem[]) => void;
  onClinicalNotesChange: (notes: string) => void;
  disabled?: boolean;
}

const COMMON_OPD_COMPLAINTS = [
  "Fever",
  "Cough",
  "Cold & Congestion",
  "Headache",
  "Sore Throat",
  "Loose Stools",
  "Vomiting",
  "Body Ache",
  "Abdominal Pain",
  "Loss of Appetite",
  "Weakness",
  "Skin Rash",
];

const DURATION_PRESETS = [
  { val: 1, unit: "days" as const, label: "1d" },
  { val: 2, unit: "days" as const, label: "2d" },
  { val: 3, unit: "days" as const, label: "3d" },
  { val: 5, unit: "days" as const, label: "5d" },
  { val: 1, unit: "weeks" as const, label: "1w" },
  { val: 2, unit: "weeks" as const, label: "2w" },
  { val: 1, unit: "months" as const, label: "1m" },
];

export function ChiefComplaintsSection({
  complaints,
  clinicalNotes,
  onComplaintsChange,
  onClinicalNotesChange,
  disabled = false,
}: ChiefComplaintsSectionProps) {
  const [customSymptom, setCustomSymptom] = useState("");

  const handleAddSymptom = (symptom: string) => {
    if (!symptom.trim()) return;
    // Don't duplicate exact existing active symptoms
    if (complaints.some((c) => c.symptom.toLowerCase() === symptom.trim().toLowerCase())) {
      return;
    }

    const newItem: ChiefComplaintItem = {
      id: Math.random().toString(36).substring(2, 9),
      symptom: symptom.trim(),
      duration_val: 3,
      duration_unit: "days",
      notes: null,
    };
    onComplaintsChange([...complaints, newItem]);
    setCustomSymptom("");
  };

  const handleRemoveComplaint = (index: number) => {
    const updated = complaints.filter((_, i) => i !== index);
    onComplaintsChange(updated);
  };

  const handleUpdateDuration = (
    index: number,
    val: number,
    unit: "days" | "weeks" | "months" | "years"
  ) => {
    const updated = [...complaints];
    updated[index] = { ...updated[index], duration_val: val, duration_unit: unit };
    onComplaintsChange(updated);
  };

  const handleUpdateNotes = (index: number, notes: string) => {
    const updated = [...complaints];
    updated[index] = { ...updated[index], notes: notes || null };
    onComplaintsChange(updated);
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs space-y-6">
      {/* 1. Chief Complaints */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Clock className="w-5 h-5 text-[#1769E0]" />
            Chief Complaints
          </h3>
          <span className="text-xs text-gray-500 font-medium">
            {complaints.length} active {complaints.length === 1 ? "complaint" : "complaints"}
          </span>
        </div>

        {/* 1-Tap Quick Suggestion Chips */}
        {!disabled && (
          <div className="mb-4">
            <p className="text-xs font-medium text-gray-500 mb-2">Common OPD Complaints:</p>
            <div className="flex flex-wrap gap-1.5">
              {COMMON_OPD_COMPLAINTS.map((symptom) => {
                const isSelected = complaints.some(
                  (c) => c.symptom.toLowerCase() === symptom.toLowerCase()
                );
                return (
                  <button
                    key={symptom}
                    type="button"
                    disabled={isSelected}
                    onClick={() => handleAddSymptom(symptom)}
                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      isSelected
                        ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                        : "bg-[#F7F6F3] text-gray-700 hover:bg-[#EAF2FF] hover:text-[#1769E0] border border-gray-200"
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {symptom}
                  </button>
                );
              })}
            </div>

            {/* Custom Symptom Input */}
            <div className="flex items-center gap-2 mt-3 max-w-sm">
              <input
                type="text"
                placeholder="Or type custom complaint..."
                value={customSymptom}
                onChange={(e) => setCustomSymptom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddSymptom(customSymptom);
                  }
                }}
                className="w-full text-xs h-9 px-3 rounded-lg border border-gray-200 bg-white placeholder-gray-400 focus:outline-hidden focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0]"
              />
              <button
                type="button"
                onClick={() => handleAddSymptom(customSymptom)}
                disabled={!customSymptom.trim()}
                className="h-9 px-3 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        )}

        {/* Active Complaints List */}
        {complaints.length > 0 ? (
          <div className="space-y-3 pt-2">
            {complaints.map((item, index) => (
              <div
                key={item.id || index}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg border border-gray-100 bg-[#F7F6F3]/50"
              >
                <div className="flex-1">
                  <span className="text-sm font-semibold text-gray-900">{item.symptom}</span>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="text-xs text-gray-500">Duration:</span>
                    <div className="flex flex-wrap items-center gap-1">
                      {DURATION_PRESETS.map((preset) => {
                        const isPresetActive =
                          item.duration_val === preset.val && item.duration_unit === preset.unit;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            disabled={disabled}
                            onClick={() => handleUpdateDuration(index, preset.val, preset.unit)}
                            className={`px-2 py-0.5 rounded-sm text-[11px] font-medium transition-colors ${
                              isPresetActive
                                ? "bg-[#1769E0] text-white"
                                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Notes (e.g. nocturnal, dry)..."
                    value={item.notes || ""}
                    disabled={disabled}
                    onChange={(e) => handleUpdateNotes(index, e.target.value)}
                    className="text-xs h-8 px-2.5 rounded-md border border-gray-200 bg-white placeholder-gray-400 focus:outline-hidden focus:border-[#1769E0] w-full sm:w-72 md:w-96"
                  />
                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => handleRemoveComplaint(index)}
                      aria-label="Dismiss complaint"
                      className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 rounded-lg border border-dashed border-gray-200 text-center text-xs text-gray-400">
            No complaints added yet. Tap a quick chip above or type a symptom.
          </div>
        )}
      </div>

      {/* 2. Clinical Notes / History of Present Illness */}
      <div className="pt-2 border-t border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <label
            htmlFor="clinical-notes"
            className="text-xs font-semibold text-gray-700 flex items-center gap-1.5"
          >
            <FileText className="w-4 h-4 text-gray-500" />
            History of Present Illness & Clinical Notes
          </label>
        </div>
        <textarea
          id="clinical-notes"
          rows={3}
          value={clinicalNotes}
          disabled={disabled}
          onChange={(e) => onClinicalNotesChange(e.target.value)}
          placeholder="Detailed notes on symptom onset, progression, aggravating/relieving factors, prior medications taken..."
          className="w-full text-sm p-3 rounded-lg border border-gray-200 bg-white placeholder-gray-400 focus:outline-hidden focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0] min-h-[96px] resize-y"
        />
      </div>
    </div>
  );
}
