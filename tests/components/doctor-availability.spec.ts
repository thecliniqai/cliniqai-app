import { describe, it, expect, vi } from "vitest";
import {
  doctorWeeklyScheduleSchema,
  shiftSchema,
  dayAvailabilitySchema,
} from "@/features/settings/schema";
import {
  updateDoctorAvailability,
  updateDoctorSlotDuration,
} from "@/features/settings/actions";
import { DEFAULT_WEEKLY_SCHEDULE } from "@/components/profile/doctor-availability-card";

describe("Doctor Availability & Shifts Management UI (REQ-appointment-booking, REQ-multi-tenancy)", () => {
  describe("1. Shift Schema Validation & Integrity (T-03.3-04)", () => {
    it("accepts valid shift with start before end", () => {
      const validShift = { start: "10:00", end: "13:00" };
      const parsed = shiftSchema.safeParse(validShift);
      expect(parsed.success).toBe(true);
    });

    it("rejects shift where end time is before or equal to start time", () => {
      const invalidShift = { start: "14:00", end: "11:00" };
      const res = shiftSchema.safeParse(invalidShift);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toContain("Shift end time must be after start time");
      }

      const equalShift = { start: "10:00", end: "10:00" };
      expect(shiftSchema.safeParse(equalShift).success).toBe(false);
    });

    it("rejects malformed time strings", () => {
      expect(shiftSchema.safeParse({ start: "10:65", end: "12:00" }).success).toBe(false);
      expect(shiftSchema.safeParse({ start: "25:00", end: "26:00" }).success).toBe(false);
      expect(shiftSchema.safeParse({ start: "9:00", end: "12:00" }).success).toBe(false); // must be 09:00
    });

    it("accepts valid non-overlapping split shifts in a single day", () => {
      const validDay = {
        enabled: true,
        shifts: [
          { start: "10:00", end: "13:00" },
          { start: "17:00", end: "21:00" },
        ],
      };
      expect(dayAvailabilitySchema.safeParse(validDay).success).toBe(true);
    });

    it("rejects overlapping shifts within the same day", () => {
      const overlappingDay = {
        enabled: true,
        shifts: [
          { start: "10:00", end: "14:00" },
          { start: "13:00", end: "18:00" },
        ],
      };
      const res = dayAvailabilitySchema.safeParse(overlappingDay);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toContain("Shifts within the same day cannot overlap");
      }
    });

    it("validates full weekly schedule successfully", () => {
      const res = doctorWeeklyScheduleSchema.safeParse(DEFAULT_WEEKLY_SCHEDULE);
      expect(res.success).toBe(true);
    });
  });

  describe("2. Server Action Authorization Guards (T-03.3-03)", () => {
    it("allows doctor to update their own availability schedule", async () => {
      const mockSupabase = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: "membership-1",
                    user_id: "user-1",
                    tenant_id: "tenant-1",
                    role: "doctor",
                  },
                }),
              }),
            }),
          }),
          update: (payload: any) => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: async () => ({
                    data: { availability_schedule: payload.availability_schedule },
                  }),
                }),
              }),
            }),
          }),
          insert: () => Promise.resolve({ data: null, error: null }),
        }),
      } as any;

      const res = await updateDoctorAvailability(
        {
          membership_id: "membership-1",
          availability_schedule: DEFAULT_WEEKLY_SCHEDULE,
        },
        mockSupabase,
        { userId: "user-1", tenantId: "tenant-1" }
      );

      expect(res.success).toBe(true);
    });

    it("blocks non-admin doctor from updating another doctor's availability", async () => {
      const mockSupabase = {
        from: (table: string) => {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: async () => {
                    // When checking target membership:
                    return {
                      data: {
                        id: "membership-2",
                        user_id: "doctor-2-uuid",
                        tenant_id: "tenant-1",
                        role: "doctor",
                      },
                    };
                  },
                }),
              }),
            }),
          };
        },
      } as any;

      const res = await updateDoctorAvailability(
        {
          membership_id: "membership-2",
          availability_schedule: DEFAULT_WEEKLY_SCHEDULE,
        },
        mockSupabase,
        { userId: "doctor-1-uuid", tenantId: "tenant-1" }
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toContain("Only clinic admins or owners can update other doctors' schedules");
      }
    });

    it("allows clinic owner or admin to configure another doctor's availability on their behalf", async () => {
      let callCount = 0;
      const mockSupabase = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => {
                  callCount++;
                  if (callCount === 1) {
                    // Target member: doctor-2
                    return {
                      data: {
                        id: "membership-2",
                        user_id: "doctor-2-uuid",
                        tenant_id: "tenant-1",
                        role: "doctor",
                      },
                    };
                  }
                  // Caller member: owner
                  return {
                    data: {
                      id: "membership-owner",
                      user_id: "owner-uuid",
                      tenant_id: "tenant-1",
                      role: "owner",
                    },
                  };
                },
              }),
            }),
          }),
          update: (payload: any) => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: async () => ({
                    data: { availability_schedule: payload.availability_schedule },
                  }),
                }),
              }),
            }),
          }),
          insert: () => Promise.resolve({ data: null, error: null }),
        }),
      } as any;

      const res = await updateDoctorAvailability(
        {
          membership_id: "membership-2",
          availability_schedule: DEFAULT_WEEKLY_SCHEDULE,
        },
        mockSupabase,
        { userId: "owner-uuid", tenantId: "tenant-1" }
      );

      expect(res.success).toBe(true);
    });
  });

  describe("3. Slot Duration Configuration", () => {
    it("validates slot duration boundaries (5 to 180 mins)", async () => {
      const resTooLow = await updateDoctorSlotDuration(
        { membership_id: "mem-1", default_slot_duration_minutes: 2 },
        {} as any,
        { userId: "u1", tenantId: "t1" }
      );
      expect(resTooLow.success).toBe(false);

      const resTooHigh = await updateDoctorSlotDuration(
        { membership_id: "mem-1", default_slot_duration_minutes: 240 },
        {} as any,
        { userId: "u1", tenantId: "t1" }
      );
      expect(resTooHigh.success).toBe(false);
    });

    it("successfully saves valid slot duration (e.g. 15m, 20m, 30m, 45m, 60m)", async () => {
      const mockSupabase = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: "membership-1",
                    user_id: "user-1",
                    tenant_id: "tenant-1",
                    role: "doctor",
                  },
                }),
              }),
            }),
          }),
          update: (payload: any) => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: async () => ({
                    data: { default_slot_duration_minutes: payload.default_slot_duration_minutes },
                  }),
                }),
              }),
            }),
          }),
        }),
      } as any;

      const res = await updateDoctorSlotDuration(
        { membership_id: "membership-1", default_slot_duration_minutes: 30 },
        mockSupabase,
        { userId: "user-1", tenantId: "tenant-1" }
      );

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.default_slot_duration_minutes).toBe(30);
      }
    });
  });
});
