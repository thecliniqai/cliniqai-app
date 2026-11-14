/**
 * Otherwise-valid tenant-A inputs for the P0-13 leg 3 per-reference forging and positive controls (V2-02 02-06,
 * IR-F2 / AR-M2a). Synthetic data only.
 *
 * Every action gets `argsFor(c, a)` (tenant A's ids in every id-shaped parameter and field, plus the acting fields)
 * unless it has an entry here. An entry is needed where the generic inputs would fail validation (enums, required
 * fields, a file for multipart actions) or would not exercise the write. Entries that take an object also carry
 * `acting(a)`, so the acting tenant and actor are forged one at a time like any other reference.
 *
 * Each id of tenant A that appears in the returned arguments is one forged variant: the spec replaces exactly that
 * id with tenant B's id for the same row and leaves the rest valid. The spec runs the unmodified inputs as a positive
 * control first; an action whose control cannot succeed in the test lane is listed in
 * `LEG3_CONTROL_EXEMPT` (tests/security/guard-manifest.ts) with the reason.
 */
import { randomUUID } from "node:crypto";
import type { UserRole } from "@/lib/db/types";
import { consultationDraftInput } from "../../helpers/fixtures";
import type { TenantRowIds } from "./world";

export interface InputHelpers {
  caller: { userId: string; role: UserRole };
}

export interface ValidInput {
  args: (a: TenantRowIds, h: InputHelpers) => unknown[];
  /** The action returns nothing on success (a form action): the control passes when it does not throw. */
  voidResult?: boolean;
}

const day = 86_400_000;
/**
 * A future instant in its own one-hour slot. The legs book the same doctor in the same tenant several times per run,
 * and the scheduler reports a conflict for any two visits within `estimated_duration_minutes` (15) of each other, so
 * a random minute alone collided in about 5% of pairs (a baseline run on 2026-11-13 failed leg 3b this way). Each call
 * takes the next hour after a random base, so no two instants from this module are closer than 60 minutes.
 */
const SLOT_BASE_MINUTE = Math.floor(Math.random() * 600);
let slotCounter = 0;
const futureIso = (days: number) =>
  new Date(Date.now() + days * day + (SLOT_BASE_MINUTE + 60 * slotCounter++) * 60_000).toISOString();
