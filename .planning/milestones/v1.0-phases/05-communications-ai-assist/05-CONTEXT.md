# Phase 5: Communications & AI Assist - Context

**Gathered:** 2026-10-26  
**Status:** Ready for planning  

<domain>
## Phase Boundary

Phase 5 delivers patient communications and clinician AI assistance designed around sustainable operational margins for CliniQ AI's ₹999/month flat subscription:
1. **Multi-Provider Messaging Abstraction & Outbox Queue (`lib/messaging/`):** Unified provider interface with a local `DevLogger` fallback, pluggable production drivers (Twilio, Gupshup, MSG91), and a database outbox table (`communication_queue`) with exponential backoff and dual-trigger execution (sub-second async dispatch + cron recovery) ensuring clinical workflows never block or fail during third-party provider outages.
2. **Two-Tier Notification Governance & Master 23-Event Catalogue:** Company-controlled master policy in the database (enforcing master channel toggles, monthly message quotas, quiet hours, and DLT templates) paired with restricted clinic customization. In-app notifications handle all 11 internal clinic cues (zero external cost), while external WhatsApp/SMS notifications are strictly managed.
3. **Two-Way WhatsApp Bot & Front-Desk Handover:** Interactive WhatsApp reply buttons (`[Confirm]`, `[Cancel]`, `[Reschedule]`), instant slot release on cancellation with audit logging, self-service tokenized web reschedule links, and polite fallback auto-reply routing conversational inquiries to the front-desk in-app alert drawer.
4. **Universal OpenAI-Compatible AI Gateway & Clinical Assist (`lib/ai/`):** Pluggable AI gateway following the OpenAI REST specification (`baseURL`, `apiKey`, `model`) supporting OpenAI, Google Gemini, Claude (via proxy/OpenRouter), or local models with zero code changes. Features on-demand SOAP note generation from dictation/shorthand, 1-click returning patient history catch-up summaries, and hallucination-free prescription suggestions sourced exclusively from the doctor's own historical signed prescriptions.

</domain>

<decisions>
## Implementation Decisions

### 1. Messaging Architecture & Outbox Queue
- **D-01: Multi-Provider Messaging Abstraction with DevLogger:** — **Reversibility:** costly — defines provider interface across `lib/messaging/`.
  - Abstract interface `MessagingProvider` (`sendSms`, `sendWhatsApp`) implemented by `DevLoggerProvider` (logs to server console and `.planning/dev-messages.txt` in dev/test, mirroring `lib/auth/dev-logger.ts`) and production adapters for Twilio, Gupshup, and MSG91 selected via environment variables.
- **D-02: Resilient Outbox Queue Table (`communication_queue`):** — **Reversibility:** one-way — database migration creating queue schema.
  - Clinical mutations (booking appointments, rescheduling, signing prescriptions) insert an outbox row transactionally. Columns: `id`, `tenant_id`, `patient_id`, `channel`, `message_type`, `template_id`, `template_params`, `recipient_phone`, `status` (`pending`, `processing`, `sent`, `failed`, `dead_letter`), `retry_count`, `next_retry_at`, `error_message`, `sent_at`. Clinical staff never wait on external network calls.
- **D-03: Dual-Trigger Queue Dispatcher:** — **Reversibility:** reversible — execution pipeline.
  - Immediate async dispatch via Next.js background execution (`after()` or non-blocking async route) for sub-second delivery during normal operations, backed by a scheduled cron endpoint (`/api/cron/dispatch-communications`) invoked every 1–2 minutes to recover from provider outages and process retries.
- **D-04: Communication Auditing via Generic `audit_logs`:** — **Reversibility:** costly — event schema.
  - Instead of a redundant standalone communication table, log message dispatch and delivery status into the existing `audit_logs` table (`action = 'communication_sent' | 'communication_received'`, target = patient), filterable by patient on demand, keeping database schema lean.
- **D-05: Platform-Managed Indian TRAI DLT & Meta WhatsApp Templates:** — **Reversibility:** one-way — external compliance config.
  - Platform provides verified shared DLT Entity ID, Header, and pre-approved HSM templates (`appointment_booked`, `appointment_rescheduled`, `document_ready`, `follow_up_due`, etc.) with parameterized slots (`patient_name`, `doctor_name`, `datetime`, `link`). Clinics use platform templates out of the box with zero paperwork friction.

