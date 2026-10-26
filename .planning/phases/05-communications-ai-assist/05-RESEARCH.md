# Phase 5: Communications & AI Assist - Research

**Date:** 2026-10-26  
**Phase:** 05-Communications & AI Assist  
**Status:** Complete  
**Objective:** Answer *"What do I need to know to PLAN this phase well?"*

---

<user_constraints>
## User Constraints & Decisions (from CONTEXT.md)

### 1. Messaging Architecture & Outbox Queue
- **D-01: Multi-Provider Messaging Abstraction with DevLogger.** Abstract interface `MessagingProvider` (`sendSms`, `sendWhatsApp`) implemented by `DevLoggerProvider` (logs to server console and `.planning/dev-messages.txt` in dev/test, mirroring `lib/auth/dev-logger.ts`) and production adapters for Twilio, Gupshup, and MSG91 selected via environment variables (`MESSAGING_PROVIDER`).
- **D-02: Resilient Outbox Queue Table (`communication_queue`).** Clinical mutations (booking appointments, rescheduling, signing prescriptions) insert an outbox row transactionally. Clinical staff never wait on external network calls. Statuses: `pending`, `processing`, `sent`, `failed`, `dead_letter`.
- **D-03: Dual-Trigger Queue Dispatcher.** Immediate async dispatch via Next.js background execution (`after()` or non-blocking async fetch) for sub-second delivery during normal operations, backed by a scheduled cron endpoint (`/api/cron/dispatch-communications`) invoked every 1–2 minutes to recover from provider outages and process exponential backoff retries.
- **D-04: Communication Auditing via Generic `audit_logs`.** Log message dispatch and delivery status into the existing `audit_logs` table (`action = 'communication_sent' | 'communication_received'`, target = patient), filterable on demand, keeping database schema lean.
- **D-05: Platform-Managed Indian TRAI DLT & Meta WhatsApp Templates.** Platform provides verified shared DLT Entity ID, Header, and pre-approved HSM templates (`appointment_booked`, `appointment_rescheduled`, `document_ready`, `follow_up_due`, etc.) with parameterized slots (`patient_name`, `doctor_name`, `datetime`, `link`). Clinics use platform templates out of the box with zero paperwork friction.

### 2. Notification Governance & Master 23-Event Catalogue
- **D-06: Two-Tier Governance Model (Company Master vs Clinic Preferences).** Master policy in DB (`tenant_messaging_config`) controls event availability, permitted channels, monthly message budgets, rate limits, and fallback rules. Clinics customize only within explicitly permitted boundaries. Precedence: Company Master Policy → Clinic Configuration → Patient Preferences & Consent → Event Eligibility → Delivery Decision.
- **D-07: Master 23-Event Catalogue Policy.**
  - **Patient Lifecycle:** Booked (Auto WA, conditional SMS fallback), Rescheduled (Auto WA, conditional SMS fallback), Cancelled (Auto WA for clinic-initiated; ack patient-initiated), Reminder (Configurable; default 24h before; suppressed if cancelled/completed/checked-in), Waitlist Slot Opening (In-app alert for staff; outreach staff-driven).
  - **Clinical & Documents:** Prescription Ready (Staff-driven 1-click WA), Lab Report Uploaded (Staff-driven 1-click WA), Referral Letter Issued (Staff-driven 1-click WA), Follow-up Due Recall (Staff-driven from register), Pediatric Vaccine Due (Staff-driven from register).
  - **Billing & Payments:** Invoice / Receipt Issued (Staff-driven receipt sharing), Outstanding Balance Alert (Manual, polite payment reminder).
  - **Doctor Cabin (100% In-App):** Patient Arrived, Vitals Recorded, Lab Report Ready, Schedule Block Conflict — Auto in-app badges, toasts, and cabinet notifications. Zero external messaging cost.
  - **Front Desk & Queue (100% In-App):** Waitlist Slot Freed, Inbound WhatsApp Reply, No-Show Alert — Auto in-app banner and Bell alerts.
  - **Admin & System (100% In-App):** Staff Invite Accepted, Monthly Quota Warning, End-of-Day Digest, Outbox Failure Alert — Auto in-app alerts with retry controls.
