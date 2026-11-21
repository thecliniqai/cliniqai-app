/**
 * V2-09a 09A-03 (R-12, R-13 Rx part; migration 000109): the prescription PDF is archived once per signed version, hashed, never overwritten or deleted,
 * and read back against its hash. Local Supabase Storage with real rows and real JWTs: the doctor's own client does every write (storage RLS applies),
 * the service role only simulates corruption. Synthetic data only.
 *
 * Covered: the archive after sign-off (object, `%PDF-`, SHA-256 equals the stored bytes, audit row), a second archive is a no-op, a draft preview and a
 * print variant store nothing, a lost archive is archived once on open (self-heal), a duplicate object with no recorded hash is adopted, a legacy path with
 * no hash gets its hash on the first read, reopen then finalize keeps `rx_v1.pdf` and its hash (snapshot) and archives `rx_v2.pdf` once, overwrite and delete
 * and planting by a member fail, the PDF route serves the archived bytes, and a tampered object is never served (fresh render + audit row).
 */
import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { seedTenantWithOwner, addMemberToTenant, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";
import {
  callFinalize,
  finalizeArgs,
  revisionsOfVisit,
  seedClinicalVisit,
  signVisitAs,
  type ClinicalVisit,
} from "../helpers/clinical-commands";

const mockState = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockState.client,
}));

import { GET as getPrescriptionPdf } from "@/app/api/visits/[id]/prescription-pdf/route";
import {
  archivePrescriptionPdf,
  prescriptionPdfPath,
  renderPrescriptionPdf,
  resolvePrescriptionPdf,
  sha256Hex,
} from "@/features/prescriptions/pdf/generator";
import { loadPrescriptionPdfSource } from "@/features/prescriptions/pdf/payload";
import {
  archiveSealedPrescriptionPdf,
  completeAndSignConsultation,
  finalizeVisitAmendment,
  reopenVisitForAmendment,
} from "@/features/consultation/service";
import { getPrescriptionPdfSignedUrl } from "@/features/prescriptions/service";

const admin = getAdminClient();
const BUCKET = "prescriptions";
let owner: SeededTenant;
let doctor: SeededTenant;

beforeAll(async () => {
  owner = await seedTenantWithOwner("Synthetic Rx Archive Clinic");
  doctor = await addMemberToTenant(owner.tenantId, "doctor");
}, 90_000);

/** A waiting visit of the doctor with a note, one header and one medicine. */
async function seedVisit(): Promise<ClinicalVisit> {
  const visit = await seedClinicalVisit(owner, { doctorId: doctor.userId, prescriptions: 1 });
  const { error } = await admin.from("prescription_items").insert({
    tenant_id: owner.tenantId,
    prescription_id: visit.prescriptionIds[0],
    medicine_name: "Synthetic medicine",
    dosage: "1-0-1",
    duration: "5 days",
  });
  if (error) throw new Error(`seed item failed: ${error.message}`);
  return visit;
}

/** Signed AND archived the way the app does it (the sign-off command, then the archive after the commit). */
async function seedArchived(): Promise<ClinicalVisit> {
  const visit = await seedVisit();
  const res = await completeAndSignConsultation(ctxFor(doctor), visit.visitId, randomUUID());
  expect(res.success).toBe(true);
  return visit;
}

async function header(visitId: string) {
  const { data, error } = await admin
    .from("prescriptions")
    .select("id, version, status, signed_at, updated_at, letterhead_mode, pdf_storage_path, pdf_sha256")
    .eq("visit_id", visitId)
    .order("version", { ascending: false })
    .limit(1)
    .single();
  if (error || !data) throw new Error(`header read failed: ${error?.message}`);
  return data;
}

async function object(path: string): Promise<Buffer | null> {
  const { data } = await admin.storage.from(BUCKET).download(path);
  return data ? Buffer.from(await data.arrayBuffer()) : null;
}

const keyOf = (visitId: string, version = 1) => prescriptionPdfPath(owner.tenantId, visitId, version);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

