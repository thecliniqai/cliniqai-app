import { describe, it, expect, vi } from "vitest";
import { computeDateRange, visitsFilterSchema } from "@/features/visits/schema";
import {
  getClinicVisitsRegister,
  getActiveClinicDoctors,
} from "@/features/visits/actions";

describe("Clinic Visits Register & Filters (Plan 03.2-02 / REQ-diagnosis-visit-management)", () => {
  describe("computeDateRange (Date Math & Boundaries)", () => {
    const fixedNow = new Date("2026-10-16T14:30:00.000Z");

    it("calculates today boundary from 00:00:00 to 23:59:59.999", () => {
      const { startIso, endIso } = computeDateRange("today", null, null, fixedNow);
      const start = new Date(startIso);
      const end = new Date(endIso);

      expect(start.getUTCDate()).toBe(fixedNow.getUTCDate());
      expect(start.getUTCHours()).toBe(0);
      expect(start.getUTCMinutes()).toBe(0);
      expect(end.getUTCDate()).toBe(fixedNow.getUTCDate());
      expect(end.getUTCHours()).toBe(23);
      expect(end.getUTCMinutes()).toBe(59);
    });

    it("calculates yesterday boundary correctly", () => {
      const { startIso, endIso } = computeDateRange("yesterday", null, null, fixedNow);
      const start = new Date(startIso);
      const end = new Date(endIso);

      expect(start.getUTCDate()).toBe(fixedNow.getUTCDate() - 1);
      expect(end.getUTCDate()).toBe(fixedNow.getUTCDate() - 1);
    });

    it("calculates last_7_days boundary covering 7 calendar days", () => {
      const { startIso, endIso } = computeDateRange("last_7_days", null, null, fixedNow);
      const start = new Date(startIso);
      const end = new Date(endIso);

      const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(7);
    });

    it("calculates this_month starting on day 1", () => {
      const { startIso, endIso } = computeDateRange("this_month", null, null, fixedNow);
      const start = new Date(startIso);
      const end = new Date(endIso);

      expect(start.getUTCDate()).toBe(1);
      expect(start.getUTCMonth()).toBe(fixedNow.getUTCMonth());
      expect(end.getUTCMonth()).toBe(fixedNow.getUTCMonth());
    });

    it("accepts custom date range boundaries", () => {
      const { startIso, endIso } = computeDateRange(
        "custom",
        "2026-10-01",
        "2026-10-10",
        fixedNow
      );

      expect(startIso.startsWith("2026-10-01")).toBe(true);
      expect(endIso.startsWith("2026-10-10")).toBe(true);
    });
  });

  describe("getClinicVisitsRegister (Data Access & Multi-Tenant Enforcement)", () => {
    const tenantId = "tenant-apollo-1";
    const doctorId = "doc-dr-raj";
    const patientId = "patient-p1";

    const mockVisits = [
      {
        id: "v-1",
        tenant_id: tenantId,
        patient_id: patientId,
        doctor_id: doctorId,
        origin_type: "walk_in",
        status: "completed",
        scheduled_at: null,
        created_at: "2026-10-16T09:30:00Z",
        reason_for_visit: "Cough and cold",
        specialty: "general_physician",
      },
      {
        id: "v-2",
        tenant_id: tenantId,
        patient_id: patientId,
        doctor_id: doctorId,
        origin_type: "scheduled",
        status: "in_consultation",
        scheduled_at: "2026-10-16T10:00:00Z",
        created_at: "2026-10-16T10:00:00Z",
        reason_for_visit: "Routine follow-up",
        specialty: "general_physician",
      },
      {
        id: "v-3",
        tenant_id: tenantId,
        patient_id: "patient-p2",
        doctor_id: "doc-dr-sneha",
        origin_type: "walk_in",
        status: "waiting",
        scheduled_at: null,
        created_at: "2026-10-16T10:15:00Z",
        reason_for_visit: "Skin allergy",
        specialty: "general_physician",
      },
    ];

    const mockInvoices = [
      {
        id: "inv-1",
        visit_id: "v-1",
        tenant_id: tenantId,
        invoice_number: "INV-001",
        total_amount: 600,
        status: "paid",
      },
      {
        id: "inv-2",
        visit_id: "v-2",
        tenant_id: tenantId,
        invoice_number: "INV-002",
        total_amount: 400,
        status: "draft",
      },
    ];

    it("strictly isolates queries to active tenant and calculates summary metrics", async () => {
      let appliedTenantFilter = "";

      const mockClient: any = {
        from: vi.fn((table: string) => {
          const query: any = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn((col: string, val: any) => {
              if (col === "tenant_id") appliedTenantFilter = val;
              return query;
            }),
            gte: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            then: (resolve: any) => {
              if (table === "visits") {
                const filtered = mockVisits.filter((v) => v.tenant_id === appliedTenantFilter);
                return resolve({ data: filtered, error: null });
              }
              if (table === "invoices") {
                return resolve({ data: mockInvoices, error: null });
              }
              if (table === "patients") {
                return resolve({
                  data: [
                    {
                      id: patientId,
                      full_name: "Rahul Sharma",
                      phone: "+919876543210",
                      age: 32,
                      sex: "male",
                      abha_id: "91-1234-5678-9012",
                    },
                    {
                      id: "patient-p2",
                      full_name: "Pooja Verma",
                      phone: "+919876543211",
                      age: 28,
                      sex: "female",
                    },
                  ],
                  error: null,
                });
              }
              if (table === "memberships") {
                return resolve({
                  data: [
                    {
                      user_id: doctorId,
                      full_name: "Dr. Raj Malhotra",
                      qualifications: "MBBS, MD",
                      default_specialty: "General Medicine",
                      role: "doctor",
                    },
                    {
                      user_id: "doc-dr-sneha",
                      full_name: "Dr. Sneha Roy",
                      qualifications: "MBBS",
                      default_specialty: "General Medicine",
                      role: "doctor",
                    },
                  ],
                  error: null,
                });
              }
              if (table === "queue_tokens") {
                return resolve({
                  data: [
                    { visit_id: "v-1", token_number: 1 },
                    { visit_id: "v-2", token_number: 2 },
                  ],
                  error: null,
                });
              }
              if (table === "consultation_diagnoses") {
                return resolve({
                  data: [
                    {
                      id: "d-1",
                      visit_id: "v-1",
                      diagnosis_name: "Viral Bronchitis",
                      icd11_code: "CA42",
                      is_chronic: false,
                    },
                  ],
                  error: null,
                });
              }
              if (table === "prescriptions") {
                return resolve({
                  data: [
                    {
                      id: "rx-1",
                      visit_id: "v-1",
                      version: 1,
                      status: "active",
                      signed_at: "2026-10-16T09:45:00Z",
                    },
                  ],
                  error: null,
                });
              }
              if (table === "prescription_items") {
                return resolve({
                  data: [
                    {
                      id: "item-1",
                      prescription_id: "rx-1",
                      medicine_name: "Azithromycin 500mg",
                      dosage: "1-0-0",
                      duration: "3 days",
                    },
                  ],
                  error: null,
                });
              }
              if (table === "payments") {
                return resolve({
                  data: [{ invoice_id: "inv-1", amount: 600 }],
                  error: null,
                });
              }
              return resolve({ data: [], error: null });
            },
          };
          return query;
        }),
      };

      const result = await getClinicVisitsRegister(
        { datePreset: "today" },
        mockClient,
        { userId: "usr-admin", tenantId }
      );

      // Verify tenant isolation
      expect(appliedTenantFilter).toBe(tenantId);

      // Verify metrics
      expect(result.totalCount).toBe(3);
      expect(result.metrics.totalVisits).toBe(3);
      expect(result.metrics.completedVisits).toBe(1);
      expect(result.metrics.inProgressVisits).toBe(1);
      expect(result.metrics.waitingVisits).toBe(1);
      expect(result.metrics.totalBilledRevenue).toBe(1000); // 600 + 400

      // Verify joined data
      expect(result.visits.length).toBe(3);
      expect(result.visits[0].patient.full_name).toBe("Rahul Sharma");
      expect(result.visits[0].doctor.full_name).toBe("Dr. Raj Malhotra");
      expect(result.visits[0].diagnoses[0].diagnosis_name).toBe("Viral Bronchitis");
      expect(result.visits[0].prescription?.item_count).toBe(1);
      expect(result.visits[0].invoice?.status).toBe("paid");
      expect(result.visits[0].invoice?.balance_due).toBe(0);
    });

    it("filters active clinic doctors by tenant", async () => {
      let docTenant = "";
      const mockClient: any = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((col: string, val: any) => {
            if (col === "tenant_id") docTenant = val;
            return {
              in: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              then: (resolve: any) =>
                resolve({
                  data: [
                    {
                      id: "mem-1",
                      user_id: "u-1",
                      full_name: "Dr. Mehta",
                      qualifications: "MD",
                      default_specialty: "Cardiology",
                      role: "doctor",
                    },
                  ],
                  error: null,
                }),
            };
          }),
        })),
      };

      const doctors = await getActiveClinicDoctors(mockClient, {
        userId: "u-1",
        tenantId: "tenant-cardio-9",
      });

      expect(docTenant).toBe("tenant-cardio-9");
      expect(doctors.length).toBe(1);
      expect(doctors[0].full_name).toBe("Dr. Mehta");
    });
  });
});
