import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getActiveMembership } from "@/lib/auth/tenant";
import { hasPerm } from "@/lib/permissions";
import { withPageAuth } from "@/lib/auth/page";

/**
 * V2-06 06-04b: the reports' permission redirect (no `billing:view` → Today, as the page does) runs here, above the
 * segment's `loading.tsx`, so a full page load still answers 307 (06-04a deviation 1). The page keeps its own guard.
 */
async function BillingReportsLayout({ children }: { children: ReactNode }) {
  const { role } = await getActiveMembership();
  if (!hasPerm(role, "billing:view")) redirect("/");
  return <>{children}</>;
}

export default withPageAuth(BillingReportsLayout);
