/**
 * V2-09a 09A-04 (R-13 lab part, R-14; migration 000110): lab documents are append-only. No member deletes a lab document row or its stored file, no member
 * overwrites the file, the service role's own DELETE is refused by the trigger, and a whole clinic's purge still cascades. A normal upload still works.
 * Real PostgREST and Storage calls with each role's own JWT; the service role is the v1 API's client. Synthetic data only.
 *
 * "A wrong-patient upload cannot be removed by anyone until V2-11's void exists" is the product consequence the PO is told about (plan Q-5, T-09A-11).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";
import { insertReturningId } from "../helpers/db";
import { getDocumentSignedUrl, uploadLabDocument } from "@/features/labs/service";

const admin = getAdminClient();
const BUCKET = "clinic-records";
const FORGED = Buffer.from("%PDF-1.4 forged replacement");
let owner: SeededTenant;
let doctor: SeededTenant;
let nurse: SeededTenant;
let receptionist: SeededTenant;
let patientId: string;

beforeAll(async () => {
  owner = await seedTenantWithOwner("Synthetic Lab Append-only Clinic");
  doctor = await addMemberToTenant(owner.tenantId, "doctor");
  nurse = await addMemberToTenant(owner.tenantId, "nurse");
  receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
  patientId = await insertReturningId(admin, "patients", {
    tenant_id: owner.tenantId,
    full_name: "Synthetic Append Patient",
    phone: "+919000000901",
    created_by: owner.userId,
  });
}, 60_000);

/** A document uploaded the way the app does it, by `actor`. */
async function uploaded(actor: SeededTenant, title = "Synthetic report") {
  const form = new FormData();
  form.set("file", new File([Buffer.from("%PDF-1.4 synthetic lab report")], "report.pdf", { type: "application/pdf" }));
  form.set("patient_id", patientId);
  form.set("title", title);
  form.set("document_type", "lab_report");
  form.set("report_date", "2026-10-22");
  form.set("is_abnormal", "false");
  form.set("notes", "Synthetic note");
  const res = await uploadLabDocument(ctxFor(actor), form);
  if (!res.success) throw new Error(`upload failed: ${res.error}`);
  return { id: res.document.id, path: res.document.storage_path };
}

async function objectBytes(path: string): Promise<Buffer | null> {
  const { data } = await admin.storage.from(BUCKET).download(path);
  return data ? Buffer.from(await data.arrayBuffer()) : null;
}

describe("a normal upload still works", () => {
  it("a doctor and a nurse (labs:edit) upload a lab report; the row and the object exist and a view link is signed", async () => {
    for (const actor of [doctor, nurse]) {
      const doc = await uploaded(actor);
      const { data: row } = await admin.from("patient_documents").select("id, storage_path").eq("id", doc.id).single();
      expect(row?.storage_path).toBe(doc.path);
      expect(await objectBytes(doc.path)).not.toBeNull();
      const link = await getDocumentSignedUrl(ctxFor(actor), doc.id);
      expect(link.success).toBe(true);
    }
  });
});

describe("no member deletes a lab document row", () => {
  it.each([
    ["owner", () => owner],
    ["doctor", () => doctor],
    ["nurse", () => nurse],
    ["receptionist", () => receptionist],
  ] as const)("the %s's DELETE is refused by privilege and the row stays", async (_who, actor) => {
    const doc = await uploaded(doctor);
    const res = await actor().client.from("patient_documents").delete().eq("id", doc.id).select("id");
    expect(res.error?.code).toBe("42501");
    expect(res.data).toBeNull();
    const { data } = await admin.from("patient_documents").select("id").eq("id", doc.id);
    expect(data).toHaveLength(1);
  });

  it("another clinic's owner cannot delete it either", async () => {
    const other = await seedTenantWithOwner("Synthetic Lab Other Clinic");
    const doc = await uploaded(doctor);
    const res = await other.client.from("patient_documents").delete().eq("id", doc.id).select("id");
    expect(res.error?.code).toBe("42501");
    expect((await admin.from("patient_documents").select("id").eq("id", doc.id)).data).toHaveLength(1);
  });
});

describe("no member removes or overwrites a lab object", () => {
  it.each([
    ["owner", () => owner],
    ["doctor", () => doctor],
    ["nurse", () => nurse],
  ] as const)("the %s's remove, upsert and update of an uploaded object fail and the bytes are unchanged", async (_who, actor) => {
    const doc = await uploaded(doctor);
    const before = await objectBytes(doc.path);
    const storage = actor().client.storage.from(BUCKET);

    expect((await storage.remove([doc.path])).data ?? []).toHaveLength(0);
    expect((await storage.upload(doc.path, FORGED, { contentType: "application/pdf", upsert: true })).error).not.toBeNull();
    expect((await storage.upload(doc.path, FORGED, { contentType: "application/pdf", upsert: false })).error).not.toBeNull();
    expect((await storage.update(doc.path, FORGED, { contentType: "application/pdf" })).error).not.toBeNull();
    expect((await objectBytes(doc.path))!.equals(before!)).toBe(true);
  }, 60_000);
});

describe("the service role and the purge", () => {
  it("a direct DELETE by the service role is refused by the trigger (LAB_DOCUMENT_DELETE_FORBIDDEN) and the row stays", async () => {
    const doc = await uploaded(doctor);
    const res = await admin.from("patient_documents").delete().eq("id", doc.id);
    expect(res.error?.code).toBe("42501");
    expect(res.error?.message).toBe("LAB_DOCUMENT_DELETE_FORBIDDEN");
    expect((await admin.from("patient_documents").select("id").eq("id", doc.id)).data).toHaveLength(1);
  });

  it("deleting a whole clinic as the service role cascades through its lab documents (R-4a)", async () => {
    const clinic = await seedTenantWithOwner("Synthetic Lab Purge Clinic");
    const purgePatient = await insertReturningId(admin, "patients", {
      tenant_id: clinic.tenantId,
      full_name: "Synthetic Purge Patient",
      phone: "+919000000902",
      created_by: clinic.userId,
    });
    const docId = await insertReturningId(admin, "patient_documents", {
      tenant_id: clinic.tenantId,
      patient_id: purgePatient,
      title: "Synthetic purge report",
      original_filename: "purge.pdf",
      storage_path: `tenants/${clinic.tenantId}/patients/${purgePatient}/labs/${randomUUID()}.pdf`,
      file_size_bytes: 12,
      mime_type: "application/pdf",
      report_date: "2026-10-22",
      uploaded_by: clinic.userId,
    });
    expect((await admin.from("patient_documents").select("id").eq("id", docId)).data).toHaveLength(1);
    const purge = await admin.from("tenants").delete().eq("id", clinic.tenantId);
    expect(purge.error).toBeNull();
    expect((await admin.from("patient_documents").select("id").eq("id", docId)).data).toHaveLength(0);
  }, 60_000);
});
