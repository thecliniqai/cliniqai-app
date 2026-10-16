import { describe, it, expect, vi } from "vitest";
import { checkSlotAvailability, bookAppointment } from "@/features/visits/scheduling";
import { formatDoctorDisplayName } from "@/features/staff/formatters";
import { DoctorWeeklySchedule } from "@/lib/db/types";

const mockSchedule: DoctorWeeklySchedule = {
  monday: {
    enabled: true,
    shifts: [
      { start: "08:00", end: "13:00" },
      { start: "17:00", end: "21:30" },
    ],
  },
  tuesday: { enabled: true, shifts: [{ start: "08:00", end: "13:00" }] },
  wednesday: { enabled: true, shifts: [{ start: "08:00", end: "13:00" }] },
  thursday: { enabled: true, shifts: [{ start: "08:00", end: "13:00" }] },
  friday: { enabled: true, shifts: [{ start: "08:00", end: "13:00" }] },
  saturday: { enabled: true, shifts: [{ start: "08:00", end: "13:00" }] },
  sunday: { enabled: false, shifts: [] },
};

function createMockSupabase(overrides?: {
  existingVisits?: any[];
  scheduleBlocks?: any[];
  insertedVisits?: any[];
}) {
  const existingVisits = overrides?.existingVisits || [];
  const scheduleBlocks = overrides?.scheduleBlocks || [];
  const insertedVisits = overrides?.insertedVisits || [];

  return {
    from: (table: string) => {
      if (table === "memberships") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "mem-doc-1",
                    user_id: "22222222-2222-4222-8222-222222222222",
                    tenant_id: "tenant-100",
                    role: "doctor",
                    default_slot_duration_minutes: 45,
                    availability_schedule: mockSchedule,
                  },
                }),
              }),
            }),
          }),
        };
      }
      if (table === "schedule_blocks") {
        return {
          select: () => ({
            eq: () => ({
              or: () => ({
                lte: () => ({
                  gte: async () => ({ data: scheduleBlocks, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "visits") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                gte: () => ({
                  lte: () => ({
                    not: async () => ({ data: existingVisits, error: null }),
                  }),
                }),
              }),
            }),
          }),
          insert: (payload: any) => {
            const newV = { id: `visit-${Date.now()}`, ...payload };
            insertedVisits.push(newV);
            return {
              select: () => ({
                single: async () => ({ data: newV, error: null }),
              }),
            };
          },
        };
      }
      if (table === "audit_logs") {
        return {
          insert: async () => ({ data: null, error: null }),
        };
      }
      return {
        select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }),
        insert: async () => ({ data: null, error: null }),
      };
    },
  } as any;
}

const mockSession = {
  userId: "user-staff-1",
  tenantId: "tenant-100",
};