describe("the archive after sign-off", () => {
  it("stores the PDF at the canonical key, records its SHA-256 (equal to the stored bytes), and audits it", async () => {
    const visit = await seedArchived();
    const h = await header(visit.visitId);
    expect(h.pdf_storage_path).toBe(keyOf(visit.visitId));
    expect(h.pdf_sha256).toMatch(/^[0-9a-f]{64}$/);
    const bytes = await object(keyOf(visit.visitId));
    expect(bytes).not.toBeNull();
    expect(bytes!.subarray(0, 5).toString()).toBe("%PDF-");
    expect(sha(bytes!)).toBe(h.pdf_sha256);
    const { data: audit } = await admin
      .from("audit_logs")
      .select("metadata")
      .eq("entity_id", h.id)
      .eq("action", "prescription.generate_pdf");
    expect(audit).toHaveLength(1);
    expect(audit![0].metadata).toMatchObject({ version: 1, sha256: h.pdf_sha256, storage_path: keyOf(visit.visitId) });
  }, 60_000);

  it("a second archive is a no-op: nothing is rendered, uploaded or rewritten, and the object bytes are unchanged", async () => {
    const visit = await seedArchived();
    const before = await header(visit.visitId);
    const bytesBefore = await object(keyOf(visit.visitId));
    const source = await loadPrescriptionPdfSource(ctxFor(doctor), visit.visitId);
    const again = await archivePrescriptionPdf(ctxFor(doctor), source!.payload);
    expect(again).toMatchObject({ status: "already_archived", sha256: before.pdf_sha256 });
    await archiveSealedPrescriptionPdf(ctxFor(doctor), visit.visitId);
    expect(await header(visit.visitId)).toEqual(before);
    expect((await object(keyOf(visit.visitId)))!.equals(bytesBefore!)).toBe(true);
    const { data: audit } = await admin.from("audit_logs").select("id").eq("entity_id", before.id).eq("action", "prescription.generate_pdf");
    expect(audit).toHaveLength(1);
  }, 60_000);
});

