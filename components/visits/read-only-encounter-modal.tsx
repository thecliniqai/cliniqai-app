"use client";

import React from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ClinicVisitRegisterItem } from "@/features/visits/schema";
import {
  Printer,
  Receipt,
  User,
  Stethoscope,
  Activity,
  FileText,
  Pill,
  Clock,
  Calendar,
  ShieldCheck,
  CreditCard,
} from "lucide-react";

interface ReadOnlyEncounterModalProps {
  visit: ClinicVisitRegisterItem | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ReadOnlyEncounterModal({
  visit,
  isOpen,
  onClose,
}: ReadOnlyEncounterModalProps) {
  if (!visit) return null;

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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="xl"
      title={`Clinical Encounter Summary — ${visit.patient.full_name}`}
      description={`${formattedDate} at ${formattedTime} • Token #${visit.token_number ?? "—"}`}
    >
      <div className="space-y-6 max-h-[75vh] overflow-y-auto pr-1">
        {/* Banner: Patient & Doctor Header */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-gray-50/80 border border-gray-200 text-xs">
          <div className="space-y-1">
            <span className="text-[11px] uppercase font-bold text-gray-500 tracking-wider flex items-center gap-1">
              <User className="w-3.5 h-3.5 text-[#1769E0]" />
              Patient Details
            </span>
            <p className="font-semibold text-gray-900 text-sm">{visit.patient.full_name}</p>
            <p className="text-gray-600">
              {visit.patient.sex ? <span className="capitalize">{visit.patient.sex}</span> : "Patient"}
              {visit.patient.age !== null && `, ${visit.patient.age} yrs`}
              {visit.patient.phone && ` • ${visit.patient.phone}`}
            </p>
            {visit.patient.abha_id && (
              <p className="text-[11px] font-mono text-emerald-700 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-600" />
                ABHA: {visit.patient.abha_id}
              </p>
            )}
          </div>

          <div className="space-y-1 sm:text-right">
            <span className="text-[11px] uppercase font-bold text-gray-500 tracking-wider flex items-center gap-1 sm:justify-end">
              <Stethoscope className="w-3.5 h-3.5 text-[#1769E0]" />
              Treating Doctor
            </span>
            <p className="font-semibold text-gray-900 text-sm">{visit.doctor.full_name}</p>
            {visit.doctor.qualifications && (
              <p className="text-gray-600">{visit.doctor.qualifications}</p>
            )}
            <div className="flex items-center gap-2 sm:justify-end mt-1">
              <StatusBadge status={visit.status} />
              {visit.specialty && (
                <span className="px-2 py-0.5 rounded bg-gray-200/60 text-gray-700 text-[11px] capitalize">
                  {visit.specialty.replace(/_/g, " ")}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Vitals Summary */}
        {visit.vitals && Object.keys(visit.vitals).length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-[#1769E0]" />
              Recorded Vitals
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {renderVitals(visit.vitals).map((vital, i) => (
                <div key={i} className="p-2.5 rounded-lg bg-gray-50 border border-gray-100">
                  <span className="text-[10px] text-gray-500 block uppercase">{vital.label}</span>
                  <span className="font-semibold text-gray-900 font-mono text-xs">{vital.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Complaints & Reason */}
        {(visit.reason_for_visit || (visit.chief_complaints && visit.chief_complaints.length > 0)) && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Chief Complaints & Reason
            </h4>
            <div className="flex flex-wrap gap-2">
              {visit.reason_for_visit && (
                <span className="px-2.5 py-1 rounded-md bg-amber-50 text-amber-800 text-xs font-medium border border-amber-200">
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
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Diagnoses
            </h4>
            <div className="flex flex-wrap gap-2">
              {visit.diagnoses.map((diag) => (
                <span
                  key={diag.id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200"
                >
                  <span>{diag.diagnosis_name}</span>
                  {diag.icd11_code && (
                    <span className="text-[10px] font-mono bg-white/80 px-1 py-0.5 rounded border border-emerald-300">
                      {diag.icd11_code}
                    </span>
                  )}
                  {diag.is_chronic && (
                    <span className="text-[10px] uppercase font-bold text-rose-600">Chronic</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Prescription Details */}
        {visit.prescription && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                <Pill className="w-3.5 h-3.5 text-emerald-600" />
                Prescribed Medications (v{visit.prescription.version})
              </h4>
              {visit.prescription.signed_at && (
                <Badge color="success" size="sm">
                  Signed
                </Badge>
              )}
            </div>

            {visit.prescription.items && visit.prescription.items.length > 0 ? (
              <div className="rounded-xl border border-gray-200 overflow-hidden text-xs">
                <table className="w-full text-left divide-y divide-gray-200">
                  <thead className="bg-gray-50 text-gray-600 text-[11px]">
                    <tr>
                      <th className="px-3.5 py-2.5 font-semibold">Medicine</th>
                      <th className="px-3.5 py-2.5 font-semibold">Dosage</th>
                      <th className="px-3.5 py-2.5 font-semibold">Timing</th>
                      <th className="px-3.5 py-2.5 font-semibold">Duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {visit.prescription.items.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50/60">
                        <td className="px-3.5 py-2.5 font-medium text-gray-900">
                          <div className="flex items-center gap-1.5">
                            {item.dose_form && (
                              <span className="px-1.5 py-0.5 rounded bg-gray-100 text-[10px] text-gray-600 capitalize">
                                {item.dose_form}
                              </span>
                            )}
                            <span>{item.medicine_name}</span>
                          </div>
                        </td>
                        <td className="px-3.5 py-2.5 text-gray-700 font-mono">{item.dosage}</td>
                        <td className="px-3.5 py-2.5 text-gray-700">{item.timing || "—"}</td>
                        <td className="px-3.5 py-2.5 text-gray-700 font-mono">{item.duration}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-gray-500 italic">No medications prescribed.</p>
            )}
          </div>
        )}

        {/* Clinical Notes & Advice */}
        {(visit.clinical_notes || (visit.advice && visit.advice.length > 0)) && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-[#1769E0]" />
              Doctor Clinical Notes & Advice
            </h4>
            {visit.clinical_notes && (
              <div className="p-3 rounded-lg bg-gray-50 text-xs text-gray-700 leading-relaxed border border-gray-200 whitespace-pre-line">
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

        {/* Billing & Invoice Details */}
        {visit.invoice && (
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-[#1769E0]" />
              <span className="font-semibold text-gray-900">
                Invoice #{visit.invoice.invoice_number}
              </span>
              <span className="font-mono text-gray-700 font-medium">
                ₹{visit.invoice.total_amount.toFixed(2)}
              </span>
            </div>
            <div>
              {visit.invoice.balance_due === 0 ? (
                <Badge color="success" size="sm">
                  Paid Full (₹{visit.invoice.total_paid.toFixed(2)})
                </Badge>
              ) : (
                <Badge color="warning" size="sm">
                  Balance Due: ₹{visit.invoice.balance_due.toFixed(2)}
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Bottom Actions */}
        <div className="pt-4 border-t border-gray-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
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
                  Print Prescription (PDF)
                </Button>
              </a>
            ) : null}

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
                  Print Receipt (PDF)
                </Button>
              </a>
            )}
          </div>

          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function renderVitals(vitals?: Record<string, unknown> | null) {
  if (!vitals) return [];
  const items: { label: string; value: string }[] = [];

  if (vitals.bp_sys !== undefined && vitals.bp_sys !== null) {
    items.push({
      label: "BP",
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
    items.push({ label: "Temp", value: `${vitals.temp} °F` });
  }
  if (vitals.weight !== undefined && vitals.weight !== null) {
    items.push({ label: "Weight", value: `${vitals.weight} kg` });
  }

  return items;
}
