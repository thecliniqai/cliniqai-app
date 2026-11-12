import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueMessage } from "@/lib/messaging/dispatcher";
import { randomBytes } from "crypto";
import { enqueueWebhookEvent } from "@/lib/webhooks/outbox";

/**
 * Appointment use-cases that run without a signed-in user (ADR-0005 D2): the inbound messaging webhook
 * (`app/api/webhooks/**`, allow-listed) and, until 01-04 replaces it with token-scoped RPCs, the public reschedule
 * link. This module is `server-only`, never `"use server"`, and builds no client of its own: the caller passes the
 * database it was allowed to open and a fixed reason label. The acting principal is the system, recorded as
 * `system:<reason>`; no caller-chosen actor or acting tenant is accepted (the tenant always comes from the
 * appointment row).
 */
export type AppointmentSystemReason = "messaging_webhook" | "patient_self_service_reschedule";

export interface AppointmentSystemContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>;
  reason: AppointmentSystemReason;
}

export interface RescheduleAppointmentInput {
  appointmentId: string;
  newScheduledAt: string;
  doctorId?: string;
  reason?: string;
}

export interface CancelAppointmentInput {
  appointmentId: string;
  reason?: string;
  isClinicInitiated?: boolean;
}

/**
 * Reschedules an appointment and queues Event #2 (appointment_rescheduled) notification.
 */
export async function rescheduleAppointment(sys: AppointmentSystemContext, input: RescheduleAppointmentInput) {
  const supabase = sys.db;

  // Fetch current visit
  const { data: visit, error: fetchError } = await supabase
    .from("visits")
    .select("*, patient:patients(full_name, phone)")
    .eq("id", input.appointmentId)
    .single();

  if (fetchError || !visit) {
    throw new Error("Appointment not found");
  }

  const updatePayload: Record<string, unknown> = {
    scheduled_at: input.newScheduledAt,
    updated_at: new Date().toISOString(),
  };

  if (input.doctorId) {
    updatePayload.doctor_id = input.doctorId;
  }

  const { data: updated, error: updateError } = await supabase
    .from("visits")
    .update(updatePayload)
    .eq("id", input.appointmentId)
    .eq("tenant_id", visit.tenant_id)
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to reschedule appointment: ${updateError?.message || "Unknown error"}`);
  }

  // Queue Event #2 (appointment_rescheduled)
  if (visit.patient?.phone) {
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
        patient_name: visit.patient?.full_name || "Patient",
        doctor_name: "Doctor",
        new_date_time: formattedDateTime,
      },
      recipientPhone: visit.patient?.phone,
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
    console.warn("[rescheduleAppointment] Failed to enqueue webhook event:", webhookErr);
  }

  return { success: true, appointment: updated };
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

  const { data: updated, error: updateError } = await supabase
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
    .eq("tenant_id", visit.tenant_id)
    .select()
    .single();

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
  const supabase = sys.db;
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: visit } = await supabase.from("visits").select("tenant_id").eq("id", appointmentId).maybeSingle();
  if (!visit?.tenant_id) {
    throw new Error("Appointment not found");
  }

  await supabase.from("document_share_tokens").insert({
    tenant_id: visit.tenant_id,
    document_id: null,
    resource_type: "referral", // using referral/appointment polymorphic slot
    resource_id: appointmentId,
    token,
    expires_at: expiresAt,
    created_by: "00000000-0000-0000-0000-000000000000",
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${baseUrl}/reschedule/${token}`;
}
