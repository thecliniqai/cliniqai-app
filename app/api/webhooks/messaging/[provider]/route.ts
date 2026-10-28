import { NextRequest, NextResponse } from "next/server";
import {
  cancelAppointment,
  findActiveAppointmentByPhone,
  generateRescheduleToken,
  getAppointmentsDbClient,
} from "@/features/appointments/actions";
import { sendDirectWhatsApp } from "@/lib/messaging";
import {
  verifyWebhookSignature,
  parseInboundAction,
  parseMsg91Payload,
} from "@/lib/messaging/webhook-helpers";

async function handleInboundWebhook(
  req: NextRequest,
  params: { provider: string }
) {
  const provider = (params.provider || "dev").toLowerCase();
  const rawBody = await req.text();

  // 1. Signature Verification (T-05.1-04)
  if (!verifyWebhookSignature(provider, req.headers, rawBody, req.nextUrl.searchParams)) {
    return NextResponse.json(
      { error: "Forbidden: Invalid webhook signature" },
      { status: 403 }
    );
  }

  const supabase = await getAppointmentsDbClient();
  const nowIso = new Date().toISOString();

  // 2. Specific Handling for MSG91
  if (provider === "msg91") {
    const event = parseMsg91Payload(rawBody, req.nextUrl.searchParams);

    // Branch A: Delivery Reports (DLR) (Decision D-06, Peer Review Findings 3, 4, 6)
    if (event.type === "dlr") {
      const requestId = event.requestId;
      if (!requestId) {
        return NextResponse.json(
          { success: true, event: "dlr_ignored_no_request_id" },
          { status: 200 }
        );
      }

      const { data: queueItem } = await supabase
        .from("communication_queue")
        .select("*")
        .eq("external_message_id", requestId)
        .maybeSingle();

      if (!queueItem) {
        return NextResponse.json(
          { success: true, event: "dlr_queue_item_not_found", requestId },
          { status: 200 }
        );
      }

      // Handle Delivered status
      if (event.status === "delivered") {
        // Monotonic progression: do not downgrade if already 'read'
        const targetStatus = queueItem.status === "read" ? "read" : "delivered";
        await supabase
          .from("communication_queue")
          .update({
            status: targetStatus,
            metadata: {
              ...(queueItem.metadata || {}),
              delivered_at: event.deliveredAt || nowIso,
            },
            updated_at: nowIso,
          })
          .eq("id", queueItem.id);

        await supabase.from("audit_logs").insert({
          tenant_id: queueItem.tenant_id,
          actor_id: null,
          actor_role: "system",
          action: "communication_dlr_delivered",
          entity_type: "communication_queue",
          entity_id: queueItem.id,
          occurred_at: nowIso,
          metadata: {
            requestId,
            status: targetStatus,
            delivered_at: event.deliveredAt || nowIso,
            recipient_phone: queueItem.recipient_phone,
          },
        });

        return NextResponse.json({
          success: true,
          event: "dlr_processed",
          status: targetStatus,
        });
      }

      // Handle Read status
      if (event.status === "read") {
        await supabase
          .from("communication_queue")
          .update({
            status: "read",
            metadata: {
              ...(queueItem.metadata || {}),
              read_at: event.readAt || nowIso,
            },
            updated_at: nowIso,
          })
          .eq("id", queueItem.id);

        await supabase.from("audit_logs").insert({
          tenant_id: queueItem.tenant_id,
          actor_id: null,
          actor_role: "system",
          action: "communication_dlr_read",
          entity_type: "communication_queue",
          entity_id: queueItem.id,
          occurred_at: nowIso,
          metadata: {
            requestId,
            status: "read",
            read_at: event.readAt || nowIso,
            recipient_phone: queueItem.recipient_phone,
          },
        });

        return NextResponse.json({
          success: true,
          event: "dlr_processed",
          status: "read",
        });
      }

      // Handle Failed status (Peer Review Finding 3: Dead-letter prevents infinite retry loops)
      if (event.status === "failed") {
        await supabase
          .from("communication_queue")
          .update({
            status: "dead_letter",
            next_retry_at: null,
            error_message: event.reason || "Delivery failed",
            metadata: {
              ...(queueItem.metadata || {}),
              failed_at: nowIso,
              failure_reason: event.reason || "Delivery failed",
            },
            updated_at: nowIso,
          })
          .eq("id", queueItem.id);

        await supabase.from("audit_logs").insert({
          tenant_id: queueItem.tenant_id,
          actor_id: null,
          actor_role: "system",
          action: "communication_dlr_failed",
          entity_type: "communication_queue",
          entity_id: queueItem.id,
          occurred_at: nowIso,
          metadata: {
            requestId,
            reason: event.reason || "Delivery failed",
            recipient_phone: queueItem.recipient_phone,
          },
        });

        // Urgent notification alert to receptionist (Peer Review Finding 4: category: 'system')
        const urgentMessageTypes = [
          "appointment_booked",
          "appointment_rescheduled",
          "appointment_reminder",
        ];
        if (urgentMessageTypes.includes(queueItem.message_type)) {
          await supabase.from("in_app_notifications").insert({
            tenant_id: queueItem.tenant_id,
            recipient_role: "receptionist",
            category: "system", // Constraint check: ('clinical', 'queue', 'billing', 'system')
            event_type: "whatsapp_delivery_failed",
            title: "WhatsApp Delivery Failed",
            message: `Failed to deliver notification to patient (${queueItem.recipient_phone}). Reason: ${event.reason || "Unreachable"}`,
            link_url: "/calendar",
          });
        }

        return NextResponse.json({
          success: true,
          event: "dlr_processed",
          status: "dead_letter",
        });
      }

      return NextResponse.json({
        success: true,
        event: "dlr_ignored_unhandled_status",
        status: event.status,
      });
    }

    // Branch B: Inbound Customer Interaction for MSG91
    return handleInboundAction({
      provider,
      from: event.from,
      body: event.body,
      action: event.action,
      replyMsgId: event.replyMsgId,
      supabase,
      nowIso,
    });
  }

  // 3. Fallback Parser for Other Providers (dev, twilio, gupshup)
  let from = req.nextUrl.searchParams.get("from") || "";
  let body = req.nextUrl.searchParams.get("action") || req.nextUrl.searchParams.get("body") || "";
  let replyMsgId = req.nextUrl.searchParams.get("replyMsgId") || undefined;
  let isButtonClicked = false;

  if (rawBody) {
    try {
      if (req.headers.get("content-type")?.includes("application/json")) {
        const json = JSON.parse(rawBody);
        from = json.from || json.sender || json.mobile || json.customerNumber || from;
        body = json.body || json.text || json.action || json.payload || body;
        replyMsgId = json.replyMsgId || json.reply_msg_id || replyMsgId;
        if (json.action && json.action.startsWith("btn_")) {
          isButtonClicked = true;
        }
      } else {
        const formData = new URLSearchParams(rawBody);
        from = formData.get("From") || formData.get("from") || from;
        body = formData.get("Body") || formData.get("body") || formData.get("action") || body;
        replyMsgId = formData.get("replyMsgId") || replyMsgId;
        if (body.startsWith("btn_")) {
          isButtonClicked = true;
        }
      }
    } catch {
      // ignore parse error and use query params
    }
  }

  if (body.startsWith("btn_")) {
    isButtonClicked = true;
  }

  const action = parseInboundAction(body, isButtonClicked);

  return handleInboundAction({
    provider,
    from,
    body,
    action,
    replyMsgId,
    supabase,
    nowIso,
  });
}

