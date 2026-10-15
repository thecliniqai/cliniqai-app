"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { transitionQueueState } from "@/features/queue/actions";
import { Button } from "@/components/ui/button";
import {
  Stethoscope,
  HeartPulse,
  Activity,
  Thermometer,
  Weight,
  Clock,
  ArrowRight,
  AlertCircle,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface CabinPatient {
  id: string;
  full_name: string;
  phone: string;
  sex: string | null;
  age: number | null;
  date_of_birth: string | null;
  uhid: string | null;
  allergies?: string[];
  chronic_conditions?: string[];
}

export interface CabinVitals {
  bp_systolic?: number | null;
  bp_diastolic?: number | null;
  pulse?: number | null;
  temperature?: number | null;
  weight?: number | null;
  spo2?: number | null;
  height?: number | null;
  bmi?: number | null;
}

export interface CabinVisitItem {
  id: string;
  doctor_id: string;
  patient_id: string;
  status: string;
  scheduled_at: string | null;
  created_at: string;
  reason_for_visit: string | null;
  token_number: number | null;
  priority?: "normal" | "urgent" | "emergency";
  vitals: CabinVitals | null;
  patient: CabinPatient;
  prescription?: {
    id: string;
    signed_at: string | null;
    pdf_storage_path: string | null;
    status: string;
  } | null;
}

interface MyQueueCardProps {
  visit: CabinVisitItem;
  isActive?: boolean;
}

export function MyQueueCard({ visit, isActive = false }: MyQueueCardProps) {
  const router = useRouter();
  const [isStarting, setIsStarting] = useState(false);

  const { patient, vitals, token_number, priority, reason_for_visit } = visit;

  const handleStartConsultation = async () => {
    try {
      setIsStarting(true);
      if (visit.status === "waiting") {
        await transitionQueueState(visit.id, "in_consultation");
      }
      router.push(`/consultation/${visit.id}`);
    } catch (err) {
      console.error("Failed to transition queue status:", err);
      // Fallback navigation
      router.push(`/consultation/${visit.id}`);
    } finally {
      setIsStarting(false);
    }
  };

  const hasVitals =
    vitals &&
    (vitals.bp_systolic != null ||
      vitals.pulse != null ||
      vitals.temperature != null ||
      vitals.weight != null ||
      vitals.spo2 != null);

  const genderLabel = patient.sex
    ? patient.sex.charAt(0).toUpperCase() + patient.sex.slice(1)
    : "Gender unspecified";
  const ageLabel = patient.age != null ? `${patient.age} yrs` : null;
  const demographics = [ageLabel, genderLabel].filter(Boolean).join(" · ");

  return (
    <div
      className={cn(
        "bg-white rounded-xl border p-4 sm:p-5 transition-all duration-200 shadow-theme-xs hover:shadow-theme-md",
        isActive
          ? "border-[#1769E0] ring-2 ring-[#1769E0]/20 bg-[#F8FAFC]"
          : priority === "emergency" || priority === "urgent"
          ? "border-amber-300 bg-amber-50/20"
          : "border-gray-200 hover:border-gray-300"
      )}
    >
      {/* Header Row: Token & Priority */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "px-2.5 py-1 text-xs font-bold rounded-lg border flex items-center gap-1",
              isActive
                ? "bg-[#1769E0] text-white border-[#1769E0]"
                : "bg-[#EAF2FF] text-[#1769E0] border-[#B2CCFF]"
            )}
          >
            Token #{token_number != null ? String(token_number).padStart(2, "0") : "--"}
          </span>

          {priority && priority !== "normal" && (
            <span
              className={cn(
                "px-2 py-0.5 text-[11px] font-semibold uppercase rounded-full border",
                priority === "emergency"
                  ? "bg-rose-50 text-rose-700 border-rose-200"
                  : "bg-amber-50 text-amber-700 border-amber-200"
              )}
            >
              {priority}
            </span>
          )}

          {isActive && (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              In Cabin
            </span>
          )}
        </div>

        {visit.scheduled_at && (
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <Clock className="w-3.5 h-3.5" />
            <span>
              {new Date(visit.scheduled_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        )}
      </div>

      {/* Patient Name & Demographics */}
      <div className="mb-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-semibold text-gray-900 text-base sm:text-lg tracking-tight">
            {patient.full_name}
          </h3>
          {patient.uhid && (
            <span className="text-[11px] font-mono text-gray-400 uppercase">
              {patient.uhid}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 font-medium mt-0.5">
          {demographics}
          {patient.phone ? ` · ${patient.phone}` : ""}
        </p>
      </div>

      {/* Allergies / Chronic conditions banner if present */}
      {((patient.allergies && patient.allergies.length > 0) ||
        (patient.chronic_conditions && patient.chronic_conditions.length > 0)) && (
        <div className="mb-3 p-2 rounded-lg bg-rose-50/60 border border-rose-100 flex items-start gap-1.5 text-xs text-rose-800">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-600" />
          <div className="truncate">
            {patient.allergies && patient.allergies.length > 0 && (
              <span className="font-semibold">Allergies: {patient.allergies.join(", ")} </span>
            )}
            {patient.chronic_conditions && patient.chronic_conditions.length > 0 && (
              <span>• History: {patient.chronic_conditions.join(", ")}</span>
            )}
          </div>
        </div>
      )}

      {/* Pre-filled Vitals Strip */}
      <div className="mb-3.5 p-2.5 rounded-lg bg-gray-50 border border-gray-100">
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5 flex items-center justify-between">
          <span className="flex items-center gap-1">
            <Activity className="w-3 h-3 text-gray-400" />
            Pre-consultation Vitals
          </span>
          {!hasVitals && <span className="text-gray-400 font-normal italic">Not recorded</span>}
        </div>

        {hasVitals ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {vitals.bp_systolic != null && vitals.bp_diastolic != null && (
              <div className="bg-white px-2 py-1.5 rounded border border-gray-100 shadow-2xs">
                <span className="text-[10px] text-gray-400 block">BP</span>
                <span className="font-semibold text-gray-800">
                  {vitals.bp_systolic}/{vitals.bp_diastolic}{" "}
                  <span className="text-[10px] text-gray-400 font-normal">mmHg</span>
                </span>
              </div>
            )}
            {vitals.pulse != null && (
              <div className="bg-white px-2 py-1.5 rounded border border-gray-100 shadow-2xs">
                <span className="text-[10px] text-gray-400 block">Pulse</span>
                <span className="font-semibold text-gray-800">
                  {vitals.pulse}{" "}
                  <span className="text-[10px] text-gray-400 font-normal">bpm</span>
                </span>
              </div>
            )}
            {vitals.temperature != null && (
              <div className="bg-white px-2 py-1.5 rounded border border-gray-100 shadow-2xs">
                <span className="text-[10px] text-gray-400 block">Temp</span>
                <span className="font-semibold text-gray-800">
                  {vitals.temperature}°F
                </span>
              </div>
            )}
            {vitals.weight != null && (
              <div className="bg-white px-2 py-1.5 rounded border border-gray-100 shadow-2xs">
                <span className="text-[10px] text-gray-400 block">Weight</span>
                <span className="font-semibold text-gray-800">
                  {vitals.weight}{" "}
                  <span className="text-[10px] text-gray-400 font-normal">kg</span>
                </span>
              </div>
            )}
            {vitals.spo2 != null && (
              <div className="bg-white px-2 py-1.5 rounded border border-gray-100 shadow-2xs">
                <span className="text-[10px] text-gray-400 block">SpO2</span>
                <span className="font-semibold text-gray-800">
                  {vitals.spo2}%
                </span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">
            Triage vitals have not been entered yet. You can record them during consultation.
          </p>
        )}
      </div>

      {/* Reason for Visit */}
      {reason_for_visit && (
        <div className="mb-4 text-xs bg-blue-50/40 border border-blue-100/60 p-2 rounded-lg text-blue-900">
          <span className="font-semibold text-blue-950">Reason: </span>
          {reason_for_visit}
        </div>
      )}

      {/* Action CTA Floor (minimum 44px touch target) */}
      <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
        <Button
          type="button"
          onClick={handleStartConsultation}
          disabled={isStarting}
          className={cn(
            "flex-1 h-11 text-sm font-semibold rounded-xl shadow-theme-xs cursor-pointer flex items-center justify-center gap-2",
            isActive
              ? "bg-[#1769E0] text-white hover:bg-[#155cc0]"
              : "bg-[#1769E0] text-white hover:bg-[#155cc0]"
          )}
        >
          <Stethoscope className="w-4 h-4 shrink-0" />
          <span>{isStarting ? "Opening Workspace..." : isActive ? "Resume Consultation" : "Start Consultation"}</span>
          <ArrowRight className="w-4 h-4 shrink-0 ms-1 opacity-80" />
        </Button>

        <Link
          href={`/patients/${patient.id}`}
          className="h-11 px-3.5 flex items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 text-xs font-medium transition-colors"
          title="View Patient Profile"
        >
          <FileText className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
