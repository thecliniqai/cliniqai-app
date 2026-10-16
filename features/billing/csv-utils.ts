import type { CollectionReportData } from "./reports-actions";

/**
 * Formats report data into CSV format for accounting and tax reconciliation.
 * Safe for client-side and server-side execution.
 */
export function formatCollectionReportCsv(data: CollectionReportData): string {
  const headers = [
    "Date & Time",
    "Invoice #",
    "Patient Name",
    "Phone",
    "Payment Method",
    "Amount (INR)",
    "Reference / UTR",
    "Status",
  ];

  const rows = data.payments.map((p) => [
    `"${new Date(p.recorded_at).toLocaleString()}"`,
    `"${p.invoice_number}"`,
    `"${p.patient_name.replace(/"/g, '""')}"`,
    `"${p.patient_phone || ""}"`,
    `"${p.payment_method.toUpperCase()}"`,
    p.amount.toFixed(2),
    `"${p.reference_number || ""}"`,
    `"${p.invoice_status.toUpperCase()}"`,
  ]);

  const summaryRows = [
    [],
    ["SUMMARY BREAKDOWN"],
    ["Date Range", `"${data.dateRange.start} to ${data.dateRange.end}"`],
    ["Total Cash Received", data.summary.cashTotal.toFixed(2)],
    ["Total UPI Received", data.summary.upiTotal.toFixed(2)],
    ["Total Card Received", data.summary.cardTotal.toFixed(2)],
    ["Total Collections", data.summary.totalCollection.toFixed(2)],
    ["Outstanding Receivables", data.summary.outstandingReceivables.toFixed(2)],
  ];

  return [
    headers.join(","),
    ...rows.map((r) => r.join(",")),
    ...summaryRows.map((r) => r.join(",")),
  ].join("\n");
}
