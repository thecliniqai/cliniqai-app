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
import { getRxAllergyContext } from "@/features/prescriptions/service";
import type { RxAllergyContext } from "@/features/prescriptions/allergy";
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
import { getConsultAssistContext, getPatientSnapshot } from "@/features/consultation/service";
import type { PatientSnapshot } from "@/features/consultation/snapshot";
import type { AssistContext } from "@/features/consultation/assist-ranking";
import { listDoctorMacros } from "@/features/consultation/macros-service";
import { getUpcomingVisitInstants } from "@/features/consultation/upcoming-visits";
import { getPatientDocuments } from "@/features/labs/service";
import { toConsultDocument, type ConsultDocument } from "@/features/labs/consult-documents";
import type { DoctorMacro } from "@/features/consultation/macros";
import { resolveServiceContext } from "@/lib/auth/context";

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

  // 9. The Smart Assist reads of the consult, from the session's own context (V2-09b R-12, R-13, Q-9). The doctor's learned order
  // (`consult_assist_context`) only for an editable record and only with `assist.terminology`; the patient snapshot (`patient_snapshot`: signed visits
  // only, the visit on screen excluded) only with `assist.snapshot`. A failed or refused read is "no assist": the catalogue order and the plain last-visit
  // block apply.
  let assistContext: AssistContext | null = null;
  let snapshot: PatientSnapshot | null = null;
  const editable = recordState(visitRow) === "amending" || (recordState(visitRow) !== "sealed" && visitRow.status !== "completed" && visitRow.status !== "cancelled");
  const wantsContext = editable && assist["assist.terminology"] === true && hasPerm(membership.role, "consultations:edit");
  const wantsSnapshot = assist["assist.snapshot"] === true;
  if (wantsContext || wantsSnapshot) {
    const resolved = await resolveServiceContext("consultations:view");
    if (resolved.ok) {
      if (wantsContext) assistContext = await getConsultAssistContext(resolved.ctx);
      if (wantsSnapshot) snapshot = await getPatientSnapshot(resolved.ctx, patientId, id);
    }
  }

  // 10. The write side of Smart Assist (V2-09b 09B-04b). The signed-in doctor's own macros (RLS limits the read to them) only with `assist.shorthand` and
  // an editable record; the instants of this patient's booked or confirmed visits with this doctor from three days ago onward only with `assist.followup`
  // (the display rule of "Book follow-up", Q-14: nothing is stored). A failed read is "none".
  let macros: DoctorMacro[] = [];
  let upcomingVisits: string[] = [];
  if (editable && assist["assist.shorthand"] === true && hasPerm(membership.role, "consultations:edit")) {
    const resolved = await resolveServiceContext("consultations:edit");
    if (resolved.ok) {
      const listed = await listDoctorMacros(resolved.ctx);
      if (listed.success) macros = listed.value;
    }
  }
  if (editable && assist["assist.followup"] === true) {
    const resolved = await resolveServiceContext("consultations:view");
    if (resolved.ok) upcomingVisits = await getUpcomingVisitInstants(resolved.ctx, patientId, visitRow.doctor_id);
  }

  // 11. The patient's documents (V2-09b 09B-05, P1-24), newest first, for a role that may read them (labs:view); the consult lists this visit's and the
  // patient column the five newest. A failed or refused read is "no list" (null): no Attachments block is drawn.
  let documents: ConsultDocument[] | null = null;
  if (hasPerm(membership.role, "labs:view")) {
    const resolved = await resolveServiceContext("labs:view");
    if (resolved.ok) {
      const listed = await getPatientDocuments(resolved.ctx, patientId);
      if (listed.success) documents = listed.documents.map(toConsultDocument);
    }
  }

  // 12. The allergy picture of the visit (V2-09c 09C-02, R-7): the state, the coded allergies and what each current line matches. A failed or refused read is
  // "none": the screen then draws the allergy strip only and the database still checks every add.
  let allergyContext: RxAllergyContext | null = null;
  {
    const resolved = await resolveServiceContext("consultations:view");
    if (resolved.ok) {
      const loaded = await getRxAllergyContext(resolved.ctx, id);
      if (loaded.success) allergyContext = loaded.context;
    }
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
      assistContext={assistContext}
      allergyContext={allergyContext}
      snapshot={snapshot}
      macros={macros}
      upcomingVisits={upcomingVisits}
      canBook={hasPerm(membership.role, "appointments:edit")}
      documents={documents}
      canUpload={hasPerm(membership.role, "labs:edit")}
      canRecordAllergies={hasPerm(membership.role, "patients:edit") && hasPerm(membership.role, "consultations:view")}
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
