# Roadmap: ClinicQ

## Overview

ClinicQ is built as six vertical slices: first the isolated multi-tenant foundation with security and compliance-ready schemas, then the daily front-desk loop (patients + scheduling), then the doctor's consultation loop (visit templates, diagnosis, prescriptions, provisional billing), then diagnostics and referrals, then the communications/AI layer that closes the loop with patients, and finally the API surface plus launch-grade NFR hardening. Each phase ends with something a clinic user can observe working end to end.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: Foundation & Tenant Isolation** - Clinic signup, staff OTP onboarding, RBAC, audit logging, compliance-ready schemas, database-level tenant isolation
- [x] **Phase 2: Patient Records & Scheduling** - Patient registration/search/dedup, visit timeline, per-doctor calendar, walk-in queue, waitlist
- [x] **Phase 02.1 (Phase 2B): UI/UX Re-foundation Using TailAdmin Free (INSERTED)** - Design system tokens, TailAdmin sidebar shell, reusable UI primitives, and full redesign of dashboard, patients, calendar, queue, and staff workflows (completed 2026-10-08)
- [x] **Phase 3: Consultation & Prescribing** - Specialty templates, visit workflow states, ICD-10 diagnosis, e-prescriptions with PDF delivery, provisional per-visit billing (completed 2026-10-15)
- [x] **Phase 03.1 (Phase 3A): Doctor Cabin, Role-Based Access & Billing Invoicing (INSERTED)** - Dedicated Doctor Cabin workspace, role-scoped UI permissions (owner/admin/doctor/nurse/receptionist), 1-tap queue consultation launch, per-visit billing (Cash/UPI/Card), and collection reports (completed 2026-10-15)
- [x] **Phase 03.2 (Phase 3B): Patient Visit History & Unified Clinic Visits Register (INSERTED)** - Chronological visit history timeline in Patient View (`/patients/[id]`), unified clinic visits register (`/visits`) with date range filters, search, doctor filter, direct prescription download/preview, and role-based visit record access (completed 2026-10-16)
- [ ] **Phase 03.3: Doctor Availability, Multi-Shift Scheduling, Time Blocking & Calendar Enhancements (INSERTED)** - Fix doctor UUID display across calendar and drawers, doctor weekly availability with split shifts, time-off/vacation blocking, per-doctor slot duration (15/20/30/45/60m), dynamic calendar timeline hours, and doctor filter pills
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

### Phase 02.1: UI/UX Re-foundation Using TailAdmin Free (INSERTED)

**Goal:** Completely rework the application visual system, layout, component architecture, responsiveness, and overall UX foundation using TailAdmin Free as design reference while preserving existing business logic and domain architecture.
**Requirements**: REQ-ui-ux-refoundation (Design system consistency, TailAdmin sidebar shell, reusable primitives, mobile responsiveness)
**Depends on:** Phase 02
**Plans:** 5 plans (02.1-01 through 02.1-05)
**UI hint:** yes

**Success Criteria** (what must be TRUE):
  1. Application shell features a responsive, collapsible TailAdmin-styled sidebar and top header with user profile menu and mobile drawer navigation.
  2. Core UI primitives (buttons, inputs, select, cards, tables, badges, modals, dropdowns, alerts, empty states) follow a consistent design system adhering to DESIGN.md light theme tokens and #1769E0 brand palette.
  3. All existing Phase 1 & 2 screens (Dashboard, Patients directory, Registration with duplicate warning, Patient detail, Doctor calendar, Live queue, Staff, and Settings) are fully redesigned without breaking business functionality.
  4. Mobile experience is first-class with off-canvas navigation, 44px minimum touch targets, and zero horizontal viewport spill.
  5. All existing integration tests continue to pass and Next.js production build succeeds with zero compiler errors.

