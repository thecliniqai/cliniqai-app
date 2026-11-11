---
phase: "05"
plan: "02"
subsystem: communications-two-way-and-sharing
tags:
  - whatsapp-bot
  - inbound-webhook
  - tokenized-sharing
  - mobile-viewer
  - appointment-reschedule
  - outbox-triggers
requires:
  - phase: "05"
    plan: "01"
provides:
  - "Inbound webhook route /api/webhooks/messaging/[provider] with signature validation supporting Twilio, Gupshup, MSG91, and dev simulator"
  - "Two-way WhatsApp interactive button handling: [Confirm], [Cancel] (releasing slot and alerting waitlist), [Reschedule], and conversational fallback triage"
  - "Public responsive mobile document viewer /r/[token] supporting patient documents, prescriptions, invoices, and referrals"
  - "Public self-service patient reschedule interface /reschedule/[token] with doctor shift slot availability and atomic mutation"
  - "23-event outbox triggers wired into appointment booking, rescheduling, cancellation, and clinical 1-click sharing actions"
  - "Vitest integration tests covering two-way bot replies, tokenized document viewer, and outbox triggers"
affects:
  - app/api/webhooks/messaging
  - app/api/r
  - app/r
  - app/api/reschedule
  - app/reschedule
  - features/appointments
  - features/prescriptions
  - features/labs
  - features/referrals
  - features/billing
  - lib/audit/audit
  - tests/messaging
tech-stack:
  added: []
  patterns:
    - "Zero-login public tokenized access pattern with 64-char hex tokens and 7-day TTL"
    - "Mobile-first responsive daylight design adhering strictly to DESIGN.md"
    - "Interactive WhatsApp webhook button dispatcher with automated receptionist alerting"
    - "Atomic slot release and waitlist opening notification upon patient self-cancellation"
key-files:
  created:
    - app/api/webhooks/messaging/[provider]/route.ts
    - app/api/r/[token]/route.ts
    - app/r/[token]/page.tsx
    - app/api/reschedule/[token]/route.ts
    - app/reschedule/[token]/page.tsx
    - tests/messaging/tokenized-sharing.spec.ts
  modified:
    - features/appointments/actions.ts
    - features/prescriptions/actions.ts
    - features/labs/actions.ts
    - features/referrals/actions.ts
    - features/billing/actions.ts
    - lib/audit/audit.ts
    - tests/messaging/two-way-bot.spec.ts
decisions:
  - "Public document viewer /r/[token] polymorphically resolves patient_documents, prescriptions, invoices, and referrals with 7-day expiration and atomic access counter"
  - "Public reschedule route /reschedule/[token] validates 24h tokens, dynamically fetches doctor shifts, and releases doctor slot immediately upon confirmation"
  - "Inbound webhook verifies cryptographic provider signatures (Twilio HMAC-SHA1, Gupshup apikey, MSG91 authkey, dev bypass)"
  - "Added sharePrescriptionViaWhatsApp, shareLabReportViaWhatsApp, shareReferralLetterViaWhatsApp, and shareReceiptViaWhatsApp Server Actions"
metrics:
  duration: 15m
  completed_date: "2026-10-27"
status: complete
commits: 3
requirements:
  - REQ-reminders-notifications
---

# Phase 05 Plan 02: Inbound Two-Way WhatsApp Bot, Public Tokenized Sharing, and 23-Event Outbox Triggers Summary

**Execution Result:** SUCCESS  
**Subsystem:** Two-Way Messaging Bot & Tokenized Patient Self-Service  
**Duration:** ~15 min  
**Completed Date:** 2026-10-27  

## Accomplishments

