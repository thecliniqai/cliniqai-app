import "server-only";

import type { ServiceContext } from "@/lib/auth/context";
import { NotificationCategory, NotificationRecipientRole } from "@/lib/db/types";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

/**
 * Where a notification is written: the acting tenant and its client. A request path passes its `ServiceContext`;
 * the tenant is never read from the trigger input (ADR-0005 D1) and there is no service-role fallback (D2).
 */
export type NotificationTarget = Pick<ServiceContext, "tenantId" | "db">;

export interface DoctorPatientArrivedInput {
  doctorId: string;
  patientName: string;
  tokenNumber?: number;
  visitId: string;
}

export interface DoctorVitalsRecordedInput {
  doctorId: string;
  patientName: string;
  vitalsSummary: string;
  visitId: string;
}

export interface DoctorLabReportReadyInput {
  doctorId: string;
  patientName: string;
  documentTitle: string;
  documentId: string;
}

export interface DoctorScheduleConflictInput {
  doctorId: string;
  appointmentTime: string;
  conflictingPatientName: string;
  visitId?: string;
}

export interface WaitlistSlotFreedInput {
  doctorName: string;
  slotTime: string;
  freedCount: number;
}

export interface FrontDeskWhatsAppReplyInput {
  patientName: string;
  patientPhone: string;
  messageText: string;
}

export interface FrontDeskNoShowInput {
  patientName: string;
  appointmentTime: string;
  visitId: string;
}

export interface StaffInviteAcceptedInput {
  staffName: string;
  role: string;
}

export interface QuotaWarningInput {
  sentCount: number;
  quotaLimit: number;
}

export interface EndOfDayDigestInput {
  totalVisits: number;
  totalRevenue: number;
}

export interface OutboxFailureInput {
  messageType: string;
  recipient: string;
  error: string;
}

async function insertNotification(
  target: NotificationTarget,
  payload: {
    recipientUserId?: string | null;
    recipientRole?: NotificationRecipientRole | null;
    category: NotificationCategory;
    eventType: string;
    title: string;
    message: string;
    linkUrl?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const supabase = target.db;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from("in_app_notifications") as any)
    .insert({
      tenant_id: target.tenantId,
      recipient_user_id: payload.recipientUserId || null,
      recipient_role: payload.recipientRole || null,
      category: payload.category,
      event_type: payload.eventType,
      title: payload.title,
      message: payload.message,
      link_url: payload.linkUrl || null,
      metadata: payload.metadata || {},
    })
    .select()
    .single();

  if (error) {
    log.error({ event: "notifications.insert.failed", code: errorTag(error), requestId: await getRequestId() });
    throw error;
  }

  return data;
}

// ----------------------------------------------------------------------
// Doctor Internal Clinical Cues (Events #13 - #16)
// ----------------------------------------------------------------------

/** Event #13: Patient Checked In and Waiting */
export async function notifyDoctorPatientArrived(target: NotificationTarget, input: DoctorPatientArrivedInput) {
  const tokenStr = input.tokenNumber ? ` (Token #${input.tokenNumber})` : "";
  return insertNotification(
    target,
    {
      recipientUserId: input.doctorId,
      recipientRole: "doctor",
      category: "clinical",
      eventType: "patient_arrived",
      title: "Patient Arrived in Reception",
      message: `${input.patientName}${tokenStr} has checked in and is waiting for consultation.`,
      linkUrl: `/consultation/${input.visitId}`,
      metadata: { visit_id: input.visitId, token_number: input.tokenNumber },
    }
  );
}

/** Event #14: Patient Vitals Recorded by Nurse */
export async function notifyDoctorVitalsRecorded(target: NotificationTarget, input: DoctorVitalsRecordedInput) {
  return insertNotification(
    target,
    {
      recipientUserId: input.doctorId,
      recipientRole: "doctor",
      category: "clinical",
      eventType: "vitals_recorded",
      title: "Vitals Recorded",
      message: `Vitals logged for ${input.patientName}: ${input.vitalsSummary}`,
      linkUrl: `/consultation/${input.visitId}`,
      metadata: { visit_id: input.visitId, summary: input.vitalsSummary },
    }
  );
}

/** Event #15: Diagnostic Lab Report Uploaded */
export async function notifyDoctorLabReportReady(target: NotificationTarget, input: DoctorLabReportReadyInput) {
  return insertNotification(
    target,
    {
      recipientUserId: input.doctorId,
      recipientRole: "doctor",
      category: "clinical",
      eventType: "lab_report_ready",
      title: "Lab Report Uploaded",
      message: `Diagnostic report "${input.documentTitle}" is ready for ${input.patientName}.`,
      linkUrl: `/patients`,
      metadata: { document_id: input.documentId, document_title: input.documentTitle },
    }
  );
}