- **D-08: Document Delivery via Secure Tokenized Links.** All shared documents (prescriptions, lab reports, receipts, referrals) deliver as secure tokenized links (`/r/[token]`) using the Phase 4 storage adapter. Multiple ready documents are consolidated into one message where practical.
- **D-09: Strict Conditional SMS Fallback.** Only Appointment Booked and Appointment Rescheduled qualify for SMS fallback if WhatsApp delivery fails. All document links, follow-ups, and reminders remain WhatsApp-only. SMS fallback is deduplicated.
- **D-10: Platform-Enforced Quiet Hours.** Non-critical automated notifications (recalls, reminders) are held during 9:00 PM to 8:00 AM and dispatched after 8:00 AM. Urgent booking confirmations created during this window send immediately.
- **D-11: Patient Communication Preferences at Registration.** Form captures Language Preference (English / Marathi, defaulting to clinic primary) and "Receive WhatsApp updates" toggle (defaulting to enabled, with opt-out keyword "STOP" support). Parent/guardian contact supported for pediatric patients.
- **D-12: 100% In-App Notification Center UI.** Top navigation Bell icon with unread badge counter + slide-over drawer + contextual toasts. Surfaces internal clinic events in real time with 1-click jump actions.

### 3. Two-Way WhatsApp Bot & Front-Desk Handover
- **D-13: Interactive WhatsApp Reply Buttons.** Outgoing appointment messages feature interactive buttons (`[Confirm]`, `[Cancel]`, `[Reschedule]`) with numeric fallback (`1`, `2`, `3`).
- **D-14: Immediate Cancellation Execution.** Selecting `[Cancel]` immediately updates the appointment to `cancelled` (`cancellation_reason: 'patient_whatsapp_bot'`), releases the doctor's calendar slot, triggers an in-app Waitlist Alert to front desk, and replies with a clean cancellation acknowledgement and clinic phone number.
- **D-15: Reschedule via Tokenized Web Link + Front-Desk Notification.** Selecting `[Reschedule]` replies with a tokenized mobile link (`/reschedule/[token]`) allowing the patient to pick a new available slot with Dr. X, and simultaneously creates an in-app alert for the front desk to follow up by phone if needed.
- **D-16: Conversational / Unhandled Reply Handover.** Unhandled text or questions receive an automated polite template reply and simultaneously create an in-app alert (Event #18) with the exact message text in the front desk's notification drawer.

### 4. AI Assist Clinical UX & Universal AI Gateway
- **D-17: Universal OpenAI-Compatible AI Gateway (`lib/ai/`).** AI client in `lib/ai/` standardizes on the OpenAI REST specification (`baseURL`, `apiKey`, `model`). Can switch seamlessly between OpenAI, Google Gemini, Anthropic Claude (via OpenRouter/proxy), Groq, DeepSeek, or local models via environment variables (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL_NAME`). Includes `MockAiProvider` for local dev/testing.
- **D-18: Dedicated AI Dictation / Quick Notes Tool in Consultation.** Dedicated tool in Consultation Cabin where the doctor types shorthand or dictates via mic (Web Speech API). Clicking "Generate SOAP" produces structured Chief Complaints, Exam, and Advice drafts with an explicit "AI Suggested" visual badge and a 1-click "Accept & Insert" button into the consultation.
- **D-19: On-Demand Returning Patient Catch-Up Summary.** Compact banner in Consultation header ("Returning patient — last seen 14 days ago [Generate AI Catch-Up]") that generates a 3-bullet clinical summary on demand, preventing automatic LLM token waste on routine check-ups.
- **D-20: Deterministic Historical Prescription Suggestions.** Aggregated SQL query over the doctor's own past signed prescriptions (`visits.prescription` where `doctor_id = current_user.id`) to display "Frequently Prescribed by You for [Diagnosis]" chips. 1-click adds the exact dose/schedule with zero LLM hallucination risk.
- **D-21: Deterministic Scheduling Statistics.** Calculates doctor average consultation duration and patient no-show rate directly from database history, displaying an informational badge in the Booking Drawer.
</user_constraints>

---

<phase_requirements>
## Phase Requirements Traceability

| Requirement ID | PRD Scope & Definition | Phase 5 Delivery Mapping |
|---|---|---|
| **REQ-reminders-notifications** | Configurable SMS/WhatsApp reminders for upcoming appointments; outbox queue with retry; two-way bot reply handling (Confirm, Cancel, Reschedule) releasing calendar slots on cancellation; in-app notification center for clinic events. *(PRD §4.6)* | **1. Multi-Provider & Outbox (`lib/messaging/`):** Unified provider interface with `DevLogger` fallback + production drivers; `communication_queue` table with exponential backoff and dual-trigger execution (`after()` + cron).<br>**2. Master 23-Event Governance:** Company Master Policy in `tenant_messaging_config` > Clinic Preferences. Internal 11 events 100% in-app (zero cost); conditional SMS fallback on Booked/Rescheduled only.<br>**3. Two-Way WhatsApp Bot:** Interactive reply buttons (`[Confirm]`, `[Cancel]`, `[Reschedule]`), instant calendar slot release + audit log, tokenized self-service reschedule link, and conversational front-desk handover.<br>**4. In-App Notification Center:** Top-nav Bell icon, unread counter pill, slide-over drawer, and real-time alerts. |
| **REQ-ai-features** | Clinical AI summarization (SOAP note generation from shorthand/dictation); returning patient history catch-up summary; deterministic historical prescription suggestions (sourcing exclusively from doctor's own past signed prescriptions); pluggable AI gateway conforming to OpenAI REST spec. *(PRD §4.8)* | **1. Universal AI Gateway (`lib/ai/`):** Standard OpenAI REST specification (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL_NAME`) + `MockAiProvider`.<br>**2. Consultation AI Scribe:** Web Speech API dictation + shorthand textarea generating structured SOAP notes with Zod validation, "AI Suggested" badges, and 1-click "Accept & Insert".<br>**3. Returning Patient Catch-Up:** On-demand 3-bullet clinical summary banner in consultation header.<br>**4. Deterministic Rx Chips:** Zero-hallucination SQL aggregation over doctor's own past signed prescriptions by diagnosis.<br>**5. Deterministic Stats:** Average visit duration and no-show rate in booking drawer. |
</phase_requirements>

---

## 1. Messaging Architecture & Provider Abstraction (`lib/messaging/`)

### 1.1 Design Goals
1. **Zero Clinical Workflow Blocking:** Inserting an outbox record into `communication_queue` takes < 5ms within the same database transaction as the appointment booking or prescription signing. Clinical users never wait on external network calls.
2. **Deterministic Dev/Test Experience:** By default (`MESSAGING_PROVIDER=dev`), all outbound SMS and WhatsApp messages are logged to the console and appended to `.planning/dev-messages.txt` with formatted banners containing recipient, channel, template, parameters, and simulated reply links.
3. **Multi-Vendor Interchangeability:** Production drivers (Twilio, Gupshup, MSG91) conform to the exact same TypeScript contract. Switching providers requires only updating `.env`.
4. **Resilient Dual-Trigger Delivery:**
   - **Trigger 1 (Real-time Async):** Triggered immediately via Next.js 15 `after()` API or background async execution for < 1s message delivery during normal operations.
   - **Trigger 2 (Cron Recovery):** Secured route `/api/cron/dispatch-communications` (invoked every 1-2 minutes by pg_cron or Vercel Cron) queries for pending or due retries, handling provider outages and transient network failures with exponential backoff.

### 1.2 Messaging Interface Contract (`lib/messaging/types.ts`)
```typescript
export type MessagingChannel = "whatsapp" | "sms" | "in_app";

export interface OutboundMessagePayload {
  tenantId: string;
  patientId?: string;
  recipientPhone: string;
  channel: "whatsapp" | "sms";
  templateId: string;
  templateParams: Record<string, string>;
  language?: "en" | "mr";
  fallbackToSms?: boolean;
  metadata?: Record<string, unknown>;
}

export interface MessagingSendResult {
  success: boolean;
  externalMessageId?: string;
  channelUsed: "whatsapp" | "sms";
  error?: string;
  statusCode?: number;
}

export interface MessagingProvider {
  name: "dev" | "msg91" | "twilio" | "gupshup";
  sendSms(to: string, templateId: string, params: Record<string, string>): Promise<MessagingSendResult>;
  sendWhatsApp(to: string, templateId: string, params: Record<string, string>, buttons?: Array<{ id: string; text: string }>): Promise<MessagingSendResult>;
}
```

### 1.3 Provider Implementations
- **`DevLoggerProvider` (`lib/messaging/dev-logger.ts`):**
  - Mimics `lib/auth/dev-logger.ts`.
  - Formats output with ANSI borders, outputs to `console.log`, and appends to `.planning/dev-messages.txt`.
  - For WhatsApp messages with interactive buttons, logs simulated webhook callback URLs (e.g. `http://localhost:3000/api/webhooks/messaging/dev?action=confirm&appointment_id=...`) to allow 1-click testing of two-way bot replies in browser!
- **`Msg91Provider` (`lib/messaging/providers/msg91.ts`):**
  - Uses MSG91 Flow API for SMS (`https://control.msg91.com/api/v5/flow/`) with Indian DLT template IDs.
  - Uses MSG91 WhatsApp API (`https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/`) with verified Meta templates.
- **`TwilioProvider` (`lib/messaging/providers/twilio.ts`):**
  - Uses Twilio REST API for SMS (`/2010-04-01/Accounts/{AccountSid}/Messages.json`).
  - Uses Twilio WhatsApp Messaging API (`whatsapp:+14155238886` to `whatsapp:+91...`).
- **`GupshupProvider` (`lib/messaging/providers/gupshup.ts`):**
  - Uses Gupshup Enterprise WhatsApp Messaging API (`https://api.gupshup.io/sm/api/v1/msg`).
- **Factory (`lib/messaging/index.ts`):**
  - Checks `process.env.MESSAGING_PROVIDER` (defaults to `"dev"` if not configured or in test).

---

## 2. Database Schema & Migration (`000014_communications_and_ai.sql`)

### 2.1 Outbox Queue: `public.communication_queue`
```sql
CREATE TABLE IF NOT EXISTS public.communication_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
    appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
    channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'in_app')),
    message_type TEXT NOT NULL, -- e.g. 'appointment_booked', 'appointment_reminder', etc.
    template_id TEXT NOT NULL,
    template_params JSONB NOT NULL DEFAULT '{}',
    recipient_phone TEXT,
    recipient_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled', 'dead_letter')) DEFAULT 'pending',
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    error_message TEXT,
    external_message_id TEXT,
    sent_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comm_queue_dispatch 
ON public.communication_queue (status, next_retry_at) 
WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_comm_queue_tenant 
ON public.communication_queue (tenant_id, created_at DESC);
```

### 2.2 Tenant Messaging Policy: `public.tenant_messaging_config`
```sql
CREATE TABLE IF NOT EXISTS public.tenant_messaging_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE,
    whatsapp_enabled BOOLEAN NOT NULL DEFAULT true,
    sms_enabled BOOLEAN NOT NULL DEFAULT true,
    monthly_quota INTEGER NOT NULL DEFAULT 200,
    messages_sent_this_month INTEGER NOT NULL DEFAULT 0,
    quota_warning_threshold INTEGER NOT NULL DEFAULT 160, -- 80% of quota
    quota_warning_sent_at TIMESTAMPTZ,
    quiet_hours_enabled BOOLEAN NOT NULL DEFAULT true,
    quiet_hours_start TIME NOT NULL DEFAULT '21:00',
    quiet_hours_end TIME NOT NULL DEFAULT '08:00',
    auto_prescription_share BOOLEAN NOT NULL DEFAULT false, -- Default staff-driven
    auto_lab_share BOOLEAN NOT NULL DEFAULT false,
    auto_receipt_share BOOLEAN NOT NULL DEFAULT false,
    auto_reminder_hours INTEGER NOT NULL DEFAULT 24, -- 24 hours prior
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.3 In-App Notification Center: `public.in_app_notifications`
```sql
CREATE TABLE IF NOT EXISTS public.in_app_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    recipient_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- NULL for clinic-wide/role-based
    recipient_role TEXT CHECK (recipient_role IN ('doctor', 'receptionist', 'admin', 'owner', 'nurse')),
    category TEXT NOT NULL CHECK (category IN ('clinical', 'queue', 'billing', 'system')),
    event_type TEXT NOT NULL, -- e.g. 'patient_checked_in', 'waitlist_slot_freed', etc.
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    link_url TEXT,
    is_read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_in_app_notifs_user 
ON public.in_app_notifications (tenant_id, recipient_user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_in_app_notifs_role 
ON public.in_app_notifications (tenant_id, recipient_role, is_read, created_at DESC);
```

### 2.4 Patient Communication Preferences Extension
```sql
ALTER TABLE public.patients
ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'mr')),
ADD COLUMN IF NOT EXISTS whatsapp_opt_out BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS guardian_name TEXT,
ADD COLUMN IF NOT EXISTS guardian_phone TEXT,
ADD COLUMN IF NOT EXISTS guardian_relationship TEXT;
```

### 2.5 Polymorphic Document Share Tokens Extension
```sql
-- Allow document_share_tokens to reference prescriptions, receipts, and referrals alongside patient_documents
ALTER TABLE public.document_share_tokens
ALTER COLUMN document_id DROP NOT NULL,
ADD COLUMN IF NOT EXISTS resource_type TEXT NOT NULL DEFAULT 'patient_document' 
  CHECK (resource_type IN ('patient_document', 'prescription', 'invoice', 'referral')),
