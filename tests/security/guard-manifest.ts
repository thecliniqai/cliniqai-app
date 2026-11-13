/**
 * P0-13 guard manifest (V2-02 plan 02-02, T-05; ADR-0005 Verification 3). Security-sensitive: CODEOWNERS-listed.
 *
 * Every `"use server"` export and every exported HTTP method of every route handler has exactly one entry here, and
 * tests/security/guard-actions.spec.ts / guard-routes.spec.ts fail when the inventory
 * (scripts/inventory-server-actions.ts) and this file disagree in either direction: a new action or route without an
 * entry fails with its name, and an entry for something that no longer exists fails as stale.
 *
 * Actions (`"file#export"`):
 *   - a `Permission`: the permission the action's guard checks. The inventory's static guard must name the same one,
 *     every role lacking it is denied before any data access, and the least-privileged role holding it cannot reach
 *     tenant B's rows with B's ids.
 *   - `{ member: reason }`: membership-only (`resolveServiceContext()` with no permission, F4). A signed-in user with
 *     no membership is denied; the cross-tenant leg runs as the least-privileged role (receptionist).
 *   - `{ authenticated: reason }`: deliberately callable by a signed-in user with no membership (onboarding,
 *     invitation acceptance). Only the unauthenticated and cross-tenant legs apply.
 *   - `{ self: reason }` (03-12a): acts only on the signed-in caller's own auth account (change password, reset
 *     completion), with or without a clinic membership. No tenant data and no static membership guard: the action
 *     authenticates from the cookie session itself. Legs: unauthenticated; cross-tenant (as the outsider); and the
 *     `self` leg: the input names no user, tenant or row (password fields only) and a signed-in call with forged ids
 *     touches nothing but `auth` and returns nothing of tenant B.
 *
 * Routes (`"file#METHOD"`), by category (see `RouteGuard`). Adding an entry is a security decision: say why in the
 * PR and get the adversarial second review (CLAUDE.md DoD 6).
 */
import type { Permission } from "@/lib/permissions";

export type ActionGuard = Permission | { member: string } | { authenticated: string } | { self: string };

/** Which of tenant B's seeded rows a session route's `[id]` gets in the cross-tenant leg. */
export type BResource = "invoice" | "patient" | "visit";

export type RouteGuard =
  /** Cookie session + permission: no session 401, lacking role 403, no membership refused, B's id 404. */
  | { kind: "session"; permission: Permission; resource: BResource }
  /**
   * Public token link (P0-04, ADR-0005 D3), no session by design: a random well-formed token and a token of the
   * wrong type answer 404, a malformed one 400; the body carries no ids.
   */
  | { kind: "public-token"; token: "path" | "query"; wrongType: "appointment" | "patient_document" }
  /** Inbound provider webhook (P0-03): missing/wrong `x-webhook-secret` 401, unknown provider or method 404. */
  | { kind: "webhook-secret"; acceptsPost: boolean }
  /** Cron trigger: CRON_SECRET unset 401, wrong or missing bearer 401 (RL-23: the compare itself is V2-04's). */
  | { kind: "cron-secret" }
  /**
   * V2-04 04-02 (RL-23, R-18): the job runner. `POST`: JOBS_RUNNER_SECRET unset 401, no header 401, wrong bearer 401,
   * different-length bearer 401, scheme-less secret 401, a signed-in member's session 401, all before any data access;
   * the control with the right bearer 200 with counts only. Every other method (`post: false`) 405 with `Allow: POST`,
   * with or without the bearer.
   */
  | { kind: "runner-secret"; post: boolean }
  /**
   * Standard Webhooks signed call (03-11b: the Supabase Auth Send Email hook): secret unset, no signature headers, a
   * wrong signature, another secret's signature and a stale timestamp all answer 401 and send nothing.
   */
  | { kind: "webhook-signature" }
  /**
   * Session-ending form POST (03-12b, T-03-13): a cross-origin, cross-site, `Origin: null` or signal-less call 403 and
   * an unknown `scope` 400, all without calling `auth.signOut` (the caller's session still works); signed out it is
   * 303 → `/login` with `Clear-Site-Data: "cache"`. No data access in any leg. GET is not exported (Next answers 405).
   */
  | { kind: "signout" }
  /** `/api/v1` (PO-16, AR2-H2): switch off → 404 at the handler; switch on and no key → 401 (or the public docs). */
  | { kind: "api-v1"; key: boolean }
  /** Allow-listed probe: no session; the JSON body's keys are a subset of `keys` (no tenant data). */
  | {
      kind: "public-health";
      keys: readonly string[];
      /** Request-client calls the probe may make (03-01/03-13c: `/api/ready` runs the booleans-only readiness RPC as anon). */
      access?: readonly string[];
    };

