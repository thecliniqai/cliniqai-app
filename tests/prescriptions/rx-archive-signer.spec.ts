/**
 * V2-09a 09A-06a (migration 000111; 09A-REVIEW-TRIAGE.md ruling R-A and rows S-2, S-3, S-5, S-8, A-3, A-6). Real rows, real JWTs and the local Storage API:
 *
 *  - R-A / S-2: only the doctor who signed the visit stores the canonical Rx object and records the PDF pair; the owner and a colleague doctor cannot, and
 *    an object at the key that the signer did not store is never adopted (audited, never served as the archive);
 *  - S-8: every on-demand render served in place of a missing or failed archive prints "Regenerated copy, not the archived original";
 *  - S-3 / A-6: a missing object is not audited as tampering; the signer's open clears the broken pair and archives again;
 *  - A-3: a signed visit whose Rx is not archived cannot be reopened (RX_ARCHIVE_PENDING); the signer's reopen archives first;
 *  - S-5: the public share link checks the object against the recorded SHA-256 before it signs it, and answers "being prepared" while the signed version
 *    has no archive.
 * Synthetic data only.
 */
import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { seedTenantWithOwner, addMemberToTenant, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";
import { pdfText } from "../helpers/pdf-text";
import { callFinalize, finalizeArgs, revisionsOfVisit, seedClinicalVisit, signVisitAs, type ClinicalVisit } from "../helpers/clinical-commands";

const mockState = vi.hoisted(() => ({ client: null as unknown }));
// The PDF route's session client is the member's own JWT client; the public share route keeps the real anon client (createPublicClient).
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  createClient: async () => mockState.client,
}));

import { GET as getPrescriptionPdf } from "@/app/api/visits/[id]/prescription-pdf/route";
import { GET as getSharedDocument } from "@/app/api/r/[token]/route";
import { prescriptionPdfPath, REGENERATED_COPY_NOTICE, renderPrescriptionPdf } from "@/features/prescriptions/pdf/generator";
import { loadPrescriptionPdfSource } from "@/features/prescriptions/pdf/payload";
import { CLINICAL_COMMAND_MESSAGES, completeAndSignConsultation, reopenVisitForAmendment } from "@/features/consultation/service";
import { resolveSharedObject } from "@/features/sharing/system";
import { SHARED_RX_PENDING_MESSAGE, SHARED_RX_UNVERIFIED_MESSAGE, DOCUMENT_LINK_KINDS } from "@/features/sharing/public-links";

const admin = getAdminClient();
const BUCKET = "prescriptions";
let owner: SeededTenant;
let doctor: SeededTenant;
let colleague: SeededTenant;

