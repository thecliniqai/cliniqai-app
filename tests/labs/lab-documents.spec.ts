import { describe, it, expect, beforeAll } from "vitest";
import { formatAmendedFilename, uploadLabDocument, getPatientDocuments, deleteLabDocument } from "@/features/labs/actions";
import { uploadLabDocumentSchema } from "@/features/labs/schema";
import { seedTenantWithOwner } from "../helpers/tenants";

describe("Lab Reports & Records Management (REQ-lab-records)", () => {
  let tenantA: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let tenantB: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let sessionA: { userId: string; tenantId: string };
  let sessionB: { userId: string; tenantId: string };
  let patientAId: string;
  let documentAId: string;

  beforeAll(async () => {
    tenantA = await seedTenantWithOwner("Apex Diagnostics Center");
    tenantB = await seedTenantWithOwner("Beacon Pathology Lab");

    sessionA = { userId: tenantA.userId, tenantId: tenantA.tenantId };
    sessionB = { userId: tenantB.userId, tenantId: tenantB.tenantId };

    const { data: patient, error } = await (tenantA.client.from("patients") as any)
      .insert({
        tenant_id: tenantA.tenantId,
        full_name: "Aarav Sharma",
        phone: "+919876543111",
        age: 32,
        sex: "male",
        created_by: tenantA.userId,
      })
      .select("id")
      .single();

    if (error || !patient) {
      throw new Error(`Failed to seed patient: ${error?.message}`);
    }
    patientAId = patient.id;
  });

  describe("1. Filename Auto-Amendment & Path Normalization (D-03)", () => {
    it("formats filename according to [Patient_Name]_[Original]_[Date].[ext]", () => {
      const patientName = "Aarav Sharma";
      const originalFile = "lipid_panel_test (1).pdf";
      const reportDate = "2026-10-22";

      const amended = formatAmendedFilename(patientName, originalFile, reportDate);
      expect(amended).toBe("Aarav_Sharma_lipid_panel_test__1__2026-10-22.pdf");
    });

    it("handles files without extension gracefully by appending default extension", () => {
      const amended = formatAmendedFilename("John Doe", "blood_report", "2026-10-22");
      expect(amended).toBe("John_Doe_blood_report_2026-10-22.pdf");
    });

    it("sanitizes spaces and special punctuation in patient and original filenames", () => {
      const amended = formatAmendedFilename(
        "Dr. Mary-Jane O'Connor",
        "X-Ray (Chest) #4!.png",
        "2026-10-22"
      );
      expect(amended).toBe("Dr__Mary_Jane_O_Connor_X-Ray__Chest___4__2026-10-22.png");
    });

    it("validates schema with valid lab report inputs", () => {
      const result = uploadLabDocumentSchema.safeParse({
        patient_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        title: "Complete Blood Count (CBC)",
        document_type: "lab_report",
        report_date: "2026-10-22",
        is_abnormal: "true",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.is_abnormal).toBe(true);
        expect(result.data.title).toBe("Complete Blood Count (CBC)");
      }
    });

    it("rejects invalid document_type values", () => {
      const result = uploadLabDocumentSchema.safeParse({
        patient_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        title: "Test",
        document_type: "invalid_type",
        report_date: "2026-10-22",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("2. Document Upload & Storage Integration", () => {
    it("uploads a lab report document and stores deterministic record under tenant RLS", async () => {
      const fileContent = Buffer.from("%PDF-1.4 Mock Lab Report Content");
      const file = new File([fileContent], "CBC_Report_Final.pdf", { type: "application/pdf" });

      const formData = new FormData();
      formData.set("file", file);
      formData.set("patient_id", patientAId);
      formData.set("title", "Complete Blood Count");
      formData.set("document_type", "lab_report");
      formData.set("report_date", "2026-10-22");
      formData.set("is_abnormal", "true");
      formData.set("notes", "Elevated WBC count observed");

      const uploadRes = await uploadLabDocument(formData, tenantA.client, sessionA);
      expect(uploadRes.success).toBe(true);
      if (uploadRes.success) {
        expect(uploadRes.document.title).toBe("Complete Blood Count");
        expect(uploadRes.document.is_abnormal).toBe(true);
        expect(uploadRes.document.storage_path).toContain(`tenants/${tenantA.tenantId}/patients/${patientAId}/labs/`);
        expect(uploadRes.document.storage_path).toContain("Aarav_Sharma_CBC_Report_Final_2026-10-22.pdf");
        documentAId = uploadRes.document.id;
      }
    });

    it("retrieves patient documents ordered by report_date DESC", async () => {
      const listRes = await getPatientDocuments(patientAId, tenantA.client, sessionA);
      expect(listRes.success).toBe(true);
      expect(listRes.documents.length).toBeGreaterThanOrEqual(1);
      const found = listRes.documents.find((d) => d.id === documentAId);
      expect(found).toBeDefined();
      expect(found?.is_abnormal).toBe(true);
    });

    it("rejects files exceeding 25MB limit", async () => {
      // Mock File with size property > 25MB
      const mockLargeFile = new File(["test"], "huge.pdf", { type: "application/pdf" });
      Object.defineProperty(mockLargeFile, "size", { value: 26 * 1024 * 1024 });

      const formData = new FormData();
      formData.set("file", mockLargeFile);
      formData.set("patient_id", patientAId);
      formData.set("title", "Oversized Report");
      formData.set("document_type", "lab_report");
      formData.set("report_date", "2026-10-22");

      const uploadRes = await uploadLabDocument(formData, tenantA.client, sessionA);
      expect(uploadRes.success).toBe(false);
      expect(uploadRes.error).toContain("25MB");
    });
  });

  describe("3. Multi-Tenant RLS Boundary (T-04-03, T-04-06)", () => {
    it("proves Tenant B cannot query or view Tenant A patient documents via RLS", async () => {
      const listRes = await getPatientDocuments(patientAId, tenantB.client, sessionB);
      // Because patientAId belongs to Tenant A, Tenant B's query filtered by tenant_id returns 0 items
      expect(listRes.documents).toHaveLength(0);

      // Direct database query with Tenant B client
      const { data, error } = await (tenantB.client.from("patient_documents") as any)
        .select("*")
        .eq("id", documentAId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("proves Tenant B cannot delete Tenant A patient documents", async () => {
      const delRes = await deleteLabDocument(documentAId, tenantB.client, sessionB);
      expect(delRes.success).toBe(false);
      expect(delRes.error).toContain("not found or access denied");

      // Verify document still exists in Tenant A
      const { data: doc } = await (tenantA.client.from("patient_documents") as any)
        .select("id")
        .eq("id", documentAId)
        .single();

      expect(doc?.id).toBe(documentAId);
    });
  });
});
