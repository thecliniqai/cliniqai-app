import { NextRequest, NextResponse } from "next/server";
import {
  consumeRescheduleToken,
  getRescheduleContext,
  isPlausibleToken,
} from "@/features/sharing/public-links";
import { notifySelfServiceReschedule } from "@/features/sharing/system";
import { timeToMinutes, DAY_OF_WEEK_NAMES } from "@/features/visits/scheduling-utils";
import type { DayAvailability, DoctorWeeklySchedule } from "@/lib/db/types";

// Public self-service reschedule link (P0-04, ADR-0005 D3). Only `appointment` tokens resolve here, bound to the
// token's tenant (`get_reschedule_context`); a POST is single-use (`consume_reschedule_token` revokes the token in
// the same transaction as the visit update). Every "no such link" answer is the same 404; responses carry no ids or
// patient contact data.

const NOT_FOUND_MESSAGE = "Reschedule link is invalid or does not exist.";
const GONE_MESSAGE = "This reschedule link has already been used, revoked or has expired. Please contact the clinic directly.";
const UNAVAILABLE_MESSAGE = "This appointment cannot be rescheduled online. Please contact the clinic directly.";

/** AR2-L4 (000023): only a booked or confirmed visit can be rescheduled online. */
function closedMessage(visitStatus: string): string {
  if (visitStatus === "completed" || visitStatus === "cancelled") {
    return `This appointment is already ${visitStatus} and cannot be rescheduled.`;
  }
  return "Your visit has already started at the clinic, so it can no longer be rescheduled online. Please contact the clinic.";
}

// Same bounds as consume_reschedule_token and the memberships CHECKs (000021).
const RESCHEDULE_HORIZON_DAYS = 90;
const MIN_SLOT_MINUTES = 5;
const MAX_SLOT_MINUTES = 120;
const MAX_SHIFTS_PER_DAY = 8;
const MINUTES_PER_DAY = 24 * 60;

