# clinicOS v2.0 — Product & Functional Baseline (Workstream A)

**Branch:** `feature/v2` @ `a6373b4` · **Date:** 2026-11-10 · **Method:** read the code statically (routes, server actions, migrations, lib, components). Compared it with `docs/clinic-management-prd.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` and the phase VERIFICATION/UAT files. No tests or scripts were run against the hosted DB. Nothing was changed.

**Labels:** **Fact** = verified in code · **Problem** = defect or gap shown from code · **Risk** = likely future harm · **Assumption (validate)** = could not be verified statically · **Rec** = recommendation. Priorities: P0 = critical or security blocker, P1 = essential for v2, P2 = important, P3 = optional.

> **Headline:** v1 covers the main clinic flows on the happy path, when the user is the **clinic owner**. Several "complete" claims in `.planning` do not hold up in the code. Phase VERIFICATION files cite modules that do not exist (`lib/messaging/outbox.ts`, `patient_communication_preferences`, `/api/cron/messaging-dispatch`). They also describe the governance/consent engine as "strictly enforced", but nothing calls it. Treat all planning "passed" statuses as unverified.

---

## 0. Top findings (read first)

| # | Pri | Finding | Evidence |
|---|---|---|---|
| F1 | **P0** | **Server actions take caller-supplied `sessionOverride` and `clientOverride` parameters.** All arguments of a `"use server"` export can be set by the client. When `sessionOverride` is passed, the permission check is skipped. In many functions the **service-role admin client** is also used, so a caller can read or write **any tenant's data with no authentication**. Example: `searchPatients(query, undefined, {tenantId:"<victim>"})`, which client components import (so its action ID ships in the browser bundle). The pattern is in 20 feature files. | `features/patients/actions.ts:247-258`, `:274-279`, `features/settings/actions.ts:48-51`, `features/patients/consent.ts:161-166`; list via `grep -rln sessionOverride features` |
| F2 | **P0** | **The receptionist role cannot register patients.** `createPatient` requires `patients:edit`, which receptionists do not have. Walk-in, booking drawer, waitlist and AI quick-register all call `createPatient`, so new-patient walk-ins and bookings fail for the main front-desk persona. Tests assert this (`tests/auth/rbac.spec.ts:42`). | `lib/permissions/matrix.ts:55-61`, `features/patients/actions.ts:35`, `components/queue/walk-in-drawer.tsx:164`, `components/calendar/booking-drawer.tsx:153` |
| F3 | **P0** | **Staff invitations do not work in production.** No email, SMS or WhatsApp is sent. In production the invite link is deliberately left out of the response, so no one ever receives it. | `features/staff/actions.ts:70-97` |
| F4 | **P0** | **Role enforcement exists only in server actions.** RLS checks tenant membership only (plus owner/admin for DELETE and management tables). Any staff member can use the public anon key plus their own JWT to read or write clinical rows through PostgREST, bypassing role checks. Any member can also forge `audit_logs` rows. | `supabase/migrations/000003_patients_audit_consent.sql:60-100`, `000006…:110-188`, `000007…:370-523` |
| F5 | P1 | **No scheduled jobs run.** There is no `vercel.json` cron, no worker and no `CRON_SECRET` in `.env.example`. Appointment reminders (24h/2h), follow-up, vaccine, refill and balance reminders are **never enqueued**: templates exist, code does not. Webhook retries and delayed messages depend on a cron that is not configured. | `app/api/cron/*/route.ts`, `lib/messaging/templates/mapping.ts:36-68`; repo root has no `vercel.json` |
| F6 | P1 | **Messaging governance and DPDP consent are never enforced.** `evaluateMessageEligibility` (quiet hours, consent, quotas) has zero callers. `tenant_messaging_config` is never read. Messages go out regardless of recorded consent. | `lib/messaging/governance.ts:75`; grep shows no callers |
| F7 | P1 | **The patient self-reschedule flow is broken.** (a) The token insert uses `created_by = 00000000-…` against an FK to `auth.users` with `resource_type:"referral"`, and the error is ignored, so the link likely 404s. (b) Slots are generated as `…T10:00:00.000Z` (UTC), so an IST 10:00 slot is booked at 15:30 IST. (c) POST accepts any future time with no slot, conflict or block check. | `features/appointments/actions.ts:390-411`; `app/api/reschedule/[token]/route.ts:119`, `:212-241` |
| F8 | P1 | **The AI Operations Copilot "Confirm" for reschedule and cancel does nothing.** It only marks the chat card as confirmed. No server action is called, but the UI shows success. | `components/ai/operations-copilot-drawer.tsx:347-390` |
| F9 | P1 | **Users with more than one clinic get locked out.** `getActiveMembership` throws `MultipleClinicsSelectionRequiredError`, the dashboard layout catches only `NoClinicMembershipError`, and no clinic switcher sets `clinic_active_tenant`. An owner who opens `/clinic/new` again, or accepts an invite to a second clinic, gets an error page on every dashboard route. | `lib/auth/tenant.ts:56-61`, `app/(dashboard)/layout.tsx:21-29` |
| F10 | P1 | **Labs module is not implemented as specified.** There are no lab orders, test catalog, structured results or reference ranges. The module is file upload plus share link only. `/api/v1/lab-orders` is a facade over `patient_documents`. Phase 4 VERIFICATION marks it "✓ VERIFIED". | `features/labs/actions.ts`, `app/api/v1/lab-orders/route.ts:10-13`, `.planning/phases/04-labs-referrals/04-VERIFICATION.md:65-76` |

> Verification (2026-11-10): PARTIALLY_CONFIRMED — F5: no scheduler and no reminder producers confirmed, but immediate messages and message retries are dispatched inline; webhook retries depend on cron. Reminders H/P1, scheduler P0. See VERIFICATION_LOG.md

---

## 1. Module inventory

Status scale: Working / Partially working / Incomplete / Broken / Not implemented / Requires further investigation.