ADD COLUMN IF NOT EXISTS resource_id UUID;
```

---

## 3. Two-Tier Notification Governance & Master 23-Event Catalogue

### 3.1 Precedence Resolution Engine (`lib/messaging/governance.ts`)
Before any message is enqueued or dispatched:
```
1. Company Master Policy
   ↳ Is event disabled globally? If yes → SUPPRESS
   ↳ Is requested channel allowed globally? If no → DOWNGRADE (e.g. WhatsApp → In-App)
   ↳ Is clinic at/over monthly quota? If yes & non-essential → SUPPRESS & create In-App Event #21
2. Clinic Configuration (tenant_messaging_config)
   ↳ Is event disabled by clinic? If yes → SUPPRESS
   ↳ Is delivery mode manual/staff-driven? If manual & auto-triggered → SUPPRESS
3. Patient Preferences & Consent
   ↳ Did patient opt out of WhatsApp (whatsapp_opt_out = true)? If yes → Fallback to SMS if eligible, else In-App alert
   ↳ Preferred language: 'mr' (Marathi) vs 'en' (English) → Select template variant
4. Quiet Hours Filter
   ↳ Is current time between 21:00 and 08:00 IST?
   ↳ Is message non-urgent (e.g. Reminder, Due Recall)? If yes → Delay `next_retry_at` to 08:01 IST
