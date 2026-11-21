/**
 * V2-09b 09B-06a, the upload rows of the review triage (09B-REVIEW-TRIAGE.md), through the real `uploadLabDocument` service with the owner's JWT client
 * against the local stack's database and Storage:
 *   - A-4  one request id per file: a repeat (a retry after a lost response, or two parallel sends) stores one row and one object and is answered with the
 *          stored row; an object stored by a failed earlier attempt is adopted only when its bytes are this file's; the id used for another patient is
 *          refused.
 *   - S-2 / A-8  a report linked to a sealed, an unsigned completed or a cancelled visit is refused before anything is stored (no row, no object); a draft
 *          visit and a visit reopened for amendment take one.
 *   - S-6  the first bytes must match the declared type; the storage extension comes from the type, not the file name; the stored file name loses control
 *          and bidirectional characters and is capped at 255.
 * Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { LAB_REQUEST_REUSED_MESSAGE, uploadLabDocument } from "@/features/labs/service";
import { LAB_CONTENT_MISMATCH_MESSAGE, LAB_VISIT_LOCKED_MESSAGE } from "@/features/labs/utils";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { reopenVisitAs, seedClinicalVisit, signVisitAs, type ClinicalVisit } from "../helpers/clinical-commands";

const admin = getAdminClient();
const PDF = (tag: string) => Buffer.from(`%PDF-1.4\n% synthetic report ${tag}\n%%EOF\n`);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);

let owner: SeededTenant;

function form(opts: { patientId: string; visitId?: string; requestId?: string; bytes?: Buffer; name?: string; type?: string }): FormData {
  const f = new FormData();
  f.set("file", new File([new Uint8Array(opts.bytes ?? PDF("x"))], opts.name ?? "report.pdf", { type: opts.type ?? "application/pdf" }));
  f.set("patient_id", opts.patientId);
  if (opts.visitId) f.set("visit_id", opts.visitId);
  if (opts.requestId) f.set("client_request_id", opts.requestId);
  f.set("title", "Synthetic CBC");
  f.set("document_type", "lab_report");
  f.set("report_date", "2030-01-15");
  f.set("is_abnormal", "false");
  return f;
}

async function rowsFor(requestId: string) {
  const { data, error } = await admin.from("patient_documents").select("id, storage_path, visit_id").eq("client_request_id", requestId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function objectsUnder(tenantId: string, patientId: string): Promise<string[]> {
  const { data, error } = await admin.storage.from("clinic-records").list(`tenants/${tenantId}/patients/${patientId}/labs`, { limit: 1000 });
  if (error) throw new Error(error.message);
  return (data ?? []).map((o) => o.name);
}

async function uploadAudits(documentId: string): Promise<number> {
  const { count, error } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("action", "patient_document.upload")
    .eq("entity_id", documentId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

beforeAll(async () => {
  owner = await seedTenantWithOwner("Upload Review Clinic");
}, 60_000);

describe("A-4: one request id stores one row and one object", () => {
  let visit: ClinicalVisit;
  beforeAll(async () => {
    visit = await seedClinicalVisit(owner, { status: "in_consultation" });
  });

  it("a retry after a lost response (the same id sent again) answers with the stored row and stores nothing more", async () => {
    const requestId = randomUUID();
    const first = await uploadLabDocument(ctxFor(owner), form({ patientId: visit.patientId, visitId: visit.visitId, requestId, bytes: PDF("a") }));
    if (!first.success) throw new Error(first.error);
    // The first answer is lost: the client retries with the same id and the same file.
    const retry = await uploadLabDocument(ctxFor(owner), form({ patientId: visit.patientId, visitId: visit.visitId, requestId, bytes: PDF("a") }));
    expect(retry).toMatchObject({ success: true, document: { id: first.document.id } });
    const rows = await rowsFor(requestId);
    expect(rows).toHaveLength(1);
    expect(rows[0].storage_path).toBe(`tenants/${owner.tenantId}/patients/${visit.patientId}/labs/${requestId}.pdf`);
    expect((await objectsUnder(owner.tenantId, visit.patientId)).filter((n) => n.startsWith(requestId))).toEqual([`${requestId}.pdf`]);
    expect(await uploadAudits(first.document.id)).toBe(1);
  });

  it("two parallel sends of one upload store one row and one object", async () => {
    const requestId = randomUUID();
    const results = await Promise.all(
      [0, 1, 2].map(() => uploadLabDocument(ctxFor(owner), form({ patientId: visit.patientId, visitId: visit.visitId, requestId, bytes: PDF("b") }))),
    );
    const ids = new Set(results.map((r) => (r.success ? r.document.id : `failed:${r.error}`)));
    expect(ids.size).toBe(1);
    expect([...ids][0]).not.toMatch(/^failed:/);
    expect(await rowsFor(requestId)).toHaveLength(1);
    expect((await objectsUnder(owner.tenantId, visit.patientId)).filter((n) => n.startsWith(requestId))).toHaveLength(1);
  });

  it("an object an earlier attempt stored without its row is adopted when it holds the same bytes, and refused when it does not", async () => {
    const same = randomUUID();
    const key = (id: string) => `tenants/${owner.tenantId}/patients/${visit.patientId}/labs/${id}.pdf`;
    const up = await admin.storage.from("clinic-records").upload(key(same), PDF("c"), { contentType: "application/pdf", upsert: false });
    if (up.error) throw new Error(up.error.message);
    const adopted = await uploadLabDocument(ctxFor(owner), form({ patientId: visit.patientId, visitId: visit.visitId, requestId: same, bytes: PDF("c") }));
    expect(adopted.success).toBe(true);
    expect(await rowsFor(same)).toHaveLength(1);

    const other = randomUUID();
    const up2 = await admin.storage.from("clinic-records").upload(key(other), PDF("someone else's bytes"), { contentType: "application/pdf", upsert: false });
    if (up2.error) throw new Error(up2.error.message);
    const refused = await uploadLabDocument(ctxFor(owner), form({ patientId: visit.patientId, visitId: visit.visitId, requestId: other, bytes: PDF("d") }));
    expect(refused.success).toBe(false);
    expect(await rowsFor(other)).toHaveLength(0);
  });

  it("the same id sent for another patient is refused and stores nothing", async () => {
    const requestId = randomUUID();
    const ok = await uploadLabDocument(ctxFor(owner), form({ patientId: visit.patientId, visitId: visit.visitId, requestId }));
    expect(ok.success).toBe(true);
    const otherVisit = await seedClinicalVisit(owner, { status: "in_consultation" });
    const reused = await uploadLabDocument(ctxFor(owner), form({ patientId: otherVisit.patientId, visitId: otherVisit.visitId, requestId }));
    expect(reused).toEqual({ success: false, error: LAB_REQUEST_REUSED_MESSAGE });
    expect(await rowsFor(requestId)).toHaveLength(1);
    expect(await objectsUnder(owner.tenantId, otherVisit.patientId)).toEqual([]);
  });
});

describe("S-2 / A-8: no report on a closed visit", () => {
  it("a sealed visit, an unsigned completed one and a cancelled one refuse the report, and nothing is stored", async () => {
    const sealed = await seedClinicalVisit(owner, { status: "in_consultation" });
    await signVisitAs(owner, sealed.visitId);
    const cancelled = await seedClinicalVisit(owner, { status: "cancelled" });
    const completed = await seedClinicalVisit(owner, { status: "in_consultation" });
    const done = await admin.from("visits").update({ status: "completed" }).eq("id", completed.visitId).select("status").single();
    expect(done.data?.status).toBe("completed");

    for (const v of [sealed, completed, cancelled]) {
      const requestId = randomUUID();
      const res = await uploadLabDocument(ctxFor(owner), form({ patientId: v.patientId, visitId: v.visitId, requestId }));
      expect(res).toEqual({ success: false, error: LAB_VISIT_LOCKED_MESSAGE });
      expect(await rowsFor(requestId)).toHaveLength(0);
      // Refused before the upload: no object is left behind under the patient's labs folder.
      expect(await objectsUnder(owner.tenantId, v.patientId)).toEqual([]);
    }
  });

  it("a draft visit and a visit reopened for amendment take a report", async () => {
    const draft = await seedClinicalVisit(owner, { status: "in_consultation" });
    const amending = await seedClinicalVisit(owner, { status: "in_consultation" });
    await signVisitAs(owner, amending.visitId);
    await reopenVisitAs(owner, amending.visitId);
    for (const v of [draft, amending]) {
      const res = await uploadLabDocument(ctxFor(owner), form({ patientId: v.patientId, visitId: v.visitId, requestId: randomUUID() }));
      expect(res.success).toBe(true);
      if (res.success) expect(res.document.visit_id).toBe(v.visitId);
    }
  });
});

describe("S-6: the content matches the type; the key and the stored name are safe", () => {
  let patientId: string;
  beforeAll(async () => {
    patientId = (await seedClinicalVisit(owner, { status: "in_consultation" })).patientId;
  });

  it("an HTML page declared as a PNG is refused and nothing is stored", async () => {
    const requestId = randomUUID();
    const res = await uploadLabDocument(
      ctxFor(owner),
      form({ patientId, requestId, bytes: Buffer.from("<html><script>alert(1)</script></html>"), name: "report.html", type: "image/png" }),
    );
    expect(res).toEqual({ success: false, error: LAB_CONTENT_MISMATCH_MESSAGE });
    expect(await rowsFor(requestId)).toHaveLength(0);
    expect((await objectsUnder(owner.tenantId, patientId)).filter((n) => n.startsWith(requestId))).toEqual([]);
  });

  it("a real PNG named .html is stored as .png; the stored name loses control and bidi characters and is capped at 255", async () => {
    const requestId = randomUUID();
    const res = await uploadLabDocument(ctxFor(owner), form({ patientId, requestId, bytes: PNG, name: "scan‮gpj.html", type: "image/png" }));
    if (!res.success) throw new Error(res.error);
    expect(res.document.storage_path).toBe(`tenants/${owner.tenantId}/patients/${patientId}/labs/${requestId}.png`);
    expect(res.document.mime_type).toBe("image/png");
    expect(res.document.original_filename).toBe("scangpj.html");

    const long = await uploadLabDocument(
      ctxFor(owner),
      form({ patientId, requestId: randomUUID(), bytes: PDF("long"), name: `${"r".repeat(300)}\u0007.pdf` }),
    );
    if (!long.success) throw new Error(long.error);
    expect(long.document.original_filename).toBe("r".repeat(255));
  });
});
