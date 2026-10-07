# Product Requirements Document
## Clinic Management Application for Independent & Small Clinics in India

**Document version:** 1.0
**Owner:** Siddharth Karkhanis
**Date:** August 26, 2026
**Status:** Draft for build

---

## 1. Overview

### 1.1 Problem Statement
Small and solo clinics across India — the vast majority of outpatient care in the country — largely run on paper registers, WhatsApp, and disconnected tools (a booking app here, an Excel sheet there). Existing EMR/HMIS products are built for hospitals: expensive, tiered, feature-gated, and require IT teams to deploy. Doctors in single/small clinic settings won't adopt a new system unless it is obviously, overwhelmingly better than what they use today — not incrementally better.

### 1.2 Product Vision
A single-plan, all-inclusive, cloud-based clinic management platform built specifically for solo and small clinics in India, covering the full patient journey — booking, records, prescriptions, diagnosis, labs, referrals, reminders — in one modern, mobile-first product, priced simply, with API access and AI assistance built in from the start.

### 1.3 Business Model
- **Pricing:** Flat ₹1,000/month per clinic. One plan. All features included. No feature gating, no per-user or per-module upsells.
- **Go-to-market:** Founder-led, one-to-one sales to the first 50 doctors within 3 months of go-live, expanding via referral and local reputation thereafter.
- **Positioning:** "Everything a clinic needs, one price, no surprises."

### 1.4 Out of Scope for This Document
- The AI Voice Agent (front-desk/receptionist voice product) is a **separate product vertical** with its own PRD. It will consume this platform's API but is not specified here.
- Hospital/multi-department/IPD (in-patient) workflows are out of scope — this is an outpatient clinic product.
- Insurance/TPA claims processing is out of scope for the initial requirement set (flagged as a future integration point given NHCX developments).

---

## 2. Target Users & Personas

| Persona | Description | Primary Needs |
|---|---|---|
| **Solo Doctor (primary buyer)** | GP, dentist, gynaecologist, pediatrician, dermatologist, etc. running a 1–2 room clinic, sees 15–60 patients/day | Fast patient entry, fast prescription writing, minimal typing, works on a phone/tablet between patients |
| **Clinic Receptionist/Front Desk** | Non-technical staff managing walk-ins, calls, appointments | Simple booking UI, queue view, payment collection, WhatsApp/SMS confirmations |
| **Nurse/Assistant** | Vitals capture, prep before doctor sees patient | Quick vitals entry, visible patient queue/status |
| **Patient** | Receives appointment confirmations, prescriptions, reminders | WhatsApp/SMS updates, access to their own records (via ABHA in future), minimal friction |
| **Lab Partner (external, optional)** | Local diagnostic lab clinic refers patients to | Receive orders, upload results |
| **Clinic Owner/Admin** (may be same as doctor) | Owns the tenant account, manages staff, billing | User management, clinic settings, subscription/billing view |

---

## 3. Core Design Principles

1. **Zero-training UI.** If a receptionist or doctor needs a manual, the design has failed. Every core action (book, prescribe, record a visit) should take under 3 taps/clicks.
2. **Mobile-first, device-agnostic.** A doctor should be able to run their entire clinic from a phone if they choose to.
3. **One record, everywhere.** A patient's data — demographics, history, prescriptions, labs — is unified regardless of which module created it.
4. **Compliance-ready by construction, not by retrofit.** Every clinical data structure is built ABDM/FHIR-compatible from day one, even though live ABDM/ABHA integration ships as a separate, later initiative.
5. **AI as an assistant, never the record of truth.** AI-generated content (visit summaries, suggested codes, etc.) is always editable and clearly marked as AI-suggested until a human confirms it.
6. **No feature gating.** Every tenant gets every feature. Differentiation is on quality, not access.
7. **Clean Light Themed UI/UX Only** Entire app should be designed with modern UI/UX prinicples and in Light Theme only.

---

## 4. Functional Requirements

### 4.1 Multi-Tenancy & Clinic/User Management
- Each clinic is an isolated tenant (data fully partitioned; no cross-tenant data visibility under any circumstance).
- A clinic can have multiple staff accounts: Owner/Admin, Doctor(s), Receptionist, Nurse — each with role-based permissions.
- A single doctor may (in future) belong to more than one clinic tenant (e.g., visiting consultant) — data model should anticipate this even if not built at launch.
- Clinic profile: name, address, registration/license number, specialty, working hours, holiday calendar, branding (logo/letterhead for prescriptions).
- Staff invite via phone/email with OTP-based onboarding.
- Subscription/billing status visible to Owner/Admin (₹1,000/month, single plan, payment history, renewal date).