Plans:
- [x] 02.1-01: Foundation, Tokens & Core UI Primitives
- [x] 02.1-02: TailAdmin Application Shell & Navigation
- [x] 02.1-03: Dashboard & Patient Management Redesign
- [x] 02.1-04: Doctor Calendar & Live Queue Redesign
- [x] 02.1-05: Team, Settings, Auth & Responsive/Visual Verification

### Phase 3: Consultation & Prescribing

**Goal**: A doctor can complete a full visit — clinical notes, diagnosis, prescription, and billing — and the patient leaves with shareable PDF documents.

**Depends on**: Phase 2

**Requirements**: REQ-specialty-templates, REQ-diagnosis-visit-management, REQ-e-prescriptions, REQ-billing-invoicing (PROVISIONAL)

**Success Criteria** (what must be TRUE):

 1. Doctor records a visit (chief complaint, history, examination, diagnosis, and treatment plan) using the generic core or the clinic's selected specialty template. New specialty templates can be added as configuration without an application release.
 2. Visits move through Waiting → With Nurse → With Doctor → Billing → Completed, and the reception queue reflects each state live. Appointments, queue entries, and clinical visits remain logically distinct while sharing the appropriate underlying records.
 3. Diagnosis search supports **ICD-11** for standardized disease classification and **SNOMED CT** for detailed clinical terminology, including searchable clinical concepts, synonyms, and relevant codes. The terminology datasets must be legally usable, versioned, and maintainable. AI-drafted clinical notes are explicitly labelled AI-generated, remain editable, and are finalized only after the doctor's approval.
 4. Doctor creates prescriptions using an India-focused medication catalogue with search by brand name, generic name, and active ingredient/salt. The system supports dosage, strength, route, frequency, duration, quantity, and instructions, along with allergy and medication-interaction warnings where reliable data is available. Doctors can reuse favourite prescription templates. Final prescriptions are generated as clinic-branded PDFs. Prescription history is searchable, and amendments retain an audit trail.
 5. **(Provisional)** Staff record per-visit charges and payments (cash, UPI, and card recording only), issue downloadable PDF receipts, and provide the clinic owner with daily and monthly collection reports.

**Plans**: TBD
- [x] 03-01-PLAN.md
- [x] 03-02-PLAN.md
- [x] 03-03-PLAN.md
- [x] 03-04-PLAN.md

**UI hint**: Yes

### Phase 03.1: Doctor Cabin, Role-Based Access & Billing Invoicing (INSERTED)

**Goal:** Doctors have a dedicated, distraction-free "Doctor Cabin" workspace to consult waiting patients in 1 click; owners and admins access all screens with configurable staff roles; receptionists and nurses have dedicated triage and queue tools; and clinics can record per-visit billing (cash/UPI/card) with downloadable PDF receipts and daily collection reports.

**Depends on:** Phase 3
**Requirements**: REQ-billing-invoicing, REQ-multi-tenancy, REQ-diagnosis-visit-management

