/**
 * Role RLS through the Data API with real JWTs (V2-05; acceptance 2 "a receptionist PostgREST read of
 * `clinical_notes` is denied (per PO-3)"; 05-02a rulings R-2, R-3, R-5; threats T-05-01, T-05-02, T-05-03).
 *
 * Every call goes through supabase-js → PostgREST with the member's own session, exactly as the app's request client
 * does, so these are the acceptance path (the pgTAP matrix proves the same rules inside the database). 05-02a moved the
 * clinical content of a visit out of `visits` into `public.clinical_notes`:
 *   - a receptionist (and an admin) read 0 clinical_notes rows while a doctor, a nurse and the owner read the note;
 *   - the six legacy columns on `visits`, which the front desk still reads, hold only empty values and accept none;
 *   - a nurse updates vitals but nothing else; a receptionist's update matches 0 rows;
 *   - a visit booked by a receptionist gets its empty clinical_notes row, with no way to put content in;
 *   - the services a receptionist reaches (visit history, queue) return clinical data as absent.
 * 05-02b adds this file's front-desk and financial cases. Seeded with the service role; synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getPatientVisitHistory } from "@/features/patients/service";
import { getQueueForDate } from "@/features/queue/service";
import { recordVisitVitals } from "@/features/visits/service";
import { resolveTimeZone, todayInTz } from "@/lib/datetime";
import { ctxFor } from "../helpers/context";
import { clinicalNotesOf, seedClinicalNotes } from "../helpers/clinical-notes";
import { getAdminClient } from "../helpers/supabase-admin";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

const NOTE = "Synthetic clinical note for the RLS spec.";
const VITALS = { systolic: 121, diastolic: 79, pulse: 70 };

describe("clinical_notes RLS through PostgREST (05-02a, acceptance 2)", () => {
  const admin = getAdminClient();
  let owner: SeededTenant;
  let admin_: SeededTenant;
  let doctor: SeededTenant;
  let nurse: SeededTenant;
  let receptionist: SeededTenant;
  let otherOwner: SeededTenant;
  let patientId: string;
  let visitId: string;

  async function newVisit(): Promise<string> {
    const { data, error } = await admin
      .from("visits")
      .insert({
        tenant_id: owner.tenantId,
        patient_id: patientId,
        doctor_id: doctor.userId,
        origin_type: "walk_in",
        status: "waiting",
        scheduled_at: new Date().toISOString(),
        created_by: owner.userId,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`visit seed failed: ${error?.message}`);
    return data.id;
  }

  beforeAll(async () => {
    owner = await seedTenantWithOwner("Synthetic Role RLS Clinic");
    admin_ = await addMemberToTenant(owner.tenantId, "admin");
    doctor = await addMemberToTenant(owner.tenantId, "doctor");
    nurse = await addMemberToTenant(owner.tenantId, "nurse");
    receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
    otherOwner = await seedTenantWithOwner("Synthetic Role RLS Other Clinic");

    const { data: patient, error } = await admin
      .from("patients")
      .insert({ tenant_id: owner.tenantId, full_name: "Synthetic RLS Patient", phone: "+919000000601", created_by: owner.userId })
      .select("id")
      .single();
    if (error || !patient) throw new Error(`patient seed failed: ${error?.message}`);
    patientId = patient.id;

    visitId = await newVisit();
    await seedClinicalNotes(visitId, { clinical_notes: NOTE, vitals: VITALS, advice: ["Synthetic advice"] });
  });

  describe("SELECT", () => {
    it("a receptionist reads no clinical_notes row, not even with select('*') and no filter", async () => {
      const { data, error } = await receptionist.client.from("clinical_notes").select("*");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("an admin reads no clinical_notes row (R-9)", async () => {
      const { data, error } = await admin_.client.from("clinical_notes").select("*").eq("visit_id", visitId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("the doctor, the nurse and the owner read the note", async () => {
      for (const member of [doctor, nurse, owner]) {
        const { data, error } = await member.client.from("clinical_notes").select("clinical_notes, vitals").eq("visit_id", visitId);
        expect(error, member.role).toBeNull();
        expect(data, member.role).toEqual([{ clinical_notes: NOTE, vitals: VITALS }]);
      }
    });

    it("another clinic's owner reads nothing", async () => {
      const { data } = await otherOwner.client.from("clinical_notes").select("*").eq("visit_id", visitId);
      expect(data).toEqual([]);
    });

    it("a receptionist still reads the visit row, whose legacy clinical columns hold only empty values", async () => {
      const { data, error } = await receptionist.client
        .from("visits")
        .select("id, status, clinical_notes, vitals, chief_complaints, specialty_data, investigations_advised, advice")
        .eq("id", visitId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      const row = data![0];
      expect(row.status).toBe("waiting");
      expect(row.clinical_notes).toBeNull();
      for (const [col, empty] of [
        ["vitals", {}],
        ["chief_complaints", []],
        ["specialty_data", {}],
        ["investigations_advised", []],
        ["advice", []],
      ] as const) {
        const value = (row as Record<string, unknown>)[col];
        if (value !== null) expect(value, col).toEqual(empty);
      }
      expect(JSON.stringify(data)).not.toContain(NOTE);
    });

    it("the embed of clinical_notes in a visit select is null for a receptionist and the note for the doctor", async () => {
      const select = "id, notes:clinical_notes(clinical_notes, vitals)";
      const asReceptionist = await receptionist.client.from("visits").select(select).eq("id", visitId).single();
      expect(asReceptionist.error).toBeNull();
      expect((asReceptionist.data as { notes: unknown }).notes).toBeNull();
      const asDoctor = await doctor.client.from("visits").select(select).eq("id", visitId).single();
      expect((asDoctor.data as { notes: unknown }).notes).toEqual({ clinical_notes: NOTE, vitals: VITALS });
    });
  });

  describe("writes", () => {
    it("nobody can put clinical content back into visits (the CHECK refuses it, 23514)", async () => {
      for (const member of [owner, doctor]) {
        const { error } = await member.client.from("visits").update({ clinical_notes: "Injected" }).eq("id", visitId);
        expect(error?.code, member.role).toBe("23514");
      }
      const { error } = await admin.from("visits").update({ vitals: { pulse: 99 } }).eq("id", visitId);
      expect(error?.code).toBe("23514");
    });

    it("a nurse updates vitals through PostgREST, and nothing else", async () => {
      const ok = await nurse.client
        .from("clinical_notes")
        .update({ vitals: { pulse: 88 } })
        .eq("visit_id", visitId)
        .select("visit_id");
      expect(ok.error).toBeNull();
      expect(ok.data).toHaveLength(1);

      const refused = await nurse.client
        .from("clinical_notes")
        .update({ clinical_notes: "Nurse-written note" })
        .eq("visit_id", visitId)
        .select("visit_id");
      expect(refused.error?.code).toBe("42501");

      const stored = await clinicalNotesOf(visitId);
      expect(stored.vitals).toEqual({ pulse: 88 });
      expect(stored.clinical_notes).toBe(NOTE);
      await seedClinicalNotes(visitId, { vitals: VITALS });
    });

    it("a receptionist's or an admin's update matches 0 rows and changes nothing", async () => {
      for (const member of [receptionist, admin_]) {
        const { data, error } = await member.client
          .from("clinical_notes")
          .update({ clinical_notes: "Front-desk text" })
          .eq("visit_id", visitId)
          .select("visit_id");
        expect(error, member.role).toBeNull();
        expect(data, member.role).toEqual([]);
      }
      expect((await clinicalNotesOf(visitId)).clinical_notes).toBe(NOTE);
    });

    it("no member inserts or deletes a clinical_notes row (no privilege)", async () => {
      const ins = await owner.client.from("clinical_notes").insert({ visit_id: visitId, tenant_id: owner.tenantId });
      expect(ins.error?.code).toBe("42501");
      const del = await owner.client.from("clinical_notes").delete().eq("visit_id", visitId);
      expect(del.error?.code).toBe("42501");
    });

    it("a visit a receptionist books gets exactly one empty clinical_notes row; content cannot ride along", async () => {
      const injected = await receptionist.client.from("visits").insert({
        tenant_id: owner.tenantId,
        patient_id: patientId,
        doctor_id: doctor.userId,
        origin_type: "walk_in",
        created_by: receptionist.userId,
        clinical_notes: "Injected at booking",
      });
      expect(injected.error?.code).toBe("23514");

      const { data, error } = await receptionist.client
        .from("visits")
        .insert({ tenant_id: owner.tenantId, patient_id: patientId, doctor_id: doctor.userId, origin_type: "walk_in", created_by: receptionist.userId })
        .select("id")
        .single();
      expect(error).toBeNull();
      const notes = await admin.from("clinical_notes").select("*").eq("visit_id", data!.id);
      expect(notes.data).toHaveLength(1);
      expect(notes.data![0]).toMatchObject({
        tenant_id: owner.tenantId,
        vitals: {},
        chief_complaints: [],
        clinical_notes: null,
        specialty_data: {},
        investigations_advised: [],
        advice: [],
      });
    });
  });

  describe("services a receptionist reaches render clinical data as absent", () => {
    it("patient visit history: the receptionist gets the visit without its note or vitals; the doctor gets both", async () => {
      const asReceptionist = await getPatientVisitHistory(ctxFor(receptionist), patientId);
      const mine = asReceptionist.find((v) => v.id === visitId);
      expect(mine).toBeDefined();
      expect(mine!.clinical_notes ?? null).toBeNull();
      expect(mine!.vitals ?? null).toBeNull();
      expect(JSON.stringify(asReceptionist)).not.toContain(NOTE);

      const asDoctor = await getPatientVisitHistory(ctxFor(doctor), patientId);
      expect(asDoctor.find((v) => v.id === visitId)?.clinical_notes).toBe(NOTE);
    });

    it("queue: the receptionist sees the visit without vitals; the nurse sees the vitals", async () => {
      // The clinic day in the clinic's zone (the queue's window), not the UTC date.
      const { data: tenant } = await admin.from("tenants").select("timezone").eq("id", owner.tenantId).single();
      const today = todayInTz(resolveTimeZone((tenant as { timezone?: string | null } | null)?.timezone));
      const asReceptionist = await getQueueForDate(ctxFor(receptionist), today);
      const asNurse = await getQueueForDate(ctxFor(nurse), today);
      if (!asReceptionist.success || !asNurse.success) throw new Error("queue load failed");
      const r = asReceptionist.items.find((i) => i.visit.id === visitId);
      const n = asNurse.items.find((i) => i.visit.id === visitId);
      expect(r).toBeDefined();
      expect(r!.visit.vitals ?? null).toBeNull();
      expect(n?.visit.vitals).toEqual(VITALS);
    });

    it("recordVisitVitals by the nurse lands in clinical_notes; a receptionist is refused before any write", async () => {
      const visit2 = await newVisit();
      const res = await recordVisitVitals(ctxFor(nurse), visit2, { systolic: 118, diastolic: 76, pulse: 66 });
      expect(res.success).toBe(true);
      const stored = await clinicalNotesOf(visit2);
      expect(stored.vitals).toMatchObject({ systolic: 118, pulse: 66, recorded_by: nurse.userId });

      const refused = await recordVisitVitals(ctxFor(receptionist), visit2, { systolic: 200, diastolic: 100 });
      expect(refused.success).toBe(false);
      expect((await clinicalNotesOf(visit2)).vitals).toMatchObject({ systolic: 118 });
    });

    it("recordVisitVitals for another clinic's visit is refused, never reported as recorded", async () => {
      const res = await recordVisitVitals(ctxFor(otherOwner), visitId, { systolic: 150, diastolic: 95 });
      expect(res.success).toBe(false);
      expect((await clinicalNotesOf(visitId)).vitals).toEqual(VITALS);
    });
  });
});
