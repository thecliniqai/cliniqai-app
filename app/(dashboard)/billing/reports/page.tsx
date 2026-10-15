import React from "react";
import { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/permissions/guards";
import { getDailyCollectionReport } from "@/features/billing/reports-actions";
import { CollectionReportsView } from "@/components/billing/collection-reports-view";

export const metadata: Metadata = {
  title: "Billing & Financial Reports | ClinicOS",
  description: "Daily collection register, payment breakdown, and financial reports.",
};

export default async function BillingReportsPage() {
  try {
    await requirePermission("billing:view");
  } catch {
    redirect("/");
  }

  const todayStr = new Date().toISOString().split("T")[0];
  const reportResult = await getDailyCollectionReport(todayStr, todayStr);

  const initialData = reportResult.success
    ? reportResult.data
    : {
        dateRange: { start: todayStr, end: todayStr },
        summary: {
          totalCollection: 0,
          cashTotal: 0,
          upiTotal: 0,
          cardTotal: 0,
          paymentsCount: 0,
          invoicesCount: 0,
          averageInvoiceValue: 0,
          outstandingReceivables: 0,
        },
        payments: [],
      };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <CollectionReportsView initialData={initialData} />
    </div>
  );
}
