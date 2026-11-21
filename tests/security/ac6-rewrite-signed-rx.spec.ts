/**
 * THREAT_MODEL AC-6 (rewrite a signed prescription and its record), database legs; V2-09a 09A-02 (09A-03 adds the storage legs).
 *
 * On a SIGNED visit, as the clinic owner and as the doctor (their own JWT clients, PostgREST) and as the service role (the v1 API's client):
 * UPDATE, DELETE and INSERT on the Rx items, the Rx header (version, status, signed_at, amendment_reason), the clinical note, diagnoses and
 * follow-ups, and the visit itself (status, signature, signer, specialty, reason for the visit). Every write is refused with SQLSTATE 42501
 * and the rows are re-read unchanged. The same writes succeed on a DRAFT visit and (content only) on an AMENDING one, so a refusal is the
 * seal and not a broken fixture. Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import type { TestDb } from "../helpers/db";
import { reopenVisitAs, seedClinicalVisit, signVisitAs } from "../helpers/clinical-commands";

const admin = getAdminClient();
let owner: SeededTenant;
let doctor: SeededTenant;

beforeAll(async () => {
  owner = await seedTenantWithOwner("Synthetic AC-6 Clinic");
  doctor = await addMemberToTenant(owner.tenantId, "doctor");
}, 60_000);

interface Rec {
  tenantId: string;
  visitId: string;
  patientId: string;
  rxId: string;
  itemId: string;
  diagnosisId: string;
  followUpId: string;
}
type State = "draft" | "sealed" | "amending";

async function record(state: State): Promise<Rec> {
  const v = await seedClinicalVisit(owner, { doctorId: doctor.userId, diagnosis: true, prescriptions: 1, notes: "Synthetic signed note." });
  const rxId = v.prescriptionIds[0];
  const { data: item, error: itemErr } = await admin
    .from("prescription_items")
    .insert({ tenant_id: owner.tenantId, prescription_id: rxId, medicine_name: "Synthetic medicine", dosage: "1-0-1", duration: "5 days", sort_order: 0 })
    .select("id")
    .single();
  if (itemErr || !item) throw new Error(`item seed failed: ${itemErr?.message}`);
  const { data: fu, error: fuErr } = await admin
    .from("follow_ups")
    .insert({ tenant_id: owner.tenantId, patient_id: v.patientId, visit_id: v.visitId, doctor_id: doctor.userId, follow_up_date: "2031-03-01" })
    .select("id")
    .single();
  if (fuErr || !fu) throw new Error(`follow-up seed failed: ${fuErr?.message}`);
  const { data: dx, error: dxErr } = await admin.from("consultation_diagnoses").select("id").eq("visit_id", v.visitId).single();
  if (dxErr || !dx) throw new Error(`diagnosis read failed: ${dxErr?.message}`);
  if (state !== "draft") await signVisitAs(doctor, v.visitId);
  if (state === "amending") await reopenVisitAs(doctor, v.visitId);
  return { tenantId: owner.tenantId, visitId: v.visitId, patientId: v.patientId, rxId, itemId: item.id, diagnosisId: dx.id, followUpId: fu.id };
}

/** Everything AC-6 is about, read back with the service role. */
async function snapshot(r: Rec) {
  const [visit, notes, rx, items, dx, fu] = await Promise.all([
    admin.from("visits").select("status, signed_at, signed_by, specialty, reason_for_visit, current_revision").eq("id", r.visitId).single(),
    admin.from("clinical_notes").select("clinical_notes, vitals, advice").eq("visit_id", r.visitId).single(),
    admin.from("prescriptions").select("id, version, status, signed_at, amendment_reason").eq("visit_id", r.visitId).order("version"),
    admin.from("prescription_items").select("id, medicine_name, dosage").eq("prescription_id", r.rxId).order("id"),
    admin.from("consultation_diagnoses").select("id, diagnosis_name").eq("visit_id", r.visitId).order("id"),
    admin.from("follow_ups").select("id, follow_up_date").eq("visit_id", r.visitId).order("id"),
  ]);
  return { visit: visit.data, notes: notes.data, rx: rx.data, items: items.data, dx: dx.data, fu: fu.data };
}

type Write = { name: string; kind: "content" | "seal"; users: boolean; run: (db: TestDb, r: Rec) => PromiseLike<{ error: { code?: string; message?: string } | null }> };