### 4.2 Appointment Booking & Scheduling
- Calendar-based scheduling per doctor, with configurable slot durations, working hours, breaks, and leave/holiday blocking.
- Booking channels: in-app (staff-side), patient self-booking link (shareable via WhatsApp/SMS), and (future) API-driven booking from the AI Voice Agent or third-party channels.
- Walk-in queue management — token/queue number generation for patients without a pre-booked slot, alongside scheduled appointments in the same view.
- Appointment states: Booked, Confirmed, Checked-in, In-consultation, Completed, No-show, Cancelled, Rescheduled.
- Automatic reminders (see 4.8) tied to appointment lifecycle.
- Recurring appointment support (e.g., physiotherapy follow-ups, weekly dressing changes).
- Double-booking prevention with configurable overbooking allowance (some clinics intentionally overbook).
- Waitlist for fully booked slots with auto-notify on cancellation.

### 4.3 Patient Records (Core EMR)
- Unified patient profile: demographics, contact info, emergency contact, photo (optional), blood group, known allergies, chronic conditions, family history.
- Deduplication logic on patient creation (name + phone + DOB fuzzy match) to prevent duplicate patient records — critical in high-volume, low-friction registration.
- Patient search: by name, phone number, patient ID, or (future) ABHA number.
- Full visit history timeline per patient — chronological, filterable by visit type, doctor, date range.
- Document/file attachments per patient (scanned reports, old prescriptions, images) with tagging.
- Consent capture for data sharing/communication (required for DPDP Act compliance — see Section 6).

### 4.4 Specialty Templates (Generic Core + Extensions)
- **Generic core visit record** applicable to any specialty: chief complaint, history of present illness, examination notes, vitals, diagnosis, treatment plan, prescription, follow-up date.
- **Specialty template layer** on top of the generic core — configurable structured fields specific to a specialty, selected at clinic setup and editable by the clinic:
  - *General Physician:* vitals-heavy (BP, sugar, weight/BMI trend), symptom checklists
  - *Dental:* tooth chart (FDI notation), procedure codes, treatment plan across visits
  - *Gynaecology/Obstetrics:* menstrual/obstetric history, ANC visit schedule, growth charts
  - *Pediatrics:* growth charts (height/weight/head circumference percentiles), vaccination schedule/tracker
  - *Dermatology:* body map for lesion marking, photo-based progress tracking
  - *Orthopedics:* affected-limb/joint selector, X-ray/imaging attachment workflow
- Template system should be **configuration-driven** (structured field definitions stored as data, not hardcoded per specialty) so new specialty templates can be added without a full release cycle.
- A clinic can select multiple specialties if the doctor practices across areas.

### 4.5 E-Prescriptions
- Prescription builder: drug search (India-specific drug database — brand + generic + salt composition), dosage, frequency, duration, route, special instructions.
- Favorite/frequent prescription templates per doctor (e.g., "standard fever protocol") for one-tap prescribing.
- Drug interaction and allergy warnings against the patient's recorded allergy list.
- Digital signature / clinic letterhead branding on generated prescription.
- Output as shareable PDF, sent automatically via WhatsApp/SMS to patient on visit completion.
- Prescription history — searchable, re-printable, editable only with an audit trail (never silently overwritten).

### 4.6 Diagnosis & Visit Management
- Diagnosis coding using ICD-10 (with ICD-11 readiness) — searchable, auto-suggested based on chief complaint/symptoms entered.
- Visit types: OPD consultation, follow-up, teleconsultation (future), procedure visit.
- Visit workflow states aligned with the queue: Waiting → With Nurse (vitals) → With Doctor → Billing → Completed.
- AI-assisted visit summary: doctor can dictate or type shorthand notes; AI drafts a structured clinical note (chief complaint, findings, plan) for doctor review and one-tap approval — never auto-finalized without doctor confirmation.

### 4.7 Lab Records
- Lab order creation from within a visit (select tests from a configurable local test catalog).
- Order can be routed to an in-house lab workflow (simple result entry) or marked as "external" for a partner lab.
- Result entry: structured numeric/coded results where possible (enables trending graphs over time, e.g., HbA1c trend) plus free-text/file upload for scanned reports.
- Abnormal result flagging against configurable reference ranges.
- Result visibility to patient via WhatsApp/SMS notification with secure link.

### 4.8 Reminders & Notifications (SMS/WhatsApp)
- Appointment reminders (configurable timing, e.g., 24h and 2h before).
- Prescription/lab-result delivery notifications.
- Follow-up due reminders (e.g., "your follow-up with Dr. X is due").
- Vaccination due reminders (pediatric template).
- Medication refill reminders (chronic condition patients).
- Two-way WhatsApp: patients can confirm/cancel/reschedule via reply (basic bot logic — not the full AI Voice Agent).
- All patient communication logged against the patient record for audit and consent purposes.

