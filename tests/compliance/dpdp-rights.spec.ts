import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { exportPatientDpdpArchive } from "@/features/dpdp/export";
import { generateDpdpMedicalSummaryPdf } from "@/features/dpdp/pdf/generator";
import { GET as exportRoute } from "@/app/api/v1/patients/[id]/export/route";
import { seedTenantWithOwner, addMemberToTenant } from "../helpers/tenants";
import { createApiKeySecret } from "@/lib/api/auth";
import { getAdminClient } from "@/lib/supabase/admin";

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
});
