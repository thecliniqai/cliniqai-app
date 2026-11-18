import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getActiveMembership } from "@/lib/auth/tenant";
import { withPageAuth } from "@/lib/auth/page";

/**
 * V2-06 06-04b: the cabin's role redirect (receptionist and nurse → the Live Queue) runs here, above the segment's
 * `loading.tsx`, so a full page load still answers 307 (06-04a deviation 1). The page keeps its own checks.
 */
async function CabinLayout({ children }: { children: ReactNode }) {
  const { role } = await getActiveMembership();
  if (role === "receptionist" || role === "nurse") redirect("/queue");
  return <>{children}</>;
}

export default withPageAuth(CabinLayout);
