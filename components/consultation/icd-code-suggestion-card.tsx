"use client";

import React from "react";
import { Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface IcdCodeCandidate {
  code: string;
  description: string;
  match_score?: number;
  differential_criteria?: string | string[];
}

export interface IcdCodeSuggestionCardProps {
  candidate: IcdCodeCandidate;
  onApply: (code: string, description: string) => void;
  isApplied?: boolean;
  className?: string;
}

export function IcdCodeSuggestionCard({
  candidate,
  onApply,
  isApplied = false,
  className,
}: IcdCodeSuggestionCardProps) {
  const criteriaList = Array.isArray(candidate.differential_criteria)
    ? candidate.differential_criteria
    : candidate.differential_criteria
    ? [candidate.differential_criteria]
    : [];

  return (
    <div
      className={cn(
        "rounded-xl border border-[#E4E5E7] bg-white p-3.5 shadow-2xs hover:border-[#1769E0]/40 transition-colors my-2",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-semibold text-[#1769E0] bg-[#EAF2FF] px-2 py-0.5 rounded border border-[#C7D2FE]">
            {candidate.code}
          </span>
          <span className="text-xs font-semibold text-[#17181A]">
            {candidate.description}
          </span>
          {candidate.match_score !== undefined && (
            <span className="inline-flex items-center text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
              {`${Math.round(candidate.match_score * 100)}% match`}
            </span>
          )}
        </div>

        {isApplied ? (
          <span
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#18794E] bg-[#EAF7F0] px-2 py-1 rounded-md border border-[#BDE5CF] shrink-0"
            aria-disabled="true"
            data-testid="applied-badge"
          >
            <Check className="w-3 h-3" />
            Applied ✓
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onApply(candidate.code, candidate.description)}
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg bg-[#1769E0] text-white text-xs font-semibold hover:bg-[#0F5AB8] transition-colors cursor-pointer shrink-0 shadow-2xs"
          >
            <Plus className="w-3.5 h-3.5" />
            Apply Code
          </button>
        )}
      </div>

      {criteriaList.length > 0 && (
        <div className="text-[11px] text-gray-600 bg-gray-50/70 rounded-md p-2 border border-gray-100 flex flex-col gap-1 leading-relaxed">
          <span className="font-semibold text-gray-700">• When to choose:</span>
          {criteriaList.map((crit, idx) => (
            <span key={idx} className="pl-2">
              {`- ${crit}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
