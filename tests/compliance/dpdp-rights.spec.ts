import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { exportPatientDpdpArchive } from "@/features/dpdp/export";
import { generateDpdpMedicalSummaryPdf } from "@/features/dpdp/pdf/generator";
import { erasePatientRecord } from "@/features/dpdp/erasure";
import { getPatient, searchPatients, getPatients } from "@/features/patients/service";
import { toggleGlobalConsent } from "@/features/patients/consent-service";
import { updateStatutorySettings } from "@/features/settings/actions";
import { generateAndArchivePrescriptionPdf } from "@/features/prescriptions/pdf/generator";
import { GET as exportRoute } from "@/app/api/v1/patients/[id]/export/route";
import { DELETE as deletePatientRoute } from "@/app/api/v1/patients/[id]/route";
import { seedTenantWithOwner, addMemberToTenant } from "../helpers/tenants";
import { createApiKeySecret } from "@/lib/api/auth";
import { getAdminClient } from "@/lib/supabase/admin";
import { ctxFor } from "../helpers/context";

describe("DPDP Act 2023 Compliance & Patient Privacy Rights (D-13, D-14, D-15, D-16)", () => {
  let tenantA: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let tenantB: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let doctorA: Awaited<ReturnType<typeof addMemberToTenant>>;
  let keyA: { rawToken: string; id: string };
  let keyB: { rawToken: string; id: string };

  let patientId: string;
  let visitId: string;
  let prescriptionId: string;
  let invoiceId: string;

  beforeAll(async () => {
    const admin = getAdminClient();

    // 1. Seed two tenants
    tenantA = await seedTenantWithOwner("DPDP Rights Clinic Alpha");
    tenantB = await seedTenantWithOwner("DPDP Rights Clinic Beta");

    // Add statutory columns to tenantA
    await admin
      .from("tenants")
      .update({
        clinical_establishment_reg_no: "CEA-MH-2024-9988",
        state_medical_council_reg_no: "MMC/2021/00492",
        gstin: "27AAPCU5050M1ZV",
        drug_license_no: "MH-DL-20B-184920",
      })
      .eq("id", tenantA.tenantId);

    // 2. Add doctor
    doctorA = await addMemberToTenant(tenantA.tenantId, "doctor");

    // 3. Create API keys
    const secretA = createApiKeySecret();
    const { data: recA } = await admin
      .from("api_keys")
      .insert({
        tenant_id: tenantA.tenantId,
        name: "DPDP Test Key Alpha",
        key_prefix: secretA.keyPrefix,
        key_hash: secretA.keyHash,
        created_by: tenantA.userId,
      })
      .select("id")
      .single();
    keyA = { rawToken: secretA.rawToken, id: recA!.id };

    const secretB = createApiKeySecret();
    const { data: recB } = await admin
      .from("api_keys")
      .insert({
        tenant_id: tenantB.tenantId,
        name: "DPDP Test Key Beta",
        key_prefix: secretB.keyPrefix,
        key_hash: secretB.keyHash,
        created_by: tenantB.userId,
      })
      .select("id")
      .single();
    keyB = { rawToken: secretB.rawToken, id: recB!.id };

    // 4. Seed full patient history in Tenant A
    const { data: patient } = await admin
      .from("patients")
      .insert({
        tenant_id: tenantA.tenantId,
        full_name: "Aarav Sharma",
        phone: "+919876543210",
        date_of_birth: "1990-05-15",
        age: 36,
        sex: "male",
        address: { line1: "42 Shivaji Park", city: "Mumbai", state: "Maharashtra", pincode: "400028" },
        allergies: ["Penicillin", "Sulfa drugs"],
        chronic_conditions: ["Hypertension", "Type 2 Diabetes"],
        emergency_contact: { name: "Priya Sharma", relation: "Spouse", phone: "+919876543211" },
        abha_id: "91-1234-5678-9012",
        created_by: tenantA.userId,
      })
      .select("id")
      .single();
    patientId = patient!.id;

    // 5. Seed clinical encounter
    const { data: visit } = await admin
      .from("visits")
      .insert({
        tenant_id: tenantA.tenantId,
        patient_id: patientId,
        doctor_id: doctorA.userId,
        origin_type: "scheduled",
        status: "completed",
        scheduled_at: new Date().toISOString(),
        reason_for_visit: "Quarterly diabetes follow-up",
        chief_complaints: [{ symptom: "Mild dizziness", duration_val: 3, duration_unit: "days" }],
        vitals: { systolic: 128, diastolic: 82, pulse: 74, temperature: 98.4, spo2: 99, weight: 72 },
        clinical_notes: "Blood glucose moderately controlled. Maintain current dosage.",
        created_by: tenantA.userId,
      })
      .select("id")
      .single();
    visitId = visit!.id;

    // 6. Seed prescription with items
    const { data: rx } = await admin
      .from("prescriptions")
      .insert({
        tenant_id: tenantA.tenantId,
        visit_id: visitId,
        patient_id: patientId,
        doctor_id: doctorA.userId,
        version: 1,
        status: "active",
        letterhead_mode: "blank_paper",
        signed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    prescriptionId = rx!.id;

    await admin.from("prescription_items").insert([
      {
        prescription_id: prescriptionId,
        medicine_name: "Metformin",
        generic_name: "Metformin Hydrochloride",
        dose_form: "Tablet",
        dosage: "500 mg",
        timing: "Twice daily after meals",
        duration: "30 days",
        special_instructions: "Take with water",
      },
      {
        prescription_id: prescriptionId,
        medicine_name: "Telmisartan",
        generic_name: "Telmisartan",
        dose_form: "Tablet",
        dosage: "40 mg",
        timing: "Once daily morning",
        duration: "30 days",
      },
    ]);

    // 7. Seed patient document
    await admin.from("patient_documents").insert({
      tenant_id: tenantA.tenantId,
      patient_id: patientId,
      visit_id: visitId,
      title: "HbA1c & Fasting Glucose Report",
      document_type: "lab_report",
      original_filename: "hba1c_oct2026.pdf",
      storage_path: `${tenantA.tenantId}/${patientId}/hba1c_oct2026.pdf`,
      file_size_bytes: 142850,
      mime_type: "application/pdf",
      report_date: "2026-10-15",
      is_abnormal: false,
      uploaded_by: tenantA.userId,
    });

    // 8. Seed billing records: Invoice and Payment
    const { data: inv } = await admin
      .from("invoices")
      .insert({
        tenant_id: tenantA.tenantId,
        patient_id: patientId,
        visit_id: visitId,
        invoice_number: "INV-2026-0001",
        subtotal: 800,
        discount: 0,
        tax: 0,
        total_amount: 800,
        status: "paid",
      })
      .select("id")
      .single();
    invoiceId = inv!.id;

    await admin.from("invoice_items").insert({
      tenant_id: tenantA.tenantId,
      invoice_id: invoiceId,
      item_type: "consultation",
      description: "Specialist Follow-up Consultation",
      unit_price: 800,
      quantity: 1,
      total_price: 800,
    });

    await admin.from("payments").insert({
      tenant_id: tenantA.tenantId,
      invoice_id: invoiceId,
      amount: 800,
      payment_method: "upi",
      reference_number: "UPI/2026/8912409",
      recorded_by: tenantA.userId,
      recorded_at: new Date().toISOString(),
    });

    // 9. Seed consent records
    await admin.from("consent_records").insert([
      {
        tenant_id: tenantA.tenantId,
        patient_id: patientId,
        consent_type: "treatment",
        status: "granted",
        recorded_by: tenantA.userId,
        recorded_at: new Date().toISOString(),
        note: "Initial informed consent for clinical care",
      },
      {
        tenant_id: tenantA.tenantId,
        patient_id: patientId,
        consent_type: "data_sharing",
        status: "granted",
        recorded_by: tenantA.userId,
        recorded_at: new Date().toISOString(),
        note: "Consent for lab diagnostics and reporting",
      },
    ]);
  });

  describe("Task 1: DPDP Right to Access Dual-Format Data Export", () => {
    it("exportPatientDpdpArchive compiles demographics, visits, prescriptions, documents, billing, and consent", async () => {
      const bundle = await exportPatientDpdpArchive(patientId, tenantA.tenantId);

      expect(bundle).toBeDefined();
      expect(bundle.export_metadata.standard).toBe("DPDP_ACT_2023_RIGHT_TO_ACCESS");
      expect(bundle.export_metadata.tenant_id).toBe(tenantA.tenantId);
      expect(bundle.export_metadata.patient_id).toBe(patientId);
      expect(bundle.export_metadata.statutory_registrations?.clinical_establishment_reg_no).toBe("CEA-MH-2024-9988");
      expect(bundle.export_metadata.statutory_registrations?.gstin).toBe("27AAPCU5050M1ZV");

      expect(bundle.patient.full_name).toBe("Aarav Sharma");
      expect(bundle.patient.phone).toBe("+919876543210");

      expect(bundle.encounters.length).toBeGreaterThanOrEqual(1);
      expect(bundle.encounters[0].reason_for_visit).toBe("Quarterly diabetes follow-up");

      expect(bundle.prescriptions.length).toBeGreaterThanOrEqual(1);
      const items = (bundle.prescriptions[0] as any).prescription_items;
      expect(items.length).toBe(2);
      expect(items.some((i: any) => i.medicine_name === "Metformin")).toBe(true);

      expect(bundle.documents.length).toBeGreaterThanOrEqual(1);
      expect(bundle.documents[0].title).toBe("HbA1c & Fasting Glucose Report");

      // Verify billing inclusion per OpenCode review
      expect(bundle.billing.invoices.length).toBeGreaterThanOrEqual(1);
      expect(bundle.billing.invoices[0].invoice_number).toBe("INV-2026-0001");
      expect(bundle.billing.payments.length).toBeGreaterThanOrEqual(1);
      expect(bundle.billing.payments[0].payment_method).toBe("upi");

      // Verify consent inclusion
      expect(bundle.consent_records.length).toBeGreaterThanOrEqual(2);
    });

    it("generateDpdpMedicalSummaryPdf compiles a valid PDF binary buffer", async () => {
      const bundle = await exportPatientDpdpArchive(patientId, tenantA.tenantId, { skipAudit: true });
      const pdfBuffer = await generateDpdpMedicalSummaryPdf(bundle);

      expect(pdfBuffer).toBeDefined();
      expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
      expect(pdfBuffer.length).toBeGreaterThan(1000);
      // PDF binary starts with %PDF-
      const header = pdfBuffer.subarray(0, 5).toString("utf-8");
      expect(header).toBe("%PDF-");
    });

    it("GET /api/v1/patients/[id]/export with format=json returns application/json archive", async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/patients/${patientId}/export?format=json`, {
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
        },
      });

      const res = await exportRoute(req, { params: Promise.resolve({ id: patientId }) });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("content-disposition")).toContain(`patient-dpdp-export-${patientId}.json`);

      const json = await res.json();
      expect(json.export_metadata.standard).toBe("DPDP_ACT_2023_RIGHT_TO_ACCESS");
      expect(json.patient.full_name).toBe("Aarav Sharma");
      expect(json.billing.invoices.length).toBeGreaterThanOrEqual(1);
    });

    it("GET /api/v1/patients/[id]/export with format=pdf returns application/pdf binary", async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/patients/${patientId}/export?format=pdf`, {
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
        },
      });

      const res = await exportRoute(req, { params: Promise.resolve({ id: patientId }) });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/pdf");
      expect(res.headers.get("content-disposition")).toContain(`medical-summary-${patientId}.pdf`);

      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      expect(buffer.length).toBeGreaterThan(1000);
      expect(buffer.subarray(0, 5).toString("utf-8")).toBe("%PDF-");
    });

    it("GET /api/v1/patients/[id]/export enforces tenant isolation (404 for cross-tenant)", async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/patients/${patientId}/export?format=json`, {
        headers: {
          authorization: `Bearer ${keyB.rawToken}`,
        },
      });

      const res = await exportRoute(req, { params: Promise.resolve({ id: patientId }) });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("GET /api/v1/patients/[id]/export returns 401 when unauthorized", async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/patients/${patientId}/export?format=json`);
      const res = await exportRoute(req, { params: Promise.resolve({ id: patientId }) });
      expect(res.status).toBe(401);
    });
  });

  describe("Task 2: DPDP Soft-Delete Erasure Workflow & Search Suppression", () => {
    let secondPatientId: string;

    beforeAll(async () => {
      const admin = getAdminClient();
      // Seed a second patient in tenant A specifically to test erasure via DELETE route
      const { data: p2 } = await admin
        .from("patients")
        .insert({
          tenant_id: tenantA.tenantId,
          full_name: "Rohan Varma",
          phone: "+919123456789",
          age: 42,
          sex: "male",
          created_by: tenantA.userId,
        })
        .select("id")
        .single();
      secondPatientId = p2!.id;
    });

    it("erasePatientRecord marks is_deleted = true, status = 'erased', and populates erased_at", async () => {
      const reason = "Patient submitted DPDP formal erasure notice";
      const result = await erasePatientRecord(
        patientId,
        reason,
        {
          tenantId: tenantA.tenantId,
          userId: tenantA.userId,
          role: "owner",
          actorType: "user",
        }
      );

      expect(result.success).toBe(true);
      expect(result.retentionPolicy).toBe("NMC_REGULATION_1.3.1_3_YEAR_MANDATE");
      expect(result.erasedAt).toBeDefined();

      const admin = getAdminClient();
      const { data: p } = await admin
        .from("patients")
        .select("*")
        .eq("id", patientId)
        .single();

      expect(p.is_deleted).toBe(true);
      expect(p.status).toBe("erased");
      expect(p.erased_at).toBeDefined();
      expect(p.erasure_reason).toBe(reason);
    });

    it("underlying clinical records (visits, prescriptions, invoices) are preserved (NO HARD DELETE)", async () => {
      const admin = getAdminClient();

      const { data: visits } = await admin
        .from("visits")
        .select("id")
        .eq("patient_id", patientId);
      expect(visits!.length).toBeGreaterThanOrEqual(1);

      const { data: prescriptions } = await admin
        .from("prescriptions")
        .select("id")
        .eq("patient_id", patientId);
      expect(prescriptions!.length).toBeGreaterThanOrEqual(1);

      const { data: invoices } = await admin
        .from("invoices")
        .select("id")
        .eq("patient_id", patientId);
      expect(invoices!.length).toBeGreaterThanOrEqual(1);
    });

    it("searchPatients, getPatient, and getPatients suppress erased patients from active queries", async () => {
      const ctx = ctxFor(tenantA);

      // 1. searchPatients by name: should NOT return erased Aarav Sharma
      const searchResults = await searchPatients(ctx, "Aarav");
      expect(searchResults.some((p) => p.id === patientId)).toBe(false);

      // 2. getPatient: returns null for erased patient
      const patient = await getPatient(ctx, patientId, false);
      expect(patient).toBeNull();

      // 3. getPatient with includeErased=true returns the record for compliance audit
      const complianceRecord = await getPatient(ctx, patientId, true);
      expect(complianceRecord).not.toBeNull();
      expect(complianceRecord?.id).toBe(patientId);
      expect(complianceRecord?.is_deleted).toBe(true);

      // 4. getPatients list helper excludes erased patients
      const list = await getPatients(ctx);
      expect(list.some((p) => p.id === patientId)).toBe(false);
    });

    it("audit log records compliance entry with retention policy NMC_REGULATION_1.3.1_3_YEAR_MANDATE", async () => {
      const admin = getAdminClient();
      const { data: logs } = await admin
        .from("audit_logs")
        .select("*")
        .eq("entity_id", patientId)
        .eq("action", "dpdp.patient_erasure")
        .order("occurred_at", { ascending: false });

      expect(logs).toBeDefined();
      expect(logs!.length).toBeGreaterThanOrEqual(1);
      const log = logs![0];
      expect(log.metadata?.retention_policy).toBe("NMC_REGULATION_1.3.1_3_YEAR_MANDATE");
      expect(log.metadata?.status).toBe("erased");
    });

    it("DELETE /api/v1/patients/[id] delegates to erasePatientRecord and returns success envelope", async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/patients/${secondPatientId}`, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "Patient DPDP erasure request via external portal" }),
      });

      const res = await deletePatientRoute(req, { params: Promise.resolve({ id: secondPatientId }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.success).toBe(true);
      expect(json.data.message).toContain("NMC statutory retention policy");
      expect(json.data.retention_policy).toBe("NMC_REGULATION_1.3.1_3_YEAR_MANDATE");

      // Verify patient is erased in database
      const admin = getAdminClient();
      const { data: p } = await admin
        .from("patients")
        .select("is_deleted, status, erasure_reason")
        .eq("id", secondPatientId)
        .single();
      expect(p.is_deleted).toBe(true);
      expect(p.status).toBe("erased");
      expect(p.erasure_reason).toBe("Patient DPDP erasure request via external portal");
    });
  });

  describe("Task 3: Single Global Consent Toggle & Statutory Registrations Persistence", () => {
    let consentPatientId: string;

    beforeAll(async () => {
      const admin = getAdminClient();
      const { data: cp } = await admin
        .from("patients")
        .insert({
          tenant_id: tenantA.tenantId,
          full_name: "Meera Nair",
          phone: "+919445566778",
          age: 29,
          sex: "female",
          created_by: tenantA.userId,
        })
        .select("id")
        .single();
      consentPatientId = cp!.id;
    });

    it("toggleGlobalConsent records global, treatment, and data_sharing consent entries", async () => {
      const ctx = ctxFor(tenantA);

      // 1. Withdraw consent globally
      const withdrawRes = await toggleGlobalConsent(
        ctx,
        consentPatientId,
        "withdrawn",
        "Patient withdrew all processing consent"
      );
      expect(withdrawRes.success).toBe(true);

      const admin = getAdminClient();
      const { data: withdrawnRecords } = await admin
        .from("consent_records")
        .select("*")
        .eq("patient_id", consentPatientId)
        .order("recorded_at", { ascending: false })
        .limit(3);

      expect(withdrawnRecords).toBeDefined();
      expect(withdrawnRecords!.length).toBe(3);
      expect(withdrawnRecords!.every((r) => r.status === "withdrawn")).toBe(true);
      const typesWithdrawn = withdrawnRecords!.map((r) => r.consent_type);
      expect(typesWithdrawn).toContain("global");
      expect(typesWithdrawn).toContain("treatment");
      expect(typesWithdrawn).toContain("data_sharing");

      // Verify audit log
      const { data: withdrawLogs } = await admin
        .from("audit_logs")
        .select("*")
        .eq("entity_id", withdrawnRecords![0].id)
        .eq("action", "patient.consent.withdrawn");
      expect(withdrawLogs!.length).toBeGreaterThanOrEqual(1);

      // 2. Grant consent globally
      const grantRes = await toggleGlobalConsent(
        ctx,
        consentPatientId,
        "granted",
        "Patient re-consented to clinical treatment & records"
      );
      expect(grantRes.success).toBe(true);

      const { data: grantedRecords } = await admin
        .from("consent_records")
        .select("*")
        .eq("patient_id", consentPatientId)
        .order("recorded_at", { ascending: false })
        .limit(3);

      expect(grantedRecords!.every((r) => r.status === "granted")).toBe(true);
      const typesGranted = grantedRecords!.map((r) => r.consent_type);
      expect(typesGranted).toContain("global");
      expect(typesGranted).toContain("treatment");
      expect(typesGranted).toContain("data_sharing");
    });

    it("updateStatutorySettings persists registration numbers and audits changes", async () => {
      const session = {
        userId: tenantB.userId,
        tenantId: tenantB.tenantId,
      };

      const result = await updateStatutorySettings(
        {
          clinical_establishment_reg_no: "CEA-KA-2023-1122",
          state_medical_council_reg_no: "KMC/REG/44910",
          gstin: "29AAAAA0000A1Z5",
          drug_license_no: "KA-DL-20B-9988",
        },
        undefined,
        session
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.tenant.clinical_establishment_reg_no).toBe("CEA-KA-2023-1122");
        expect(result.tenant.state_medical_council_reg_no).toBe("KMC/REG/44910");
        expect(result.tenant.gstin).toBe("29AAAAA0000A1Z5");
        expect(result.tenant.drug_license_no).toBe("KA-DL-20B-9988");
      }

      // Verify audit log
      const admin = getAdminClient();
      const { data: logs } = await admin
        .from("audit_logs")
        .select("*")
        .eq("entity_id", tenantB.tenantId)
        .eq("action", "clinic.settings.update")
        .order("occurred_at", { ascending: false });

      expect(logs).toBeDefined();
      expect(logs!.length).toBeGreaterThanOrEqual(1);
    });

    it("updateStatutorySettings validates GSTIN format and rejects invalid GSTIN", async () => {
      const session = {
        userId: tenantB.userId,
        tenantId: tenantB.tenantId,
      };

      const result = await updateStatutorySettings(
        {
          gstin: "INVALID_GSTIN_123",
        },
        undefined,
        session
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("15-character Indian GSTIN");
      }
    });

    it("generateAndArchivePrescriptionPdf enriches statutory registration fields in payload and PDF", async () => {
      const pdfResult = await generateAndArchivePrescriptionPdf(
        ctxFor(tenantA),
        {
          tenant_id: tenantA.tenantId,
          visit_id: visitId,
          prescription_id: prescriptionId,
          version: 1,
          letterhead_mode: "blank_paper",
          clinic: {
            name: "DPDP Test Clinic Alpha",
            address: "42 Healthcare Road",
            phone: "+919876543210",
            // Notice: statutory fields omitted here — generator should enrich from public.tenants
          },
          doctor: {
            name: "Dr. Vikram Joshi",
            qualifications: "MBBS, MD",
            medical_council_reg_no: "MMC-2015-8899",
          },
          patient: {
            full_name: "Aarav Sharma",
            age: 36,
            sex: "male",
            phone: "+919876543210",
          },
          visit: {
            visit_date: "09/11/2026",
          },
          diagnoses: [{ diagnosis_name: "Type 2 Diabetes" }],
          medications: [
            {
              medicine_name: "Metformin",
              dosage: "500 mg",
              timing: "Twice daily",
              duration: "30 days",
            },
          ],
        }
      );

      expect(pdfResult).toBeDefined();
      expect(pdfResult.buffer).toBeDefined();
      expect(Buffer.isBuffer(pdfResult.buffer)).toBe(true);
      expect(pdfResult.buffer.subarray(0, 5).toString("utf-8")).toBe("%PDF-");
    });
  });
});
