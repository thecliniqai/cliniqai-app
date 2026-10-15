"use client";

import React from "react";
import { GPSpecialty } from "@/features/consultation/schema";
import { Stethoscope, Activity, Heart, Wind, ShieldAlert, Brain } from "lucide-react";

interface GPSystemicReviewProps {
  data?: GPSpecialty;
  onChange: (data: GPSpecialty) => void;
  disabled?: boolean;
}

type PiccleKey = "pallor" | "icterus" | "cyanosis" | "clubbing" | "lymphadenopathy" | "edema";

interface PiccleSign {
  key: PiccleKey;
  label: string;
  description: string;
}

const PICCLE_SIGNS: PiccleSign[] = [
  { key: "pallor", label: "Pallor", description: "Conjunctiva / Palms" },
  { key: "icterus", label: "Icterus", description: "Sclera (Jaundice)" },
  { key: "cyanosis", label: "Cyanosis", description: "Lips / Nailbeds" },
  { key: "clubbing", label: "Clubbing", description: "Digits / Lovibond angle" },
  { key: "lymphadenopathy", label: "Lymphadenopathy", description: "Cervical / Axillary / Inguinal" },
  { key: "edema", label: "Edema", description: "Bilateral pedal / Pitting" },
];

export function GPSystemicReview({ data, onChange, disabled }: GPSystemicReviewProps) {
  const generalExam = data?.general_exam ?? {
    pallor: false,
    icterus: false,
    cyanosis: false,
    clubbing: false,
    lymphadenopathy: false,
    edema: false,
  };

  const systemic = data?.systemic ?? {
    cvs: "",
    rs: "",
    pa: "",
    cns: "",
  };

  const toggleSign = (key: keyof typeof generalExam) => {
    if (disabled) return;
    const updatedExam = {
      ...generalExam,
      [key]: !generalExam[key],
    };
    onChange({
      specialty: "general_physician",
      general_exam: updatedExam,
      systemic,
    });
  };

  const handleSystemicChange = (field: keyof typeof systemic, value: string) => {
    if (disabled) return;
    const updatedSystemic = {
      ...systemic,
      [field]: value,
    };
    onChange({
      specialty: "general_physician",
      general_exam: generalExam,
      systemic: updatedSystemic,
    });
  };

  const presentCount = Object.values(generalExam).filter(Boolean).length;

  return (
    <div className="space-y-6">
      {/* General Physical Examination: PICCLE Signs */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-brand-600" aria-hidden="true" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              General Physical Examination (PICCLe)
            </h4>
          </div>
          <span className="text-xs text-gray-500">
            {presentCount === 0 ? (
              <span className="text-gray-500 font-medium">All signs absent</span>
            ) : (
              <span className="text-amber-700 font-medium">
                {presentCount} abnormal {presentCount === 1 ? "sign" : "signs"} noted
              </span>
            )}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {PICCLE_SIGNS.map(({ key, label, description }) => {
            const isPresent = generalExam[key] ?? false;
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleSign(key)}
                disabled={disabled}
                aria-pressed={isPresent}
                aria-label={`Toggle ${label} sign`}
                className={`min-h-[44px] p-2.5 rounded-lg border text-left transition-all flex flex-col justify-between ${
                  isPresent
                    ? "bg-amber-50/80 border-amber-300 text-amber-900 shadow-sm"
                    : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300"
                } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-xs font-semibold">{label}</span>
                  <span
                    className={`h-2 w-2 rounded-full ${
                      isPresent ? "bg-amber-500 ring-4 ring-amber-100" : "bg-gray-300"
                    }`}
                    aria-hidden="true"
                  />
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-[10px] text-gray-500 truncate">{description}</span>
                  <span
                    className={`text-[10px] font-medium uppercase tracking-wider ml-1 ${
                      isPresent ? "text-amber-700 font-semibold" : "text-gray-400"
                    }`}
                  >
                    {isPresent ? "Present" : "Absent"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Systemic Examination (CVS, RS, PA, CNS) */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Stethoscope className="h-4 w-4 text-brand-600" aria-hidden="true" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Systemic Examination
          </h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* CVS */}
          <div className="rounded-lg border border-gray-200 bg-white p-3.5 focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500 transition-colors">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Heart className="h-3.5 w-3.5 text-rose-500" aria-hidden="true" />
              <label
                htmlFor="exam-cvs"
                className="text-xs font-semibold text-gray-800"
              >
                Cardiovascular System (CVS)
              </label>
            </div>
            <textarea
              id="exam-cvs"
              rows={2}
              disabled={disabled}
              value={systemic.cvs ?? ""}
              onChange={(e) => handleSystemicChange("cvs", e.target.value)}
              placeholder="S1 S2 heard, no murmurs"
              className="w-full text-xs text-gray-900 placeholder:text-gray-400 bg-transparent resize-y focus:outline-none"
            />
          </div>

          {/* RS */}
          <div className="rounded-lg border border-gray-200 bg-white p-3.5 focus-within:border-brand-500 focus-within:ring-1 focus-brand-500 transition-colors">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Wind className="h-3.5 w-3.5 text-sky-500" aria-hidden="true" />
              <label
                htmlFor="exam-rs"
                className="text-xs font-semibold text-gray-800"
              >
                Respiratory System (RS)
              </label>
            </div>
            <textarea
              id="exam-rs"
              rows={2}
              disabled={disabled}
              value={systemic.rs ?? ""}
              onChange={(e) => handleSystemicChange("rs", e.target.value)}
              placeholder="Bilateral vesicular breath sounds, no added sounds"
              className="w-full text-xs text-gray-900 placeholder:text-gray-400 bg-transparent resize-y focus:outline-none"
            />
          </div>

          {/* PA (Per Abdomen) */}
          <div className="rounded-lg border border-gray-200 bg-white p-3.5 focus-within:border-brand-500 focus-within:ring-1 focus-brand-500 transition-colors">
            <div className="flex items-center gap-1.5 mb-1.5">
              <ShieldAlert className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
              <label
                htmlFor="exam-pa"
                className="text-xs font-semibold text-gray-800"
              >
                Per Abdomen (PA)
              </label>
            </div>
            <textarea
              id="exam-pa"
              rows={2}
              disabled={disabled}
              value={systemic.pa ?? ""}
              onChange={(e) => handleSystemicChange("pa", e.target.value)}
              placeholder="Soft, non-tender, no organomegaly"
              className="w-full text-xs text-gray-900 placeholder:text-gray-400 bg-transparent resize-y focus:outline-none"
            />
          </div>

          {/* CNS */}
          <div className="rounded-lg border border-gray-200 bg-white p-3.5 focus-within:border-brand-500 focus-within:ring-1 focus-brand-500 transition-colors">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Brain className="h-3.5 w-3.5 text-purple-500" aria-hidden="true" />
              <label
                htmlFor="exam-cns"
                className="text-xs font-semibold text-gray-800"
              >
                Central Nervous System (CNS)
              </label>
            </div>
            <textarea
              id="exam-cns"
              rows={2}
              disabled={disabled}
              value={systemic.cns ?? ""}
              onChange={(e) => handleSystemicChange("cns", e.target.value)}
              placeholder="Conscious, oriented, no focal neurological deficits"
              className="w-full text-xs text-gray-900 placeholder:text-gray-400 bg-transparent resize-y focus:outline-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
