---
phase: 02-patient-records-scheduling
plan: 04
subsystem: ui
tags: [react, nextjs, calendar, scheduling, overbooking, waitlist-promotion]

requires:
  - phase: 02-patient-records-scheduling
    provides: Unified visits, waitlist_entries tables, and RLS policies from 02-01
provides:
  - Doctor Day Timeline Calendar screen at /calendar
  - DoctorTimeline multi-doctor schedule grid with 15-minute slot intervals
  - Double-booking prevention engine with explicit 1-tap OverbookDialog override (D-06)
  - Slide-over BookingDrawer with doctor pre-selection and patient search/creation
  - Waitlist management and automatic waitlist promotion engine on appointment cancellation (D-08)
  - Comprehensive integration test suite verifying calendar booking, overbooking, and auto-promotion
affects: [scheduling, calendar, reception-desk, waitlist]

actuals:
  tokens: 4500
  tasks: 3
  commits: 1

tech-stack:
  added: []
  patterns: [multi-doctor day timeline grid, double-booking slot conflict detection, waitlist auto-promotion on cancellation]

key-files:
  created:
    - app/(dashboard)/calendar/page.tsx
    - components/calendar/calendar-view.tsx
    - components/calendar/doctor-timeline.tsx
    - components/calendar/booking-drawer.tsx
    - components/calendar/overbook-dialog.tsx
    - components/calendar/waitlist-drawer.tsx
    - features/visits/scheduling.ts
    - features/waitlist/actions.ts
    - tests/scheduling/calendar-waitlist.spec.ts
  modified:
    - features/visits/actions.ts
    - lib/audit/audit.ts

key-decisions:
  - "D-01: Multi-Doctor Day Timeline Grid — /calendar provides a high-density, horizontal multi-column layout per active doctor across 15-minute intervals between 9 AM and 6 PM."
  - "D-02: Double-Booking Conflict Prevention (D-06) — Attempting to book an already occupied slot triggers an informative OverbookDialog warning; confirming proceeds with explicit is_overbooked: true."
  - "D-03: Automatic Waitlist Promotion on Cancellation (D-08) — Cancelling an appointment automatically searches eligible waitlist entries for that day and doctor, promotes the top patient (priority DESC, created_at ASC), and schedules them into the vacated slot with an audit log."

patterns-established:
  - "Appointment cancellations automatically promote the top waitlist patient, recording both waitlist.promote and visit.auto_promoted_from_waitlist audit events."

requirements-completed: [REQ-appointment-booking]

coverage:
  - id: S1
    description: "Booking an appointment occupies the slot on the doctor calendar"
    requirement: "REQ-appointment-booking"
    verification:
      - kind: integration
        ref: "tests/scheduling/calendar-waitlist.spec.ts#1. Booking an appointment occupies the slot on the doctor's calendar"
        status: pass
  - id: S2
    description: "Attempting a second booking without override is rejected with conflict warning"
    requirement: "REQ-appointment-booking"
    verification:
      - kind: integration
        ref: "tests/scheduling/calendar-waitlist.spec.ts#2. Attempting a second booking at the same time without override flag is rejected with conflict warning"
        status: pass
  - id: S3
    description: "Confirming overbook override successfully schedules second appointment with is_overbooked: true"
    requirement: "REQ-appointment-booking"
    verification:
      - kind: integration
        ref: "tests/scheduling/calendar-waitlist.spec.ts#3. Confirming overbook override successfully schedules the second appointment with is_overbooked: true"
        status: pass
  - id: S4
    description: "Adding patient to waitlist records active entry under RLS"
    requirement: "REQ-appointment-booking"
    verification:
      - kind: integration
        ref: "tests/scheduling/calendar-waitlist.spec.ts#4. Adding a patient to the waitlist records an active entry under RLS"
        status: pass
  - id: S5
    description: "Cancelling original appointment automatically promotes waitlisted patient into vacated slot"
    requirement: "REQ-appointment-booking"
    verification:
      - kind: integration
        ref: "tests/scheduling/calendar-waitlist.spec.ts#5. Cancelling the original appointment automatically promotes the waitlisted patient into the slot"
        status: pass

---

## What Was Done

1. **Doctor Day Timeline Calendar (`/calendar`):**
   - Created `app/(dashboard)/calendar/page.tsx` server component with active doctor membership resolution, date query handling, and calendar state feeding.
   - Built `components/calendar/doctor-timeline.tsx` multi-doctor grid with 15-minute intervals (9 AM - 6 PM), occupied slot cards (displaying patient name, duration, reason, overbooked badge, cancel trigger), and 1-tap empty slot booking triggers.
   - Built `components/calendar/calendar-view.tsx` featuring day switcher (`<` / `Today` / `>`), active waitlist banner, and auto-promotion banner notification upon appointment cancellation.

2. **Double-Booking Prevention & Overbooking Override (D-06):**
   - Created `features/visits/scheduling.ts` with `checkSlotAvailability` detecting overlapping bookings in non-cancelled visits for a given doctor.
   - Created `components/calendar/overbook-dialog.tsx` presenting a clear conflict warning modal.
   - Created `components/calendar/booking-drawer.tsx` allowing patient selection or quick registration with side-by-side Age/DOB dual sync. If a slot is booked, triggers `OverbookDialog` and schedules with `is_overbooked: true` only upon confirmation.

3. **Waitlist Management & Auto-Promotion Engine (D-08):**
   - Implemented `features/waitlist/actions.ts` (`addToWaitlist`, `getWaitlistForDate`, `promoteWaitlistEntry`).
   - Implemented `components/calendar/waitlist-drawer.tsx` enabling patient waitlist entry creation with target date, doctor preference, priority, and time window.
   - Extended `cancelVisit` in `features/visits/actions.ts`: cancels visit, queries top eligible waitlist patient, atomically schedules them in the vacated slot with reason `"Booked from waitlist"`, updates waitlist entry to `"promoted"`, and logs `visit.auto_promoted_from_waitlist` audit event.

4. **Integration Verification:**
   - Built `tests/scheduling/calendar-waitlist.spec.ts` covering 5 integration test scenarios. All 5/5 pass. Full test suite (72/72 tests across 12 files) passes. Next.js production build succeeds with 16/16 pages and zero lint errors.