### 2. Notification Governance & Master 23-Event Catalogue
- **D-06: Two-Tier Governance Model (Company Master vs Clinic Preferences):** — **Reversibility:** one-way — database schema `tenant_messaging_config`.
  - Master policy in DB controls event availability, permitted channels, monthly message budgets, rate limits, and fallback rules. Clinics customize only within explicitly permitted boundaries (e.g. toggling optional alerts, choosing manual vs auto for eligible events).
  - Precedence: Company Master Policy → Clinic Configuration → Patient Preferences & Consent → Event Eligibility → Delivery Decision.
- **D-07: Master 23-Event Catalogue Policy:** — **Reversibility:** costly — workflow dispatch across the app.
  - **Patient Lifecycle:**
    - Event 1 (Appointment Booked): Auto WhatsApp, conditional SMS fallback.
    - Event 2 (Appointment Rescheduled): Auto WhatsApp, conditional SMS fallback.
    - Event 3 (Appointment Cancelled): Auto WhatsApp for clinic-initiated cancellation; acknowledge patient-initiated if not already confirmed.
    - Event 4 (Appointment Reminder): Configurable reminder; default to 24 hours before the appointment. Suppressed if cancelled, completed, or already checked in.
    - Event 5 (Waitlist Slot Opening): In-app alert for staff; patient outreach is staff-driven.
  - **Clinical & Documents:**
    - Event 6 (Prescription Ready): Staff-driven 1-click "Share via WhatsApp" (optional auto if enabled by platform).
    - Event 7 (Lab Report Uploaded): Staff-driven 1-click "Share via WhatsApp".
    - Event 8 (Referral Letter Issued): Staff-driven 1-click "Share via WhatsApp".
    - Event 9 (Follow-up Due Recall): Staff-driven from "Due Follow-ups" dashboard list.
    - Event 10 (Pediatric Vaccine Due): Staff-driven from Pediatrics register.
  - **Billing & Payments:**
    - Event 11 (Invoice / Receipt Issued): Staff-driven receipt sharing.
    - Event 12 (Outstanding Balance Alert): Manual, polite reminder from Billing register.
  - **Doctor Cabin (100% In-App):**
    - Events 13–16 (Patient Arrived, Vitals Recorded, Lab Report Ready, Schedule Block Conflict): Auto in-app badges, toasts, and cabinet notifications. Zero external messaging cost.
  - **Front Desk & Queue (100% In-App):**
    - Events 17–19 (Waitlist Slot Freed, Inbound WhatsApp Reply, No-Show Alert): Auto in-app banner and Bell alerts.
  - **Admin & System (100% In-App):**
    - Events 20–23 (Staff Invite Accepted, Quota Warning, End-of-Day Digest, Outbox Failure Alert): Auto in-app alerts with retry controls.
- **D-08: Document Delivery via Secure Tokenized Links:** — **Reversibility:** reversible — URL schema.
  - All shared documents (prescriptions, lab reports, receipts, referrals) deliver as secure tokenized links (`/r/[token]`) using the Phase 4 storage adapter. Avoids costly WhatsApp media uploads and bandwidth issues. Multiple ready documents are consolidated into one message where practical.
- **D-09: Strict Conditional SMS Fallback:** — **Reversibility:** reversible — fallback logic.
  - Only Appointment Booked and Appointment Rescheduled qualify for SMS fallback if WhatsApp delivery fails. All document links, follow-ups, and reminders remain WhatsApp-only. SMS fallback is deduplicated to prevent duplicates if WhatsApp was merely delayed.
- **D-10: Platform-Enforced Quiet Hours:** — **Reversibility:** reversible — queue dispatch filter.
  - Non-critical automated notifications (recalls, reminders) are held during 9:00 PM to 8:00 AM and dispatched after 8:00 AM. Urgent booking confirmations created during this window send immediately.
- **D-11: Patient Communication Preferences at Registration:** — **Reversibility:** reversible — UI form and patient columns.
  - Form captures Language Preference (English / Marathi, defaulting to clinic primary) and "Receive WhatsApp updates" toggle (defaulting to enabled, with opt-out keyword "STOP" support). Parent/guardian contact supported for pediatric patients.
- **D-12: 100% In-App Notification Center UI:** — **Reversibility:** costly — layout and navigation shell.
  - Top navigation Bell icon with unread badge counter + slide-over drawer + contextual toasts. Surfaces internal clinic events (patient arrivals, vitals ready, waitlist openings, inbound WhatsApp replies, quota warnings) in real time with 1-click jump actions.

