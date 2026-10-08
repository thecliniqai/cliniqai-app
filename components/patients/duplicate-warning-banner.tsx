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
      className="w-full rounded-[var(--radius-lg)] border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-4 text-left flex flex-col gap-3 shadow-xs"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-[var(--status-warning-text)]">
          <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
          <h4 className="text-sm font-semibold">
            Potential Duplicate Patient{matches.length > 1 ? "s" : ""} Found
          </h4>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 rounded-sm transition-colors"
          aria-label="Dismiss duplicate warning"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs text-[var(--text-secondary)]">
        One or more existing patients match the phone number or name and age entered.
        You can reuse the existing record or continue creating this as a new family member.
      </p>

      <div className="flex flex-col gap-2 divide-y divide-[var(--status-warning-border)]/60">
        {matches.map((m) => (
          <div
            key={m.patient.id}
            className="pt-2 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  {m.patient.full_name}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[var(--surface-subtle)] text-[var(--text-secondary)]">
                  {m.patient.age != null ? `Age ${m.patient.age}` : "Age N/A"}
                </span>
                {m.confidence === "high" && (
                  <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-xs bg-[var(--status-warning-text)] text-white">
                    Exact Match
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {m.patient.phone} • {m.matchReason}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {onUseExisting ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onUseExisting(m.patient.id)}
                  className="bg-white hover:bg-[var(--surface-subtle)] text-xs h-8"
                >
                  <UserCheck className="w-3.5 h-3.5 mr-1" />
                  Use Patient
                </Button>
              ) : (
                <Link
                  href={`/patients/${m.patient.id}`}
                  className="inline-flex items-center justify-center text-xs font-medium px-2.5 py-1.5 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-white text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] transition-colors h-8"
                >
                  <UserCheck className="w-3.5 h-3.5 mr-1" />
                  View Patient
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end pt-1">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onDismiss}
          className="text-xs h-8"
        >
          Continue Creating as New
        </Button>
      </div>
    </div>
  );
}
