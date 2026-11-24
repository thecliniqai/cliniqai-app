import React from "react";
import { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/permissions/guards";
import { getDailyCollectionReport } from "@/features/billing/reports-actions";
import { CollectionReportsView } from "@/components/billing/collection-reports-view";
import { createClient } from "@/lib/supabase/server";
import { getTenantTimeZoneAndVersions } from "@/lib/datetime/server";
import { redirectIfTenantLocked, withPageAuth } from "@/lib/auth/page";
import { todayInTz } from "@/lib/datetime";
import { ChangedElsewhere } from "@/components/shell/changed-elsewhere";

export const metadata: Metadata = {
  title: "Billing & Financial Reports",
  description: "Daily collection register, payment breakdown, and financial reports.",
};

async function BillingReportsPage() {
  let session;
  try {
    session = await requirePermission("billing:view");
  } catch (err) {
    // 05-10b: a clinic that is not `full` goes to its locked/onboarding page.
    await redirectIfTenantLocked(err);
    redirect("/today");
  }

  // The clinic's day in its own zone (V2-03 03-05); the view reads the same zone from the layout.
  // The clinic's day in its own zone (V2-03 03-05; the view reads the same zone from the layout) and the versions the report is read at (R-9, R-18), in one
  // statement BEFORE the report is read: the versions are a lower bound of what it shows, and the report's own zone read finds the zone already known.
  const { zone, versions: basis } = await getTenantTimeZoneAndVersions(await createClient(), session.tenantId);
  const todayStr = todayInTz(zone);
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
    // 06-09e (design review L11): the shell's <main> already pads the page (16 / 24 / 32 px); a second padding here
    // started the content 32 px in on phones.
    <div className="max-w-7xl mx-auto space-y-4">
      <ChangedElsewhere domains={["billing"]} basis={basis ?? undefined} />
      <CollectionReportsView initialData={initialData} />
    </div>
  );
}

// A missing or revoked session in the loader redirects to /login (V2-05 05-11c), never a server error.
export default withPageAuth(BillingReportsPage);
