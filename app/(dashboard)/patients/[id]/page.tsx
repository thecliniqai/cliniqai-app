import { notFound } from "next/navigation";
import { getPatient, getPatientVisitHistory } from "@/features/patients/actions";
import { getCurrentConsent } from "@/features/patients/consent";
import { getActiveMembership } from "@/lib/auth/tenant";
import { PatientDetailView } from "@/components/patients/patient-detail-view";

export default async function PatientDetailPage(props: {
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
    console.error("[PatientDetailPage] Error loading patient:", err);
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
