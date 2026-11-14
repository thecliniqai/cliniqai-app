/**
 * Storage policies through the real Storage API with real JWTs (V2-05 05-02c; R-23, R-42, R-45; threats T-05-15,
 * T-05-16, T-05-39). The generated pgTAP matrix proves the policies with simulated claims; this spec proves the same
 * cells end to end: the user's own supabase-js client (Storage API, `x-clinicos-tenant` header like the app's
 * `createClient()`) against objects of every artefact class of the two app buckets.
 *
 * Expectations come from the single source (`tests/authz/table-matrix.ts` through `expectedOutcome`), so the real
 * Storage API and the matrix cannot drift apart: per class x role x operation (download = SELECT, upload of a new key =
 * INSERT, update in place = UPDATE, remove = DELETE) for owner, admin, doctor, nurse and receptionist of clinic A,
 * clinic B's owner, and a member of both clinics (doctor in A, receptionist in B) acting in A, in B, and with no active
 * clinic. Plus: the doctor's own Sign & Bill receipt archive (the real `compileAndArchiveReceiptPdf` path, 05-02b
 * handover b) and malformed keys denied without a database error (BACKEND C9). Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { TestDb } from "../helpers/db";
import { insertReturningId } from "../helpers/db";
import { getAdminClient } from "../helpers/supabase-admin";
import { addMemberToTenant, createDualMembershipUser, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { signInActingIn } from "../helpers/active-tenant";
import { ctxFor } from "../helpers/context";
import { PRINCIPALS, TARGETS, targetName, type Op, type StorageTarget } from "../authz/table-matrix";
import { expectedOutcome } from "../../scripts/gen-authz-pgtap";
import { compileAndArchiveReceiptPdf } from "@/features/billing/pdf/generator";

const admin = getAdminClient();
const PDF = Buffer.from("%PDF-1.4 synthetic storage policy probe");

let A: SeededTenant;
let B: SeededTenant;
const members = {} as Record<"owner_a" | "admin_a" | "doctor_a" | "nurse_a" | "receptionist_a" | "owner_b", SeededTenant>;
const actors = new Map<string, TestDb>();
let visitId: string;
let invoiceId: string;
let patientId: string;

/** The keys of one class: the fixture object (SELECT/UPDATE/DELETE) and a new key of the same class (INSERT). */
interface ClassKeys {
  bucket: string;
  object: string;
  insert: () => string;
}
let classes: Record<string, ClassKeys>;

function target(name: string): StorageTarget {
  const t = TARGETS.find((x) => targetName(x) === name);
  if (!t || t.kind !== "storage") throw new Error(`no storage target ${name}`);
  return t;
}

const expected = (name: string, op: Op, principalId: string) => {
  const p = PRINCIPALS.find((x) => x.id === principalId);
  if (!p) throw new Error(`no principal ${principalId}`);
  const o = expectedOutcome(target(name), op, p);
  return o === "1" || o === "ok";
};

async function exists(bucket: string, key: string): Promise<boolean> {
  const { data } = await admin.storage.from(bucket).download(key);
  return data !== null;
}

async function seedObject(bucket: string, key: string) {
  const { error } = await admin.storage.from(bucket).upload(key, PDF, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`seeding ${bucket}/${key} failed: ${error.message}`);
}

/** Runs one operation as the client; true when the Storage API admitted it (and it took effect). */
async function attempt(db: TestDb, keys: ClassKeys, op: Op): Promise<boolean> {
  const storage = db.storage.from(keys.bucket);
  switch (op) {
    case "select": {
      const { data, error } = await storage.download(keys.object);
      return error === null && data !== null;
    }
    case "insert": {
      const key = keys.insert();
      const { error } = await storage.upload(key, PDF, { contentType: "application/pdf", upsert: false });
      const created = await exists(keys.bucket, key);
      if (created) await admin.storage.from(keys.bucket).remove([key]);
      return error === null && created;
    }
    case "update": {
      const { error } = await storage.update(keys.object, PDF, { contentType: "application/pdf" });
      return error === null;
    }
    case "delete": {
      const { data, error } = await storage.remove([keys.object]);
      const gone = !(await exists(keys.bucket, keys.object));
      if (gone) await seedObject(keys.bucket, keys.object);
      return error === null && (data ?? []).length === 1 && gone;
    }
  }
}