beforeAll(async () => {
  owner = await seedTenantWithOwner("Synthetic Rx Signer Clinic");
  doctor = await addMemberToTenant(owner.tenantId, "doctor");
  colleague = await addMemberToTenant(owner.tenantId, "doctor");
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

/** Signed by the doctor through the command only: the post-commit archive never ran. */
async function seedSignedUnarchived(): Promise<ClinicalVisit> {
  const visit = await seedVisit();
  await signVisitAs(doctor, visit.visitId);
  return visit;
}

/** Signed and archived the way the app does it (the doctor's sign-off, then the archive after the commit). */
async function seedArchived(): Promise<ClinicalVisit> {
  const visit = await seedVisit();
  expect((await completeAndSignConsultation(ctxFor(doctor), visit.visitId, randomUUID())).success).toBe(true);
  return visit;
}

async function header(visitId: string) {
  const { data, error } = await admin
    .from("prescriptions")
    .select("id, version, pdf_storage_path, pdf_sha256")
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

async function integrityAudits(prescriptionId: string) {
  const { data } = await admin
    .from("audit_logs")
    .select("actor_id, actor_role, metadata")
    .eq("entity_id", prescriptionId)
    .eq("action", "prescription.pdf_integrity_failed");
  return data ?? [];
}

const keyOf = (visitId: string, version = 1) => prescriptionPdfPath(owner.tenantId, visitId, version);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function openRoute(as: SeededTenant, visitId: string): Promise<Buffer> {
  mockState.client = as.client;
  const res = await getPrescriptionPdf(new Request("http://localhost/x"), { params: Promise.resolve({ id: visitId }) });
  expect(res.status).toBe(200);
  return Buffer.from(await res.arrayBuffer());
}

describe("R-A / S-2: only the signer archives", () => {
  it("the owner and a colleague doctor cannot store the canonical object or record a pair; the signer can", async () => {
    const visit = await seedSignedUnarchived();
    const forged = Buffer.from("%PDF-1.4 forged by someone who did not sign");
    for (const member of [owner, colleague]) {
      const { error } = await member.client.storage.from(BUCKET).upload(keyOf(visit.visitId), forged, { contentType: "application/pdf", upsert: false });
      expect(error).not.toBeNull();
      const pair = await member.client
        .from("prescriptions")
        .update({ pdf_storage_path: keyOf(visit.visitId), pdf_sha256: sha(forged) })
        .eq("id", visit.prescriptionIds[0]);
      expect(pair.error?.code).toBe("42501");
      expect(pair.error?.message).toBe("RX_PDF_SIGNER_ONLY");
    }
    expect(await object(keyOf(visit.visitId))).toBeNull();
    expect(await header(visit.visitId)).toMatchObject({ pdf_storage_path: null, pdf_sha256: null });

    // The signer: upload, then the pair of the bytes the signer stored.
    const own = Buffer.from("%PDF-1.4 the signer's archive");
    expect((await doctor.client.storage.from(BUCKET).upload(keyOf(visit.visitId), own, { contentType: "application/pdf", upsert: false })).error).toBeNull();
    const pair = await doctor.client
      .from("prescriptions")
      .update({ pdf_storage_path: keyOf(visit.visitId), pdf_sha256: sha(own) })
      .eq("id", visit.prescriptionIds[0])
      .select("id");
    expect(pair.error).toBeNull();
    expect(pair.data).toHaveLength(1);
  }, 60_000);

  it("the owner opening a sealed Rx with no archive gets a regenerated copy that says so, and nothing is stored; the signer's open archives it, and the owner then gets the archive", async () => {
    const visit = await seedSignedUnarchived();
    const ownerCopy = await openRoute(owner, visit.visitId);
    expect(ownerCopy.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdfText(ownerCopy)).toContain(REGENERATED_COPY_NOTICE);
    expect(await object(keyOf(visit.visitId))).toBeNull();
    expect(await header(visit.visitId)).toMatchObject({ pdf_storage_path: null, pdf_sha256: null });

    const signerCopy = await openRoute(doctor, visit.visitId);
    expect(pdfText(signerCopy)).not.toContain(REGENERATED_COPY_NOTICE);
    const h = await header(visit.visitId);
    expect(h.pdf_sha256).toBe(sha(signerCopy));
    expect(sha((await object(keyOf(visit.visitId)))!)).toBe(h.pdf_sha256);

    const ownerAfter = await openRoute(owner, visit.visitId);
    expect(ownerAfter.equals(signerCopy)).toBe(true);
  }, 90_000);

  it("an object at the key that the signer did not store (the service role put it there) is never adopted: no pair, an integrity audit row, a regenerated copy", async () => {
    const visit = await seedSignedUnarchived();
    const planted = Buffer.from("%PDF-1.4 planted outside the app");
    const { error: plantErr } = await admin.storage.from(BUCKET).upload(keyOf(visit.visitId), planted, { contentType: "application/pdf", upsert: false });
    expect(plantErr).toBeNull();

    const served = await openRoute(doctor, visit.visitId);
    expect(served.equals(planted)).toBe(false);
    expect(pdfText(served)).toContain(REGENERATED_COPY_NOTICE);
    expect(await header(visit.visitId)).toMatchObject({ pdf_storage_path: null, pdf_sha256: null });
    const audits = await integrityAudits(visit.prescriptionIds[0]);
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toMatchObject({ reason: "FOREIGN_OBJECT", sha256: sha(planted), storage_path: keyOf(visit.visitId) });
    expect((await object(keyOf(visit.visitId)))!.equals(planted)).toBe(true);
  }, 60_000);
});

describe("S-3 / A-6: a missing archive", () => {
  it("is not audited as tampering; another reader gets a regenerated copy and the pair stays; the signer's open clears the pair and archives again", async () => {
    const visit = await seedArchived();
    const before = await header(visit.visitId);
    const { data: removed, error: rmErr } = await admin.storage.from(BUCKET).remove([keyOf(visit.visitId)]);
    expect(rmErr).toBeNull();
    expect(removed).toHaveLength(1);

    const ownerCopy = await openRoute(owner, visit.visitId);
    expect(pdfText(ownerCopy)).toContain(REGENERATED_COPY_NOTICE);
    expect(await integrityAudits(before.id)).toHaveLength(0);
    expect(await header(visit.visitId)).toMatchObject({ pdf_storage_path: before.pdf_storage_path, pdf_sha256: before.pdf_sha256 });
    // Nobody but the signer may clear it.
    const ownerClear = await owner.client.from("prescriptions").update({ pdf_storage_path: null, pdf_sha256: null }).eq("id", before.id);
    expect(ownerClear.error?.message).toBe("RX_PDF_WRITE_ONCE");

    const signerCopy = await openRoute(doctor, visit.visitId);
    expect(pdfText(signerCopy)).not.toContain(REGENERATED_COPY_NOTICE);
    const after = await header(visit.visitId);
    expect(after.pdf_storage_path).toBe(keyOf(visit.visitId));
    expect(after.pdf_sha256).toBe(sha(signerCopy));
    expect(sha((await object(keyOf(visit.visitId)))!)).toBe(after.pdf_sha256);
    expect(await integrityAudits(before.id)).toHaveLength(0);
  }, 90_000);

  it("a hash mismatch is still audited as an integrity failure and served as a regenerated copy", async () => {
    const visit = await seedArchived();
    const before = await header(visit.visitId);
    const tampered = Buffer.from("%PDF-1.4 tampered after the archive");
    expect((await admin.storage.from(BUCKET).upload(keyOf(visit.visitId), tampered, { contentType: "application/pdf", upsert: true })).error).toBeNull();
    const served = await openRoute(doctor, visit.visitId);
    expect(served.equals(tampered)).toBe(false);
    expect(pdfText(served)).toContain(REGENERATED_COPY_NOTICE);
    const audits = await integrityAudits(before.id);
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toMatchObject({ reason: "HASH_MISMATCH", sha256: before.pdf_sha256 });
    expect(await header(visit.visitId)).toMatchObject({ pdf_sha256: before.pdf_sha256 });
  }, 60_000);
});

describe("A-3: no reopen while the signed version has no archive", () => {
  it("the owner cannot reopen a colleague's signed visit whose Rx is not archived (fixed text, nothing changes); the signer's reopen archives first and succeeds", async () => {
    const visit = await seedSignedUnarchived();
    const refused = await reopenVisitForAmendment(ctxFor(owner), visit.visitId, "Synthetic reason: owner correcting the record", randomUUID());
    expect(refused).toMatchObject({ success: false, reason: "RX_ARCHIVE_PENDING", error: CLINICAL_COMMAND_MESSAGES.RX_ARCHIVE_PENDING });
    const { data: v } = await admin.from("visits").select("status, current_revision").eq("id", visit.visitId).single();
    expect(v).toMatchObject({ status: "completed", current_revision: 1 });
    expect(await revisionsOfVisit(visit.visitId)).toHaveLength(0);
    expect(await object(keyOf(visit.visitId))).toBeNull();

    const reopened = await reopenVisitForAmendment(ctxFor(doctor), visit.visitId, "Synthetic reason: the signer corrects the dose", randomUUID());
    expect(reopened.success).toBe(true);
    const [revision] = await revisionsOfVisit(visit.visitId);
    const snap = revision.snapshot as { prescription: { pdf_storage_path: string | null; pdf_sha256: string | null } };
    expect(snap.prescription.pdf_storage_path).toBe(keyOf(visit.visitId));
    expect(snap.prescription.pdf_sha256).toBe(sha((await object(keyOf(visit.visitId)))!));
  }, 90_000);
});

describe("S-5: the share link checks the hash before it signs the object", () => {
  async function mint(client: SupabaseClient, prescriptionId: string): Promise<string> {
    const { data, error } = await (client.rpc as unknown as (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>)(
      "create_share_token",
      { p_resource_type: "prescription", p_resource_id: prescriptionId }
    );
    if (error) throw new Error(`mint failed: ${error.code}`);
    return (data as Array<{ token: string }>)[0].token;
  }
  const shared = (token: string, query = "") =>
    getSharedDocument(new NextRequest(`http://localhost:3000/api/r/${token}${query}`), { params: Promise.resolve({ token }) });

  it("an archived Rx is signed; a tampered one is refused with the fixed text, audited by the system, and never redirected to", async () => {
    const visit = await seedArchived();
    const token = await mint(doctor.client as SupabaseClient, visit.prescriptionIds[0]);
    expect(await resolveSharedObject(token, DOCUMENT_LINK_KINDS)).toMatchObject({ status: "ok", resourceType: "prescription" });
    expect((await shared(token, "?download=true")).status).toBe(302);

    const before = await header(visit.visitId);
    const tampered = Buffer.from("%PDF-1.4 tampered behind the share link");
    expect((await admin.storage.from(BUCKET).upload(keyOf(visit.visitId), tampered, { contentType: "application/pdf", upsert: true })).error).toBeNull();
    expect(await resolveSharedObject(token, DOCUMENT_LINK_KINDS)).toEqual({ status: "unverified", resourceType: "prescription" });
    const download = await shared(token, "?download=true");
    expect(download.status).toBe(409);
    expect(download.headers.get("location")).toBeNull();
    expect(await download.json()).toEqual({ error: SHARED_RX_UNVERIFIED_MESSAGE });
    // The page data carries no signed URL of the object: its link is the download route, which refuses.
    const view = await shared(token);
    expect(view.status).toBe(200);
    expect((await view.json()).signed_url).toBe(`/api/r/${token}?download=true`);
    const audits = await integrityAudits(before.id);
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits.every((a) => a.actor_id === null && a.actor_role === "system")).toBe(true);
    expect(audits[0].metadata).toMatchObject({ reason: "SHARE_LINK_HASH_MISMATCH", sha256: before.pdf_sha256, storage_path: keyOf(visit.visitId) });
  }, 60_000);

  it("after a finalize whose new version is not archived yet, the link answers 'being prepared', never the previous version's object", async () => {
    const visit = await seedArchived();
    const token = await mint(doctor.client as SupabaseClient, visit.prescriptionIds[0]);
    expect((await reopenVisitForAmendment(ctxFor(doctor), visit.visitId, "Synthetic reason: instructions clarified", randomUUID())).success).toBe(true);
    const { error } = await callFinalize(doctor.client, finalizeArgs(owner, visit.visitId)); // the command only: no v2 archive yet
    expect(error).toBeNull();
    expect(await header(visit.visitId)).toMatchObject({ version: 2, pdf_storage_path: null, pdf_sha256: null });

    expect(await resolveSharedObject(token, DOCUMENT_LINK_KINDS)).toEqual({ status: "pending", resourceType: "prescription" });
    const res = await shared(token, "?download=true");
    expect(res.status).toBe(503);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.json()).toEqual({ error: SHARED_RX_PENDING_MESSAGE });
    expect(await object(keyOf(visit.visitId, 1))).not.toBeNull(); // the v1 object exists, and is not what the link serves
  }, 90_000);
});

describe("S-8: the regenerated notice is printed only on a regenerated copy", () => {
  it("renderPrescriptionPdf prints the notice when the payload asks for it, and not otherwise", async () => {
    const visit = await seedVisit();
    const source = await loadPrescriptionPdfSource(ctxFor(doctor), visit.visitId);
    const plain = pdfText(await renderPrescriptionPdf(source!.payload));
    expect(plain).toMatch(/Synthetic medicine/i); // the text extraction reads the page (control for the negative below)
    expect(plain).not.toContain(REGENERATED_COPY_NOTICE);
    const marked = pdfText(await renderPrescriptionPdf({ ...source!.payload, regenerated_notice: REGENERATED_COPY_NOTICE }));
    expect(marked).toContain(REGENERATED_COPY_NOTICE);
  }, 60_000);
});
