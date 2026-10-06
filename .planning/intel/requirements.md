# Requirements Intel

Source doc(s): docs/clinic-management-prd.md (PRD, confidence: high)

## REQ-multi-tenancy
- source: docs/clinic-management-prd.md §4.1
- description: Each clinic is an isolated tenant with full data partitioning; multi-staff accounts with role-based permissions; clinic profile, OTP-based staff invite, and subscription/billing visibility for Owner/Admin.
- acceptance: No cross-tenant data visibility under any circumstance; roles supported: Owner/Admin, Doctor, Receptionist, Nurse; data model anticipates a doctor belonging to multiple clinic tenants in future; staff invite via phone/email with OTP onboarding; subscription status (₹1,000/month single plan, payment history, renewal date) visible to Owner/Admin.
- scope: multi-tenancy, clinic/user management

## REQ-appointment-booking
- source: docs/clinic-management-prd.md §4.2
- description: Calendar-based scheduling per doctor with configurable slots, working hours, breaks, leave/holiday blocking, multiple booking channels, and walk-in queue management.
- acceptance: Booking channels: in-app staff-side, patient self-booking link (WhatsApp/SMS), future API-driven booking; walk-in token/queue numbers shown alongside scheduled appointments in same view; appointment states: Booked, Confirmed, Checked-in, In-consultation, Completed, No-show, Cancelled, Rescheduled; automatic reminders tied to appointment lifecycle; recurring appointments supported; double-booking prevention with configurable overbooking allowance; waitlist with auto-notify on cancellation.
- scope: appointment booking, scheduling, queue

## REQ-patient-records
- source: docs/clinic-management-prd.md §4.3
- description: Unified patient profile (core EMR) with demographics, allergies, chronic conditions, family history, deduplication, search, visit history timeline, file attachments, and consent capture.
- acceptance: Deduplication on creation via name + phone + DOB fuzzy match; search by name, phone, patient ID, or (future) ABHA number; chronological filterable visit history timeline per patient; document/file attachments with tagging; consent capture for data sharing/communication required for DPDP Act compliance.
- scope: patient records, EMR

## REQ-specialty-templates
- source: docs/clinic-management-prd.md §4.4
- description: Generic core visit record applicable to any specialty, with a configuration-driven specialty template layer (structured field definitions stored as data, not hardcoded).
- acceptance: Generic core includes chief complaint, history of present illness, examination notes, vitals, diagnosis, treatment plan, prescription, follow-up date; specialty templates for General Physician, Dental, Gynaecology/Obstetrics, Pediatrics, Dermatology, Orthopedics; template system configuration-driven so new specialties can be added without a full release cycle; a clinic can select multiple specialties.
- scope: visit records, specialty templates

## REQ-e-prescriptions
- source: docs/clinic-management-prd.md §4.5
- description: E-prescription builder with India-specific drug database search, per-doctor templates, safety warnings, branding, PDF output, and auditable history.
- acceptance: Drug search covers brand + generic + salt composition; favorite/frequent prescription templates per doctor for one-tap prescribing; drug interaction and allergy warnings against patient's recorded allergy list; digital signature / clinic letterhead branding; output as shareable PDF sent automatically via WhatsApp/SMS on visit completion; prescription history searchable and re-printable, editable only with an audit trail (never silently overwritten).
- scope: e-prescriptions

## REQ-diagnosis-visit-management
- source: docs/clinic-management-prd.md §4.6
- description: Diagnosis coding with ICD-10 (ICD-11 readiness), visit types, queue-aligned visit workflow states, and AI-assisted visit summary requiring doctor confirmation.
- acceptance: Diagnosis searchable and auto-suggested from chief complaint/symptoms; visit types: OPD consultation, follow-up, teleconsultation (future), procedure visit; visit workflow states: Waiting → With Nurse (vitals) → With Doctor → Billing → Completed; AI drafts structured clinical note for doctor review and one-tap approval — never auto-finalized without doctor confirmation.
- scope: diagnosis, visit management

## REQ-lab-records
- source: docs/clinic-management-prd.md §4.7
- description: Lab order creation from within a visit, in-house or external routing, structured result entry with trending, abnormal flagging, and patient-facing result notification.
- acceptance: Tests selected from a configurable local test catalog; order routed to in-house lab workflow or marked external for partner lab; structured numeric/coded results where possible plus free-text/file upload for scanned reports; abnormal result flagging against configurable reference ranges; result visibility to patient via WhatsApp/SMS with secure link.
- scope: lab records

## REQ-reminders-notifications
- source: docs/clinic-management-prd.md §4.8
- description: SMS/WhatsApp reminders and notifications across appointment, prescription, lab, follow-up, vaccination, and medication-refill lifecycles, with basic two-way WhatsApp and full audit logging.
- acceptance: Appointment reminders with configurable timing (e.g., 24h and 2h before); prescription/lab-result delivery notifications; follow-up due reminders; vaccination due reminders (pediatric template); medication refill reminders; two-way WhatsApp allowing patients to confirm/cancel/reschedule via reply (basic bot logic, not the full AI Voice Agent); all patient communication logged against the patient record for audit and consent purposes.
- scope: reminders, notifications

