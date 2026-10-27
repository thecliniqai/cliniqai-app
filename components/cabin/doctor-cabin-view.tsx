"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MyQueueCard, CabinVisitItem } from "./my-queue-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Stethoscope,
  Users,
  Clock,
  CheckCircle2,
  Calendar,
  AlertCircle,
  FileCheck,
  RotateCw,
  ExternalLink,
  ChevronDown,
  User,
  Printer,
  Receipt,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { sharePrescriptionViaWhatsApp } from "@/features/prescriptions/actions";
import { shareReceiptViaWhatsApp } from "@/features/billing/actions";

export interface DoctorOption {
  id: string;
  name: string;
  role: string;
}

interface DoctorCabinViewProps {
  activeVisit: CabinVisitItem | null;
  waitingVisits: CabinVisitItem[];
  completedVisits: CabinVisitItem[];
  currentDoctorId: string;
  doctorName: string;
  doctors: DoctorOption[];
  isOwnerOrAdmin: boolean;
  currentDate: string;
}

export function DoctorCabinView({
  activeVisit,
  waitingVisits,
  completedVisits,
  currentDoctorId,
  doctorName,
  doctors,
  isOwnerOrAdmin,
  currentDate,
}: DoctorCabinViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedDoctor, setSelectedDoctor] = useState(currentDoctorId);
  const [activeTab, setActiveTab] = useState<"waiting" | "completed">("waiting");

  const [waSendingState, setWaSendingState] = useState<Record<string, "sending" | "sent" | "error">>({});

  const handleShareRxWhatsApp = async (visitId: string) => {
    const key = `rx-${visitId}`;
    if (waSendingState[key] === "sending" || waSendingState[key] === "sent") return;
    setWaSendingState((prev) => ({ ...prev, [key]: "sending" }));
    try {
      const res = await sharePrescriptionViaWhatsApp(visitId);
      if (res.success) {
        setWaSendingState((prev) => ({ ...prev, [key]: "sent" }));
      } else {
        setWaSendingState((prev) => ({ ...prev, [key]: "error" }));
        alert(res.error || "Failed to send prescription via WhatsApp");
      }
    } catch (err: unknown) {
      setWaSendingState((prev) => ({ ...prev, [key]: "error" }));
      alert(err instanceof Error ? err.message : "Error sending WhatsApp");
    }
  };

  const handleShareReceiptWhatsApp = async (invoiceOrVisitId: string) => {
    const key = `inv-${invoiceOrVisitId}`;
    if (waSendingState[key] === "sending" || waSendingState[key] === "sent") return;
    setWaSendingState((prev) => ({ ...prev, [key]: "sending" }));
    try {
      const res = await shareReceiptViaWhatsApp(invoiceOrVisitId);
      if (res.success) {
        setWaSendingState((prev) => ({ ...prev, [key]: "sent" }));
      } else {
        setWaSendingState((prev) => ({ ...prev, [key]: "error" }));
        alert(res.error || "Failed to send receipt via WhatsApp");
      }
    } catch (err: unknown) {
      setWaSendingState((prev) => ({ ...prev, [key]: "error" }));
      alert(err instanceof Error ? err.message : "Error sending WhatsApp");
    }
  };

  const totalPatientsSeen = completedVisits.length;
  const waitingCount = waitingVisits.length;
  const inCabinCount = activeVisit ? 1 : 0;

  const handleDoctorChange = (doctorId: string) => {
    setSelectedDoctor(doctorId);
    startTransition(() => {
      const url = new URL(window.location.href);
      if (doctorId === "all") {
        url.searchParams.delete("doctor");
      } else {
        url.searchParams.set("doctor", doctorId);
      }
      router.push(url.pathname + url.search);
    });
  };

  const handleRefresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Doctor Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-200 shadow-theme-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-[#EAF2FF] text-[#1769E0] flex items-center justify-center shadow-theme-xs">
              <Stethoscope className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
                Doctor&apos;s Cabin
              </h1>
              <p className="text-xs text-gray-500 font-medium">
                Clinical Workspace &middot;{" "}
                {new Date(currentDate).toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
          </div>
        </div>

        {/* Doctor selector or badge */}
        <div className="flex items-center gap-2.5">
          {isOwnerOrAdmin && doctors.length > 1 ? (
            <div className="flex items-center gap-2">
              <label htmlFor="doctor-select" className="text-xs text-gray-500 font-medium hidden sm:inline">
                Viewing Cabin:
              </label>
              <div className="relative">
                <select
                  id="doctor-select"
                  value={selectedDoctor}
                  onChange={(e) => handleDoctorChange(e.target.value)}
                  disabled={isPending}
                  className="h-10 text-xs font-semibold rounded-xl border border-gray-200 bg-gray-50/70 hover:bg-gray-50 text-gray-800 ps-3 pe-8 appearance-none focus:outline-none focus:ring-2 focus:ring-[#1769E0]/20 focus:border-[#1769E0] cursor-pointer shadow-2xs"
                >
                  <option value="all">All Doctors (Clinic Overview)</option>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-gray-400 absolute end-2.5 top-3 pointer-events-none" />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gray-50 border border-gray-200 text-xs font-semibold text-gray-700">
              <User className="w-4 h-4 text-[#1769E0]" />
              <span>{doctorName}</span>
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isPending}
            className="h-10 px-3 rounded-xl border-gray-200 text-gray-600 hover:text-gray-900 hover:bg-gray-50 shadow-2xs cursor-pointer"
            title="Refresh Cabin Queue"
          >
            <RotateCw className={cn("w-4 h-4", isPending && "animate-spin text-[#1769E0]")} />
          </Button>
        </div>
      </div>

      {/* Cabin Flow Quick Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Active In Cabin */}
        <div
          className={cn(
            "p-4 rounded-xl border transition-all shadow-theme-xs flex items-center justify-between",
            inCabinCount > 0
              ? "bg-[#EAF2FF]/60 border-[#B2CCFF]"
              : "bg-white border-gray-200"
          )}
        >
          <div>
            <span className="text-xs font-medium text-gray-500">Currently In Cabin</span>
            <div className="text-2xl font-bold text-gray-900 mt-0.5">
              {inCabinCount > 0 ? "1 Patient" : "None"}
            </div>
          </div>
          <div
            className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center",
              inCabinCount > 0
                ? "bg-[#1769E0] text-white shadow-theme-xs"
                : "bg-gray-100 text-gray-400"
            )}
          >
            <Stethoscope className="w-5 h-5" />
          </div>
        </div>

        {/* Waiting Queue */}
        <div className="p-4 rounded-xl border bg-white border-gray-200 shadow-theme-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-gray-500">Waiting Outside</span>
            <div className="text-2xl font-bold text-gray-900 mt-0.5">
              {waitingCount} {waitingCount === 1 ? "Patient" : "Patients"}
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        {/* Consultations Completed Today */}
        <div className="p-4 rounded-xl border bg-white border-gray-200 shadow-theme-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-gray-500">Completed Today</span>
            <div className="text-2xl font-bold text-gray-900 mt-0.5">
              {totalPatientsSeen}
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Active Consultation Alert Banner */}
      {activeVisit && (
        <div className="p-5 rounded-2xl bg-gradient-to-r from-[#EAF2FF] to-blue-50/70 border-2 border-[#1769E0]/40 shadow-theme-xs relative overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-[#1769E0] text-white flex items-center justify-center shrink-0 shadow-theme-xs">
                <Stethoscope className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold tracking-wide uppercase flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                    In Consultation Now
                  </span>
                  <span className="text-xs font-bold text-[#1769E0] bg-white px-2 py-0.5 rounded-md border border-[#B2CCFF]">
                    Token #{activeVisit.token_number != null ? String(activeVisit.token_number).padStart(2, "0") : "--"}
                  </span>
                </div>
                <h2 className="text-lg font-bold text-gray-900 mt-1">
                  {activeVisit.patient.full_name}
                </h2>
                <p className="text-xs text-gray-600 mt-0.5">
                  {activeVisit.patient.age != null ? `${activeVisit.patient.age}y · ` : ""}
                  {activeVisit.patient.sex ? `${activeVisit.patient.sex} · ` : ""}
                  {activeVisit.reason_for_visit
                    ? `Reason: ${activeVisit.reason_for_visit}`
                    : "Consultation in progress"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href={`/consultation/${activeVisit.id}`}
                className="h-11 px-6 rounded-xl bg-[#1769E0] text-white hover:bg-[#155cc0] font-semibold text-sm shadow-theme-xs transition-all flex items-center gap-2 shrink-0 cursor-pointer"
              >
                <Stethoscope className="w-4 h-4" />
                <span>Resume Consultation</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Tabs navigation for Waiting Queue vs Today's Completed */}
      <div className="flex items-center justify-between border-b border-gray-200">
        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={() => setActiveTab("waiting")}
            className={cn(
              "pb-3 text-sm font-semibold transition-colors relative cursor-pointer flex items-center gap-2",
              activeTab === "waiting"
                ? "text-[#1769E0]"
                : "text-gray-500 hover:text-gray-900"
            )}
          >
            <span>Waiting Patients</span>
            <span
              className={cn(
                "px-2 py-0.5 text-xs rounded-full font-bold",
                activeTab === "waiting"
                  ? "bg-[#EAF2FF] text-[#1769E0]"
                  : "bg-gray-100 text-gray-600"
              )}
            >
              {waitingCount}
            </span>
            {activeTab === "waiting" && (
              <span className="absolute bottom-0 inset-x-0 h-0.5 bg-[#1769E0] rounded-t-full" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("completed")}
            className={cn(
              "pb-3 text-sm font-semibold transition-colors relative cursor-pointer flex items-center gap-2",
              activeTab === "completed"
                ? "text-[#1769E0]"
                : "text-gray-500 hover:text-gray-900"
            )}
          >
            <span>Today&apos;s Completed</span>
            <span
              className={cn(
                "px-2 py-0.5 text-xs rounded-full font-bold",
                activeTab === "completed"
                  ? "bg-[#EAF2FF] text-[#1769E0]"
                  : "bg-gray-100 text-gray-600"
              )}
            >
              {totalPatientsSeen}
            </span>
            {activeTab === "completed" && (
              <span className="absolute bottom-0 inset-x-0 h-0.5 bg-[#1769E0] rounded-t-full" />
            )}
          </button>
        </div>
      </div>

      {/* Tab Panels */}
      {activeTab === "waiting" && (
        <div>
          {waitingVisits.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center shadow-theme-xs">
              <div className="w-12 h-12 rounded-full bg-blue-50 text-[#1769E0] flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-gray-900">
                No patients waiting in queue
              </h3>
              <p className="text-xs text-gray-500 max-w-sm mx-auto mt-1">
                When patients are checked in at the front desk or arrive for scheduled
                consultations, they will appear here in real-time.
              </p>
              <div className="mt-5 flex justify-center gap-3">
                <Link
                  href="/queue"
                  className="text-xs text-[#1769E0] font-semibold hover:underline flex items-center gap-1"
                >
                  <span>Open Front Desk Live Queue</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {waitingVisits.map((visit) => (
                <MyQueueCard key={visit.id} visit={visit} />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "completed" && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-theme-xs">
          {completedVisits.length === 0 ? (
            <div className="p-8 text-center">
              <Clock className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-sm font-medium text-gray-700">
                No consultations completed yet today.
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Completed patient visits and finalized prescriptions will be listed here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {completedVisits.map((visit) => (
                <div
                  key={visit.id}
                  className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-gray-50/70 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900 text-sm">
                          {visit.patient.full_name}
                        </span>
                        {visit.token_number && (
                          <span className="text-[11px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                            #{visit.token_number}
                          </span>
                        )}
                        {visit.prescription?.signed_at && (
                          <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                            <FileCheck className="w-3 h-3" />
                            Rx Signed
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {visit.patient.age ? `${visit.patient.age}y · ` : ""}
                        {visit.patient.sex ? `${visit.patient.sex} · ` : ""}
                        {visit.reason_for_visit ? `Reason: ${visit.reason_for_visit}` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/consultation/${visit.id}`}
                      className="h-9 px-3.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-semibold text-xs transition-colors flex items-center gap-1.5 shadow-2xs"
                    >
                      <Stethoscope className="w-3.5 h-3.5 text-[#1769E0]" />
                      <span>Review Visit</span>
                    </Link>

                    {visit.prescription && (
                      <button
                        type="button"
                        disabled={waSendingState[`rx-${visit.id}`] === "sending" || waSendingState[`rx-${visit.id}`] === "sent"}
                        onClick={() => handleShareRxWhatsApp(visit.id)}
                        className={cn(
                          "h-9 px-3 rounded-xl font-semibold text-xs transition-colors flex items-center gap-1.5 shadow-2xs border cursor-pointer",
                          waSendingState[`rx-${visit.id}`] === "sent"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 cursor-default"
                            : "bg-emerald-600 hover:bg-emerald-700 text-white border-transparent disabled:opacity-50"
                        )}
                        title="Send Prescription via WhatsApp"
                      >
                        {waSendingState[`rx-${visit.id}`] === "sending" ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : waSendingState[`rx-${visit.id}`] === "sent" ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <MessageSquare className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {waSendingState[`rx-${visit.id}`] === "sent" ? "Sent ✓" : "WhatsApp Rx"}
                        </span>
                      </button>
                    )}

                    {visit.prescription && (
                      <a
                        href={`/api/visits/${visit.id}/prescription-pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="h-9 px-3 rounded-xl bg-[#EAF2FF] hover:bg-[#d6e5ff] text-[#1769E0] font-semibold text-xs transition-colors flex items-center gap-1.5 shadow-2xs"
                        title="Print / View Signed PDF Prescription"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Print Rx</span>
                      </a>
                    )}

                    <button
                      type="button"
                      disabled={waSendingState[`inv-${visit.id}`] === "sending" || waSendingState[`inv-${visit.id}`] === "sent"}
                      onClick={() => handleShareReceiptWhatsApp(visit.id)}
                      className={cn(
                        "h-9 px-3 rounded-xl font-semibold text-xs transition-colors flex items-center gap-1.5 shadow-2xs border cursor-pointer",
                        waSendingState[`inv-${visit.id}`] === "sent"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200 cursor-default"
                          : "border-gray-200 bg-white hover:bg-emerald-50 text-gray-700 hover:text-emerald-700 disabled:opacity-50"
                      )}
                      title="Send Receipt via WhatsApp"
                    >
                      {waSendingState[`inv-${visit.id}`] === "sending" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : waSendingState[`inv-${visit.id}`] === "sent" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                      )}
                      <span>
                        {waSendingState[`inv-${visit.id}`] === "sent" ? "Sent ✓" : "WhatsApp Receipt"}
                      </span>
                    </button>

                    <a
                      href={`/api/invoices/${visit.id}/receipt-pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="h-9 px-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-semibold text-xs transition-colors flex items-center gap-1.5 shadow-2xs"
                      title="Print / View Payment Receipt"
                    >
                      <Receipt className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Receipt</span>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