beforeAll(async () => {
  A = await seedTenantWithOwner("Storage Policy Clinic A");
  B = await seedTenantWithOwner("Storage Policy Clinic B");
  members.owner_a = A;
  for (const role of ["admin", "doctor", "nurse", "receptionist"] as const) {
    members[`${role}_a`] = await addMemberToTenant(A.tenantId, role);
  }
  members.owner_b = B;
  for (const [id, m] of Object.entries(members)) actors.set(id, m.client);
  const dual = await createDualMembershipUser(A.tenantId, "doctor", B.tenantId, "receptionist");
  actors.set("dual_hdr_a", await signInActingIn(dual.userEmail, A.tenantId));
  actors.set("dual_hdr_b", await signInActingIn(dual.userEmail, B.tenantId));
  actors.set("dual_no_hdr", await signInActingIn(dual.userEmail, null));

  patientId = await insertReturningId(admin, "patients", {
    tenant_id: A.tenantId,
    full_name: "Synthetic Storagepatient",
    phone: "+919000000801",
    created_by: A.userId,
  });
  visitId = await insertReturningId(admin, "visits", {
    tenant_id: A.tenantId,
    patient_id: patientId,
    doctor_id: members.doctor_a.userId,
    origin_type: "walk_in",
    created_by: A.userId,
  });
  invoiceId = await insertReturningId(admin, "invoices", {
    tenant_id: A.tenantId,
    visit_id: visitId,
    patient_id: patientId,
    invoice_number: `SP-${randomUUID().slice(0, 8)}`,
    total_amount: 300,
    status: "issued",
  });

  const t = A.tenantId;
  classes = {
    "storage:prescriptions/rx": {
      bucket: "prescriptions",
      object: `${t}/${visitId}/rx_v1.pdf`,
      insert: () => `${t}/${visitId}/rx_v${Math.floor(Math.random() * 1e6) + 2}.pdf`,
    },
    // The INSERT key names an invoice that does not exist (as the matrix cell): only collectors may write it.
    "storage:prescriptions/receipt": {
      bucket: "prescriptions",
      object: `${t}/receipts/inv_${invoiceId}.pdf`,
      insert: () => `${t}/receipts/inv_${randomUUID()}.pdf`,
    },
    "storage:clinic-records/lab": {
      bucket: "clinic-records",
      object: `tenants/${t}/patients/${patientId}/labs/${randomUUID()}.pdf`,
      insert: () => `tenants/${t}/patients/${patientId}/labs/${randomUUID()}.pdf`,
    },
    "storage:clinic-records/referral_letter": {
      bucket: "clinic-records",
      object: `tenants/${t}/referrals/${randomUUID()}/referral_letter.pdf`,
      insert: () => `tenants/${t}/referrals/${randomUUID()}/referral_letter.pdf`,
    },
  };
  for (const keys of Object.values(classes)) await seedObject(keys.bucket, keys.object);
}, 120_000);

const PRINCIPAL_IDS = [
  "owner_a",
  "admin_a",
  "doctor_a",
  "nurse_a",
  "receptionist_a",
  "owner_b",
  "dual_hdr_a",
  "dual_hdr_b",
  "dual_no_hdr",
] as const;
const CLASS_NAMES = [
  "storage:prescriptions/rx",
  "storage:prescriptions/receipt",
  "storage:clinic-records/lab",
  "storage:clinic-records/referral_letter",
] as const;
const OPS: readonly Op[] = ["select", "insert", "update", "delete"];

describe("storage classes x principals x operations through the Storage API (matrix expectations)", () => {
  it.each(CLASS_NAMES)("%s", async (name) => {
    const outcomes: string[] = [];
    const wanted: string[] = [];
    for (const principalId of PRINCIPAL_IDS) {
      const db = actors.get(principalId)!;
      for (const op of OPS) {
        outcomes.push(`${principalId} ${op} ${(await attempt(db, classes[name], op)) ? "allowed" : "refused"}`);
        wanted.push(`${principalId} ${op} ${expected(name, op, principalId) ? "allowed" : "refused"}`);
      }
    }
    expect(outcomes).toEqual(wanted);
  }, 120_000);

  it("the plan's key cells: receptionist reads a receipt but no Rx PDF or lab report; B's owner reads nothing of A", async () => {
    const reception = actors.get("receptionist_a")!;
    expect(await attempt(reception, classes["storage:prescriptions/receipt"], "select")).toBe(true);
    expect(await attempt(reception, classes["storage:prescriptions/rx"], "select")).toBe(false);
    expect(await attempt(reception, classes["storage:clinic-records/lab"], "select")).toBe(false);
    for (const name of CLASS_NAMES) expect(await attempt(actors.get("owner_b")!, classes[name], "select"), name).toBe(false);
    // The dual member: a doctor of A reads A's Rx PDF only while acting in A.
    expect(await attempt(actors.get("dual_hdr_a")!, classes["storage:prescriptions/rx"], "select")).toBe(true);
    expect(await attempt(actors.get("dual_hdr_b")!, classes["storage:prescriptions/rx"], "select")).toBe(false);
    expect(await attempt(actors.get("dual_no_hdr")!, classes["storage:prescriptions/rx"], "select")).toBe(false);
  }, 60_000);
});