5. Execution Decision
   ↳ Insert into communication_queue with resolved channel and template.
```

### 3.2 Master 23-Event Catalogue Breakdown

| # | Event Name | Category | Primary Channel | Fallback Channel | Mode | Business Rule |
|---|------------|----------|-----------------|------------------|------|---------------|
| 1 | Appointment Booked | Patient | WhatsApp | SMS (conditional) | Auto | Triggers on booking. SMS fallback only if WhatsApp send fails. |
| 2 | Appointment Rescheduled | Patient | WhatsApp | SMS (conditional) | Auto | Triggers on reschedule. Includes new date/time & doctor name. |
| 3 | Appointment Cancelled | Patient | WhatsApp | None | Auto / Ack | Auto for clinic-initiated; polite ack if patient initiated via web. |
| 4 | Appointment Reminder | Patient | WhatsApp | None | Auto (24h) | Suppressed if appointment is cancelled, completed, or checked-in. |
| 5 | Waitlist Slot Opening | Front Desk | In-App | None | Auto | Alerts reception when slot opens; patient call/WhatsApp is staff-driven. |
| 6 | Prescription Ready | Patient | WhatsApp | None | Staff-driven | 1-click button on consultation/visit view; tokenized link `/r/[token]`. |
| 7 | Lab Report Uploaded | Patient | WhatsApp | None | Staff-driven | 1-click button on `/patients/[id]` lab records tab. |
| 8 | Referral Letter Issued | Patient | WhatsApp | None | Staff-driven | 1-click button on `/referrals` register or consultation. |
| 9 | Follow-up Due Recall | Patient | WhatsApp | None | Staff-driven | Staff clicks "Send Recall" from Due Follow-ups register. |
| 10 | Pediatric Vaccine Due | Patient | WhatsApp | None | Staff-driven | Staff clicks "Send Vaccine Reminder" from Pediatrics register. |
| 11 | Invoice / Receipt Issued | Patient | WhatsApp | None | Staff-driven | 1-click button from Billing register. |
| 12 | Outstanding Balance Alert| Patient | WhatsApp | None | Manual | Polite payment reminder sent manually by billing staff. |
| 13 | Patient Arrived / Checked-In | Doctor | In-App | None | Auto | In-app notification to doctor; badge on consultation cabin queue. |
| 14 | Vitals Recorded by Nurse | Doctor | In-App | None | Auto | Updates patient queue card in doctor cabin to "Vitals Ready". |
| 15 | New Lab Report Ready | Doctor | In-App | None | Auto | In-app notification when report uploaded for active or recent patient. |
| 16 | Schedule Block Conflict | Doctor/Admin | In-App | None | Auto | Instant warning in calendar drawer when creating conflicting block. |
| 17 | Slot Freed (Waitlist Alert) | Front Desk | In-App | None | Auto | Banner alert when cancellation frees an overbooked/waitlisted slot. |
| 18 | Inbound WhatsApp Reply | Front Desk | In-App | None | Auto | Alerts front desk with incoming message text and patient context. |
| 19 | Appointment No-Show Alert | Front Desk | In-App | None | Auto | Queue badge flagged after configured grace period (e.g. 30 mins). |
| 20 | Staff Invite Accepted | Owner | In-App | None | Auto | In-app notification when invited staff registers. |
| 21 | Monthly Quota Warning | Owner | In-App | None | Auto | Alert triggered at 80% and 100% of messaging quota. |
| 22 | End-of-Day Clinic Digest | Owner | In-App | None | Auto | End-of-day summary card (patients seen, collections, cancellations). |
| 23 | Delivery Failure Alert | Admin | In-App | None | Auto | Surfaces dead-lettered or repeatedly failing outbox items. |

---

## 4. Two-Way WhatsApp Bot & Webhook Handover

### 4.1 Webhook Route (`app/api/webhooks/messaging/[provider]/route.ts`)
- **Signature Verification:** Validates webhook signature (Twilio auth token / Gupshup token / MSG91 auth key).
- **Interactive Button Parsing:**
  - Extracts payload / button ID: `btn_confirm`, `btn_cancel`, `btn_reschedule` or numeric equivalents (`1`, `2`, `3`).
  - Matches sender phone number to active upcoming appointment for that patient.

### 4.2 Interactive Action Handlers
1. **`[Confirm]`:**
   - Updates `appointments.status` to `confirmed`.
   - Records audit log: `action = 'appointment_confirmed_whatsapp'`.
   - Auto-replies with confirmation acknowledgement: *"Thank you! Your appointment with Dr. {doctor_name} is confirmed for {datetime}."*
2. **`[Cancel]`:**
   - Updates `appointments.status` to `cancelled`, `cancellation_reason = 'patient_whatsapp_bot'`.
   - Releases calendar slot immediately.
   - Checks waitlist: if patient waiting on waitlist, creates In-App Notification (Event #17) for front desk.
   - Records audit log: `action = 'appointment_cancelled_whatsapp'`.
   - Auto-replies: *"Your appointment has been cancelled. To book again, call {clinic_phone} or visit {clinic_url}."*
3. **`[Reschedule]`:**
   - Generates secure 24-hour tokenized reschedule link: `/reschedule/[token]`.
   - Auto-replies: *"To select a new slot with Dr. {doctor_name}, tap here: {reschedule_url}. If you prefer speaking to us, our desk will assist you shortly."*
   - Creates In-App Notification for front desk: *"Patient requested reschedule via WhatsApp."*
4. **Unhandled Conversational Text:**
   - Auto-replies with polite triage template: *"We received your message. For urgent assistance please call {clinic_phone}. Our desk will review your message shortly."*
   - Creates In-App Notification (Event #18) for front desk with verbatim text and direct link to patient profile.

---

## 5. Universal AI Gateway & Clinical Assist (`lib/ai/`)

### 5.1 Universal OpenAI-Compatible Client (`lib/ai/client.ts`)
```typescript
export interface AiClientConfig {
  baseUrl: string; // e.g. "https://api.openai.com/v1" or "https://generativelanguage.googleapis.com/v1beta/openai/"
  apiKey: string;
  model: string;   // e.g. "gpt-4o-mini", "gemini-2.0-flash", "claude-3-5-sonnet"
}

