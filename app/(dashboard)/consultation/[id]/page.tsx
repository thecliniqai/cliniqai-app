import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/auth/tenant";
import {
  getPatientConsultationHistory,
  PastVisitEncounter,
} from "@/features/consultation/actions";
import { ConsultationWorkspace } from "@/components/consultation/consultation-workspace";
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
      vitals,
      chief_complaints,
      clinical_notes,
      specialty,
      specialty_data,
      investigations_advised,
      advice,
      patient:patients (
        id,
        full_name,
        phone,
        sex,
        date_of_birth,
        age,
        allergies,
        chronic_conditions,
        uhid
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
    .maybeSingle();

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
    uhid: patientRaw.uhid,
  };

  const visit = {
    id: visitRow.id,
    patient_id: visitRow.patient_id,
    doctor_id: visitRow.doctor_id,
    status: visitRow.status,
    scheduled_at: visitRow.scheduled_at,
    token_number: tokenRow?.token_number ?? null,
    vitals: (visitRow.vitals as Vitals | null) ?? null,
    chief_complaints: (visitRow.chief_complaints as ChiefComplaintItem[] | null) ?? null,
    clinical_notes: visitRow.clinical_notes,
    specialty: (visitRow.specialty as ClinicalSpecialty) ?? "general_physician",
    specialty_data: (visitRow.specialty_data as SpecialtyData | null) ?? null,
    investigations_advised: visitRow.investigations_advised ?? [],
    advice: visitRow.advice ?? [],
    follow_up: followUpRow
      ? ({
          follow_up_date: followUpRow.follow_up_date,
          notes: followUpRow.notes,
        } as FollowUpInput)
      : null,
  };

  return (
    <ConsultationWorkspace
      visit={visit}
      patient={patient}
      pastEncounters={pastEncounters}
    />
  );
}
