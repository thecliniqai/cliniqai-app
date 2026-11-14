import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/auth/tenant";
import { hasPerm } from "@/lib/permissions";
import {
  getPatientConsultationHistory,
  PastVisitEncounter,
} from "@/features/consultation/actions";
import { getVisitDiagnoses } from "@/features/terminology/actions";
import { getVisitPrescription } from "@/features/prescriptions/actions";
import { ConsultationWorkspace } from "@/components/consultation/consultation-workspace";
import { clinicalContent, clinicalNotesEmbed, embeddedClinicalNotes } from "@/lib/db/clinical-notes";
import {
  Vitals,
  ChiefComplaintItem,
  ClinicalSpecialty,
  SpecialtyData,
  FollowUpInput,
} from "@/features/consultation/schema";

interface ConsultationPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function ConsultationPage(props: ConsultationPageProps) {
  const { id } = await props.params;
  const supabase = await createClient();

  let membership;
  try {
    membership = await getActiveMembership();
  } catch {
    redirect("/login");
  }

  // 1. Fetch visit and joined patient details
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: visitRow, error: visitError } = await (supabase.from("visits") as any)
    .select(`
      id,
      tenant_id,
      patient_id,
      doctor_id,
      status,
      scheduled_at,
      specialty,
      ${clinicalNotesEmbed()},
      patient:patients (
        id,
        full_name,
        phone,
        sex,
        date_of_birth,
        age,
        allergies,
        chronic_conditions,
        national_health_id
      )
    `)
    .eq("id", id)
    .eq("tenant_id", membership.tenantId)
    .single();

  if (visitError || !visitRow) {
    notFound();
  }

  // 2. Fetch associated token number if visit was checked in
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tokenRow } = await (supabase.from("queue_tokens") as any)
    .select("token_number")
    .eq("visit_id", id)
    .eq("tenant_id", membership.tenantId)
    .maybeSingle();

  // 3. Fetch patient past encounters timeline for the history drawer
  const patientId = visitRow.patient_id;
  const historyResult = await getPatientConsultationHistory(patientId);
  const pastEncounters: PastVisitEncounter[] = historyResult.success
    ? historyResult.encounters.filter((v: PastVisitEncounter) => v.visitId !== id)
    : [];

  // 4. Fetch follow-up recommendation if one exists
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: followUpRow } = await (supabase.from("follow_ups") as any)
    .select("follow_up_date, notes")
    .eq("visit_id", id)
    .eq("tenant_id", membership.tenantId)
    .maybeSingle();

  // 5. Fetch consultation diagnoses for this visit
  const diagResult = await getVisitDiagnoses(id);
  const initialDiagnoses = diagResult.success ? diagResult.diagnoses : [];

  // 6. Fetch active prescription items for this visit
  const rxResult = await getVisitPrescription(id);
  const initialPrescriptionItems =
    rxResult.success && rxResult.prescription ? rxResult.prescription.items : [];

  // Safely cast joined patient object
  const patientRaw = Array.isArray(visitRow.patient) ? visitRow.patient[0] : visitRow.patient;
  if (!patientRaw) {
    notFound();
  }

  const patient = {
    id: patientRaw.id,
    full_name: patientRaw.full_name,
    phone: patientRaw.phone,
    gender: (patientRaw.sex === "male" || patientRaw.sex === "female" || patientRaw.sex === "other"
      ? patientRaw.sex
      : null) as "male" | "female" | "other" | null,
    date_of_birth: patientRaw.date_of_birth,
    age: patientRaw.age,
    allergies: patientRaw.allergies ?? [],
    chronic_conditions: patientRaw.chronic_conditions ?? [],
    uhid: patientRaw.national_health_id || (patientRaw.id ? patientRaw.id.slice(0, 8).toUpperCase() : null),
  };

  // The clinical content lives in clinical_notes (V2-05 05-02a): every field null when RLS hides the row (a role
  // without consultations:view), so the workspace renders it as absent.
  const notes = clinicalContent(embeddedClinicalNotes(visitRow));

  const visit = {
    id: visitRow.id,
    patient_id: visitRow.patient_id,
    doctor_id: visitRow.doctor_id,
    status: visitRow.status,
    scheduled_at: visitRow.scheduled_at,
    token_number: tokenRow?.token_number ?? null,
    vitals: (notes.vitals as Vitals | null) ?? null,
    chief_complaints: (notes.chief_complaints as ChiefComplaintItem[] | null) ?? null,
    clinical_notes: notes.clinical_notes,
    specialty: (visitRow.specialty as ClinicalSpecialty) ?? "general_physician",
    specialty_data: (notes.specialty_data as SpecialtyData | null) ?? null,
    investigations_advised: notes.investigations_advised ?? [],
    advice: notes.advice ?? [],
    follow_up: followUpRow
      ? ({
          follow_up_date: followUpRow.follow_up_date,
          notes: followUpRow.notes,
        } as FollowUpInput)
      : null,
    diagnoses: initialDiagnoses,
    prescription_items: initialPrescriptionItems,
  };

  return (
    <ConsultationWorkspace
      visit={visit}
      patient={patient}
      pastEncounters={pastEncounters}
      canCollectPayment={hasPerm(membership.role, "billing:collect")}
    />
  );
}
