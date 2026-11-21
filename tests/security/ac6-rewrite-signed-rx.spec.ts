/**
 * THREAT_MODEL AC-6 (rewrite a signed prescription and its record), database legs (V2-09a 09A-02) and storage legs (09A-03).
 *
 * On a SIGNED visit, as the clinic owner and as the doctor (their own JWT clients, PostgREST) and as the service role (the v1 API's client):
 * UPDATE, DELETE and INSERT on the Rx items, the Rx header (version, status, signed_at, amendment_reason), the clinical note, diagnoses and
 * follow-ups, and the visit itself (status, signature, signer, specialty, reason for the visit). Every write is refused with SQLSTATE 42501
 * and the rows are re-read unchanged. The same writes succeed on a DRAFT visit and (content only) on an AMENDING one, so a refusal is the
 * seal and not a broken fixture.
 *
 * Storage legs (000109): the signed version's archived PDF cannot be overwritten (upsert, update), deleted or replaced by a member, not on a sealed visit and
 * not while it is being amended; no PDF can be planted for a draft or an amending visit; the service role cannot move or rewrite the recorded path and hash
 * (RX_PDF_WRITE_ONCE). Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import type { TestDb } from "../helpers/db";
import { reopenVisitAs, seedClinicalVisit, signVisitAs } from "../helpers/clinical-commands";
import { ctxFor } from "../helpers/context";
import { completeAndSignConsultation } from "@/features/consultation/service";
import { randomUUID } from "node:crypto";

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

/** `command`: since 000112 a member no longer writes this row directly (the privilege is gone: 42501 in every state); `save_consultation_draft` is the writer. */
type Write = { name: string; kind: "content" | "seal"; users: boolean; command?: boolean; run: (db: TestDb, r: Rec) => PromiseLike<{ error: { code?: string; message?: string } | null }> };

// 000112 (one follow-up per visit): the follow-up writes run update, delete, insert, so the insert finds the visit free.
// `users`: also attempted through a member's JWT (some columns carry no UPDATE privilege for a member at all; those are refused by privilege there).
const writes: Write[] = [
  { name: "note: update", kind: "content", users: true, command: true, run: (db, r) => db.from("clinical_notes").update({ clinical_notes: "Rewritten note" }).eq("visit_id", r.visitId) },
  { name: "diagnosis: insert", kind: "content", users: true, run: (db, r) => db.from("consultation_diagnoses").insert({ tenant_id: r.tenantId, visit_id: r.visitId, patient_id: r.patientId, diagnosis_name: "Added diagnosis" }) },
  { name: "diagnosis: update", kind: "content", users: true, run: (db, r) => db.from("consultation_diagnoses").update({ diagnosis_name: "Rewritten diagnosis" }).eq("id", r.diagnosisId) },
  { name: "item: insert", kind: "content", users: true, run: (db, r) => db.from("prescription_items").insert({ tenant_id: r.tenantId, prescription_id: r.rxId, medicine_name: "Added medicine", dosage: "1-0-1", duration: "3 days" }) },
  { name: "item: update", kind: "content", users: true, run: (db, r) => db.from("prescription_items").update({ dosage: "9-9-9" }).eq("id", r.itemId) },
  { name: "follow-up: update", kind: "content", users: true, command: true, run: (db, r) => db.from("follow_ups").update({ follow_up_date: "2032-01-01" }).eq("visit_id", r.visitId) },
  { name: "follow-up: delete", kind: "content", users: true, command: true, run: (db, r) => db.from("follow_ups").delete().eq("visit_id", r.visitId) },
  { name: "follow-up: insert", kind: "content", users: true, command: true, run: (db, r) => db.from("follow_ups").insert({ tenant_id: r.tenantId, patient_id: r.patientId, visit_id: r.visitId, doctor_id: doctor.userId, follow_up_date: "2031-04-01" }) },
  { name: "item: delete", kind: "content", users: true, run: (db, r) => db.from("prescription_items").delete().eq("id", r.itemId) },
  { name: "diagnosis: delete", kind: "content", users: true, run: (db, r) => db.from("consultation_diagnoses").delete().eq("id", r.diagnosisId) },
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
        if (isUser && w.command) expect(error?.code, `${who}: ${w.name} (the privilege is gone since 000112)`).toBe("42501");
        else expect(error, `${who}: ${w.name}`).toBeNull();
      }
      if (isUser) await expectCommandWrites(clientOf(), r, true);
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
        if (isUser && w.command) expect(error?.code, `${who}: ${w.name} (the privilege is gone since 000112)`).toBe("42501");
        else expect(error, `${who}: ${w.name}`).toBeNull();
      }
      if (isUser) await expectCommandWrites(clientOf(), r, true);
    });

    if (isUser) {
      it(`SEALED, as the ${who}: the draft command is refused too (DRAFT_LOCKED) and the note and the follow-up are re-read unchanged`, async () => {
        const r = await record("sealed");
        const before = await snapshot(r);
        await expectCommandWrites(clientOf(), r, false);
        expect(await snapshot(r)).toEqual(before);
      });
    }
  }
});

