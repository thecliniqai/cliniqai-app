"use client";

import React, { useState, useTransition } from "react";
import {
  IndianRupee,
  Coins,
  QrCode,
  CreditCard,
  FileSpreadsheet,
  Printer,
  Calendar,
  Receipt,
  Search,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CollectionReportData,
  formatCollectionReportCsv,
  getDailyCollectionReport,
} from "@/features/billing/reports-actions";
import { ReceiptModal } from "./receipt-modal";

export interface CollectionReportsViewProps {
  initialData: CollectionReportData;
}

export function CollectionReportsView({ initialData }: CollectionReportsViewProps) {
  const [data, setData] = useState<CollectionReportData>(initialData);
  const [startDate, setStartDate] = useState<string>(initialData.dateRange.start);
  const [endDate, setEndDate] = useState<string>(initialData.dateRange.end);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [methodFilter, setMethodFilter] = useState<"all" | "cash" | "upi" | "card">("all");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleDatePreset = (preset: "today" | "yesterday" | "7days" | "month") => {
    const today = new Date();
    const toYmd = (d: Date) => d.toISOString().split("T")[0];

    let start = toYmd(today);
    let end = toYmd(today);

    if (preset === "yesterday") {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      start = toYmd(y);
      end = toYmd(y);
    } else if (preset === "7days") {
      const d7 = new Date();
      d7.setDate(d7.getDate() - 6);
      start = toYmd(d7);
    } else if (preset === "month") {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      start = toYmd(first);
    }

    setStartDate(start);
    setEndDate(end);
    fetchReport(start, end);
  };

  const fetchReport = (start: string, end: string) => {
    setError(null);
    startTransition(async () => {
      const res = await getDailyCollectionReport(start, end);
      if (res.success) {
        setData(res.data);
      } else {
        setError(res.error);
      }
    });
  };

  const handleExportCsv = () => {
    const csvContent = formatCollectionReportCsv(data);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Collections_${data.dateRange.start}_to_${data.dateRange.end}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  const filteredPayments = data.payments.filter((p) => {
    if (methodFilter !== "all" && p.payment_method !== methodFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.patient_name.toLowerCase().includes(q) ||
      p.invoice_number.toLowerCase().includes(q) ||
      (p.reference_number && p.reference_number.toLowerCase().includes(q)) ||
      (p.patient_phone && p.patient_phone.includes(q))
    );
  });

  return (
    <div className="space-y-6">
      {/* Top Header & Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Financial Collections & Billing Register
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Real-time daily collection ledger, payment method breakdowns, and accounting exports.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            className="gap-1.5 text-xs font-medium text-slate-700 bg-white border-slate-200 hover:bg-slate-50"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>Export CSV</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="gap-1.5 text-xs font-medium text-slate-700 bg-white border-slate-200 hover:bg-slate-50 print:hidden"
          >
            <Printer className="w-3.5 h-3.5 text-slate-600" />
            <span>Print Register</span>
          </Button>
        </div>
      </div>

      {/* Date Filter Bar */}
      <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs space-y-3 print:hidden">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          {/* Quick Preset Buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-medium text-slate-500 mr-1">Period:</span>
            <button
              type="button"
              onClick={() => handleDatePreset("today")}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                startDate === endDate && startDate === new Date().toISOString().split("T")[0]
                  ? "bg-blue-50 text-blue-700 border border-blue-200 font-semibold"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => handleDatePreset("yesterday")}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
            >
              Yesterday
            </button>
            <button
              type="button"
              onClick={() => handleDatePreset("7days")}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
            >
              Last 7 Days
            </button>
            <button
              type="button"
              onClick={() => handleDatePreset("month")}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
            >
              This Month
            </button>
          </div>

          {/* Custom Date Pickers */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>From:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-2.5 py-1 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <span>To:</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-2.5 py-1 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <Button
              size="sm"
              variant="secondary"
              onClick={() => fetchReport(startDate, endDate)}
              disabled={isPending}
              className="gap-1 h-7 text-xs bg-slate-800 text-white hover:bg-slate-700"
            >
              <RefreshCw className={`w-3 h-3 ${isPending ? "animate-spin" : ""}`} />
              <span>Apply</span>
            </Button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        {/* Total Collections */}
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Total Collection</span>
            <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
              <IndianRupee className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            ₹{data.summary.totalCollection.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {data.summary.paymentsCount} payments across {data.summary.invoicesCount} invoices
          </p>
        </div>

        {/* Cash in Hand */}
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Cash in Hand</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
              <Coins className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            ₹{data.summary.cashTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {data.summary.totalCollection > 0
              ? `${Math.round((data.summary.cashTotal / data.summary.totalCollection) * 100)}% of total`
              : "0%"}
          </p>
        </div>

        {/* UPI Payments */}
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">UPI Collections</span>
            <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center text-purple-600">
              <QrCode className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            ₹{data.summary.upiTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Direct bank settlements</p>
        </div>

        {/* Card Payments */}
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Card Payments</span>
            <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            ₹{data.summary.cardTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">POS swipe / chip</p>
        </div>
      </div>

      {/* Secondary Highlights */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 print:hidden">
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500">Average Invoice Value</span>
            <p className="text-lg font-bold text-slate-900">
              ₹{data.summary.averageInvoiceValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </p>
          </div>
          <span className="text-xs text-slate-500">Per patient consultation</span>
        </div>

        <div className="p-3.5 bg-amber-50/60 border border-amber-200 rounded-xl flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-amber-800">Outstanding Balance Due</span>
            <p className="text-lg font-bold text-amber-900">
              ₹{data.summary.outstandingReceivables.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </p>
          </div>
          <span className="text-xs text-amber-700">Pending front desk settlement</span>
        </div>
      </div>

      {/* Payment Transactions Register Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        {/* Table Controls */}
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 print:hidden">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Transaction Register</h2>
            <span className="px-2 py-0.5 text-[11px] font-medium bg-slate-100 text-slate-600 rounded-full">
              {filteredPayments.length} records
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search patient, invoice, UTR..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 w-56"
              />
            </div>

            {/* Method Filter */}
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value as any)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Methods</option>
              <option value="cash">Cash Only</option>
              <option value="upi">UPI Only</option>
              <option value="card">Card Only</option>
            </select>
          </div>
        </div>

        {/* Table Body */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-medium uppercase tracking-wider">
              <tr>
                <th className="py-2.5 px-4">Date & Time</th>
                <th className="py-2.5 px-4">Invoice #</th>
                <th className="py-2.5 px-4">Patient</th>
                <th className="py-2.5 px-4">Method</th>
                <th className="py-2.5 px-4">Reference / UTR</th>
                <th className="py-2.5 px-4 text-right">Amount</th>
                <th className="py-2.5 px-4 text-center print:hidden">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredPayments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400">
                    No payment transactions recorded for the selected period.
                  </td>
                </tr>
              ) : (
                filteredPayments.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                      {new Date(p.recorded_at).toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      •{" "}
                      {new Date(p.recorded_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium text-slate-900">
                      {p.invoice_number}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{p.patient_name}</div>
                      {p.patient_phone && (
                        <div className="text-[11px] text-slate-400">{p.patient_phone}</div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                          p.payment_method === "cash"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : p.payment_method === "upi"
                              ? "bg-purple-50 text-purple-700 border border-purple-200"
                              : "bg-indigo-50 text-indigo-700 border border-indigo-200"
                        }`}
                      >
                        {p.payment_method}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                      {p.reference_number || "—"}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-slate-900">
                      ₹{p.amount.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-center print:hidden">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedInvoiceId(p.invoice_id)}
                        className="h-7 px-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 gap-1"
                        title="View PDF Receipt"
                      >
                        <Receipt className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Receipt</span>
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Branded PDF Receipt Modal */}
      {selectedInvoiceId && (
        <ReceiptModal
          isOpen={!!selectedInvoiceId}
          onClose={() => setSelectedInvoiceId(null)}
          invoiceId={selectedInvoiceId}
        />
      )}
    </div>
  );
}
