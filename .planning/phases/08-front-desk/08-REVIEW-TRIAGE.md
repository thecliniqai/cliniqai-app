# V2-08 review triage (CTO delegate, 2026-11-21)

Sources: `08-REVIEW-A.md` (isolated, Sonnet), `08-REVIEW-SEC.md` (adversarial, Opus). No Critical; one High (A-1).
Lean process: one fix round (08-06a), no re-check round unless a fix is High-risk; affected tests + one e2e lane, CI runs all.

| ID | Sev | Decision | Fix (08-06a unless noted) |
|---|---|---|---|
| A-1 | High | Fix | Vitals sheet prefills the stored vitals; saving merges the changed fields into the stored object (never drops earlier readings). Spec: record BP, then record pulse only → both stored |
| A-2 | Med | Fix | Waitlist promotion checks shifts and blocks (same slot rule as booking); cancel reasons "doctor unavailable" and "clinic closed" never promote. Spec per case |
| A-3 | Med | Fix | A late no-show whose slot was rebooked can be checked in / started (it joins the queue; its old slot must not block it). Spec with the slot rebooked |
| A-4 | Med | Fix | A completed visit without an invoice reads "Not billed" and stays in the to-bill lane for roles with billing:view. Spec |
| A-5 | Med | Fix | Invoice and payment changes signal `today:<tenant>` (no PHI). Spec |
| A-6 | Low | Fix | Register sheet resets save state on close |
| A-7 | Low | Fix | Staff reschedule keeps the visit's own duration |
| A-8 | Low | Fix | "Block time" shown only to roles the service allows |
| A-9 | Low | Defer V2-11 | Day view of inactive doctors' appointments (staff screens) |
| A-10 | Low | Fix | Late-arrival (no_show → waiting) rows appear in Waiting, not Done |
| S-1 | Med | Fix | Direct INSERT on `visits` revoked from `authenticated` if no request-path writer remains (inventory in notes); otherwise a BEFORE INSERT trigger enforcing initial status booked/confirmed/waiting, doctor = owner/doctor member, slot rules. pgTAP |
| S-2 | Med | Fix | `waitlist_entries` INSERT/UPDATE revoked from `authenticated` (commands are the writers). pgTAP |
| S-3 | Med | Fix | `visits.metadata` UPDATE revoked unless a request-path writer needs it; if one does, freeze it on signed/completed visits, allowlist keys, size cap. pgTAP |
| S-4 | Med | Fix | `complete_visit` (desk) only from `waiting`; an `in_consultation` visit is completed only by sign-off commands. Spec |
| S-5 | Low | Fix | Audit actions now written only by commands removed from `log_audit`'s allowlist (pgTAP) |
| S-6 | Low | Fix | Anon reschedule context returns free slots only, never other appointments' times |
| S-7 | Low | Fix | Realtime read policy also checks each row's topic equals the session topic |
| S-8 | Low | Fix | `patients` INSERT revoked from `authenticated` if no request-path writer remains (dead `createPatient` deleted) |
| S-9 | Hard | Fix | `clinic_active_tenant` cookie `Secure` in production (not on loopback e2e) |
| S-10 | Hard | Defer V2-14 | Test for hosted "public Realtime" off; PO action 08-P4 covers the setting |
| S-11 | Hard | Defer V2-14 | Queue token timestamps column grants |
| S-12 | Hard | Done | Ruling recorded in VERIFICATION_LOG 2026-11-21 (definer reads, measured) |
| — | — | Defer V2-14 | `hardSignOut` purge capped at 3 s before navigation; `/offline` does not re-purge (WebKit flake debug) |

## 08-06a outcome (2026-11-21)

One migration, `000106_front_desk_review_fixes.sql`. Commit shas are on `v2/phase-08-front-desk`; "pgTAP" is `supabase/tests/database/front_desk_review_fixes.test.sql` (54 tests); "e2e" is `tests/e2e/today/review-fixes-08-06a.spec.ts`. Details: `08-NOTES.md` section "08-06a".

