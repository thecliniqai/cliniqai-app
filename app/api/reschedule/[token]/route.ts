import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { rescheduleAppointment } from "@/features/appointments/actions";
import { getTimePartsFromISO, timeToMinutes, DAY_OF_WEEK_NAMES } from "@/features/visits/scheduling-utils";
import type { DayAvailability, DoctorWeeklySchedule } from "@/lib/db/types";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;

    if (!token || typeof token !== "string" || token.length < 32) {
      return NextResponse.json(
        { error: "Invalid or missing reschedule token." },
        { status: 400 }
      );
    }

    const admin = getAdminClient();

    // 1. Fetch token record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shareToken, error: tokenErr } = await (admin.from("document_share_tokens") as any)
      .select("*, tenants(id, name, phone, address)")
      .eq("token", token)
      .single();

    if (tokenErr || !shareToken) {
      return NextResponse.json(
        { error: "Reschedule link is invalid or does not exist." },
        { status: 404 }
      );
    }

    if (shareToken.revoked_at) {
      return NextResponse.json(
        { error: "This reschedule link has already been used or revoked." },
        { status: 410 }
      );
    }

    if (new Date(shareToken.expires_at).getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "This reschedule link has expired. Please contact the clinic directly." },
        { status: 410 }
      );
    }

    // 2. Fetch appointment visit
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: visit, error: visitErr } = await (admin.from("visits") as any)
      .select("*, patients(id, full_name, phone)")
      .eq("id", shareToken.resource_id)
      .single();

    if (visitErr || !visit) {
      return NextResponse.json(
        { error: "Associated appointment could not be found." },
        { status: 404 }
      );
    }

    if (visit.status === "completed" || visit.status === "cancelled") {
      return NextResponse.json(
        { error: `This appointment is already ${visit.status} and cannot be rescheduled.` },
        { status: 400 }
      );
    }

    // 3. Fetch doctor details & availability schedule from memberships
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: member } = await (admin.from("memberships") as any)
      .select("full_name, default_specialty, default_slot_duration_minutes, availability_schedule")
      .eq("tenant_id", visit.tenant_id)
      .eq("user_id", visit.doctor_id)
      .maybeSingle();

    const doctorName = member?.full_name || "Doctor";
    const doctorSpecialty = member?.default_specialty || "General Practitioner";
    const slotDuration = member?.default_slot_duration_minutes || 15;

    // 4. Determine target date for available slots
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");
    let targetDate = dateParam;
    if (!targetDate) {
      // Default to tomorrow or next business day
      const d = new Date();
      d.setDate(d.getDate() + 1);
      targetDate = d.toISOString().split("T")[0];
    }

    // Calculate slots from shifts
    const schedule = (member?.availability_schedule || {
      monday: { enabled: true, shifts: [{ start: "10:00", end: "13:00" }, { start: "17:00", end: "20:00" }] },
      tuesday: { enabled: true, shifts: [{ start: "10:00", end: "13:00" }, { start: "17:00", end: "20:00" }] },
      wednesday: { enabled: true, shifts: [{ start: "10:00", end: "13:00" }, { start: "17:00", end: "20:00" }] },
      thursday: { enabled: true, shifts: [{ start: "10:00", end: "13:00" }, { start: "17:00", end: "20:00" }] },
      friday: { enabled: true, shifts: [{ start: "10:00", end: "13:00" }, { start: "17:00", end: "20:00" }] },
      saturday: { enabled: true, shifts: [{ start: "10:00", end: "13:00" }] },
      sunday: { enabled: false, shifts: [] },
    }) as DoctorWeeklySchedule;

    const dayName = DAY_OF_WEEK_NAMES[new Date(targetDate).getDay()];
    const dayAvailability = schedule[dayName] as DayAvailability | undefined;

    const generatedSlots: string[] = [];

    if (dayAvailability?.enabled && Array.isArray(dayAvailability.shifts)) {
      for (const shift of dayAvailability.shifts) {
        const startMins = timeToMinutes(shift.start);
        const endMins = timeToMinutes(shift.end);

        for (let m = startMins; m + slotDuration <= endMins; m += slotDuration) {
          const hh = String(Math.floor(m / 60)).padStart(2, "0");
          const mm = String(m % 60).padStart(2, "0");
          generatedSlots.push(`${targetDate}T${hh}:${mm}:00.000Z`);
        }
      }
    }

    // 5. Filter out booked slots on that date
    const startOfDay = `${targetDate}T00:00:00.000Z`;
    const endOfDay = `${targetDate}T23:59:59.999Z`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bookedVisits } = await (admin.from("visits") as any)
      .select("scheduled_at, estimated_duration_minutes")
      .eq("tenant_id", visit.tenant_id)
      .eq("doctor_id", visit.doctor_id)
      .gte("scheduled_at", startOfDay)
      .lte("scheduled_at", endOfDay)
      .in("status", ["booked", "confirmed", "waiting", "in_consultation"]);

    const bookedTimes = new Set(
      (bookedVisits || []).map((b: { scheduled_at: string }) => b.scheduled_at)
    );

    const availableSlots = generatedSlots.filter((slot) => !bookedTimes.has(slot));

    return NextResponse.json({
      success: true,
      appointment: {
        id: visit.id,
        patient_name: visit.patients?.full_name || "Patient",
        patient_phone: visit.patients?.phone || null,
        doctor_name: doctorName,
        doctor_specialty: doctorSpecialty,
        current_scheduled_at: visit.scheduled_at,
        clinic: shareToken.tenants || {
          name: "Clinic",
          phone: null,
          address: null,
        },
      },
      selected_date: targetDate,
      available_slots: availableSlots,
    });
  } catch (err: unknown) {
    console.error("[app/api/reschedule/[token]/route] GET error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred while loading reschedule options." },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;

    if (!token || typeof token !== "string" || token.length < 32) {
      return NextResponse.json(
        { error: "Invalid reschedule token." },
        { status: 400 }
      );
    }

    const admin = getAdminClient();

    // 1. Fetch & validate token
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shareToken, error: tokenErr } = await (admin.from("document_share_tokens") as any)
      .select("*, tenants(name, phone)")
      .eq("token", token)
      .single();

    if (tokenErr || !shareToken) {
      return NextResponse.json(
        { error: "Reschedule link is invalid or has expired." },
        { status: 404 }
      );
    }

    if (shareToken.revoked_at) {
      return NextResponse.json(
        { error: "This reschedule link has already been used or revoked." },
        { status: 410 }
      );
    }

    if (new Date(shareToken.expires_at).getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "This reschedule link has expired. Please contact the clinic directly." },
        { status: 410 }
      );
    }

    const body = await request.json();
    const { newScheduledAt, reason } = body;

    if (!newScheduledAt || typeof newScheduledAt !== "string") {
      return NextResponse.json(
        { error: "Please select a valid new appointment time." },
        { status: 400 }
      );
    }

    const newDate = new Date(newScheduledAt);
    if (isNaN(newDate.getTime()) || newDate.getTime() < Date.now()) {
      return NextResponse.json(
        { error: "Please select a future appointment date and time." },
        { status: 400 }
      );
    }

    // 2. Execute reschedule mutation via Server Action
    const result = await rescheduleAppointment(
      {
        appointmentId: shareToken.resource_id,
        newScheduledAt,
        reason: reason || "patient_self_service_reschedule",
        updatedBy: "patient_self_service",
      },
      admin
    );

    // 3. Mark reschedule token as completed (revoked to prevent double booking)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("document_share_tokens") as any)
      .update({
        revoked_at: new Date().toISOString(),
        access_count: (shareToken.access_count || 0) + 1,
        last_accessed_at: new Date().toISOString(),
      })
      .eq("id", shareToken.id);

    // 4. Create in-app alert for front desk (Event: appointment_rescheduled)
    const formattedTime = newDate.toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("in_app_notifications") as any).insert({
      tenant_id: shareToken.tenant_id,
      recipient_role: "receptionist",
      category: "queue",
      event_type: "appointment_rescheduled",
      title: "Appointment Rescheduled Online",
      message: `A patient has rescheduled their appointment to ${formattedTime}.`,
      link_url: `/calendar`,
      metadata: {
        appointment_id: shareToken.resource_id,
        new_scheduled_at: newScheduledAt,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Appointment rescheduled successfully.",
      new_scheduled_at: newScheduledAt,
      appointment: result.appointment,
    });
  } catch (err: unknown) {
    console.error("[app/api/reschedule/[token]/route] POST error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to reschedule appointment." },
      { status: 500 }
    );
  }
}
