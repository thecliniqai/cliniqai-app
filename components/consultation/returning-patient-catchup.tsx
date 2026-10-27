"use client";

import React, { useState } from "react";
import { Sparkles, ChevronDown, ChevronUp, Clock, Copy, Check, AlertCircle, Loader2 } from "lucide-react";
import { getPatientCatchUpSummaryAction } from "@/features/ai/actions";
import { CatchUpSummary } from "@/lib/ai/types";
import type { PastVisitEncounter } from "@/features/consultation/actions";

export interface ReturningPatientCatchupProps {
  patientId: string;
  pastEncounters: PastVisitEncounter[];
  onAppendNotes?: (notes: string) => void;
}

export function ReturningPatientCatchup({
  patientId,
  pastEncounters,
  onAppendNotes,
}: ReturningPatientCatchupProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [summary, setSummary] = useState<CatchUpSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // If patient has zero prior visits recorded, do not render banner
  if (!pastEncounters || pastEncounters.length === 0) {
    return null;
  }

  const latestEncounter = pastEncounters[0];
  const lastDiagnosis =
    latestEncounter.diagnoses && latestEncounter.diagnoses.length > 0
      ? latestEncounter.diagnoses.map((d) => d.diagnosis_name).join(", ")
      : "General Consultation";

  const daysAgo = latestEncounter.date
    ? Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(latestEncounter.date).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      )
    : null;

  const handleFetchCatchUp = async () => {
    if (summary) {
      setIsExpanded((prev) => !prev);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await getPatientCatchUpSummaryAction({ patientId });
      if (res.success && res.summary) {
        setSummary(res.summary);
        setIsExpanded(true);
      } else {
        setError(res.error || "Failed to generate summary.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load summary.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!summary) return;
    const text = summary.bullets.map((b, i) => `${i + 1}. ${b}`).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onAppendNotes?.(`[AI Catch-Up Summary]:\n${text}`);
  };

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 sm:p-4 text-xs shadow-2xs transition-all">
      {/* 1-Line Compact Summary Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-indigo-950 font-medium">
          <span className="h-6 w-6 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <span>
            <strong className="font-semibold text-indigo-900">
              Returning Patient ({pastEncounters.length} past encounter{pastEncounters.length > 1 ? "s" : ""})
            </strong>
            {" — "}
            {daysAgo !== null ? `Last seen ${daysAgo === 0 ? "today" : `${daysAgo} day${daysAgo > 1 ? "s" : ""} ago`} for ` : "Last encounter for "}
            <span className="font-semibold text-indigo-900">{lastDiagnosis}</span>.
          </span>
        </div>

        <button
          type="button"
          onClick={handleFetchCatchUp}
          disabled={isLoading}
          className="min-h-[36px] px-3 rounded-lg bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300 font-semibold text-xs flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer shrink-0 disabled:opacity-50 self-start sm:self-auto"
          aria-expanded={isExpanded}
        >
          {isLoading ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin text-indigo-600" />
              <span>Generating...</span>
            </>
          ) : isExpanded ? (
            <>
              <span>Close Summary</span>
              <ChevronUp className="h-3.5 w-3.5" />
            </>
          ) : (
            <>
              <Sparkles className="h-3 w-3 text-indigo-600" />
              <span>✦ Generate AI Catch-Up</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="mt-2.5 flex items-center gap-2 p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Expanded 3-Bullet Summary */}
      {isExpanded && summary && (
        <div className="mt-3 pt-3 border-t border-indigo-100 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-indigo-700 font-semibold uppercase tracking-wider">
            <span>Clinical Brief (Last 3 Encounters)</span>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 text-indigo-700 hover:text-indigo-900 font-medium cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-emerald-600" />
                  <span className="text-emerald-700">Copied to Notes</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span>Copy to Notes</span>
                </>
              )}
            </button>
          </div>

          <ul className="space-y-1.5 text-xs text-gray-800 list-disc list-inside bg-white p-3 rounded-lg border border-indigo-100">
            {summary.bullets.map((bullet, idx) => (
              <li key={idx} className="leading-relaxed">
                <span className="font-normal text-gray-800">{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
