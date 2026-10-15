"use client";

import React, { useState } from "react";
import { PediatricsSpecialty } from "@/features/consultation/schema";
import {
  calculateWhoGrowthPercentile,
  IAP_IMMUNIZATION_SCHEDULE,
  Gender,
  WhoGrowthResult,
} from "@/lib/pediatrics/who-data";
import { Baby, Scale, Ruler, CheckCircle2, AlertTriangle, ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";

interface PediatricsToolsProps {
  data?: PediatricsSpecialty;
  onChange: (data: PediatricsSpecialty) => void;
  // Patient demographics & vitals passed from workspace for real-time calculations
  patientGender?: "male" | "female";
  patientAgeMonths?: number;
  currentWeightKg?: number | null;
  currentHeightCm?: number | null;
  disabled?: boolean;
}

export function PediatricsTools({
  data,
  onChange,
  patientGender = "male",
  patientAgeMonths = 24,
  currentWeightKg,
  currentHeightCm,
  disabled,
}: PediatricsToolsProps) {
  const [selectedAgeMonths, setSelectedAgeMonths] = useState<number>(patientAgeMonths);
  const [activeGender, setActiveGender] = useState<Gender>(patientGender);
  const [customWeight, setCustomWeight] = useState<string>(
    currentWeightKg != null ? currentWeightKg.toString() : ""
  );
  const [customHeight, setCustomHeight] = useState<string>(
    currentHeightCm != null ? currentHeightCm.toString() : ""
  );
  const [customHeadCirc, setCustomHeadCirc] = useState<string>(
    data?.head_circumference_cm != null ? data.head_circumference_cm.toString() : ""
  );
  const [expandedMilestones, setExpandedMilestones] = useState<Record<string, boolean>>({
    birth: true,
    "6w": true,
    "10w": false,
    "14w": false,
    "6m": false,
    "9m": false,
    "12m": false,
    "15m": false,
    "18m": false,
    "2y": false,
    "5y": false,
    "10y": false,
  });

  const birthHistory = data?.birth_history ?? {
    gestational_age_weeks: 38,
    birth_weight_kg: null,
    delivery_type: "normal",
    complications: "",
  };

  const immunizationsGiven = new Set(data?.immunizations_given ?? []);

  // Sync weight/height from props if state is empty
  const activeWeight = customWeight ? parseFloat(customWeight) : currentWeightKg ?? null;
  const activeHeight = customHeight ? parseFloat(customHeight) : currentHeightCm ?? null;
  const activeHeadCirc = customHeadCirc ? parseFloat(customHeadCirc) : data?.head_circumference_cm ?? null;

  // Growth calculations
  let weightGrowthResult: WhoGrowthResult | null = null;
  if (activeWeight != null && !isNaN(activeWeight) && activeWeight > 0) {
    weightGrowthResult = calculateWhoGrowthPercentile({
      ageMonths: selectedAgeMonths,
      gender: activeGender,
      metric: "weight",
      value: activeWeight,
    });
  }

  let heightGrowthResult: WhoGrowthResult | null = null;
  if (activeHeight != null && !isNaN(activeHeight) && activeHeight > 0) {
    heightGrowthResult = calculateWhoGrowthPercentile({
      ageMonths: selectedAgeMonths,
      gender: activeGender,
      metric: "height",
      value: activeHeight,
    });
  }

  let headCircGrowthResult: WhoGrowthResult | null = null;
  if (activeHeadCirc != null && !isNaN(activeHeadCirc) && activeHeadCirc > 0) {
    headCircGrowthResult = calculateWhoGrowthPercentile({
      ageMonths: selectedAgeMonths,
      gender: activeGender,
      metric: "head_circumference",
      value: activeHeadCirc,
    });
  }

  const handleBirthHistoryChange = (field: keyof typeof birthHistory, value: unknown) => {
    if (disabled) return;
    const updatedBirthHistory = {
      ...birthHistory,
      [field]: value,
    };
    onChange({
      specialty: "pediatrics",
      birth_history: updatedBirthHistory,
      head_circumference_cm: activeHeadCirc ?? undefined,
      immunizations_given: Array.from(immunizationsGiven),
    });
  };

  const handleHeadCircChange = (valStr: string) => {
    setCustomHeadCirc(valStr);
    if (disabled) return;
    const num = parseFloat(valStr);
    onChange({
      specialty: "pediatrics",
      birth_history: birthHistory,
      head_circumference_cm: isNaN(num) ? undefined : num,
      immunizations_given: Array.from(immunizationsGiven),
    });
  };

  const toggleVaccine = (code: string) => {
    if (disabled) return;
    const updated = new Set(immunizationsGiven);
    if (updated.has(code)) {
      updated.delete(code);
    } else {
      updated.add(code);
    }
    onChange({
      specialty: "pediatrics",
      birth_history: birthHistory,
      head_circumference_cm: activeHeadCirc ?? undefined,
      immunizations_given: Array.from(updated),
    });
  };

  const toggleMilestoneAccordion = (id: string) => {
    setExpandedMilestones((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  return (
    <div className="space-y-6">
      {/* Section 1: Birth History */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Baby className="h-4 w-4 text-brand-600" aria-hidden="true" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Birth & Perinatal History
          </h4>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
          {/* Gestational Age */}
          <div>
            <label
              htmlFor="peds-gestational-age"
              className="block text-xs font-medium text-gray-700 mb-1"
            >
              Gestational Age (weeks)
            </label>
            <input
              id="peds-gestational-age"
              type="number"
              min={20}
              max={45}
              disabled={disabled}
              value={birthHistory.gestational_age_weeks ?? ""}
              onChange={(e) =>
                handleBirthHistoryChange(
                  "gestational_age_weeks",
                  e.target.value ? parseInt(e.target.value, 10) : null
                )
              }
              placeholder="e.g. 38"
              className="w-full min-h-[44px] px-3 rounded-lg border border-gray-300 text-xs text-gray-900 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Birth Weight */}
          <div>
            <label
              htmlFor="peds-birth-weight"
              className="block text-xs font-medium text-gray-700 mb-1"
            >
              Birth Weight (kg)
            </label>
            <input
              id="peds-birth-weight"
              type="number"
              step="0.01"
              min={0.5}
              max={10}
              disabled={disabled}
              value={birthHistory.birth_weight_kg ?? ""}
              onChange={(e) =>
                handleBirthHistoryChange(
                  "birth_weight_kg",
                  e.target.value ? parseFloat(e.target.value) : null
                )
              }
              placeholder="e.g. 3.1"
              className="w-full min-h-[44px] px-3 rounded-lg border border-gray-300 text-xs text-gray-900 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Delivery Method */}
          <div>
            <label
              htmlFor="peds-delivery-type"
              className="block text-xs font-medium text-gray-700 mb-1"
            >
              Delivery Method
            </label>
            <select
              id="peds-delivery-type"
              disabled={disabled}
              value={birthHistory.delivery_type ?? "normal"}
              onChange={(e) =>
                handleBirthHistoryChange(
                  "delivery_type",
                  e.target.value as "normal" | "c_section" | "assisted"
                )
              }
              className="w-full min-h-[44px] px-3 rounded-lg border border-gray-300 text-xs text-gray-900 bg-white focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            >
              <option value="normal">Normal Vaginal Delivery</option>
              <option value="c_section">LSCS (Caesarean)</option>
              <option value="assisted">Assisted / Instrumental</option>
            </select>
          </div>

          {/* Complications */}
          <div>
            <label
              htmlFor="peds-complications"
              className="block text-xs font-medium text-gray-700 mb-1"
            >
              Perinatal Notes / NICU
            </label>
            <input
              id="peds-complications"
              type="text"
              disabled={disabled}
              value={birthHistory.complications ?? ""}
              onChange={(e) => handleBirthHistoryChange("complications", e.target.value)}
              placeholder="e.g. Uneventful, cried at birth"
              className="w-full min-h-[44px] px-3 rounded-lg border border-gray-300 text-xs text-gray-900 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>
      </div>

      {/* Section 2: WHO LMS Child Growth Percentile Engine */}
      <div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-brand-600" aria-hidden="true" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              WHO Child Growth Percentiles (LMS Standard)
            </h4>
          </div>

          {/* Age & Gender Parameters */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-gray-600">
              <label htmlFor="peds-calc-age" className="font-medium">
                Age:
              </label>
              <input
                id="peds-calc-age"
                type="number"
                min={0}
                max={60}
                value={selectedAgeMonths}
                onChange={(e) => setSelectedAgeMonths(parseInt(e.target.value, 10) || 0)}
                className="w-14 h-8 px-1.5 rounded border border-gray-300 text-xs text-center font-semibold text-gray-900"
              />
              <span className="text-gray-500">mos</span>
            </div>

            <div className="inline-flex rounded-lg p-0.5 bg-gray-100 border border-gray-200">
              <button
                type="button"
                onClick={() => setActiveGender("male")}
                className={`px-2 py-1 rounded text-[11px] font-semibold transition-all ${
                  activeGender === "male"
                    ? "bg-white text-gray-900 shadow-xs"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                Boy
              </button>
              <button
                type="button"
                onClick={() => setActiveGender("female")}
                className={`px-2 py-1 rounded text-[11px] font-semibold transition-all ${
                  activeGender === "female"
                    ? "bg-white text-gray-900 shadow-xs"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                Girl
              </button>
            </div>
          </div>
        </div>

        {/* 3 Metric Cards: Weight, Height, Head Circumference */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Weight Card */}
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-700">Weight-for-Age</span>
              <Scale className="h-3.5 w-3.5 text-gray-400" />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                min={1}
                max={40}
                value={customWeight}
                onChange={(e) => setCustomWeight(e.target.value)}
                placeholder="kg"
                className="w-24 min-h-[40px] px-2.5 rounded-lg border border-gray-300 text-sm font-semibold text-gray-900 focus:outline-none focus:border-brand-500"
              />
              <span className="text-xs text-gray-500 font-medium">kg</span>
            </div>
            {weightGrowthResult ? (
              <div className="pt-1">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                    weightGrowthResult.variant === "success"
                      ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                      : weightGrowthResult.variant === "warning"
                      ? "bg-amber-50 text-amber-800 border border-amber-200"
                      : "bg-rose-50 text-rose-800 border border-rose-200"
                  }`}
                >
                  {weightGrowthResult.label} (Z: {weightGrowthResult.zScore})
                </span>
              </div>
            ) : (
              <span className="text-[11px] text-gray-400 italic block">
                Enter weight to compute WHO percentile
              </span>
            )}
          </div>

          {/* Height Card */}
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-700">Height-for-Age</span>
              <Ruler className="h-3.5 w-3.5 text-gray-400" />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.5"
                min={30}
                max={140}
                value={customHeight}
                onChange={(e) => setCustomHeight(e.target.value)}
                placeholder="cm"
                className="w-24 min-h-[40px] px-2.5 rounded-lg border border-gray-300 text-sm font-semibold text-gray-900 focus:outline-none focus:border-brand-500"
              />
              <span className="text-xs text-gray-500 font-medium">cm</span>
            </div>
            {heightGrowthResult ? (
              <div className="pt-1">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                    heightGrowthResult.variant === "success"
                      ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                      : heightGrowthResult.variant === "warning"
                      ? "bg-amber-50 text-amber-800 border border-amber-200"
                      : "bg-rose-50 text-rose-800 border border-rose-200"
                  }`}
                >
                  {heightGrowthResult.label} (Z: {heightGrowthResult.zScore})
                </span>
              </div>
            ) : (
              <span className="text-[11px] text-gray-400 italic block">
                Enter height to compute WHO percentile
              </span>
            )}
          </div>

          {/* Head Circumference Card */}
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-700">Head Circumference</span>
              <Baby className="h-3.5 w-3.5 text-gray-400" />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                min={25}
                max={65}
                disabled={disabled}
                value={customHeadCirc}
                onChange={(e) => handleHeadCircChange(e.target.value)}
                placeholder="cm"
                className="w-24 min-h-[40px] px-2.5 rounded-lg border border-gray-300 text-sm font-semibold text-gray-900 focus:outline-none focus:border-brand-500"
              />
              <span className="text-xs text-gray-500 font-medium">cm</span>
            </div>
            {headCircGrowthResult ? (
              <div className="pt-1">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                    headCircGrowthResult.variant === "success"
                      ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                      : headCircGrowthResult.variant === "warning"
                      ? "bg-amber-50 text-amber-800 border border-amber-200"
                      : "bg-rose-50 text-rose-800 border border-rose-200"
                  }`}
                >
                  {headCircGrowthResult.label} (Z: {headCircGrowthResult.zScore})
                </span>
              </div>
            ) : (
              <span className="text-[11px] text-gray-400 italic block">
                Enter head circumference to compute percentile
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Section 3: IAP Immunization Checklist (Indian Academy of Pediatrics) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-brand-600" aria-hidden="true" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              IAP Immunization Schedule (ACVIP Recommendations)
            </h4>
          </div>
          <span className="text-xs text-gray-500">
            {immunizationsGiven.size} vaccines administered
          </span>
        </div>

        <div className="space-y-2">
          {IAP_IMMUNIZATION_SCHEDULE.map((milestone) => {
            const isExpanded = expandedMilestones[milestone.id] ?? false;
            const administeredInMilestone = milestone.vaccines.filter((v) =>
              immunizationsGiven.has(v.code)
            ).length;
            const totalInMilestone = milestone.vaccines.length;
            const isComplete = administeredInMilestone === totalInMilestone;

            return (
              <div
                key={milestone.id}
                className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-xs"
              >
                {/* Milestone Accordion Header */}
                <button
                  type="button"
                  onClick={() => toggleMilestoneAccordion(milestone.id)}
                  aria-expanded={isExpanded}
                  className="w-full min-h-[44px] px-4 py-2.5 flex items-center justify-between text-left hover:bg-gray-50/70 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-gray-900 w-20">
                      {milestone.ageLabel}
                    </span>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
                        isComplete
                          ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                          : administeredInMilestone > 0
                          ? "bg-blue-50 text-blue-800 border border-blue-200"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {administeredInMilestone} / {totalInMilestone} given
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-gray-400">
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </button>

                {/* Milestone Vaccines Grid */}
                {isExpanded && (
                  <div className="p-3 bg-gray-50/40 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {milestone.vaccines.map((vaccine) => {
                      const isGiven = immunizationsGiven.has(vaccine.code);
                      return (
                        <button
                          key={vaccine.code}
                          type="button"
                          disabled={disabled}
                          onClick={() => toggleVaccine(vaccine.code)}
                          aria-pressed={isGiven}
                          aria-label={`Toggle vaccine ${vaccine.name}`}
                          className={`min-h-[44px] p-2.5 rounded-lg border text-left transition-all flex items-center justify-between ${
                            isGiven
                              ? "bg-emerald-50 border-emerald-300 text-emerald-900 shadow-xs"
                              : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300"
                          } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                        >
                          <div className="min-w-0 pr-2">
                            <span className="block text-xs font-semibold truncate">
                              {vaccine.name}
                            </span>
                            {vaccine.description && (
                              <span className="block text-[10px] text-gray-500 truncate">
                                {vaccine.description}
                              </span>
                            )}
                          </div>
                          <div className="flex-shrink-0">
                            {isGiven ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                Given ✓
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-500">
                                Due
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