**Success Criteria** (what must be TRUE):
 1. Owners and Admins have full access to all clinic screens (operations, clinical doctor cabin, staff, billing, settings) by default, while Doctor role is focused directly on the clinical workspace (Doctor's Cabin, My Queue, Consultation, Calendar).
 2. A dedicated "Doctor's Cabin" route (`/cabin`) displays the doctor's active waiting room, pre-filled vitals, and a 1-tap "Start Consultation" action that immediately opens `/consultation/[id]`.
 3. Live Queue (`/queue`), Calendar timeline, and Dashboard active patients table provide direct 1-tap "Start Consultation" / "Resume Consultation" buttons for checked-in patients.
 4. Clinic profile settings allow configuring clinic operating modes (e.g., whether the owner is a practicing doctor, default doctor assignment, and specialty configuration).
 5. Staff and doctors can record per-visit charges (consultation fee, procedures) and payments (Cash, UPI, Card), issue clinic-branded downloadable PDF receipts, and clinic owners can view daily/monthly collection reports.

**Plans**: 4 plans completed
- [x] 03.1-01-PLAN.md: Role-based navigation shell, Doctor Cabin workspace, and clinic profile practitioner settings
- [x] 03.1-02-PLAN.md: 1-tap consultation integration across Live Queue, Calendar timeline, and Dashboard
- [x] 03.1-03-PLAN.md: Per-visit billing data layer, consultation fee checkout, and payment recording (Cash, UPI, Card)
- [x] 03.1-04-PLAN.md: Branded PDF payment receipt generation, daily collection register, and owner financial reports

**UI hint**: Yes

### Phase 03.2: Patient Visit History & Unified Clinic Visits Register (INSERTED)

**Goal:** Staff and doctors have an instant, comprehensive view of patient clinical history from both the individual patient profile (`/patients/[id]`) and a clinic-wide unified visits register (`/visits`), featuring date-range filtering, instant prescription downloading/printing, and role-based record viewing (interactive consultation editing for doctors, read-only encounter review for front desk/nurses/billing).

**Depends on:** Phase 03.1
**Requirements**: REQ-patient-records, REQ-diagnosis-visit-management, REQ-e-prescriptions, REQ-multi-tenancy

**Success Criteria** (what must be TRUE):
 1. Opening any patient record (`/patients/[id]`) displays a comprehensive, chronological Clinical Visit History timeline showing visit date, doctor, chief complaints, diagnoses (ICD-11/SNOMED), prescribed medications, vitals, billing status, and 1-click [Print Rx] / [Receipt] actions.
 2. A new top-level "Visits" page (`/visits`) accessible from the sidebar and mobile navigation provides a clinic-wide master table of all patient visits across the practice.
 3. The unified visits register supports intuitive date filtering (Today, Yesterday, Last 7 Days, This Month, or Custom Date Range pickers) and quick search by Patient Name, Phone, or UHID.
 4. Filters support filtering by Doctor (treating clinician), Visit Status (waiting, in_consultation, completed, cancelled), and Specialty.
 5. Every row in the visits table provides 1-tap direct actions: [Print Rx] PDF, [Receipt] PDF, and [Open Encounter].
 6. Role-scoped encounter access: Clicking [Open Encounter] allows treating doctors to view/edit or add notes to consultations, while front desk (receptionists/nurses/billing) receive a structured, read-only encounter summary view preventing unauthorized clinical edits.
 7. High-performance, paginated server-side queries strictly scoped to the active tenant ID with multi-tenant RLS enforcement.

**Plans**: 2 plans completed
- [x] 03.2-01-PLAN.md: Patient Detail Clinical Visit History Timeline & Encounter Summary (`/patients/[id]`)
- [x] 03.2-02-PLAN.md: Unified Clinic Visits Register Page (`/visits`), Filters, and Role-Based Encounter Access

### Phase 03.3: Doctor Availability, Multi-Shift Scheduling, Time Blocking & Calendar Enhancements (INSERTED)

**Goal:** Provide full clinical availability management — eliminating raw UUID fragments with complete name resolution across all screens, allowing doctors and clinic admins to configure weekly split shifts (e.g., Morning 10:00–13:00 and Evening 17:00–21:00) and default appointment slot durations (15, 20, 30, 45, 60m), providing single-click time-off and date-range blocking (leaves/vacations), rendering dynamic calendar timeline bounds (spanning active shifts), and adding interactive multi-select doctor filter pills in the calendar header.

**Depends on:** Phase 03.2
**Requirements**: REQ-appointment-booking, REQ-multi-tenancy

**Success Criteria** (what must be TRUE):
 1. Calendar view, Booking Drawer, Walk-in Drawer, Queue, and Cabin properly resolve doctor and staff names from `memberships.full_name` (with clean fallbacks), eliminating raw sliced UUID fragments (`Dr. 780d382b`).
 2. Doctors (in `/profile`) and Clinic Admins (in `/staff` edit modal and `/settings`) can configure weekly doctor schedules supporting split shifts per day (e.g., Morning 10:00 AM – 1:00 PM and Evening 5:00 PM – 9:00 PM) with per-day enable/disable toggles.
 3. Doctors and admins can set the default appointment slot duration per clinician (e.g., 15m for General Physician, 30–45m for Dentist), which automatically pre-populates in the booking drawer and reserves the full multi-slot span in the timeline.
 4. Doctors and clinic admins can create time-off blocks for a specific time window, full day, or date range (leaves/vacations/surgeries) with an explanatory reason.
 5. The calendar timeline dynamically computes its displayed hours from active doctor shifts (e.g., 08:00 to 21:00) instead of a hardcoded 9 to 6 window, and renders off-duty intervals and blocked periods with distinct hatched styling and status badges.
 6. Attempting to book an appointment during an off-duty or blocked interval displays a soft-block warning dialog allowing authorized staff to confirm an emergency booking with an override reason.
 7. The calendar header features multi-select doctor filter pills (`[All Doctors]` + individual clinician pills) allowing staff to quickly isolate a single doctor's schedule or compare specific clinicians.

**Plans**: 3 plans completed
- [x] 03.3-01-PLAN.md: Database migration, name resolution, and availability data layer
- [x] 03.3-02-PLAN.md: Doctor & Clinic profile availability and time-off blocker UI
- [x] 03.3-03-PLAN.md: Calendar timeline multi-shift grid, doctor filter pills, and soft-block override

**UI hint**: Yes

### Phase 4: Labs & Referrals

**Goal**: Clinics can order and track lab tests and refer patients in or out of the network with full loop closure
**Depends on**: Phase 3
**Requirements**: REQ-lab-records, REQ-referrals
**Success Criteria** (what must be TRUE):
  1. From an open visit, staff create a lab order from the local test catalog and route it to in-house workflow or mark it external for a partner lab
  2. Structured results are entered with abnormal values flagged against configurable reference ranges, and released results are viewable by the patient through a secure link
  3. Staff refer a patient in-network (consented history summary) or out-of-network (PDF referral letter with clinical summary)
  4. Referrals show Sent → Acknowledged → Completed status with closing-the-loop notes when the patient returns

**Plans**: 2/3 plans executed
**Wave 1**
- [x] 04-01-PLAN.md: Wave 1 — Storage Provider Abstraction (`lib/storage/`), Prescriptions/Billing Refactor & Database Migrations (`000013_labs_and_referrals.sql`)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 04-02-PLAN.md: Wave 2 — Lab Document Uploads (`features/labs/`), Patient Profile "Lab Reports & Records" Tab, and Public Tokenized Viewer (`/reports/view`)

**Wave 3** *(blocked on Wave 2 completion)*
- [ ] 04-03-PLAN.md: Wave 3 — Referrals Lifecycle (`features/referrals/`), Branded PDF Letter Generator, Consultation Integration, and Centralized Register (`/referrals`) with Loop Closure

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
  6. Security hardening & dev cleanup: Audit and permanently disable temporary dev-only auth logger (`lib/auth/dev-logger.ts`, console/file OTP printing, and invite link exposure) before production release.

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Tenant Isolation | 5/5 | Complete | 2026-10-07 |
| 2. Patient Records & Scheduling | 4/4 | Complete | 2026-10-08 |
| 02.1. UI/UX Re-foundation (TailAdmin) | 5/5 | Complete | 2026-10-08 |
| 3. Consultation & Prescribing | 4/4 | Complete    | 2026-10-15 |
| 03.1. Doctor Cabin, RBAC & Billing | 4/4 | Complete | 2026-10-15 |
| 03.2. Patient Visit History & Visits Register | 0/2 | Ready to plan | - |
| 4. Labs & Referrals | 2/3 | In Progress | - |
| 5. Communications & AI Assist | 0/- | Not started | - |
| 6. API & Launch Readiness | 0/- | Not started | - |
