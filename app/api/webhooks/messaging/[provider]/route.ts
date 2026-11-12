import { NextRequest, NextResponse } from "next/server";
import {
  cancelAppointment,
  generateRescheduleToken,
  type AppointmentSystemContext,
} from "@/features/appointments/system";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendDirectWhatsApp } from "@/lib/messaging";
import { extractTenDigits } from "@/lib/utils/phone";
import {
  verifyMsg91WebhookSecret,
  parseMsg91Payload,
} from "@/lib/messaging/webhook-helpers";

/**
 * Inbound messaging webhook (P0-03). Only `msg91` exists: every other provider value (dev, twilio, gupshup, unknown)
 * and every method other than POST answers 404 with an empty body (default deny, D5/D6). A missing or wrong
 * `x-webhook-secret` header answers 401 before any database access. Responses never carry ids, tokens or URLs.
 */
const ACCEPTED_PROVIDER = "msg91";

const OK = () => NextResponse.json({ ok: true }, { status: 200 });
const notFound = () => new NextResponse(null, { status: 404 });

async function handleMsg91Webhook(req: NextRequest) {
  if (!verifyMsg91WebhookSecret(req.headers)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const rawBody = await req.text();
  const event = parseMsg91Payload(rawBody);
  // Allow-listed system path (ADR-0005 D2): opened only after the secret check above.
  const supabase: AppointmentSystemContext["db"] = getAdminClient();
  const nowIso = new Date().toISOString();

  // Branch A: Delivery Reports (DLR) (Decision D-06, Peer Review Findings 3, 4, 6)
  if (event.type === "dlr") {
    const requestId = event.requestId;
    if (!requestId) {
      return OK();
    }

    const { data: queueItem } = await supabase
      .from("communication_queue")
      .select("*")
      .eq("external_message_id", requestId)
      .maybeSingle();

    if (!queueItem) {
      return OK();
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

      return OK();
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

      return OK();
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

      return OK();
    }

    return OK();
  }

  // Branch B: Inbound customer interaction
  return handleInboundAction({
    from: event.from,
    body: event.body,
    action: event.action,
    replyMsgId: event.replyMsgId,
    supabase,
    nowIso,
  });
}

/**
 * Resolves the visit a reply refers to. Only the `replyMsgId` correlation is used (P0-03, SEC-04/SEC-19):
 * `communication_queue.external_message_id` is matched with `.eq` (a bound value, never a PostgREST filter string),
 * and the visit is then read inside the queue row's tenant. There is no phone-number fallback.
 */
async function resolveAppointmentByReply(supabase: any, replyMsgId: string | undefined, from: string) {
  if (!replyMsgId) return null;

  const { data: queueItem } = await supabase
    .from("communication_queue")
    .select("id, tenant_id, appointment_id, recipient_phone, metadata")
    .eq("external_message_id", replyMsgId)
    .maybeSingle();

  if (!queueItem?.tenant_id) return null;

  // AR-L1: the reply must come from the number the message was sent to; otherwise it is treated as unmatched.
  if (!isSameMobile(from, queueItem.recipient_phone)) return null;

  // The dispatcher stores the visit in the `appointment_id` column; older rows may carry it in metadata.
  const appointmentId =
    queueItem.appointment_id || queueItem.metadata?.appointment_id || queueItem.metadata?.visit_id;
  if (!appointmentId) return null;

  const { data: visit } = await supabase
    .from("visits")
    .select("*, patient:patients(*)")
    .eq("id", appointmentId)
    .eq("tenant_id", queueItem.tenant_id)
    .maybeSingle();

  if (!visit || ["cancelled", "completed"].includes(visit.status)) return null;
  return { visit, recipientPhone: queueItem.recipient_phone as string };
}

/** True when both numbers reduce to the same 10-digit Indian mobile number. */
function isSameMobile(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = extractTenDigits(a);
  return x.length === 10 && x === extractTenDigits(b);
}

/**
 * Shared Inbound Action Handler for Two-Way WhatsApp Bot Interactions.
 * Enforces tenant-scoped message correlation (Finding 5), button-gated slot release (D-04),
 * and conversational auto-triage (D-05).
 */
async function handleInboundAction({
  from,
  body,
  action,
  replyMsgId,
  supabase,
  nowIso,
}: {
  from: string;
  body: string;
  action: "confirm" | "cancel" | "reschedule" | "unhandled";
  replyMsgId?: string;
  supabase: any;
  nowIso: string;
}) {
  if (!from) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const sys: AppointmentSystemContext = { db: supabase, reason: "messaging_webhook" };

  // 1. Resolve the appointment strictly via replyMsgId message correlation, from the number it was sent to (AR-L1)
  const resolved = await resolveAppointmentByReply(supabase, replyMsgId, from);

  // 2. Unmatched appointment handling
  if (!resolved) {
    try {
      await sendDirectWhatsApp(from, "bot_not_found", {
        message:
          "We could not find an upcoming scheduled appointment for this phone number. For assistance, please call the clinic directly.",
      });
    } catch (err) {
      console.error("[Webhook] Failed to dispatch bot_not_found message:", err);
    }

    return OK();
  }

  const appointment: any = resolved.visit;
  // Replies (including the reschedule link) go only to the stored number the message was sent to (AR-L1).
  const replyTo = resolved.recipientPhone;

  // 3. Action: [Confirm] Flow (D-04). Only a 'booked' visit becomes 'confirmed' (AR-L1): a late "yes" must not pull a
  // waiting or in-consultation patient out of the queue. An already confirmed visit just gets the acknowledgement.
  if (action === "confirm") {
    if (appointment.status !== "booked" && appointment.status !== "confirmed") {
      return OK();
    }

    if (appointment.status === "booked") {
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
        .eq("id", appointment.id)
        .eq("status", "booked");

      await supabase.from("audit_logs").insert({
        tenant_id: appointment.tenant_id,
        actor_id: null,
        actor_role: "patient",
        action: "appointment_confirmed_whatsapp",
        entity_type: "visits",
        entity_id: appointment.id,
        occurred_at: nowIso,
        metadata: { appointment_id: appointment.id },
      });
    }

    try {
      await sendDirectWhatsApp(
        replyTo,
        "appointment_confirmed_ack",
        {
          patient_name: appointment.patient?.full_name || "Patient",
          message: `Thank you! Your appointment has been confirmed. We look forward to seeing you.`,
        }
      );
    } catch (err) {
      console.error("[Webhook] Failed to dispatch appointment_confirmed_ack:", err);
    }

    return OK();
  }

  // 4. Action: [Cancel] Flow with Immediate Calendar Slot Release (D-04, Finding 5)
  // Strictly restricted to action === "cancel" (which requires explicit button click btn_cancel)
  if (action === "cancel") {
    await cancelAppointment(sys, {
      appointmentId: appointment.id,
      reason: "patient_whatsapp_bot",
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
      metadata: { appointment_id: appointment.id },
    });

    try {
      await sendDirectWhatsApp(
        replyTo,
        "appointment_cancelled_ack",
        {
          patient_name: appointment.patient?.full_name || "Patient",
          message:
            "Your appointment has been cancelled. If you would like to book again in the future, please contact us.",
        }
      );
    } catch (err) {
      console.error("[Webhook] Failed to dispatch appointment_cancelled_ack:", err);
    }

    return OK();
  }

  // 5. Action: [Reschedule] Flow (D-04)
  if (action === "reschedule") {
    // A closed or missing appointment gets no link (create_reschedule_token refuses it); the front desk is still alerted.
    let rescheduleUrl: string | null = null;
    try {
      rescheduleUrl = await generateRescheduleToken(sys, appointment.id);
    } catch {
      rescheduleUrl = null;
    }

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
      if (rescheduleUrl) {
        await sendDirectWhatsApp(
          replyTo,
          "appointment_reschedule_link",
          {
            patient_name: appointment.patient?.full_name || "Patient",
            message: `To pick a new appointment time that works best for you, please tap this link: ${rescheduleUrl}`,
          }
        );
      }
    } catch (err) {
      console.error("[Webhook] Failed to dispatch appointment_reschedule_link:", err);
    }

    return OK();
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
      replyTo,
      "conversational_triage",
      {
        message:
          "Thank you for contacting us. We have received your message and our reception desk will assist you shortly. For urgent care, please call the clinic directly.",
      }
    );
  } catch (err) {
    console.error("[Webhook] Failed to dispatch conversational_triage:", err);
  }

  return OK();
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  const { provider } = await context.params;
  if (provider !== ACCEPTED_PROVIDER) return notFound();
  return handleMsg91Webhook(req);
}

// Every other method is not part of the webhook contract (the GET simulator is deleted, D5).
export async function GET() {
  return notFound();
}
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
export const OPTIONS = GET;
