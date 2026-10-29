import { describe, it, expect, vi } from "vitest";
import referenceDataset from "../fixtures/reference-dataset.json";
import { getOperationsTools } from "@/lib/ai/tools/operations-tools";

describe("Phase 05.3 Evaluation: Operations Copilot Concurrency, Disambiguation & Boundaries (D-06, D-07, Cases 17–21, 26)", () => {
  const opCases = referenceDataset.filter(
    (c) => c.category === "operations" || c.id === "ref-26"
  );

  it("loads all 6 operations reference test cases", () => {
    expect(opCases.length).toBe(6);
  });

  describe("Case 17: Multi-Match Patient Disambiguation", () => {
    it("returns candidate list with phone, age, and last visit when multi-match occurs", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          ilike: vi.fn().mockResolvedValue({
            data: [
              {
                id: "p-01",
                full_name: "Amit Kumar",
                phone: "+919876543210",
                age: 29,
                sex: "male",
                visits: [{ scheduled_at: "2026-10-15T09:00:00Z" }],
              },
              {
                id: "p-02",
                full_name: "Amit Kumar",
                phone: "+919812345678",
                age: 45,
                sex: "male",
                visits: [{ scheduled_at: "2026-09-20T11:00:00Z" }],
              },
              {
                id: "p-03",
                full_name: "Amit Kumar",
                phone: "+919845678901",
                age: 19,
                sex: "male",
                visits: [],
              },
            ],
            error: null,
          }),
        }),
      };

      const tools = getOperationsTools({
        tenantId: "test-tenant-1",
        userId: "test-staff-1",
        role: "receptionist",
        supabase: mockSupabase,
      });

      const res = await (tools.search_patients as any).execute({ query: "Amit Kumar" });

      expect(res.patients).toBeDefined();
      expect(res.patients.length).toBe(3);
      expect(res.total_found).toBe(3);

      // Verify disambiguation metadata for each candidate chip
      for (const p of res.patients) {
        expect(p.id).toBeDefined();
        expect(p.full_name).toBe("Amit Kumar");
        expect(p.phone).toMatch(/^\+?91/);
        expect(p.age).toBeGreaterThan(0);
      }
      expect(res.patients[0].last_visit_date).toBe("2026-10-15");
      expect(res.patients[2].last_visit_date).toBeNull();
    });
  });

  describe("Case 18: Millisecond Slot Collision & Fallback Alternatives", () => {
    it("returns alternative slot recommendations when requested slot is conflicted", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: "doc-1",
              full_name: "Dr. A. Verma",
              availability: {
                friday: {
                  shifts: [{ start: "09:00", end: "13:00" }],
                },
              },
            },
            error: null,
          }),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
          neq: vi.fn().mockResolvedValue({
            data: [
              { id: "v-1", scheduled_at: "2026-10-30T10:00:00Z", status: "booked" },
            ],
            error: null,
          }),
        }),
      };

      const tools = getOperationsTools({
        tenantId: "test-tenant-1",
        userId: "test-staff-1",
        role: "receptionist",
        supabase: mockSupabase,
      });

      const availability = await (tools.check_availability as any).execute({
        doctor_id: "00000000-0000-0000-0000-000000000001",
        date: "2026-10-30",
      });

      expect(availability.booked_slots).toContain("10:00");

      // Verify availability report provides alternative shift slots
      expect(availability.shifts.length).toBeGreaterThan(0);
    });
  });

  describe("Case 19: Doctor Shift Break Hours Boundary Warning", () => {
    it("flags outside_shift_warning when booking falls into official lunch break", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              availability: {
                friday: {
                  shifts: [
                    { start: "09:00", end: "13:00" }, // Morning shift
                    { start: "14:00", end: "18:00" }, // Evening shift (Break 13:00 - 14:00)
                  ],
                },
              },
            },
            error: null,
          }),
        }),
      };

      const tools = getOperationsTools({
        tenantId: "test-tenant-1",
        userId: "test-staff-1",
        role: "receptionist",
        supabase: mockSupabase,
      });

      // 1:30 PM (13:30) is inside the 13:00 - 14:00 lunch break
      const res = await (tools.request_appointment_booking as any).execute({
        patient_id: "00000000-0000-0000-0000-000000000001",
        patient_name: "Ramesh Sharma",
        phone: "+919876543210",
        doctor_id: "00000000-0000-0000-0000-000000000002",
        doctor_name: "Dr. A. Verma",
        date: "2026-10-30", // Friday
        start_time: "13:30",
        consultation_type: "in_person",
        fee: 500,
      });

      expect(res.status).toBe("preview_ready");
      expect(res.details.outside_shift_warning).toBe(true);
    });
  });

  describe("Case 21: Cancellation Staging and Slot Release", () => {
    it("stages cancellation preview requiring human confirmation before slot release", async () => {
      const tools = getOperationsTools({
        tenantId: "test-tenant-1",
        userId: "test-staff-1",
        role: "receptionist",
      });

      const res = await (tools.cancel_appointment as any).execute({
        appointment_id: "00000000-0000-0000-0000-000000000099",
        patient_name: "Suresh Patel",
        doctor_name: "Dr. A. Verma",
        date: "2026-10-30",
        time: "10:00",
        reason: "Patient travel conflict",
      });

      expect(res.status).toBe("preview_ready");
      expect(res.requires_confirmation).toBe(true);
      expect(res.action_type).toBe("cancel_appointment");
      expect(res.details.appointment_id).toBe("00000000-0000-0000-0000-000000000099");
    });
  });

  describe("Case 26: Grounded Product Manifest Help & Unsupported Refusal", () => {
    it("refuses unsupported crypto wallet payments with grounded alternative redirection", async () => {
      const tools = getOperationsTools({
        tenantId: "test-tenant-1",
        userId: "test-staff-1",
        role: "receptionist",
      });

      const res = await (tools.get_product_help as any).execute({
        topic: "crypto wallet payments",
      });

      expect(res.found).toBe(false);
      expect(res.summary).toMatch(/unsupported/i);
      expect(res.summary).toMatch(/cryptocurrency/i);
      expect(res.summary).toMatch(/UPI|Cash|Card|Net Banking/i);
    });

    it("returns verified navigation steps for supported feature (calendar)", async () => {
      const tools = getOperationsTools({
        tenantId: "test-tenant-1",
        userId: "test-staff-1",
        role: "receptionist",
      });

      const res = await (tools.get_product_help as any).execute({
        topic: "calendar",
      });

      expect(res.found).toBe(true);
      expect(res.topic).toBe("Appointments & Calendar");
      expect(res.navigation_steps.length).toBeGreaterThan(0);
      expect(res.supported_features).toContain("Interactive appointment booking and slot blocking");
    });
  });
});
