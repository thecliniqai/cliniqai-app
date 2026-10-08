# Roadmap: ClinicQ

## Overview

ClinicQ is built as six vertical slices: first the isolated multi-tenant foundation with security and compliance-ready schemas, then the daily front-desk loop (patients + scheduling), then the doctor's consultation loop (visit templates, diagnosis, prescriptions, provisional billing), then diagnostics and referrals, then the communications/AI layer that closes the loop with patients, and finally the API surface plus launch-grade NFR hardening. Each phase ends with something a clinic user can observe working end to end.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: Foundation & Tenant Isolation** - Clinic signup, staff OTP onboarding, RBAC, audit logging, compliance-ready schemas, database-level tenant isolation
- [x] **Phase 2: Patient Records & Scheduling** - Patient registration/search/dedup, visit timeline, per-doctor calendar, walk-in queue, waitlist
- [ ] **Phase 3: Consultation & Prescribing** - Specialty templates, visit workflow states, ICD-10 diagnosis, e-prescriptions with PDF delivery, provisional per-visit billing
- [ ] **Phase 4: Labs & Referrals** - Lab orders/results with abnormal flagging, in- and out-of-network referrals with tracking
- [ ] **Phase 5: Communications & AI Assist** - SMS/WhatsApp reminders and two-way replies, communication audit log, labeled assistive AI features
- [ ] **Phase 6: API & Launch Readiness** - REST API, webhooks, rate limiting, performance, reliability, DPDP/regulatory hardening

## Phase Details

### Phase 1: Foundation & Tenant Isolation
**Goal**: Clinic staff can set up a clinic, invite the team, and work inside a fully isolated, audited tenant
**Depends on**: Nothing (first phase)
**Requirements**: REQ-multi-tenancy, REQ-compliance-data-layer, REQ-nfr-multi-tenancy-scalability, REQ-nfr-security
**Success Criteria** (what must be TRUE):
  1. New clinic owner creates the clinic profile (name, address, specialty, working hours) and invites staff by phone/email who join via OTP
  2. Each role (Owner/Admin, Doctor, Receptionist, Nurse) gets only its permitted actions, enforced server-side — not just hidden in the UI
  3. No user can see or query another clinic's data under any circumstance (verified by explicit cross-tenant tests)
  4. Patient records created from day one include the optional ABHA field and immutable consent records, and every view/edit of a patient record appears in the audit log
**Plans**: 5 plans completed (01-01 through 01-05)
**UI hint**: yes

### Phase 2: Patient Records & Scheduling
**Goal**: Front desk can register and find any patient in seconds and run the day's booking and walk-in queue from one screen
**Depends on**: Phase 1
**Requirements**: REQ-patient-records, REQ-appointment-booking
**Success Criteria** (what must be TRUE):
  1. Receptionist registers a new patient and is warned about likely duplicates (name + phone + DOB) before a second record is created
  2. Staff find any patient by name, phone, or patient ID and open a chronological, filterable visit-history timeline with attachments
  3. Staff book, confirm, reschedule, and cancel appointments on a per-doctor calendar with the full state set, and unintended double-booking is blocked (overbooking configurable)
  4. Walk-in tokens and scheduled appointments appear in the same queue view, and cancelled slots are released to captured waitlist entries
**Plans**: 4 plans completed (02-01, 02-02, 02-03, 02-04)
**UI hint**: yes

