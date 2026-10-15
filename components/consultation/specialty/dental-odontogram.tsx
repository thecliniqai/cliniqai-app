"use client";

import React, { useState } from "react";
import {
  DentalSpecialty,
  DentalTooth,
  DentalConditionTag,
  VALID_FDI_TEETH,
} from "@/features/consultation/schema";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Info, X } from "lucide-react";

interface DentalOdontogramProps {
  data?: DentalSpecialty;
  onChange: (data: DentalSpecialty) => void;
  disabled?: boolean;
}

type DentitionMode = "adult" | "deciduous";

interface ConditionMeta {
  tag: DentalConditionTag;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

const CONDITION_METAS: ConditionMeta[] = [
  { tag: "decay", label: "Decay / Caries", color: "#EF4444", bgColor: "bg-red-50", borderColor: "border-red-300" },
  { tag: "filled", label: "Filled / Restored", color: "#3B82F6", bgColor: "bg-blue-50", borderColor: "border-blue-300" },
  { tag: "rct", label: "RCT", color: "#A855F7", bgColor: "bg-purple-50", borderColor: "border-purple-300" },
  { tag: "crown", label: "Crown / Cap", color: "#F59E0B", bgColor: "bg-amber-50", borderColor: "border-amber-300" },
  { tag: "missing", label: "Missing", color: "#64748B", bgColor: "bg-slate-50", borderColor: "border-slate-300" },
  { tag: "extraction", label: "Extract Advised", color: "#991B1B", bgColor: "bg-rose-50", borderColor: "border-rose-400" },
];

const ADULT_UPPER_RIGHT = [18, 17, 16, 15, 14, 13, 12, 11];
const ADULT_UPPER_LEFT = [21, 22, 23, 24, 25, 26, 27, 28];
const ADULT_LOWER_RIGHT = [48, 47, 46, 45, 44, 43, 42, 41];
const ADULT_LOWER_LEFT = [31, 32, 33, 34, 35, 36, 37, 38];

const DECIDUOUS_UPPER_RIGHT = [55, 54, 53, 52, 51];
const DECIDUOUS_UPPER_LEFT = [61, 62, 63, 64, 65];
const DECIDUOUS_LOWER_RIGHT = [85, 84, 83, 82, 81];
const DECIDUOUS_LOWER_LEFT = [71, 72, 73, 74, 75];

export function getToothDescription(toothNum: number): string {
  const quadrant = Math.floor(toothNum / 10);
  const position = toothNum % 10;

  const quadrantNames: Record<number, string> = {
    1: "Upper Right",
    2: "Upper Left",
    3: "Lower Left",
    4: "Lower Right",
    5: "Deciduous Upper Right",
    6: "Deciduous Upper Left",
    7: "Deciduous Lower Left",
    8: "Deciduous Lower Right",
  };

  const toothNames: Record<number, string> = {
    1: "Central Incisor",
    2: "Lateral Incisor",
    3: "Canine",
    4: "First Premolar",
    5: "Second Premolar",
    6: "First Molar",
    7: "Second Molar",
    8: "Third Molar (Wisdom)",
  };

  const deciduousToothNames: Record<number, string> = {
    1: "Central Incisor",
    2: "Lateral Incisor",
    3: "Canine",
    4: "First Molar",
    5: "Second Molar",
  };

  const qName = quadrantNames[quadrant] || "Tooth";
  const tName = quadrant <= 4 ? toothNames[position] : deciduousToothNames[position];
  return `${qName} ${tName || ""}`.trim();
}

export function DentalOdontogram({ data, onChange, disabled }: DentalOdontogramProps) {
  const [mode, setMode] = useState<DentitionMode>("adult");
  const [selectedTooth, setSelectedTooth] = useState<number | null>(null);

  const odontogram: DentalTooth[] = data?.odontogram ?? [];
  const generalNotes = data?.general_notes ?? "";

  const toothMap = new Map<number, DentalTooth>();
  for (const t of odontogram) {
    toothMap.set(t.tooth_number, t);
  }

  const handleToggleCondition = (toothNum: number, tag: DentalConditionTag) => {
    if (disabled) return;
    const existing = toothMap.get(toothNum);
    let updatedConditions: DentalConditionTag[] = [];

    if (existing) {
      if (existing.condition_tags.includes(tag)) {
        updatedConditions = existing.condition_tags.filter((t) => t !== tag);
      } else {
        updatedConditions = [...existing.condition_tags, tag];
      }
    } else {
      updatedConditions = [tag];
    }

    let updatedList: DentalTooth[];
    if (updatedConditions.length === 0 && !existing?.notes) {
      // Remove completely if no tags and no notes
      updatedList = odontogram.filter((t) => t.tooth_number !== toothNum);
    } else {
      const updatedTooth: DentalTooth = {
        tooth_number: toothNum,
        condition_tags: updatedConditions,
        notes: existing?.notes ?? null,
      };
      updatedList = odontogram.some((t) => t.tooth_number === toothNum)
        ? odontogram.map((t) => (t.tooth_number === toothNum ? updatedTooth : t))
        : [...odontogram, updatedTooth];
    }

    onChange({
      specialty: "dental",
      odontogram: updatedList,
      general_notes: generalNotes,
    });
  };

  const handleUpdateToothNotes = (toothNum: number, notes: string) => {
    if (disabled) return;
    const existing = toothMap.get(toothNum);
    const cleanedNotes = notes.trim() === "" ? null : notes;

    let updatedList: DentalTooth[];
    if (!cleanedNotes && (!existing || existing.condition_tags.length === 0)) {
      updatedList = odontogram.filter((t) => t.tooth_number !== toothNum);
    } else {
      const updatedTooth: DentalTooth = {
        tooth_number: toothNum,
        condition_tags: existing?.condition_tags ?? [],
        notes: cleanedNotes,
      };
      updatedList = odontogram.some((t) => t.tooth_number === toothNum)
        ? odontogram.map((t) => (t.tooth_number === toothNum ? updatedTooth : t))
        : [...odontogram, updatedTooth];
    }

    onChange({
      specialty: "dental",
      odontogram: updatedList,
      general_notes: generalNotes,
    });
  };

  const handleClearTooth = (toothNum: number) => {
    if (disabled) return;
    const updatedList = odontogram.filter((t) => t.tooth_number !== toothNum);
    onChange({
      specialty: "dental",
      odontogram: updatedList,
      general_notes: generalNotes,
    });
    setSelectedTooth(null);
  };

  const renderToothCell = (toothNum: number) => {
    const toothData = toothMap.get(toothNum);
    const hasConditions = (toothData?.condition_tags.length ?? 0) > 0;
    const isSelected = selectedTooth === toothNum;
    const isMissing = toothData?.condition_tags.includes("missing");
    const isDecay = toothData?.condition_tags.includes("decay");
    const isFilled = toothData?.condition_tags.includes("filled");
    const isRct = toothData?.condition_tags.includes("rct");
    const isCrown = toothData?.condition_tags.includes("crown");
    const isExtraction = toothData?.condition_tags.includes("extraction");

    // Primary fill calculation
    let fill = "#FFFFFF";
    let stroke = "#CBD5E1";
    if (isMissing) {
      fill = "#F1F5F9";
      stroke = "#94A3B8";
    } else if (isDecay) {
      fill = "#FEE2E2";
      stroke = "#EF4444";
    } else if (isRct) {
      fill = "#F3E8FF";
      stroke = "#A855F7";
    } else if (isCrown) {
      fill = "#FEF3C7";
      stroke = "#F59E0B";
    } else if (isFilled) {
      fill = "#DBEAFE";
      stroke = "#3B82F6";
    }

    if (isExtraction) {
      stroke = "#991B1B";
    }

    return (
      <button
        key={toothNum}
        type="button"
        disabled={disabled}
        onClick={() => setSelectedTooth(selectedTooth === toothNum ? null : toothNum)}
        aria-label={`Tooth ${toothNum}: ${getToothDescription(toothNum)}. ${
          hasConditions ? `Conditions: ${toothData?.condition_tags.join(", ")}` : "No conditions"
        }`}
        aria-pressed={isSelected}
        className={`relative flex flex-col items-center justify-center p-1 min-w-[42px] min-h-[52px] rounded-lg border transition-all ${
          isSelected
            ? "ring-2 ring-brand-500 border-brand-500 bg-brand-50/20 scale-105 z-10"
            : hasConditions
            ? "border-gray-300 hover:border-gray-400 bg-white"
            : "border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50/50"
        } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
      >
        {/* Anatomical Tooth SVG */}
        <svg
          viewBox="0 0 32 38"
          className="w-6 h-7 transition-transform"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Root */}
          <path
            d="M9 20C9 28 11 34 12 36C12.5 37 13.5 37 14 36C14.5 35 15.5 28 16 20C16.5 28 17.5 35 18 36C18.5 37 19.5 37 20 36C21 34 23 28 23 20H9Z"
            fill={fill}
            stroke={stroke}
            strokeWidth={isExtraction ? "2" : "1.2"}
          />
          {/* Crown */}
          <rect
            x="6"
            y="4"
            width="20"
            height="16"
            rx="5"
            fill={fill}
            stroke={stroke}
            strokeWidth={isExtraction ? "2" : "1.2"}
          />
          {/* Occlusal surface lines */}
          <path
            d="M10 12H22M16 6V18"
            stroke={stroke}
            strokeWidth="0.8"
            strokeLinecap="round"
            opacity={isMissing ? 0.2 : 0.6}
          />
          {/* Missing cross */}
          {isMissing && (
            <path
              d="M7 5L25 33M25 5L7 33"
              stroke="#64748B"
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}
        </svg>

        <span
          className={`text-[11px] font-semibold mt-0.5 tracking-tight ${
            isSelected
              ? "text-brand-600 font-bold"
              : hasConditions
              ? "text-gray-900"
              : "text-gray-600"
          }`}
        >
          {toothNum}
        </span>

        {/* Multi-condition badge dots */}
        {hasConditions && (
          <div className="absolute top-0.5 right-0.5 flex gap-0.5" aria-hidden="true">
            {toothData?.condition_tags.slice(0, 3).map((tag) => {
              const meta = CONDITION_METAS.find((m) => m.tag === tag);
              return (
                <span
                  key={tag}
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: meta?.color ?? "#94A3B8" }}
                />
              );
            })}
          </div>
        )}
      </button>
    );
  };

  const upperRightTeeth = mode === "adult" ? ADULT_UPPER_RIGHT : DECIDUOUS_UPPER_RIGHT;
  const upperLeftTeeth = mode === "adult" ? ADULT_UPPER_LEFT : DECIDUOUS_UPPER_LEFT;
  const lowerRightTeeth = mode === "adult" ? ADULT_LOWER_RIGHT : DECIDUOUS_LOWER_RIGHT;
  const lowerLeftTeeth = mode === "adult" ? ADULT_LOWER_LEFT : DECIDUOUS_LOWER_LEFT;

  const currentToothData = selectedTooth ? toothMap.get(selectedTooth) : null;

  return (
    <div className="space-y-6">
      {/* Top Header & Dentition Switcher */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Interactive Odontogram (FDI Two-Digit Standard)
          </h4>
          <p className="text-xs text-gray-500 mt-0.5">
            Click any tooth to record caries, restorations, RCT, crown, or extraction plans.
          </p>
        </div>

        {/* Dentition Toggle */}
        <div className="inline-flex rounded-lg p-0.5 bg-gray-100 border border-gray-200">
          <button
            type="button"
            onClick={() => setMode("adult")}
            aria-pressed={mode === "adult"}
            className={`min-h-[36px] px-3 rounded-md text-xs font-semibold transition-all ${
              mode === "adult"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Adult (32 Teeth)
          </button>
          <button
            type="button"
            onClick={() => setMode("deciduous")}
            aria-pressed={mode === "deciduous"}
            className={`min-h-[36px] px-3 rounded-md text-xs font-semibold transition-all ${
              mode === "deciduous"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Deciduous (20 Teeth)
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-gray-500 font-medium">Legend:</span>
        {CONDITION_METAS.map(({ tag, label, color }) => (
          <div key={tag} className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
            <span className="text-gray-600 text-[11px]">{label}</span>
          </div>
        ))}
      </div>

      {/* Dental Odontogram Visual Chart Container */}
      <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 overflow-x-auto">
        <div className="min-w-[620px] flex flex-col items-center gap-4">
          {/* Upper Arch / Maxilla */}
          <div className="w-full">
            <div className="text-center text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
              Maxillary Arch (Upper Jaw)
            </div>
            <div className="flex items-center justify-center gap-1 sm:gap-2">
              {/* Right quadrant */}
              <div className="flex items-center gap-1 bg-white p-2 rounded-lg border border-gray-200 shadow-xs">
                {upperRightTeeth.map(renderToothCell)}
              </div>

              {/* Midline divider */}
              <div
                className="w-px h-12 bg-gray-300 mx-1 flex flex-col items-center justify-center"
                title="Dental Midline"
                aria-hidden="true"
              >
                <span className="text-[9px] text-gray-400 font-bold">|</span>
              </div>

              {/* Left quadrant */}
              <div className="flex items-center gap-1 bg-white p-2 rounded-lg border border-gray-200 shadow-xs">
                {upperLeftTeeth.map(renderToothCell)}
              </div>
            </div>
            <div className="flex justify-between px-10 text-[10px] font-semibold text-gray-400 mt-1 uppercase tracking-wider">
              <span>Patient Right</span>
              <span>Patient Left</span>
            </div>
          </div>

          <div className="w-full border-t border-dashed border-gray-300" aria-hidden="true" />

          {/* Lower Arch / Mandible */}
          <div className="w-full">
            <div className="flex items-center justify-center gap-1 sm:gap-2">
              {/* Right quadrant */}
              <div className="flex items-center gap-1 bg-white p-2 rounded-lg border border-gray-200 shadow-xs">
                {lowerRightTeeth.map(renderToothCell)}
              </div>

              {/* Midline divider */}
              <div
                className="w-px h-12 bg-gray-300 mx-1 flex flex-col items-center justify-center"
                title="Dental Midline"
                aria-hidden="true"
              >
                <span className="text-[9px] text-gray-400 font-bold">|</span>
              </div>

              {/* Left quadrant */}
              <div className="flex items-center gap-1 bg-white p-2 rounded-lg border border-gray-200 shadow-xs">
                {lowerLeftTeeth.map(renderToothCell)}
              </div>
            </div>
            <div className="text-center text-[11px] font-semibold uppercase tracking-wider text-gray-500 mt-2">
              Mandibular Arch (Lower Jaw)
            </div>
          </div>
        </div>
      </div>

      {/* Floating Tooth Action Popover / Drawer Card */}
      {selectedTooth !== null && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-4 animate-in fade-in duration-150">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center h-6 w-8 rounded bg-brand-50 border border-brand-200 text-xs font-bold text-brand-700">
                  #{selectedTooth}
                </span>
                <h5 className="text-sm font-semibold text-gray-900">
                  {getToothDescription(selectedTooth)}
                </h5>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Toggle condition tags and add specific procedure or observation notes.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedTooth(null)}
              aria-label="Close tooth details"
              className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Condition Chips */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-2">
              Clinical Conditions & Procedures:
            </label>
            <div className="flex flex-wrap gap-2">
              {CONDITION_METAS.map(({ tag, label, color, bgColor, borderColor }) => {
                const isActive = currentToothData?.condition_tags.includes(tag) ?? false;
                return (
                  <button
                    key={tag}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleToggleCondition(selectedTooth, tag)}
                    aria-pressed={isActive}
                    className={`min-h-[44px] px-3.5 py-1.5 rounded-lg border text-xs font-semibold transition-all flex items-center gap-2 ${
                      isActive
                        ? `${bgColor} ${borderColor} shadow-xs`
                        : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300"
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                    <span>{label}</span>
                    {isActive && <span className="text-[10px] font-bold text-gray-500 ml-0.5">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tooth Specific Notes */}
          <div>
            <label
              htmlFor={`tooth-notes-${selectedTooth}`}
              className="block text-xs font-semibold text-gray-700 mb-1"
            >
              Tooth Notes / Advised Treatment:
            </label>
            <input
              id={`tooth-notes-${selectedTooth}`}
              type="text"
              disabled={disabled}
              value={currentToothData?.notes ?? ""}
              onChange={(e) => handleUpdateToothNotes(selectedTooth, e.target.value)}
              placeholder="e.g. Deep mesial decay, tender on percussion, advise RCT"
              className="w-full min-h-[38px] px-3 rounded-lg border border-gray-300 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 bg-white"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              disabled={disabled || (!currentToothData?.condition_tags.length && !currentToothData?.notes)}
              onClick={() => handleClearTooth(selectedTooth)}
              className="min-h-[44px] px-3 rounded-lg text-xs font-medium text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Clear Tooth Conditions</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedTooth(null)}
              className="min-h-[44px] px-4 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-800 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Flagged Teeth Summary Table */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h5 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Odontogram Findings Summary ({odontogram.length})
          </h5>
        </div>

        {odontogram.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-xs text-gray-500 bg-white">
            No dental conditions flagged yet. Click any tooth above to record clinical findings.
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase text-[10px] tracking-wider font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Tooth #</th>
                  <th className="py-2.5 px-3">Description</th>
                  <th className="py-2.5 px-3">Conditions</th>
                  <th className="py-2.5 px-3">Notes / Plan</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {odontogram.map((tooth) => (
                  <tr key={tooth.tooth_number} className="hover:bg-gray-50/50">
                    <td className="py-2.5 px-3 font-semibold text-gray-900">
                      #{tooth.tooth_number}
                    </td>
                    <td className="py-2.5 px-3 text-gray-600">
                      {getToothDescription(tooth.tooth_number)}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap gap-1">
                        {tooth.condition_tags.map((tag) => {
                          const meta = CONDITION_METAS.find((m) => m.tag === tag);
                          return (
                            <span
                              key={tag}
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${
                                meta?.bgColor ?? "bg-gray-50"
                              } ${meta?.borderColor ?? "border-gray-200"}`}
                              style={{ color: meta?.color ?? "#1F2937" }}
                            >
                              {meta?.label ?? tag}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-gray-700 italic">
                      {tooth.notes || <span className="text-gray-400 not-italic">—</span>}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => handleClearTooth(tooth.tooth_number)}
                        aria-label={`Remove conditions for tooth ${tooth.tooth_number}`}
                        className="p-1 rounded text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* General Dental Notes */}
      <div>
        <label
          htmlFor="dental-general-notes"
          className="block text-xs font-semibold text-gray-700 mb-1"
        >
          General Dental & Periodontal Notes:
        </label>
        <textarea
          id="dental-general-notes"
          rows={2}
          disabled={disabled}
          value={generalNotes}
          onChange={(e) =>
            onChange({
              specialty: "dental",
              odontogram,
              general_notes: e.target.value,
            })
          }
          placeholder="e.g. Generalized mild gingivitis, calculus on lingual surfaces of lower anterior teeth. Scaling advised."
          className="w-full text-xs text-gray-900 placeholder:text-gray-400 rounded-lg border border-gray-300 p-2.5 bg-white focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
      </div>
    </div>
  );
}