/** The member's writer for the note and the follow-up (000112): admitted on a draft or amending record, DRAFT_LOCKED on a sealed one. */
async function expectCommandWrites(db: TestDb, r: Rec, admitted: boolean) {
  const { data: row, error: readErr } = await admin.from("clinical_notes").select("draft_version").eq("visit_id", r.visitId).single();
  if (readErr || !row) throw new Error(`draft_version read failed: ${readErr?.message}`);
  const { error } = await db.rpc("save_consultation_draft", {
    p_tenant_id: r.tenantId,
    p_visit_id: r.visitId,
    p_expected_version: row.draft_version,
    p_patch: { clinical_notes: "Rewritten note", follow_up: { follow_up_date: "2032-01-01" } },
    p_client_request_id: randomUUID(),
  });
  if (admitted) {
    expect(error).toBeNull();
    const { data } = await admin.from("follow_ups").select("follow_up_date").eq("visit_id", r.visitId);
    expect(data).toEqual([{ follow_up_date: "2032-01-01" }]);
  } else {
    expect(error).toMatchObject({ code: "P0001", message: "DRAFT_LOCKED" });
  }
}

// Storage legs --------------------------------------------------------------------------------------------------------------------------
const FORGED = Buffer.from("%PDF-1.4 forged replacement");

async function archivedRecord() {
  const v = await seedClinicalVisit(owner, { doctorId: doctor.userId, prescriptions: 1, notes: "Synthetic signed note." });
  const { error } = await admin.from("prescription_items").insert({
    tenant_id: owner.tenantId,
    prescription_id: v.prescriptionIds[0],
    medicine_name: "Synthetic medicine",
    dosage: "1-0-1",
    duration: "5 days",
  });
  if (error) throw new Error(`item seed failed: ${error.message}`);
  const signed = await completeAndSignConsultation(ctxFor(doctor), v.visitId, randomUUID());
  if (!signed.success) throw new Error("sign-off failed");
  const key = `${owner.tenantId}/${v.visitId}/rx_v1.pdf`;
  const { data: rx, error: rxErr } = await admin.from("prescriptions").select("pdf_storage_path, pdf_sha256").eq("id", v.prescriptionIds[0]).single();
  if (rxErr || !rx?.pdf_sha256) throw new Error("the archive did not run");
  return { ...v, key, rx };
}

async function bytesOf(key: string) {
  const { data } = await admin.storage.from("prescriptions").download(key);
  return data ? Buffer.from(await data.arrayBuffer()) : null;
}

describe("AC-6, storage legs: the signed version's PDF cannot be rewritten, deleted or planted", () => {
  for (const who of ["owner", "doctor"] as const) {
    const client = () => (who === "owner" ? owner.client : doctor.client);

    it(`SEALED, as the ${who}: upsert, update and remove of the archived PDF fail and the bytes and the hash are unchanged`, async () => {
      const r = await archivedRecord();
      const before = await bytesOf(r.key);
      const storage = client().storage.from("prescriptions");
      expect((await storage.upload(r.key, FORGED, { contentType: "application/pdf", upsert: true })).error).not.toBeNull();
      expect((await storage.update(r.key, FORGED, { contentType: "application/pdf" })).error).not.toBeNull();
      expect((await storage.remove([r.key])).data ?? []).toHaveLength(0);
      expect((await bytesOf(r.key))!.equals(before!)).toBe(true);
      const { data } = await admin.from("prescriptions").select("pdf_storage_path, pdf_sha256").eq("id", r.prescriptionIds[0]).single();
      expect(data).toEqual(r.rx);
    }, 60_000);

    it(`AMENDING, as the ${who}: the signed version's object stays read-only while the amendment is open, and nothing can be planted at the next version`, async () => {
      const r = await archivedRecord();
      const before = await bytesOf(r.key);
      await reopenVisitAs(doctor, r.visitId);
      const storage = client().storage.from("prescriptions");
      expect((await storage.upload(r.key, FORGED, { contentType: "application/pdf", upsert: true })).error).not.toBeNull();
      expect((await storage.remove([r.key])).data ?? []).toHaveLength(0);
      expect((await storage.upload(`${owner.tenantId}/${r.visitId}/rx_v2.pdf`, FORGED, { contentType: "application/pdf" })).error).not.toBeNull();
      expect((await bytesOf(r.key))!.equals(before!)).toBe(true);
      expect(await bytesOf(`${owner.tenantId}/${r.visitId}/rx_v2.pdf`)).toBeNull();
    }, 60_000);

    it(`DRAFT, as the ${who}: no PDF can be uploaded under the final key of a draft visit`, async () => {
      const v = await seedClinicalVisit(owner, { doctorId: doctor.userId, prescriptions: 1 });
      const key = `${owner.tenantId}/${v.visitId}/rx_v1.pdf`;
      expect((await client().storage.from("prescriptions").upload(key, FORGED, { contentType: "application/pdf" })).error).not.toBeNull();
      expect(await bytesOf(key)).toBeNull();
    }, 60_000);
  }

  it("SEALED, as the service role: the recorded path and hash cannot be moved, changed or cleared (RX_PDF_WRITE_ONCE); the row is re-read unchanged", async () => {
    const r = await archivedRecord();
    for (const patch of [
      { pdf_sha256: "f".repeat(64) },
      { pdf_storage_path: `${owner.tenantId}/${r.visitId}/rx_v2.pdf`, pdf_sha256: "f".repeat(64) },
      { pdf_storage_path: null, pdf_sha256: null },
    ]) {
      const { error } = await admin.from("prescriptions").update(patch).eq("id", r.prescriptionIds[0]);
      expect(error?.code, JSON.stringify(Object.keys(patch))).toBe("42501");
    }
    const { data } = await admin.from("prescriptions").select("pdf_storage_path, pdf_sha256").eq("id", r.prescriptionIds[0]).single();
    expect(data).toEqual(r.rx);
  }, 60_000);
});