/**
 * Shared Inbound Action Handler for Two-Way WhatsApp Bot Interactions.
 * Enforces tenant-scoped message correlation (Finding 5), button-gated slot release (D-04),
 * and conversational auto-triage (D-05).
 */
async function handleInboundAction({
  provider,
  from,
  body,
  action,
  replyMsgId,
  supabase,
  nowIso,
}: {
  provider: string;
  from: string;
  body: string;
  action: "confirm" | "cancel" | "reschedule" | "unhandled";
  replyMsgId?: string;
  supabase: any;
  nowIso: string;
}) {
  if (!from) {
    return NextResponse.json(
      { error: "Missing sender phone number (from)" },
      { status: 400 }
    );
  }

  // 1. Resolve appointment via replyMsgId message correlation first (Finding 5)
  let appointment: any = null;

  if (replyMsgId) {
    const { data: queueItem } = await supabase
      .from("communication_queue")
      .select("*")
      .or(`external_message_id.eq.${replyMsgId},metadata->>message_id.eq.${replyMsgId}`)
      .maybeSingle();

    if (queueItem) {
      const appointmentId = queueItem.metadata?.appointment_id || queueItem.metadata?.visit_id;
      if (appointmentId && queueItem.tenant_id) {
        const { data: correlatedVisit } = await supabase
          .from("visits")
          .select("*, patient:patients(*)")
          .eq("id", appointmentId)
          .eq("tenant_id", queueItem.tenant_id)
          .maybeSingle();

        if (correlatedVisit && !["cancelled", "completed"].includes(correlatedVisit.status)) {
          appointment = correlatedVisit;
        }
      }
    }
  }

  // Fallback to active appointment lookup by phone
  if (!appointment) {
    appointment = await findActiveAppointmentByPhone(from);
  }

  // 2. Unmatched appointment handling
  if (!appointment) {
    try {
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
    } catch (err) {
      console.error("[Webhook] Failed to dispatch bot_not_found message:", err);
    }

    return NextResponse.json(
      { success: true, action: "unmatched", message: "No active appointment found" },
      { status: 200 }
    );
  }

  // 3. Action: [Confirm] Flow (D-04)
  if (action === "confirm") {
    await supabase
      .from("visits")
      .update({
        status: "confirmed",
        metadata: {
          ...(appointment.metadata || {}),
          patient_confirmed: true,
          confirmed_at: nowIso,
          confirmed_via: "whatsapp_bot",
        },
        updated_at: nowIso,
      })
      .eq("id", appointment.id);

    await supabase.from("audit_logs").insert({
      tenant_id: appointment.tenant_id,
      actor_id: null,
      actor_role: "patient",
      action: "appointment_confirmed_whatsapp",
      entity_type: "visits",
      entity_id: appointment.id,
      occurred_at: nowIso,
      metadata: { from, appointment_id: appointment.id },
    });

    try {
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
    } catch (err) {
      console.error("[Webhook] Failed to dispatch appointment_confirmed_ack:", err);
    }

    return NextResponse.json({
      success: true,
      action: "confirmed",
      appointment_id: appointment.id,
    });
  }

  // 4. Action: [Cancel] Flow with Immediate Calendar Slot Release (D-04, Finding 5)
  // Strictly restricted to action === "cancel" (which requires explicit button click btn_cancel)
  if (action === "cancel") {
    await cancelAppointment({
      appointmentId: appointment.id,
      reason: "patient_whatsapp_bot",
      cancelledBy: from,
      isClinicInitiated: false,
    });

    await supabase.from("audit_logs").insert({
      tenant_id: appointment.tenant_id,
      actor_id: null,
      actor_role: "patient",
      action: "appointment_cancelled_whatsapp",
      entity_type: "visits",
      entity_id: appointment.id,
      occurred_at: nowIso,
      metadata: { from, appointment_id: appointment.id },
    });

    try {
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
    } catch (err) {
      console.error("[Webhook] Failed to dispatch appointment_cancelled_ack:", err);
    }

    return NextResponse.json({
      success: true,
      action: "cancelled",
      appointment_id: appointment.id,
    });
  }

  // 5. Action: [Reschedule] Flow (D-04)
  if (action === "reschedule") {
    const rescheduleUrl = await generateRescheduleToken(
      appointment.id,
      appointment.tenant_id
    );

    // Front-desk alert
    await supabase.from("in_app_notifications").insert({
      tenant_id: appointment.tenant_id,
      recipient_role: "receptionist",
      category: "system", // Constraint check: ('clinical', 'queue', 'billing', 'system')
      event_type: "reschedule_requested",
      title: "Appointment Reschedule Requested",
      message: `Patient ${appointment.patient?.full_name || from} requested to reschedule via WhatsApp.`,
      link_url: `/calendar`,
    });

    try {
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
    } catch (err) {
      console.error("[Webhook] Failed to dispatch appointment_reschedule_link:", err);
    }

    return NextResponse.json({
      success: true,
      action: "reschedule_link_generated",
      appointment_id: appointment.id,
      reschedule_url: rescheduleUrl,
    });
  }

  // 6. Action: Unhandled / Conversational Auto-Triage (D-05, Event #18)
  await supabase.from("in_app_notifications").insert({
    tenant_id: appointment.tenant_id,
    recipient_role: "receptionist",
    category: "system", // Constraint check: ('clinical', 'queue', 'billing', 'system')
    event_type: "inbound_whatsapp_reply",
    title: `Inbound WhatsApp: ${appointment.patient?.full_name || from}`,
    message: `Patient message: "${body}"`,
    link_url: `/patients/${appointment.patient_id}`,
  });

  try {
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
  } catch (err) {
    console.error("[Webhook] Failed to dispatch conversational_triage:", err);
  }

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