// `users`: also attempted through a member's JWT (some columns carry no UPDATE privilege for a member at all; those are refused by privilege there).
const writes: Write[] = [
  { name: "note: update", kind: "content", users: true, run: (db, r) => db.from("clinical_notes").update({ clinical_notes: "Rewritten note" }).eq("visit_id", r.visitId) },
  { name: "diagnosis: insert", kind: "content", users: true, run: (db, r) => db.from("consultation_diagnoses").insert({ tenant_id: r.tenantId, visit_id: r.visitId, patient_id: r.patientId, diagnosis_name: "Added diagnosis" }) },
  { name: "diagnosis: update", kind: "content", users: true, run: (db, r) => db.from("consultation_diagnoses").update({ diagnosis_name: "Rewritten diagnosis" }).eq("id", r.diagnosisId) },
  { name: "item: insert", kind: "content", users: true, run: (db, r) => db.from("prescription_items").insert({ tenant_id: r.tenantId, prescription_id: r.rxId, medicine_name: "Added medicine", dosage: "1-0-1", duration: "3 days" }) },
  { name: "item: update", kind: "content", users: true, run: (db, r) => db.from("prescription_items").update({ dosage: "9-9-9" }).eq("id", r.itemId) },
  { name: "follow-up: insert", kind: "content", users: true, run: (db, r) => db.from("follow_ups").insert({ tenant_id: r.tenantId, patient_id: r.patientId, visit_id: r.visitId, doctor_id: doctor.userId, follow_up_date: "2031-04-01" }) },
  { name: "follow-up: update", kind: "content", users: true, run: (db, r) => db.from("follow_ups").update({ follow_up_date: "2032-01-01" }).eq("id", r.followUpId) },
  { name: "item: delete", kind: "content", users: true, run: (db, r) => db.from("prescription_items").delete().eq("id", r.itemId) },
  { name: "diagnosis: delete", kind: "content", users: true, run: (db, r) => db.from("consultation_diagnoses").delete().eq("id", r.diagnosisId) },
  { name: "follow-up: delete", kind: "content", users: true, run: (db, r) => db.from("follow_ups").delete().eq("id", r.followUpId) },
  { name: "note: delete", kind: "content", users: false, run: (db, r) => db.from("clinical_notes").delete().eq("visit_id", r.visitId) },
  { name: "header: version", kind: "seal", users: true, run: (db, r) => db.from("prescriptions").update({ version: 5 }).eq("id", r.rxId) },
  { name: "header: status", kind: "seal", users: true, run: (db, r) => db.from("prescriptions").update({ status: "amended" }).eq("id", r.rxId) },
  { name: "header: signed_at", kind: "seal", users: true, run: (db, r) => db.from("prescriptions").update({ signed_at: null }).eq("id", r.rxId) },
  { name: "header: amendment_reason", kind: "seal", users: true, run: (db, r) => db.from("prescriptions").update({ amendment_reason: "Rewritten reason" }).eq("id", r.rxId) },
  { name: "header: delete", kind: "seal", users: true, run: (db, r) => db.from("prescriptions").delete().eq("id", r.rxId) },
  { name: "header: insert version 2", kind: "seal", users: true, run: (db, r) => db.from("prescriptions").insert({ tenant_id: r.tenantId, visit_id: r.visitId, patient_id: r.patientId, doctor_id: doctor.userId, version: 2 }) },
  { name: "visit: status cancelled", kind: "seal", users: true, run: (db, r) => db.from("visits").update({ status: "cancelled" }).eq("id", r.visitId) },
  { name: "visit: signed_at null", kind: "seal", users: true, run: (db, r) => db.from("visits").update({ signed_at: null }).eq("id", r.visitId) },
  { name: "visit: signed_by", kind: "seal", users: true, run: (db, r) => db.from("visits").update({ signed_by: owner.userId }).eq("id", r.visitId) },
  { name: "visit: reason_for_visit", kind: "seal", users: true, run: (db, r) => db.from("visits").update({ reason_for_visit: "Rewritten reason" }).eq("id", r.visitId) },
  { name: "visit: delete", kind: "seal", users: true, run: (db, r) => db.from("visits").delete().eq("id", r.visitId) },
];

const actors: [string, boolean][] = [
  ["owner", true],
  ["doctor", true],
  ["service role", false],
];

// What an amending visit still refuses: the visit's signature, status and delete for everyone; for a member also the columns only a command
// writes (privilege) and a second header version. The service role may still write an open visit's header (the v1 API, the commands).
const visitRefusals = ["visit: status cancelled", "visit: signed_at null", "visit: signed_by", "visit: delete"];
const memberRefusals = [...visitRefusals, "visit: reason_for_visit", "header: version", "header: status", "header: signed_at", "header: amendment_reason", "header: delete", "header: insert version 2"];

describe("AC-6, database legs: a signed record cannot be rewritten, by anyone", () => {
  for (const [who, isUser] of actors) {
    const clientOf = (): TestDb => (who === "owner" ? owner.client : who === "doctor" ? doctor.client : admin);

    it(`SEALED, as the ${who}: every write is refused with 42501 and the rows are re-read unchanged`, async () => {
      const r = await record("sealed");
      const before = await snapshot(r);
      for (const w of writes.filter((x) => !isUser || x.users)) {
        const { error } = await w.run(clientOf(), r);
        expect(error?.code, `${who}: ${w.name}`).toBe("42501");
      }
      expect(await snapshot(r)).toEqual(before);
    });

    it(`DRAFT, as the ${who}: the content writes succeed (control: the refusals are the seal, not a broken fixture)`, async () => {
      const r = await record("draft");
      for (const w of writes.filter((x) => x.kind === "content" && (!isUser || x.users))) {
        const { error } = await w.run(clientOf(), r);
        expect(error, `${who}: ${w.name}`).toBeNull();
      }
    });

    it(`AMENDING, as the ${who}: the content writes succeed; signature, status and delete of the visit stay refused${isUser ? ", and so do the commands' columns" : ""}`, async () => {
      const r = await record("amending");
      const before = await snapshot(r);
      const names = isUser ? memberRefusals : visitRefusals;
      for (const w of writes.filter((x) => names.includes(x.name))) {
        const { error } = await w.run(clientOf(), r);
        expect(error?.code, `${who}: ${w.name}`).toBe("42501");
      }
      expect(await snapshot(r)).toEqual(before);
      for (const w of writes.filter((x) => x.kind === "content" && (!isUser || x.users))) {
        const { error } = await w.run(clientOf(), r);
        expect(error, `${who}: ${w.name}`).toBeNull();
      }
    });
  }
});