## REQ-referrals
- source: docs/clinic-management-prd.md §4.9
- description: In-network and out-of-network referrals with consented history sharing, referral letters, and referral tracking with closing-the-loop notes.
- acceptance: In-network referral to another doctor/clinic on the platform with shareable summary of relevant history (with patient consent); out-of-network referral generates a PDF referral letter with clinical summary; referral tracking statuses: Sent, Acknowledged, Completed, plus closing-the-loop notes when the patient returns.
- scope: referrals

## REQ-billing-invoicing
- source: docs/clinic-management-prd.md §4.10
- description: Simple per-visit billing, payment recording (recording only, no payment gateway initially), PDF receipts, and collection reports. Flagged in source as an assumption — not explicitly requested; confirm before build.
- acceptance: Per-visit billing with consultation fee, procedure charges, itemized list; payment recording for cash/UPI/card (recording only); receipt generation (PDF, shareable via WhatsApp); daily/monthly collection reports for clinic owner. Source status: unconfirmed assumption (see PRD §9 open question 1).
- scope: billing, invoicing

## REQ-ai-features
- source: docs/clinic-management-prd.md §4.11
- description: Assistive AI features — visit summarization, smart scheduling assist, patient history summarization, and prescription suggestion sourced only from the doctor's own prescribing history — all labeled as AI-generated until clinician acceptance.
- acceptance: Visit summarization from doctor's shorthand/dictation; smart scheduling assist based on historical no-show patterns and consultation duration trends; patient history "catch-up" summary on opening a returning patient's file; prescription suggestion assistive only, sourced from the doctor's own historical patterns, never generic/external medical advice, always requiring explicit doctor approval; all AI outputs clearly labeled as AI-generated/AI-suggested in the UI until reviewed and accepted by a clinician.
- scope: AI features (assistive)

## REQ-api-access
- source: docs/clinic-management-prd.md §4.12
- description: API-first REST API covering all core entities, tenant-scoped auth, webhooks, and per-tenant rate limiting and usage logging.
- acceptance: Full REST API covering patients, appointments, visits, prescriptions, lab orders, referrals — apps and future AI Voice Agent consume the same API surface; API authentication via tenant-scoped API keys / OAuth2 with role-scoped permissions matching in-app roles; webhooks for key events (appointment booked/cancelled, visit completed, lab result ready); rate limiting and usage logging per tenant/API key.
- scope: API access

## REQ-compliance-data-layer
- source: docs/clinic-management-prd.md §4.13
- description: ABDM/ABHA/FHIR data-layer readiness designed now so future integration requires no data migration — live integration is out of scope for launch.
- acceptance: Patient ID schema includes optional, nullable ABHA number/address field from day one; diagnosis fields use ICD-10/11 rather than free text where feasible; medication data references a structured drug database; every clinical document generated in a structured internal format transformable to HL7 FHIR R4 bundle without re-authoring historical data; consent events logged as first-class immutable records from day one; facility/practitioner records structured to accommodate future HFR/HPR ID fields.
- scope: ABDM/ABHA readiness, DPDP, compliance data layer

## REQ-nfr-multi-tenancy-scalability
- source: docs/clinic-management-prd.md §5.1
- description: Strict database-level tenant isolation and an architecture that scales from pilot clinics to thousands of tenants without redesign.
- acceptance: Row-level security enforced at database level, not just application-level checks; start on Vercel + Supabase (Postgres with RLS) with clear migration path to a dedicated cloud provider (AWS/GCP/Azure, India regions); stateless application layer to support horizontal scaling.
- scope: NFR — multi-tenancy, scalability

## REQ-nfr-performance
- source: docs/clinic-management-prd.md §5.2
- description: Core actions respond in 1–2 seconds on typical Indian mobile networks; offline-tolerant UX where feasible.
- acceptance: Open patient record / create appointment / save prescription respond under 1–2 seconds on typical Indian 3G/4G; offline-tolerant UX evaluated for spotty-connectivity clinics (e.g., queue view, draft prescriptions cached locally and synced on reconnect) given responsive-web-first approach.
- scope: NFR — performance, offline tolerance

## REQ-nfr-security
- source: docs/clinic-management-prd.md §5.3
- description: Encryption, RBAC at API and UI layers, audit logging of patient record access/modification, OTP-based staff auth, and tested backups.
- acceptance: Encryption at rest and in transit for all patient data; RBAC enforced at both API and UI layers; audit logging of all access to and modification of patient records (who viewed/edited what, when); OTP-based authentication for staff login, no shared/generic logins per clinic; regular automated backups with tested restore procedures.
- scope: NFR — security

## REQ-nfr-regulatory-compliance
- source: docs/clinic-management-prd.md §5.4
- description: DPDP Act compliance requirements; storage of clinic registration/license details; teleconsultation and live ABDM integration deferred.
- acceptance: Explicit consent capture for data collection/communication, right to access/delete data, purpose limitation, breach notification readiness (DPDP Act, 2023); product supports storing clinic registration/license details but does not enforce state-specific licensing rules; Telemedicine Practice Guidelines flagged as future consideration, out of scope for this version; ABDM readiness per §4.13 — data-layer readiness now, live integration as a separate future initiative.
- scope: NFR — regulatory, DPDP compliance

## REQ-nfr-reliability
- source: docs/clinic-management-prd.md §5.5
- description: Uptime target and graceful degradation of communications providers.
- acceptance: Target uptime 99.5%+; if SMS/WhatsApp provider is down, in-app data entry and clinical workflows continue unaffected.
- scope: NFR — reliability