function isHHMM(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

const DEFAULT_SCHEDULE: DoctorWeeklySchedule = {
  monday: { enabled: true, shifts: [{ start: "10:00", end: "13:00" }, { start: "17:00", end: "20:00" }] },
  tuesday: { enabled: true, shifts: [{ start: "10:00", end: "13:00" }, { start: "17:00", end: "20:00" }] },
  wednesday: { enabled: true, shifts: [{ start: "10:00", end: "13:00" }, { start: "17:00", end: "20:00" }] },
  thursday: { enabled: true, shifts: [{ start: "10:00", end: "13:00" }, { start: "17:00", end: "20:00" }] },
  friday: { enabled: true, shifts: [{ start: "10:00", end: "13:00" }, { start: "17:00", end: "20:00" }] },
  saturday: { enabled: true, shifts: [{ start: "10:00", end: "13:00" }] },
  sunday: { enabled: false, shifts: [] },
} as DoctorWeeklySchedule;

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;

    if (!isPlausibleToken(token)) {
      return NextResponse.json({ error: "Invalid or missing reschedule token." }, { status: 400 });
    }

    // Target date for available slots (defaults to tomorrow). Slots stay in UTC as before (UTC/IST fix is P1, C10).
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");
    let targetDate: string;
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && !Number.isNaN(Date.parse(dateParam))) {
      targetDate = dateParam;
    } else {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      targetDate = d.toISOString().split("T")[0];
    }
    const startOfDay = `${targetDate}T00:00:00.000Z`;
    const endOfDay = `${targetDate}T23:59:59.999Z`;

    const res = await getRescheduleContext(token, startOfDay, endOfDay);

    if (res.status === "revoked" || res.status === "expired") {
      return NextResponse.json({ error: GONE_MESSAGE }, { status: 410 });
    }
    if (res.status === "closed") {
      return NextResponse.json({ error: closedMessage(res.visitStatus) }, { status: 400 });
    }
    if (res.status === "unavailable") {
      return NextResponse.json({ error: UNAVAILABLE_MESSAGE }, { status: 409 });
    }
    if (res.status !== "ok") {
      return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    }

    const { clinic, doctor, current_scheduled_at, booked } = res.context;
    // Bounded even if the stored values were not (AR-L3; the database also CHECKs both since 000021).
    const rawDuration = Number(doctor.default_slot_duration_minutes) || 15;
    const slotDuration = Math.min(Math.max(Math.trunc(rawDuration), MIN_SLOT_MINUTES), MAX_SLOT_MINUTES);
    const schedule = (doctor.availability_schedule as DoctorWeeklySchedule | null) || DEFAULT_SCHEDULE;
    const dayName = DAY_OF_WEEK_NAMES[new Date(targetDate).getDay()];
    const dayAvailability = schedule[dayName] as DayAvailability | undefined;

    const generatedSlots: string[] = [];
    if (dayAvailability?.enabled && Array.isArray(dayAvailability.shifts)) {
      for (const shift of dayAvailability.shifts.slice(0, MAX_SHIFTS_PER_DAY)) {
        if (!isHHMM(shift?.start) || !isHHMM(shift?.end)) continue;
        const startMins = timeToMinutes(shift.start);
        const endMins = Math.min(timeToMinutes(shift.end), MINUTES_PER_DAY);
        for (let m = startMins; m + slotDuration <= endMins; m += slotDuration) {
          const hh = String(Math.floor(m / 60)).padStart(2, "0");
          const mm = String(m % 60).padStart(2, "0");
          generatedSlots.push(`${targetDate}T${hh}:${mm}:00.000Z`);
        }
      }
    }

    const bookedTimes = new Set(booked.map((b) => new Date(b).getTime()));
    const availableSlots = generatedSlots.filter((slot) => !bookedTimes.has(new Date(slot).getTime()));

    return NextResponse.json(
      {
        success: true,
        appointment: {
          doctor_name: doctor.full_name || "Doctor",
          doctor_specialty: doctor.default_specialty || "General Practitioner",
          current_scheduled_at,
          clinic: {
            name: clinic?.name ?? "Clinic",
            phone: clinic?.phone ?? null,
            address: clinic?.address ?? null,
          },
        },
        selected_date: targetDate,
        available_slots: availableSlots,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err: unknown) {
    console.error("[app/api/reschedule/[token]/route] GET error:", err instanceof Error ? err.name : "error");
    return NextResponse.json(
      { error: "An unexpected error occurred while loading reschedule options." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;

    if (!isPlausibleToken(token)) {
      return NextResponse.json({ error: "Invalid reschedule token." }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const newScheduledAt = (body as { newScheduledAt?: unknown } | null)?.newScheduledAt;

    if (!newScheduledAt || typeof newScheduledAt !== "string" || Number.isNaN(Date.parse(newScheduledAt))) {
      return NextResponse.json({ error: "Please select a valid new appointment time." }, { status: 400 });
    }

    const res = await consumeRescheduleToken(token, new Date(newScheduledAt).toISOString());

    switch (res.status) {
      case "ok":
        break;
      case "invalid_time":
        return NextResponse.json({ error: "Please select a future appointment date and time." }, { status: 400 });
      case "too_far":
        return NextResponse.json(
          { error: `Please select a time within the next ${RESCHEDULE_HORIZON_DAYS} days.` },
          { status: 400 }
        );
      case "slot_taken":
        return NextResponse.json(
          { error: "That time is no longer available. Please choose another slot." },
          { status: 409 }
        );
      case "closed":
        return NextResponse.json({ error: closedMessage(res.visitStatus) }, { status: 400 });
      case "unavailable":
        return NextResponse.json({ error: UNAVAILABLE_MESSAGE }, { status: 409 });
      case "revoked":
      case "expired":
        return NextResponse.json({ error: GONE_MESSAGE }, { status: 410 });
      default:
        return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    }

    // Patient confirmation and webhook event (best effort; the reschedule itself is already committed).
    await notifySelfServiceReschedule(token);

    return NextResponse.json({
      success: true,
      message: "Appointment rescheduled successfully.",
      new_scheduled_at: res.newScheduledAt,
    });
  } catch (err: unknown) {
    console.error("[app/api/reschedule/[token]/route] POST error:", err instanceof Error ? err.name : "error");
    return NextResponse.json({ error: "Failed to reschedule appointment." }, { status: 500 });
  }
}
