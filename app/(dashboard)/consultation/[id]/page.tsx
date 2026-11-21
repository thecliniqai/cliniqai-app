import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/auth/tenant";
import { hasPerm } from "@/lib/permissions";
import { navForRole } from "@/lib/nav/nav-for-role";
import {
  getPatientConsultationHistory,
  PastVisitEncounter,
} from "@/features/consultation/actions";
import { getVisitDiagnoses } from "@/features/terminology/actions";
import { getVisitPrescription } from "@/features/prescriptions/actions";
import { ConsultWorkspace } from "@/components/consultation/workspace/consult-workspace";
import { activeEntitlements } from "@/lib/entitlements/require-entitlement";
import { clinicalContent, clinicalNotesEmbed, embeddedClinicalNotes } from "@/lib/db/clinical-notes";
import {
  Vitals,
  ChiefComplaintItem,
  ClinicalSpecialty,
  SpecialtyData,
  FollowUpInput,
} from "@/features/consultation/schema";
import { withPageAuth } from "@/lib/auth/page";
import { recordState } from "@/features/consultation/record-state";

interface ConsultationPageProps {
  params: Promise<{
    id: string;
  }>;
}

async function ConsultationPage(props: ConsultationPageProps) {
  const { id } = await props.params;
  const supabase = await createClient();

  let membership;
  try {
    membership = await getActiveMembership();
  } catch {
    redirect("/login");
  }

  // P1-07: the layout refuses first (it is the full-load path); the page repeats it for a client navigation.
  if (!hasPerm(membership.role, "consultations:view")) redirect(navForRole(membership.role).home);

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
      signed_at,
      current_revision,
      ${clinicalNotesEmbed(undefined, true)},
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

  // 7. The signed version's number and, while an amendment is open, the reason it was started with (V2-09a R-16). The latest header is the
  // visit's prescription whatever its status; the reason is the latest `visit_revisions` row (the database numbers them).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: latestHeader } = await (supabase.from("prescriptions") as any)
    .select("version")
    .eq("visit_id", id)
    .eq("tenant_id", membership.tenantId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  let amendmentReason: string | null = null;
  let amendmentOpenedAt: string | null = null;
  if (recordState(visitRow) === "amending") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: latestRevision } = await (supabase.from("visit_revisions") as any)
      .select("amendment_reason, amended_at")
      .eq("visit_id", id)
      .eq("tenant_id", membership.tenantId)
      .order("revision_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    amendmentReason = latestRevision?.amendment_reason ?? null;
    amendmentOpenedAt = latestRevision?.amended_at ?? null;
  }

  // 8. The Smart Assist entitlements of the active clinic, resolved here from the session (V2-09b R-10); the features of 09B-03 to 09B-04b read this map.
  // A clinic that is not `full` (read-only, locked) has none: the consult itself is served by the layout's own checks, so a refusal here is "no assist".
  const assist: Record<string, boolean> = {};
  try {
    for (const [key, value] of await activeEntitlements()) if (key.startsWith("assist.")) assist[key] = value.enabled;
  } catch {
    // no Smart Assist for this clinic
  }

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
    // `null` is "not recorded" and `[]` "recorded none": the allergy strip draws the two differently.
    allergies: (patientRaw.allergies as string[] | null) ?? null,
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
    signed_at: (visitRow.signed_at as string | null) ?? null,
    current_revision: (visitRow.current_revision as number | null) ?? 1, // the database default (09A-06a, review B-2)
    draft_version: (embeddedClinicalNotes(visitRow)?.draft_version as number | undefined) ?? 0,
    prescription_version: (latestHeader?.version as number | undefined) ?? null,
    amendment_reason: amendmentReason,
    amendment_opened_at: amendmentOpenedAt,
  };

  return (
    <ConsultWorkspace
      visit={visit}
      patient={patient}
      pastEncounters={pastEncounters}
      assist={assist}
      canCollectPayment={hasPerm(membership.role, "billing:collect")}
      // The commands need all three (owner, doctor); the database refuses anyone else, this only shapes the screen.
      canAmend={
        hasPerm(membership.role, "consultations:edit") &&
        hasPerm(membership.role, "prescriptions:edit") &&
        hasPerm(membership.role, "appointments:edit")
      }
    />
  );
}

// A missing or revoked session in the loader redirects to /login (V2-05 05-11c), never a server error.
export default withPageAuth(ConsultationPage);
