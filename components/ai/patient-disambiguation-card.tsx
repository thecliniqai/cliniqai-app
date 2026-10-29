"use client";

import React from "react";
import { User, Phone, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DisambiguationCandidate {
  id: string;
  full_name: string;
  phone?: string | null;
  age?: number | string | null;
  sex?: string | null;
  last_visit_date?: string | null;
}

export interface PatientDisambiguationCardProps {
  query?: string;
  candidates: DisambiguationCandidate[];
  onSelect: (candidate: DisambiguationCandidate) => void;
  className?: string;
}

export function PatientDisambiguationCard({
  query,
  candidates,
  onSelect,
  className,
}: PatientDisambiguationCardProps) {
  if (!candidates || candidates.length === 0) return null;

  return (
    <div
      className={cn(
        "w-full rounded-xl border border-[#E4E5E7] bg-white p-4 shadow-sm my-2",
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-[#F1F2F4] pb-2 mb-3">
        <span className="text-xs font-semibold text-[#17181A]">
          Multiple Patients Found {query ? `for "${query}"` : ""}
        </span>
        <span className="text-[11px] text-gray-500 font-medium">Select Match</span>
      </div>

      <p className="text-xs text-gray-600 mb-3">
        Please select the target patient to proceed with booking or review:
      </p>

      <div className="space-y-2">
        {candidates.map((patient) => {
          const ageSex = [
            patient.age ? `${patient.age}y` : null,
            patient.sex ? (patient.sex.toLowerCase().startsWith("m") ? "M" : "F") : null,
          ]
            .filter(Boolean)
            .join(" ");

          const lastVisit = patient.last_visit_date
            ? `Last: ${patient.last_visit_date}`
            : "Last: New Patient";

          return (
            <button
              key={patient.id}
              type="button"
              onClick={() => onSelect(patient)}
              className="w-full text-left flex items-center justify-between p-2.5 rounded-lg border border-[#E4E5E7] hover:border-[#1769E0] hover:bg-[#EAF2FF]/40 transition-colors group cursor-pointer"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0 text-gray-600 group-hover:bg-[#1769E0] group-hover:text-white transition-colors">
                  <User className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#17181A] truncate group-hover:text-[#1769E0]">
                      {patient.full_name}
                    </span>
                    {ageSex && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                        {ageSex}
                      </span>
                    )}
                  </div>
                  {patient.phone && (
                    <div className="flex items-center gap-1 text-[11px] text-gray-500 mt-0.5">
                      <Phone className="w-3 h-3 text-gray-400" />
                      <span>{patient.phone}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 text-[11px] text-gray-500 shrink-0 ml-2">
                <Calendar className="w-3 h-3 text-gray-400" />
                <span>{lastVisit}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
