/**
 * Lab storage keys without patient names (V2-05 05-02c, R-45; V2-03 triage accepted to V2-05 storage, review E I-4;
 * threat T-05-41). Drives the real `uploadLabDocument` and `getDocumentSignedUrl` services with a doctor's JWT client
 * against the local stack's Storage:
 *   - the key is `tenants/<tenant>/patients/<patient>/labs/<document id>.<ext>`: ids only, nothing of the patient's name;
 *   - two uploads of the same file name and date create two objects and two rows (before: the key was built from the
 *     name and the date with `upsert: true`, so the second upload silently replaced the first report);
 *   - the readable name is only the signed URL's download name: the URL's object path holds the key, never the name.
 * Synthetic data only ("Asha Testpatient" is a made-up name).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getDocumentSignedUrl, uploadLabDocument } from "@/features/labs/service";
import { getAdminClient } from "../helpers/supabase-admin";
import { insertReturningId } from "../helpers/db";
import { ctxFor } from "../helpers/context";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

const admin = getAdminClient();
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY_SHAPE = new RegExp(`^tenants/${UUID}/patients/${UUID}/labs/${UUID}\\.[a-z0-9]{1,10}$`);

let owner: SeededTenant;
let doctor: SeededTenant;
let patientId: string;

function form(fileName: string): FormData {
  const formData = new FormData();
  formData.set("file", new File([Buffer.from(`%PDF-1.4 synthetic ${fileName}`)], fileName, { type: "application/pdf" }));
  formData.set("patient_id", patientId);
  formData.set("title", "Synthetic CBC");
  formData.set("document_type", "lab_report");
  formData.set("report_date", "2030-01-15");
  formData.set("is_abnormal", "false");
  return formData;
}

beforeAll(async () => {
  owner = await seedTenantWithOwner("Lab Key Clinic");
  doctor = await addMemberToTenant(owner.tenantId, "doctor");
  patientId = await insertReturningId(admin, "patients", {
    tenant_id: owner.tenantId,
    full_name: "Asha Testpatient",
    phone: "+919000000901",
    created_by: owner.userId,
  });
}, 60_000);

describe("lab storage keys hold ids only (R-45)", () => {
  it("names the object by the document id, with nothing of the patient's name", async () => {
    const res = await uploadLabDocument(ctxFor(doctor), form("Asha Testpatient CBC.PDF"));
    if (!res.success) throw new Error(`upload failed: ${res.error}`);
    const key = res.document.storage_path;
    expect(key).toMatch(KEY_SHAPE);
    expect(key).toBe(`tenants/${owner.tenantId}/patients/${patientId}/labs/${res.document.id}.pdf`);
    expect(key).not.toMatch(/asha|testpatient|cbc/i);
    const { data } = await admin.storage.from("clinic-records").download(key);
    expect(data).not.toBeNull();
    // The key also satisfies the 000022 shape rule (the row was accepted by the CHECK) and the stored audit row
    // carries the id-only key, never the name.
    const { data: audit } = await admin
      .from("audit_logs")
      .select("actor_id, metadata")
      .eq("action", "patient_document.upload")
      .eq("entity_id", res.document.id);
    expect(audit).toEqual([{ actor_id: doctor.userId, metadata: { storage_path: key } }]);
  });

  it("two uploads of the same file name and date create two objects (no overwrite)", async () => {
    const first = await uploadLabDocument(ctxFor(doctor), form("same_report.pdf"));
    const second = await uploadLabDocument(ctxFor(doctor), form("same_report.pdf"));
    if (!first.success || !second.success) throw new Error("upload failed");
    expect(first.document.storage_path).not.toBe(second.document.storage_path);
    for (const doc of [first.document, second.document]) {
      const { data } = await admin.storage.from("clinic-records").download(doc.storage_path);
      expect(await data?.text()).toBe("%PDF-1.4 synthetic same_report.pdf");
    }
    const { data: rows } = await admin
      .from("patient_documents")
      .select("id")
      .eq("patient_id", patientId)
      .eq("original_filename", "same_report.pdf");
    expect(rows).toHaveLength(2);
  });

  it("gives the readable name only as the signed URL's download name", async () => {
    const res = await uploadLabDocument(ctxFor(doctor), form("lipid panel.pdf"));
    if (!res.success) throw new Error("upload failed");
    const signed = await getDocumentSignedUrl(ctxFor(doctor), res.document.id);
    expect(signed.success).toBe(true);
    const url = new URL(signed.signedUrl!);
    expect(url.pathname).toContain(`/labs/${res.document.id}.pdf`);
    expect(url.pathname).not.toMatch(/asha|testpatient|lipid/i);
    expect(url.searchParams.get("download")).toBe("Asha_Testpatient_lipid_panel_2030-01-15.pdf");
  });

  it("refuses a receptionist's upload (labs:edit since 05-02c)", async () => {
    const receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
    const res = await uploadLabDocument(ctxFor(receptionist), form("desk.pdf"));
    expect(res.success).toBe(false);
    const { data: rows } = await admin
      .from("patient_documents")
      .select("id")
      .eq("patient_id", patientId)
      .eq("original_filename", "desk.pdf");
    expect(rows).toEqual([]);
  });
});
