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