export interface SoapDraft {
  chief_complaints: Array<{ complaint: string; duration?: string; severity?: string }>;
  examination: string;
  advice: string;
}

export interface CatchUpSummary {
  last_visit_date: string;
  last_diagnosis: string;
  active_medications: string[];
  key_clinical_bullets: string[];
}
```

### 5.2 Structured Clinical SOAP Note Generator (`lib/ai/soap-generator.ts`)
- **System Prompt Rules:**
  - Strict extraction from doctor input: never hallucinate unmentioned vitals, symptoms, or diagnoses.
  - Normalizes standard Indian OPD shorthand:
    - `c/o fever 3d, throat pain` → Chief Complaints: Fever (3 days), Throat pain.
    - `o/e throat congested, chest clear` → Examination: Pharyngeal congestion, bilateral chest clear.
    - `adv pcm 650 sos, warm water gargles` → Advice: Warm salt water gargles, hydration, Paracetamol 650mg as advised.
  - Returns JSON conforming to `SoapDraftZodSchema`.
  - Validates output with Zod. If parsing fails, retries once with error feedback.
  - Includes `MockAiProvider` for local dev/testing returning deterministic, medically accurate SOAP notes.

### 5.3 Deterministic Historical Prescription Suggestions (`lib/ai/prescription-suggestions.ts`)
- **Zero-Hallucination Architecture:**
  - Never queries LLM for drug suggestions.
  - Executes direct PostgreSQL aggregation over the current doctor's own past signed prescriptions:
  ```sql
  SELECT 
    item->>'drug_name' AS drug_name,
    item->>'dosage' AS dosage,
    item->>'frequency' AS frequency,
    item->>'duration' AS duration,
    item->>'instructions' AS instructions,
    COUNT(*)::INTEGER AS frequency_count
  FROM public.visits v,
       jsonb_array_elements(v.prescription) AS item
  WHERE v.tenant_id = $1
    AND v.doctor_id = $2
    AND v.diagnosis ILIKE '%' || $3 || '%'
  GROUP BY 1, 2, 3, 4, 5
  ORDER BY frequency_count DESC
  LIMIT 6;
  ```
  - Surfaces chips: `[ Paracetamol 650mg (1-0-1, 3 days) ]`, `[ Cetirizine 10mg (0-0-1, 5 days) ]`.
  - 1-click adds the exact formulation, dose, frequency, and instructions into the prescription builder!

### 5.4 Returning Patient Catch-Up Summary (`lib/ai/catch-up-summary.ts`)
- Queries previous 3 visits for the patient under the current tenant.
- Passes structured timeline (dates, past diagnoses, prescribed drugs, lab notes) to the AI Gateway with prompt requesting a 3-bullet executive brief.
- Example output:
  - *Seen 14 days ago for Acute Bronchitis; prescribed Azithromycin 500mg and Levocetirizine.*
  - *Reported allergic to Penicillin; known hypertensive on Amlodipine 5mg.*
  - *CBC from Oct 22 showed normal leukocyte count; follow-up today for persistent dry cough.*

---

## 6. Frontend UI Components (conforming to `DESIGN.md` & `05-UI-SPEC.md`)

1. **Top-Nav Notification Bell (`components/notifications/notification-bell.tsx`):**
   - Placed in `components/layout/app-header.tsx` left of `UserDropdown`.
   - Displays unread counter badge (e.g. `3`) in brand blue `#1769E0`.
   - Clicking opens the slide-over Notification Drawer.
