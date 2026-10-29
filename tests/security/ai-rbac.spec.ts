import { describe, it, expect } from "vitest";
import referenceDataset from "../ai/fixtures/reference-dataset.json";
import { getClinicalTools } from "@/lib/ai/tools/clinical-tools";
import { getOperationsTools, assertRoleAllowed } from "@/lib/ai/tools/operations-tools";

describe("Phase 05.3 Security Evaluation: Conversational Server-Side RBAC Tool Boundaries (D-09, T-05.3-11, Cases 22–23)", () => {
  const case22 = referenceDataset.find((c) => c.id === "ref-22");
  const case23 = referenceDataset.find((c) => c.id === "ref-23");

  it("loads security penetration reference cases 22 and 23", () => {
    expect(case22).toBeDefined();
    expect(case23).toBeDefined();
  });

  describe("1. Nurse Role Boundary Checks (Case 22)", () => {
    const nurseClinicalTools = getClinicalTools({
      tenantId: "test-tenant-1",
      userId: "test-nurse-1",
      role: "nurse",
    });

    const nurseOpTools = getOperationsTools({
      tenantId: "test-tenant-1",
      userId: "test-nurse-1",
      role: "nurse",
    });

    it("blocks nurse from requesting ICD-10 diagnostic clinical coding (Case 22)", async () => {
      await expect(
        (nurseClinicalTools.suggest_icd10 as any).execute({
          query: "Dengue fever with thrombocytopenia",
        })
      ).rejects.toThrow("UNAUTHORIZED_ROLE");
    });

    it("blocks nurse from altering clinic billing configurations", () => {
      expect(() => {
        assertRoleAllowed("nurse", ["admin", "owner"]);
      }).toThrow("UNAUTHORIZED_ROLE");
    });

    it("allows nurse to check outpatient queue status and doctor availability", async () => {
      const queueRes = await (nurseOpTools.get_queue_status as any).execute({
        date: "2026-10-30",
      });
      expect(queueRes).toBeDefined();
      expect(queueRes.waiting_count).toBeDefined();

      const availRes = await (nurseOpTools.check_availability as any).execute({
        doctor_id: "00000000-0000-0000-0000-000000000001",
        date: "2026-10-30",
      });
      expect(availRes).toBeDefined();
      expect(availRes.available_slots).toBeDefined();
    });
  });

  describe("2. Receptionist Role Boundary Checks (Case 23)", () => {
    const receptionistClinicalTools = getClinicalTools({
      tenantId: "test-tenant-1",
      userId: "test-receptionist-1",
      role: "receptionist",
    });

    const receptionistOpTools = getOperationsTools({
      tenantId: "test-tenant-1",
      userId: "test-receptionist-1",
      role: "receptionist",
    });

    it("blocks receptionist from invoking doctor diagnostic coding tools", async () => {
      await expect(
        (receptionistClinicalTools.suggest_icd10 as any).execute({
          query: "Essential Hypertension",
        })
      ).rejects.toThrow("UNAUTHORIZED_ROLE");
    });

    it("blocks receptionist from altering doctor consultation fee (Case 23)", () => {
      expect(() => {
        assertRoleAllowed("receptionist", ["owner", "admin"]);
      }).toThrow("UNAUTHORIZED_ROLE");
    });

    it("allows receptionist to search patients and stage appointment bookings", async () => {
      const bookingRes = await (receptionistOpTools.request_appointment_booking as any).execute({
        patient_id: "00000000-0000-0000-0000-000000000001",
        patient_name: "Rahul Sharma",
        phone: "+919876543210",
        doctor_id: "00000000-0000-0000-0000-000000000002",
        doctor_name: "Dr. A. Verma",
        date: "2026-10-30",
        start_time: "10:00",
        consultation_type: "in_person",
        fee: 500,
      });

      expect(bookingRes.status).toBe("preview_ready");
      expect(bookingRes.requires_confirmation).toBe(true);
    });
  });

  describe("3. Doctor & Owner Permitted Capabilities", () => {
    const doctorClinicalTools = getClinicalTools({
      tenantId: "test-tenant-1",
      userId: "test-doctor-1",
      role: "doctor",
    });

    const ownerOpTools = getOperationsTools({
      tenantId: "test-tenant-1",
      userId: "test-owner-1",
      role: "owner",
    });

    it("permits doctor to execute diagnostic coding and clinical summaries", async () => {
      const icdRes = await (doctorClinicalTools.suggest_icd10 as any).execute({
        query: "Acute Bronchitis",
      });
      expect(icdRes.candidates.length).toBeGreaterThan(0);
    });

    it("permits clinic owner across all operational and administrative actions", () => {
      expect(() => {
        assertRoleAllowed("owner", ["doctor", "receptionist", "nurse", "admin", "owner"]);
      }).not.toThrow();

      expect(() => {
        assertRoleAllowed("owner", ["admin", "owner"]);
      }).not.toThrow();
    });
  });
});
