import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getActiveMembership, NoClinicMembershipError } from "@/lib/auth/tenant";
import { withPageAuth } from "@/lib/auth/page";

/**
 * V2-06 06-04b: Today's role redirect (a doctor's Today is the cabin) runs here, above the segment's `loading.tsx`, so
 * a full page load still answers 307 instead of a streamed 200 (06-04a deviation 1). The page keeps its own checks.
 */
async function TodayLayout({ children }: { children: ReactNode }) {
  let role;
  try {
    role = (await getActiveMembership()).role;
  } catch (error) {
    if (error instanceof NoClinicMembershipError) redirect("/clinic/new");
    throw error;
  }
  if (role === "doctor") redirect("/cabin");
  return <>{children}</>;
}

export default withPageAuth(TodayLayout);