### 4.9 Referrals
- In-network referral: refer patient to another doctor/clinic on the platform, with a shareable summary of relevant history (with patient consent).
- Out-of-network referral: generate a referral letter (PDF) with relevant clinical summary for a doctor outside the platform.
- Referral tracking: status (Sent, Acknowledged, Completed) and closing-the-loop notes when the patient returns.

### 4.10 Billing & Invoicing
*(Not explicitly requested but essential to a working clinic — flagged as an assumption; confirm before build.)*
- Simple per-visit billing: consultation fee, procedure charges, itemized list.
- Payment recording (cash/UPI/card — recording only, not a payment gateway initially).
- Receipt generation (PDF, shareable via WhatsApp).
- Daily/monthly collection reports for the clinic owner.

### 4.11 AI Features
- **Visit summarization:** structured note generation from doctor's shorthand/dictation (see 4.6).
- **Smart scheduling assist:** suggest optimal slot allocation based on historical no-show patterns and consultation duration trends.
- **Patient history summarization:** on opening a returning patient's file, AI generates a short "catch-up" summary of relevant history for the doctor.
- **Prescription suggestion (assistive only):** based on diagnosis, suggest commonly used prescriptions from the doctor's own historical patterns — never a generic/external suggestion presented as medical advice, always sourced from the doctor's own prior prescribing behavior, always requires explicit doctor approval.
- All AI outputs must be clearly labeled as AI-generated/AI-suggested in the UI until reviewed and accepted by a clinician.

### 4.12 API Access
- Full REST API covering all core entities: patients, appointments, visits, prescriptions, lab orders, referrals — built API-first so the web/mobile apps and the future AI Voice Agent all consume the same API surface.
- API authentication via tenant-scoped API keys / OAuth2, with role-scoped permissions matching in-app roles.
- Webhooks for key events (appointment booked/cancelled, visit completed, lab result ready) to support the Voice Agent and future third-party integrations.
- Rate limiting and usage logging per tenant/API key.

