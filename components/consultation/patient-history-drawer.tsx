"use client";

import React from "react";
import { X, Calendar, Clock, RotateCcw, Copy, Pill, Stethoscope, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PastVisitEncounter } from "@/features/consultation/actions";

export interface PatientHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  encounters: PastVisitEncounter[];
  patientName?: string;
  onRepeatRx?: (items: PastVisitEncounter["prescriptions"][0]["items"]) => void;
  onCopyNotes?: (notes: string) => void;
}

export function PatientHistoryDrawer({
  isOpen,
  onClose,
  encounters,
  patientName,
  onRepeatRx,
  onCopyNotes,
}: PatientHistoryDrawerProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md sm:max-w-lg bg-white shadow-xl flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white shrink-0">
            <div>
              <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-[#1769E0]" />
                Patient Medical History
              </h2>
              {patientName && (
                <p className="text-xs text-gray-500 mt-0.5">Timeline for {patientName}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close patient history drawer"
              className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Timeline Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {encounters.length === 0 ? (
              <div className="py-12 text-center">
                <AlertCircle className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-700">No Past Consultations</p>
                <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
                  This patient has no recorded prior consultations or prescriptions in this clinic.
                </p>
              </div>
            ) : (
              encounters.map((enc, idx) => (
                <div
                  key={enc.visitId}
                  className="rounded-xl border border-gray-200 bg-[#F7F6F3]/40 p-4 space-y-4 hover:border-gray-300 transition-colors"
                >
                  {/* Encounter Meta */}
                  <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                    <div>
                      <span className="text-sm font-semibold text-gray-900">
                        {new Date(enc.date).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                      <span className="text-xs text-gray-500 ml-2">
                        {new Date(enc.date).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <Badge color="info" size="sm">
                      {enc.specialty === "dental"
                        ? "Dental"
                        : enc.specialty === "pediatrics"
                        ? "Pediatrics"
                        : "General Physician"}
                    </Badge>
                  </div>

                  {/* Vitals Summary */}
                  {enc.vitals && (
                    <div className="text-xs text-gray-600 bg-white p-2 rounded-lg border border-gray-100 flex flex-wrap gap-x-4 gap-y-1">
                      {enc.vitals.systolic && enc.vitals.diastolic && (
                        <span>BP: <strong>{enc.vitals.systolic}/{enc.vitals.diastolic}</strong></span>
                      )}
                      {enc.vitals.pulse && (
                        <span>Pulse: <strong>{enc.vitals.pulse} bpm</strong></span>
                      )}
                      {enc.vitals.temperature && (
                        <span>Temp: <strong>{enc.vitals.temperature}°F</strong></span>
                      )}
                      {enc.vitals.weight && (
                        <span>Weight: <strong>{enc.vitals.weight}kg</strong></span>
                      )}
                    </div>
                  )}

                  {/* Complaints */}
                  {enc.chiefComplaints && enc.chiefComplaints.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                        Complaints
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {enc.chiefComplaints.map((c, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-white text-gray-700 border border-gray-200"
                          >
                            {c.symptom} ({c.duration_val} {c.duration_unit})
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Diagnoses */}
                  {enc.diagnoses && enc.diagnoses.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                        Diagnoses
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {enc.diagnoses.map((d) => (
                          <Badge
                            key={d.id}
                            color={d.is_chronic ? "warning" : "primary"}
                            size="sm"
                          >
                            {d.diagnosis_name} {d.icd11_code ? `(${d.icd11_code})` : ""}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Clinical Notes */}
                  {enc.clinicalNotes && (
                    <div className="text-xs text-gray-700 bg-white p-2.5 rounded-lg border border-gray-100">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-gray-600 flex items-center gap-1">
                          <Stethoscope className="w-3.5 h-3.5 text-gray-400" />
                          Notes
                        </span>
                        {onCopyNotes && (
                          <button
                            type="button"
                            onClick={() => onCopyNotes(enc.clinicalNotes!)}
                            className="text-[11px] text-[#1769E0] hover:underline flex items-center gap-1"
                          >
                            <Copy className="w-3 h-3" /> Copy
                          </button>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed">{enc.clinicalNotes}</p>
                    </div>
                  )}

                  {/* Prescribed Medications */}
                  {enc.prescriptions && enc.prescriptions.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                          <Pill className="w-3.5 h-3.5 text-emerald-600" />
                          Prescription (v{enc.prescriptions[0].version})
                        </p>
                        {onRepeatRx && enc.prescriptions[0].items.length > 0 && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => onRepeatRx(enc.prescriptions[0].items)}
                            className="h-7 text-xs px-2.5 text-[#1769E0] gap-1 border-[#1769E0]/30 hover:bg-[#EAF2FF]"
                          >
                            <RotateCcw className="w-3 h-3" /> Repeat this Rx
                          </Button>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        {enc.prescriptions[0].items.map((item, i) => (
                          <div
                            key={item.id || i}
                            className="text-xs bg-white p-2 rounded-md border border-gray-100 flex items-center justify-between"
                          >
                            <div>
                              <span className="font-medium text-gray-900">
                                {item.medicine_name}
                              </span>
                              {item.generic_name && (
                                <p className="text-[11px] text-gray-500">{item.generic_name}</p>
                              )}
                            </div>
                            <div className="text-right text-[11px] text-gray-600">
                              <span className="font-semibold">{item.dosage}</span> •{" "}
                              <span>{item.duration}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
