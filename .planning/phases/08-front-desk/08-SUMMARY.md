# V2-08 Front desk: summary

**Outcome:** the front desk runs from one live screen. Today (front desk, triage and doctor modes) updates over a private
Realtime topic with a polling fallback. Walk-in, check-in, vitals, registration with duplicate detection, booking,
reschedule, cancel and no-show are single atomic commands with SaveStatus and retry-once. Branch
`v2/phase-08-front-desk`, PR #14 into `feature/v2`, base `9ce25d7`. 68 commits, about 390 files.

## What shipped

| Plan | Migration | Changes |
|---|---|---|
| 08-01a | — | `useCommand` timeout (15 s) and retry-once with the same request id, `SaveStatus` (PWA-06b, F-9); admins dropped from the doctor picker; consult entry needs `consultations:edit`; Vitest report floor re-measured |
| 08-01b | 000100 | Visit state machine (DB trigger and TS table with a parity test); `start_consultation` checks the patient in and starts in one command (PO ruling at the V2-07 gate) |
| 08-02 | 000101 | `GET /api/patients/search` (trigram), PatientPicker, QuickRegister, `register_patient` command with advisory duplicate check (AI-14, PO-3 receptionist registration) |
| 08-03a | 000102 | Today board, `today:<tenant_id>` private broadcast (`{kind, visit_id}`, no PHI) with `authz.today_topic_allowed`; 20 s polling fallback; safe refresh (online and `/api/health` answers) |
| 08-03b | — | Walk-in, vitals, nurse and doctor modes; `/`, `/queue`, `/cabin` retired into `/today` (307 / 308) |
| 08-04a | 000103 | Staff reschedule, cancel, no-show and block commands; `available_slots` rule for doctors without a stored schedule (G-3); patient self-reschedule fixes (IST slots) |
| 08-04b | — | `/schedule` (day and week), booking and reschedule sheets as search-param routes; `/calendar` and `/patients/new` redirect |
| 08-05 | 000104, 000105 | Name search fix (digits); clinic switcher (P1-12); Smart Assist slot suggestions (AI-13); command latency record; device checklist and PO walkthrough |
| 08-06a | 000106 | Review fixes (`08-REVIEW-TRIAGE.md`): vitals merge (A-1, High), waitlist promotion rules, late arrivals, unbilled lane, invoice signals; direct `visits` / `patients` / `waitlist_entries` writes revoked, `visits.metadata` guarded, desk completion only from `waiting`; Secure active-clinic cookie |

## Behaviour changes users may notice

- Home is Today. The old dashboard, queue, cabin and calendar URLs redirect.
- Start Consultation checks a booked patient in. Only owners and doctors start a consultation.
- The desk can complete a visit only while it is waiting. An open consultation is completed by sign-off.
- A late no-show stays in Booked, and moves to Waiting after check-in.
- Staff cancel sends the patient a message by default (one tick turns it off).
- Duplicate detection at registration asks for confirmation and does not block.

## Backlog added (owner)

| Item | Owner |
|---|---|
| A-9: day view of inactive doctors' appointments | V2-11 |
| S-10: test that hosted "public Realtime" is off (PO action 08-P4 covers the setting) | V2-14 |
| S-11: queue token timestamp column grants | V2-14 |
| `hardSignOut` purge capped at 3 s; `/offline` does not re-purge | V2-14 |
| Plan "Deferred, with owner" table (Collect, profile, move doctor, AI-10, messaging governance, CSP, spec 9, branch screens) | as listed in `08-PLAN.md` |

## Decisions

Plan rulings R-1…R-21 and the open-question defaults Q-1…Q-10 (`08-PLAN.md`), taken by the CTO delegate while the PO was away.
CTO rulings in `docs/v2/VERIFICATION_LOG.md` "V2-08 CTO rulings": definer commands met the latency condition (max p95 8 ms
locally, target 150 ms); `find_patient_duplicates` and `available_slots` are definer for trigram-index performance.
A-10 reading (a late no-show shows in Booked, then Waiting after check-in) is recorded in `08-NOTES.md` for the PO to confirm.