2. **Slide-Over Notification Drawer (`components/notifications/notification-drawer.tsx`):**
   - 400px slide-over drawer from right edge.
   - Tabs: `All`, `Clinical`, `Queue`, `Billing`.
   - "Mark all as read" button.
   - Notification item with relative timestamp, category icon, title, message, and direct jump action.
3. **Consultation Cabin AI Scribe / Dictation Tool (`components/consultation/ai-scribe-modal.tsx`):**
   - Modal dialog launched from "AI Dictate / Shorthand" button in Consultation header.
   - Web Speech API microphone toggle (`webkitSpeechRecognition`) with pulsing recording indicator.
   - Shorthand text area for doctor typing.
   - "Generate SOAP Note" button → runs Server Action.
   - Preview pane with "✦ AI Suggested" badge.
   - "Accept & Insert" button updates Chief Complaints, Examination, and Advice fields in `consultation-workspace.tsx`.
4. **Returning Patient Catch-Up Banner (`components/consultation/returning-patient-catchup.tsx`):**
   - Subtle banner in consultation workspace if patient has prior visits.
   - Button: `Generate AI Catch-Up (3 bullets)`.
   - Expands inline to show 3 bullet points with copy/reference capabilities.
5. **Historical Prescription Suggestion Chips (`components/consultation/frequent-rx-chips.tsx`):**
   - Rendered in `prescription-builder.tsx` below Diagnosis input.
   - Pill chips with medicine name + frequency + duration.
   - 1-click appends directly to the active prescription table.