export const ACTION_GUARDS: Record<string, ActionGuard> = {
  "app/(dashboard)/settings/clinic/actions.ts#updateClinicProfileAction": "clinic:manage",
  "features/ai/actions.ts#generateSoapAction": "consultations:edit",
  "features/ai/actions.ts#getFrequentPrescriptionsAction": "consultations:view",
  "features/ai/actions.ts#getPatientCatchUpSummaryAction": "consultations:view",
  "features/api-keys/actions.ts#createApiKey": "clinic:manage",
  "features/api-keys/actions.ts#listApiKeys": "clinic:manage",
  "features/api-keys/actions.ts#revokeApiKey": "clinic:manage",
  "features/auth/actions.ts#changePasswordAction":
    { self: "Changes the session user's own password (current + new); FT-05 and the A00-5 10-minute bound apply." },
  "features/auth/actions.ts#setNewPasswordAction":
    { self: "Forgot-password final step on the session user's own fresh recovery session (A00-5); FT-05 applies." },
  "features/billing/actions.ts#addInvoiceItem": "appointments:edit",
  "features/billing/actions.ts#completeAndBillConsultation": "consultations:edit",
  "features/billing/actions.ts#createVisitInvoice": "appointments:edit",
  "features/billing/actions.ts#deleteInvoiceItem": "appointments:edit",
  "features/billing/actions.ts#getInvoiceReceiptPdfSignedUrl": "appointments:view",
  "features/billing/actions.ts#getVisitBillingDetails": "appointments:view",
  "features/billing/actions.ts#recordPayment": "appointments:edit",
  "features/billing/actions.ts#sendConsolidatedConsultationWhatsApp": "consultations:view",
  "features/billing/actions.ts#shareReceiptViaWhatsApp": "billing:view",
  "features/billing/reports-actions.ts#getDailyCollectionReport": "billing:view",
  "features/billing/subscription.ts#getSubscriptionOverview": "billing:view",
  "features/clinics/actions.ts#createClinic":
    { authenticated: "Onboarding: a signed-in user without a clinic creates one; create_clinic_with_owner binds the owner membership to auth.uid()." },
  "features/clinics/profile.ts#getClinicProfile": "clinic:view",
  "features/clinics/profile.ts#getClinicProfileWithMembership": "clinic:view",
  "features/clinics/profile.ts#updateClinicProfile": "clinic:manage",
  "features/consultation/actions.ts#completeAndSignConsultation": "consultations:edit",
  "features/consultation/actions.ts#finalizeVisitAmendment": "consultations:edit",
  "features/consultation/actions.ts#getPatientConsultationHistory": "consultations:view",
  "features/consultation/actions.ts#recordFollowUp": "consultations:edit",
  "features/consultation/actions.ts#reopenVisitForAmendment": "consultations:edit",
  "features/consultation/actions.ts#saveConsultationDraft": "consultations:edit",
  "features/labs/actions.ts#deleteLabDocument": "patients:edit",
  "features/labs/actions.ts#generateDocumentShareToken": "patients:view",
  "features/labs/actions.ts#getDocumentSignedUrl": "patients:view",
  "features/labs/actions.ts#getPatientDocuments": "patients:view",
  "features/labs/actions.ts#shareLabReportViaWhatsApp": "patients:view",
  "features/labs/actions.ts#uploadLabDocument": "patients:edit",
  "features/notifications/actions.ts#getInAppNotifications":
    { member: "Every member reads their own in-app notifications (recipient-scoped)." },
  "features/notifications/actions.ts#getUnreadNotificationCount":
    { member: "Every member reads their own unread count." },
  "features/notifications/actions.ts#markAllNotificationsRead":
    { member: "Every member marks their own notifications read." },
  "features/notifications/actions.ts#markNotificationRead":
    { member: "Every member marks one of their own notifications read." },
  "features/patients/actions.ts#createPatient": "patients:edit",
  "features/patients/actions.ts#getPatient": "patients:view",
  "features/patients/actions.ts#getPatients": "patients:view",
  "features/patients/actions.ts#getPatientVisitHistory": "patients:view",
  "features/patients/actions.ts#searchPatients": "patients:view",
  "features/patients/actions.ts#updatePatient": "patients:edit",
  "features/patients/consent.ts#getCurrentConsent": "patients:view",
  "features/patients/consent.ts#grantConsent": "patients:edit",
  "features/patients/consent.ts#toggleGlobalConsent": "patients:edit",
  "features/patients/consent.ts#withdrawConsent": "patients:edit",
  "features/patients/dedup.ts#findPotentialDuplicates": "patients:view",
  "features/prescriptions/actions.ts#addPrescriptionItem": "consultations:edit",
  "features/prescriptions/actions.ts#getDoctorProtocolTemplates": "consultations:view",
  "features/prescriptions/actions.ts#getOrCreateDraftPrescription": "consultations:edit",
  "features/prescriptions/actions.ts#getPrescriptionPdfSignedUrl": "consultations:view",
  "features/prescriptions/actions.ts#getVisitPrescription": "consultations:view",
  "features/prescriptions/actions.ts#removePrescriptionItem": "consultations:edit",
  "features/prescriptions/actions.ts#saveDoctorProtocolTemplate": "consultations:edit",
  "features/prescriptions/actions.ts#searchMedicines": "consultations:view",
  "features/prescriptions/actions.ts#sharePrescriptionViaWhatsApp": "consultations:view",
  "features/queue/actions.ts#checkInVisit": "appointments:edit",
  "features/queue/actions.ts#getQueueForDate": "appointments:view",
  "features/queue/actions.ts#transitionQueueState": "appointments:edit",
  "features/referrals/actions.ts#acknowledgeReferral": "patients:edit",
  "features/referrals/actions.ts#closeReferralLoop": "patients:edit",
  "features/referrals/actions.ts#createReferral": "patients:edit",
  "features/referrals/actions.ts#getInboundReferrals": "patients:view",
  "features/referrals/actions.ts#getOutboundReferrals": "patients:view",
  "features/referrals/actions.ts#getPatientReferrals": "patients:view",
  "features/referrals/actions.ts#getReferralSignedUrl": "patients:view",
  "features/referrals/actions.ts#shareReferralLetterViaWhatsApp": "patients:view",
  "features/settings/actions.ts#deleteDoctorScheduleBlock": "appointments:edit",
  "features/settings/actions.ts#getDoctorScheduleBlocks":
    { member: "Schedule blocks are read by every role that books or runs the day (F4)." },
  "features/settings/actions.ts#getMyProfile":
    { member: "The caller's own profile and clinic header." },
  "features/settings/actions.ts#updateClinicSettings": "clinic:manage",
  "features/settings/actions.ts#updateDoctorAvailability":
    { member: "A member edits their own weekly availability (the service binds it to the session user)." },
  "features/settings/actions.ts#updateDoctorSlotDuration":
    { member: "A member edits their own slot duration (the service binds it to the session user)." },
  "features/settings/actions.ts#updateStaffMember": "clinic:manage",
  "features/settings/actions.ts#updateStatutorySettings": "clinic:manage",
  "features/settings/actions.ts#updateUserProfile":
    { member: "A member edits their own profile." },
  "features/staff/actions.ts#acceptInvite":
    { authenticated: "Invitation acceptance: the invited user has no membership yet; consume_invitation binds the membership to auth.uid() and the token's tenant." },
  "features/staff/actions.ts#getTenantDoctorDirectory":
    { member: "The clinic's doctor list, used by every role's pickers." },
  "features/staff/actions.ts#getTenantDoctorMap":
    { member: "Doctor id to name map, used by every role's views." },
  "features/staff/actions.ts#getTenantStaffDirectory":
    { member: "The clinic's staff list (no contact data beyond what staff:view shows)." },
  "features/staff/actions.ts#inviteStaff": "staff:invite",
  "features/staff/actions.ts#inviteStaffMemberAction": "staff:invite",
  "features/terminology/actions.ts#addConsultationDiagnosis": "consultations:edit",
  "features/terminology/actions.ts#getVisitDiagnoses": "consultations:view",
  "features/terminology/actions.ts#removeConsultationDiagnosis": "consultations:edit",
  "features/terminology/actions.ts#searchDiagnoses": "consultations:view",
  "features/terminology/actions.ts#updateDiagnosisNote": "consultations:edit",
  "features/visits/actions.ts#cancelVisit": "appointments:edit",
  "features/visits/actions.ts#confirmAppointment": "appointments:edit",
  "features/visits/actions.ts#createVisit": "appointments:edit",
  "features/visits/actions.ts#getActiveClinicDoctors": "appointments:view",
  "features/visits/actions.ts#getClinicVisitsRegister": "appointments:view",
  "features/visits/actions.ts#getVisitsForDate": "appointments:view",
  "features/visits/actions.ts#recordVisitVitals": "vitals:edit",
  "features/visits/actions.ts#updateVisitStatus": "appointments:edit",
  "features/visits/scheduling.ts#bookAppointment": "appointments:edit",
  "features/visits/scheduling.ts#checkSlotAvailability": "appointments:view",
  "features/visits/scheduling.ts#createScheduleBlock": "appointments:edit",
  "features/visits/scheduling.ts#deleteScheduleBlock": "appointments:edit",
  "features/visits/scheduling.ts#getScheduleBlocksForDate": "appointments:view",
  "features/waitlist/actions.ts#addToWaitlist": "appointments:edit",
  "features/waitlist/actions.ts#getWaitlistForDate": "appointments:view",
  "features/waitlist/actions.ts#promoteWaitlistEntry": "appointments:edit",
  "features/webhooks/actions.ts#createWebhookSubscription": "clinic:manage",
  "features/webhooks/actions.ts#deleteWebhookSubscription": "clinic:manage",
  "features/webhooks/actions.ts#listDeliveryLogs": "clinic:manage",
  "features/webhooks/actions.ts#listWebhookSubscriptions": "clinic:manage",
  "features/webhooks/actions.ts#testPingWebhook": "clinic:manage",
};

