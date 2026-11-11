# Phase 5: Communications & AI Assist - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-26  
**Phase:** 5-Communications & AI Assist  
**Areas discussed:** Messaging Architecture & Outbox Queue, Message Triggers & Patient Notification Workflows (23-Event Catalogue), Two-Way WhatsApp Bot & Front-Desk Handover, AI Assist Clinical UX & Universal AI Gateway  

---

## Messaging Architecture & Outbox Queue

| Option | Description | Selected |
|--------|-------------|:--------:|
| Multi-provider adapter with DevLogger | Multi-provider adapter in `lib/messaging/` with DevLogger (console/file logging in dev) and pluggable Twilio / Gupshup / MSG91 drivers | ✓ |
| Single-provider driver with bypass | Single provider with simple dev bypass flag | |
| External Edge Function worker | External Supabase Edge Function managing credentials | |

**User's choice:** Multi-provider adapter with DevLogger.  
**Notes:** Replicates the clean provider pattern established in `lib/storage/` and `lib/auth/dev-logger.ts`.

---

| Option | Description | Selected |
|--------|-------------|:--------:|
| Database outbox table (`communication_queue`) | Outbox table with retry tracking, error status, and background dispatch | ✓ |
| Fire-and-forget Promise | Lightweight background Promise in Server Actions | |
| External Redis/BullMQ worker queue | Standalone Redis queue service | |

**User's choice:** Database outbox table (`communication_queue`).  
**Notes:** Ensures in-app clinical mutations (creating appointments, signing prescriptions) never wait on or fail during external provider downtime.

---

| Option | Description | Selected |
|--------|-------------|:--------:|
| Dedicated `patient_communications` table | New standalone table for communications | |
| Generic `audit_logs` table reuse | Reusing the existing `audit_logs` table with action filter | ✓ |
| Append to JSONB array column on patients | JSONB column on patient row | |

**User's choice:** Generic `audit_logs` table reuse.  
**Notes:** Keeps database schema lean while maintaining compliance auditability.

---

| Option | Description | Selected |
|--------|-------------|:--------:|
| Dual trigger (Immediate async + Cron) | Immediate background dispatch + recurring cron retry runner | ✓ |
| Scheduled cron only | Recurring schedule only (every 1-2 mins) | |
| Inline synchronous dispatch with fallback | Direct HTTP call with fallback queue | |

**User's choice:** Dual trigger (Immediate async + Cron).  
**Notes:** Provides sub-second delivery during normal operations and automatic outage recovery.

---

| Option | Description | Selected |
|--------|-------------|:--------:|
| Platform-controlled preference with DB master switches | Company has full control via DB across all clinics with abstracted access to clinics | ✓ |
| Clinic-controlled settings only | Clinics choose whatever channels they prefer | |
| WhatsApp only | Pure WhatsApp with manual SMS toggle | |

**User's choice:** Platform-controlled preference with DB master switches.  
**Notes:** Essential to protect company margins under the flat ₹999/month subscription model.

---

| Option | Description | Selected |
|--------|-------------|:--------:|
| Platform Master Config in DB | Master DB table / flags controlling quotas and channel gating | ✓ |
| Usage threshold with soft alerts | Soft warnings without hard limits | |
| Environment variable limits | Global static caps in server env vars | |

**User's choice:** Platform Master Config in DB.

---

| Option | Description | Selected |
|--------|-------------|:--------:|
| Standardized Meta-compliant template catalog | Pre-approved parameterized templates (`{{patient_name}}`, etc.) | ✓ |
| Freeform text editor for SMS | Unstructured freeform text | |
| Hardcoded system strings | Static strings with zero customization | |

**User's choice:** Standardized Meta-compliant template catalog.

---

| Option | Description | Selected |
|--------|-------------|:--------:|
| Platform-managed shared DLT / Sender ID | Platform provides approved DLT Entity, Headers, and templates | ✓ |
| Strict clinic-provided DLT | Every clinic registers their own TRAI DLT account | |

**User's choice:** Platform-managed shared DLT / Sender ID.  
**Notes:** Zero friction or paperwork for clinics; platform provides pre-approved headers and templates out of the box.

---

## Message Triggers & Patient Notification Workflows (23-Event Master Catalogue)

- Adopted CliniQ AI Notification Management Product Decisions document defining the complete 23-event master catalogue across Patient, Clinical, Billing, Doctor Cabin, Front Desk, and Admin.
- **Appointment Reminder Timing:** Default 24 hours before the appointment.
- **Conditional SMS Fallback:** Strictly limited to Appointment Booked and Appointment Rescheduled. Documents, receipts, and recalls remain WhatsApp-only.
- **Document Delivery Format:** Staff-driven 1-click "Share via WhatsApp" using secure tokenized web links (`/r/[token]`) rather than heavy media uploads.
- **Appointment Cancellation / Reschedule:** Clinic cancellations auto-notify; patient-initiated cancellations send acknowledgement; reschedules always send updated confirmation. Waitlist openings are in-app alerts for staff.
- **Follow-up & Vaccine Due Recalls:** Staff-driven from dashboard registers with 1-tap WhatsApp prompt.
- **Quiet Hours:** 9:00 PM to 8:00 AM (non-critical automated messages held until morning).
- **Patient Registration Preferences:** Language preference (English / Marathi) and WhatsApp updates toggle.
- **Internal Clinic Events:** 100% In-App via top nav Bell icon + slide-over Drawer + toasts.

