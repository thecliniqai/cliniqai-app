import { NextRequest, NextResponse } from "next/server";
import {
  cancelAppointment,
  findActiveAppointmentByPhone,
  generateRescheduleToken,
  getAppointmentsDbClient,
} from "@/features/appointments/actions";
import { sendDirectWhatsApp } from "@/lib/messaging";
import { verifyWebhookSignature, parseInboundAction } from "@/lib/messaging/webhook-helpers";

async function handleInboundWebhook(
  req: NextRequest,
  params: { provider: string }
) {
  const provider = (params.provider || "dev").toLowerCase();
  const rawBody = await req.text();

  // 1. Signature Verification (T-05-05)
  if (!verifyWebhookSignature(provider, req.headers, rawBody)) {
    return NextResponse.json(
      { error: "Forbidden: Invalid webhook signature" },
      { status: 403 }
    );
  }

  // 2. Parse payload based on Content-Type or query
  let from = req.nextUrl.searchParams.get("from") || "";
  let body = req.nextUrl.searchParams.get("action") || req.nextUrl.searchParams.get("body") || "";

  if (rawBody) {
    try {
      if (req.headers.get("content-type")?.includes("application/json")) {
        const json = JSON.parse(rawBody);
        from = json.from || json.sender || json.mobile || from;
        body = json.body || json.text || json.action || json.payload || body;
      } else {
        const formData = new URLSearchParams(rawBody);
        from = formData.get("From") || formData.get("from") || from;
        body = formData.get("Body") || formData.get("body") || formData.get("action") || body;
      }
    } catch {
      // ignore parse error and use query params
    }
  }

  if (!from) {
    return NextResponse.json(
      { error: "Missing sender phone number (from)" },
      { status: 400 }
    );
  }

  const action = parseInboundAction(body);

  // 3. Find active upcoming appointment matching patient phone number (T-05-07)
  const appointment = await findActiveAppointmentByPhone(from);

  if (!appointment) {
    // Send polite notice when no matching active booking found
    await sendDirectWhatsApp(
      from,
      "bot_not_found",
      {
        message:
          "We could not find an upcoming scheduled appointment for this phone number. For assistance, please call the clinic directly.",
      },
      undefined,
      provider === "dev" ? "dev" : undefined
    );

    return NextResponse.json(
      { success: true, action: "unmatched", message: "No active appointment found" },
      { status: 200 }
    );
  }

  const supabase = await getAppointmentsDbClient();

  // 4. Route action
  if (action === "confirm") {
    // [Confirm] Flow
    await supabase
      .from("visits")
      .update({
        status: "confirmed",
        metadata: {
          ...(appointment.metadata || {}),
          patient_confirmed: true,
          confirmed_at: new Date().toISOString(),
          confirmed_via: "whatsapp_bot",
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", appointment.id);

    // Audit log
    await supabase.from("audit_logs").insert({
      tenant_id: appointment.tenant_id,
      actor_id: null,
      actor_role: "patient",
      action: "appointment_confirmed_whatsapp",
      entity_type: "visits",
      entity_id: appointment.id,
      occurred_at: new Date().toISOString(),
      metadata: { from, appointment_id: appointment.id },
    });

    await sendDirectWhatsApp(
      from,
      "appointment_confirmed_ack",
      {
        patient_name: appointment.patient?.full_name || "Patient",
        message: `Thank you! Your appointment has been confirmed. We look forward to seeing you.`,
      },
      undefined,
      provider === "dev" ? "dev" : undefined
    );

    return NextResponse.json({ success: true, action: "confirmed", appointment_id: appointment.id });
  }

  if (action === "cancel") {
    // [Cancel] Flow (T-05-07)
    await cancelAppointment({
      appointmentId: appointment.id,
      reason: "patient_whatsapp_bot",
      cancelledBy: from,
      isClinicInitiated: false,
    });

    // Audit log
    await supabase.from("audit_logs").insert({
      tenant_id: appointment.tenant_id,
      actor_id: null,
      actor_role: "patient",
      action: "appointment_cancelled_whatsapp",
      entity_type: "visits",
      entity_id: appointment.id,
      occurred_at: new Date().toISOString(),
      metadata: { from, appointment_id: appointment.id },
    });

    await sendDirectWhatsApp(
      from,
      "appointment_cancelled_ack",
      {
        patient_name: appointment.patient?.full_name || "Patient",
        message:
          "Your appointment has been cancelled. If you would like to book again in the future, please contact us.",
      },
      undefined,
      provider === "dev" ? "dev" : undefined
    );

    return NextResponse.json({ success: true, action: "cancelled", appointment_id: appointment.id });
  }

  if (action === "reschedule") {
    // [Reschedule] Flow
    const rescheduleUrl = await generateRescheduleToken(
      appointment.id,
      appointment.tenant_id
    );

    // Create in-app notification for front desk
    await supabase.from("in_app_notifications").insert({
      tenant_id: appointment.tenant_id,
      recipient_role: "receptionist",
      category: "queue",
      event_type: "reschedule_requested",
      title: "Appointment Reschedule Requested",
      message: `Patient ${appointment.patient?.full_name || from} requested to reschedule via WhatsApp.`,
      link_url: `/calendar`,
    });

    await sendDirectWhatsApp(
      from,
      "appointment_reschedule_link",
      {
        patient_name: appointment.patient?.full_name || "Patient",
        message: `To pick a new appointment time that works best for you, please tap this link: ${rescheduleUrl}`,
      },
      undefined,
      provider === "dev" ? "dev" : undefined
    );

    return NextResponse.json({
      success: true,
      action: "reschedule_link_generated",
      appointment_id: appointment.id,
      reschedule_url: rescheduleUrl,
    });
  }

  // Unhandled / Conversational text triage (Event #18)
  await supabase.from("in_app_notifications").insert({
    tenant_id: appointment.tenant_id,
    recipient_role: "receptionist",
    category: "queue",
    event_type: "inbound_whatsapp_reply",
    title: `Inbound WhatsApp: ${appointment.patient?.full_name || from}`,
    message: `Patient message: "${body}"`,
    link_url: `/patients/${appointment.patient_id}`,
  });

  await sendDirectWhatsApp(
    from,
    "conversational_triage",
    {
      message:
        "Thank you for contacting us. We have received your message and our reception desk will assist you shortly. For urgent care, please call the clinic directly.",
    },
    undefined,
    provider === "dev" ? "dev" : undefined
  );

  return NextResponse.json({
    success: true,
    action: "conversational_triage",
    appointment_id: appointment.id,
  });
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  const params = await context.params;
  return handleInboundWebhook(req, params);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  const params = await context.params;
  return handleInboundWebhook(req, params);
}
