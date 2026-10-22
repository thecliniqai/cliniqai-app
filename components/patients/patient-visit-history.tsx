"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Calendar,
  Clock,
  Stethoscope,
  Printer,
  Receipt,
  ChevronDown,
  ChevronUp,
  FileText,
  Pill,
  Activity,
  ArrowUpRight,
  PlusCircle,
  FlaskConical,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { PatientVisitHistoryItem, PatientVisitVitals } from "@/features/patients/schema";
import { cn } from "@/lib/utils";

interface PatientVisitHistoryProps {
  visits: PatientVisitHistoryItem[];
  userRole?: string;
  patientId: string;
}

export function PatientVisitHistory({
  visits,
  userRole = "doctor",
  patientId,
}: PatientVisitHistoryProps) {
  // Store expanded state per visit ID. By default expand the most recent visit.
  const [expandedVisits, setExpandedVisits] = useState<Record<string, boolean>>(() => {
    if (visits.length > 0) {
      return { [visits[0].id]: true };
    }
    return {};
  });

  const toggleExpand = (id: string) => {
    setExpandedVisits((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const isDoctorOrOwner = ["owner", "admin", "doctor"].includes(userRole);

  if (!visits || visits.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/50 p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-blue-50 text-[#1769E0] flex items-center justify-center mx-auto mb-3">
          <FileText className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-gray-900">No Clinical Visits Yet</h3>
        <p className="text-xs text-gray-500 max-w-sm mx-auto mt-1 mb-4 leading-relaxed">
          No appointments, consultations, or prescription records have been logged for this patient.
        </p>
        <div className="flex items-center justify-center gap-2">
          <Link href={`/calendar?patientId=${patientId}`}>
            <Button variant="secondary" size="sm" startIcon={<Calendar className="w-3.5 h-3.5" />}>
              Schedule Appointment
            </Button>
          </Link>
          <Link href="/queue">
            <Button variant="primary" size="sm" startIcon={<PlusCircle className="w-3.5 h-3.5" />}>
              Add to Queue
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-1">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Consultation Encounters</h2>
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
            {visits.length} {visits.length === 1 ? "visit" : "visits"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const allExpanded = visits.every((v) => expandedVisits[v.id]);
              const next: Record<string, boolean> = {};
              visits.forEach((v) => {
                next[v.id] = !allExpanded;
              });
              setExpandedVisits(next);
            }}
            className="text-xs text-[#1769E0] hover:underline font-medium cursor-pointer"
          >
            {visits.every((v) => expandedVisits[v.id]) ? "Collapse All" : "Expand All"}
          </button>
        </div>
      </div>

      <div className="relative border-l-2 border-gray-200 ml-4 space-y-6">
        {visits.map((visit, index) => {
          const isExpanded = !!expandedVisits[visit.id];
          const visitDate = new Date(visit.scheduled_at || visit.created_at);
          const formattedDate = visitDate.toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          });
          const formattedTime = visitDate.toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
          });

          const hasRx = !!visit.prescription && (visit.prescription.items?.length || 0) > 0;
          const hasInvoice = !!visit.invoice;

          return (
            <div key={visit.id} className="relative pl-6">
              {/* Timeline marker node */}
              <div
                className={cn(
                  "absolute -left-[9px] top-4 w-4 h-4 rounded-full border-2 bg-white flex items-center justify-center transition-colors",
                  visit.status === "completed"
                    ? "border-emerald-600 bg-emerald-50 text-emerald-600"
                    : visit.status === "in_consultation"
                    ? "border-[#1769E0] bg-blue-50 text-[#1769E0]"
                    : "border-gray-400 bg-white"
                )}
              >
                <div
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    visit.status === "completed"
                      ? "bg-emerald-600"
                      : visit.status === "in_consultation"
                      ? "bg-[#1769E0]"
                      : "bg-gray-400"
                  )}
                />
              </div>

              {/* Card Container */}
              <div className="rounded-xl border border-gray-200 bg-white shadow-xs hover:border-gray-300 transition-all overflow-hidden">
                {/* Header */}
                <div
                  onClick={() => toggleExpand(visit.id)}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer bg-gray-50/40 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="font-semibold text-gray-900 text-sm">{formattedDate}</span>
                    <span className="text-xs text-gray-500 font-mono flex items-center gap-1">
                      <Clock className="w-3 h-3 text-gray-400" />
                      {formattedTime}
                    </span>

                    {visit.token_number && (
                      <span className="px-2 py-0.5 rounded-md bg-blue-50 text-[#1769E0] font-mono font-bold text-xs">
                        Token #{visit.token_number}
                      </span>
                    )}

                    <StatusBadge status={visit.status} />

                    {visit.specialty && (
                      <span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 text-xs capitalize">
                        {visit.specialty.replace(/_/g, " ")}
                      </span>
                    )}

                    {visit.investigations_advised && visit.investigations_advised.length > 0 && (
                      <span className="px-2 py-0.5 rounded-md bg-blue-50/80 text-[#1769E0] text-xs font-medium flex items-center gap-1">
                        <FlaskConical className="w-3 h-3" />
                        <span>{visit.investigations_advised.length} Lab(s) Advised</span>
                      </span>
                    )}

                    {visit.referral && (
                      <Link
                        href="/referrals"
                        onClick={(e) => e.stopPropagation()}
                        className="px-2 py-0.5 rounded-md bg-[#FFF5E5] text-[#9A5B00] border border-[#F3D39A] text-xs font-semibold flex items-center gap-1 hover:bg-[#ffeacc] transition-colors"
                      >
                        <Share2 className="w-3 h-3" />
                        <span>Referral: Dr. {visit.referral.referred_to_name} ({visit.referral.status})</span>
                      </Link>
                    )}
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    <div className="text-right text-xs">
                      <p className="font-medium text-gray-900 flex items-center gap-1 justify-end">
                        <Stethoscope className="w-3.5 h-3.5 text-[#1769E0]" />
                        {visit.doctor.full_name}
                      </p>
                      {visit.doctor.qualifications && (
                        <p className="text-[11px] text-gray-500">{visit.doctor.qualifications}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label={isExpanded ? "Collapse visit details" : "Expand visit details"}
                      className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-200/50"
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Body: High-level Highlights */}
                <div className="p-4 space-y-3.5">
                  {/* Chief complaints & Reason */}
                  {(visit.reason_for_visit || (visit.chief_complaints && visit.chief_complaints.length > 0)) && (
                    <div className="space-y-1">
                      <span className="text-[11px] uppercase font-bold text-gray-400 tracking-wider">
                        Chief Complaints & Reason
                      </span>
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {visit.reason_for_visit && (
                          <span className="px-2.5 py-1 rounded-md bg-amber-50 text-amber-800 text-xs font-medium border border-amber-200/60">
                            {visit.reason_for_visit}
                          </span>
                        )}
                        {visit.chief_complaints?.map((cc, i) => (
                          <span
                            key={i}
                            className="px-2.5 py-1 rounded-md bg-gray-100 text-gray-800 text-xs font-medium border border-gray-200"
                          >
                            {cc.complaint}
                            {(cc.duration || cc.duration_unit) && (
                              <span className="text-gray-500 ml-1 font-normal">
                                ({[cc.duration, cc.duration_unit].filter(Boolean).join(" ")})
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Diagnoses List */}
                  {visit.diagnoses && visit.diagnoses.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[11px] uppercase font-bold text-gray-400 tracking-wider">
                        Diagnoses
                      </span>
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {visit.diagnoses.map((diag) => (
                          <span
                            key={diag.id}
                            className={cn(
                              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border",
                              diag.is_chronic
                                ? "bg-rose-50 text-rose-800 border-rose-200"
                                : "bg-emerald-50 text-emerald-800 border-emerald-200"
                            )}
                          >
                            <span>{diag.diagnosis_name}</span>
                            {diag.icd11_code && (
                              <span className="text-[10px] font-mono bg-white/70 px-1 py-0.2 rounded border border-emerald-300/40">
                                {diag.icd11_code}
                              </span>
                            )}
                            {diag.is_chronic && (
                              <span className="text-[10px] font-semibold text-rose-700 uppercase tracking-tight">
                                Chronic
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Expandable Section: Vitals, Prescriptions, Clinical Notes, Billing */}
                  {isExpanded && (
                    <div className="pt-3 border-t border-gray-100 space-y-4">
                      {/* Vitals Summary Strip */}
                      {visit.vitals && Object.keys(visit.vitals).length > 0 && (
                        <div className="space-y-1.5">
                          <span className="text-[11px] uppercase font-bold text-gray-400 tracking-wider flex items-center gap-1">
                            <Activity className="w-3 h-3 text-[#1769E0]" />
                            Recorded Vitals
                          </span>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs">
                            {formatVitals(visit.vitals).map((vital, i) => (
                              <div
                                key={i}
                                className="p-2 rounded-lg bg-gray-50 border border-gray-100 space-y-0.5"
                              >
                                <span className="text-[10px] text-gray-500 block uppercase">
                                  {vital.label}
                                </span>
                                <span className="font-semibold text-gray-900 font-mono">
                                  {vital.value}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Prescribed Medications */}
                      {visit.prescription && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] uppercase font-bold text-gray-400 tracking-wider flex items-center gap-1">
                              <Pill className="w-3 h-3 text-emerald-600" />
                              Prescription Details (Rev v{visit.prescription.version})
                            </span>
                            {visit.prescription.signed_at && (
                              <span className="text-[11px] text-emerald-700 font-medium">
                                Signed & Finalized
                              </span>
                            )}
                          </div>

                          {visit.prescription.items && visit.prescription.items.length > 0 ? (
                            <div className="rounded-lg border border-gray-100 overflow-hidden text-xs">
                              <table className="w-full text-left divide-y divide-gray-100">
                                <thead className="bg-gray-50 text-gray-600 text-[11px]">
                                  <tr>
                                    <th className="px-3 py-2 font-medium">Medicine</th>
                                    <th className="px-3 py-2 font-medium">Dosage</th>
                                    <th className="px-3 py-2 font-medium">Timing</th>
                                    <th className="px-3 py-2 font-medium">Duration</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50 bg-white">
                                  {visit.prescription.items.map((item) => (
                                    <tr key={item.id} className="hover:bg-gray-50/50">
                                      <td className="px-3 py-2 font-medium text-gray-900">
                                        <div className="flex items-center gap-1.5">
                                          {item.dose_form && (
                                            <span className="px-1.5 py-0.5 rounded bg-gray-100 text-[10px] text-gray-600 capitalize">
                                              {item.dose_form}
                                            </span>
                                          )}
                                          <span>{item.medicine_name}</span>
                                        </div>
                                        {item.generic_name && (
                                          <p className="text-[11px] text-gray-500 font-normal italic mt-0.5">
                                            {item.generic_name}
                                          </p>
                                        )}
                                      </td>
                                      <td className="px-3 py-2 text-gray-700 font-mono">
                                        {item.dosage}
                                      </td>
                                      <td className="px-3 py-2 text-gray-700">
                                        {item.timing || "—"}
                                      </td>
                                      <td className="px-3 py-2 text-gray-700 font-mono">
                                        {item.duration || "—"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="text-xs text-gray-500 italic">No medicines prescribed.</p>
                          )}
                        </div>
                      )}

                      {/* Clinical Notes & Advice */}
                      {(visit.clinical_notes || (visit.advice && visit.advice.length > 0)) && (
                        <div className="space-y-2">
                          <span className="text-[11px] uppercase font-bold text-gray-400 tracking-wider">
                            Clinical Notes & Advice
                          </span>
                          {visit.clinical_notes && (
                            <div className="p-3 rounded-lg bg-gray-50/70 text-xs text-gray-700 leading-relaxed border border-gray-100 whitespace-pre-line">
                              {visit.clinical_notes}
                            </div>
                          )}
                          {visit.advice && visit.advice.length > 0 && (
                            <ul className="list-disc list-inside text-xs text-gray-700 space-y-1">
                              {visit.advice.map((item, idx) => (
                                <li key={idx}>{item}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}

                      {/* Investigations Advised */}
                      {visit.investigations_advised && visit.investigations_advised.length > 0 && (
                        <div className="space-y-1.5">
                          <span className="text-[11px] uppercase font-bold text-gray-400 tracking-wider flex items-center gap-1.5">
                            <FlaskConical className="w-3.5 h-3.5 text-[#1769E0]" />
                            <span>Investigations Advised</span>
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {visit.investigations_advised.map((test, idx) => (
                              <span
                                key={idx}
                                className="px-2.5 py-1 rounded-md text-xs font-medium bg-blue-50/70 border border-blue-100 text-[#1769E0]"
                              >
                                {test}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Billing Summary */}
                      {visit.invoice && (
                        <div className="p-3 rounded-lg bg-gray-50/50 border border-gray-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-900">
                              Invoice #{visit.invoice.invoice_number}
                            </span>
                            <span className="font-mono text-gray-700">
                              ₹{visit.invoice.total_amount.toFixed(2)}
                            </span>
                            {visit.invoice.balance_due === 0 ? (
                              <Badge color="success" size="sm">
                                Paid Full
                              </Badge>
                            ) : (
                              <Badge color="warning" size="sm">
                                Balance: ₹{visit.invoice.balance_due.toFixed(2)}
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions Strip */}
                  <div className="pt-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Print Rx PDF */}
                      {hasRx || visit.status === "completed" ? (
                        <a
                          href={`/api/visits/${visit.id}/prescription-pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button
                            variant="secondary"
                            size="sm"
                            startIcon={<Printer className="w-3.5 h-3.5 text-[#1769E0]" />}
                          >
                            Print Rx
                          </Button>
                        </a>
                      ) : null}

                      {/* Print Receipt PDF */}
                      {hasInvoice && (
                        <a
                          href={`/api/invoices/${visit.invoice?.id || visit.id}/receipt-pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button
                            variant="secondary"
                            size="sm"
                            startIcon={<Receipt className="w-3.5 h-3.5 text-emerald-600" />}
                          >
                            Receipt
                          </Button>
                        </a>
                      )}
                    </div>

                    {/* Open Encounter */}
                    {isDoctorOrOwner ? (
                      <Link href={`/consultation/${visit.id}`}>
                        <Button
                          variant="outline"
                          size="sm"
                          endIcon={<ArrowUpRight className="w-3.5 h-3.5" />}
                        >
                          Open Encounter
                        </Button>
                      </Link>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleExpand(visit.id)}
                      >
                        {isExpanded ? "Collapse Details" : "View Details"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatVitals(vitals?: PatientVisitVitals | null) {
  if (!vitals) return [];
  const items: { label: string; value: string }[] = [];

  if (vitals.bp_sys !== undefined && vitals.bp_sys !== null) {
    items.push({
      label: "Blood Pressure",
      value: `${vitals.bp_sys}/${vitals.bp_dia ?? "—"} mmHg`,
    });
  }
  if (vitals.pulse !== undefined && vitals.pulse !== null) {
    items.push({ label: "Pulse", value: `${vitals.pulse} bpm` });
  }
  if (vitals.spo2 !== undefined && vitals.spo2 !== null) {
    items.push({ label: "SpO2", value: `${vitals.spo2}%` });
  }
  if (vitals.temp !== undefined && vitals.temp !== null) {
    items.push({ label: "Temperature", value: `${vitals.temp} °F` });
  }
  if (vitals.weight !== undefined && vitals.weight !== null) {
    items.push({ label: "Weight", value: `${vitals.weight} kg` });
  }
  if (vitals.bmi !== undefined && vitals.bmi !== null) {
    items.push({ label: "BMI", value: `${vitals.bmi}` });
  }
  if (vitals.respiratory_rate !== undefined && vitals.respiratory_rate !== null) {
    items.push({ label: "Resp Rate", value: `${vitals.respiratory_rate}/min` });
  }

  return items;
}
