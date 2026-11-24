/**
 * V2-09e 09E-05 (R-8, R-9): the consult's one read answers what the page's 14 reads answered. For a draft, an amending, a sealed, an unsigned completed
 * and a cancelled visit, and for the owner, the visit's doctor, another doctor, a nurse and a receptionist, the view model `buildConsultScreen` makes from
 * `public.consult_screen` deep-equals the one built from the OLD reads (the services and queries the page called before this plan: `legacyScreen`
 * below is that page's loader, kept here as the reference; the services themselves stay where other callers use them). A second block pins stored
 * expectations (which parts each state and role must carry), so the comparison does not depend on the old loader being right. Real rows, the caller's
 * own client for every read (RLS applies), synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { hasPerm } from "@/lib/permissions";
import { clinicalContent, clinicalNotesEmbed, embeddedClinicalNotes } from "@/lib/db/clinical-notes";
import { recordState } from "@/features/consultation/record-state";
import { buildConsultScreen, type ConsultScreen } from "@/features/consultation/screen";
import { getConsultAssistContext, getPatientConsultationHistory, getPatientSnapshot, type PastVisitEncounter } from "@/features/consultation/service";
import { listDoctorMacros } from "@/features/consultation/macros-service";
import { getUpcomingVisitInstants } from "@/features/consultation/upcoming-visits";
import { getVisitDiagnoses } from "@/features/terminology/service";
import { getDoctorProtocolTemplates, getRxAllergyContext, getVisitPrescription } from "@/features/prescriptions/service";
import { getPatientDocuments } from "@/features/labs/service";
import { toConsultDocument } from "@/features/labs/consult-documents";
import type { ServiceContext } from "@/lib/auth/context";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";
import { insertReturningId } from "../helpers/db";
import { signVisitAs, reopenVisitAs } from "../helpers/clinical-commands";

const admin = getAdminClient();

/** The old page's loader (before 09E-05), over the caller's own context: the same reads, in the same order, assembled as the page did. */
async function legacyScreen(ctx: ServiceContext, visitId: string): Promise<ConsultScreen | null> {
  if (!hasPerm(ctx.role, "consultations:view")) return null;
  const supabase = ctx.db;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: visitRow, error: visitError } = await (supabase.from("visits") as any)
    .select(
      `id, tenant_id, patient_id, doctor_id, status, scheduled_at, specialty, signed_at, current_revision, ${clinicalNotesEmbed(undefined, true)},
       patient:patients (id, full_name, phone, whatsapp_opt_out, sex, date_of_birth, age, allergies, chronic_conditions, national_health_id)`,
    )
    .eq("id", visitId)
    .eq("tenant_id", ctx.tenantId)
    .single();
  if (visitError || !visitRow) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tokenRow } = await (supabase.from("queue_tokens") as any).select("token_number").eq("visit_id", visitId).eq("tenant_id", ctx.tenantId).maybeSingle();
  const historyResult = await getPatientConsultationHistory(ctx, visitRow.patient_id);
  const pastEncounters: PastVisitEncounter[] = historyResult.success ? historyResult.encounters.filter((v) => v.visitId !== visitId) : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: followUpRow } = await (supabase.from("follow_ups") as any).select("follow_up_date, notes").eq("visit_id", visitId).eq("tenant_id", ctx.tenantId).maybeSingle();
  const diagResult = await getVisitDiagnoses(ctx, visitId);
  const rxResult = await getVisitPrescription(ctx, visitId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: latestHeader } = await (supabase.from("prescriptions") as any)
    .select("version")
    .eq("visit_id", visitId)
    .eq("tenant_id", ctx.tenantId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  let amendmentReason: string | null = null;
  let amendmentOpenedAt: string | null = null;
  if (recordState(visitRow) === "amending") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: latestRevision } = await (supabase.from("visit_revisions") as any)
      .select("amendment_reason, amended_at")
      .eq("visit_id", visitId)
      .eq("tenant_id", ctx.tenantId)
      .order("revision_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    amendmentReason = latestRevision?.amendment_reason ?? null;
    amendmentOpenedAt = latestRevision?.amended_at ?? null;
  }
  const assist: Record<string, boolean> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: entitlements } = await (supabase as any).rpc("my_entitlements", { p_tenant: ctx.tenantId });
  for (const row of (entitlements ?? []) as Array<{ key: string; enabled: boolean }>) if (row.key.startsWith("assist.")) assist[row.key] = row.enabled === true;

  let assistContext: ConsultScreen["assistContext"] = null;
  let rxAssistContext: ConsultScreen["rxAssistContext"] = null;
  let snapshot: ConsultScreen["snapshot"] = null;
  const editable = recordState(visitRow) === "amending" || (recordState(visitRow) !== "sealed" && visitRow.status !== "completed" && visitRow.status !== "cancelled");
  const mayAssist = editable && hasPerm(ctx.role, "consultations:edit");
  const wantsTerminology = mayAssist && assist["assist.terminology"] === true;
  const wantsRxAssist = mayAssist && assist["assist.frequent_rx"] === true;
  if (wantsTerminology || wantsRxAssist) {
    const read = await getConsultAssistContext(ctx);
    if (wantsTerminology) assistContext = read;
    if (wantsRxAssist) rxAssistContext = read;
  }
  if (assist["assist.snapshot"] === true) snapshot = await getPatientSnapshot(ctx, visitRow.patient_id, visitId);

  let macros: ConsultScreen["macros"] = [];
  let upcomingVisits: string[] = [];
  if (editable && assist["assist.shorthand"] === true && hasPerm(ctx.role, "consultations:edit")) {
    const listed = await listDoctorMacros(ctx);
    if (listed.success) macros = listed.value;
  }
  if (editable && assist["assist.followup"] === true) upcomingVisits = await getUpcomingVisitInstants(ctx, visitRow.patient_id, visitRow.doctor_id);

  let documents: ConsultScreen["documents"] = null;
  if (hasPerm(ctx.role, "labs:view")) {
    const listed = await getPatientDocuments(ctx, visitRow.patient_id);
    if (listed.success) documents = listed.documents.map(toConsultDocument);
  }
  const loaded = await getRxAllergyContext(ctx, visitId);
  const allergyContext = loaded.success ? loaded.context : null;

  // The lists are new in 09E-05 (R-8): the reads the consult's query now holds, read here with the caller's own client and the same caps.
  let lists: ConsultScreen["lists"] = null;
  if (hasPerm(ctx.role, "prescriptions:edit") || hasPerm(ctx.role, "consultations:edit")) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meds = await (supabase.from("doctor_custom_medicines") as any)
      .select("medicine_name, generic_name, dose_form, default_dosage, default_timing, default_duration, use_count")
      .eq("tenant_id", ctx.tenantId)
      .eq("doctor_id", ctx.userId)
      .order("use_count", { ascending: false })
      .order("medicine_name", { ascending: true })
      .limit(500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dx = await (supabase.from("doctor_custom_diagnoses") as any)
      .select("diagnosis_name, specialty, use_count")
      .eq("tenant_id", ctx.tenantId)
      .eq("doctor_id", ctx.userId)
      .order("use_count", { ascending: false })
      .order("diagnosis_name", { ascending: true })
      .limit(500);
    const templates = await getDoctorProtocolTemplates(ctx);
    lists = { custom_medicines: meds.data ?? [], custom_diagnoses: dx.data ?? [], templates: templates.success ? templates.templates.slice(0, 100) : [] };
  }

  const patientRaw = Array.isArray(visitRow.patient) ? visitRow.patient[0] : visitRow.patient;
  if (!patientRaw) return null;
  const notes = clinicalContent(embeddedClinicalNotes(visitRow));
  return {
    visit: {
      id: visitRow.id,
      patient_id: visitRow.patient_id,
      doctor_id: visitRow.doctor_id,
      status: visitRow.status,
      scheduled_at: visitRow.scheduled_at,
      token_number: tokenRow?.token_number ?? null,
      vitals: (notes.vitals ?? null) as ConsultScreen["visit"]["vitals"],
      chief_complaints: (notes.chief_complaints ?? null) as ConsultScreen["visit"]["chief_complaints"],
      clinical_notes: notes.clinical_notes,
      specialty: visitRow.specialty ?? "general_physician",
      specialty_data: (notes.specialty_data ?? null) as ConsultScreen["visit"]["specialty_data"],
      investigations_advised: notes.investigations_advised ?? [],
      advice: notes.advice ?? [],
      follow_up: followUpRow ? { follow_up_date: followUpRow.follow_up_date, notes: followUpRow.notes } : null,
      diagnoses: diagResult.success ? diagResult.diagnoses : [],
      prescription_items: rxResult.success && rxResult.prescription ? rxResult.prescription.items : [],
      signed_at: visitRow.signed_at ?? null,
      current_revision: visitRow.current_revision ?? 1,
      draft_version: embeddedClinicalNotes(visitRow)?.draft_version ?? 0,
      prescription_version: latestHeader?.version ?? null,
      amendment_reason: amendmentReason,
      amendment_opened_at: amendmentOpenedAt,
    },
    patient: {
      id: patientRaw.id,
      full_name: patientRaw.full_name,
      phone: patientRaw.phone,
      whatsapp_opt_out: patientRaw.whatsapp_opt_out === true,
      gender: patientRaw.sex === "male" || patientRaw.sex === "female" || patientRaw.sex === "other" ? patientRaw.sex : null,
      date_of_birth: patientRaw.date_of_birth,
      age: patientRaw.age,
      allergies: patientRaw.allergies ?? null,
      chronic_conditions: patientRaw.chronic_conditions ?? [],
      uhid: patientRaw.national_health_id || (patientRaw.id ? patientRaw.id.slice(0, 8).toUpperCase() : null),
    },
    pastEncounters,
    assist,
    assistContext,
    rxAssistContext,
    snapshot,
    macros,
    upcomingVisits,
    documents,
    allergyContext,
    lists,
  };
}