/** 90+ days out, 10:00-17:00 IST (04:30-11:30 UTC), at a random day and minute. */
const inShiftIso = (minDays: number) => {
  const now = new Date();
  const dayOffset = minDays + Math.floor(Math.random() * 60);
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset, 4, 30 + Math.floor(Math.random() * 420))
  ).toISOString();
};
const dateAhead = (days: number) => new Date(Date.now() + days * day).toISOString().slice(0, 10);
const syntheticEmail = () => `guard-invite-${randomUUID().slice(0, 12)}@example.com`;
const syntheticPhone = () => `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const pdf = () => new File([Buffer.from("%PDF-1.4 synthetic guard upload")], "synthetic.pdf", { type: "application/pdf" });

/** The acting fields a caller could try to set; every one is forged in its own variant. */
const acting = (a: TenantRowIds) => ({ tenant_id: a.tenant, created_by: a.ownerUser });

const week = () => {
  const d = { enabled: true, shifts: [{ start: "09:00", end: "13:00" }] };
  return { monday: d, tuesday: d, wednesday: d, thursday: d, friday: d, saturday: d, sunday: { enabled: false, shifts: [] } };
};

const patientInput = () => ({
  full_name: `Synthetic Guard Patient ${randomUUID().slice(0, 6)}`,
  phone: syntheticPhone(),
  age: 30,
  date_of_birth: null,
  sex: "male" as const,
  abha_id: null,
  address: null,
  allergies: [],
  chronic_conditions: [],
  emergency_contact: null,
});

function formData(entries: Record<string, string | File>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

export const VALID_INPUTS: Record<string, ValidInput> = {
  "app/(dashboard)/settings/clinic/actions.ts#updateClinicProfileAction": {
    args: (a) => [
      formData({ name: "Synthetic Guard Clinic A", timezone: "Asia/Kolkata", specialties: "general_physician", tenant_id: a.tenant }),
    ],
    voidResult: true,
  },
  "features/ai/actions.ts#generateSoapAction": { args: () => [{ shorthand: "Synthetic shorthand" }] },
  "features/billing/actions.ts#addInvoiceItem": {
    args: (a) => [{ invoice_id: a.invoice, item_type: "procedure", description: "Synthetic procedure", unit_price: 100, quantity: 1, ...acting(a) }],
  },
  "features/billing/actions.ts#completeAndBillConsultation": {
    args: (a) => [{
      visit_id: a.visit,
      patient_id: a.patient,
      consultation_fee: 500,
      additional_items: [],
      discount: 0,
      // PO-3 (05-02b): the least-privileged holder of consultations:edit is a doctor, who routes the fee to reception;
      // a doctor's collection is refused (tests/billing/collect-permission.spec.ts).
      payment_collected: false,
      payment_method: "cash",
      reference_number: null,
      ...acting(a),
    }],
  },
  "features/billing/actions.ts#createVisitInvoice": {
    args: (a) => [{
      visit_id: a.visit,
      patient_id: a.patient,
      items: [{ item_type: "consultation", description: "Synthetic fee", unit_price: 100, quantity: 1 }],
      discount: 0,
      tax: 0,
      ...acting(a),
    }],
  },
  "features/billing/actions.ts#recordPayment": {
    args: (a) => [{ invoice_id: a.invoice, amount: 1, payment_method: "cash", reference_number: null, notes: null, ...acting(a) }],
  },
  "features/clinics/profile.ts#updateClinicProfile": {
    args: (a) => [{ name: "Synthetic Guard Clinic A", address: null, specialties: ["general_physician"], timezone: "Asia/Kolkata", working_hours: {}, ...acting(a) }],
  },
  "features/consultation/actions.ts#recordFollowUp": {
    args: (a) => [{ visitId: a.visit, patientId: a.patient, doctorId: a.ownerUser, followUpDate: dateAhead(7), notes: "Synthetic note", ...acting(a) }],
  },
  "features/consultation/actions.ts#reopenVisitForAmendment": {
    args: (a) => [a.signedVisit, "Synthetic amendment reason for the audit trail"],
  },
  "features/consultation/actions.ts#saveConsultationDraft": {
    args: (a) => [{ ...consultationDraftInput({ visit_id: a.visit }), ...acting(a) }],
  },
  "features/labs/actions.ts#uploadLabDocument": {
    args: (a) => [
      formData({
        file: pdf(),
        patient_id: a.patient,
        visit_id: a.visit,
        title: "Synthetic Guard Upload",
        document_type: "lab_report",
        report_date: dateAhead(0),
        is_abnormal: "false",
        tenant_id: a.tenant,
      }),
    ],
  },
  "features/notifications/actions.ts#markAllNotificationsRead": { args: () => ["system"] },
  "features/patients/actions.ts#createPatient": { args: (a) => [{ ...patientInput(), ...acting(a) }] },
  "features/patients/actions.ts#updatePatient": { args: (a) => [a.patient, { ...patientInput(), ...acting(a) }] },
  "features/patients/dedup.ts#findPotentialDuplicates": { args: () => [{ phone: syntheticPhone(), fullName: "Synthetic Guard" }] },
  "features/prescriptions/actions.ts#addPrescriptionItem": {
    args: (a) => [a.visit, { medicine_name: "Synthetic Tablet 250", dosage: "1-0-1", duration: "5 days", timing: "After food", sort_order: 1, ...acting(a) }],
  },
  "features/prescriptions/actions.ts#saveDoctorProtocolTemplate": {
    args: () => [{ template_name: "Synthetic protocol", specialty: "general_physician", items: [{ medicine_name: "Synthetic Tablet 250", dosage: "1-0-1", duration: "5 days", sort_order: 0 }] }],
  },
  "features/queue/actions.ts#checkInVisit": { args: (a) => [a.visit, "normal"] },
  "features/referrals/actions.ts#closeReferralLoop": {
    args: (a) => [{ referral_id: a.referral, closure_notes: "Synthetic closure notes", return_date: null, ...acting(a) }],
  },
  "features/referrals/actions.ts#createReferral": {
    args: (a) => [{
      patient_id: a.patient,
      visit_id: a.visit,
      referral_type: "out_of_network",
      referred_to_name: "Synthetic Specialist",
      reason_for_referral: "Synthetic reason",
      urgency: "routine",
      patient_consents_history_sharing: false,
      letterhead_mode: "blank_paper",
      ...acting(a),
    }],
  },
  "features/settings/actions.ts#updateClinicSettings": {
    args: (a) => [{
      name: "Synthetic Guard Clinic A",
      address: null,
      specialties: ["general_physician"],
      timezone: "Asia/Kolkata",
      owner_is_practicing_doctor: true,
      default_consultation_fee: 500,
      default_followup_fee: 300,
      accepted_payment_methods: ["cash"],
      default_specialty: "general_physician",
      ...acting(a),
    }],
  },
  "features/settings/actions.ts#updateDoctorAvailability": {
    args: (a) => [{ membership_id: a.membership, availability_schedule: week() }],
  },
  "features/settings/actions.ts#updateDoctorSlotDuration": {
    args: (a) => [{ membership_id: a.membership, default_slot_duration_minutes: 15 }],
  },
  "features/settings/actions.ts#updateStaffMember": {
    args: (a, h) => [{
      membership_id: a.membership,
      full_name: "Synthetic Guard Staff",
      role: h.caller.role,
      default_specialty: "general_physician",
      ...acting(a),
    }],
  },
  "features/settings/actions.ts#updateUserProfile": {
    args: (a) => [{ full_name: "Synthetic Guard Member", default_specialty: "general_physician", ...acting(a) }],
  },
  "features/staff/actions.ts#inviteStaff": {
    args: (a) => [formData({ email: syntheticEmail(), role: "doctor", tenant_id: a.tenant, created_by: a.ownerUser })],
  },
  "features/staff/actions.ts#inviteStaffMemberAction": {
    args: (a) => [formData({ email: syntheticEmail(), role: "doctor", tenant_id: a.tenant, created_by: a.ownerUser })],
  },
  "features/terminology/actions.ts#addConsultationDiagnosis": {
    args: (a) => [{
      visit_id: a.visit,
      patient_id: a.patient,
      diagnosis_name: "Synthetic diagnosis",
      is_custom: true,
      is_chronic: false,
      ...acting(a),
    }],
  },
  "features/visits/actions.ts#createVisit": {
    args: (a) => [{
      patient_id: a.patient,
      doctor_id: a.ownerUser,
      origin_type: "walk_in",
      estimated_duration_minutes: 15,
      is_overbooked: false,
      ...acting(a),
    }],
  },
  "features/visits/actions.ts#updateVisitStatus": { args: (a) => [a.visit, "confirmed"] },
  "features/visits/scheduling.ts#bookAppointment": {
    args: (a) => [{
      patient_id: a.patient,
      doctor_id: a.ownerUser,
      scheduled_at: futureIso(40),
      estimated_duration_minutes: 15,
      reason_for_visit: "Synthetic reason",
      is_overbooked: false,
      override_off_duty: true,
      override_block: true,
      ...acting(a),
    }],
  },
  "features/visits/scheduling.ts#createScheduleBlock": {
    args: (a) => {
      const start = futureIso(60);
      // The caller's own time: blocking another doctor needs clinic:manage (features/visits/scheduling-service.ts).
      return [{
        doctor_id: a.callerUser,
        start_time: start,
        end_time: new Date(new Date(start).getTime() + 3_600_000).toISOString(),
        reason: "Synthetic block",
        all_day: false,
        ...acting(a),
      }];
    },
  },
  "features/visits/scheduling.ts#getScheduleBlocksForDate": { args: (a) => [dateAhead(5), a.callerUser] },
  // A random far-future slot inside the A doctor's seeded shift (world.ts GUARD_DOCTOR_SHIFT, 08:00-20:00 IST every
  // day): a fixed instant would collide with visits the other controls book for the same doctor.
  "features/visits/scheduling.ts#checkSlotAvailability": { args: (a) => [a.ownerUser, inShiftIso(90), 15] },
  "features/settings/actions.ts#getDoctorScheduleBlocks": { args: (a) => [a.callerUser] },
  "features/waitlist/actions.ts#promoteWaitlistEntry": { args: (a) => [a.waitlist, futureIso(50)] },
  "features/waitlist/actions.ts#addToWaitlist": {
    args: (a) => [{ patient_id: a.patient, doctor_id: a.ownerUser, target_date: dateAhead(4), priority: 0, notes: "Synthetic note", ...acting(a) }],
  },
  "features/webhooks/actions.ts#createWebhookSubscription": {
    // No acting fields: the endpoint check resolves the host, which the test lane's network guard refuses, so this
    // action has no reference to forge and no control (its cross-tenant leg stays the all-B one).
    args: () => [{ endpointUrl: "https://example.invalid/guard-hook", eventTypes: ["visit.created"] }],
  },
};