describe("a draft and a print variant are rendered on demand and never stored", () => {
  it("a draft visit: a render, no object, no pair; the preview link is the route's", async () => {
    const visit = await seedVisit();
    const source = await loadPrescriptionPdfSource(ctxFor(doctor), visit.visitId);
    const served = await resolvePrescriptionPdf(ctxFor(doctor), source!);
    expect(served.storagePath).toBeNull();
    expect(served.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(await object(keyOf(visit.visitId))).toBeNull();
    expect(await header(visit.visitId)).toMatchObject({ pdf_storage_path: null, pdf_sha256: null });
    const link = await getPrescriptionPdfSignedUrl(ctxFor(doctor), visit.prescriptionIds[0], "blank_paper");
    expect(link).toEqual({ success: true, signedUrl: `/api/visits/${visit.visitId}/prescription-pdf?letterhead=blank_paper`, version: 1 });
  }, 60_000);

  it("a sealed visit at another letterhead: a render, the archive and the header are untouched", async () => {
    const visit = await seedArchived();
    const before = await header(visit.visitId);
    const bytesBefore = await object(keyOf(visit.visitId));
    const source = await loadPrescriptionPdfSource(ctxFor(doctor), visit.visitId, { letterhead: "preprinted_letterhead" });
    const served = await resolvePrescriptionPdf(ctxFor(doctor), source!);
    expect(served.storagePath).toBeNull();
    expect(served.verified).toBeNull();
    expect(served.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    mockState.client = doctor.client;
    const res = await getPrescriptionPdf(new Request(`http://localhost/x?letterhead=preprinted_letterhead`), { params: Promise.resolve({ id: visit.visitId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(await header(visit.visitId)).toEqual(before);
    expect((await object(keyOf(visit.visitId)))!.equals(bytesBefore!)).toBe(true);
  }, 60_000);
});

describe("self-heal on open", () => {
  it("a sealed Rx whose archive was lost is archived once when it is opened, and served from then on", async () => {
    const visit = await seedVisit();
    await signVisitAs(doctor, visit.visitId); // the command only: the post-commit archive never ran
    expect(await header(visit.visitId)).toMatchObject({ pdf_storage_path: null, pdf_sha256: null });
    expect(await object(keyOf(visit.visitId))).toBeNull();

    mockState.client = doctor.client;
    const call = () => getPrescriptionPdf(new Request("http://localhost/x"), { params: Promise.resolve({ id: visit.visitId }) });
    const first = await call();
    expect(first.status).toBe(200);
    const firstBytes = Buffer.from(await first.arrayBuffer());
    const h = await header(visit.visitId);
    expect(h.pdf_storage_path).toBe(keyOf(visit.visitId));
    expect(h.pdf_sha256).toBe(sha(firstBytes));
    expect(sha((await object(keyOf(visit.visitId)))!)).toBe(h.pdf_sha256);

    const second = await call();
    expect(sha(Buffer.from(await second.arrayBuffer()))).toBe(h.pdf_sha256);
    const { data: audit } = await admin.from("audit_logs").select("id").eq("entity_id", h.id).eq("action", "prescription.generate_pdf");
    expect(audit).toHaveLength(1);
  }, 60_000);

  it("an object that exists with no recorded hash (an archive that stopped after the upload) is adopted: the stored bytes are hashed and recorded, never replaced", async () => {
    const visit = await seedVisit();
    await signVisitAs(doctor, visit.visitId);
    const stored = Buffer.from("%PDF-1.4 stored by an earlier archive that stopped before recording it");
    const { error: upErr } = await doctor.client.storage.from(BUCKET).upload(keyOf(visit.visitId), stored, { contentType: "application/pdf", upsert: false });
    expect(upErr).toBeNull();
    const source = await loadPrescriptionPdfSource(ctxFor(doctor), visit.visitId);
    const result = await archivePrescriptionPdf(ctxFor(doctor), source!.payload);
    expect(result.status).toBe("adopted");
    expect(result.sha256).toBe(sha(stored));
    expect((await object(keyOf(visit.visitId)))!.equals(stored)).toBe(true);
    expect(await header(visit.visitId)).toMatchObject({ pdf_storage_path: keyOf(visit.visitId), pdf_sha256: sha(stored) });
  }, 60_000);

  it("a legacy header (a path, no hash) gets its hash recorded on the first read, from the stored bytes", async () => {
    const visit = await seedVisit();
    await signVisitAs(doctor, visit.visitId);
    const legacy = Buffer.from("%PDF-1.4 legacy archive written before the hash existed");
    const { error: upErr } = await doctor.client.storage.from(BUCKET).upload(keyOf(visit.visitId), legacy, { contentType: "application/pdf", upsert: false });
    expect(upErr).toBeNull();
    const { error: pathErr } = await admin.from("prescriptions").update({ pdf_storage_path: keyOf(visit.visitId) }).eq("id", visit.prescriptionIds[0]);
    expect(pathErr).toBeNull();

    const source = await loadPrescriptionPdfSource(ctxFor(doctor), visit.visitId);
    const served = await resolvePrescriptionPdf(ctxFor(doctor), source!);
    expect(served.buffer.equals(legacy)).toBe(true);
    expect(served.storagePath).toBe(keyOf(visit.visitId));
    expect((await header(visit.visitId)).pdf_sha256).toBe(sha(legacy));
  }, 60_000);
});

describe("reopen and finalize (the signed version is never touched)", () => {
  it("keeps rx_v1.pdf and its hash, snapshots them, clears the pair on the header until rx_v2.pdf is archived, then records its own hash", async () => {
    const visit = await seedArchived();
    const v1 = await header(visit.visitId);
    const v1Bytes = await object(keyOf(visit.visitId, 1));
    expect(v1.pdf_sha256).toBe(sha(v1Bytes!));

    const reopened = await reopenVisitForAmendment(ctxFor(doctor), visit.visitId, "Synthetic reason: dosage corrected after review", randomUUID());
    expect(reopened.success).toBe(true);
    // The amendment: one more medicine, while the visit is open.
    const { error: itemErr } = await admin.from("prescription_items").insert({
      tenant_id: owner.tenantId,
      prescription_id: visit.prescriptionIds[0],
      medicine_name: "Synthetic added medicine",
      dosage: "0-0-1",
      duration: "3 days",
    });
    expect(itemErr).toBeNull();

    // The command alone: the header is version 2 and has no PDF until the archive runs.
    const { data: finalized, error: finErr } = await callFinalize(doctor.client, finalizeArgs(owner, visit.visitId));
    expect(finErr).toBeNull();
    expect(finalized).toMatchObject({ version: 2 });
    expect(await header(visit.visitId)).toMatchObject({ version: 2, pdf_storage_path: null, pdf_sha256: null });
    expect(await object(keyOf(visit.visitId, 2))).toBeNull();

    // The signed version's pair survives in the revision snapshot; the v1 object is intact.
    const [revision] = await revisionsOfVisit(visit.visitId);
    const snap = revision.snapshot as { prescription: { pdf_storage_path: string; pdf_sha256: string; version: number } };
    expect(snap.prescription).toMatchObject({ version: 1, pdf_storage_path: keyOf(visit.visitId, 1), pdf_sha256: v1.pdf_sha256 });
    expect((await object(keyOf(visit.visitId, 1)))!.equals(v1Bytes!)).toBe(true);

    await archiveSealedPrescriptionPdf(ctxFor(doctor), visit.visitId, { version: 2 });
    const v2 = await header(visit.visitId);
    expect(v2.pdf_storage_path).toBe(keyOf(visit.visitId, 2));
    const v2Bytes = await object(keyOf(visit.visitId, 2));
    expect(sha(v2Bytes!)).toBe(v2.pdf_sha256);
    expect(v2.pdf_sha256).not.toBe(v1.pdf_sha256);
    expect((await object(keyOf(visit.visitId, 1)))!.equals(v1Bytes!)).toBe(true);
  }, 90_000);

  it("the service path (reopen, finalize) archives the signed version first and the amended version after", async () => {
    const visit = await seedVisit();
    await signVisitAs(doctor, visit.visitId); // signed, never archived
    expect((await header(visit.visitId)).pdf_sha256).toBeNull();
    expect((await reopenVisitForAmendment(ctxFor(doctor), visit.visitId, "Synthetic reason: instructions clarified", randomUUID())).success).toBe(true);
    // The reopen archived version 1 first, so its pair is in the snapshot.
    const [revision] = await revisionsOfVisit(visit.visitId);
    const snap = revision.snapshot as { prescription: { pdf_storage_path: string | null; pdf_sha256: string | null } };
    expect(snap.prescription.pdf_storage_path).toBe(keyOf(visit.visitId, 1));
    expect(snap.prescription.pdf_sha256).toBe(sha((await object(keyOf(visit.visitId, 1)))!));
    expect((await finalizeVisitAmendment(ctxFor(doctor), visit.visitId, randomUUID())).success).toBe(true);
    const v2 = await header(visit.visitId);
    expect(v2).toMatchObject({ version: 2, pdf_storage_path: keyOf(visit.visitId, 2) });
    expect(sha((await object(keyOf(visit.visitId, 2)))!)).toBe(v2.pdf_sha256);
  }, 90_000);
});

describe("a member cannot overwrite, delete or plant an Rx PDF (storage policies, R-13)", () => {
  it("upsert, update and remove of an archived object fail and leave the bytes and the hash as they were", async () => {
    const visit = await seedArchived();
    const key = keyOf(visit.visitId);
    const before = await object(key);
    const h = await header(visit.visitId);
    const forged = Buffer.from("%PDF-1.4 forged replacement");
    const storage = doctor.client.storage.from(BUCKET);

    const upsert = await storage.upload(key, forged, { contentType: "application/pdf", upsert: true });
    expect(upsert.error).not.toBeNull();
    const plain = await storage.upload(key, forged, { contentType: "application/pdf", upsert: false });
    expect(plain.error).not.toBeNull();
    const update = await storage.update(key, forged, { contentType: "application/pdf" });
    expect(update.error).not.toBeNull();
    const removed = await storage.remove([key]);
    expect(removed.data ?? []).toHaveLength(0);
    // The owner has no more rights than the doctor.
    const ownerRemoved = await owner.client.storage.from(BUCKET).remove([key]);
    expect(ownerRemoved.data ?? []).toHaveLength(0);
    const ownerUpsert = await owner.client.storage.from(BUCKET).upload(key, forged, { contentType: "application/pdf", upsert: true });
    expect(ownerUpsert.error).not.toBeNull();

    expect((await object(key))!.equals(before!)).toBe(true);
    expect(await header(visit.visitId)).toMatchObject({ pdf_storage_path: key, pdf_sha256: h.pdf_sha256 });
  }, 60_000);

  it("a PDF cannot be planted ahead of the seal: not under an unsigned visit's key, not at a version the header does not have, not at a future version", async () => {
    const draft = await seedVisit();
    const sealed = await seedVisit();
    await signVisitAs(doctor, sealed.visitId);
    const forged = Buffer.from("%PDF-1.4 planted");
    const storage = doctor.client.storage.from(BUCKET);

    expect((await storage.upload(keyOf(draft.visitId), forged, { contentType: "application/pdf" })).error).not.toBeNull();
    expect((await storage.upload(keyOf(sealed.visitId, 9), forged, { contentType: "application/pdf" })).error).not.toBeNull();
    expect((await storage.upload(keyOf(sealed.visitId, 2), forged, { contentType: "application/pdf" })).error).not.toBeNull();
    expect(await object(keyOf(draft.visitId))).toBeNull();
    expect(await object(keyOf(sealed.visitId, 9))).toBeNull();
    expect(await object(keyOf(sealed.visitId, 2))).toBeNull();
    // Control: the sealed header's own key is admitted (this is how the archive writes it).
    expect((await storage.upload(keyOf(sealed.visitId, 1), forged, { contentType: "application/pdf" })).error).toBeNull();
  }, 60_000);

  it("another clinic's member cannot plant into this clinic's key", async () => {
    const other = await seedTenantWithOwner("Synthetic Rx Archive Other Clinic");
    const sealed = await seedVisit();
    await signVisitAs(doctor, sealed.visitId);
    const { error } = await other.client.storage.from(BUCKET).upload(keyOf(sealed.visitId, 1), Buffer.from("%PDF-1.4 cross-clinic"), { contentType: "application/pdf" });
    expect(error).not.toBeNull();
    expect(await object(keyOf(sealed.visitId, 1))).toBeNull();
  }, 60_000);
});

describe("serving: the archived bytes, checked against the hash", () => {
  it("the PDF route returns the archived bytes: their SHA-256 equals the stored hash", async () => {
    const visit = await seedArchived();
    mockState.client = doctor.client;
    const res = await getPrescriptionPdf(new Request("http://localhost/x"), { params: Promise.resolve({ id: visit.visitId }) });
    expect(res.status).toBe(200);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(sha(bytes)).toBe((await header(visit.visitId)).pdf_sha256);
    expect(bytes.equals((await object(keyOf(visit.visitId)))!)).toBe(true);
  }, 60_000);

  it("a tampered object (overwritten with the service role) is never served: the route serves a fresh render, audits the failure, and leaves the pair alone", async () => {
    const visit = await seedArchived();
    const key = keyOf(visit.visitId);
    const before = await header(visit.visitId);
    const tampered = Buffer.from("%PDF-1.4 tampered after the archive");
    const { error } = await admin.storage.from(BUCKET).upload(key, tampered, { contentType: "application/pdf", upsert: true });
    expect(error).toBeNull();

    mockState.client = doctor.client;
    const res = await getPrescriptionPdf(new Request("http://localhost/x"), { params: Promise.resolve({ id: visit.visitId }) });
    expect(res.status).toBe(200);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.equals(tampered)).toBe(false);
    expect(sha(bytes)).not.toBe(sha(tampered));
    expect(bytes.length).toBeGreaterThan(1000);

    const { data: audit } = await admin
      .from("audit_logs")
      .select("metadata")
      .eq("entity_id", before.id)
      .eq("action", "prescription.pdf_integrity_failed");
    expect(audit).toHaveLength(1);
    expect(audit![0].metadata).toMatchObject({ version: 1, sha256: before.pdf_sha256 });
    expect(await header(visit.visitId)).toMatchObject({ pdf_storage_path: key, pdf_sha256: before.pdf_sha256 });
    // The preview link for the same Rx is the route's, never a signed URL of the tampered object.
    const link = await getPrescriptionPdfSignedUrl(ctxFor(doctor), visit.prescriptionIds[0], "blank_paper");
    expect(link).toMatchObject({ success: true });
    if (link.success) expect(link.signedUrl).toBe(`/api/visits/${visit.visitId}/prescription-pdf?letterhead=blank_paper`);
  }, 60_000);
});

describe("pure render and the hash helper", () => {
  it("renderPrescriptionPdf stores nothing and sha256Hex is the node:crypto digest", async () => {
    const visit = await seedVisit();
    const source = await loadPrescriptionPdfSource(ctxFor(doctor), visit.visitId);
    const bytes = await renderPrescriptionPdf(source!.payload);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(sha256Hex(bytes)).toBe(sha(bytes));
    expect(await object(keyOf(visit.visitId))).toBeNull();
  }, 60_000);
});
