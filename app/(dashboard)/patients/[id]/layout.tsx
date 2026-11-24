import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { requireServiceContext } from "@/lib/auth/context";
import { readPatientRecord } from "@/features/patients/service";
import { getActiveMembership } from "@/lib/auth/tenant";
import { hasPerm } from "@/lib/permissions";
import { RECORD_ID, RecordLookupError, redirectIfTenantLocked, redirectIfUnauthenticated, withPageAuth } from "@/lib/auth/page";

/**
 * V2-06 06-04b: the patient record's not-found decision runs here, above the segment's `loading.tsx`, so a record
 * that is not the caller's (another clinic's, deleted, malformed id, or no `patients:view`) still answers 404 on a
 * full page load instead of a streamed 200 (06-04a deviation 1; `journey-09-clinic-isolation`: "never a page for B's
 * record"). Same conditions as the page's read (tenant from the session, RLS, not deleted); the record is read once for the layout and
 * the page together (`readPatientRecord`, shared inside the request) and no audit row is written here (the page's load records the view).
 */
async function PatientRecordLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A malformed id is "not found" (it can name no record); checked first, so the database never sees it.
  if (!RECORD_ID.test(id)) notFound();
  let visible = false;
  try {
    const membership = await getActiveMembership();
    if (hasPerm(membership.role, "patients:view")) {
      // 09E-06 (R-9): the record is read once for the layout and the page together (a request-shared read, no audit row here: the page writes the view).
      const read = await readPatientRecord(await requireServiceContext("patients:view"), id);
      if (read.status === "error") throw new RecordLookupError();
      visible = read.status === "ok";
    }
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

export default withPageAuth(PatientRecordLayout);
