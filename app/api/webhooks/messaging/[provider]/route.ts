import { NextRequest, NextResponse } from "next/server";
import {
  cancelAppointment,
  generateRescheduleToken,
  type AppointmentSystemContext,
} from "@/features/appointments/system";
import { getSystemDb } from "@/lib/supabase/system";
import { enqueueMessageAsSystem, enqueueUnmatchedReplyAsSystem } from "@/lib/jobs/enqueue";
import { toIndianMobileE164FromInternational, toIndianMobileE164Strict } from "@/lib/utils/phone";
import {
  inboundDedupeKey,
  parseMsg91Payload,
  verifyMsg91WebhookSecret,
  type Msg91WebhookEvent,
} from "@/lib/messaging/webhook-helpers";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

/**
 * Inbound messaging webhook (P0-03). Only `msg91` exists: every other provider value (dev, twilio, gupshup, unknown)
 * and every method other than POST answers 404 with an empty body (default deny, D5/D6). A missing or wrong
 * `x-webhook-secret` header answers 401 before any database access. Responses never carry ids, tokens or URLs.
 *
 * V2-04 04-03c (P0-12; R-25; T-04-08):
 * - Exactly-once effect: after the secret check the callback's key (`inboundDedupeKey`: `dlr:<requestId>:<status>`, or
 *   the inbound message's id / a hash of the raw body) is claimed with `inbound_webhook_begin('msg91', key)`. A provider
 *   retry of a callback that finished, or one arriving while another instance processes it, answers 200 with no side
 *   effect. An exception marks the key `failed` and answers 500, so MSG91 retries; a retry is safe because every
 *   effect is status-guarded or deduplicated (visit updates filter on status, replies carry `bot:<key>:<template>`).
 * - Delivery reports go through `communication_queue_apply_dlr` (monotonic status + audit row in one transaction).
 * - No bot reply is sent here: replies are queued (`enqueueMessageAsSystem`, visible in the communication log, or
 *   `enqueueUnmatchedReplyAsSystem` for a sender no patient matches) and the job runner sends them.
 */
const ACCEPTED_PROVIDER = "msg91";

const OK = () => NextResponse.json({ ok: true }, { status: 200 });
const notFound = () => new NextResponse(null, { status: 404 });

type SystemDb = AppointmentSystemContext["db"];
type Outcome = "processed" | "ignored";