1. **Inbound Webhook & Interactive WhatsApp Bot Handlers (`app/api/webhooks/messaging/[provider]/route.ts`):**
   - Built webhook route supporting Twilio, Gupshup, MSG91, and `dev` simulator.
   - Enforced cryptographic signature verification (Twilio HMAC-SHA1 with `TWILIO_AUTH_TOKEN`, Gupshup API key header, MSG91 `authkey` header) returning 403 on invalid signatures.
   - Implemented interactive button action dispatching:
     - `[Confirm]`: marks appointment `confirmed`, logs audit entry, sends confirmation ack.
     - `[Cancel]`: marks appointment `cancelled` with `cancellation_reason: 'patient_whatsapp_bot'`, frees doctor's slot, alerts waitlist if patients are waiting, and sends cancellation ack.
     - `[Reschedule]`: generates 24-hour tokenized self-service link `/reschedule/[token]` and alerts front desk.
     - Conversational / unhandled messages: dispatches polite triage response and generates in-app notification with verbatim text for the front desk.

2. **Public Mobile Document Viewer (`app/r/[token]/page.tsx` + `app/api/r/[token]/route.ts`):**
   - Implemented zero-login patient document viewer with 64-hex token validation, checking 7-day expiration and revocation (returning 410 with friendly clinic notice).
   - Polymorphically resolves `patient_document` (lab reports/scans), `prescription`, `invoice`, and `referral` records.
   - Atomically increments `access_count` and updates `last_accessed_at`.
   - Generates 600-second signed URLs via `SupabaseStorageProvider`.
   - Conforms strictly to `DESIGN.md` (light theme only, daylight `#F7F6F3` canvas, 44px touch targets, clinic header, document card, embedded PDF/image preview, and download button).

3. **Public Mobile Reschedule Route (`app/reschedule/[token]/page.tsx` + `app/api/reschedule/[token]/route.ts`):**
   - Validates reschedule token linked to active appointment.
   - Loads doctor weekly schedule (`availability_schedule`), generates slots for selected dates, and filters out already booked slots.
   - Allows patient to select a new slot and click "Confirm New Time".
   - Atomically calls `rescheduleAppointment`, revokes the token, enqueues Event #2 (`appointment_rescheduled`), and generates an in-app alert for the receptionist.

4. **23-Event Outbox Triggers Wired Across Core Modules:**
   - `features/appointments/actions.ts`: Event #1 (`appointment_booked`), Event #2 (`appointment_rescheduled`), Event #3 (`appointment_cancelled`).
   - `features/prescriptions/actions.ts`: `sharePrescriptionViaWhatsApp(prescriptionId)` enqueuing Event #6 (`prescription_ready`).
   - `features/labs/actions.ts`: `shareLabReportViaWhatsApp(documentId)` enqueuing Event #7 (`lab_report_uploaded`).
   - `features/referrals/actions.ts`: `shareReferralLetterViaWhatsApp(referralId)` enqueuing Event #8 (`referral_letter_issued`).
   - `features/billing/actions.ts`: `shareReceiptViaWhatsApp(invoiceId)` enqueuing Event #11 (`receipt_issued`).
   - Updated `lib/audit/audit.ts` with WhatsApp sharing audit actions.

5. **Test Harness & Validation:**
   - 46 tests across `tests/messaging/` passing 100% cleanly.
   - Complete TypeScript verification (`npm run typecheck`) with zero errors.

## Threat Model Mitigations Verified

- **T-05-05 (Inbound Webhook Spoofing):** Cryptographic signature verification rejects unverified incoming webhooks with 403 Forbidden.
- **T-05-06 (Public Document URL Brute-Forcing):** High-entropy 64-hex tokens with 7-day TTL; expired/revoked links return 410. Access count and timestamp tracked atomically.
- **T-05-07 (Denial of Service Slot Release):** Strict phone number matching against active appointments prevents unauthorized slot manipulation.

## Commits in this Plan
- `75a9191`: `feat(05-02): inbound whatsapp bot webhook and interactive reply handlers`
- `dd34764`: `feat(05-02): public mobile reschedule and document viewer routes`
- `fe859f1`: `feat(05-02): 23-event outbox triggers for prescriptions, labs, referrals, and billing`