/**
 * Leg 3 positive controls that cannot succeed in the test lane (V2-02 02-06, IR-F2/AR-M2a). Every other action whose
 * valid inputs carry a reference must succeed with them (tests/security/guard/valid-inputs.ts), so a refused forged
 * variant is attributable to the forged reference. An entry here keeps the per-reference variants (nothing of B may
 * come back, B unchanged, no A row references B) but drops the control; adding one is a security decision (say why).
 * The spec fails on an entry for an action that is not in ACTION_GUARDS or has no reference to forge.
 */
export const LEG3_CONTROL_EXEMPT: Record<string, string> = {
  "features/ai/actions.ts#getPatientCatchUpSummaryAction":
    "AI is off in the test lane (AI_ENABLED=false): the action fails closed before any data access (AI-01), so no input can succeed.",
  "features/clinics/actions.ts#createClinic":
    "Onboarding ({ authenticated }): a successful control would give the shared outsider user a clinic and change the later legs; create_clinic_with_owner is covered by tests/security/membership-guard.spec.ts.",
  "features/webhooks/actions.ts#testPingWebhook":
    "Delivers the ping over outbound HTTP at once (dispatchWebhookQueueItem); the test lane's network guard refuses every non-loopback host, so no input can succeed.",
};

const SESSION_RECEIPT: RouteGuard = { kind: "session", permission: "appointments:view", resource: "invoice" };
const CRON: RouteGuard = { kind: "cron-secret" };
const V1_KEY: RouteGuard = { kind: "api-v1", key: true };
const V1_PUBLIC_DOCS: RouteGuard = { kind: "api-v1", key: false };
const WEBHOOK_OTHER_METHOD: RouteGuard = { kind: "webhook-secret", acceptsPost: false };
const RUNNER_OTHER_METHOD: RouteGuard = { kind: "runner-secret", post: false };

