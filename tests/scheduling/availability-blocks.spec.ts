import { describe, it, expect, vi } from "vitest";
import {
  timeToMinutes,
  isSlotWithinShifts,
  getTimePartsFromISO,
} from "@/features/visits/scheduling-utils";
import {
  checkSlotAvailability,
} from "@/features/visits/scheduling";
import {
  formatDoctorDisplayName,
  formatStaffDisplayName,
} from "@/features/staff/formatters";
import { DoctorWeeklySchedule, DayAvailability, ScheduleBlock } from "@/lib/db/types";

describe("Doctor Availability & Schedule Blocks (REQ-appointment-booking, REQ-multi-tenancy)", () => {
  const standardSchedule: DoctorWeeklySchedule = {
    monday: {
      enabled: true,
      shifts: [
        { start: "10:00", end: "13:00" },
        { start: "17:00", end: "21:00" },
      ],
    },
    tuesday: {
      enabled: true,
      shifts: [
        { start: "10:00", end: "13:00" },
        { start: "17:00", end: "21:00" },
      ],
    },
    wednesday: {
      enabled: true,
      shifts: [
        { start: "10:00", end: "13:00" },
        { start: "17:00", end: "21:00" },
      ],
    },
    thursday: {
      enabled: true,
      shifts: [
        { start: "10:00", end: "13:00" },
        { start: "17:00", end: "21:00" },
      ],
    },
    friday: {
      enabled: true,
      shifts: [
        { start: "10:00", end: "13:00" },
        { start: "17:00", end: "21:00" },
      ],
    },
    saturday: {
      enabled: true,
      shifts: [
        { start: "10:00", end: "13:00" },
        { start: "17:00", end: "21:00" },
      ],
    },
    sunday: {
      enabled: false,
      shifts: [],
    },
  };

  describe("1. Time Calculation & Shift In-Range Evaluation", () => {
    it("converts HH:MM strings to exact minutes from midnight", () => {
      expect(timeToMinutes("00:00")).toBe(0);
      expect(timeToMinutes("10:00")).toBe(600);
      expect(timeToMinutes("10:30")).toBe(630);
      expect(timeToMinutes("13:00")).toBe(780);
      expect(timeToMinutes("17:00")).toBe(1020);
      expect(timeToMinutes("21:00")).toBe(1260);
      expect(timeToMinutes("")).toBe(0);
    });

    it("correctly allows appointment slots fully inside morning shift (10:00 - 13:00)", () => {
      const monday = standardSchedule.monday;
      // 10:00 AM (15 min) -> 10:00 to 10:15
      expect(isSlotWithinShifts("10:00", 15, monday)).toBe(true);
      // 10:30 AM (30 min) -> 10:30 to 11:00
      expect(isSlotWithinShifts("10:30", 30, monday)).toBe(true);
      // 12:45 PM (15 min) -> 12:45 to 13:00
      expect(isSlotWithinShifts("12:45", 15, monday)).toBe(true);
    });

    it("rejects slots that overflow beyond morning shift end", () => {
      const monday = standardSchedule.monday;
      // 12:50 PM with 15 min duration ends at 13:05, exceeding shift end 13:00
      expect(isSlotWithinShifts("12:50", 15, monday)).toBe(false);
      // 13:00 PM starts when shift ends
      expect(isSlotWithinShifts("13:00", 15, monday)).toBe(false);
    });

    it("rejects slots during off-duty afternoon break (13:00 - 17:00)", () => {
      const monday = standardSchedule.monday;
      expect(isSlotWithinShifts("13:30", 15, monday)).toBe(false);
      expect(isSlotWithinShifts("15:00", 15, monday)).toBe(false);
      expect(isSlotWithinShifts("16:45", 15, monday)).toBe(false);
    });

    it("correctly allows appointment slots inside evening shift (17:00 - 21:00)", () => {
      const monday = standardSchedule.monday;
      // 17:00 PM (15 min)
      expect(isSlotWithinShifts("17:00", 15, monday)).toBe(true);
      // 19:30 PM (20 min)
      expect(isSlotWithinShifts("19:30", 20, monday)).toBe(true);
      // 20:45 PM (15 min) -> ends at 21:00
      expect(isSlotWithinShifts("20:45", 15, monday)).toBe(true);
      // 21:00 PM (15 min) -> starts after shift
      expect(isSlotWithinShifts("21:00", 15, monday)).toBe(false);
    });

    it("rejects all slots on closed days (e.g. Sunday)", () => {
      const sunday = standardSchedule.sunday;
      expect(isSlotWithinShifts("10:00", 15, sunday)).toBe(false);
      expect(isSlotWithinShifts("11:00", 15, sunday)).toBe(false);
      expect(isSlotWithinShifts("18:00", 15, sunday)).toBe(false);
    });

    it("safely handles null or disabled availability", () => {
      expect(isSlotWithinShifts("10:00", 15, null)).toBe(false);
      expect(isSlotWithinShifts("10:00", 15, undefined)).toBe(false);
      expect(isSlotWithinShifts("10:00", 15, { enabled: false, shifts: [] })).toBe(false);
    });
  });

  describe("2. ISO Timestamp & Timezone Resolution", () => {
    it("extracts correct time, date, and day of week in Asia/Kolkata timezone", () => {
      // 2026-10-19 is a Monday.
      // 04:30 UTC = 10:00 AM IST (+05:30)
      const iso = "2026-10-19T04:30:00.000Z";
      const parts = getTimePartsFromISO(iso, "Asia/Kolkata");
      expect(parts.timeHHMM).toBe("10:00");
      expect(parts.dateStr).toBe("2026-10-19");
      expect(parts.dayOfWeek).toBe("monday");
    });

    it("handles evening shift offset accurately in IST", () => {
      // 12:00 UTC = 17:30 IST (+05:30)
      const iso = "2026-10-19T12:00:00.000Z";
      const parts = getTimePartsFromISO(iso, "Asia/Kolkata");
      expect(parts.timeHHMM).toBe("17:30");
      expect(parts.dayOfWeek).toBe("monday");
    });
  });

  describe("3. Doctor & Staff Name Resolution", () => {
    it("prefixes doctor name with Dr. when not already present", () => {
      expect(formatDoctorDisplayName("Sarah Jenkins")).toBe("Dr. Sarah Jenkins");
      expect(formatDoctorDisplayName("Aditi Sharma")).toBe("Dr. Aditi Sharma");
    });

    it("does not create duplicate Dr. prefixes when Dr. or Dr is already part of the name", () => {
      expect(formatDoctorDisplayName("Dr. Sarah Jenkins")).toBe("Dr. Sarah Jenkins");
      expect(formatDoctorDisplayName("Dr. Aditi Sharma")).toBe("Dr. Aditi Sharma");
      expect(formatDoctorDisplayName("Dr Rajesh Kumar")).toBe("Dr Rajesh Kumar");
    });

    it("falls back to email prefix with capitalized Dr. when fullName is missing", () => {
      expect(formatDoctorDisplayName(null, 1, "kavita.patel@hospital.org")).toBe("Dr. Kavita.patel");
      expect(formatDoctorDisplayName("", 2, "arun.verma@thecliniq.com")).toBe("Dr. Arun.verma");
    });

    it("falls back to Doctor (N) when neither name nor email is available — never raw UUID", () => {
      const resolved = formatDoctorDisplayName(null, 1);
      expect(resolved).toBe("Doctor (1)");
      expect(resolved).not.toContain("780d382b");
      expect(resolved).not.toContain("-");
    });

    it("formats staff display names cleanly with role capitalization", () => {
      expect(formatStaffDisplayName("Ramesh Kumar", "receptionist")).toBe("Ramesh Kumar");
      expect(formatStaffDisplayName(null, "nurse", 1)).toBe("Nurse (1)");
      expect(formatStaffDisplayName(null, "receptionist", 2)).toBe("Receptionist (2)");
    });
  });

  describe("4. Slot Availability with Shifts, Schedule Blocks & Visits", () => {
    it("returns isOffDuty: true when requested slot is outside doctor shifts", async () => {
      const mockSupabase = {
        from: (table: string) => {
          if (table === "memberships") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { availability_schedule: standardSchedule },
                    }),
                  }),
                }),
              }),
            };
          }
          return {
            select: () => ({
              eq: () => ({
                or: () => ({
                  lte: () => ({
                    gte: async () => ({ data: [] }),
                  }),
                }),
              }),
            }),
          };
        },
      } as any;

      // 2026-10-19T09:30:00.000Z = 15:00 IST (during the 13:00 - 17:00 break)
      const res = await checkSlotAvailability(
        "doctor-uuid-1",
        "2026-10-19T09:30:00.000Z",
        15,
        mockSupabase,
        { userId: "test-user", tenantId: "test-tenant" }
      );

      expect(res.available).toBe(false);
      expect(res.isOffDuty).toBe(true);
    });

    it("returns isBlocked: true with block reason when a doctor schedule block collides", async () => {
      const activeBlock: ScheduleBlock = {
        id: "block-1",
        tenant_id: "test-tenant",
        doctor_id: "doctor-uuid-1",
        start_time: "2026-10-19T04:00:00.000Z", // 09:30 IST
        end_time: "2026-10-19T06:00:00.000Z",   // 11:30 IST
        reason: "Surgeon attending Medical Conference",
        all_day: false,
        created_by: "test-user",
        created_at: new Date().toISOString(),
      };

      const mockSupabase = {
        from: (table: string) => {
          if (table === "memberships") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { availability_schedule: standardSchedule },
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
                      gte: async () => ({ data: [activeBlock] }),
                    }),
                  }),
                }),
              }),
            };
          }
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  gte: () => ({
                    lte: () => ({
                      not: async () => ({ data: [] }),
                    }),
                  }),
                }),
              }),
            }),
          };
        },
      } as any;

      // Slot at 10:30 IST (05:00 UTC) falls inside shift, but collides with the 09:30-11:30 block
      const res = await checkSlotAvailability(
        "doctor-uuid-1",
        "2026-10-19T05:00:00.000Z",
        15,
        mockSupabase,
        { userId: "test-user", tenantId: "test-tenant" }
      );

      expect(res.available).toBe(false);
      expect(res.isBlocked).toBe(true);
      expect(res.blockReason).toBe("Surgeon attending Medical Conference");
    });

    it("returns available: true when slot is within shift and no blocks or visits exist", async () => {
      const mockSupabase = {
        from: (table: string) => {
          if (table === "memberships") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { availability_schedule: standardSchedule },
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
                      gte: async () => ({ data: [] }),
                    }),
                  }),
                }),
              }),
            };
          }
          // visits
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  gte: () => ({
                    lte: () => ({
                      not: async () => ({ data: [] }),
                    }),
                  }),
                }),
              }),
            }),
          };
        },
      } as any;

      // Slot at 11:00 IST (05:30 UTC) is within morning shift (10:00 - 13:00)
      const res = await checkSlotAvailability(
        "doctor-uuid-1",
        "2026-10-19T05:30:00.000Z",
        15,
        mockSupabase,
        { userId: "test-user", tenantId: "test-tenant" }
      );

      expect(res.available).toBe(true);
      expect(res.isOffDuty).toBeUndefined();
      expect(res.isBlocked).toBeUndefined();
    });
  });
});
