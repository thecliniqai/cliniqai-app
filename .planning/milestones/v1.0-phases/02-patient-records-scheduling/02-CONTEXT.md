# Phase 2: Patient Records & Scheduling - Context

**Gathered:** 2026-10-07  
**Status:** Ready for planning  

<domain>
## Phase Boundary

Front desk can register and find any patient in seconds and run the day's booking and walk-in queue from one screen. This covers patient registration, deduplication warnings, DOB/Age dual-input, unified Reception Desk queue (scheduled visits and walk-ins), per-doctor day timeline calendar, double-booking override safeguards, and waitlist auto-promotion on cancellation.

</domain>

<decisions>
## Implementation Decisions

### Patient Intake & Demographics
- **D-01: Dual Age and Date of Birth Storage with Bidirectional Derivation** — **Reversibility:** costly — affects database schema, patient forms, and compliance data models.
  - Both `date_of_birth` (DATE) and `age` (INTEGER) are stored in the database for every patient record.
  - If exact DOB is known: staff enters DOB -> `age` is auto-calculated and both are stored.
  - If DOB is unknown: staff enters `age` in years -> DOB is calculated and stored as `01-Jan-(CurrentYear - Age)`, and both `age` and `date_of_birth` are stored.
- **D-02: Non-Blocking Duplicate Warning Banner**
  - When intake detects likely duplicates (matching phone or matching name + approximate age), show a non-blocking inline warning banner displaying the matching patient summary card.
  - Provides two actions: "View Existing Patient" (to reuse existing record) and "Continue Creating as New" (supports family members sharing a phone number).
- **D-03: Quick-Intake vs Full Registration**
  - Existing patients can be added to queues or waitlists with a 1-tap search selection; new patients require full pre-intake before joining the waitlist or appointment schedule.

### Queue & Reception Desk Architecture
- **D-04: Unified Visit Model with Layered Queue Tokens** — **Reversibility:** costly — defines core operational visit schema.
  - Scheduled appointments and walk-in visits share the same underlying visit/appointment entity.
  - A visit record tracks origin type: `scheduled` vs `walk_in`.
  - Queue token management is an operational layer on top of visits that tracks daily token sequence, queue position, and physical arrival.
  - Reception Desk displays a single unified live queue showing both scheduled appointments (with scheduled time) and walk-in patients (with token number).
  - Queue order follows FIFO and queue-lock rules rather than simply ordering by appointment time.
- **D-05: Queue Workflow Progression**
  - Clinical statuses: `Waiting` -> `In Consultation` -> `Completed` (with terminal states `No Show`, `Cancelled`).

### Appointment Booking & Doctor Calendar
- **D-06: Double-Booking Prevention with Explicit Overbook Override**
  - Slots already booked block duplicate bookings by default.
  - Staff can explicitly override with 1-tap confirmation: *"Slot already booked by [Patient]. Overbook this slot?"*.
- **D-07: Compact Per-Doctor Day Timeline & Slide-Over Drawer**
  - Calendar displays columns per doctor with time slots (e.g. 15-minute / 30-minute intervals).
  - Booking interactions open a quick slide-over drawer on desktop and mobile bottom sheet per `DESIGN.md`.

### Waitlist & Cancellation Handling
- **D-08: Automatic Waitlist Promotion on Slot Cancellation**
  - When a confirmed appointment is cancelled, the system automatically promotes the first eligible waitlisted patient into the newly opened slot and marks the appointment as *"Booked from waitlist"*.

### the agent's Discretion
- Exact visual badge styling and micro-interactions adhering strictly to `DESIGN.md` light theme tokens.
- Queue token numbering format (e.g., `#A-01` or numeric `#1`, `#2` resetting daily per clinic).
- Keyboard shortcuts for Reception Desk (`Cmd+K` for patient search, `N` for new patient, `Q` for quick walk-in).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture & Design
- `AGENTS.md` §4 (Product Principles - fast common workflows), §7 (Multi-Tenancy), §15 (Forms & Data Entry), §16 (Search), §17 (Appointments & Scheduling)
- `DESIGN.md` (Design tokens, 44px touch targets, mobile bottom sheets, table densities)
- `docs/clinic-management-prd.md` §4.2 (Appointment Scheduling & Queue), §4.3 (Patient Management & EHR)

### Existing Data Layer
- `supabase/migrations/000003_patients_audit_consent.sql` (Existing patient table schema)
- `lib/audit/audit.ts` (Mandatory audit logging on patient view/edit)
- `lib/permissions/` (Role permissions for Receptionist, Doctor, Admin)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `components/ui/button.tsx`, `components/ui/input.tsx`, `components/ui/field.tsx`: foundational UI primitives.
- `lib/supabase/client.ts` and `lib/supabase/server.ts`: cookie-based SSR Supabase clients.
- `lib/audit/audit.ts`: `recordAudit` for logging appointment and patient modifications.
- `lib/auth/tenant.ts`: `getActiveMembership` for tenant-scoped session resolution.

### Established Patterns
- Server Actions for mutations (`features/patients/actions.ts`).
- Zod runtime schema validation (`features/patients/schema.ts`).
- Row Level Security (RLS) policies on every tenant-owned table.

### Integration Points
- `app/(dashboard)/patients/`: extend existing patient list and detail pages with timeline and quick intake.
- `app/(dashboard)/queue/` or `app/(dashboard)/page.tsx`: build the unified Reception Desk dashboard.
- `app/(dashboard)/calendar/`: build the doctor timeline scheduler.

</code_context>

<specifics>
## Specific Ideas
- Non-blocking duplicate warning banner displaying matched card without interrupting typing flow.
- Age vs DOB dual-sync: entering age sets Jan 1 of derived year, entering DOB sets calculated age.
- Reception Desk as a high-density, real-time command center for the front desk staff.

</specifics>

<deferred>
## Deferred Ideas
- Phase 5: Automated two-way WhatsApp notifications and SMS bot for waitlist confirmations.
- Phase 3: Clinical notes, vitals recording with nurse, and e-prescriptions during consultation.

</deferred>

---

*Phase: 02-patient-records-scheduling*  
*Context gathered: 2026-10-07*  