### Phase 3: Consultation & Prescribing
**Goal**: A doctor can complete a full visit — notes, diagnosis, prescription, billing — and the patient leaves with a shareable PDF
**Depends on**: Phase 2
**Requirements**: REQ-specialty-templates, REQ-diagnosis-visit-management, REQ-e-prescriptions, REQ-billing-invoicing (PROVISIONAL)
**Success Criteria** (what must be TRUE):
  1. Doctor records a visit (chief complaint, exam, diagnosis) using the generic core or the clinic's selected specialty template, and new specialty templates can be added as configuration without a release
  2. Visits move through Waiting → With Nurse → With Doctor → Billing → Completed and the queue view reflects each state live
  3. Diagnosis is searchable/auto-suggested with ICD-10 codes, and any AI-drafted note is labeled AI-generated and finalizes only on the doctor's one-tap approval
  4. Doctor writes a prescription with India drug search (brand/generic/salt), allergy/interaction warnings, and one-tap favorite templates → branded PDF; history is searchable and edits leave an audit trail
  5. *(Provisional)* Staff record per-visit charges and payment (cash/UPI/card recording only), issue a PDF receipt, and the owner sees daily/monthly collection reports
**Plans**: TBD
**UI hint**: yes

### Phase 4: Labs & Referrals
**Goal**: Clinics can order and track lab tests and refer patients in or out of the network with full loop closure
**Depends on**: Phase 3
**Requirements**: REQ-lab-records, REQ-referrals
**Success Criteria** (what must be TRUE):
  1. From an open visit, staff create a lab order from the local test catalog and route it to in-house workflow or mark it external for a partner lab
  2. Structured results are entered with abnormal values flagged against configurable reference ranges, and released results are viewable by the patient through a secure link
  3. Staff refer a patient in-network (consented history summary) or out-of-network (PDF referral letter with clinical summary)
  4. Referrals show Sent → Acknowledged → Completed status with closing-the-loop notes when the patient returns
**Plans**: TBD
**UI hint**: yes

### Phase 5: Communications & AI Assist
**Goal**: Patients receive timely WhatsApp/SMS updates across their journey, and doctors get clearly labeled AI assistance — with communications surviving provider outages
**Depends on**: Phase 4
**Requirements**: REQ-reminders-notifications, REQ-ai-features
**Success Criteria** (what must be TRUE):
  1. Appointment reminders (configurable timing), prescription/lab delivery notices, and follow-up/vaccination/refill reminders go out via SMS/WhatsApp, and every message is logged on the patient record
  2. A patient can reply to confirm/cancel/reschedule a booking, and the appointment state updates accordingly (basic bot logic)
  3. Waitlist openings and released lab results/PDFs deliver automatically, closing the messaging gaps from earlier phases
  4. Visit summaries, history catch-up summaries, scheduling assist, and prescription suggestions (from the doctor's own history only) appear labeled AI-generated in the UI until a clinician accepts — nothing auto-finalizes
**Plans**: TBD
**UI hint**: yes

### Phase 6: API & Launch Readiness
**Goal**: The platform is consumable by external clients and meets launch-grade performance, reliability, and regulatory standards
**Depends on**: Phase 5
**Requirements**: REQ-api-access, REQ-nfr-performance, REQ-nfr-reliability, REQ-nfr-regulatory-compliance
**Success Criteria** (what must be TRUE):
  1. External clients authenticate with tenant-scoped API keys and perform CRUD over patients, appointments, visits, prescriptions, lab orders, and referrals, with role scope matching in-app roles
  2. Webhooks fire on appointment booked/cancelled, visit completed, and lab result ready; per-key rate limiting and usage logs are visible per tenant
  3. Core actions (open patient record, create appointment, save prescription) respond in under 1–2 seconds on typical Indian 3G/4G networks
  4. If the SMS/WhatsApp provider is down, in-app data entry and clinical workflows continue unaffected; uptime monitoring supports the 99.5%+ target with backups/restore tested
  5. A patient's DPDP requests (access/delete, consent status) can be fulfilled from the app, and clinic registration/license details are stored
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Tenant Isolation | 0/- | Not started | - |
| 2. Patient Records & Scheduling | 0/- | Not started | - |
| 3. Consultation & Prescribing | 0/- | Not started | - |
| 4. Labs & Referrals | 0/- | Not started | - |
| 5. Communications & AI Assist | 0/- | Not started | - |
| 6. API & Launch Readiness | 0/- | Not started | - |