describe("the doctor's Sign & Bill receipt archive (05-02b handover b)", () => {
  it("archives the receipt of the doctor's own visit through the real generator, and signs a URL for it", async () => {
    const ownInvoice = await insertReturningId(admin, "invoices", {
      tenant_id: A.tenantId,
      visit_id: await insertReturningId(admin, "visits", {
        tenant_id: A.tenantId,
        patient_id: patientId,
        doctor_id: members.doctor_a.userId,
        origin_type: "walk_in",
        created_by: A.userId,
      }),
      patient_id: patientId,
      invoice_number: `SP-${randomUUID().slice(0, 8)}`,
      subtotal: 300,
      total_amount: 300,
      status: "issued",
    });
    const result = await compileAndArchiveReceiptPdf(ctxFor(members.doctor_a), ownInvoice);
    if (!result) throw new Error("the doctor could not read their own visit's invoice");
    const key = `${A.tenantId}/receipts/inv_${ownInvoice}.pdf`;
    expect(result.storagePath).toBe(key);
    expect(await exists("prescriptions", key)).toBe(true);
    // A real signed Storage URL, not the generator's fallback route (which it returns when signing fails).
    expect(result.signedUrl).toMatch(/^https?:\/\/[^/]+\/storage\/v1\/object\/sign\/prescriptions\//);
  }, 60_000);

  it("refuses a second doctor's archive of a colleague's visit receipt", async () => {
    const key = `${A.tenantId}/receipts/inv_${invoiceId}.pdf`;
    const doctor2 = await addMemberToTenant(A.tenantId, "doctor");
    const { error } = await doctor2.client.storage.from("prescriptions").upload(key, PDF, { upsert: true });
    expect(error).not.toBeNull();
    const { data } = await doctor2.client.storage.from("prescriptions").download(key);
    expect(data).toBeNull();
  }, 60_000);
});

describe("malformed keys and unknown classes (BACKEND C9, T-05-15)", () => {
  it("are denied without a database error, for members and non-members alike", async () => {
    // Keys outside every clinic prefix: removed here (the run teardown finds objects by clinic).
    const malformedRecord = `tenants/not-a-uuid/patients/${randomUUID()}/labs/x.pdf`;
    await seedObject("prescriptions", "not-a-uuid/x.pdf");
    await seedObject("clinic-records", malformedRecord);
    for (const db of [members.owner_a.client, members.owner_b.client]) {
      const read = await db.storage.from("prescriptions").download("not-a-uuid/x.pdf");
      expect(read.data).toBeNull();
      expect(String(read.error?.message ?? "")).not.toMatch(/invalid input syntax|uuid/i);
      const write = await db.storage.from("prescriptions").upload(`not-a-uuid/${randomUUID()}.pdf`, PDF);
      expect(write.error).not.toBeNull();
      expect(String(write.error?.message ?? "")).not.toMatch(/invalid input syntax|uuid/i);
      const record = await db.storage.from("clinic-records").download(malformedRecord);
      expect(record.data).toBeNull();
      expect(String(record.error?.message ?? "")).not.toMatch(/invalid input syntax|uuid/i);
    }
    const unknown = await members.owner_a.client.storage
      .from("prescriptions")
      .upload(`${A.tenantId}/${visitId}/notes.txt`, PDF);
    expect(unknown.error).not.toBeNull();
    await admin.storage.from("prescriptions").remove(["not-a-uuid/x.pdf"]);
    await admin.storage.from("clinic-records").remove([malformedRecord]);
  }, 60_000);
});