6. **Public Mobile Document Viewer (`app/r/[token]/page.tsx`):**
   - Minimalist, responsive mobile web page for patient document viewing.
   - Clean clinic header (Logo, Name, Address, Phone).
   - Document title, patient name, date.
   - Embedded PDF viewer / download button.

---

## Validation Architecture & Test Strategy

### 7.1 Vitest Unit & Integration Suites
1. **`tests/messaging/messaging-provider.spec.ts`:**
   - `DevLoggerProvider`: verifies formatted logging to console and `.planning/dev-messages.txt`.
   - `Messaging Factory`: verifies provider selection via environment variables.
   - Error handling: validates graceful return on invalid recipient phone numbers.
2. **`tests/messaging/outbox-queue.spec.ts`:**
   - Enqueueing: verifies clinical mutations insert row in `communication_queue`.
   - Dual-trigger dispatcher: verifies pending messages are fetched and marked `processing` → `sent`.
   - Exponential backoff: verifies `retry_count` increments and `next_retry_at` advances on failure.
   - Quiet hours: verifies non-urgent reminders during 21:00-08:00 are deferred.
3. **`tests/messaging/two-way-bot.spec.ts`:**
   - Inbound webhook: parses `Confirm`, `Cancel`, `Reschedule` payloads.
   - Cancellation: verifies appointment status updates to `cancelled` and calendar slot is freed.
   - Waitlist notification: verifies cancellation triggers waitlist in-app alert.
   - Fallback auto-reply: verifies conversational text triggers triage template and creates in-app notification.