async function newScreen(t: SeededTenant, visitId: string): Promise<ConsultScreen | null> {
  const { data, error } = await t.client.rpc("consult_screen", { p_tenant_id: t.tenantId, p_visit_id: visitId });
  if (error) throw new Error(`consult_screen failed: ${error.message}`);
  return buildConsultScreen(data, { canEdit: hasPerm(t.role, "consultations:edit") });
}

let owner: SeededTenant;
let doctor: SeededTenant;
let otherDoctor: SeededTenant;
let nurse: SeededTenant;
let receptionist: SeededTenant;
let otherClinic: SeededTenant;
const visits: Record<"draft" | "amending" | "sealed" | "unsignedCompleted" | "cancelled", string> = {} as never;

async function seedVisitFor(patientId: string, status: string, opts: { prescriptions?: boolean; note?: string } = {}): Promise<string> {
  const visitId = await insertReturningId(admin, "visits", {
    tenant_id: owner.tenantId,
    patient_id: patientId,
    doctor_id: doctor.userId,
    origin_type: "walk_in",
    status,
    created_by: owner.userId,
  } as never);
  const { error } = await admin
    .from("clinical_notes")
    .update({
      clinical_notes: opts.note ?? "Synthetic note",
      vitals: { pulse: 78, temperature: 37.2 },
      chief_complaints: [{ symptom: "Fever", duration_val: 2, duration_unit: "days" }],
      advice: ["Synthetic advice"],
      investigations_advised: ["CBC"],
    })
    .eq("visit_id", visitId);
  if (error) throw new Error(error.message);
  await insertReturningId(admin, "consultation_diagnoses", { tenant_id: owner.tenantId, visit_id: visitId, patient_id: patientId, diagnosis_name: `Synthetic diagnosis ${visitId.slice(0, 4)}` });
  if (opts.prescriptions !== false) {
    const rxId = await insertReturningId(admin, "prescriptions", { tenant_id: owner.tenantId, visit_id: visitId, patient_id: patientId, doctor_id: doctor.userId, version: 1, status: "active" });
    const { error: itemsError } = await admin.from("prescription_items").insert([
      { tenant_id: owner.tenantId, prescription_id: rxId, medicine_name: "Synthetic medicine B", dosage: "1-0-1", duration: "5 days", sort_order: 1 },
      { tenant_id: owner.tenantId, prescription_id: rxId, medicine_name: "Synthetic medicine A", dosage: "0-0-1", duration: "3 days", sort_order: 0 },
    ]);
    if (itemsError) throw new Error(itemsError.message);
  }
  return visitId;
}