### 4.13 Compliance Data-Layer Readiness (ABDM/ABHA — Design Now, Integrate Later)
This platform will **not** ship live ABDM/ABHA/UHI integration at launch, but every relevant data structure must be designed so integration requires no data migration later:
- Patient ID schema includes an optional, nullable ABHA number/address field from day one.
- Clinical diagnosis fields use standard coding (ICD-10/11) rather than free text where feasible, enabling future FHIR mapping.
- Medication data references a structured drug database (not free text) to support future FHIR Medication resource mapping.
- Every clinical document (prescription, lab result, referral, visit note) generated in a structured internal format that can be transformed into an HL7 FHIR R4 bundle later without re-authoring historical data.
- Consent events (what was shared, with whom, when, patient's approval) are logged as first-class, immutable records from day one — this is required both for future ABDM consent-manager integration and for basic DPDP Act compliance today.
- Facility and practitioner records structured to accommodate a future Health Facility Registry ID and Healthcare Professional Registry ID field.

---

## 5. Non-Functional Requirements

### 5.1 Multi-Tenancy & Scalability
- Strict tenant data isolation at the database level (row-level security enforced, not just application-level checks).
- Architecture must scale from a handful of pilot clinics to thousands of tenants without a redesign — start on Vercel + Supabase (Postgres, with Row-Level Security), with a clear migration path to a dedicated cloud provider (AWS/GCP/Azure, India regions) once scale or compliance requires it.
- Stateless application layer to support horizontal scaling.

### 5.2 Performance
- Core actions (open patient record, create appointment, save prescription) should respond in under 1–2 seconds on a typical Indian mobile network (3G/4G).
- Offline-tolerant UX where feasible for spotty-connectivity clinics (e.g., queue view, draft prescriptions cached locally and synced on reconnect) — evaluate feasibility given responsive-web-first approach.

### 5.3 Security
- Encryption at rest and in transit for all patient data.
- Role-based access control enforced at both API and UI layers.
- Audit logging of all access to and modification of patient records (who viewed/edited what, when) — required both for security and for eventual ABDM consent-audit requirements.
- OTP-based authentication for staff login; no shared/generic logins per clinic.
- Regular automated backups with tested restore procedures.

### 5.4 Regulatory & Legal Compliance
- **Digital Personal Data Protection (DPDP) Act, 2023:** explicit consent capture for data collection/communication, right to access/delete data on request, data processing purpose limitation, breach notification readiness.
- **Clinical Establishments Act / applicable state-level clinic registration rules:** the product should support storing the clinic's registration/license details but does not itself need to enforce state-specific licensing rules.
- **Telemedicine Practice Guidelines (if teleconsultation is added later):** flagged as a future consideration, out of scope for this version.
- **ABDM readiness:** as detailed in Section 4.13 — data-layer readiness now, live integration as a separate future initiative given it is not yet universally mandated for private clinics but is trending toward becoming baseline expectation.

### 5.5 Reliability
- Target uptime: 99.5%+ (appropriate for a bootstrapped early-stage product; revisit as scale grows).
- Graceful degradation: if SMS/WhatsApp provider is down, in-app data entry and clinical workflows must continue unaffected.

---

## 6. Technical Architecture (Starting Point)

- **Frontend:** Responsive web application (works on phone/tablet/laptop browsers) — native mobile apps deferred to a later phase.
- **Backend/Database:** Supabase (Postgres + Auth + Row-Level Security + Storage for file attachments).
- **Hosting:** Vercel for the application layer.
- **Rationale:** This stack allows a solo founder to move fast, get to market in ~3 months, and defer significant infrastructure investment until the tenant base and revenue justify migrating to a dedicated cloud provider (e.g., AWS/GCP with India-region data residency) for cost efficiency and deeper compliance control at scale.
- **Migration considerations to plan for now:** avoid deep coupling to Supabase-specific features where a standard Postgres + REST API pattern would work just as well, to ease a future move; keep file storage abstracted behind an interface rather than directly calling Supabase Storage everywhere.
- **Communications:** WhatsApp Business API (via a BSP/partner — e.g., Gupshup, Twilio, or similar) and SMS gateway (e.g., MSG91, Twilio) as pluggable providers, not hard-coded to one vendor.
- **AI:** LLM API integration (e.g., Claude API) for summarization and assistive features, with all AI calls logged and outputs clearly flagged as AI-generated in the data model.

---

## 7. Data Model Highlights (Key Entities)

- **Tenant (Clinic)** — id, name, address, specialty(ies), registration details, subscription status
- **User** — id, tenant_id, role, name, contact, credentials
- **Patient** — id, tenant_id, demographics, contact, allergies, ABHA_number (nullable), consent_records[]
- **Appointment** — id, tenant_id, patient_id, doctor_id, datetime, status, channel
- **Visit** — id, patient_id, appointment_id (nullable for walk-ins), specialty_template_id, structured_fields (JSON, per template), diagnosis_codes[], created_by, AI_generated_flag
- **Prescription** — id, visit_id, drug_items[], generated_pdf_url, edit_history[]
- **LabOrder / LabResult** — id, visit_id, test_catalog_ref, result_value/structured, reference_range, file_attachments[]
- **Referral** — id, visit_id, from_doctor, to_doctor/external, status, summary
- **ConsentRecord** — id, patient_id, consent_type, granted_at, revoked_at (nullable), channel
- **AuditLog** — id, tenant_id, actor_id, action, entity, timestamp

---

## 8. Success Metrics

- 50 active paying clinics within 3 months of go-live (founder's target)
- Staff onboarding time: a new clinic fully operational (first patient booked and visit recorded) within 1 day of signup, without founder hand-holding required beyond initial setup call
- Monthly churn under 5% among onboarded clinics
- Median time to complete a visit record under 3 minutes
- WhatsApp/SMS delivery success rate above 95%

---

## 9. Assumptions & Open Questions

1. **Billing/invoicing module (Section 4.10)** was not explicitly requested — confirm whether this is in scope for launch or should be removed.
2. **Payment gateway for the ₹1,000/month subscription itself** — assumed Razorpay/similar for founder billing; confirm.
3. **Drug database and local test catalog source** — will need a licensed India drug database (e.g., a commercial API) and a configurable local lab test catalog; sourcing to be confirmed.
4. **WhatsApp Business API provider** — needs to be selected early since approval/onboarding with Meta via a BSP can take 1–2 weeks, relevant to the 3-month timeline.
5. **Data residency** — Supabase project region should be confirmed as India-based (or nearest compliant region) given DPDP Act expectations around sensitive personal data.
6. **Solo-founder build capacity** — this PRD is intentionally full-scope per your request; a separate internal build-sequencing conversation (not reflected in this document) will be needed to make a 3-month solo-founder timeline realistic.

---

## 10. Out of Scope (Explicit)

- AI Voice Agent / receptionist product (separate PRD)
- In-patient/hospital ward management
- Insurance/TPA claims processing and NHCX integration
- Live ABDM/ABHA/UHI integration (data-layer readiness only, per Section 4.13)
- Native mobile applications (responsive web first, per decision above)
- Multi-language/regional language UI (assumed English-only unless specified otherwise — flag if incorrect)