describe("Calendar & Scheduling UX Integration (REQ-appointment-booking)", () => {
  describe("1. Centralized Doctor Display Name Resolution", () => {
    it("never returns raw UUID fragments and formats doctor titles properly", () => {
      const formatted1 = formatDoctorDisplayName("Dr. Sarah Connor", 1);
      expect(formatted1).toBe("Dr. Sarah Connor");

      const formatted2 = formatDoctorDisplayName("Rajesh Koothrappali", 2);
      expect(formatted2).toBe("Dr. Rajesh Koothrappali");

      // Empty name falls back to index-based label, never UUID
      const fallback = formatDoctorDisplayName(null, 3);
      expect(fallback).toBe("Doctor (3)");
      expect(fallback).not.toContain("-");
    });
  });

  describe("2. Dynamic Doctor Shift Bounds & Off-Duty Detection", () => {
    // Note: Clinic operates in IST (UTC +5:30)
    // 04:00 UTC = 09:30 IST (inside morning shift 08:00 - 13:00)
    // 13:00 UTC = 18:30 IST (inside evening shift 17:00 - 21:30)
    // 09:00 UTC = 14:30 IST (afternoon break / off-duty)

    it("permits booking during active morning shift (08:00 - 13:00 IST)", async () => {
      const mockClient = createMockSupabase();

      // Monday 2026-10-19 at 09:30 IST = 04:00 UTC
      const res = await checkSlotAvailability(
        "22222222-2222-4222-8222-222222222222",
        "2026-10-19T04:00:00.000Z",
        15,
        mockClient,
        mockSession
      );

      expect(res.available).toBe(true);
      expect(res.isOffDuty).toBeUndefined();
    });

    it("permits booking during active evening shift (17:00 - 21:30 IST)", async () => {
      const mockClient = createMockSupabase();

      // Monday 2026-10-19 at 18:30 IST = 13:00 UTC
      const res = await checkSlotAvailability(
        "22222222-2222-4222-8222-222222222222",
        "2026-10-19T13:00:00.000Z",
        15,
        mockClient,
        mockSession
      );

      expect(res.available).toBe(true);
      expect(res.isOffDuty).toBeUndefined();
    });

    it("flags afternoon break as off-duty (14:30 IST = 09:00 UTC)", async () => {
      const mockClient = createMockSupabase();

      // Monday 2026-10-19 at 14:30 IST = 09:00 UTC
      const res = await checkSlotAvailability(
        "22222222-2222-4222-8222-222222222222",
        "2026-10-19T09:00:00.000Z",
        15,
        mockClient,
        mockSession
      );

      expect(res.available).toBe(false);
      expect(res.isOffDuty).toBe(true);
    });
  });

  describe("3. Multi-Slot Double Booking & Overlap Prevention (T-03.3-05)", () => {
    it("detects conflict when a new appointment overlaps with an ongoing 45m appointment", async () => {
      // Existing 45-minute dental visit from 04:30 to 05:15 UTC (10:00 - 10:45 IST)
      const existingVisits = [
        {
          id: "v-existing-1",
          doctor_id: "22222222-2222-4222-8222-222222222222",
          tenant_id: "tenant-100",
          scheduled_at: "2026-10-19T04:30:00.000Z",
          estimated_duration_minutes: 45,
          status: "booked",
        },
      ];

      const mockClient = createMockSupabase({ existingVisits });

      // Attempting to book at 05:00 UTC (10:30 IST, within the 10:00–10:45 window)
      const res = await checkSlotAvailability(
        "22222222-2222-4222-8222-222222222222",
        "2026-10-19T05:00:00.000Z",
        15,
        mockClient,
        mockSession
      );

      expect(res.available).toBe(false);
      expect(res.conflictingVisit?.id).toBe("v-existing-1");
    });

    it("permits booking immediately after the 45m appointment ends (05:15 UTC = 10:45 IST)", async () => {
      const existingVisits = [
        {
          id: "v-existing-1",
          doctor_id: "22222222-2222-4222-8222-222222222222",
          tenant_id: "tenant-100",
          scheduled_at: "2026-10-19T04:30:00.000Z",
          estimated_duration_minutes: 45,
          status: "booked",
        },
      ];

      const mockClient = createMockSupabase({ existingVisits });

      // Slot at 05:15 UTC (10:45 IST, after the 45-min appointment ends)
      const res = await checkSlotAvailability(
        "22222222-2222-4222-8222-222222222222",
        "2026-10-19T05:15:00.000Z",
        15,
        mockClient,
        mockSession
      );

      expect(res.available).toBe(true);
    });
  });

  describe("4. Soft-Block Emergency Override Workflow (T-03.3-06)", () => {
    it("rejects booking during off-duty slot without override flag", async () => {
      const mockClient = createMockSupabase();

      const bookResult = await bookAppointment(
        {
          patient_id: "11111111-1111-4111-8111-111111111111",
          doctor_id: "22222222-2222-4222-8222-222222222222",
          scheduled_at: "2026-10-19T09:00:00.000Z", // 2:30 PM IST off-duty break
          estimated_duration_minutes: 15,
          reason_for_visit: "Regular checkup",
          is_overbooked: false,
          override_off_duty: false,
        },
        mockClient,
        mockSession
      );

      expect(bookResult.success).toBe(false);
      if (!bookResult.success) {
        expect(bookResult.conflict).toBe(true);
        expect(bookResult.isOffDuty).toBe(true);
      }
    });

    it("successfully creates appointment when emergency override is confirmed with justification", async () => {
      const insertedVisits: any[] = [];
      const mockClient = createMockSupabase({ insertedVisits });

      const bookResult = await bookAppointment(
        {
          patient_id: "11111111-1111-4111-8111-111111111111",
          doctor_id: "22222222-2222-4222-8222-222222222222",
          scheduled_at: "2026-10-19T09:00:00.000Z", // 2:30 PM IST off-duty break
          estimated_duration_minutes: 15,
          reason_for_visit: "[EMERGENCY OVERRIDE] Severe acute trauma approved by Dr.",
          is_overbooked: true,
          override_off_duty: true,
        },
        mockClient,
        mockSession
      );

      expect(bookResult.success).toBe(true);
      expect(insertedVisits.length).toBe(1);
      expect(insertedVisits[0].is_overbooked).toBe(true);
      expect(insertedVisits[0].reason_for_visit).toContain("[EMERGENCY OVERRIDE]");
    });

    it("successfully books when overriding a doctor schedule block for an emergency", async () => {
      const scheduleBlocks = [
        {
          id: "block-ot-1",
          tenant_id: "tenant-100",
          doctor_id: "22222222-2222-4222-8222-222222222222",
          start_time: "2026-10-19T04:00:00.000Z", // 09:30 IST
          end_time: "2026-10-19T06:00:00.000Z",   // 11:30 IST
          reason: "In Operation Theatre",
          all_day: false,
        },
      ];

      const insertedVisits: any[] = [];
      const mockClient = createMockSupabase({ scheduleBlocks, insertedVisits });

      // First try without override -> should be blocked
      const blockedRes = await bookAppointment(
        {
          patient_id: "11111111-1111-4111-8111-111111111111",
          doctor_id: "22222222-2222-4222-8222-222222222222",
          scheduled_at: "2026-10-19T04:30:00.000Z", // 10:00 IST (during OT block)
          estimated_duration_minutes: 15,
          override_block: false,
        },
        mockClient,
        mockSession
      );

      expect(blockedRes.success).toBe(false);
      if (!blockedRes.success) {
        expect(blockedRes.isBlocked).toBe(true);
        expect(blockedRes.error).toContain("In Operation Theatre");
      }

      // Second try with emergency override -> succeeds
      const overrideRes = await bookAppointment(
        {
          patient_id: "11111111-1111-4111-8111-111111111111",
          doctor_id: "22222222-2222-4222-8222-222222222222",
          scheduled_at: "2026-10-19T04:30:00.000Z",
          estimated_duration_minutes: 15,
          reason_for_visit: "[EMERGENCY OVERRIDE] Patient in ICU needing immediate consult",
          is_overbooked: true,
          override_block: true,
        },
        mockClient,
        mockSession
      );

      expect(overrideRes.success).toBe(true);
      expect(insertedVisits.length).toBe(1);
    });
  });
});