beforeAll(async () => {
  owner = await seedTenantWithOwner("CI Consult Screen Clinic");
  doctor = await addMemberToTenant(owner.tenantId, "doctor");
  otherDoctor = await addMemberToTenant(owner.tenantId, "doctor");
  nurse = await addMemberToTenant(owner.tenantId, "nurse");
  receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
  otherClinic = await seedTenantWithOwner("CI Consult Screen Other Clinic");

  const patientId = await insertReturningId(admin, "patients", {
    tenant_id: owner.tenantId,
    full_name: "Synthetic Screen Patient",
    phone: "+910000000124",
    created_by: owner.userId,
    sex: "female",
    age: 41,
    allergies: ["Synthetic allergen"],
    chronic_conditions: ["Synthetic chronic condition"],
  } as never);

  // Two earlier signed visits: the history, and what the snapshot reads.
  for (const note of ["Synthetic history one", "Synthetic history two"]) {
    const id = await seedVisitFor(patientId, "in_consultation", { note });
    await signVisitAs(doctor, id);
  }
  visits.sealed = await seedVisitFor(patientId, "in_consultation");
  await signVisitAs(doctor, visits.sealed);
  visits.amending = await seedVisitFor(patientId, "in_consultation");
  await signVisitAs(doctor, visits.amending);
  await reopenVisitAs(doctor, visits.amending);
  visits.draft = await seedVisitFor(patientId, "in_consultation");
  visits.unsignedCompleted = await seedVisitFor(patientId, "completed");
  visits.cancelled = await seedVisitFor(patientId, "cancelled", { prescriptions: false });
  await admin.from("follow_ups").insert({ tenant_id: owner.tenantId, patient_id: patientId, visit_id: visits.draft, doctor_id: doctor.userId, follow_up_date: "2031-02-01", notes: "Synthetic follow-up" });

  // An upcoming booked visit with the doctor (the follow-up display rule).
  await insertReturningId(admin, "visits", {
    tenant_id: owner.tenantId,
    patient_id: patientId,
    doctor_id: doctor.userId,
    origin_type: "scheduled",
    status: "booked",
    scheduled_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    created_by: owner.userId,
  } as never);

  // A document of the patient (and one of nobody's).
  await admin.from("patient_documents").insert({
    tenant_id: owner.tenantId,
    patient_id: patientId,
    visit_id: visits.draft,
    title: "Synthetic report",
    original_filename: "report.pdf",
    storage_path: `tenants/${owner.tenantId}/patients/${patientId}/report.pdf`,
    file_size_bytes: 1234,
    mime_type: "application/pdf",
    report_date: "2031-01-10",
    uploaded_by: owner.userId,
  });

  // The doctors' own lists: each doctor has their own, the nurse and the owner none.
  for (const [who, tag] of [[doctor, "one"], [otherDoctor, "two"]] as const) {
    await admin.from("doctor_custom_medicines").insert({ tenant_id: owner.tenantId, doctor_id: who.userId, medicine_name: `Synthetic custom ${tag}`, default_dosage: "1-0-1", use_count: tag === "one" ? 4 : 9 });
    await admin.from("doctor_custom_diagnoses").insert({ tenant_id: owner.tenantId, doctor_id: who.userId, diagnosis_name: `Synthetic custom diagnosis ${tag}`, use_count: 2 });
    await admin.from("doctor_prescription_templates").insert({
      tenant_id: owner.tenantId,
      doctor_id: who.userId,
      template_name: `Synthetic template ${tag}`,
      items: [{ medicine_name: "Synthetic medicine A", dosage: "1-0-1", duration: "3 days", sort_order: 0 }],
    });
    await admin.from("doctor_text_macros").insert({ tenant_id: owner.tenantId, doctor_id: who.userId, shortcut: `.${tag}`, expansion: `Synthetic macro ${tag}` });
  }
}, 240_000);