| # | Module | Status | Evidence (key paths) | What works | What's missing or wrong |
|---|---|---|---|---|---|
| 1 | **Appointment booking & scheduling** | Partially working | `features/visits/scheduling.ts` (`checkSlotAvailability` :254, `bookAppointment` :382), `features/visits/actions.ts` (`cancelVisit` :345, `confirmAppointment` :261), `components/calendar/*`, `features/settings/actions.ts` (availability :492) | Per-doctor multi-shift weekly availability; leave/clinic blocks; overlap detection; overbook or off-duty override dialogs; confirm and cancel from calendar; WhatsApp "booked" message | **No staff reschedule in the UI** (cancel and rebook only). **No no-show marking**: `updateVisitStatus` has no UI caller. No recurring appointments. No patient self-booking link. No DB constraint against double-booking (race). Availability check **fails open** on error (`scheduling.ts:343,360,363`). Days computed in UTC (`scheduling.ts:271`). Overbooking is a per-request flag, not a configurable allowance. In-app bookings emit **no `appointment.booked` webhook**: only the unused `createAppointment` does. |
| 2 | **Patient registration & management** | Partially working (Broken for receptionist) | `features/patients/actions.ts`, `features/patients/dedup.ts`, `features/patients/schema.ts`, `app/(dashboard)/patients/*`, `components/patients/*` | Create and edit; search by name/phone; E.164 phone normalisation; age↔DOB; allergies and chronic conditions; emergency contact; ABHA field; visit-history timeline; documents tab | Receptionist cannot create or edit (F2). **Dedup runs only on `/patients/new`**, not in walk-in, booking, waitlist or AI quick-register (the high-volume paths), and it is advisory only. No blood group, photo or family history (PRD §4.3). No tagged attachments beyond `document_type`. No merge tool. |
| 3 | **Medical records / consultation (EMR)** | Working (core) with defects | `features/consultation/actions.ts`, `features/terminology/actions.ts`, `components/consultation/consultation-workspace.tsx` (1,681 LOC), `visit_revisions` | Chief complaints, notes, vitals, ICD diagnoses (OPD list), investigations advised, follow-up, sign-off (needs a diagnosis or note), reopen and amend with revision history | `visit.completed` webhook sends `patient_id`/`doctor_id` as **undefined**: they are not selected (`consultation/actions.ts:612` vs `:700`). Any doctor can sign any visit; there is no assigned-doctor check. A visit already marked completed can be re-signed. `/consultation/[id]` has **no role check**, so a receptionist can read full notes by URL. `prescriptions.maybeSingle()` after amendments may error (`:713`). |
| 3a | Specialty templates | Incomplete | `components/consultation/specialty/*`, `000007…:12` CHECK `('general_physician','dental','pediatrics')` | GP systemic review, dental odontogram, pediatrics growth/vaccine tools | Only 3 of 6 PRD specialties (no Gyn/Obs, Derm, Ortho). Hard-coded components, **not configuration-driven** as the PRD requires. REQUIREMENTS marks this `[x]` complete. |
| 4 | **Doctor & clinic management** | Partially working | `features/settings/actions.ts`, `features/clinics/profile.ts`, `components/settings/*`, `components/profile/doctor-availability-card.tsx` | Clinic profile, fees, payment methods, statutory IDs (GSTIN, reg nos), doctor credentials, slot duration, shifts, time blocks | **Three different definitions of "doctor"**: `getActiveClinicDoctors` includes every owner and admin (`visits/actions.ts:547`); `getTenantDoctorDirectory` uses `owner_is_practicing_doctor` plus admin qualifications (`staff/actions.ts:175-236`); the API guard allows doctor or owner only (`lib/api/doctor-guard.ts`). Admins appear bookable but lack `consultations:edit`. No logo or letterhead upload (`tenants.logo_url` exists but has no UI). No holiday-calendar concept beyond blocks. `tenants.timezone` is stored but IST is hard-coded everywhere. Dead `app/(dashboard)/settings/clinic/actions.ts` would overwrite `working_hours:{}`. |
| 5 | **Staff & invitations** | **Broken (production)** | `features/staff/actions.ts`, `features/staff/invite.ts`, `supabase/migrations/000002…:120-165`, `app/(auth)/join/page.tsx` | Invite record with hashed token and 7-day expiry; join page verifies email OTP, then `consume_invitation` RPC; role edit with last-owner guard | No delivery channel (F3). `consume_invitation` **does not check the invited email**: anyone holding the link joins. No revoke or resend; no remove or deactivate staff. Invite link shown in the UI in non-production only. |
| 6 | **Walk-in & queue** | Partially working | `features/queue/actions.ts`, `components/queue/*`, RPC `generate_daily_queue_token` (`000006…:73-90`) | Walk-in register, then visit, then token; check-in of booked visits; priority (normal/urgent/vip); triage vitals; checkout drawer (invoice and payment) | Token is `MAX+1` and **not atomic**, despite the comment. Concurrent check-ins hit `uq_tenant_date_token`, return "Failed to register queue entry", and leave an orphan "waiting" visit (walk-in is two non-transactional calls, `walk-in-drawer.tsx:179-195`). **No state machine**: `transitionQueueState` lets a receptionist mark any visit `completed` without a consultation. Check-in does not verify visit status or date. Token "today" is the UTC date. **No live refresh** (manual `router.refresh()`). "Record vitals" is shown to receptionists, who lack `vitals:edit`. |
| 7 | **Waitlist** | Partially working | `features/waitlist/actions.ts`, `components/calendar/waitlist-drawer.tsx`, `cancelVisit` auto-promote (`visits/actions.ts:406`) | Add to waitlist; list per date; auto-promote the top entry into a new visit when an appointment is cancelled | `promoteWaitlistEntry` has **no UI caller**. Auto-promotion is **silent**: no patient message (`notifyWaitlistSlotFreed` is dead code). No expiry job for `expired`. |
| 8 | **E-prescriptions** | Working (with gaps) | `features/prescriptions/actions.ts`, `components/consultation/prescription-builder.tsx`, `search_medicines` RPC, `features/prescriptions/pdf/*` | CDCI drug search (brand/generic), custom medicines, protocol templates, frequent-Rx chips, letterhead or blank-paper PDF, archive in storage, share via WhatsApp | **No deterministic allergy or interaction check**: only a static banner listing allergies (`prescription-builder.tsx:438-449`). Interaction warnings come only from the LLM copilot. No digital signature. Auto-send happens only through "Sign & Bill" (`billing/actions.ts:650`), not on plain sign-off. |
| 9 | **Labs** | **Incomplete** | `features/labs/actions.ts`, `components/patients/patient-lab-documents.tsx`, `app/reports/view`, `app/api/v1/lab-orders/*` | Upload PDF or image (25 MB, MIME allow-list); `is_abnormal` flag; signed URLs; 7-day public share token; WhatsApp share | No lab orders, test catalog, in-house or external routing entity, structured results, reference ranges or trend graphs (F10). "Investigations advised" in the consultation is free text on the visit. |
| 10 | **Referrals** | Partially working | `features/referrals/actions.ts`, `components/referrals/*`, `app/(dashboard)/referrals/page.tsx` | Out-of-network referral with branded PDF letter; register; acknowledge and close-loop; WhatsApp share; consent record for history sharing | **In-network referral requires pasting a raw clinic UUID** (`create-referral-modal.tsx:477`); there is no directory. Inbound referrals join `patients`, which cross-tenant RLS blocks, so the patient shows as null. The target tenant can **UPDATE any column** of the referral (`000013…:229-242`). Any tenant can send referrals to any UUID (spam). |
| 11 | **Billing & payments (per-visit)** | Working (with defects) | `features/billing/actions.ts`, `features/billing/reports-actions.ts`, `components/queue/checkout-drawer.tsx`, `components/billing/*`, `000009…` | Itemised invoice; discount and tax fields; cash/UPI/card; partial payments and balance; receipt PDF; daily collection report and CSV | Invoice number = `count(*)+1` (`000009…:63-84`), so it races; fallback `INV-YYYY-<5 ms digits>` can collide. **Paid invoices stay mutable**: items can be added or removed after payment and status flips. No overpayment check. Payments allowed on cancelled invoices. No cancel or refund flow. No GST computation (tax is free input). Receptionist can bill but **cannot WhatsApp the receipt** (`billing:view`). |
| 11a | Subscription (₹1,000/month SaaS billing) | **Not implemented** | `features/billing/subscription.ts`, `app/(dashboard)/settings/billing/page.tsx` | Read-only view of `subscriptions` and `payment_records` | Nothing creates subscription rows; no payment gateway; no trial or expiry enforcement. The page renders "No active subscription" for every clinic and has no nav link. |
| 12 | **WhatsApp/SMS (MSG91)** | Partially working | `lib/messaging/*`, `features/*/actions.ts` (9 `enqueueMessage` call sites), `app/api/webhooks/messaging/[provider]/route.ts`, `scripts/msg91-*.ts` | Transactional sends: booked, rescheduled, cancelled, prescription, lab, referral, receipt, consolidated consult. Outbox with retry, backoff and dead-letter. SMS fallback. DLR status webhook. Two-way buttons (confirm/cancel). Template sync script | **Scheduled reminders not implemented** (F5). Governance and consent unused (F6). Default provider is `dev`, which **reports success without sending**; it is used silently if `MESSAGING_PROVIDER` or `MSG91_AUTH_KEY` is unset (`lib/messaging/index.ts:18-27`). Opportunistic dispatch runs **all tenants' due items inside the user's request** with no row claim (`dispatcher.ts:103-108,138-148`), so concurrent requests can double-send. Bot reply matching (`findActiveAppointmentByPhone`, `appointments/actions.ts:343-383`) searches **across all tenants**, has no `scheduled_at >= now` filter, and takes the earliest booked visit, so it can cancel the wrong (or a stale) appointment. Reschedule reply is broken (F7). |
| 12a | In-app notifications | Partially working | `features/notifications/*`, `components/notifications/*` | Bell plus drawer, role-scoped, polling; written by the bot webhook, reschedule, cancel and outbox failure | **All 11 trigger helpers in `features/notifications/triggers.ts` are dead code** (patient arrived, vitals recorded, lab ready, no-show, EOD digest, …). |
| 13 | **AI (scribe, catch-up, copilots)** | Partially working | `lib/ai/*`, `features/ai/actions.ts`, `app/api/ai/*`, `components/ai/*`, `components/consultation/ai-scribe-modal.tsx`, `clinical-copilot-panel.tsx` | Text/Web-Speech scribe → SOAP draft; returning-patient catch-up; ICD suggest; frequent-Rx chips (deterministic); ops copilot search, availability and booking preview (booking confirm really calls `bookAppointment`); clinical copilot limited to doctor/admin/owner; PII sanitiser | Copilot reschedule/cancel confirm is fake (F8). **Silently falls back to `MockAiProvider`** (fabricated SOAP text) when the key is missing (`lib/ai/client.ts:185-225`). No AI call logging or audit (PRD §6). No persisted "AI-generated" provenance once text is inserted. No smart scheduling assist. Patient consent not checked before sending data to an external LLM. Routes fall back to `user.app_metadata` role and tenant when membership fails (`app/api/ai/*/route.ts:25-33`). |
| 14 | **Settings / admin** | Partially working | `app/(dashboard)/settings/*`, `/staff`, `/profile` | Clinic profile, statutory, staff list and edit, developer settings | No audit-log viewer, messaging config, tenant timezone UI, logo upload or subscription management. `/settings/billing` is orphaned. |
| 15 | **Public API, API keys, webhooks** | Working (API) / Partially working (webhooks) | `app/api/v1/**` (15 route files), `lib/api/*`, `features/api-keys/*`, `features/webhooks/*`, `lib/webhooks/*` | `clq_live_` keys, SHA-256 hashed, revocable; envelope; pagination; doctor-assignment guard; OpenAPI and docs; webhook subscriptions with signing, SSRF guard, delivery logs, test ping | Keys are all-or-nothing "admin" scope (`lib/api/auth.ts:13`), not role-scoped as the PRD requires. **Rate limiter is in-memory per instance** (`lib/api/rate-limiter.ts:12`), so it is ineffective on serverless. Webhook events missing: `appointment.booked` and `.cancelled` from the in-app UI and the API POST, and `appointment.rescheduled` from the UI. Retries need the unscheduled cron. |
| 16 | **DPDP (consent, export, erase)** | Partially working | `features/patients/consent.ts`, `app/(dashboard)/patients/[id]/consent-section.tsx`, `features/dpdp/*`, `components/patients/dpdp-export-actions.tsx` | Immutable append-only consent records (grant/withdraw); JSON and PDF export from the patient page; soft-delete erasure with audit | **Erasure only via API key** (`DELETE /api/v1/patients/[id]`); there is no UI. Consent **is not enforced** anywhere (messaging, AI, sharing). Export is allowed for any role with `patients:view`, including receptionists (full medical record). No breach-notification workflow. |
| 17 | **Audit logging** | Partially working | `lib/audit/audit.ts` (metadata allow-list), ~70 action types | Mutations broadly audited; `patient.view` audited in `getPatient` | Reads beyond `getPatient` are not audited (consultation view, export view, PDFs). Some writers bypass `recordAudit` and the allow-list, putting raw `recipient_phone` into metadata (`dispatcher.ts:203-216`, messaging webhook). **Rows are forgeable** by any member (F4). No viewer UI. AI not audited. |
| 18 | **Patient-facing public links** | Partially working | `app/r/[token]`, `app/api/r/[token]`, `app/reports/view`, `app/api/reports/view`, `app/reschedule/[token]`, `app/api/reschedule/[token]` | `/r/<token>` (prescription, invoice, referral, document) and `/reports/view?token=` with expiry, revoke and signed 600 s URLs | `/reschedule` broken (F7). Bearer links with no second factor (OTP or DOB) expose PHI to anyone who has the URL for 7 days. Tokens are stored in plaintext (unlike invitations). |
| 19 | **Onboarding & auth** | Partially working | `app/(auth)/*`, `features/auth/dev-actions.ts`, `app/(onboarding)/clinic/new`, `features/clinics/actions.ts`, `app/auth/callback/route.ts`, `middleware.ts` | Email OTP login; first-time user → `/clinic/new` → `create_clinic_with_owner` RPC; invite join | **Open self-signup** (`shouldCreateUser:true`, `dev-actions.ts:61`) and unlimited clinic creation. No phone OTP (PRD/MSG91 OTP unused). Multi-clinic lockout (F9). No setup wizard (doctor profile, availability, fees). `/verify` page orphaned. Google/Microsoft buttons disabled. Middleware only refreshes the session and protects no routes (guards are in layout and pages). In non-production the OTP is returned to the browser (`dev-actions.ts:80-84`). |

