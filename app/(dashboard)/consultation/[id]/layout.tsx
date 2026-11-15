import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/auth/tenant";
import { RECORD_ID, RecordLookupError, redirectIfTenantLocked, redirectIfUnauthenticated, withPageAuth } from "@/lib/auth/page";

/**
 * V2-06 06-04b: the consult's not-found decision runs here, above the segment's `loading.tsx`, so another clinic's
 * visit (or a malformed id) still answers 404 on a full page load instead of a streamed 200 (06-04a deviation 1;
 * `journey-09-clinic-isolation`). Same conditions as the page: the visit in the session's clinic (RLS) with its
 * patient. Reads ids only.
 */
async function ConsultationLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A malformed id is "not found" (it can name no visit); checked first, so the database never sees it.
  if (!RECORD_ID.test(id)) notFound();
  let visible = false;
  try {
    const membership = await getActiveMembership();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("visits")
      .select("id, patient:patients(id)")
      .eq("id", id)
      .eq("tenant_id", membership.tenantId)
      .maybeSingle();
    if (error) throw new RecordLookupError();
    const patient = data ? (data as { patient: unknown }).patient : null;
    visible = data !== null && (Array.isArray(patient) ? patient.length > 0 : patient !== null);
  } catch (err) {
    redirectIfUnauthenticated(err);
    await redirectIfTenantLocked(err);
    // 06-09c (IND L-2): any other failure (a transient database or Auth error) is not "no such record": the route
    // error boundary shows it (Retry) and reports it, instead of telling the user the record does not exist.
    throw err;
  }
  if (!visible) notFound();
  return <>{children}</>;
}

export default withPageAuth(ConsultationLayout);