const STATES = ["draft", "amending", "sealed", "unsignedCompleted", "cancelled"] as const;
const ROLE_NAMES = ["owner", "the visit's doctor", "another doctor", "nurse", "receptionist"] as const;
const roleUser = (name: (typeof ROLE_NAMES)[number]): SeededTenant =>
  ({ owner, "the visit's doctor": doctor, "another doctor": otherDoctor, nurse, receptionist })[name];

describe("consult_screen against the old reads (R-8, R-9)", () => {
  for (const state of STATES) {
    for (const roleName of ROLE_NAMES) {
      it(`${state} record, ${roleName}: the view model deep-equals the one built from the old reads`, async () => {
        const who = roleUser(roleName);
        const [fresh, old] = await Promise.all([newScreen(who, visits[state]), legacyScreen(ctxFor(who), visits[state])]);
        if (roleName === "receptionist") {
          expect(fresh).toBeNull();
          expect(old).toBeNull();
          return;
        }
        expect(fresh).not.toBeNull();
        expect(fresh).toEqual(old);
      }, 60_000);
    }
  }

  it("another clinic's owner gets nothing for this clinic's visit, as a not-found page", async () => {
    const raw = await otherClinic.client.rpc("consult_screen", { p_tenant_id: owner.tenantId, p_visit_id: visits.draft });
    expect(raw.data).toBeNull();
    const forged = await otherClinic.client.rpc("consult_screen", { p_tenant_id: otherClinic.tenantId, p_visit_id: visits.draft });
    expect(forged.data).toBeNull();
    expect(await newScreen(otherClinic, visits.draft)).toBeNull();
  });
});