async function handleMsg91Webhook(req: NextRequest) {
  if (!verifyMsg91WebhookSecret(req.headers)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const rawBody = await req.text();
  const event = parseMsg91Payload(rawBody);
  if (event.type === "inbound" && !event.from) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const key = inboundDedupeKey(event, rawBody);
  // A delivery report without a request id, or with a status nothing acts on, has no effect to protect.
  if (!key) return OK();

  // Allow-listed system path (ADR-0005 D2): opened only after the secret check above.
  const supabase: SystemDb = getSystemDb("webhook.messaging_inbound");
  const requestId = await getRequestId();

  const { data: claim, error: beginError } = await supabase.rpc("inbound_webhook_begin", {
    p_provider: "msg91",
    p_dedupe_key: key,
  });
  if (beginError) {
    log.error({ event: "messaging.inbound.dedupe_failed", code: errorTag(beginError), requestId });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  if (claim !== "process") {
    log.info({ event: "messaging.inbound.duplicate", reason: claim === "in_flight" ? "in_flight" : "key_seen", requestId });
    return OK();
  }

  try {
    const outcome = event.type === "dlr" ? await applyDeliveryReport(supabase, event) : await handleInboundAction(supabase, event, key);
    await finish(supabase, key, outcome);
    return OK();
  } catch (err) {
    log.error({ event: "messaging.inbound.failed", code: errorTag(err), requestId });
    try {
      await finish(supabase, key, "failed");
    } catch (finishErr) {
      // The key stays unfinished: the next delivery reprocesses it after 5 minutes.
      log.error({ event: "messaging.inbound.finish_failed", code: errorTag(finishErr), requestId });
    }
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

async function finish(supabase: SystemDb, key: string, outcome: Outcome | "failed") {
  const { error } = await supabase.rpc("inbound_webhook_finish", {
    p_provider: "msg91",
    p_dedupe_key: key,
    p_outcome: outcome,
  });
  if (error) throw error;
}

const URGENT_MESSAGE_TYPES = ["appointment_booked", "appointment_rescheduled", "appointment_reminder"];
const REASON_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;

/**
 * Branch A: delivery reports (Decision D-06, Peer Review Findings 3, 4, 6). One RPC applies the monotonic transition
 * and its audit row; a report that changes nothing (unknown id, a repeat, `delivered` after `read`, `failed` after
 * `delivered`) is `ignored`. The urgent-failure note is written only when a `failed` report was applied.
 */
async function applyDeliveryReport(
  supabase: SystemDb,
  event: Extract<Msg91WebhookEvent, { type: "dlr" }>
): Promise<Outcome> {
  const status = event.status as "delivered" | "read" | "failed";
  const at = status === "delivered" ? event.deliveredAt : status === "read" ? event.readAt : undefined;
  const atMs = at ? Date.parse(at) : Number.NaN;
  const { data, error } = await supabase.rpc("communication_queue_apply_dlr", {
    p_external_message_id: event.requestId,
    p_status: status,
    p_at: Number.isFinite(atMs) ? new Date(atMs).toISOString() : (null as unknown as string),
    // The provider's reason is stored only when it is a machine code (error_message holds codes, never free text).
    p_reason_code: event.reason && REASON_CODE.test(event.reason) ? event.reason : (null as unknown as string),
  });
  if (error) throw error;
  const applied = (data ?? {}) as {
    applied?: boolean;
    tenant_id?: string;
    message_type?: string;
    recipient_phone?: string | null;
  };
  if (!applied.applied) return "ignored";

  // Urgent notification alert to receptionist (Peer Review Finding 4: category: 'system'). Copy unchanged; the phone in
  // it stays flagged for V2-12 (P1-13).
  if (status === "failed" && applied.tenant_id && URGENT_MESSAGE_TYPES.includes(applied.message_type ?? "")) {
    const { error: noteError } = await supabase.from("in_app_notifications").insert({
      tenant_id: applied.tenant_id,
      recipient_role: "receptionist",
      category: "system", // Constraint check: ('clinical', 'queue', 'billing', 'system')
      event_type: "whatsapp_delivery_failed",
      title: "WhatsApp Delivery Failed",
      message: `Failed to deliver notification to patient (${applied.recipient_phone}). Reason: ${event.reason || "Unreachable"}`,
      link_url: "/calendar",
    });
    // Not retried (the transition is applied; a retry would see a repeat): logged.
    if (noteError) log.warn({ event: "messaging.dlr_note.failed", code: errorTag(noteError) });
  }
  return "processed";
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

/**
 * True when the inbound sender and the stored recipient are the same Indian mobile in full E.164 (+91 and [6-9] + 9
 * digits). AR2-L3: country code included, so a foreign number ending in the same 10 digits (`+1 917 123 4567` vs
 * `9171234567`) never matches. AR3-N3: the sender must carry the country code itself; a bare 10-digit sender is
 * refused, so `+65 9123 4567` (international digits `6591234567`) never reads as `+916591234567`.
 */
function isSameMobile(from: string | null | undefined, recipient: string | null | undefined): boolean {
  const x = toIndianMobileE164FromInternational(from);
  return x !== null && x === toIndianMobileE164Strict(recipient);
}

/** AR2-L4: a patient reply may only confirm, cancel or reschedule a visit that has not started. */
const PATIENT_ACTIONABLE_STATUSES = ["booked", "confirmed"] as const;

function isPatientActionable(status: string | null | undefined): boolean {
  return (PATIENT_ACTIONABLE_STATUSES as readonly string[]).includes(status ?? "");
}

type BotReplyTemplate =
  | "appointment_confirmed_ack"
  | "appointment_cancelled_ack"
  | "appointment_reschedule_link"
  | "conversational_triage";

/**
 * Queues one bot reply to the number the message was sent to (AR-L1) through the system enqueue RPC (R-25: it appears
 * in the communication log; the runner sends it). `bot:<key>:<template>` makes a reprocessed callback queue it once.
 * Best effort, as the direct send was: the state change already stands and a retry could not re-run it.
 */
async function queueReply(
  supabase: SystemDb,
  key: string,
  appointment: { id: string; patient_id: string },
  replyTo: string,
  templateId: BotReplyTemplate,
  templateParams: Record<string, string>
) {
  try {
    await enqueueMessageAsSystem(
      supabase,
      {
        patientId: appointment.patient_id,
        visitId: appointment.id,
        channel: "whatsapp",
        messageType: templateId,
        templateId,
        templateParams,
        recipientPhone: replyTo,
        dedupeKey: `bot:${key}:${templateId}`,
      },
      "system:messaging_webhook"
    );
  } catch (err) {
    log.error({ event: "messaging.inbound_reply.enqueue_failed", code: errorTag(err), requestId: await getRequestId() });
  }
}

/**
 * Branch B: two-way WhatsApp bot interactions (D-04, D-05, Finding 5): tenant-scoped message correlation,
 * button-gated slot release and conversational auto-triage. State changes are status-guarded, so a reprocessed
 * callback changes nothing twice; replies are queued, never sent here.
 */
async function handleInboundAction(
  supabase: SystemDb,
  event: Extract<Msg91WebhookEvent, { type: "inbound" }>,
  key: string
): Promise<Outcome> {
  const { from, body, action, replyMsgId } = event;
  const nowIso = new Date().toISOString();
  const sys: AppointmentSystemContext = { db: supabase, reason: "messaging_webhook" };

  // 1. Resolve the appointment strictly via replyMsgId message correlation, from the number it was sent to (AR-L1)
  const resolved = await resolveAppointmentByReply(supabase, replyMsgId, from);

  // 2. Unmatched sender: one queued "not found" reply (R-25: a tenant-less job whose phone is erased when it finishes).
  // Only an Indian mobile in E.164 gets one (T-04-16); any other sender gets nothing.
  if (!resolved) {
    const to = toIndianMobileE164FromInternational(from);
    if (!to) return "ignored";
    try {
      await enqueueUnmatchedReplyAsSystem(supabase, {
        to,
        templateId: "bot_not_found",
        dedupeKey: `bot:${key}:bot_not_found`,
      });
    } catch (err) {
      log.error({ event: "messaging.inbound_bot_not_found.failed", code: errorTag(err), requestId: await getRequestId() });
    }
    return "processed";
  }

  const appointment: any = resolved.visit;
  // Replies (including the reschedule link) go only to the stored number the message was sent to (AR-L1).
  const replyTo = resolved.recipientPhone;
  const patientName = appointment.patient?.full_name || "Patient";

  // 3. Action: [Confirm] Flow (D-04). Only a 'booked' visit becomes 'confirmed' (AR-L1): a late "yes" must not pull a
  // waiting or in-consultation patient out of the queue. An already confirmed visit just gets the acknowledgement.
  if (action === "confirm") {
    if (!isPatientActionable(appointment.status)) {
      return "ignored";
    }

    if (appointment.status === "booked") {
      const { data: confirmed, error: confirmError } = await supabase
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
        .eq("status", "booked")
        .select("id");
      if (confirmError) throw confirmError;

      // Audited only by the call that changed the visit (a concurrent or repeated confirm changes nothing).
      if ((confirmed ?? []).length > 0) {
        const { error: auditError } = await supabase.from("audit_logs").insert({
          tenant_id: appointment.tenant_id,
          actor_id: null,
          actor_role: "patient",
          action: "appointment_confirmed_whatsapp",
          entity_type: "visits",
          entity_id: appointment.id,
          occurred_at: nowIso,
          metadata: { appointment_id: appointment.id },
        });
        if (auditError) log.warn({ event: "messaging.inbound_confirm_audit.failed", code: errorTag(auditError) });
      }
    }

    await queueReply(supabase, key, appointment, replyTo, "appointment_confirmed_ack", {
      patient_name: patientName,
      message: `Thank you! Your appointment has been confirmed. We look forward to seeing you.`,
    });
    return "processed";
  }

  // 4. Action: [Cancel] Flow with Immediate Calendar Slot Release (D-04, Finding 5)
  // Strictly restricted to action === "cancel" (which requires explicit button click btn_cancel)
  // AR2-L4: only a booked or confirmed visit (checked again in the UPDATE filter); a late "cancel" for a patient who is
  // already waiting or with the doctor changes nothing.
  if (action === "cancel") {
    if (!isPatientActionable(appointment.status)) {
      return "ignored";
    }
    try {
      await cancelAppointment(sys, {
        appointmentId: appointment.id,
        reason: "patient_whatsapp_bot",
        isClinicInitiated: false,
        onlyFromStatuses: PATIENT_ACTIONABLE_STATUSES,
      });
    } catch (err) {
      log.warn({ event: "messaging.inbound_cancel.failed", code: errorTag(err), requestId: await getRequestId() });
      return "ignored";
    }

    const { error: auditError } = await supabase.from("audit_logs").insert({
      tenant_id: appointment.tenant_id,
      actor_id: null,
      actor_role: "patient",
      action: "appointment_cancelled_whatsapp",
      entity_type: "visits",
      entity_id: appointment.id,
      occurred_at: nowIso,
      metadata: { appointment_id: appointment.id },
    });
    if (auditError) log.warn({ event: "messaging.inbound_cancel_audit.failed", code: errorTag(auditError) });

    await queueReply(supabase, key, appointment, replyTo, "appointment_cancelled_ack", {
      patient_name: patientName,
      message: "Your appointment has been cancelled. If you would like to book again in the future, please contact us.",
    });
    return "processed";
  }

  // 5. Action: [Reschedule] Flow (D-04)
  if (action === "reschedule") {
    // Only a booked or confirmed visit gets a link (AR2-L4; create_reschedule_token and consume_reschedule_token refuse
    // the others too, 000023); the front desk is still alerted.
    let rescheduleUrl: string | null = null;
    if (isPatientActionable(appointment.status)) {
      try {
        rescheduleUrl = await generateRescheduleToken(sys, appointment.id);
      } catch {
        rescheduleUrl = null;
      }
    }

    // Front-desk alert
    const { error: noteError } = await supabase.from("in_app_notifications").insert({
      tenant_id: appointment.tenant_id,
      recipient_role: "receptionist",
      category: "system", // Constraint check: ('clinical', 'queue', 'billing', 'system')
      event_type: "reschedule_requested",
      title: "Appointment Reschedule Requested",
      message: `Patient ${appointment.patient?.full_name || from} requested to reschedule via WhatsApp.`,
      link_url: `/calendar`,
    });
    if (noteError) log.warn({ event: "messaging.inbound_reschedule_note.failed", code: errorTag(noteError) });

    if (rescheduleUrl) {
      await queueReply(supabase, key, appointment, replyTo, "appointment_reschedule_link", {
        patient_name: patientName,
        message: `To pick a new appointment time that works best for you, please tap this link: ${rescheduleUrl}`,
      });
    }
    return "processed";
  }

  // 6. Action: Unhandled / Conversational Auto-Triage (D-05, Event #18)
  const { error: triageError } = await supabase.from("in_app_notifications").insert({
    tenant_id: appointment.tenant_id,
    recipient_role: "receptionist",
    category: "system", // Constraint check: ('clinical', 'queue', 'billing', 'system')
    event_type: "inbound_whatsapp_reply",
    title: `Inbound WhatsApp: ${appointment.patient?.full_name || from}`,
    message: `Patient message: "${body}"`,
    link_url: `/patients/${appointment.patient_id}`,
  });
  if (triageError) throw triageError;

  await queueReply(supabase, key, appointment, replyTo, "conversational_triage", {
    message:
      "Thank you for contacting us. We have received your message and our reception desk will assist you shortly. For urgent care, please call the clinic directly.",
  });
  return "processed";
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