**Status counts (19 top-level modules):** Working 1 · Working with defects 2 (EMR core, per-visit billing) · Partially working 13 · Incomplete 1 (Labs) · Broken 1 (Staff invitations, in production) · Not implemented 1 (Subscription billing, 11a). Sub-features that are Not implemented: scheduled reminders, recurring appointments, self-booking link, smart scheduling, lab orders and results, configurable specialty templates, staff removal.

---

## 2. Route map

Nav = linked from sidebar (`components/layout/app-sidebar.tsx`), user dropdown or in-page link. "Roles (server)" = what the page or handler enforces on the server.

### 2.1 App pages

| Path | Purpose | Roles (server) | Nav visibility (UI) | Linked? |
|---|---|---|---|---|
| `/` | Front-desk dashboard (counts, today's visits) | Logged-in member; doctor → redirect `/cabin` | All non-doctor roles | Sidebar |
| `/cabin` | Doctor's cabin (my queue) | receptionist/nurse → redirect `/queue`; others allowed | doctor, owner, admin | Sidebar |
| `/queue` | Live queue, walk-in, triage, checkout | Any member | Non-doctor roles | Sidebar |
| `/calendar` | Doctor timeline, booking, blocks, waitlist | Any member | All ("My Calendar" for doctor) | Sidebar |
| `/visits` | Unified visits register | Any member | All | Sidebar |
| `/patients` | Patient directory | Any member | All | Sidebar |
| `/patients/new` | Registration with dedup | None on page; action requires `patients:edit` | — | In-page, global search |
| `/patients/[id]` | Profile, history, documents, consent, DPDP export | `patients:view` (via `getPatient`) | — | In-page |
| `/consultation/[id]` | Consultation workspace | **Membership only, no role check** | — | Cabin, queue, visits, history |
| `/referrals` | Referral register (out/in) | `patients:view` | All | Sidebar |
| `/staff` | Staff list; invite (owner/admin) | **Any member can view** | owner/admin only | Sidebar (management) |
| `/profile` | Own profile, credentials, availability | Any member | All | User dropdown |
| `/settings/clinic` | Clinic profile, fees, statutory | View: `clinic:view` (all roles); save: `clinic:manage` | owner/admin | Sidebar, dropdown |
| `/settings/billing` | SaaS subscription view | `billing:view` | — | **Orphan** (nav only highlights it) |
| `/settings/developer` | API keys, webhooks | `clinic:manage` | owner/admin | Sidebar |
| `/billing/reports` | Daily collection report | `billing:view` (owner/admin) | owner/admin | Sidebar |
| `/billing/register` | Legacy redirect → `/billing/reports` | — | — | **Orphan** |
| `/login` | Email OTP login | Public | — | — |
| `/verify` | Standalone OTP verify | Public | — | **Orphan** |
| `/join?token=&email=` | Accept staff invite | Public, then OTP | — | Invite link (not delivered in production) |
| `/clinic/new` | Create clinic (onboarding) | Authenticated (in action) | — | Redirect when no membership |
| `/r/[token]` | Public document viewer | Token | — | WhatsApp links |
| `/reports/view?token=` | Public lab report viewer | Token | — | WhatsApp or copy link |
| `/reschedule/[token]` | Patient self-reschedule | Token | — | WhatsApp bot (broken, F7) |

### 2.2 Route handlers

| Path | Methods | Purpose | Auth |
|---|---|---|---|
| `/auth/callback` | GET | PKCE / token_hash exchange | Supabase |
| `/api/ai/operations-copilot` | POST | Streaming ops copilot (tools) | Session; role-checked per tool |
| `/api/ai/clinical-copilot` | POST | Streaming clinical copilot | Session; doctor/admin/owner |
| `/api/cron/dispatch-communications` | GET/POST | Drain messaging outbox (50) | `Bearer CRON_SECRET`; **nothing schedules it** |
| `/api/cron/webhooks` | GET/POST | Drain webhook outbox | `Bearer CRON_SECRET`; **nothing schedules it** |
| `/api/health`, `/api/ready` | GET | Liveness; readiness (DB and outbox via admin client) | Public |
| `/api/invoices/[id]/receipt-pdf` | GET | Receipt PDF | Session plus tenant (no role check) |
| `/api/visits/[id]/prescription-pdf` | GET | Generates **and archives** Rx PDF (side effect on GET) | Session plus tenant (no role check) |
| `/api/r/[token]`, `/api/reports/view` | GET | Public token resolution → signed URL | Token |
| `/api/reschedule/[token]` | GET/POST | Slots; reschedule | Token |
| `/api/webhooks/messaging/[provider]` | POST | MSG91 inbound/DLR, bot actions | Provider signature |
| `/api/v1/patients` (+`/[id]`, `/[id]/export`) | GET/POST/PUT/DELETE | REST; DELETE = DPDP erasure; export also accepts a cookie session | API key (export: key or session) |
| `/api/v1/appointments` (+`/[id]`) | GET/POST/PATCH/DELETE | REST with slot check | API key |
| `/api/v1/visits`, `/prescriptions`, `/referrals`, `/lab-orders` (+`/[id]`) | GET/POST(/PATCH) | REST; doctor guard on clinical writes | API key |
| `/api/v1/docs`, `/api/v1/openapi.json` | GET | API docs | Public |

**Fact:** `middleware.ts` skips `/api/v1`, `/api/health` and `/api/ready`. Everywhere else it only refreshes the Supabase session and **never redirects**. Route protection lives in `app/(dashboard)/layout.tsx` and in individual pages and actions.

---

## 3. User-role matrix

> Update (2026-11-10, PO decisions): PO-3 is decided: **receptionists must be able to register patients**. v2 grants them patient create and edit (without clinical notes) in `lib/permissions/matrix.ts`, in role-aware RLS and in the UI (roadmap P0-14, V2-05/V2-08), with server-side duplicate detection on every registration path (AI-14). The rest of the roadmap's PO-3 default is adopted: doctors view their own visits' invoices and use Sign & Bill, but do not collect or refund; admins have no clinical-note access by default. This matrix still describes v1.

Source of truth: `lib/permissions/matrix.ts` (owner = `*`). "Where enforced": **SA** = server action `requirePermission` · **Page** = server redirect or check · **UI** = nav or button visibility only · **RLS** = database policy.

| Capability | Owner | Admin | Doctor | Receptionist | Nurse | Where enforced | Notes |
|---|---|---|---|---|---|---|---|
| View patients | ✓ | ✓ | ✓ | ✓ | ✓ | SA + RLS (tenant) | |
| Create/edit patient | ✓ | ✓ | ✓ | **✗** | ✓ | SA only (RLS allows all members) | **Problem F2.** UI shows the forms to receptionists anyway. |
| Book / cancel / confirm / check-in | ✓ | ✓ | ✓ | ✓ | ✓ | SA only | |
| Mark visit completed (queue) | ✓ | ✓ | ✓ | ✓ | ✓ | SA (`appointments:edit`) | **Problem:** front desk can complete visits without sign-off. |
| Record vitals | ✓ | ✗ | ✓ | **✗** | ✓ | SA | Button shown to all roles (UI mismatch). |
| Open consultation page | ✓ | ✓ | ✓ | ✓ (by URL) | ✓ (by URL) | **Page: none** | Read exposure of clinical notes. |
| Edit/sign consultation, prescribe | ✓ | **✗** | ✓ | ✗ | ✗ | SA | Admin sees "Doctor's Cabin" in nav (UI) but cannot act. No assigned-doctor check. |
| Upload lab docs, create referrals | ✓ | ✓ | ✓ | ✗ | ✓ | SA (`patients:edit`) | Labs use `patients:*`, not `labs:*` (the matrix `labs:*` perms are unused). |
| Create invoice / record payment | ✓ | ✓ | ✓ | ✓ | ✓ | SA (`appointments:edit`) | |
| Share receipt on WhatsApp | ✓ | ✓ | ✗ | **✗** | ✗ | SA (`billing:view`) | Breaks reception checkout. |
| Collection reports, subscription view | ✓ | ✓ | ✗ | ✗ | ✗ | SA + Page + UI | |
| Invite staff | ✓ | ✓ | ✗ | ✗ | ✗ | SA + RLS (owner/admin) + UI | Delivery broken (F3). |
| Edit staff / roles | ✓ | ✓ | ✗ | ✗ | ✗ | SA + RLS | Admin can promote anyone to **owner** (`staffEditSchema.role` includes `owner`). |
| Clinic settings | ✓ | ✓ | view | view | view | SA + UI | |
| API keys / webhooks | ✓ | ✓ | ✗ | ✗ | ✗ | SA + RLS + UI | |
| DPDP export | ✓ | ✓ | ✓ | ✓ | ✓ | Route (`patients:view`) | Over-broad for receptionist. |
| DPDP erase | API key only | — | — | — | — | API | No UI. |
| Clinical copilot | ✓ | ✓ | ✓ | ✗ | ✗ | Route | Admin allowed but cannot edit consultations. |
| Delete visits / tokens / Rx / diagnoses | ✓ | ✓ | ✗ | ✗ | ✗ | **RLS** (owner/admin DELETE) | Only real role-aware RLS on clinical tables. |

**Flagged enforcement weaknesses**
- **Problem (P0):** Every role restriction above is **server-action-only** and can be bypassed in two ways: (a) `sessionOverride` on the actions (F1); (b) direct PostgREST calls with the user's JWT, because RLS is tenant-wide (F4).
- **UI-only items:** "Doctor's Cabin" for admin, "Record vitals" for receptionist, `/staff` and `/consultation/[id]` visible by URL to all roles, and the `/settings/clinic` read view.
- **Assumption (validate):** owner = `*` includes clinical signing for non-doctor owners. The data model does not check that a signer has a medical-council registration.

---

## 4. Auth & onboarding flows

### 4.1 Clinic owner signup and login (email OTP)

> Update (2026-11-10, PO decisions): v2 replaces this flow with email + password. Email OTP is used only for owner signup verification and forgot password, staff invites set a password through a link, and owner signup ends with a required AutoPay mandate step before the 14-day trial (AUTH_REDESIGN.md §3, SUBSCRIPTIONS_AND_PLANS.md §5).

1. `/login` → `requestOtpAction(email)` (`features/auth/dev-actions.ts:20`).
   - Non-production with a service key: `admin.generateLink` returns the OTP to the browser and writes it to the console and `.planning/dev-auth-logs.txt`.
   - Production: `signInWithOtp({shouldCreateUser:true})`, so **anyone can create an account**.
2. User enters the OTP → client `supabase.auth.verifyOtp` → `router.push("/")`.
3. `app/(dashboard)/layout.tsx`: no user → `/login`. `getActiveMembership()`:
   - 0 memberships → `/clinic/new`
   - 1 membership → dashboard
   - more than 1 → **unhandled error page** (F9)
4. `/clinic/new` → `createClinic` → `create_clinic_with_owner` RPC (tenant plus owner membership, atomic) → `/`.
5. Defaults after onboarding: `owner_is_practicing_doctor=true`, fee ₹500/₹300, **no availability schedule**. The slot check then treats the doctor as always available (`scheduling.ts:274-288`), while the public reschedule API substitutes a hard-coded 10–13 / 17–20 schedule (`reschedule route:95-103`). **Inconsistent.**
6. **Friction:** no guided setup (doctor credentials, shifts, fees, letterhead, messaging); no subscription or trial; first-day success metric (PRD §8) is not supported by a wizard.

### 4.2 Staff invite
1. Owner/admin on `/staff` → `inviteStaff({email, role})`. The invitation row stores a SHA-256 token hash with 7-day expiry.
2. **Delivery: none.** In non-production the link is returned to the UI and logged; in production it is dropped (F3).
3. Invitee opens `/join?token&email` → requests an OTP (`requestJoinOtpAction`) → verifies → `acceptInvite(token)` → `consume_invitation` RPC (row lock, expiry and consumed checks) inserts the membership.
4. **Gaps:** invited email is not matched to the authenticated user; no revoke, resend or remove; a joining user who already owns a clinic becomes multi-tenant and is locked out (F9).

### 4.3 Session and route protection
- Cookie session via `@supabase/ssr`. Middleware refreshes it. Server pages and actions resolve the tenant from `memberships` (they do not trust client tenant IDs, **except** when `sessionOverride` is passed).
- `/auth/callback` exchanges a PKCE code or token_hash; `next` is appended to origin.
- Social login buttons are disabled. MSG91 SendOTP (PRD "OTP-based staff auth", Phase 05.1 SC5) is **not used for login**.

---

## 5. Data model summary (brief; DB agent covers depth)

**Tenant key:** `tenant_id UUID → tenants(id) ON DELETE CASCADE` on every business table. RLS helper `public.current_user_tenant_ids()`.

| Domain | Tables | Key relationships and notes |
|---|---|---|
| Tenancy | `tenants`, `memberships`, `invitations`, `subscriptions`, `payment_records` | `memberships(user_id→auth.users, tenant_id, role CHECK 5 roles)` also holds **doctor profile and availability** (`full_name`, `medical_council_reg_no`, `availability_schedule JSONB`, `default_slot_duration_minutes`). Doctor = membership, not a separate practitioner entity. |
| Patients | `patients`, `consent_records`, `audit_logs` | Phone normalised to E.164 (`000017`). No unique (tenant, phone). Soft-delete `is_deleted` / `status='erased'`. ABHA, HFR fields present. |
| Visits (hub) | `visits`, `queue_tokens`, `waitlist_entries`, `schedule_blocks`, `follow_ups`, `visit_revisions` | `visits` = appointment **and** encounter (origin `scheduled`/`walk_in`; status booked→confirmed→waiting→in_consultation→completed / cancelled / no_show). Clinical fields live on `visits` (chief_complaints, clinical_notes, vitals, specialty, specialty_data JSONB). `queue_tokens.visit_id UNIQUE`, `UNIQUE(tenant_id,date,token_number)`. **No exclusion constraint on doctor time overlap.** `doctor_id → auth.users`, not memberships, so tenant membership is not DB-enforced. |
| Clinical | `consultation_diagnoses`, `prescriptions`, `prescription_items`, `doctor_custom_medicines`, `doctor_custom_diagnoses`, `doctor_prescription_templates`, `opd_diagnoses`, `cdci_*` | `prescriptions` was dropped and recreated in `000007`. **`consultations` table (`000004`) is dead**: zero code references. |
| Billing | `invoices`, `invoice_items`, `payments` | `UNIQUE(tenant_id, invoice_number)`; `amount > 0`; `quantity > 0`. Totals are denormalised and recomputed in the app. |
| Docs & labs | `patient_documents`, `document_share_tokens` | Share tokens are polymorphic (`resource_type` CHECK patient_document/prescription/invoice/referral). Reschedule tokens misuse `referral`. Plaintext `token UNIQUE`. |
| Referrals | `referrals` | `target_tenant_id` gives cross-tenant read and update RLS. |
| Messaging | `communication_queue`, `tenant_messaging_config` (unused), `in_app_notifications` | Outbox with status, retry and `next_retry_at`. |
| API | `api_keys`, `api_key_usage_daily`, `webhook_subscriptions`, `webhook_delivery_queue` | Owner/admin RLS. |

**Fact:** composite tenant-safe FKs are not used, so cross-tenant references can be inserted where only the row's own `tenant_id` is checked. Example: `createVisit` does not verify that `patient_id` or `doctor_id` belong to the tenant (`features/visits/actions.ts:36-90`). **Risk (P1).**

---

## 6. Integrations & background processing

| Integration | Implementation | Trigger and dispatch | Status / issue |
|---|---|---|---|
| Supabase Auth / DB / Storage | `lib/supabase/{server,client,admin}.ts`; `lib/storage` (Supabase or R2 via `STORAGE_PROVIDER` / `R2_ACCOUNT_ID`) | Request-time | Service-role client widely used in feature code (`getAppointmentsDbClient`, `getDbClient`, `getAdminClient`). |
| MSG91 WhatsApp / SMS | `lib/messaging/providers/msg91.ts`; Twilio and Gupshup alternates | `enqueueMessage` inserts into `communication_queue` and, when there is **no delay**, immediately runs `dispatchPendingQueue()` inside the same user request, over **all tenants**, limit 20 | No row locking (`status='processing'` update without a conditional claim), so double-send is possible. Delayed and retried items need the cron. |
| MSG91 inbound / DLR | `app/api/webhooks/messaging/[provider]/route.ts` | Provider push | Cross-tenant phone match; reschedule broken. |
| Outbound webhooks | `lib/webhooks/{outbox,dispatcher,signer,ssrf}.ts` | `enqueueWebhookEvent` → fire-and-forget dispatch (non-awaited promise on serverless, which may be killed) → retries via `/api/cron/webhooks` | Cron not scheduled. |
| AI (OpenAI / Gemini via AI SDK) | `lib/ai/client.ts` | Request-time streaming | Mock fallback; no logging. |
| PDF | `@react-pdf/renderer` (Rx, receipt, referral, DPDP summary) | Request-time; archived to storage | GET handler with side effects. |
| Template sync | `scripts/msg91-sync-templates.ts` | Manual CLI with `.env` | Template names are a contract with Meta and MSG91. |

**Scheduled processes: none exist.**
- No `vercel.json` crons, no GitHub Actions, no Supabase `pg_cron` in migrations, no worker.
- `CRON_SECRET` is not in `.env.example`.
- **Assumption (validate):** the production Vercel project may have crons configured in the dashboard. Check the Vercel project settings.
- Even with crons, nothing generates time-based reminders (24h/2h, follow-up due, vaccine, refill, EOD digest, waitlist expiry, no-show sweep).

---

## 7. Critical user journeys

### 7.1 Receptionist day

| Step | Action | Code path | Friction / defect |
|---|---|---|---|
| 1 | Log in | `/login` email OTP | No phone OTP; shared devices require email access. |
| 2 | See today | `/` dashboard, `/queue` | "Today" is the UTC date (before 05:30 IST shows yesterday). No auto-refresh. |
| 3 | Walk-in, new patient | Walk-in drawer → `createPatient` | **Fails: permission denied (F2).** No dedup in drawer. |
| 3b | Walk-in, existing patient | `searchPatients` → `createVisit` → `checkInVisit` | Two non-atomic calls; token race under load. |
| 4 | Phone booking | `/calendar` booking drawer → `bookAppointment` | New patient fails (F2). Conflict dialogs OK. No reschedule. Uses browser timezone. |
| 5 | Check-in booked patient | `status-actions` → `checkInVisit` | No status or date validation. |
| 6 | Vitals | Triage modal → `recordVisitVitals` | **Fails for receptionist** (`vitals:edit`); button is still shown. |
| 7 | Checkout | `checkout-drawer` → `createVisitInvoice`, `recordPayment`, `transitionQueueState(completed)` | Can complete before the doctor signs. WhatsApp receipt **fails** (`billing:view`). Paid invoice still editable. |
| 8 | Patient replies "Cancel" or "Reschedule" on WhatsApp | Messaging webhook | May cancel the wrong or a stale visit. Reschedule link broken. Waitlist auto-promotion not communicated. |
| 9 | Mark no-show | — | **Not possible in UI.** |

### 7.2 Doctor consult

| Step | Action | Code path | Friction / defect |
|---|---|---|---|
| 1 | Open cabin | `/cabin` (my queue) | Manual refresh only. |
| 2 | Start consult | `/consultation/[id]`; queue → `in_consultation` | — |
| 3 | History | Catch-up (AI), history drawer | AI mock fallback risk; no consent check. |
| 4 | Notes | Scribe (Web Speech) → SOAP draft → insert | Provenance not persisted. |
| 5 | Diagnose | ICD search / AI suggest → `addConsultationDiagnosis` | OPD list only. |
| 6 | Prescribe | Prescription builder, templates, frequent chips | No deterministic allergy or interaction block. |
| 7 | Labs / referral | Investigations advised (free text); referral modal | No lab orders. In-network needs a UUID. |
| 8 | Sign / Sign & Bill | `completeAndSignConsultation` / `completeAndBillConsultation` → PDF archive, WhatsApp consolidated | `visit.completed` webhook payload has undefined patient and doctor IDs. Only Sign & Bill auto-sends. |
| 9 | Amend | `reopenVisitForAmendment` → `finalizeVisitAmendment` (revisions) | Works; prescription `maybeSingle` risk after multiple Rx. |

### 7.3 Owner/admin

| Step | Action | Code path | Friction / defect |
|---|---|---|---|
| 1 | Create clinic | `/clinic/new` | No wizard. Re-visiting creates a 2nd clinic and **locks the owner out** (F9). |
| 2 | Configure | `/settings/clinic`, `/profile` (availability) | No logo, letterhead image, holidays or messaging settings. |
| 3 | Invite staff | `/staff` | **Not delivered in production (F3).** Cannot revoke or remove. |
| 4 | Reports | `/billing/reports` | Daily or date-range collections; UTC-day boundaries. |
| 5 | Subscription | `/settings/billing` (unlinked) | Always empty; no payment. |
| 6 | Developer | `/settings/developer` | API keys and webhooks work; webhook retries need cron. |
| 7 | DPDP request | Patient page export; erase via API only | No erase UI; no request log or SLA tracking. |
| 8 | Audit review | — | No audit viewer. |

---

## 8. Existing business rules (preserve or consciously change)

| Area | Rule | Code ref |
|---|---|---|
| Slot availability | Slot must fit fully inside an enabled shift for that weekday (IST); **null schedule = always available** | `features/visits/scheduling-utils.ts:19-38`, `scheduling.ts:274-288` |
| Blocks | Doctor-specific or clinic-wide (`doctor_id IS NULL`) blocks override; override needs an explicit `override_block` | `scheduling.ts:290-308`, `:409-416` |
| Double booking | Overlap `startA<endB && endA>startB` against non-cancelled visits that day; override with `is_overbooked` (flag stored); **app-level only, fail-open** | `scheduling.ts:310-360` |
| Off-duty | Outside shift needs `override_off_duty`; stored as `is_overbooked=true` | `scheduling.ts:417-424`, `:441` |
| Visit status init | Walk-in → `waiting`; scheduled → `booked` | `features/visits/actions.ts:76` |
| Queue tokens | Per tenant per day sequential `MAX+1`; priority normal/urgent/vip; existing token returned idempotently per visit | `000006…:73-90`, `features/queue/actions.ts:44-78` |
| Queue ordering | Status-rank sort (no_show rank 6, …) | `features/queue/actions.ts:~330-340` |
| Waitlist | On cancel, the top `waiting` entry (same date, doctor match, priority) is auto-promoted into a new visit | `features/visits/actions.ts:406-470` |
| Patient dedup | High: exact E.164 phone; Medium: case-insensitive exact name plus age ±2 / DOB | `features/patients/dedup.ts:29-130` |
| Phone normalisation | Strip non-digits; drop leading `0` (11 digits) or `91` (12 digits); must match `^[6-9]\d{9}$`; persist `+91XXXXXXXXXX` | `lib/utils/phone.ts:11-48`, `features/patients/schema.ts:43-50`, migration `000017` |
| Inbound phone match | `ilike '%last10%'` across all tenants | `features/appointments/actions.ts:343-383` |
| Billing math | Round to 2 dp; total = max(0, subtotal − discount + tax); status `paid` when payments ≥ total else `issued`; recompute on item add/remove | `features/billing/actions.ts:52-76`, `:249-258`, `:461-490` |
| Invoice numbering | `INV-YYYY-NNNNN` = count of this year's invoices + 1; fallback timestamp | `000009…:63-84`, `billing/actions.ts:80-94` |
| Fees | Tenant `default_consultation_fee` 500, `default_followup_fee` 300; methods cash/UPI/card | `000009…:4-9`, `features/settings/schema.ts:56-58` |
| Sign-off | Needs ≥1 diagnosis **or** non-empty clinical notes; signs active Rx; visit → completed; PDF v1 archived | `features/consultation/actions.ts:597-700` |
| Amendments | Reopen creates a revision; finalise increments the version and regenerates the PDF; never silent overwrite | `consultation/actions.ts:757-1040`, `visit_revisions` |
| Consent | Append-only rows; current = latest by `recorded_at, id`; "global" toggle; in-network referral with history sharing writes a consent row | `features/patients/consent.ts:24-200`, `features/referrals/actions.ts:81-150` |
| Messaging governance (defined, unused) | Quiet hours 21:00–08:00 IST (urgent exempt); consent; dedup; quota | `lib/messaging/governance.ts:26-170` |
| Outbox retry | Backoff 1/5/15 min; `max_retries` 3 → `dead_letter` and admin in-app alert; SMS fallback on WhatsApp failure | `lib/messaging/dispatcher.ts:54-58`, `:229-300` |
| Share tokens | Default 7-day expiry; revocable; access count; signed storage URL 600 s | `000013…:121-131`, `app/api/reports/view/route.ts:44-80` |
| Reschedule token | 24 h; one use (revoked after POST) | `features/appointments/actions.ts:390-411` |
| Invites | 7-day expiry; one use; hashed token | `features/staff/invite.ts:14-31`, `000002…:120-165` |
| Last owner | Cannot demote the sole owner | `features/settings/actions.ts:~376-390` |
| Uploads | PDF/JPEG/PNG/WEBP ≤ 25 MB | `features/labs/actions.ts:21-64` |
| DPDP erasure | Soft delete (`is_deleted`, `status='erased'`), retention tag `NMC_REGULATION_1.3.1_3_YEAR_MANDATE` | `features/dpdp/erasure.ts:34-110` |
| API | Keys `clq_live_` + 48 hex, SHA-256; 120 req/min/key (in-memory); page size ≤ 100 | `lib/api/auth.ts:25-33`, `lib/api/rate-limiter.ts` |
| Doctor guard (API) | Clinical writes need doctor_id with role doctor or owner in tenant | `lib/api/doctor-guard.ts` |

---

## 9. Gaps, defects, dependencies, regression risks

### 9.1 Functional gaps vs PRD

| PRD § | Requirement | v1 state | Pri |
|---|---|---|---|
| 4.1 | OTP staff invite via phone/email | Invite not delivered; email OTP only | P0 |
| 4.1 | Subscription status, payment history, renewal | Read-only shell, never populated | P2 |
| 4.1 | Clinic branding (logo/letterhead), holiday calendar | Column only; blocks used as holidays | P2 |
| 4.1 | Doctor in multiple clinics (anticipate) | Model allows it; app locks such users out | P1 |
| 4.2 | Patient self-booking link | Not implemented | P2 |
| 4.2 | Recurring appointments | Not implemented | P3 |
| 4.2 | States incl. Rescheduled, No-show | No reschedule UI; no no-show action; no "rescheduled" state | P1 |
| 4.2 | Configurable overbooking allowance | Per-booking override only | P3 |
| 4.2 | Waitlist auto-notify | Silent auto-promote; no notify | P2 |
| 4.3 | Blood group, photo, family history; tagged attachments | Missing | P2 |
| 4.3 | Fuzzy dedup at creation (all entry points) | Only `/patients/new`; exact-name match | P1 |
| 4.4 | 6 configurable specialty templates | 3 hard-coded | P2 |
| 4.5 | Allergy / interaction warnings | Static banner; LLM-only advice | P1 |
| 4.5 | Auto-send Rx on completion | Only via Sign & Bill | P3 |
| 4.6 | Visit types (OPD, follow-up, procedure) | Not modelled (fee type only) | P2 |
| 4.6 | Nurse → Doctor → Billing workflow states | No billing state; no enforced transitions | P1 |
| 4.7 | Lab orders, catalog, structured results, ranges, trends | Not implemented | P1 |
| 4.8 | Reminders 24h/2h, follow-up, vaccine, refill | Not implemented (no scheduler) | P1 |
| 4.8 | All patient communication logged against the patient | `communication_queue.patient_id` yes; no patient-timeline UI | P2 |
| 4.9 | In-network referral directory | Raw UUID input | P2 |
| 4.10 | Receipt via WhatsApp for front desk | Blocked by permission | P1 |
| 4.11 | Smart scheduling assist | Not implemented | P3 |
| 4.11 / 6 | AI outputs flagged in data model; AI calls logged | Not implemented | P1 |
| 4.12 | Role-scoped API keys; usage logging; rate limits | Admin-only scope; in-memory limiter; daily usage counter OK | P2 |
| 4.12 | Webhooks appointment booked/cancelled | Not emitted from UI or API POST paths | P1 |
| 5.3 | RBAC at API and UI; audit of all access | Server-action-only; bypassable; reads mostly unaudited | P0 |
| 5.4 | DPDP right to delete from app; consent enforced | API-only erasure; consent unenforced | P1 |
| 5.2 | Offline-tolerant UX | None | P3 |

### 9.2 Known defects (provable from code)

| ID | Pri | Defect | Evidence |
|---|---|---|---|
| D1 | P0 | `sessionOverride` / `clientOverride` exposed on server actions → RBAC bypass and cross-tenant service-role access | F1 |
| D2 | P0 | Receptionist cannot create patients | F2 |
| D3 | P0 | Invites not delivered in production; invite not bound to email | F3; `000002…:120-165` |
| D4 | P0 | `notifyPrescriptionIssued` is an unauthenticated exported server action taking arbitrary `tenant_id` → webhook injection to any tenant (admin client). **Assumption (validate):** reachability. It is not imported by client components, and Next 15 may not expose unreferenced actions. Fix regardless. | `features/prescriptions/actions.ts:165-185`, `lib/webhooks/outbox.ts:11-17` |
| D5 | P1 | Multi-membership users locked out; no tenant switcher | F9 |
| D6 | P1 | Reschedule token insert likely fails (nil-UUID FK, wrong `resource_type`, error ignored) — **Assumption (validate)** that no auth user has the nil UUID | `features/appointments/actions.ts:399-407` |
| D7 | P1 | Reschedule slots built in UTC (`…Z`) → 5h30m shift; POST has no availability validation | `app/api/reschedule/[token]/route.ts:119`, `:212-241` |
| D8 | P1 | Copilot reschedule/cancel confirmation is a no-op | `components/ai/operations-copilot-drawer.tsx:347-390` |
| D9 | P1 | WhatsApp reply resolves an appointment across tenants and the past | `features/appointments/actions.ts:343-383` |
| D10 | P1 | `visit.completed` webhook payload `patient_id` / `doctor_id` undefined | `features/consultation/actions.ts:612`, `:700-702` |
| D11 | P1 | Queue token and invoice number generation race (count/max + 1) | `000006…:73-90`, `000009…:63-84` |
| D12 | P1 | Walk-in = createVisit + checkIn, non-transactional → orphan waiting visits | `components/queue/walk-in-drawer.tsx:179-195` |
| D13 | P1 | Front desk can mark a visit `completed` without sign-off; no transition guard | `features/queue/actions.ts:160-262` |
| D14 | P1 | Paid invoices mutable; no overpayment or cancelled-invoice guard | `features/billing/actions.ts:184-300`, `:390-650` |
| D15 | P1 | Messaging provider defaults to `dev` (fake success) when env missing; AI defaults to mock | `lib/messaging/index.ts:18-27`, `lib/ai/client.ts:185-225` |
| D16 | P1 | Outbox dispatch runs cross-tenant inside user requests with no claim lock → duplicate sends and latency | `lib/messaging/dispatcher.ts:103-108`, `:138-148` |
| D17 | P2 | In-app booking, cancel and reschedule emit no appointment webhooks | `enqueueWebhookEvent` callers; `createAppointment` unused |
| D18 | P2 | Availability check fails open on DB error | `features/visits/scheduling.ts:343,360,363` |
| D19 | P2 | UTC day boundaries in queue, calendar, cabin, dashboard, reports, AI tools | `grep T00:00:00.000Z` (≈20 sites) |
| D20 | P2 | "Doctor" defined three different ways; admins bookable but cannot consult | `visits/actions.ts:547`, `staff/actions.ts:175-236`, `lib/api/doctor-guard.ts` |
| D21 | P2 | UI shows actions the role cannot perform (vitals, receipt WhatsApp, cabin for admin, patient create for receptionist) | §3 |
| D22 | P2 | Referral target tenant can update any referral column; inbound patient join returns null | `000013…:229-242`, `features/referrals/actions.ts:321-340` |
| D23 | P2 | Admin can grant `owner` role | `features/settings/schema.ts:92` |
| D24 | P3 | Dead code: 11 notification triggers, governance engine, `tenant_messaging_config`, `consultations` table, `createAppointment`, `settings/clinic/actions.ts`, `components/dashboard/nav.tsx`, `/verify`, `/billing/register`, unused `labs:*` / `prescriptions:*` / `reports:*` / `exports:*` permissions | various |
| D25 | P3 | `/api/visits/[id]/prescription-pdf` GET writes to storage (side effect) | route file |

> Verification (2026-11-10): PARTIALLY_CONFIRMED — D4: defect real but the function is dead code (probably not exposed by Next 15.5); impact limited to spoofed events to the victim tenant's own webhooks. M/P1, delete in P0-01. See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — D9: primary match is tenant-scoped by `replyMsgId`; the cross-tenant phone match is the fallback, which has every flaw listed. H/P0 (P0-03). See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — D10: only `patient_id` is undefined; `doctor_id` falls back to the signer. M/P2. See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — D11/D12: races real (unique constraints fail, no retry); invoice fallback is a lesser path; walk-in is three calls. M/P1. See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — D15: confirmed for messaging, SOAP drafts and catch-up summaries; copilot routes fail rather than mock. H/P1. See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — D16: confirmed; "all tenants" applies only to service-role call paths (common, e.g. appointments). H/P0. See VERIFICATION_LOG.md

### 9.3 Module dependency map

```
                   memberships (role + doctor profile + availability)
                          │                      │
 permissions/matrix ──► every server action      ├─► scheduling (slots) ─► public reschedule API
 lib/auth/tenant ─────► every page/action        └─► AI ops tools, staff directory, PDFs (doctor name/reg no)

 patients ──► visits (HUB) ──┬─► queue_tokens ──► queue UI, cabin, dashboard
   │  ▲                      ├─► consultation fields, diagnoses, follow_ups, visit_revisions
   │  │                      ├─► prescriptions/items ──► Rx PDF ──► document_share_tokens ──► /r/[token]
   │  │                      ├─► invoices/items/payments ──► receipt PDF, collection reports
   │  │                      ├─► patient_documents (labs) ──► /reports/view
   │  │                      ├─► referrals ──► referral PDF
   │  │                      ├─► waitlist_entries.promoted_visit_id
   │  │                      └─► communication_queue.appointment_id ──► MSG91 webhook bot
   │  └── phone (E.164) ──► dedup, search, inbound WhatsApp matching, all outbound messaging
   └── consent_records ──► (should gate) messaging, AI, referral sharing, export

 lib/messaging/dispatcher ◄── appointments, scheduling, billing, prescriptions, labs, referrals
 lib/webhooks/outbox      ◄── appointments, consultation, prescriptions, labs, API v1
 lib/storage              ◄── prescriptions, billing, referrals, labs, DPDP PDFs
 document_share_tokens    ◄── labs, prescriptions, invoices, referrals, reschedule (polymorphic)
```

**High-blast-radius changes:**
- `visits` schema or status enum touches ~12 modules, the API v1 contract and webhooks.
- The permission matrix touches every action, plus `tests/auth/rbac.spec.ts` and `tests/security/*`.
- `memberships` as the doctor store touches scheduling, PDFs, AI and the API doctor guard.
- `document_share_tokens` affects every public link.
- Phone format affects inbound bot matching and every message.

### 9.4 Regression risks for v2

| Risk | Why | Mitigation (Rec) |
|---|---|---|
| R1 Removing `sessionOverride` / `clientOverride` breaks tests | Integration tests inject an admin client and session (e.g. `tests/labs/lab-documents.spec.ts:10-19`) | Move to internal non-exported service functions plus thin authenticated action wrappers; adapt tests. |
| R2 Permission matrix changes | Tests assert the current (wrong) receptionist rules | Product-owner sign-off on a role matrix first; update tests deliberately. |
| R3 Timezone fix | Existing `scheduled_at` data and UTC-day queries; tokens keyed by UTC date | Introduce tenant-local date helpers; backfill check; regression tests at 00:00–05:30 IST. |
| R4 Public URLs already sent to patients | `/r/<token>`, `/reports/view?token=`, `/reschedule/<token>` live in WhatsApp history | Keep routes stable or redirect for at least the token lifetime. |
| R5 MSG91 template names and params | Approved by Meta; positional mapping in `lib/messaging/templates/mapping.ts` | Treat as an external contract; version it. |
| R6 Public API v1 and webhook payloads | External consumers (Voice Agent) | Contract tests; additive changes only, or `/v2`. |
| R7 Invoice and queue numbering change | Number formats visible on receipts and tokens | Keep `INV-YYYY-NNNNN`; switch to DB sequences or atomic counters. |
| R8 Data with cross-tenant references | No composite FKs today; possible bad rows | Run a data audit before adding constraints (**Outstanding investigation**: needs DB access). |
| R9 Clinical sign/amend flow | PDFs versioned and archived; legal record | Golden-file tests for PDF payloads before refactor. |
| R10 Hosted DB drift vs migrations | Planning says migrations applied by hand on a hosted project | **Outstanding investigation:** diff the live schema against `supabase/migrations` (DB agent). |
| R11 Silent fallbacks (dev messaging, mock AI) | Production misconfiguration looks like success | Fail closed in production; readiness check should verify providers. |

### 9.5 Outstanding investigations
1. Whether Vercel dashboard crons exist for `/api/cron/*` and whether `CRON_SECRET` is set in production.
2. Whether any `auth.users` row has the nil UUID (affects D6), and whether the live schema matches the migrations.
3. Whether MSG91 templates are actually approved, and which `MESSAGING_PROVIDER` / `AI_PROVIDER` production uses.
4. Whether production `NODE_ENV` is always `production` on preview deployments (dev OTP and invite-link exposure).
5. Real-device check of UI role mismatches (receptionist walk-in end-to-end). Not run, because tests need the hosted DB.