export const ROUTE_GUARDS: Record<string, RouteGuard> = {
  // V2-03 03-11b (AUTH-03, T-03-05): Supabase Auth calls the Send Email hook server to server; no session exists, the
  // Standard Webhooks signature with SEND_EMAIL_HOOK_SECRET is the authentication.
  "app/api/auth/send-email/route.ts#POST": { kind: "webhook-signature" },
  // V2-03 03-12b (AUTH-04b, T-03-13): server-side sign-out; same-origin form POST, works with or without a session.
  "app/auth/signout/route.ts#POST": { kind: "signout" },
  "app/api/cron/dispatch-communications/route.ts#GET": CRON,
  "app/api/cron/dispatch-communications/route.ts#POST": CRON,
  "app/api/cron/webhooks/route.ts#GET": CRON,
  "app/api/cron/webhooks/route.ts#POST": CRON,
  // V2-03 03-09b (R-18, T-03-15): the diagnostic error route authenticates with the cron bearer before its flag.
  "app/api/diag/error/route.ts#POST": CRON,
  "app/api/health/route.ts#GET": { kind: "public-health", keys: ["status", "timestamp", "uptime", "region", "release"] },
  // V2-04 04-02 (RL-23, R-18, T-04-01): pg_cron → pg_net → the runner, authenticated by its own constant-time bearer.
  "app/api/jobs/run/route.ts#POST": { kind: "runner-secret", post: true },
  "app/api/jobs/run/route.ts#GET": RUNNER_OTHER_METHOD,
  "app/api/jobs/run/route.ts#PUT": RUNNER_OTHER_METHOD,
  "app/api/jobs/run/route.ts#PATCH": RUNNER_OTHER_METHOD,
  "app/api/jobs/run/route.ts#DELETE": RUNNER_OTHER_METHOD,
  "app/api/ready/route.ts#GET": {
    kind: "public-health",
    // 03-13c (M-PROBE): no migration version and no counts reach an anonymous caller.
    keys: ["status", "checks", "outbox", "providers", "correlationId", "timestamp"],
    access: ["rpc:readiness_probe"],
  },
  "app/api/invoices/[id]/receipt-pdf/route.ts#GET": SESSION_RECEIPT,
  "app/api/patients/[id]/export/route.ts#GET": { kind: "session", permission: "exports:create", resource: "patient" },
  "app/api/visits/[id]/prescription-pdf/route.ts#GET": {
    kind: "session",
    permission: "consultations:view",
    resource: "visit",
  },
  "app/api/r/[token]/route.ts#GET": { kind: "public-token", token: "path", wrongType: "appointment" },
  "app/api/reports/view/route.ts#GET": { kind: "public-token", token: "query", wrongType: "appointment" },
  "app/api/reschedule/[token]/route.ts#GET": { kind: "public-token", token: "path", wrongType: "patient_document" },
  "app/api/reschedule/[token]/route.ts#POST": { kind: "public-token", token: "path", wrongType: "patient_document" },
  "app/api/webhooks/messaging/[provider]/route.ts#POST": { kind: "webhook-secret", acceptsPost: true },
  "app/api/webhooks/messaging/[provider]/route.ts#GET": WEBHOOK_OTHER_METHOD,
  "app/api/webhooks/messaging/[provider]/route.ts#PUT": WEBHOOK_OTHER_METHOD,
  "app/api/webhooks/messaging/[provider]/route.ts#PATCH": WEBHOOK_OTHER_METHOD,
  "app/api/webhooks/messaging/[provider]/route.ts#DELETE": WEBHOOK_OTHER_METHOD,
  "app/api/webhooks/messaging/[provider]/route.ts#OPTIONS": WEBHOOK_OTHER_METHOD,
  "app/api/v1/appointments/[id]/route.ts#GET": V1_KEY,
  "app/api/v1/appointments/[id]/route.ts#PATCH": V1_KEY,
  "app/api/v1/appointments/[id]/route.ts#DELETE": V1_KEY,
  "app/api/v1/appointments/route.ts#GET": V1_KEY,
  "app/api/v1/appointments/route.ts#POST": V1_KEY,
  "app/api/v1/docs/route.ts#GET": V1_PUBLIC_DOCS,
  "app/api/v1/openapi.json/route.ts#GET": V1_PUBLIC_DOCS,
  "app/api/v1/lab-orders/[id]/route.ts#GET": V1_KEY,
  "app/api/v1/lab-orders/route.ts#GET": V1_KEY,
  "app/api/v1/lab-orders/route.ts#POST": V1_KEY,
  "app/api/v1/patients/[id]/export/route.ts#GET": V1_KEY,
  "app/api/v1/patients/[id]/route.ts#GET": V1_KEY,
  "app/api/v1/patients/[id]/route.ts#PUT": V1_KEY,
  "app/api/v1/patients/[id]/route.ts#DELETE": V1_KEY,
  "app/api/v1/patients/route.ts#GET": V1_KEY,
  "app/api/v1/patients/route.ts#POST": V1_KEY,
  "app/api/v1/prescriptions/[id]/route.ts#GET": V1_KEY,
  "app/api/v1/prescriptions/route.ts#GET": V1_KEY,
  "app/api/v1/prescriptions/route.ts#POST": V1_KEY,
  "app/api/v1/referrals/[id]/route.ts#GET": V1_KEY,
  "app/api/v1/referrals/[id]/route.ts#PATCH": V1_KEY,
  "app/api/v1/referrals/route.ts#GET": V1_KEY,
  "app/api/v1/referrals/route.ts#POST": V1_KEY,
  "app/api/v1/visits/[id]/route.ts#GET": V1_KEY,
  "app/api/v1/visits/[id]/route.ts#PATCH": V1_KEY,
  "app/api/v1/visits/route.ts#GET": V1_KEY,
  "app/api/v1/visits/route.ts#POST": V1_KEY,
};
