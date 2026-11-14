import { notFound } from "next/navigation";
import { getPatient, getPatientVisitHistory } from "@/features/patients/actions";
import { getCurrentConsent } from "@/features/patients/consent";
import { getActiveMembership } from "@/lib/auth/tenant";
import { PatientDetailView } from "@/components/patients/patient-detail-view";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { redirectIfUnauthenticated, withPageAuth } from "@/lib/auth/page";

async function PatientDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

  let patient;
  let visits = [];
  let userRole = "doctor";
  let treatmentConsent;
  let dataSharingConsent;

  try {
    const [patientData, visitData, membership, tConsent, dConsent] =
      await Promise.all([
        getPatient(id),
        getPatientVisitHistory(id),
        getActiveMembership(),
        getCurrentConsent(id, "treatment"),
        getCurrentConsent(id, "data_sharing"),
      ]);

    patient = patientData;
    visits = visitData;
    userRole = membership.role;
    treatmentConsent = tConsent;
    dataSharingConsent = dConsent;
  } catch (err) {
    // A missing or revoked session is a redirect to /login, not a load failure (05-11c).
    redirectIfUnauthenticated(err);
    log.error({ event: "patients.detail_load.failed", code: errorTag(err), requestId: await getRequestId() });
    notFound();
  }

  if (!patient) {
    notFound();
  }

  return (
    <PatientDetailView
      patient={patient}
      visits={visits}
      userRole={userRole}
      treatmentConsent={treatmentConsent}
      dataSharingConsent={dataSharingConsent}
    />
  );
}

// A missing or revoked session in the loader redirects to /login (V2-05 05-11c), never a server error.
export default withPageAuth(PatientDetailPage);
