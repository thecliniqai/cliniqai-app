"use client";

import React from "react";
import { Visit, QueueToken, Patient } from "@/lib/db/types";
import { StatusActions } from "./status-actions";
import { Clock, Stethoscope, CreditCard, HeartPulse, Activity } from "lucide-react";

export interface QueueItem {
  visit: Visit;
  patient?: Patient | null;
  queueToken?: QueueToken | null;
  doctorName?: string | null;
}

export interface QueueCardProps {
  item: QueueItem;
  onRefresh?: () => void;
  onCheckout?: (item: QueueItem) => void;
  onRecordVitals?: (item: QueueItem) => void;
}

export function QueueCard({ item, onRefresh, onCheckout, onRecordVitals }: QueueCardProps) {
  const { visit, patient, queueToken, doctorName } = item;

  const formatScheduledTime = (isoString?: string | null) => {
    if (!isoString) return null;
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const scheduledTimeStr = formatScheduledTime(visit.scheduled_at);

  const getStatusBadge = () => {
    switch (visit.status) {
      case "booked":
      case "confirmed":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
            Booked
          </span>
        );
      case "waiting":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            Waiting
          </span>
        );
      case "in_consultation":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#EAF2FF] text-[#1769E0] border border-[#B2CCFF]">
            In Consultation
          </span>
        );
      case "completed":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            Completed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-500">
            {visit.status}
          </span>
        );
    }
  };

  const vitals = (visit.vitals || {}) as Record<string, number | null>;
  const hasVitals = Boolean(
    vitals.systolic ||
    vitals.diastolic ||
    vitals.pulse ||
    vitals.temperature ||
    vitals.spo2 ||
    vitals.weight
  );

  const getVitalsSummary = () => {
    const parts: string[] = [];
    if (vitals.systolic != null && vitals.diastolic != null) {
      parts.push(`BP ${vitals.systolic}/${vitals.diastolic}`);
    }
    if (vitals.pulse != null) {
      parts.push(`P ${vitals.pulse}`);
    }
    if (vitals.temperature != null) {
      parts.push(`${vitals.temperature}°F`);
    }
    if (vitals.spo2 != null) {
      parts.push(`SpO2 ${vitals.spo2}%`);
    }
    if (vitals.weight != null) {
      parts.push(`${vitals.weight}kg`);
    }
    return parts.slice(0, 3).join(" • ");
  };

  return (
    <div className="w-full bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-gray-300 transition-all shadow-xs">
      <div className="flex items-start sm:items-center gap-4">
        {/* Token Number Box */}
        <div className="shrink-0 flex flex-col items-center justify-center w-14 h-14 rounded-xl bg-gray-50 border border-gray-200 text-center shadow-2xs">
          {queueToken ? (
            <>
              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
                Token
              </span>
              <span className="text-base font-bold text-gray-900 leading-tight">
                #{String(queueToken.token_number).padStart(2, "0")}
              </span>
            </>
          ) : (
            <Clock className="w-5 h-5 text-gray-400" />
          )}
        </div>

        {/* Patient Details */}
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-gray-900">
              {patient?.full_name || "Patient"}
            </h3>
            {getStatusBadge()}
            {visit.origin_type === "walk_in" ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                Walk-In
              </span>
            ) : (
              scheduledTimeStr && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  <Clock className="w-3 h-3 mr-1" />
                  Appt {scheduledTimeStr}
                </span>
              )
            )}

            {/* Vitals / Triage Indicator Badge */}
            {hasVitals ? (
              <button
                type="button"
                onClick={() => onRecordVitals?.(item)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors cursor-pointer"
                title="Click to view or edit triage vitals"
              >
                <HeartPulse className="w-3 h-3 text-emerald-600" />
                <span>{getVitalsSummary() || "Vitals Recorded"}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onRecordVitals?.(item)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors cursor-pointer"
                title="Triage: Enter patient vitals"
              >
                <Activity className="w-3 h-3 text-amber-600" />
                <span>Vitals Pending</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs text-gray-500">
            {patient?.age != null && <span>Age {patient.age}</span>}
            {patient?.phone && (
              <>
                <span>•</span>
                <span>{patient.phone}</span>
              </>
            )}
            {doctorName && (
              <>
                <span>•</span>
                <span className="inline-flex items-center text-gray-700 font-medium">
                  <Stethoscope className="w-3.5 h-3.5 mr-1 text-gray-400" />
                  Dr. {doctorName}
                </span>
              </>
            )}
            {visit.reason_for_visit && (
              <>
                <span>•</span>
                <span className="text-gray-600 font-medium">
                  {visit.reason_for_visit}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="shrink-0 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => onRecordVitals?.(item)}
          className="h-9 px-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
          title={hasVitals ? "Edit recorded vitals" : "Record vitals (Triage)"}
        >
          <HeartPulse className="w-3.5 h-3.5 text-rose-500" />
          <span className="hidden sm:inline">{hasVitals ? "Vitals" : "Triage"}</span>
        </button>

        <button
          type="button"
          onClick={() => onCheckout?.(item)}
          className="h-9 px-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
          title="Open Checkout & Fee Collection"
        >
          <CreditCard className="w-3.5 h-3.5 text-emerald-600" />
          <span className="hidden sm:inline">Checkout</span>
        </button>

        <StatusActions visit={visit} onStatusChanged={onRefresh} />
      </div>
    </div>
  );
}
