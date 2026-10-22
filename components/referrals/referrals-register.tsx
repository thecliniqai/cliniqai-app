"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Share2,
  Search,
  FileText,
  CheckCircle2,
  ExternalLink,
  Clock,
  AlertCircle,
  ShieldCheck,
  ChevronRight,
  X,
  Loader2,
  ArrowUpRight,
  ArrowDownLeft,
} from "lucide-react";
import { ReferralItem } from "@/features/referrals/types";
import {
  acknowledgeReferral,
  getReferralSignedUrl,
  getOutboundReferrals,
  getInboundReferrals,
} from "@/features/referrals/actions";
import { CloseLoopModal } from "./close-loop-modal";

export interface ReferralsRegisterProps {
  initialOutbound: ReferralItem[];
  initialInbound: ReferralItem[];
}

export function ReferralsRegister({
  initialOutbound,
  initialInbound,
}: ReferralsRegisterProps) {
  const [activeTab, setActiveTab] = useState<"outbound" | "inbound">("outbound");
  const [outboundList, setOutboundList] = useState<ReferralItem[]>(initialOutbound);
  const [inboundList, setInboundList] = useState<ReferralItem[]>(initialInbound);
  const [search, setSearch] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [urgencyFilter, setUrgencyFilter] = useState<string>("all");

  const [selectedForLoopClosure, setSelectedForLoopClosure] = useState<ReferralItem | null>(null);
  const [selectedForHistory, setSelectedForHistory] = useState<ReferralItem | null>(null);
  const [isOpeningUrl, setIsOpeningUrl] = useState<string | null>(null);
  const [isAcknowledging, setIsAcknowledging] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refreshData = async () => {
    try {
      const [outRes, inRes] = await Promise.all([
        getOutboundReferrals(),
        getInboundReferrals(),
      ]);
      if (outRes.success) setOutboundList(outRes.referrals);
      if (inRes.success) setInboundList(inRes.referrals);
    } catch (err) {
      console.error("Failed to refresh referrals:", err);
    }
  };

  const handleOpenPdf = async (referralId: string) => {
    setIsOpeningUrl(referralId);
    setActionError(null);
    try {
      const res = await getReferralSignedUrl(referralId);
      if (res.success && res.signedUrl) {
        window.open(res.signedUrl, "_blank", "noopener,noreferrer");
      } else {
        setActionError(res.error || "Failed to retrieve signed referral letter URL.");
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to open referral letter.");
    } finally {
      setIsOpeningUrl(null);
    }
  };

  const handleAcknowledge = async (referralId: string) => {
    setIsAcknowledging(referralId);
    setActionError(null);
    try {
      const res = await acknowledgeReferral(referralId);
      if (res.success) {
        await refreshData();
      } else {
        setActionError(res.error || "Failed to acknowledge referral.");
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to acknowledge referral.");
    } finally {
      setIsAcknowledging(null);
    }
  };

  const activeList = activeTab === "outbound" ? outboundList : inboundList;

  // Filter items
  const filteredList = activeList.filter((item) => {
    const q = search.toLowerCase().trim();
    if (q) {
      const patName = item.patient?.full_name?.toLowerCase() || "";
      const patPhone = item.patient?.phone?.toLowerCase() || "";
      const refDoctor = item.referred_to_name?.toLowerCase() || "";
      const refFacility = item.referred_to_facility?.toLowerCase() || "";
      const refSpecialty = item.referred_to_specialty?.toLowerCase() || "";
      const origClinic = item.originating_clinic?.name?.toLowerCase() || "";

      const matches =
        patName.includes(q) ||
        patPhone.includes(q) ||
        refDoctor.includes(q) ||
        refFacility.includes(q) ||
        refSpecialty.includes(q) ||
        origClinic.includes(q);

      if (!matches) return false;
    }

    if (statusFilter !== "all" && item.status !== statusFilter) {
      return false;
    }

    if (urgencyFilter !== "all" && item.urgency !== urgencyFilter) {
      return false;
    }

    return true;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "sent":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FFF5E5] text-[#9A5B00] border border-[#F3D39A]">
            Sent
          </span>
        );
      case "acknowledged":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#EAF2FF] text-[#1769E0] border border-[#BFD8FF]">
            Acknowledged
          </span>
        );
      case "completed":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#EAF7F0] text-[#18794E] border border-[#BDE5CF]">
            Completed
          </span>
        );
      case "cancelled":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FFEDEC] text-[#BA1A1A] border border-[#FFDAD6]">
            Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-700">
            {status}
          </span>
        );
    }
  };

  const getUrgencyBadge = (urgency: string) => {
    switch (urgency) {
      case "urgent":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-[#FFEDEC] text-[#BA1A1A] border border-[#FFDAD6]">
            URGENT
          </span>
        );
      case "priority":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#FFF5E5] text-[#9A5B00] border border-[#F3D39A]">
            Priority
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-gray-100 text-gray-600">
            Routine
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
            Referrals Register
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            Track outbound specialist consultations and in-network inbound patient transfers.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center bg-gray-100 p-1 rounded-xl self-start sm:self-auto">
          <button
            type="button"
            onClick={() => {
              setActiveTab("outbound");
              setSearch("");
            }}
            className={`min-h-[38px] px-4 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === "outbound"
                ? "bg-white text-gray-900 shadow-xs"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <ArrowUpRight className="h-4 w-4 text-[#1769E0]" />
            <span>Outbound Referrals</span>
            <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-gray-100 text-gray-700">
              {outboundList.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("inbound");
              setSearch("");
            }}
            className={`min-h-[38px] px-4 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === "inbound"
                ? "bg-white text-gray-900 shadow-xs"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <ArrowDownLeft className="h-4 w-4 text-emerald-600" />
            <span>Inbound Referrals</span>
            <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-gray-100 text-gray-700">
              {inboundList.length}
            </span>
          </button>
        </div>
      </div>

      {actionError && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-3.5 text-xs text-rose-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-rose-600 hover:text-rose-800 font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 2. Filter Toolbar */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-2xs flex flex-col md:flex-row md:items-center gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              activeTab === "outbound"
                ? "Search by patient name, phone, specialist, facility..."
                : "Search by patient name, originating clinic..."
            }
            className="w-full min-h-[44px] pl-9 pr-3 rounded-xl border border-gray-200 text-xs text-gray-900 placeholder:text-gray-400 bg-[#F8FAFC] focus:bg-white focus:outline-none focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0]"
          />
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="min-h-[44px] px-3 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 bg-white focus:outline-none focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0]"
          >
            <option value="all">All Statuses</option>
            <option value="sent">Sent</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>

          {/* Urgency Filter */}
          <select
            value={urgencyFilter}
            onChange={(e) => setUrgencyFilter(e.target.value)}
            className="min-h-[44px] px-3 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 bg-white focus:outline-none focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0]"
          >
            <option value="all">All Urgencies</option>
            <option value="routine">Routine</option>
            <option value="priority">Priority</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
      </div>

      {/* 3. Table / Card List */}
      {filteredList.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center shadow-2xs">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
            <Share2 className="h-6 w-6 text-gray-400" />
          </div>
          <h3 className="text-sm font-bold text-gray-900">
            {search || statusFilter !== "all" || urgencyFilter !== "all"
              ? "No referrals match your filters"
              : activeTab === "outbound"
              ? "No outbound referrals created yet"
              : "No inbound referrals received yet"}
          </h3>
          <p className="text-xs text-gray-500 max-w-sm mx-auto mt-1">
            {activeTab === "outbound"
              ? "Initiate referrals directly inside an active consultation visit or from the patient profile."
              : "Inbound referrals from connected partner clinics will appear here with consented clinical history."}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-2xs overflow-hidden">
          {/* Desktop Table View (>= 768px) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-200 bg-[#F8FAFC]">
                  <th className="py-3.5 px-4 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                    Patient
                  </th>
                  <th className="py-3.5 px-4 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                    {activeTab === "outbound" ? "Referred To" : "Originating Clinic"}
                  </th>
                  <th className="py-3.5 px-4 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                    Reason & Notes
                  </th>
                  <th className="py-3.5 px-4 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                    Urgency
                  </th>
                  <th className="py-3.5 px-4 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                    Date Sent
                  </th>
                  <th className="py-3.5 px-4 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="py-3.5 px-4 text-[11px] font-bold text-gray-500 uppercase tracking-wider text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {filteredList.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50/70 transition-colors">
                    {/* Patient */}
                    <td className="py-3.5 px-4">
                      <Link
                        href={`/patients/${item.patient_id}`}
                        className="font-bold text-gray-900 hover:text-[#1769E0] transition-colors"
                      >
                        {item.patient?.full_name || "Patient"}
                      </Link>
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        {item.patient?.age ? `${item.patient.age}y` : ""}
                        {item.patient?.sex ? ` • ${item.patient.sex.toUpperCase()}` : ""}
                        {item.patient?.phone ? ` • ${item.patient.phone}` : ""}
                      </div>
                    </td>

                    {/* Specialist / Origin */}
                    <td className="py-3.5 px-4">
                      {activeTab === "outbound" ? (
                        <div>
                          <div className="font-semibold text-gray-900">
                            Dr. {item.referred_to_name}
                          </div>
                          <div className="text-[11px] text-gray-500">
                            {item.referred_to_specialty
                              ? `${item.referred_to_specialty} • `
                              : ""}
                            {item.referred_to_facility || "External Specialist"}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="font-semibold text-gray-900">
                            {item.originating_clinic?.name || "Partner Clinic"}
                          </div>
                          {item.originating_clinic?.phone && (
                            <div className="text-[11px] text-gray-400">
                              Ph: {item.originating_clinic.phone}
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Reason */}
                    <td className="py-3.5 px-4 max-w-xs">
                      <div className="font-medium text-gray-800 line-clamp-1">
                        {item.reason_for_referral}
                      </div>
                      {item.provisional_diagnosis && (
                        <div className="text-[11px] text-gray-500 mt-0.5 line-clamp-1">
                          <span className="font-semibold">Dx:</span> {item.provisional_diagnosis}
                        </div>
                      )}
                      {item.status === "completed" && item.closure_notes && (
                        <div className="text-[11px] text-emerald-700 mt-0.5 line-clamp-1">
                          <span className="font-semibold">Returned:</span> {item.closure_notes}
                        </div>
                      )}
                    </td>

                    {/* Urgency */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {getUrgencyBadge(item.urgency)}
                    </td>

                    {/* Date */}
                    <td className="py-3.5 px-4 whitespace-nowrap text-gray-600">
                      {new Date(item.sent_at).toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {getStatusBadge(item.status)}
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* Outbound actions */}
                        {activeTab === "outbound" && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleOpenPdf(item.id)}
                              disabled={isOpeningUrl === item.id}
                              className="min-h-[36px] px-2.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-semibold text-[11px] inline-flex items-center gap-1 transition-colors disabled:opacity-50"
                              title="View Branded PDF Referral Letter"
                            >
                              {isOpeningUrl === item.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-500" />
                              ) : (
                                <FileText className="h-3.5 w-3.5 text-gray-500" />
                              )}
                              <span>Letter</span>
                            </button>

                            {(item.status === "sent" || item.status === "acknowledged") && (
                              <button
                                type="button"
                                onClick={() => setSelectedForLoopClosure(item)}
                                className="min-h-[36px] px-3 rounded-lg bg-[#1769E0] hover:bg-[#155cc0] text-white font-semibold text-[11px] inline-flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                                title="Record specialist findings and mark completed"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span>Close Loop</span>
                              </button>
                            )}
                          </>
                        )}

                        {/* Inbound actions */}
                        {activeTab === "inbound" && (
                          <>
                            {item.status === "sent" && (
                              <button
                                type="button"
                                onClick={() => handleAcknowledge(item.id)}
                                disabled={isAcknowledging === item.id}
                                className="min-h-[36px] px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[11px] inline-flex items-center gap-1 transition-colors disabled:opacity-50 cursor-pointer"
                              >
                                {isAcknowledging === item.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                )}
                                <span>Acknowledge</span>
                              </button>
                            )}

                            {item.patient_consents_history_sharing && (
                              <button
                                type="button"
                                onClick={() => setSelectedForHistory(item)}
                                className="min-h-[36px] px-2.5 rounded-lg border border-blue-200 bg-[#EAF2FF] hover:bg-blue-100 text-[#1769E0] font-semibold text-[11px] inline-flex items-center gap-1 transition-colors"
                              >
                                <ShieldCheck className="h-3.5 w-3.5" />
                                <span>Consented History</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleOpenPdf(item.id)}
                              disabled={isOpeningUrl === item.id}
                              className="min-h-[36px] px-2.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-semibold text-[11px] inline-flex items-center gap-1 transition-colors"
                            >
                              <FileText className="h-3.5 w-3.5 text-gray-500" />
                              <span>Letter</span>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card Layout (< 768px) */}
          <div className="md:hidden divide-y divide-gray-100">
            {filteredList.map((item) => (
              <div key={item.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/patients/${item.patient_id}`}
                      className="font-bold text-sm text-gray-900 hover:text-[#1769E0]"
                    >
                      {item.patient?.full_name || "Patient"}
                    </Link>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      {item.patient?.phone ? `${item.patient.phone} • ` : ""}
                      {new Date(item.sent_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {getStatusBadge(item.status)}
                    {getUrgencyBadge(item.urgency)}
                  </div>
                </div>

                <div className="text-xs text-gray-700">
                  <div className="font-semibold text-gray-900">
                    {activeTab === "outbound"
                      ? `To: Dr. ${item.referred_to_name} (${item.referred_to_specialty || "Specialist"})`
                      : `From: ${item.originating_clinic?.name || "Partner Clinic"}`}
                  </div>
                  <div className="text-gray-500 mt-0.5">{item.reason_for_referral}</div>
                </div>

                {item.status === "completed" && item.closure_notes && (
                  <div className="p-2.5 rounded-lg bg-[#EAF7F0] border border-[#BDE5CF] text-xs text-[#18794E]">
                    <span className="font-bold">Loop Closed: </span>
                    {item.closure_notes}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => handleOpenPdf(item.id)}
                    disabled={isOpeningUrl === item.id}
                    className="min-h-[38px] px-3 rounded-lg border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-50 flex items-center gap-1"
                  >
                    <FileText className="h-3.5 w-3.5 text-gray-500" />
                    <span>Letter</span>
                  </button>

                  {activeTab === "outbound" &&
                    (item.status === "sent" || item.status === "acknowledged") && (
                      <button
                        type="button"
                        onClick={() => setSelectedForLoopClosure(item)}
                        className="min-h-[38px] px-3 rounded-lg bg-[#1769E0] text-white text-xs font-semibold flex items-center gap-1"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Close Loop</span>
                      </button>
                    )}

                  {activeTab === "inbound" && item.status === "sent" && (
                    <button
                      type="button"
                      onClick={() => handleAcknowledge(item.id)}
                      disabled={isAcknowledging === item.id}
                      className="min-h-[38px] px-3 rounded-lg bg-emerald-600 text-white text-xs font-semibold flex items-center gap-1"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Acknowledge</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Close the Loop Modal */}
      {selectedForLoopClosure && (
        <CloseLoopModal
          referral={selectedForLoopClosure}
          isOpen={true}
          onClose={() => setSelectedForLoopClosure(null)}
          onSuccess={async () => {
            setSelectedForLoopClosure(null);
            await refreshData();
          }}
        />
      )}

      {/* 5. Consented History Modal */}
      {selectedForHistory && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 overflow-y-auto"
        >
          <div className="bg-white rounded-2xl shadow-theme-lg border border-gray-200 max-w-xl w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-[#EAF2FF]">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-[#1769E0]" />
                <div>
                  <h3 className="text-sm font-bold text-gray-900">
                    DPDP Consented Clinical History
                  </h3>
                  <p className="text-[11px] text-gray-500">
                    Patient: {selectedForHistory.patient?.full_name} • Transferred securely
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedForHistory(null)}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {selectedForHistory.consented_history_snapshot &&
              (selectedForHistory.consented_history_snapshot as any).encounters ? (
                (selectedForHistory.consented_history_snapshot as any).encounters.map(
                  (enc: any, i: number) => (
                    <div
                      key={i}
                      className="p-3.5 rounded-xl border border-gray-200 bg-[#F8FAFC] space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-900">
                          Visit Date: {enc.visit_date}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-gray-200 text-gray-700">
                          Encounter #{i + 1}
                        </span>
                      </div>

                      {enc.diagnoses && enc.diagnoses.length > 0 && (
                        <div className="text-xs">
                          <span className="font-semibold text-gray-700">Diagnoses: </span>
                          <span className="text-gray-900 font-medium">
                            {enc.diagnoses.join(", ")}
                          </span>
                        </div>
                      )}

                      {enc.vitals && (
                        <div className="text-xs text-gray-600 flex flex-wrap gap-2">
                          {enc.vitals.systolic && (
                            <span>BP: {enc.vitals.systolic}/{enc.vitals.diastolic}</span>
                          )}
                          {enc.vitals.pulse && <span>Pulse: {enc.vitals.pulse} bpm</span>}
                          {enc.vitals.temperature && (
                            <span>Temp: {enc.vitals.temperature}°F</span>
                          )}
                        </div>
                      )}

                      {enc.medications && enc.medications.length > 0 && (
                        <div className="text-xs">
                          <span className="font-semibold text-gray-700">Medications: </span>
                          <span className="text-gray-900">
                            {enc.medications
                              .map((m: any) => `${m.medicine_name} (${m.dosage})`)
                              .join(", ")}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                )
              ) : (
                <p className="text-xs text-gray-500">
                  No previous encounter snapshots were bundled with this referral.
                </p>
              )}
            </div>

            <div className="flex justify-end p-4 border-t border-gray-100 bg-gray-50">
              <button
                type="button"
                onClick={() => setSelectedForHistory(null)}
                className="min-h-[44px] px-4 rounded-xl border border-gray-300 bg-white hover:bg-gray-100 text-xs font-semibold text-gray-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