4. **`tests/ai/ai-gateway.spec.ts`:**
   - OpenAI REST spec compliance: verifies request payload formatting and response parsing.
   - `MockAiProvider`: verifies deterministic response structure in test environment.
   - SOAP generation: validates input shorthand converts to structured SOAP with Zod validation.
   - Deterministic prescription suggestions: verifies historical SQL query returns expected top medications for diagnosis without LLM calls.
5. **`tests/notifications/in-app-notifications.spec.ts`:**
   - Creation of internal clinic notifications (patient checked in, vitals recorded, waitlist opened).
   - Multi-tenant isolation: Tenant B users cannot see Tenant A's notifications.
   - Mark as read / mark all as read mutations.

### 7.2 Playwright E2E Test Suite (`tests/e2e/communications-ai.spec.ts`)
- Front Desk books appointment → verifies outbox entry created in `communication_queue`.
- Simulates WhatsApp confirmation delivery and patient clicking `[Cancel]`.
- Verifies appointment updates to cancelled and waitlist banner appears in queue.
- Doctor opens consultation cabin → clicks "AI Scribe" → inputs shorthand → generates SOAP note → clicks "Accept & Insert" → verifies notes populated in form.
- Doctor inputs diagnosis "Hypertension" → clicks frequent prescription chip "Amlodipine 5mg" → verifies added to prescription builder.
- Doctor signs prescription → 1-click shares via WhatsApp → verifies tokenized public link `/r/[token]` loads prescription preview.

---

## 8. Architecture & Implementation Checklist

- [ ] **Database Migration (`supabase/migrations/000014_communications_and_ai.sql`)**:
  - Create `communication_queue` table with multi-tenant RLS.
  - Create `tenant_messaging_config` table with multi-tenant RLS.
  - Create `in_app_notifications` table with multi-tenant RLS.
  - Extend `patients` with `preferred_language`, `whatsapp_opt_out`, `guardian_*`.
  - Extend `document_share_tokens` with polymorphic `resource_type` and `resource_id`.
- [ ] **Messaging Abstraction (`lib/messaging/`)**:
  - `types.ts`: TypeScript contracts for providers, payloads, and results.
  - `dev-logger.ts`: Development provider logging to console and `.planning/dev-messages.txt`.
  - `providers/`: MSG91, Twilio, and Gupshup HTTP drivers.
  - `governance.ts`: Two-tier policy and quiet hours engine.
  - `dispatcher.ts`: Async outbox processor with retry backoff.
  - `index.ts`: Factory and public dispatcher exports.
- [ ] **Two-Way Bot & Webhooks**:
  - `app/api/webhooks/messaging/[provider]/route.ts`: Webhook route handling button callbacks.
  - `app/api/cron/dispatch-communications/route.ts`: Cron recovery endpoint.
  - `app/reschedule/[token]/page.tsx`: Self-service patient reschedule interface.
  - `app/r/[token]/page.tsx` & `app/api/r/[token]/route.ts`: Public mobile document viewer.
- [ ] **In-App Notification Center (`components/notifications/`)**:
  - `notification-bell.tsx`: Header bell icon with unread badge.
  - `notification-drawer.tsx`: 400px slide-over drawer with tabs and actions.
  - `actions.ts`: Fetching, marking as read, and real-time subscription helpers.
  - Integration into `components/layout/app-header.tsx`.
- [ ] **Universal AI Gateway & Clinical Assist (`lib/ai/`)**:
  - `types.ts` & `client.ts`: OpenAI REST-compatible client + `MockAiProvider`.
  - `soap-generator.ts`: Shorthand to SOAP conversion with Zod validation.
  - `catch-up-summary.ts`: Returning patient history synthesis.
  - `prescription-suggestions.ts`: Deterministic SQL aggregation over doctor's past signed prescriptions.
  - `components/consultation/ai-scribe-modal.tsx`: Dictation & shorthand modal with Web Speech API.
  - `components/consultation/returning-patient-catchup.tsx`: Consultation header catch-up banner.
  - `components/consultation/frequent-rx-chips.tsx`: 1-click historical prescription chips.

---

## RESEARCH COMPLETE
