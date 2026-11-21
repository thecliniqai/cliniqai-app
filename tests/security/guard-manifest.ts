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
 *   - `{ publicToken: reason }` (V2-05 05-07b): callable WITHOUT a session by design; a single-use token in the input
 *     is the authorisation (invite acceptance by a new invitee). No static guard call. Legs: unauthenticated (a forged
 *     token is refused with no request-client data access; any fixed message), cross-tenant (as the outsider), and
 *     the `publicToken` leg (signed out, signed in, every forged token refused, nothing written).
 *
 * Routes (`"file#METHOD"`), by category (see `RouteGuard`). Adding an entry is a security decision: say why in the
 * PR and get the adversarial second review (CLAUDE.md DoD 6).
 */
import type { Permission } from "@/lib/permissions";

export type ActionGuard =
  | Permission
  | { member: string }
  | { authenticated: string }
  | { self: string }
  | { publicToken: string };

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
   * V2-04 04-02 (RL-23, R-18, R-49): the job runner. `POST`: JOBS_RUNNER_SECRET unset 401, no header 401, wrong bearer
   * 401, different-length bearer 401, the raw secret 401, another secret's token 401, a stale token 401, a scheme-less
   * token 401, a signed-in member's session 401, all before any data access; the control with a valid token 200 with
   * counts only. Every other method (`post: false`) 405 with `Allow: POST`,
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
  /**
   * Public PWA asset (V2-06 06-09a `/sw.js`; 06-09b): no session by design, PHI-free and the same for every caller. An
   * anonymous GET answers 200 with `contentType`, no request-client data access, no `Set-Cookie`, no ids and nothing of
   * tenant B; a signed-in member gets the byte-identical body (nothing personalised) with no data access either.
   */
  | { kind: "public-asset"; contentType: string }
  /**
   * V2-06 06-06 (PWA §3.7, §6.6; R-16, R-21): the PWA's session and access poll. No session 401, no membership 403,
   * both with no data access beyond the membership lookup; a member 200 whose JSON keys are a subset of `keys`;
   * `no-store` on every answer; a forged `?tenant=` (tenant B's id) changes nothing and nothing of B comes back.
   */
  | { kind: "session-status"; keys: readonly string[] }
  /**
   * V2-08 08-02 (T-08-02): the patient typeahead `GET /api/patients/search?q=`. No session 401, a role lacking `permission`
   * 403 and a signed-in user with no membership refused, all before any data access beyond the membership lookup; a member
   * with the permission searching tenant B's synthetic patient by name and by mobile number gets 200 with an empty list and
   * nothing of B; searching tenant A's own patient answers 200 with `no-store`, the patient listed with exactly `keys` and
   * neither the full mobile number nor any field outside the projection.
   */
  | { kind: "session-search"; permission: Permission; keys: readonly string[] }
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
  "features/auth/actions.ts#acceptInviteWithPasswordAction":
    { publicToken: "V2-05 05-07b (AUTH-06): a new invitee sets a password from the /join link; no session exists. The invitation token (64 hex, stored as SHA-256) is the authorisation, after server-side Turnstile, the password policy and FT-05; the account is created only for the invited address." },
  "features/auth/actions.ts#changePasswordAction":
    { self: "Changes the session user's own password (current + new); FT-05 and the A00-5 10-minute bound apply." },
  "features/auth/actions.ts#setNewPasswordAction":
    { self: "Forgot-password final step on the session user's own fresh recovery session (A00-5); FT-05 applies." },
  "features/billing/actions.ts#addInvoiceItem": "billing:collect",
  "features/billing/actions.ts#collectPayment": "billing:collect",
  "features/billing/actions.ts#completeAndBillConsultation": "consultations:edit",
  "features/billing/actions.ts#createInvoice": "billing:collect",
  "features/billing/actions.ts#deleteInvoiceItem": "billing:collect",
  "features/billing/actions.ts#getInvoiceReceiptPdfSignedUrl": "appointments:view",
  "features/billing/actions.ts#getVisitBillingDetails": "appointments:view",
  "features/billing/actions.ts#recordPayment": "billing:collect",
  "features/billing/actions.ts#sendConsolidatedConsultationWhatsApp": "prescriptions:view",
  "features/billing/actions.ts#shareReceiptViaWhatsApp": "billing:view",
  "features/billing/reports-actions.ts#getDailyCollectionReport": "billing:view",
  "features/billing/subscription.ts#getSubscriptionOverview": "clinic:manage",
  "features/clinics/actions.ts#createClinic":
    { authenticated: "Onboarding: a signed-in user without a clinic creates one; create_clinic_with_owner binds the owner membership to auth.uid()." },
  "features/clinics/actions.ts#switchClinic":
    { authenticated: "The clinic switcher (V2-08 08-05, R-17): a signed-in user picks one of their own clinics; the cookie is written only for an active membership read under RLS, so a forged or foreign id writes nothing." },
  "features/clinics/profile.ts#getClinicProfile": "clinic:view",
  "features/clinics/profile.ts#getClinicProfileWithMembership": "clinic:view",
  "features/clinics/profile.ts#updateClinicProfile": "clinic:manage",
  "features/consultation/actions.ts#completeAndSignConsultation": "consultations:edit",
  "features/consultation/actions.ts#finalizeVisitAmendment": "consultations:edit",
  "features/consultation/actions.ts#getConsultationDraft": "consultations:view",
  "features/consultation/actions.ts#getPatientConsultationHistory": "consultations:view",
  "features/consultation/actions.ts#reopenVisitForAmendment": "consultations:edit",
  "features/consultation/actions.ts#saveConsultationDraft": "consultations:edit",
  "features/labs/actions.ts#generateDocumentShareToken": "labs:view",
  "features/labs/actions.ts#getDocumentSignedUrl": "labs:view",
  "features/labs/actions.ts#getPatientDocuments": "labs:view",
  "features/labs/actions.ts#shareLabReportViaWhatsApp": "labs:view",
  "features/labs/actions.ts#uploadLabDocument": "labs:edit",
  "features/notifications/actions.ts#getInAppNotifications":
    { member: "Every member reads their own in-app notifications (recipient-scoped)." },
  "features/notifications/actions.ts#getUnreadNotificationCount":
    { member: "Every member reads their own unread count." },
  "features/notifications/actions.ts#markAllNotificationsRead":
    { member: "Every member marks their own notifications read." },
  "features/notifications/actions.ts#markNotificationRead":
    { member: "Every member marks one of their own notifications read." },
  "features/observability/actions.ts#reportClientRenderError":
    { member: "client render error report (06-04a, R-3): class name and route pattern only, no tenant data." },
  "features/patients/actions.ts#registerPatient": "patients:edit",
  "features/patients/actions.ts#getPatient": "patients:view",
  "features/patients/actions.ts#getPatients": "patients:view",
  "features/patients/actions.ts#getPatientVisitHistory": "patients:view",
  "features/patients/actions.ts#updatePatient": "patients:edit",
  "features/patients/consent.ts#getCurrentConsent": "patients:view",
  "features/patients/consent.ts#grantConsent": "patients:edit",
  "features/patients/consent.ts#toggleGlobalConsent": "patients:edit",
  "features/patients/consent.ts#withdrawConsent": "patients:edit",
  "features/patients/dedup.ts#findPotentialDuplicates": "patients:view",
  "features/prescriptions/actions.ts#addPrescriptionItem": "consultations:edit",
  "features/prescriptions/actions.ts#getDoctorProtocolTemplates": "consultations:view",
  "features/prescriptions/actions.ts#getOrCreateDraftPrescription": "consultations:edit",
  "features/prescriptions/actions.ts#getPrescriptionPdfSignedUrl": "prescriptions:view",
  "features/prescriptions/actions.ts#getVisitPrescription": "consultations:view",
  "features/prescriptions/actions.ts#removePrescriptionItem": "consultations:edit",
  "features/prescriptions/actions.ts#saveDoctorProtocolTemplate": "consultations:edit",
  "features/prescriptions/actions.ts#searchMedicines": "consultations:view",
  "features/prescriptions/actions.ts#sharePrescriptionViaWhatsApp": "prescriptions:view",
  "features/queue/actions.ts#checkInVisit": "appointments:edit",
  "features/queue/actions.ts#enqueueWalkIn": "appointments:edit",
  // V2-06 06-04b: the command palette's "Today queue" group; four fields per match.
  "features/queue/actions.ts#searchTodayQueueForPalette": "appointments:view",
  // V2-08 08-01b: the visit state machine's two desk commands replace the open status setter.
  "features/queue/actions.ts#startConsultation": "consultations:edit",
  "features/queue/actions.ts#completeVisit": "appointments:edit",
  "features/referrals/actions.ts#acknowledgeReferral": "consultations:edit",
  "features/referrals/actions.ts#closeReferralLoop": "consultations:edit",
  "features/referrals/actions.ts#createReferral": "consultations:edit",
  "features/referrals/actions.ts#getInboundReferrals": "patients:view",
  "features/referrals/actions.ts#getOutboundReferrals": "patients:view",
  "features/referrals/actions.ts#getPatientReferrals": "patients:view",
  "features/referrals/actions.ts#getReferralSignedUrl": "consultations:view",
  "features/referrals/actions.ts#shareReferralLetterViaWhatsApp": "consultations:view",
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
  // V2-05 05-05 (AUTH-05): remove_member re-derives the clinic from the target row and binds it to the active clinic.
  "features/staff/actions.ts#removeStaff": "staff:invite",
  // V2-05 05-07b (AUTH-06): resend_invitation / revoke_invitation re-derive the clinic from the invitation row and bind
  // it to the active clinic; owner/admin invitations need an owner.
  "features/staff/actions.ts#resendInvite": "staff:invite",
  "features/staff/actions.ts#revokeInvite": "staff:invite",
  "features/terminology/actions.ts#addConsultationDiagnosis": "consultations:edit",
  "features/terminology/actions.ts#getVisitDiagnoses": "consultations:view",
  "features/terminology/actions.ts#removeConsultationDiagnosis": "consultations:edit",
  "features/terminology/actions.ts#searchDiagnoses": "consultations:view",
  "features/terminology/actions.ts#updateDiagnosisNote": "consultations:edit",
  "features/visits/actions.ts#getActiveClinicDoctors": "appointments:view",
  "features/visits/actions.ts#getClinicVisitsRegister": "appointments:view",
  "features/visits/actions.ts#getVisitsForDate": "appointments:view",
  "features/visits/actions.ts#recordVisitVitals": "vitals:edit",
  "features/visits/scheduling.ts#registerAndBook": "appointments:edit",
  "features/visits/scheduling.ts#rescheduleVisit": "appointments:edit",
  "features/visits/scheduling.ts#cancelVisit": "appointments:edit",
  "features/visits/scheduling.ts#markNoShow": "appointments:edit",
  "features/visits/scheduling.ts#confirmAppointment": "appointments:edit",
  "features/visits/scheduling.ts#getAvailableSlots": "appointments:view",
  "features/visits/scheduling.ts#getSlotAssist": "appointments:view",
  "features/visits/scheduling.ts#getRescheduleTarget": "appointments:view",
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
  "features/auth/actions.ts#acceptInviteWithPasswordAction":
    "V2-05 05-07b: public, token-gated; a successful control needs a freshly minted invitation token, a Turnstile pass and a new account, and would create a membership in the shared world. The success paths are covered by tests/integration/auth/accept-invite.spec.ts; the forged variants still run.",
  "features/staff/actions.ts#resendInvite":
    "V2-05 05-07b: the guard world holds no invitation, and a resend would enqueue an email.invite job in the shared world; the success path (new version, old link dead, exactly one more email) is covered by supabase/tests/database/invitations_v2.test.sql and tests/integration/auth/invite-delivery.spec.ts. The forged-id variants still run (B's ids: not found).",
  "features/staff/actions.ts#revokeInvite":
    "V2-05 05-07b: the guard world holds no invitation; the success path is covered by supabase/tests/database/invitations_v2.test.sql and tests/integration/auth/invite-delivery.spec.ts. The forged-id variants still run (B's ids: not found).",
  "features/ai/actions.ts#getPatientCatchUpSummaryAction":
    "AI is off in the test lane (AI_ENABLED=false): the action fails closed before any data access (AI-01), so no input can succeed.",
  "features/clinics/actions.ts#createClinic":
    "Onboarding ({ authenticated }): a successful control would give the shared outsider user a clinic and change the later legs; create_clinic_with_owner is covered by tests/security/membership-guard.spec.ts.",
  "features/clinics/actions.ts#switchClinic":
    "V2-08 08-05 ({ authenticated }): the leg's caller is the shared outsider, who has no membership of tenant A and so correctly cannot switch to it; the success path, the cookie attributes and the refusals (forged, foreign, removed) are covered by tests/clinics/switch-clinic-db.spec.ts. The forged-id variants still run (B's id: refused, nothing written).",
  "features/staff/actions.ts#removeStaff":
    "V2-05 05-05: the world's tenant-A membership is the caller's own, which remove_member refuses (SELF_REMOVAL), and removing any other member of the shared world would change the later legs; the successful path is covered by supabase/tests/database/remove_member.test.sql and tests/integration/auth/remove-member.spec.ts. The forged-id variants still run (B's membership: not found).",
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
  // V2-03 03-09b (R-18, T-03-15): the diagnostic error route authenticates with the cron bearer before its flag.
  "app/api/diag/error/route.ts#POST": CRON,
  "app/api/health/route.ts#GET": { kind: "public-health", keys: ["status", "timestamp", "uptime", "region", "release"] },
  // V2-06 06-09a (M-OFFLINE): the stamped service worker script, public (`PUBLIC_PAGE_PREFIXES`) and PHI-free; the
  // browser fetches it with no session on the login page and on every update check.
  "app/sw.js/route.ts#GET": { kind: "public-asset", contentType: "application/javascript" },
  // V2-06 06-06 (R-16, R-21): the installed app's session/access/version poll; the tenant comes from the session only.
  "app/api/session-status/route.ts#GET": { kind: "session-status", keys: ["deploymentId", "accessLevel", "redirect"] },
  // V2-04 04-02 (RL-23, R-18, T-04-01): pg_cron → pg_net → the runner, authenticated by its own constant-time bearer.
  "app/api/jobs/run/route.ts#POST": { kind: "runner-secret", post: true },
  "app/api/jobs/run/route.ts#GET": RUNNER_OTHER_METHOD,
  "app/api/jobs/run/route.ts#PUT": RUNNER_OTHER_METHOD,
  "app/api/jobs/run/route.ts#PATCH": RUNNER_OTHER_METHOD,
  "app/api/jobs/run/route.ts#DELETE": RUNNER_OTHER_METHOD,
  "app/api/ready/route.ts#GET": {
    kind: "public-health",
    // 03-13c (M-PROBE): no migration version and no counts reach an anonymous caller. 04-04 (R-41): `jobs` holds four
    // booleans (backlog, dead24h, runnerStale, alertsCriticalOpen).
    keys: ["status", "checks", "outbox", "jobs", "providers", "correlationId", "timestamp"],
    access: ["rpc:readiness_probe"],
  },
  "app/api/invoices/[id]/receipt-pdf/route.ts#GET": SESSION_RECEIPT,
  "app/api/patients/[id]/export/route.ts#GET": { kind: "session", permission: "exports:create", resource: "patient" },
  "app/api/patients/search/route.ts#GET": {
    kind: "session-search",
    permission: "patients:view",
    keys: ["id", "name", "ageSex", "phoneLast4", "lastVisit"],
  },
  "app/api/visits/[id]/prescription-pdf/route.ts#GET": {
    kind: "session",
    permission: "prescriptions:view",
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
