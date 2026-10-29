import { tool } from "ai";
import { z } from "zod";
import {
  BookingPreviewDetailsSchema,
  ReschedulePreviewDetailsSchema,
  CancelPreviewDetailsSchema,
} from "../types";
import { getProductHelpAnswer } from "../knowledge/product-manifest";
import { isSlotWithinShifts } from "@/features/visits/scheduling-utils";
import type { DayAvailability, DayOfWeek } from "@/lib/db/types";

export interface OperationsToolsContext {
  tenantId: string;
  userId: string;
  role: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any;
}

export function assertRoleAllowed(userRole: string, allowedRoles: string[]): void {
  const normalized = (userRole || "").toLowerCase();
  const allowed = allowedRoles.map((r) => r.toLowerCase());

  if (!allowed.includes(normalized)) {
    const error = new Error(
      `UNAUTHORIZED_ROLE: Role '${userRole}' is not authorized to execute this operation.`
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (error as any).code = "UNAUTHORIZED_ROLE";
    throw error;
  }
}

export function getOperationsTools(context: OperationsToolsContext) {
  const { tenantId, role, supabase } = context;

  return {
    search_patients: tool({
      description: "Search clinic patients by name or 10-digit mobile number",
      parameters: z.object({
        query: z.string().min(2).describe("Patient name or Indian mobile query"),
      }),
      execute: async ({ query }) => {
        assertRoleAllowed(role, [
          "doctor",
          "receptionist",
          "nurse",
          "admin",
          "owner",
        ]);

        if (!supabase) {
          return {
            patients: [],
            message: "Database client unavailable for patient search.",
          };
        }

        const cleanQuery = query.trim();
        const isNumeric = /^\d+$/.test(cleanQuery);

        let queryBuilder = supabase
          .from("patients")
          .select("id, full_name, phone, age, sex, created_at, visits:visits(scheduled_at)")
          .eq("tenant_id", tenantId)
          .limit(10);

        if (isNumeric) {
          queryBuilder = queryBuilder.ilike("phone", `%${cleanQuery}%`);
        } else {
          queryBuilder = queryBuilder.ilike("full_name", `%${cleanQuery}%`);
        }

        const { data, error } = await queryBuilder;

        if (error) {
          return {
            error: `Failed to search patients: ${error.message}`,
            patients: [],
          };
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const patients = (data || []).map((p: any) => {
          let lastVisitDate: string | null = null;
          if (p.visits && Array.isArray(p.visits) && p.visits.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sorted = [...p.visits].sort((a: any, b: any) =>
              (b.scheduled_at || "").localeCompare(a.scheduled_at || "")
            );
            lastVisitDate = sorted[0]?.scheduled_at?.split("T")[0] || null;
          }

          return {
            id: p.id,
            full_name: p.full_name,
            phone: p.phone,
            age: p.age,
            sex: p.sex,
            last_visit_date: lastVisitDate,
          };
        });

        return {
          patients,
          total_found: patients.length,
          query: cleanQuery,
        };
      },
    }),

    check_availability: tool({
      description:
        "Check available consultation slots for a doctor on a specific date",
      parameters: z.object({
        doctor_id: z.string().uuid().describe("Target doctor UUID"),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("Target date in YYYY-MM-DD format"),
      }),
      execute: async ({ doctor_id, date }) => {
        assertRoleAllowed(role, [
          "doctor",
          "receptionist",
          "nurse",
          "admin",
          "owner",
        ]);

        if (!supabase) {
          // Fallback mock schedule
          return {
            doctor_id,
            date,
            shifts: [{ start: "09:00", end: "13:00" }, { start: "17:00", end: "20:00" }],
            booked_slots: ["09:30", "10:15"],
            available_slots: ["09:00", "09:15", "09:45", "10:00", "11:00", "17:00"],
          };
        }

        // Fetch doctor profile / shift settings
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, full_name, availability")
          .eq("id", doctor_id)
          .single();

        const doctorName = profile?.full_name || "Doctor";
        const dayOfWeek = new Date(date)
          .toLocaleDateString("en-US", { weekday: "long" })
          .toLowerCase() as DayOfWeek;

        const dayAvailability = profile?.availability?.[dayOfWeek] as DayAvailability | undefined;

        // Fetch booked visits for date
        const startOfDay = `${date}T00:00:00.000Z`;
        const endOfDay = `${date}T23:59:59.999Z`;

        const { data: bookedVisits } = await supabase
          .from("visits")
          .select("id, scheduled_at, status")
          .eq("tenant_id", tenantId)
          .eq("doctor_id", doctor_id)
          .gte("scheduled_at", startOfDay)
          .lte("scheduled_at", endOfDay)
          .neq("status", "cancelled");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bookedSlots = (bookedVisits || []).map((v: any) => {
          const time = v.scheduled_at ? v.scheduled_at.split("T")[1]?.slice(0, 5) : "";
          return time;
        });

        const shifts = dayAvailability?.shifts || [
          { start: "09:00", end: "13:00" },
          { start: "17:00", end: "20:00" },
        ];

        return {
          doctor_id,
          doctor_name: doctorName,
          date,
          day_of_week: dayOfWeek,
          shifts,
          booked_slots: bookedSlots,
          total_booked: bookedSlots.length,
        };
      },
    }),

    request_appointment_booking: tool({
      description:
        "Stage an appointment booking preview card for staff confirmation before database commit",
      parameters: BookingPreviewDetailsSchema,
      execute: async (bookingDetails) => {
        assertRoleAllowed(role, [
          "doctor",
          "receptionist",
          "nurse",
          "admin",
          "owner",
        ]);

        let outsideShift = false;

        if (supabase) {
          // Check doctor's shift for that weekday
          const { data: profile } = await supabase
            .from("profiles")
            .select("availability")
            .eq("id", bookingDetails.doctor_id)
            .single();

          const dayOfWeek = new Date(bookingDetails.date)
            .toLocaleDateString("en-US", { weekday: "long" })
            .toLowerCase() as DayOfWeek;

          const dayAvailability = profile?.availability?.[dayOfWeek] as DayAvailability | undefined;

          if (dayAvailability) {
            const inShift = isSlotWithinShifts(
              bookingDetails.start_time,
              15,
              dayAvailability
            );
            if (!inShift) {
              outsideShift = true;
            }
          }
        }

        const finalDetails = {
          ...bookingDetails,
          outside_shift_warning: outsideShift,
        };

        return {
          status: "preview_ready",
          requires_confirmation: true,
          action_type: "book_appointment",
          details: finalDetails,
        };
      },
    }),

    reschedule_appointment: tool({
      description:
        "Stage an appointment reschedule preview card for staff confirmation before database commit",
      parameters: ReschedulePreviewDetailsSchema,
      execute: async (rescheduleDetails) => {
        assertRoleAllowed(role, [
          "doctor",
          "receptionist",
          "nurse",
          "admin",
          "owner",
        ]);

        return {
          status: "preview_ready",
          requires_confirmation: true,
          action_type: "reschedule_appointment",
          details: rescheduleDetails,
        };
      },
    }),

    cancel_appointment: tool({
      description:
        "Stage an appointment cancellation preview card for staff confirmation and slot release",
      parameters: CancelPreviewDetailsSchema,
      execute: async (cancelDetails) => {
        assertRoleAllowed(role, [
          "doctor",
          "receptionist",
          "nurse",
          "admin",
          "owner",
        ]);

        return {
          status: "preview_ready",
          requires_confirmation: true,
          action_type: "cancel_appointment",
          details: cancelDetails,
        };
      },
    }),

    get_queue_status: tool({
      description:
        "Get live outpatient queue status counts (waiting, in-consultation, completed)",
      parameters: z.object({
        doctor_id: z.string().uuid().optional(),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Date in YYYY-MM-DD format (defaults to today)"),
      }),
      execute: async ({ doctor_id, date }) => {
        assertRoleAllowed(role, [
          "doctor",
          "receptionist",
          "nurse",
          "admin",
          "owner",
        ]);

        const targetDate = date || new Date().toISOString().split("T")[0];

        if (!supabase) {
          return {
            date: targetDate,
            doctor_id: doctor_id || "all",
            waiting_count: 4,
            in_consultation_count: 1,
            completed_count: 12,
            total_active: 5,
          };
        }

        const startOfDay = `${targetDate}T00:00:00.000Z`;
        const endOfDay = `${targetDate}T23:59:59.999Z`;

        let query = supabase
          .from("visits")
          .select("id, status")
          .eq("tenant_id", tenantId)
          .gte("scheduled_at", startOfDay)
          .lte("scheduled_at", endOfDay);

        if (doctor_id) {
          query = query.eq("doctor_id", doctor_id);
        }

        const { data: visits, error } = await query;

        if (error) {
          return {
            error: `Failed to query queue: ${error.message}`,
            waiting_count: 0,
            in_consultation_count: 0,
            completed_count: 0,
          };
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list = visits || [];
        const waiting = list.filter((v: any) => v.status === "waiting" || v.status === "booked").length;
        const inConsultation = list.filter((v: any) => v.status === "in_consultation").length;
        const completed = list.filter((v: any) => v.status === "completed").length;

        return {
          date: targetDate,
          doctor_id: doctor_id || "all",
          waiting_count: waiting,
          in_consultation_count: inConsultation,
          completed_count: completed,
          total_active: waiting + inConsultation,
        };
      },
    }),

    get_product_help: tool({
      description:
        "Provide verified navigation steps and feature guidance from ClinicOS documentation",
      parameters: z.object({
        topic: z.string().describe("Feature topic (e.g., calendar, queue, billing, cabin, shifts)"),
      }),
      execute: async ({ topic }) => {
        return getProductHelpAnswer(topic);
      },
    }),
  };
}
