import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueMessage } from "@/lib/messaging/dispatcher";
import { enqueueWebhookEvent } from "@/lib/webhooks/outbox";

/**
 * Appointment use-cases that run without a signed-in user (ADR-0005 D2): the inbound messaging webhook
 * (`app/api/webhooks/**`, allow-listed) and the follow-up of a public reschedule link (called only from
 * `features/sharing/system.ts` after `consume_reschedule_token` succeeded). This module is `server-only`, never
 * `"use server"`, and builds no client of its own: the caller passes the database it was allowed to open and a fixed
 * reason label. The acting principal is the system, recorded as `system:<reason>`; no caller-chosen actor or acting
 * tenant is accepted (the tenant always comes from the appointment row).
 */
export type AppointmentSystemReason = "messaging_webhook" | "patient_self_service_reschedule";

export interface AppointmentSystemContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>;
  reason: AppointmentSystemReason;
}

export interface CancelAppointmentInput {
  appointmentId: string;
  reason?: string;
  isClinicInitiated?: boolean;
  /**
   * When set, the visit is cancelled only while its status is one of these (checked in the UPDATE filter as well), so
   * a late patient reply cannot cancel a visit that has since moved on (AR2-L4). Otherwise throws "Appointment not
   * cancellable".
   */
  onlyFromStatuses?: readonly string[];
}

/**
 * Side effects of a reschedule that the database already applied (`consume_reschedule_token`, 000020): queues
 * Event #2 (appointment_rescheduled) to the patient and the `appointment.rescheduled` webhook event. The visit and
 * tenant are read from the appointment row; the new time is the one stored on it.
 */
export async function notifyAppointmentRescheduled(sys: AppointmentSystemContext, appointmentId: string) {
  const supabase = sys.db;

  const { data: visit, error: fetchError } = await supabase
    .from("visits")
    .select("id, tenant_id, patient_id, scheduled_at, patient:patients(full_name, phone)")
    .eq("id", appointmentId)
    .single();

  if (fetchError || !visit) {
    throw new Error("Appointment not found");
  }

  const input = { appointmentId: visit.id as string, newScheduledAt: visit.scheduled_at as string };
  const rawPatient = (visit as { patient?: unknown }).patient;
  const patient = (Array.isArray(rawPatient) ? rawPatient[0] : rawPatient) as
    | { full_name?: string | null; phone?: string | null }
    | null
    | undefined;

  // Queue Event #2 (appointment_rescheduled)
  if (patient?.phone) {
    const formattedDateTime = new Date(input.newScheduledAt).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    });

    await enqueueMessage(supabase, {
      tenantId: visit.tenant_id,
      patientId: visit.patient_id,
      appointmentId: visit.id,
      channel: "whatsapp",
      messageType: "appointment_rescheduled",
      templateId: "appointment_rescheduled",
      templateParams: {
        patient_name: patient.full_name || "Patient",
        doctor_name: "Doctor",
        new_date_time: formattedDateTime,
      },
      recipientPhone: patient.phone,
      metadata: {
        buttons: [
          { id: "btn_confirm", text: "Confirm" },
          { id: "btn_cancel", text: "Cancel" },
        ],
      },
    });
  }

  // Enqueue webhook event: appointment.rescheduled
  try {
    await enqueueWebhookEvent(supabase, visit.tenant_id, "appointment.rescheduled", {
      appointment_id: input.appointmentId,
      scheduled_at: input.newScheduledAt,
    });
  } catch (webhookErr) {
    console.warn("[notifyAppointmentRescheduled] Failed to enqueue webhook event:", webhookErr);
  }
}

/**
 * Cancels an appointment, releases slot, notifies waitlist if applicable, and optionally queues Event #3.
 */