describe("what each state and role carries (stored expectations)", () => {
  type Expected = { macros: number; assistContext: boolean; rxAssistContext: boolean; upcoming: number; lists: boolean; documents: boolean; snapshot: boolean; amendment: boolean };
  const editor = (over: Partial<Expected> = {}): Expected => ({ macros: 1, assistContext: true, rxAssistContext: true, upcoming: 1, lists: true, documents: true, snapshot: true, amendment: false, ...over });
  const frozen = (over: Partial<Expected> = {}): Expected => editor({ macros: 0, assistContext: false, rxAssistContext: false, upcoming: 0, ...over });
  const EXPECTED: Record<(typeof STATES)[number], Record<"owner" | "doctor" | "otherDoctor" | "nurse", Expected>> = {
    draft: { owner: editor({ macros: 0 }), doctor: editor(), otherDoctor: editor({ macros: 1 }), nurse: editor({ macros: 0, assistContext: false, rxAssistContext: false, lists: false }) },
    amending: {
      owner: editor({ macros: 0, amendment: true }),
      doctor: editor({ amendment: true }),
      otherDoctor: editor({ amendment: true }),
      nurse: editor({ macros: 0, assistContext: false, rxAssistContext: false, lists: false, amendment: true }),
    },
    sealed: { owner: frozen(), doctor: frozen(), otherDoctor: frozen(), nurse: frozen({ lists: false }) },
    unsignedCompleted: { owner: frozen(), doctor: frozen(), otherDoctor: frozen(), nurse: frozen({ lists: false }) },
    cancelled: { owner: frozen(), doctor: frozen(), otherDoctor: frozen(), nurse: frozen({ lists: false }) },
  };
  const WHO = () => ({ owner, doctor, otherDoctor, nurse });

  for (const state of STATES) {
    for (const role of ["owner", "doctor", "otherDoctor", "nurse"] as const) {
      it(`${state}, ${role}`, async () => {
        const screen = await newScreen(WHO()[role], visits[state]);
        expect(screen).not.toBeNull();
        const want = EXPECTED[state][role];
        expect(screen!.macros).toHaveLength(want.macros);
        expect(screen!.assistContext !== null).toBe(want.assistContext);
        expect(screen!.rxAssistContext !== null).toBe(want.rxAssistContext);
        expect(screen!.upcomingVisits).toHaveLength(want.upcoming);
        expect(screen!.lists !== null).toBe(want.lists);
        expect(screen!.documents !== null).toBe(want.documents);
        expect(screen!.snapshot !== null).toBe(want.snapshot);
        expect(screen!.visit.amendment_reason !== null).toBe(want.amendment);
      }, 60_000);
    }
  }

  it("a doctor's lists are the doctor's own and nobody else's, in the model", async () => {
    const mine = await newScreen(doctor, visits.draft);
    const theirs = await newScreen(otherDoctor, visits.draft);
    expect(mine!.lists!.custom_medicines.map((m) => m.medicine_name)).toEqual(["Synthetic custom one"]);
    expect(mine!.lists!.custom_diagnoses.map((d) => d.diagnosis_name)).toEqual(["Synthetic custom diagnosis one"]);
    expect(mine!.lists!.templates.map((t) => t.template_name)).toEqual(["Synthetic template one"]);
    expect(mine!.macros.map((m) => m.shortcut)).toEqual([".one"]);
    expect(theirs!.lists!.templates.map((t) => t.template_name)).toEqual(["Synthetic template two"]);
    expect(theirs!.macros.map((m) => m.shortcut)).toEqual([".two"]);
    // The owner keeps no list of their own: empty, not the doctors'.
    const ownersView = await newScreen(owner, visits.draft);
    expect(ownersView!.lists).toEqual({ custom_medicines: [], custom_diagnoses: [], templates: [] });
  });

  it("the history never carries the visit on screen and carries the other encounters with their lines", async () => {
    const screen = await newScreen(doctor, visits.draft);
    const ids = screen!.pastEncounters.map((e) => e.visitId);
    expect(ids).not.toContain(visits.draft);
    expect(ids).toContain(visits.sealed);
    expect(screen!.pastEncounters.every((e) => e.prescriptions.every((r) => r.items.length === 2 && (r.items[0] as { sort_order?: number }).sort_order === 0))).toBe(true);
  });

  it("the Rx lines come in sort order and the draft's follow-up and documents are the patient's", async () => {
    const screen = await newScreen(doctor, visits.draft);
    expect(screen!.visit.prescription_items.map((i) => i.medicine_name)).toEqual(["Synthetic medicine A", "Synthetic medicine B"]);
    expect(screen!.visit.follow_up).toEqual({ follow_up_date: "2031-02-01", notes: "Synthetic follow-up" });
    expect(screen!.documents!.map((d) => d.title)).toEqual(["Synthetic report"]);
    expect(screen!.visit.prescription_version).toBe(1);
  });
});