### 3. Two-Way WhatsApp Bot & Front-Desk Handover
- **D-13: Interactive WhatsApp Reply Buttons:** — **Reversibility:** costly — WhatsApp HSM template definitions.
  - Outgoing appointment messages feature interactive buttons (`[Confirm]`, `[Cancel]`, `[Reschedule]`) with numeric fallback (`1`, `2`, `3`). Eliminates typing typos and deterministic intent parsing.
- **D-14: Immediate Cancellation Execution:** — **Reversibility:** costly — appointment lifecycle.
  - Selecting `[Cancel]` immediately updates the appointment to `cancelled` (`cancellation_reason: 'patient_whatsapp_bot'`), releases the doctor's calendar slot, triggers an in-app Waitlist Alert to front desk, and replies with a clean cancellation acknowledgement and clinic phone number.
- **D-15: Reschedule via Tokenized Web Link + Front-Desk Notification:** — **Reversibility:** reversible — reschedule flow.
  - Selecting `[Reschedule]` replies with a tokenized mobile link (`/reschedule/[token]`) allowing the patient to pick a new available slot with Dr. X, and simultaneously creates an in-app alert for the front desk to follow up by phone if needed.
- **D-16: Conversational / Unhandled Reply Handover:** — **Reversibility:** reversible — webhook handling.
  - Unhandled text or questions receive an automated polite template reply: *"We received your message. For urgent queries please call [Clinic Phone]. Our front desk will follow up shortly during clinic hours."* Simultaneously creates an in-app alert (Event #18) with the exact message text in the front desk's notification drawer.

### 4. AI Assist Clinical UX & Universal AI Gateway
- **D-17: Universal OpenAI-Compatible AI Gateway (`lib/ai/`):** — **Reversibility:** one-way — AI architecture across app.
  - AI client in `lib/ai/` standardizes on the OpenAI REST specification (`baseURL`, `apiKey`, `model`). Can switch seamlessly between OpenAI, Google Gemini (via Gemini's OpenAI-compatible endpoint), Anthropic Claude (via proxy/OpenRouter), Groq, DeepSeek, or local models via environment variables (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL_NAME`). Includes `MockAiProvider` for local dev/testing.
- **D-18: Dedicated AI Dictation / Quick Notes Tool in Consultation:** — **Reversibility:** costly — consultation workspace UI.
  - Dedicated tool in Consultation Cabin where the doctor types shorthand or dictates via mic (Web Speech API). Clicking "Generate SOAP" produces structured Chief Complaints, Exam, and Advice drafts with an explicit "AI Suggested" visual badge and a 1-click "Accept & Insert" button into the consultation.
- **D-19: On-Demand Returning Patient Catch-Up Summary:** — **Reversibility:** reversible — consultation header widget.
  - Compact banner in Consultation header ("Returning patient — last seen 14 days ago [Generate AI Catch-Up]") that generates a 3-bullet clinical summary on demand, preventing automatic LLM token waste on routine check-ups.
- **D-20: Deterministic Historical Prescription Suggestions:** — **Reversibility:** costly — prescription editor integration.
  - When a diagnosis is added, the system runs an aggregated SQL query over the doctor's own past signed prescriptions (`visits.prescription` where `doctor_id = current_user.id`) to display "Frequently Prescribed by You for [Diagnosis]" chips. 1-click adds the exact dose/schedule with zero LLM hallucination risk.
- **D-21: Deterministic Scheduling Statistics:** — **Reversibility:** reversible — booking drawer UI.
  - Calculates doctor average consultation duration and patient no-show rate directly from database history, displaying an informational badge in the Booking Drawer ("Recommended slot: 20 mins").

### the agent's Discretion
- Database schema names for `communication_queue` and `tenant_messaging_config`.
- Implementation details of the in-app notification bell, unread counter badge, and slide-over drawer styling conforming strictly to `DESIGN.md`.
- Exponential backoff retry intervals for the outbox queue (e.g. 1m, 5m, 15m, 60m).
- Exact phrasing of approved SMS/WhatsApp HSM notification templates in English and Marathi.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product & Requirements
- `docs/clinic-management-prd.md` §4.8 (Reminders & Notifications), §4.11 (AI Features), §5.5 (Reliability & Provider Outage Tolerance) — Core requirements.
- `.planning/REQUIREMENTS.md` (`REQ-reminders-notifications`, `REQ-ai-features`) — Requirement definitions and traceability notes.
- `.planning/phases/05-communications-ai-assist/05-DISCUSS-CHECKPOINT.json` — Detailed discussion transcript and decision audit.

### Engineering & Architecture
- `AGENTS.md` §5 (Technology Stack), §7 (Multi-Tenancy), §9 (Healthcare Data), §12 (Error Handling), §20 (Notifications & Background Jobs), §40 (AI Guidelines), §41 (External Integrations & Provider Abstractions) — Mandatory architectural rules.
- `DESIGN.md` — Canonical design system: Light theme tokens, #1769E0 primary brand color, TailAdmin components, badges, and notification drawer primitives.

### Existing System Implementations
- `lib/storage/` — Established provider abstraction pattern (`types.ts`, `index.ts`, concrete providers) to replicate in `lib/messaging/` and `lib/ai/`.
- `lib/auth/dev-logger.ts` — Established dev-logging pattern to replicate in `lib/messaging/dev-logger.ts` and `lib/ai/mock-provider.ts`.
- `supabase/migrations/000006_appointments_queue_waitlist.sql` — `waitlist_entries` schema and queue mechanisms.
- `supabase/migrations/000007_consultation_prescriptions_cdci.sql` — `follow_ups` schema, `visits.prescription` structure, and consultation workspace data models.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/storage/index.ts` & `lib/storage/types.ts`: Provider abstraction pattern with environment variable switching.
- `lib/auth/dev-logger.ts`: Terminal and file logging mechanism for development environments.
- `components/ui/`: Existing modal, drawer, badge, button, and card primitives matching `DESIGN.md`.
- `features/prescriptions/` & `features/labs/`: Tokenized document URL generation and signed PDF access endpoints.

### Established Patterns
- Multi-tenant Row Level Security (RLS) on all tenant-owned tables (`tenant_id = auth.jwt() -> 'app_metadata' ->> 'tenant_id'`).
- Generic audit logging in `public.audit_logs` capturing actor, tenant, action, and JSON metadata.
- TailAdmin light-only styling with clean badges and responsive mobile layout.

### Integration Points
- **Top Navigation Bar (`app/(dashboard)/layout.tsx`):** Mounting point for the In-App Notification Bell and slide-over Drawer.
- **Consultation Workspace (`features/consultation/` & `app/(dashboard)/cabin/`):** Embedding the AI Dictation / Quick Notes tool, Returning Patient Catch-Up summary banner, and Historical Rx chips.
- **Booking Drawer & Calendar (`features/queue/` & `app/(dashboard)/calendar/`):** Displaying scheduling duration assist badges and handling slot cancellation releases.
- **Appointment Services (`features/appointments/services.ts`):** Central domain logic for booking, rescheduling, and cancellation consumed by both the WhatsApp bot in Phase 5 and the future external REST API in Phase 6.

</code_context>

<specifics>
## Specific Ideas

- **CliniQ AI Notification Management Policy:** The 23-event master catalogue and two-tier governance model defined in user decisions must be strictly respected. CliniQ AI controls the master policy; clinics have restricted customization; patients retain communication choices.
- **Downstream Phase 6 Contract:** Services for querying available slots, booking appointments, cancelling slots, and rescheduling must be cleanly modularized so that Phase 6 can expose them via tenant API keys for external AI Voice Agents without refactoring.
- **Medical Safety:** AI outputs must never overwrite existing notes or auto-finalize prescriptions. Prescription suggestions are sourced strictly from the doctor's verified past prescriptions to ensure zero hallucination risk.

</specifics>

<deferred>
## Deferred Ideas

- **Phase 6 Scope (External AI Voice Agent REST API):** Dedicated REST API endpoints with tenant-scoped API keys (`REQ-api-access`) and outbound webhooks for third-party call bots and external voice receptionists.
- **Superadmin Console Web Portal:** Dedicated multi-tenant company administrative UI for managing global message policies and provider billing rates (master DB policy and schemas implemented in Phase 5; dedicated UI portal built in later milestone).
- **Online Payment Gateway:** Payment gateway integration for online collection of outstanding balances via WhatsApp links (currently manual recording of cash/UPI/card).

</deferred>

---

*Phase: 5-Communications & AI Assist*  
*Context gathered: 2026-10-26*
