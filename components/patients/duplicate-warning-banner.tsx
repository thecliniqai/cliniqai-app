"use client";

import React from "react";
import { DuplicateMatch } from "@/features/patients/dedup";
import { Button } from "@/components/ui/button";
import { AlertCircle, UserCheck, X } from "lucide-react";
import Link from "next/link";

export interface DuplicateWarningBannerProps {
  matches: DuplicateMatch[];
  onDismiss: () => void;
  onUseExisting?: (patientId: string) => void;
}

export function DuplicateWarningBanner({
  matches,
  onDismiss,
  onUseExisting,
}: DuplicateWarningBannerProps) {
  if (matches.length === 0) return null;

  return (
    <div
      role="alert"
      className="w-full rounded-xl border border-amber-300 bg-amber-50/70 p-4 sm:p-5 text-left flex flex-col gap-3 shadow-theme-xs"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-amber-900">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" aria-hidden="true" />
          <h4 className="text-sm font-semibold">
            Potential Duplicate Patient{matches.length > 1 ? "s" : ""} Found
          </h4>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-amber-700 hover:text-amber-950 p-1 rounded-lg hover:bg-amber-100/60 transition-colors cursor-pointer"
          aria-label="Dismiss duplicate warning"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs text-amber-800 leading-relaxed">
        One or more existing records match this phone number or name and age.
        You can reuse the existing record or continue creating this as a new family member.
      </p>

      <div className="flex flex-col gap-2.5 divide-y divide-amber-200/80 pt-1">
        {matches.map((m) => (
          <div
            key={m.patient.id}
            className="pt-2.5 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-900">
                  {m.patient.full_name}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-white text-gray-600 border border-amber-200">
                  {m.patient.age != null ? `Age ${m.patient.age}` : "Age N/A"}
                </span>
                {m.confidence === "high" && (
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-600 text-white">
                    Exact Match
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-600 mt-1 tabular-nums">
                {m.patient.phone} • {m.matchReason}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {onUseExisting ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => onUseExisting(m.patient.id)}
                  startIcon={<UserCheck className="w-3.5 h-3.5 text-[#1769E0]" />}
                >
                  Use Patient
                </Button>
              ) : (
                <Link href={`/patients/${m.patient.id}`}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    startIcon={<UserCheck className="w-3.5 h-3.5 text-[#1769E0]" />}
                  >
                    View Record
                  </Button>
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end pt-2 border-t border-amber-200/60">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          className="text-xs text-amber-900 hover:bg-amber-100"
        >
          Dismiss & Continue Creating as New
        </Button>
      </div>
    </div>
  );
}
