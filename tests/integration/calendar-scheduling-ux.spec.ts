import { describe, it, expect, vi } from "vitest";
import { checkSlotAvailability } from "@/features/visits/scheduling-service";
import { confirmAppointment } from "@/features/visits/service";
import { mockCtx } from "../helpers/context";
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
    // The user-path audit row goes through public.log_audit (V2-05 05-02c).
    rpc: async () => ({ data: 1, error: null }),
    from: (table: string) => {
      if (table === "memberships") {
        // Any chain of eq filters (tenant, user and, since V2-05 05-05, status = 'active') ends in maybeSingle.
        const member = {
          id: "mem-doc-1",
          user_id: "22222222-2222-4222-8222-222222222222",
          tenant_id: "tenant-100",
          role: "doctor",
          status: "active",
          default_slot_duration_minutes: 45,
          availability_schedule: mockSchedule,
        };
        const chain: { eq: () => typeof chain; maybeSingle: () => Promise<{ data: typeof member }> } = {
          eq: () => chain,
          maybeSingle: async () => ({ data: member }),
        };
        return { select: () => chain };
      }
      if (table === "patients") {
        // createVisit checks the patient is an active patient of the caller's clinic (P0-13, lib/auth/tenant-refs.ts):
        // any chain of eq/is filters ends in maybeSingle/single.
        const patient = { id: "11111111-1111-4111-8111-111111111111" };
        const filters: Record<string, unknown> = {
          eq: () => filters,
          is: () => filters,
          maybeSingle: async () => ({ data: patient, error: null }),
          single: async () => ({ data: patient, error: null }),
        };
        return { select: () => filters };
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
            eq: (col: string, val: string) => {
              const byId = async () => ({ data: existingVisits.find((v) => v.id === val) || null, error: null });
              return {
                single: byId,
                // By id: the services also filter on the caller's clinic (AR-M2b); the slot query filters on the doctor.
                eq: () => ({
                  single: byId,
                  gte: () => ({
                    lt: () => ({
                      not: async () => ({ data: existingVisits, error: null }),
                    }),
                  }),
                }),
              };
            },
          }),
          update: (payload: any) => ({
            eq: (col: string, val: string) => {
              const apply = () => {
                const target = existingVisits.find((v) => v.id === val);
                if (target) Object.assign(target, payload);
                return { error: null };
              };
              // Awaited directly, or after a further `.eq("tenant_id", …)`.
              return { then: (resolve: (r: { error: null }) => unknown) => resolve(apply()), eq: async () => apply() };
            },
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
        mockCtx(mockClient, mockSession),
        "22222222-2222-4222-8222-222222222222",
        "2026-10-19T04:00:00.000Z",
        15
      );

      expect(res.available).toBe(true);
      expect(res.isOffDuty).toBeUndefined();
    });

    it("permits booking during active evening shift (17:00 - 21:30 IST)", async () => {
      const mockClient = createMockSupabase();

      // Monday 2026-10-19 at 18:30 IST = 13:00 UTC
      const res = await checkSlotAvailability(
        mockCtx(mockClient, mockSession),
        "22222222-2222-4222-8222-222222222222",
        "2026-10-19T13:00:00.000Z",
        15
      );

      expect(res.available).toBe(true);
      expect(res.isOffDuty).toBeUndefined();
    });

    it("flags afternoon break as off-duty (14:30 IST = 09:00 UTC)", async () => {
      const mockClient = createMockSupabase();

      // Monday 2026-10-19 at 14:30 IST = 09:00 UTC
      const res = await checkSlotAvailability(
        mockCtx(mockClient, mockSession),
        "22222222-2222-4222-8222-222222222222",
        "2026-10-19T09:00:00.000Z",
        15
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
        mockCtx(mockClient, mockSession),
        "22222222-2222-4222-8222-222222222222",
        "2026-10-19T05:00:00.000Z",
        15
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
        mockCtx(mockClient, mockSession),
        "22222222-2222-4222-8222-222222222222",
        "2026-10-19T05:15:00.000Z",
        15
      );

      expect(res.available).toBe(true);
    });
  });

  // 4. Soft-block emergency overrides (T-03.3-06): the off-duty and block checks and their overrides run inside the
  // register_and_book command since V2-07 07-03, so they are proven against the real database in
  // tests/visits/register-and-book-rpc.spec.ts (SLOT_OFF_DUTY, SLOT_BLOCKED, p_override_off_duty, p_override_block).

  describe("5. Soft-Book & Manual Appointment Confirmation (Soft-Book / Confirmed State Transition)", () => {
    it("transitions booked visit to confirmed with staff metadata and audit trail", async () => {
      const existingVisits = [
        {
          id: "v-soft-book-1",
          tenant_id: "tenant-100",
          patient_id: "11111111-1111-4111-8111-111111111111",
          doctor_id: "22222222-2222-4222-8222-222222222222",
          status: "booked",
          scheduled_at: "2026-10-19T04:30:00.000Z",
          metadata: {} as Record<string, unknown>,
        },
      ];

      const mockClient = createMockSupabase({ existingVisits });

      const confirmRes = await confirmAppointment(mockCtx(mockClient, mockSession), "v-soft-book-1");

      expect(confirmRes.success).toBe(true);
      expect(existingVisits[0].status).toBe("confirmed");
      expect(existingVisits[0].metadata?.clinic_confirmed).toBe(true);
      expect(existingVisits[0].metadata?.confirmed_via).toBe("staff_calendar");
    });

    it("rejects confirmation if visit is already cancelled", async () => {
      const existingVisits = [
        {
          id: "v-cancelled-1",
          tenant_id: "tenant-100",
          status: "cancelled",
        },
      ];

      const mockClient = createMockSupabase({ existingVisits });

      const confirmRes = await confirmAppointment(mockCtx(mockClient, mockSession), "v-cancelled-1");

      expect(confirmRes.success).toBe(false);
      if (!confirmRes.success) {
        expect(confirmRes.error).toContain("Cannot confirm a cancelled appointment");
      }
    });

    it("properly normalizes doctor titles without double 'Dr. Dr.' prefixing", () => {
      expect(formatDoctorDisplayName("Dr. Nupur Goel")).toBe("Dr. Nupur Goel");
      expect(formatDoctorDisplayName("Dr Nupur Goel")).toBe("Dr Nupur Goel");
      expect(formatDoctorDisplayName("Nupur Goel")).toBe("Dr. Nupur Goel");
      expect(formatDoctorDisplayName(null)).toBe("Doctor");
    });
  });
});