export async function cancelAppointment(sys: AppointmentSystemContext, input: CancelAppointmentInput) {
  const supabase = sys.db;

  const { data: visit, error: fetchError } = await supabase
    .from("visits")
    .select("*, patient:patients(full_name, phone)")
    .eq("id", input.appointmentId)
    .single();

  if (fetchError || !visit) {
    throw new Error("Appointment not found");
  }

  if (input.onlyFromStatuses && !input.onlyFromStatuses.includes(visit.status)) {
    throw new Error("Appointment not cancellable");
  }

  let cancelQuery = supabase
    .from("visits")
    .update({
      status: "cancelled",
      metadata: {
        ...(visit.metadata || {}),
        cancellation_reason: input.reason || "clinic_cancelled",
        cancelled_by: `system:${sys.reason}`,
        cancelled_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.appointmentId)
    .eq("tenant_id", visit.tenant_id);
  if (input.onlyFromStatuses) {
    cancelQuery = cancelQuery.in("status", [...input.onlyFromStatuses]);
  }
  const { data: updated, error: updateError } = await cancelQuery.select().single();

  if (input.onlyFromStatuses && (updateError || !updated)) {
    throw new Error("Appointment not cancellable");
  }
  if (updateError || !updated) {
    throw new Error(`Failed to cancel appointment: ${updateError?.message || "Unknown error"}`);
  }

  // Enqueue webhook event: appointment.cancelled
  try {
    await enqueueWebhookEvent(supabase, visit.tenant_id, "appointment.cancelled", {
      appointment_id: input.appointmentId,
      reason: input.reason || "clinic_cancelled",
    });
  } catch (webhookErr) {
    console.warn("[cancelAppointment] Failed to enqueue webhook event:", webhookErr);
  }

  // Check waitlist for opening and alert front desk (Event #17: waitlist_slot_freed)
  try {
    const { data: waitlist } = await supabase
      .from("waitlist_entries")
      .select("id")
      .eq("tenant_id", visit.tenant_id)
      .eq("status", "waiting")
      .limit(1);

    if (waitlist && waitlist.length > 0) {
      await supabase.from("in_app_notifications").insert({
        tenant_id: visit.tenant_id,
        recipient_role: "receptionist",
        category: "queue",
        event_type: "waitlist_slot_freed",
        title: "Waitlist Slot Freed",
        message: `An appointment was cancelled. Slot is now available for waitlisted patients.`,
        link_url: `/queue?tab=waitlist`,
      });
    }
  } catch (err) {
    console.warn("[cancelAppointment] Waitlist check error:", err);
  }

  // Queue Event #3 (appointment_cancelled) if clinic-initiated
  if (input.isClinicInitiated && visit.patient?.phone) {
    await enqueueMessage(supabase, {
      tenantId: visit.tenant_id,
      patientId: visit.patient_id,
      appointmentId: visit.id,
      channel: "whatsapp",
      messageType: "appointment_cancelled",
      templateId: "appointment_cancelled",
      templateParams: {
        patient_name: visit.patient?.full_name || "Patient",
        reason: input.reason || "Schedule conflict",
      },
      recipientPhone: visit.patient?.phone,
    });
  }

  return { success: true, appointment: updated };
}

/**
 * Generates a 24-hour tokenized self-service appointment reschedule link for `appointmentId`. The tenant is read
 * from the appointment row, never taken from the caller. (Token storage is replaced by 01-04, P0-04.)
 */
export async function generateRescheduleToken(sys: AppointmentSystemContext, appointmentId: string): Promise<string> {
  // create_reschedule_token (000020, service_role only): resource_type 'appointment', created_by NULL (system-issued,
  // D9), tenant from the visit row, 24 h expiry; refused for a missing, completed or cancelled visit. Errors are
  // raised, never ignored (the v1 insert used a nil-uuid creator that failed the FK silently).
  const { data: token, error } = await sys.db.rpc("create_reschedule_token", { p_visit_id: appointmentId });
  if (error || typeof token !== "string" || token.length === 0) {
    throw new Error("Could not create a reschedule link for this appointment");
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${baseUrl}/reschedule/${token}`;
}
