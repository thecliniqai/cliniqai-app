import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { enqueueMessage } from "@/lib/messaging/dispatcher";
import { recordAudit } from "@/lib/audit/audit";
import { randomBytes } from "crypto";

export async function getAppointmentsDbClient(clientOverride?: unknown) {
  if (clientOverride) {
    return clientOverride as any;
  }
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    return createAdminClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
  }
  return await createClient();
}

export interface CreateAppointmentInput {
  tenantId: string;
  patientId: string;
  doctorId: string;
  scheduledAt: string;
  estimatedDurationMinutes?: number;
  reasonForVisit?: string | null;
  createdBy: string;
}

export interface RescheduleAppointmentInput {
  appointmentId: string;
  newScheduledAt: string;
  doctorId?: string;
  reason?: string;
  updatedBy: string;
}

export interface CancelAppointmentInput {
  appointmentId: string;
  reason?: string;
  cancelledBy: string;
  isClinicInitiated?: boolean;
}

/**
 * Creates an appointment and queues Event #1 (appointment_booked) outbox notification.
 */
export async function createAppointment(
  input: CreateAppointmentInput,
  clientOverride?: unknown
) {
  const supabase = await getAppointmentsDbClient(clientOverride);

  // 1. Insert into public.visits
  const { data: visit, error: visitError } = await supabase
    .from("visits")
    .insert({
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      origin_type: "scheduled",
      scheduled_at: input.scheduledAt,
      estimated_duration_minutes: input.estimatedDurationMinutes || 15,
      reason_for_visit: input.reasonForVisit || null,
      status: "booked",
      created_by: input.createdBy,
    })
    .select()
    .single();

  if (visitError || !visit) {
    throw new Error(`Failed to create appointment: ${visitError?.message || "Unknown error"}`);
  }

  // 2. Fetch patient and doctor information for notification template
  const { data: patient } = await supabase
    .from("patients")
    .select("full_name, phone, preferred_language, whatsapp_opt_out")
    .eq("id", input.patientId)
    .single();

  const { data: doctor } = await supabase
    .from("memberships")
    .select("user_id, role")
    .eq("user_id", input.doctorId)
    .eq("tenant_id", input.tenantId)
    .maybeSingle();

  // 3. Queue Event #1 (appointment_booked) outbox notification
  if (patient?.phone) {
    const formattedDateTime = new Date(input.scheduledAt).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    });

    await enqueueMessage(
      {
        tenantId: input.tenantId,
        patientId: input.patientId,
        appointmentId: visit.id,
        channel: "whatsapp",
        messageType: "appointment_booked",
        templateId: "appointment_booked",
        templateParams: {
          patient_name: patient.full_name || "Patient",
          doctor_name: "Doctor",
          date_time: formattedDateTime,
        },
        recipientPhone: patient.phone,
        metadata: {
          buttons: [
            { id: "btn_confirm", text: "Confirm" },
            { id: "btn_cancel", text: "Cancel" },
            { id: "btn_reschedule", text: "Reschedule" },
          ],
        },
      },
      supabase
    );
  }

  return { success: true, appointment: visit };
}

/**
 * Reschedules an appointment and queues Event #2 (appointment_rescheduled) notification.
 */
export async function rescheduleAppointment(
  input: RescheduleAppointmentInput,
  clientOverride?: unknown
) {
  const supabase = await getAppointmentsDbClient(clientOverride);

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

    await enqueueMessage(
      {
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
      },
      supabase
    );
  }

  return { success: true, appointment: updated };
}

/**
 * Cancels an appointment, releases slot, notifies waitlist if applicable, and optionally queues Event #3.
 */
export async function cancelAppointment(
  input: CancelAppointmentInput,
  clientOverride?: unknown
) {
  const supabase = await getAppointmentsDbClient(clientOverride);

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
        cancelled_by: input.cancelledBy,
        cancelled_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.appointmentId)
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to cancel appointment: ${updateError?.message || "Unknown error"}`);
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
    await enqueueMessage(
      {
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
      },
      supabase
    );
  }

  return { success: true, appointment: updated };
}

/**
 * Finds active upcoming appointment matching patient phone number.
 */
export async function findActiveAppointmentByPhone(
  phone: string,
  clientOverride?: unknown
) {
  const supabase = await getAppointmentsDbClient(clientOverride);
  const normalizedPhone = phone.replace(/[^0-9]/g, "");

  // Match patients with phone ending with the last 10 digits
  const last10 = normalizedPhone.slice(-10);

  const { data: patients } = await supabase
    .from("patients")
    .select("id, full_name, phone, tenant_id")
    .ilike("phone", `%${last10}%`);

  if (!patients || patients.length === 0) {
    return null;
  }

  const patientIds = (patients as Array<{ id: string }>).map((p) => p.id);

  // Look for scheduled visit that is booked/waiting
  const { data: visits } = await supabase
    .from("visits")
    .select("*")
    .in("patient_id", patientIds)
    .eq("origin_type", "scheduled")
    .in("status", ["booked"])
    .order("scheduled_at", { ascending: true })
    .limit(1);

  if (!visits || visits.length === 0) {
    return null;
  }

  const visit = visits[0];
  const patient = (patients as Array<{ id: string; full_name?: string; phone?: string; tenant_id?: string }>).find((p) => p.id === visit.patient_id);

  return {
    ...visit,
    patient,
  };
}

/**
 * Generates a 24-hour tokenized self-service appointment reschedule link.
 */
export async function generateRescheduleToken(
  appointmentId: string,
  tenantId: string,
  clientOverride?: unknown
): Promise<string> {
  const supabase = await getAppointmentsDbClient(clientOverride);
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await supabase.from("document_share_tokens").insert({
    tenant_id: tenantId,
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
