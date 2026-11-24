import { notFound } from "next/navigation";
import { getPatientVisitHistory } from "@/features/patients/actions";
import { getPatientWithVersions } from "@/features/patients/service";
import { requireServiceContext } from "@/lib/auth/context";
import { getCurrentConsent } from "@/features/patients/consent";
import { getActiveMembership } from "@/lib/auth/tenant";
import { PatientDetailView } from "@/components/patients/patient-detail-view";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { ChangedElsewhere } from "@/components/shell/changed-elsewhere";
import { redirectIfTenantLocked, redirectIfUnauthenticated, withPageAuth } from "@/lib/auth/page";

async function PatientDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

  let patient;
  let userRole = "doctor";
  let treatmentConsent;
  let dataSharingConsent;
  let basis;

  // V2-09e 09E-06 (R-9): the history (a chain of reads: the visits, then their doctors, tokens, diagnoses, prescriptions and invoices) is the slow part of the
  // record, so it is started here and streamed: the patient, the consents and the role are what the first paint waits for, in one round trip. A failed
  // history is an empty one (the service already answers `[]`), never a page failure.
  const visits = getPatientVisitHistory(id).catch(() => []);
  try {
    // The patient and the clinic versions it is read at (R-9, R-18) come from one statement; the "Changed on another device" notice compares with them.
    const [patientData, membership, tConsent, dConsent] =
      await Promise.all([
        requireServiceContext("patients:view").then((ctx) => getPatientWithVersions(ctx, id)),
        getActiveMembership(),
        getCurrentConsent(id, "treatment"),
        getCurrentConsent(id, "data_sharing"),
      ]);
    basis = patientData?.versions ?? undefined;

    patient = patientData?.patient;
    userRole = membership.role;
    treatmentConsent = tConsent;
    dataSharingConsent = dConsent;
  } catch (err) {
    // A missing or revoked session is a redirect to /login, not a load failure (05-11c).
    redirectIfUnauthenticated(err);
    // A clinic that is not `full` goes to its locked/onboarding page, not a logged load failure (05-10b).
    await redirectIfTenantLocked(err);
    log.error({ event: "patients.detail_load.failed", code: errorTag(err), requestId: await getRequestId() });
    notFound();
  }

  if (!patient) {
    notFound();
  }

  return (
    <>
      <ChangedElsewhere domains={["schedule", "billing"]} basis={basis} />
      <PatientDetailView
        patient={patient}
        visits={visits}
        userRole={userRole}
        treatmentConsent={treatmentConsent}
        dataSharingConsent={dataSharingConsent}
      />
    </>
  );
}

// A missing or revoked session in the loader redirects to /login (V2-05 05-11c), never a server error.
export default withPageAuth(PatientDetailPage);
