import React from "react";
import { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/permissions/guards";
import { getDailyCollectionReport } from "@/features/billing/reports-actions";
import { CollectionReportsView } from "@/components/billing/collection-reports-view";
import { createClient } from "@/lib/supabase/server";
import { getTenantToday } from "@/lib/datetime/server";
import { withPageAuth } from "@/lib/auth/page";

export const metadata: Metadata = {
  title: "Billing & Financial Reports | ClinicOS",
  description: "Daily collection register, payment breakdown, and financial reports.",
};

async function BillingReportsPage() {
  let session;
  try {
    session = await requirePermission("billing:view");
  } catch {
    redirect("/");
  }

  // The clinic's day in its own zone (V2-03 03-05); the view reads the same zone from the layout.
  const { today: todayStr } = await getTenantToday(await createClient(), session.tenantId);
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

// A missing or revoked session in the loader redirects to /login (V2-05 05-11c), never a server error.
export default withPageAuth(BillingReportsPage);
