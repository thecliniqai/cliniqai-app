"use client";

import React, { useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Calendar,
  Clock,
  Search,
  Filter,
  Printer,
  Receipt,
  ArrowUpRight,
  Stethoscope,
  Activity,
  CreditCard,
  Pill,
  Users,
  CheckCircle2,
  Hourglass,
  RotateCcw,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import {
  ClinicVisitRegisterItem,
  ClinicVisitsSummaryMetrics,
  ActiveDoctorOption,
  DatePreset,
} from "@/features/visits/schema";
import { ReadOnlyEncounterModal } from "./read-only-encounter-modal";
import { cn } from "@/lib/utils";

interface VisitsRegisterViewProps {
  initialVisits: ClinicVisitRegisterItem[];
  metrics: ClinicVisitsSummaryMetrics;
  totalCount: number;
  currentPage: number;
  pageSize: number;
  totalPages: number;
  activeDoctors: ActiveDoctorOption[];
  userRole: string;
  currentFilters: {
    datePreset: DatePreset;
    startDate?: string | null;
    endDate?: string | null;
    doctorId: string;
    status: string;
    specialty: string;
    searchQuery: string;
  };
}

export function VisitsRegisterView({
  initialVisits,
  metrics,
  totalCount,
  currentPage,
  pageSize,
  totalPages,
  activeDoctors,
  userRole,
  currentFilters,
}: VisitsRegisterViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Search input local state
  const [searchInput, setSearchInput] = useState(currentFilters.searchQuery || "");
  const [customStart, setCustomStart] = useState(currentFilters.startDate || "");
  const [customEnd, setCustomEnd] = useState(currentFilters.endDate || "");

  // Modal inspection state for non-doctor roles
  const [previewVisit, setPreviewVisit] = useState<ClinicVisitRegisterItem | null>(null);

  const isDoctorOrOwner = ["owner", "admin", "doctor"].includes(userRole);

  const updateFilters = (updates: Record<string, string | number | undefined | null>) => {
    const params = new URLSearchParams(searchParams.toString());

    Object.entries(updates).forEach(([key, val]) => {
      if (val === undefined || val === null || val === "" || val === "all") {
        params.delete(key);
      } else {
        params.set(key, String(val));
      }
    });

    // Reset to page 1 on filter changes unless page was explicitly updated
    if (!("page" in updates)) {
      params.delete("page");
    }

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilters({ search: searchInput.trim() || undefined });
  };

  const resetFilters = () => {
    setSearchInput("");
    setCustomStart("");
    setCustomEnd("");
    startTransition(() => {
      router.push(pathname);
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
            Clinic Visits Register
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            Unified chronological log of all patient visits, clinical encounters, and documents.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/calendar">
            <Button variant="secondary" size="sm" startIcon={<Calendar className="w-3.5 h-3.5" />}>
              Calendar View
            </Button>
          </Link>
          <Link href="/queue">
            <Button variant="primary" size="sm" startIcon={<Clock className="w-3.5 h-3.5" />}>
              Live Queue
            </Button>
          </Link>
        </div>
      </div>

      {/* Summary Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 rounded-xl border border-gray-200 bg-white shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Total Encounters
            </span>
            <span className="p-1.5 rounded-lg bg-blue-50 text-[#1769E0]">
              <Users className="w-4 h-4" />
            </span>
          </div>
          <p className="text-2xl font-bold text-gray-900 mt-2 tabular-nums">
            {metrics.totalVisits}
          </p>
          <span className="text-[11px] text-gray-400 mt-1 block">Filtered time period</span>
        </div>

        <div className="p-4 rounded-xl border border-gray-200 bg-white shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Completed Visits
            </span>
            <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="w-4 h-4" />
            </span>
          </div>
          <p className="text-2xl font-bold text-emerald-700 mt-2 tabular-nums">
            {metrics.completedVisits}
          </p>
          <span className="text-[11px] text-emerald-600 mt-1 block">Prescriptions finalized</span>
        </div>

        <div className="p-4 rounded-xl border border-gray-200 bg-white shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              In Clinic / Queue
            </span>
            <span className="p-1.5 rounded-lg bg-amber-50 text-amber-600">
              <Hourglass className="w-4 h-4" />
            </span>
          </div>
          <p className="text-2xl font-bold text-amber-700 mt-2 tabular-nums">
            {metrics.inProgressVisits + metrics.waitingVisits}
          </p>
          <span className="text-[11px] text-amber-600 mt-1 block">
            {metrics.inProgressVisits} active, {metrics.waitingVisits} waiting
          </span>
        </div>

        <div className="p-4 rounded-xl border border-gray-200 bg-white shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Total Billed
            </span>
            <span className="p-1.5 rounded-lg bg-purple-50 text-purple-600">
              <CreditCard className="w-4 h-4" />
            </span>
          </div>
          <p className="text-2xl font-bold text-gray-900 mt-2 tabular-nums">
            ₹{metrics.totalBilledRevenue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </p>
          <span className="text-[11px] text-gray-400 mt-1 block">Consultations & fees</span>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="p-4 rounded-2xl border border-gray-200 bg-white shadow-xs space-y-4">
        {/* Preset Pills & Search Row */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Date Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { label: "Today", value: "today" },
                { label: "Yesterday", value: "yesterday" },
                { label: "Last 7 Days", value: "last_7_days" },
                { label: "This Month", value: "this_month" },
                { label: "Custom Range", value: "custom" },
              ] as const
            ).map((preset) => {
              const active = currentFilters.datePreset === preset.value;
              return (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => updateFilters({ preset: preset.value })}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer",
                    active
                      ? "bg-[#1769E0] text-white shadow-theme-xs font-semibold"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          {/* Search bar */}
          <form onSubmit={handleSearchSubmit} className="relative w-full md:w-72">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search patient, phone, UHID..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#1769E0]/20 focus:border-[#1769E0] transition-all bg-white"
            />
          </form>
        </div>

        {/* Custom Range Picker (when custom is active) */}
        {currentFilters.datePreset === "custom" && (
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-gray-500 font-medium">From:</span>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-2.5 py-1 text-xs rounded-lg border border-gray-300 bg-white focus:outline-none focus:border-[#1769E0]"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 font-medium">To:</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-2.5 py-1 text-xs rounded-lg border border-gray-300 bg-white focus:outline-none focus:border-[#1769E0]"
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                updateFilters({
                  start: customStart || undefined,
                  end: customEnd || undefined,
                })
              }
            >
              Apply Range
            </Button>
          </div>
        )}

        {/* Dropdowns: Doctor, Status, Specialty, Reset */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-gray-100 text-xs">
          {/* Doctor filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500 font-medium">Doctor:</span>
            <select
              value={currentFilters.doctorId || "all"}
              onChange={(e) => updateFilters({ doctor: e.target.value })}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-300 bg-white text-gray-800 focus:outline-none focus:border-[#1769E0] cursor-pointer"
            >
              <option value="all">All Doctors</option>
              {activeDoctors.map((doc) => (
                <option key={doc.user_id} value={doc.user_id}>
                  {doc.full_name}
                </option>
              ))}
            </select>
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500 font-medium">Status:</span>
            <select
              value={currentFilters.status || "all"}
              onChange={(e) => updateFilters({ status: e.target.value })}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-300 bg-white text-gray-800 focus:outline-none focus:border-[#1769E0] cursor-pointer"
            >
              <option value="all">All Statuses</option>
              <option value="waiting">Waiting</option>
              <option value="in_consultation">In Consultation</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {/* Specialty filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500 font-medium">Specialty:</span>
            <select
              value={currentFilters.specialty || "all"}
              onChange={(e) => updateFilters({ specialty: e.target.value })}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-300 bg-white text-gray-800 focus:outline-none focus:border-[#1769E0] cursor-pointer"
            >
              <option value="all">All Specialties</option>
              <option value="general_physician">General Physician</option>
              <option value="dental">Dental</option>
              <option value="pediatrics">Pediatrics</option>
            </select>
          </div>

          {/* Reset Filters button */}
          <button
            type="button"
            onClick={resetFilters}
            className="ml-auto inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 font-medium px-2 py-1 rounded hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-gray-400" />
            Reset Filters
          </button>
        </div>
      </div>

      {/* Main Visits Table Card */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-xs overflow-hidden">
        {initialVisits.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center mx-auto">
              <Calendar className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900">No Patient Visits Found</h3>
            <p className="text-xs text-gray-500 max-w-sm mx-auto leading-relaxed">
              No clinical visits match the selected date range, doctor, or search criteria.
            </p>
            <Button variant="outline" size="sm" onClick={resetFilters}>
              Reset Filters
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left divide-y divide-gray-200 text-xs">
              <thead className="bg-gray-50/80 text-gray-600 text-[11px] uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-4 py-3.5">Visit & Time</th>
                  <th className="px-4 py-3.5">Patient Details</th>
                  <th className="px-4 py-3.5">Doctor</th>
                  <th className="px-4 py-3.5">Clinical Diagnoses / Reason</th>
                  <th className="px-4 py-3.5">Prescription</th>
                  <th className="px-4 py-3.5">Billing</th>
                  <th className="px-4 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {initialVisits.map((visit) => {
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
                    <tr
                      key={visit.id}
                      className="hover:bg-gray-50/60 transition-colors group"
                    >
                      {/* Visit Date, Time, Token, Status */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="space-y-1">
                          <span className="font-semibold text-gray-900 block">
                            {formattedDate}
                          </span>
                          <span className="text-[11px] text-gray-500 font-mono block">
                            {formattedTime}
                          </span>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {visit.token_number && (
                              <span className="px-1.5 py-0.5 rounded bg-blue-50 text-[#1769E0] font-mono font-bold text-[10px]">
                                #{visit.token_number}
                              </span>
                            )}
                            <StatusBadge status={visit.status} />
                          </div>
                        </div>
                      </td>

                      {/* Patient Details */}
                      <td className="px-4 py-3.5">
                        <div className="space-y-0.5">
                          <Link
                            href={`/patients/${visit.patient.id}`}
                            className="font-semibold text-gray-900 hover:text-[#1769E0] transition-colors"
                          >
                            {visit.patient.full_name}
                          </Link>
                          <p className="text-gray-500 text-[11px]">
                            {visit.patient.sex ? <span className="capitalize">{visit.patient.sex}</span> : "Patient"}
                            {visit.patient.age !== null && `, ${visit.patient.age}y`}
                          </p>
                          {visit.patient.phone && (
                            <p className="text-[11px] text-gray-600 font-mono">
                              {visit.patient.phone}
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Doctor */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="space-y-0.5">
                          <p className="font-medium text-gray-900 flex items-center gap-1">
                            <Stethoscope className="w-3 h-3 text-[#1769E0]" />
                            {visit.doctor.full_name}
                          </p>
                          {visit.doctor.specialty ? (
                            <p className="text-[11px] text-gray-500 capitalize">
                              {visit.doctor.specialty.replace(/_/g, " ")}
                            </p>
                          ) : visit.specialty ? (
                            <p className="text-[11px] text-gray-500 capitalize">
                              {visit.specialty.replace(/_/g, " ")}
                            </p>
                          ) : null}
                        </div>
                      </td>

                      {/* Diagnoses / Reason */}
                      <td className="px-4 py-3.5 max-w-xs">
                        <div className="space-y-1">
                          {visit.diagnoses && visit.diagnoses.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {visit.diagnoses.map((d) => (
                                <span
                                  key={d.id}
                                  className="px-2 py-0.5 rounded text-[11px] bg-emerald-50 text-emerald-800 font-medium border border-emerald-200"
                                >
                                  {d.diagnosis_name}
                                </span>
                              ))}
                            </div>
                          ) : visit.reason_for_visit ? (
                            <span className="text-gray-700 italic">
                              {visit.reason_for_visit}
                            </span>
                          ) : (
                            <span className="text-gray-400 italic">General Consultation</span>
                          )}
                        </div>
                      </td>

                      {/* Prescription */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {hasRx ? (
                          <div className="space-y-1">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-[#1769E0] font-medium text-[11px]">
                              <Pill className="w-3 h-3 text-[#1769E0]" />
                              {visit.prescription?.item_count} {visit.prescription?.item_count === 1 ? "med" : "meds"}
                            </span>
                            {visit.prescription?.signed_at && (
                              <span className="text-[10px] text-emerald-600 block">Signed</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400 italic">—</span>
                        )}
                      </td>

                      {/* Billing */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {hasInvoice ? (
                          <div className="space-y-0.5">
                            <span className="font-semibold text-gray-900 block">
                              ₹{visit.invoice?.total_amount.toFixed(2)}
                            </span>
                            {visit.invoice?.balance_due === 0 ? (
                              <Badge color="success" size="sm">
                                Paid
                              </Badge>
                            ) : (
                              <Badge color="warning" size="sm">
                                Due: ₹{visit.invoice?.balance_due.toFixed(2)}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400 italic">Not billed</span>
                        )}
                      </td>

                      {/* Action buttons */}
                      <td className="px-4 py-3.5 whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          {/* Print Rx button */}
                          {(hasRx || visit.status === "completed") && (
                            <a
                              href={`/api/visits/${visit.id}/prescription-pdf`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Print Prescription (PDF)"
                            >
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2 text-[#1769E0] hover:bg-blue-50"
                              >
                                <Printer className="w-3.5 h-3.5" />
                              </Button>
                            </a>
                          )}

                          {/* Print Receipt button */}
                          {hasInvoice && (
                            <a
                              href={`/api/invoices/${visit.invoice?.id || visit.id}/receipt-pdf`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Print Receipt (PDF)"
                            >
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2 text-emerald-600 hover:bg-emerald-50"
                              >
                                <Receipt className="w-3.5 h-3.5" />
                              </Button>
                            </a>
                          )}

                          {/* Open Encounter */}
                          {isDoctorOrOwner ? (
                            <Link href={`/consultation/${visit.id}`}>
                              <Button
                                variant="secondary"
                                size="sm"
                                className="h-8 text-xs"
                                endIcon={<ArrowUpRight className="w-3 h-3" />}
                              >
                                Open
                              </Button>
                            </Link>
                          ) : (
                            <Button
                              variant="secondary"
                              size="sm"
                              className="h-8 text-xs"
                              startIcon={<Eye className="w-3 h-3 text-gray-500" />}
                              onClick={() => setPreviewVisit(visit)}
                            >
                              View
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {totalCount > 0 && (
          <div className="px-4 py-3.5 border-t border-gray-200 bg-gray-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-gray-600">
            <div>
              Showing{" "}
              <span className="font-semibold text-gray-900">
                {Math.min(totalCount, (currentPage - 1) * pageSize + 1)}
              </span>{" "}
              to{" "}
              <span className="font-semibold text-gray-900">
                {Math.min(totalCount, currentPage * pageSize)}
              </span>{" "}
              of <span className="font-semibold text-gray-900">{totalCount}</span> visits
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1 || isPending}
                onClick={() => updateFilters({ page: currentPage - 1 })}
              >
                Previous
              </Button>
              <span className="text-xs font-medium px-2">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages || isPending}
                onClick={() => updateFilters({ page: currentPage + 1 })}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Structured Read-Only Encounter Preview Modal for non-doctors */}
      <ReadOnlyEncounterModal
        visit={previewVisit}
        isOpen={!!previewVisit}
        onClose={() => setPreviewVisit(null)}
      />
    </div>
  );
}