/** Event #16: Schedule Conflict Detected */
export async function notifyDoctorScheduleConflict(target: NotificationTarget, input: DoctorScheduleConflictInput) {
  return insertNotification(
    target,
    {
      recipientUserId: input.doctorId,
      recipientRole: "doctor",
      category: "clinical",
      eventType: "schedule_conflict",
      title: "Schedule Conflict Alert",
      message: `Overlapping booking detected at ${input.appointmentTime} with ${input.conflictingPatientName}.`,
      linkUrl: `/calendar`,
      metadata: { visit_id: input.visitId, appointment_time: input.appointmentTime },
    }
  );
}

// ----------------------------------------------------------------------
// Front Desk / Queue Operational Cues (Events #17 - #19)
// ----------------------------------------------------------------------

/** Event #17: Waitlist Slot Freed via Cancellation */
export async function notifyWaitlistSlotFreed(target: NotificationTarget, input: WaitlistSlotFreedInput) {
  return insertNotification(
    target,
    {
      recipientRole: "receptionist",
      category: "queue",
      eventType: "waitlist_slot_freed",
      title: "Waitlist Slot Freed",
      message: `Slot with Dr. ${input.doctorName} at ${input.slotTime} is now free. ${input.freedCount} waitlisted patient(s) eligible.`,
      linkUrl: `/queue?tab=waitlist`,
      metadata: { slot_time: input.slotTime, freed_count: input.freedCount },
    }
  );
}

/** Event #18: Unhandled Inbound WhatsApp Reply Received */
export async function notifyFrontDeskWhatsAppReply(target: NotificationTarget, input: FrontDeskWhatsAppReplyInput) {
  return insertNotification(
    target,
    {
      recipientRole: "receptionist",
      category: "queue",
      eventType: "whatsapp_reply",
      title: "Inbound Patient Reply",
      message: `${input.patientName} (${input.patientPhone}): "${input.messageText}"`,
      linkUrl: `/queue`,
      metadata: { phone: input.patientPhone, text: input.messageText },
    }
  );
}

/** Event #19: Patient Appointment No-Show Alert */
export async function notifyFrontDeskNoShow(target: NotificationTarget, input: FrontDeskNoShowInput) {
  return insertNotification(
    target,
    {
      recipientRole: "receptionist",
      category: "queue",
      eventType: "appointment_no_show",
      title: "Patient No-Show Notice",
      message: `${input.patientName} did not arrive for scheduled slot at ${input.appointmentTime}.`,
      linkUrl: `/queue`,
      metadata: { visit_id: input.visitId, appointment_time: input.appointmentTime },
    }
  );
}

// ----------------------------------------------------------------------
// Admin / Owner Administrative & Financial Cues (Events #20 - #23)
// ----------------------------------------------------------------------

/** Event #20: Staff Invitation Accepted */
export async function notifyStaffInviteAccepted(target: NotificationTarget, input: StaffInviteAcceptedInput) {
  return insertNotification(
    target,
    {
      recipientRole: "admin",
      category: "system",
      eventType: "staff_invite_accepted",
      title: "Staff Member Joined",
      message: `${input.staffName} has accepted clinic invitation as ${input.role}.`,
      linkUrl: `/settings/staff`,
      metadata: { staff_name: input.staffName, role: input.role },
    }
  );
}

/** Event #21: Monthly Messaging Quota 80% Warning */
export async function notifyQuotaWarning(target: NotificationTarget, input: QuotaWarningInput) {
  return insertNotification(
    target,
    {
      recipientRole: "owner",
      category: "system",
      eventType: "messaging_quota_warning",
      title: "Messaging Quota Warning (80%+)",
      message: `Your clinic has sent ${input.sentCount} of ${input.quotaLimit} monthly messages. Non-critical messages may be deferred.`,
      linkUrl: `/settings`,
      metadata: { sent_count: input.sentCount, quota_limit: input.quotaLimit },
    }
  );
}

/** Event #22: End-of-Day Clinic Revenue Digest */
export async function notifyEndOfDayDigest(target: NotificationTarget, input: EndOfDayDigestInput) {
  return insertNotification(
    target,
    {
      recipientRole: "owner",
      category: "billing",
      eventType: "end_of_day_digest",
      title: "End-of-Day Operational Summary",
      message: `Today's close: ${input.totalVisits} visits completed, ₹${input.totalRevenue} total revenue collected.`,
      linkUrl: `/reports`,
      metadata: { visits: input.totalVisits, revenue: input.totalRevenue },
    }
  );
}

/** Event #23: Outbox Message Failure (Terminal Retries Exhausted) */
export async function notifyOutboxFailure(target: NotificationTarget, input: OutboxFailureInput) {
  return insertNotification(
    target,
    {
      recipientRole: "admin",
      category: "system",
      eventType: "outbox_delivery_failed",
      title: "Outbox Delivery Failure",
      message: `Failed to deliver ${input.messageType} to ${input.recipient}: ${input.error}`,
      linkUrl: `/settings`,
      metadata: { message_type: input.messageType, recipient: input.recipient, error: input.error },
    }
  );
}