| ID | Commit | Test that fails without the fix |
|---|---|---|
| A-1 | 694ac03 | `tests/visits/record-vitals-merge.spec.ts` "record BP, then record pulse only: both are stored"; e2e "A-1: the vitals sheet opens with the recorded readings; a second reading keeps the first" |
| A-2 | c3d8e62 (SQL), ee137e4 (specs) | pgTAP "A-2: cancelling a slot under a schedule block promotes nobody", "...doctor_unavailable never promotes", "...clinic_closed"; `tests/visits/cancel-visit-rpc.spec.ts` "A-2: the reason doctor_unavailable / clinic_closed never promotes", "a slot under a schedule block promotes nobody", "a clinic-wide block counts too, and a slot the doctor does not work" |
| A-3 | c3d8e62 (SQL), 5132d04 (audit refinement, specs) | pgTAP "A-3: the late no-show whose slot V9 now holds is checked in as an overbooked visit"; `tests/queue/check-in-rpc.spec.ts` "A-3: a late no-show whose slot was rebooked is checked in as an overbooked visit"; `tests/queue/start-consultation-rpc.spec.ts` "A-3: ... is started as an overbooked visit" |
| A-4 | 5f8660b, ee137e4 | `tests/today/get-today-board.spec.ts` "A-4: a completed visit with no invoice is Not billed and in To bill ..." and "A-4: a cancelled invoice does not count as billed"; e2e "A-4: a signed visit nobody has billed is in To bill as Not billed" |
| A-5 | c3d8e62, ee137e4 | pgTAP "A-5: an invoice insert signals {kind: invoice, visit_id}", "a change of the total signals", "a change of the status signals", "a write of another column signals nothing"; `tests/realtime/today-signals.spec.ts` (the invoice kind is delivered) |
| A-6 | 16af0bb | e2e "A-6: a registration that failed to save leaves no 'Couldn't save' behind: the next open is an empty form" |
| A-7 | 16af0bb | e2e "A-7: moving a 30-minute appointment keeps it 30 minutes long" |
| A-8 | 16af0bb | e2e "A-8: the receptionist is not offered Block time", "the owner blocks any doctor or the whole clinic", "a doctor blocks their own time only" |
| A-10 | 5f8660b, ee137e4 | `tests/today/get-today-board.spec.ts` "A-10: a no-show whose time passed today is in Booked ..."; e2e "A-10: a late no-show is in Booked, and checking it in moves it to Waiting" |
| S-1 | c3d8e62, 0094b6e (`createVisit` deleted), 23f93cf | pgTAP "S-1: a receptionist cannot insert a visit (the reviewer's completed-visit forgery)" (and doctor, owner, grants); `tests/security/front-desk-direct-writes.spec.ts` "S-1: no member inserts a visit" (4 roles); `tests/authz/table-matrix.spec.ts` |
| S-2 | c3d8e62, 74dc805 | pgTAP "S-2: a receptionist cannot insert a waitlist entry (forged attribution)", "nor update one (re-open a promoted entry)"; direct-writes spec "S-2: no member writes the waitlist directly" |
| S-3 | c3d8e62 (guard trigger), 74dc805 (draft save merges the two keys) | pgTAP "S-3: a receptionist cannot forge the confirmation keys" ... "the consultation draft still writes the AI provenance" (9 tests); direct-writes spec "S-3: visits.metadata is the AI provenance of an open draft, nothing else" (3) |
| S-4 | c3d8e62, 5132d04 | pgTAP "S-4: a receptionist cannot complete a doctor's open consultation at the desk"; `tests/queue/complete-visit-rpc.spec.ts` "S-4: %s cannot complete an in_consultation visit at the desk" (5 roles) |
| S-5 | c3d8e62 | pgTAP "S-5: a receptionist cannot write a forged appointment.cancel row"; `tests/audit/log-audit-allowlist.spec.ts` "S-5: a receptionist and the owner cannot forge %s" (5 actions) |
| S-6 | c3d8e62, ee137e4 | pgTAP "S-6: it has no list of booked times", "...no other appointment's time"; `tests/scheduling/patient-reschedule.spec.ts` "S-6: the anon context of a link ..."; `tests/security/review-fixes-db.spec.ts` (the old window case now asserts no list) |
| S-7 | c3d8e62 | pgTAP "S-7: a member of A with the session topic of A sees A's signals only, never B's", "...with the session topic of B sees nothing", policy shape |
| S-8 | c3d8e62, 0094b6e (`createPatient` deleted), 23f93cf | pgTAP "S-8: a receptionist cannot insert a patient"; direct-writes spec "S-8: no member inserts a patient" (2 roles + register_patient + update stays) |
| S-9 | 96b2dea | `tests/clinics/switch-clinic-db.spec.ts` "S-9: in production the cookie is Secure whatever the proxy said, except on loopback" |

Not fixed here (as triaged): A-9 (V2-11), S-10, S-11 (V2-14), the `hardSignOut` purge cap (V2-14); S-12 was Done.