---

## Two-Way WhatsApp Bot & Front-Desk Handover

| Option | Description | Selected |
|--------|-------------|:--------:|
| Interactive WhatsApp Reply Buttons | `[Confirm]`, `[Cancel]`, `[Reschedule]` buttons + numeric fallback | ✓ |
| Text keyword matching only | 1/CONFIRM, 2/CANCEL, 3/RESCHEDULE text parsing | |
| LLM natural language parser | LLM text intent parsing | |

**User's choice:** Interactive WhatsApp Reply Buttons.  
**Notes:** 100% deterministic, zero typing errors, seamless patient UX.

---

| Option | Description | Selected |
|--------|-------------|:--------:|
| Immediate cancellation execution | Auto cancel slot, release for waitlist, alert desk, send acknowledgement | ✓ |
| Two-step confirmation | Require "Reply YES" | |
| "Cancel Requested" review | Receptionist manual review | |

**User's choice:** Immediate cancellation execution.

---

| Option | Description | Selected |
|--------|-------------|:--------:|
| Tokenized Web Link + Front-Desk Alert | 1-tap mobile slot selector link + front-desk in-app alert | ✓ |
| Pure Front-Desk Handover | Desk calls patient | |
| Interactive WhatsApp bot conversation | Multi-step conversational booking | |

**User's choice:** Tokenized Web Link + Front-Desk Alert.

---

| Option | Description | Selected |
|--------|-------------|:--------:|
| Standard Handover Auto-Reply + In-App Alert | Polite auto-reply template + push alert to front desk | ✓ |
| Silent Handover | No WhatsApp reply, internal alert only | |
| AI Assistant Chatbot | Full conversational AI agent | |

**User's choice:** Standard Handover Auto-Reply + In-App Alert.  
**Notes:** Directs urgent emergencies to phone/hospital and brings message into receptionist drawer. Full voice receptionist is separate Phase 6 / future PRD scope.

---

## AI Assist Clinical UX & Universal AI Gateway

| Option | Description | Selected |
|--------|-------------|:--------:|
| Dedicated AI Dictation / Quick Notes tool | Dedicated tool in Consultation Cabin with "Generate SOAP" and "Accept & Insert" | ✓ |
| Slide-over AI Assistant drawer | Side drawer in workspace | |
| Per-field inline wand buttons | Polish buttons per text box | |

**User's choice:** Dedicated AI Dictation / Quick Notes tool in Consultation Cabin.

---

| Option | Description | Selected |
|--------|-------------|:--------:|
| On-demand 1-click summary card | Compact banner in header ("Returning patient [Generate AI Catch-Up]") | ✓ |
| Auto-generated on visit open | Generates automatically on every open | |
| Longitudinal History panel only | Inside history accordion | |

**User's choice:** On-demand 1-click summary card.  
**Notes:** Avoids burning LLM API tokens automatically on routine visits.

---

| Option | Description | Selected |
|--------|-------------|:--------:|
| Deterministic Historical Frequency chips | Query doctor's own signed prescriptions for diagnosis | ✓ |
| LLM-assisted synthesis | LLM prompts generating drug combinations | |
| Doctor protocol bundles | Manual favorite bundles | |

**User's choice:** Deterministic Historical Frequency chips.  
**Notes:** Completely eliminates LLM hallucination risk; prescription suggestions come exclusively from the doctor's verified prescribing patterns.

---

| Option | Description | Selected |
|--------|-------------|:--------:|
| Deterministic Scheduling Stats + Pluggable `lib/ai/` | DB duration/no-show stats + universal OpenAI-compatible AI gateway | ✓ |
| LLM-based scheduling assistant | LLM schedule analysis | |
| Rule-based scheduling only | Static defaults | |

**User's choice:** Deterministic Scheduling Stats + Pluggable `lib/ai/`.

---

| Option | Description | Selected |
|--------|-------------|:--------:|
| Universal OpenAI-compatible AI Gateway (`lib/ai/`) | OpenAI REST spec (`baseURL`, `apiKey`, `model`) supporting OpenAI, Gemini, Claude, Groq | ✓ |
| Vendor-locked SDK | Direct Anthropic or Google SDK coupling | |

**User's choice:** Universal OpenAI-compatible AI Gateway.  
**Notes:** Guarantees zero vendor lock-in. Switch providers by editing environment variables.

---

## the agent's Discretion

- Database schema names for `communication_queue` and `tenant_messaging_config`.
- Notification center UI components (Bell icon, badge counter, slide-over drawer) matching `DESIGN.md`.
- Exponential backoff retry intervals for the outbox queue.
- Exact phrasing of approved SMS/WhatsApp HSM notification templates in English and Marathi.

## Deferred Ideas

- **Phase 6 Scope (External AI Voice Agent REST API):** REST API endpoints with clinic-scoped API keys and webhooks for external AI Voice receptionist bots.
- **Superadmin Console Web Portal:** Dedicated multi-tenant company administrative UI for managing global message policies and provider billing rates.
- **Online Payment Gateway:** Payment gateway integration for online collection of outstanding balances via WhatsApp links.
