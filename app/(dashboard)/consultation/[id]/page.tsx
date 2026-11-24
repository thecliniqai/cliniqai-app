import { notFound, redirect } from "next/navigation";
import { HydrationBoundary } from "@tanstack/react-query";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/auth/tenant";
import { hasPerm } from "@/lib/permissions";
import { navForRole } from "@/lib/nav/nav-for-role";
import { ConsultWorkspace } from "@/components/consultation/workspace/consult-workspace";
import { withPageAuth } from "@/lib/auth/page";
import { recordState } from "@/features/consultation/record-state";
import { buildConsultScreen, consultQueryData } from "@/features/consultation/screen";
import { resolveServiceContext } from "@/lib/auth/context";
import { loadPrescriptionPdfSource } from "@/features/prescriptions/pdf/payload";
import type { PrescriptionPdfPayload } from "@/features/prescriptions/pdf/types";
import { createRequestQueryClient, dehydrateRequest } from "@/lib/query/server";
import { queryKeys } from "@/lib/query/keys";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

interface ConsultationPageProps {
  params: Promise<{
    id: string;
  }>;
}

/**
 * The signed prescription as the browser prints it (V2-09c 09C-04, R-12; CTO ruling Q-2): the PDF's own payload, only for a sealed record and a role that
 * may read prescriptions. A separate read the page does not wait for (V2-09e R-9): the workspace draws the print view when it resolves. A failed or refused
 * read is "no print view": the PDF link stays.
 */
async function readPrintPayload(visitId: string): Promise<PrescriptionPdfPayload | null> {
  try {
    const resolved = await resolveServiceContext("prescriptions:view");
    if (!resolved.ok) return null;
    const source = await loadPrescriptionPdfSource(resolved.ctx, visitId);
    return source?.header?.signed_at && source.payload.medications.length > 0 ? source.payload : null;
  } catch (err) {
    log.error({ event: "consultation.print_payload.failed", code: errorTag(err), requestId: await getRequestId() });
    return null;
  }
}

/**
 * The consult (V2-09e 09E-05, R-8, R-9): ONE database call, `public.consult_screen`, answers every part the page used to read in 14 sequential calls (the
 * visit with its patient and notes, the diagnoses and Rx lines, the amendment, the history, the Smart Assist reads, the documents, the allergy picture and the
 * doctor's own lists). The page maps it through `features/consultation/screen.ts`, applies the record state and hydrates the consult's query with the doctor's
 * lists and macros; the clinic's id and the visit's id are the key. A visit the caller cannot read is NULL: 404, as before.
 */
async function ConsultationPage(props: ConsultationPageProps) {
  const { id } = await props.params;

  let membership;
  try {
    membership = await getActiveMembership();
  } catch {
    redirect("/login");
  }

  // P1-07: the layout refuses first (it is the full-load path); the page repeats it for a client navigation.
  if (!hasPerm(membership.role, "consultations:view")) redirect(navForRole(membership.role).home);

  // Not a visit id: the same answer as a visit that is not there (no call).
  if (!z.string().uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("consult_screen", { p_tenant_id: membership.tenantId, p_visit_id: id });
  if (error) {
    log.error({ event: "consultation.screen.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: membership.tenantId });
    throw new Error("The consultation could not be loaded.");
  }

  const screen = buildConsultScreen(data, { canEdit: hasPerm(membership.role, "consultations:edit") });
  if (!screen) notFound();

  const printPayload =
    recordState(screen.visit) === "sealed" && hasPerm(membership.role, "prescriptions:view") ? readPrintPayload(id) : null;

  const queryData = consultQueryData(screen);
  const queryClient = createRequestQueryClient();
  queryClient.setQueryData(queryKeys.consult(membership.tenantId, id), queryData);

  return (
    <HydrationBoundary state={dehydrateRequest(queryClient)}>
      <ConsultWorkspace
        tenantId={membership.tenantId}
        queryData={queryData}
        visit={screen.visit}
        patient={screen.patient}
        pastEncounters={screen.pastEncounters}
        assist={screen.assist}
        printPayload={printPayload}
        allergyContext={screen.allergyContext}
        snapshot={screen.snapshot}
        upcomingVisits={screen.upcomingVisits}
        canBook={hasPerm(membership.role, "appointments:edit")}
        documents={screen.documents}
        canUpload={hasPerm(membership.role, "labs:edit")}
        canRecordAllergies={hasPerm(membership.role, "patients:edit") && hasPerm(membership.role, "consultations:view")}
        canEditRx={hasPerm(membership.role, "prescriptions:edit")}
        canViewRx={hasPerm(membership.role, "prescriptions:view")}
        canCollectPayment={hasPerm(membership.role, "billing:collect")}
        // The commands need all three (owner, doctor); the database refuses anyone else, this only shapes the screen.
        canAmend={
          hasPerm(membership.role, "consultations:edit") &&
          hasPerm(membership.role, "prescriptions:edit") &&
          hasPerm(membership.role, "appointments:edit")
        }
      />
    </HydrationBoundary>
  );
}

// A missing or revoked session in the loader redirects to /login (V2-05 05-11c), never a server error.
export default withPageAuth(ConsultationPage);
