/**
 * V2-09b 09B-04a (R-13, AI-10, T-09B-05): the patient snapshot.
 *   - `getPatientSnapshot` over `public.patient_snapshot` against the real database with the caller's own client (RLS applies): the A3 defect is gone (a
 *     booked, waiting, cancelled or unsigned completed visit is not history), the visit on screen is excluded, signed visits come newest first with the
 *     signed Rx lines, the overdue-follow-up rule, the roles and another clinic get nothing. The function is covered by pgTAP too
 *     (`diagnosis_search_snapshot.test.sql`).
 *   - `snapshotText` and the view (pure/markup): the lines the template shows, and range flags only when the clinic is entitled (`assist.vitals`).
 * Synthetic data only.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { getPatientSnapshot } from "@/features/consultation/service";
import { parsePatientSnapshot, snapshotText, type PatientSnapshot } from "@/features/consultation/snapshot";
import { PatientSnapshotView } from "@/components/clinical/patient-snapshot";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedPatient } from "../helpers/front-desk-commands";
import { signVisitAs } from "../helpers/clinical-commands";
import { formatClinicDate } from "@/lib/datetime/format";
import { addDaysYmd, todayInTz } from "@/lib/datetime";

const admin = getAdminClient();
let clinic: SeededTenant;
let other: SeededTenant;
let doctor: SeededTenant;
let nurse: SeededTenant;
let receptionist: SeededTenant;
let patientId: string;
let currentVisit: string;
const signedVisits: string[] = [];
let waitingVisit: string;
let bookedVisit: string;
let cancelledVisit: string;
let desk: string;

async function visitFor(tenant: SeededTenant, patient: string, status: string, over: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin
    .from("visits")
    .insert({ tenant_id: tenant.tenantId, patient_id: patient, doctor_id: doctor.userId, origin_type: "walk_in", status, created_by: tenant.userId, ...over })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "no visit");
  return data.id;
}

async function signedVisit(label: string, over: { vitals?: Record<string, unknown>; diagnosis?: string; medicine?: string } = {}): Promise<string> {
  const id = await visitFor(clinic, patientId, "in_consultation");
  const notes = await admin
    .from("clinical_notes")
    .update({ clinical_notes: `Synthetic note ${label}`, ...(over.vitals ? { vitals: over.vitals as never } : {}) })
    .eq("visit_id", id);
  if (notes.error) throw new Error(notes.error.message);
  if (over.diagnosis) {
    const dx = await admin.from("consultation_diagnoses").insert({ tenant_id: clinic.tenantId, visit_id: id, patient_id: patientId, diagnosis_name: over.diagnosis, icd11_code: "XX00" });
    if (dx.error) throw new Error(dx.error.message);
  }
  if (over.medicine) {
    const rx = await admin.from("prescriptions").insert({ tenant_id: clinic.tenantId, visit_id: id, patient_id: patientId, doctor_id: doctor.userId, version: 1, status: "active" }).select("id").single();
    if (rx.error || !rx.data) throw new Error(rx.error?.message ?? "no rx");
    const item = await admin.from("prescription_items").insert({ tenant_id: clinic.tenantId, prescription_id: rx.data.id, medicine_name: over.medicine, dosage: "1-0-1", duration: "5 days", sort_order: 0 });
    if (item.error) throw new Error(item.error.message);
  }
  await signVisitAs(doctor, id);
  return id;
}

beforeAll(async () => {
  clinic = await seedTenantWithOwner("CI Snapshot Clinic");
  other = await seedTenantWithOwner("CI Snapshot Other Clinic");
  doctor = await addMemberToTenant(clinic.tenantId, "doctor");
  nurse = await addMemberToTenant(clinic.tenantId, "nurse");
  receptionist = await addMemberToTenant(clinic.tenantId, "receptionist");
  patientId = await seedPatient(clinic, { full_name: "Synthetic Snapshot Patient", allergies: ["Penicillin"], chronic_conditions: ["Hypertension"] });
  // Six signed visits: the sixth-oldest must not appear.
  signedVisits.push(await signedVisit("oldest", { diagnosis: "Oldest diagnosis" }));
  for (const n of [2, 3, 4]) signedVisits.push(await signedVisit(`visit ${n}`, { diagnosis: `Diagnosis ${n}` }));
  signedVisits.push(await signedVisit("visit 5", { diagnosis: "Hypertension", vitals: { systolic: 150, diastolic: 95, pulse: 96, recorded_by: nurse.userId } }));
  signedVisits.push(await signedVisit("newest", { diagnosis: "Viral fever", medicine: "Synthetic Signed Medicine" }));
  // Not history: a waiting, a booked and a cancelled visit, and one the desk completed unsigned.
  waitingVisit = await visitFor(clinic, patientId, "waiting");
  bookedVisit = await visitFor(clinic, patientId, "booked", { origin_type: "scheduled", scheduled_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), is_overbooked: true });
  cancelledVisit = await visitFor(clinic, patientId, "cancelled");
  desk = await visitFor(clinic, patientId, "completed");
  for (const id of [waitingVisit, bookedVisit, cancelledVisit, desk]) {
    const dx = await admin.from("consultation_diagnoses").insert({ tenant_id: clinic.tenantId, visit_id: id, patient_id: patientId, diagnosis_name: `Not history ${id.slice(0, 4)}` });
    if (dx.error) throw new Error(dx.error.message);
  }
  currentVisit = await visitFor(clinic, patientId, "in_consultation");
}, 240_000);

describe("getPatientSnapshot (database)", () => {
  it("is the last five signed visits, newest first, without the visit on screen or the sixth-oldest", async () => {
    const snapshot = await getPatientSnapshot(ctxFor(doctor), patientId, currentVisit);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.visits).toHaveLength(5);
    expect(snapshot!.visits.map((v) => v.diagnoses[0]?.name)).toEqual(["Viral fever", "Hypertension", "Diagnosis 4", "Diagnosis 3", "Diagnosis 2"]);
    expect(JSON.stringify(snapshot)).not.toContain("Oldest diagnosis");
  });

  it("the A3 defect is gone: a waiting, booked, cancelled or unsigned completed visit is not history", async () => {
    const snapshot = await getPatientSnapshot(ctxFor(doctor), patientId, currentVisit);
    expect(JSON.stringify(snapshot)).not.toContain("Not history");
    const text = snapshotText(snapshot!);
    expect([text.lastSeen, ...text.earlier].join(" ")).not.toContain("Not history");
  });

  it("the visit on screen is excluded, and naming a signed visit leaves it out", async () => {
    const withoutNewest = await getPatientSnapshot(ctxFor(doctor), patientId, signedVisits[5]);
    expect(withoutNewest!.visits.map((v) => v.diagnoses[0]?.name)[0]).toBe("Hypertension");
  });

  it("the newest visit carries the signed Rx lines, the doctor's name is a display name and no identifier appears", async () => {
    const snapshot = await getPatientSnapshot(ctxFor(doctor), patientId, currentVisit);
    expect(snapshot!.visits[0].rx).toEqual([{ medicine: "Synthetic Signed Medicine", dosage: "1-0-1", timing: null, duration: "5 days" }]);
    const text = JSON.stringify(snapshot);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it("allergies, chronic conditions and the latest measured vitals (no recorder) come with it", async () => {
    const snapshot = await getPatientSnapshot(ctxFor(doctor), patientId, currentVisit);
    expect(snapshot!.allergies).toEqual(["Penicillin"]);
    expect(snapshot!.chronic_conditions).toEqual(["Hypertension"]);
    expect(snapshot!.last_vitals?.vitals).toEqual({ systolic: 150, diastolic: 95, pulse: 96 });
    expect(JSON.stringify(snapshot!.last_vitals)).not.toContain(nurse.userId);
  });

  it("a nurse reads it; a receptionist gets null; another clinic's owner gets null for this patient", async () => {
    expect(await getPatientSnapshot(ctxFor(nurse), patientId, currentVisit)).not.toBeNull();
    expect(await getPatientSnapshot(ctxFor(receptionist), patientId, currentVisit)).toBeNull();
    expect(await getPatientSnapshot(ctxFor(other), patientId, null)).toBeNull();
  });

  it("an invalid id is refused before the database", async () => {
    expect(await getPatientSnapshot(ctxFor(doctor), "not-a-uuid", null)).toBeNull();
    expect(await getPatientSnapshot(ctxFor(doctor), patientId, "not-a-uuid")).toBeNull();
  });

  describe("due follow-ups", () => {
    const yesterday = () => {
      const [y, m, d] = todayInTz("Asia/Kolkata").split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
    };

    it("a follow-up whose date has passed and with no attended visit since is due; the visit on screen is not 'since'; one not yet due is not listed", async () => {
      const patient2 = await seedPatient(clinic, { full_name: "Synthetic Follow-up Patient" });
      // The visit that wrote the follow-up (signed), and the follow-up: written 10 days ago, due yesterday. A second one is not yet due.
      const origin = await visitFor(clinic, patient2, "in_consultation");
      await admin.from("clinical_notes").update({ clinical_notes: "Synthetic follow-up note" }).eq("visit_id", origin);
      // Written while the visit is still a draft (a signed visit's rows are sealed).
      const due = await admin
        .from("follow_ups")
        .insert({ tenant_id: clinic.tenantId, patient_id: patient2, visit_id: origin, doctor_id: doctor.userId, follow_up_date: yesterday(), created_at: new Date(Date.now() - 10 * 86_400_000).toISOString() });
      expect(due.error).toBeNull();
      await signVisitAs(doctor, origin);
      const future = await admin
        .from("follow_ups")
        .insert({ tenant_id: clinic.tenantId, patient_id: patient2, doctor_id: doctor.userId, follow_up_date: addDaysYmd(todayInTz("Asia/Kolkata"), 5) });
      expect(future.error).toBeNull();
      const here = await visitFor(clinic, patient2, "in_consultation");

      const snapshot = await getPatientSnapshot(ctxFor(doctor), patient2, here);
      expect(snapshot!.due_follow_ups).toEqual([{ date: yesterday() }]);
      expect(snapshotText(snapshot!).due).toEqual([`Due follow-up ${formatClinicDate(yesterday())} (no visit since)`]);
      // Without naming the visit on screen it counts as an attended visit since the follow-up was written: nothing is due.
      expect((await getPatientSnapshot(ctxFor(doctor), patient2, null))!.due_follow_ups).toEqual([]);
    });
  });
});

describe("snapshotText and the view", () => {
  const snapshot: PatientSnapshot = {
    visits: [
      { date: "2026-10-12", doctor: "Dr Rao", diagnoses: [{ name: "Essential hypertension", icd11: "BA00" }], rx: [{ medicine: "Telmisartan 40 mg", dosage: "1-0-0", timing: null, duration: "30 days" }] },
      { date: "2026-08-14", doctor: "Dr Rao", diagnoses: [{ name: "Hypertension review", icd11: null }], rx: [] },
      { date: "2026-06-03", doctor: null, diagnoses: [], rx: [] },
    ],
    allergies: ["Penicillin"],
    chronic_conditions: ["Hypertension"],
    due_follow_ups: [{ date: "2026-11-03" }],
    last_vitals: { date: "2026-10-12", vitals: { systolic: 150, diastolic: 95, pulse: 96 } },
  };

  it("lays out the lines of the template", () => {
    expect(snapshotText(snapshot)).toEqual({
      lastSeen: "Last seen 12 Oct 2026 · Dr Rao",
      diagnoses: ["Essential hypertension"],
      rx: ["Telmisartan 40 mg · 1-0-0 · 30 days"],
      earlier: ["14 Aug 2026 · Dr Rao · Hypertension review", "3 Jun 2026"],
      due: ["Due follow-up 3 Nov 2026 (no visit since)"],
      vitals: { label: "Last vitals · 12 Oct 2026", values: { systolic: 150, diastolic: 95, pulse: 96 } },
    });
  });

  it("a patient with no signed visit has no last-seen line", () => {
    const text = snapshotText({ ...snapshot, visits: [], due_follow_ups: [], last_vitals: null });
    expect(text).toMatchObject({ lastSeen: null, diagnoses: [], rx: [], earlier: [], due: [], vitals: null });
  });

  it("empty vitals show no vitals block", () => {
    expect(snapshotText({ ...snapshot, last_vitals: { date: "2026-10-12", vitals: {} } }).vitals).toBeNull();
  });

  const html = (flags: boolean) => renderToStaticMarkup(createElement(PatientSnapshotView, { snapshot, flags }));
  const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  it("shows the Smart Assist label (never 'AI'), the last visit, the Rx line and the due follow-up", () => {
    const out = text(html(false));
    expect(out).toContain("Smart Assist");
    expect(out).not.toMatch(/\bAI\b/);
    expect(out).toContain("Last seen 12 Oct 2026 · Dr Rao");
    expect(out).toContain("Telmisartan 40 mg · 1-0-0 · 30 days");
    expect(out).toContain("Due follow-up 3 Nov 2026 (no visit since)");
    expect(out).toContain("Last vitals · 12 Oct 2026");
  });

  it("range flags on the vitals appear only when the clinic has assist.vitals", () => {
    expect(text(html(true))).toContain("· high");
    expect(text(html(false))).not.toContain("· high");
    expect(text(html(false))).toContain("150/95");
  });

  it("parsePatientSnapshot accepts the documented shape and refuses anything else", () => {
    expect(parsePatientSnapshot(snapshot)).toEqual(snapshot);
    expect(parsePatientSnapshot(null)).toBeNull();
    expect(parsePatientSnapshot({ visits: "x" })).toBeNull();
  });
});
