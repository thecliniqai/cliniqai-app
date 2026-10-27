"use client";

import React, { useState, useEffect } from "react";
import { Pill, Plus, Check, Sparkles } from "lucide-react";
import { getFrequentPrescriptionsAction } from "@/features/ai/actions";
import { PrescriptionSuggestion } from "@/lib/ai/types";

export interface FrequentRxChipsProps {
  diagnosis?: string | null;
  doctorId?: string;
  onSelectSuggestion: (suggestion: PrescriptionSuggestion) => void;
  disabled?: boolean;
}

export function FrequentRxChips({
  diagnosis,
  doctorId,
  onSelectSuggestion,
  disabled = false,
}: FrequentRxChipsProps) {
  const [suggestions, setSuggestions] = useState<PrescriptionSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [justAddedKey, setJustAddedKey] = useState<string | null>(null);

  useEffect(() => {
    const cleanDiag = (diagnosis || "").trim();
    if (!cleanDiag || cleanDiag.length < 2) {
      setSuggestions([]);
      return;
    }

    let isCancelled = false;
    setIsLoading(true);

    getFrequentPrescriptionsAction({
      diagnosis: cleanDiag,
      doctorId,
      limit: 6,
    })
      .then((res) => {
        if (!isCancelled && res.success && res.suggestions) {
          setSuggestions(res.suggestions);
        } else if (!isCancelled) {
          setSuggestions([]);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch frequent prescriptions:", err);
        if (!isCancelled) setSuggestions([]);
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [diagnosis, doctorId]);

  if (suggestions.length === 0 || disabled) {
    return null;
  }

  const handleChipClick = (sug: PrescriptionSuggestion) => {
    const key = `${sug.drug_name}_${sug.dosage}_${sug.frequency}`;
    setJustAddedKey(key);
    onSelectSuggestion(sug);
    setTimeout(() => {
      setJustAddedKey((curr) => (curr === key ? null : curr));
    }, 1500);
  };

  return (
    <div className="py-2 space-y-1.5 transition-all">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500">
        <Sparkles className="h-3 w-3 text-brand-600" />
        <span>Frequently Prescribed by You for &ldquo;{diagnosis}&rdquo;:</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
        {suggestions.map((sug, idx) => {
          const key = `${sug.drug_name}_${sug.dosage}_${sug.frequency}`;
          const isAdded = justAddedKey === key;

          return (
            <button
              key={`${key}-${idx}`}
              type="button"
              onClick={() => handleChipClick(sug)}
              className={`min-h-[32px] inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer ${
                isAdded
                  ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                  : "bg-gray-100 hover:bg-brand-50 hover:text-brand-800 hover:border-brand-200 text-gray-700 border-gray-200"
              }`}
              title={`Prescribed ${sug.frequency_count} time(s) previously`}
            >
              {isAdded ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <Plus className="h-3.5 w-3.5 text-gray-400 group-hover:text-brand-600" />
              )}
              <span className="font-semibold">{sug.drug_name}</span>
              <span className="text-gray-500 text-[11px]">
                ({sug.frequency}, {sug.duration})
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
