"use client";

import React from "react";
import { Visit, QueueToken, Patient } from "@/lib/db/types";
import { StatusActions } from "./status-actions";
import { Clock, Stethoscope } from "lucide-react";

export interface QueueItem {
  visit: Visit;
  patient?: Patient | null;
  queueToken?: QueueToken | null;
  doctorName?: string | null;
}

export interface QueueCardProps {
  item: QueueItem;
  onRefresh?: () => void;
}

export function QueueCard({ item, onRefresh }: QueueCardProps) {
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
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--surface-subtle)] text-[var(--text-secondary)] border border-[var(--border-default)]">
            Booked
          </span>
        );
      case "waiting":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--status-warning-bg)] text-[var(--status-warning-text)] border border-[var(--status-warning-border)]">
            Waiting
          </span>
        );
      case "in_consultation":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            In Consultation
          </span>
        );
      case "completed":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
            Completed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-500">
            {visit.status}
          </span>
        );
    }
  };

  return (
    <div className="w-full bg-white border border-[var(--border-default)] rounded-[var(--radius-lg)] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-[var(--border-focus)] transition-all shadow-xs">
      <div className="flex items-start sm:items-center gap-3.5">
        {/* Token Number Box */}
        <div className="shrink-0 flex flex-col items-center justify-center w-12 h-12 rounded-[var(--radius-md)] bg-[var(--surface-subtle)] border border-[var(--border-default)] text-center">
          {queueToken ? (
            <>
              <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-wider">
                Token
              </span>
              <span className="text-base font-bold text-[var(--text-primary)]">
                #{String(queueToken.token_number).padStart(2, "0")}
              </span>
            </>
          ) : (
            <Clock className="w-5 h-5 text-[var(--text-muted)]" />
          )}
        </div>

        {/* Patient Details */}
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-[var(--text-primary)]">
              {patient?.full_name || "Patient"}
            </h3>
            {getStatusBadge()}
            {visit.origin_type === "walk_in" ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-xs text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200">
                Walk-In
              </span>
            ) : (
              scheduledTimeStr && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-xs text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                  <Clock className="w-3 h-3 mr-1" />
                  Appt {scheduledTimeStr}
                </span>
              )
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)]">
            {patient?.age != null && <span>Age {patient.age}</span>}
            {patient?.phone && <span>{patient.phone}</span>}
            {doctorName && (
              <span className="flex items-center text-[var(--text-primary)] font-medium">
                <Stethoscope className="w-3.5 h-3.5 mr-1 text-[var(--text-muted)]" />
                Dr. {doctorName}
              </span>
            )}
            {visit.reason_for_visit && (
              <span className="italic text-[var(--text-muted)]">
                • {visit.reason_for_visit}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="shrink-0 flex items-center justify-end">
        <StatusActions visit={visit} onStatusChanged={onRefresh} />
      </div>
    </div>
  );
}
