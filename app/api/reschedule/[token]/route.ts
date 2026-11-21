import { NextRequest, NextResponse } from "next/server";
import {
  CLINIC_UNAVAILABLE_MESSAGE,
  consumeRescheduleToken,
  getRescheduleContext,
  getRescheduleSlots,
  isPlausibleToken,
} from "@/features/sharing/public-links";
import { notifySelfServiceReschedule } from "@/features/sharing/system";
import { DEFAULT_CLINIC_TZ, addDaysYmd, isYmd, resolveTimeZone, todayInTz } from "@/lib/datetime";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

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

// Same bound as consume_reschedule_token.
const RESCHEDULE_HORIZON_DAYS = 90;

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;

    if (!isPlausibleToken(token)) {
      return NextResponse.json({ error: "Invalid or missing reschedule token." }, { status: 400 });
    }

    // The slots are computed in the database, in the clinic's zone, by the function staff use (V2-08 08-04a, R-16). The context
    // answers the link's state and carries the clinic's zone, which names "tomorrow" when no date is asked for.
    const nowIso = new Date().toISOString();
    const res = await getRescheduleContext(token, nowIso, nowIso);

    if (res.status === "revoked" || res.status === "expired") {
      return NextResponse.json({ error: GONE_MESSAGE }, { status: 410 });
    }
    if (res.status === "closed") {
      return NextResponse.json({ error: closedMessage(res.visitStatus) }, { status: 400 });
    }
    if (res.status === "unavailable") {
      return NextResponse.json({ error: UNAVAILABLE_MESSAGE }, { status: 409 });
    }
    // V2-05 05-10a (SUB-02): the clinic's access level is not `full`: the neutral text, nothing about the visit.
    if (res.status === "clinic_unavailable") {
      return NextResponse.json({ error: CLINIC_UNAVAILABLE_MESSAGE }, { status: 409 });
    }
    if (res.status !== "ok") {
      return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    }

    const { clinic, doctor, current_scheduled_at } = res.context;
    const timeZone = resolveTimeZone(clinic?.timezone ?? DEFAULT_CLINIC_TZ);
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");
    const targetDate = isYmd(dateParam) ? dateParam : addDaysYmd(todayInTz(timeZone), 1);

    const slots = await getRescheduleSlots(token, targetDate);
    if (slots.status === "closed") {
      return NextResponse.json({ error: closedMessage(slots.visitStatus) }, { status: 400 });
    }
    if (slots.status === "revoked" || slots.status === "expired") {
      return NextResponse.json({ error: GONE_MESSAGE }, { status: 410 });
    }
    if (slots.status === "clinic_unavailable") {
      return NextResponse.json({ error: CLINIC_UNAVAILABLE_MESSAGE }, { status: 409 });
    }
    if (slots.status === "unavailable") {
      return NextResponse.json({ error: UNAVAILABLE_MESSAGE }, { status: 409 });
    }
    if (slots.status !== "ok") {
      return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    }

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
        timezone: timeZone,
        selected_date: targetDate,
        available_slots: slots.slots.map((slot) => slot.start),
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err: unknown) {
    log.error({ event: "sharing.reschedule_route_get.failed", code: errorTag(err), requestId: await getRequestId() });
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
      case "slot_unavailable":
        return NextResponse.json(
          { error: "That time is no longer available. Please choose another slot." },
          { status: 409 }
        );
      case "closed":
        return NextResponse.json({ error: closedMessage(res.visitStatus) }, { status: 400 });
      case "unavailable":
        return NextResponse.json({ error: UNAVAILABLE_MESSAGE }, { status: 409 });
      case "clinic_unavailable":
        return NextResponse.json({ error: CLINIC_UNAVAILABLE_MESSAGE }, { status: 409 });
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
    log.error({ event: "sharing.reschedule_route_post.failed", code: errorTag(err), requestId: await getRequestId() });
    return NextResponse.json({ error: "Failed to reschedule appointment." }, { status: 500 });
  }
}
