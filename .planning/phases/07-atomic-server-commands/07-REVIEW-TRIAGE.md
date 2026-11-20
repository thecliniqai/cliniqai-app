# V2-07 review triage: round 1 (07-00, 07-02, 07-01 at a35cb9f)

Reviewers (fresh context, diff only, read-only): isolated reviewer (Sonnet), adversarial security reviewer (Opus).
Neither found a Critical or High. Under the lean process every finding below is fixed once in **07-04a** (migration
000099 plus app changes, after 07-03 lands) or sent to the backlog with an owner phase. 07-03 gets its own review.

| ID | Source | Sev | Finding | Decision |
|---|---|---|---|---|
| F-1 | adv 1 | M | `private.audit_client_actions()` still lets any member write `visit.complete_and_sign`, `visit.reopen_for_amendment`, `visit.amend_finalized`, `invoice.create`, `queue.check_in` through `log_audit`, so a forged trail is possible | **Fix 07-04a:** remove the five (plus the 07-03 command actions) from the allow-list and from `AUDIT_ACTIONS`; parity spec updated; pgTAP: a nurse's `log_audit('visit.complete_and_sign', …)` is refused |
| F-2 | adv 2 | M | Definer clinical commands rely on `consultations:edit ⊆ prescriptions:edit ∩ appointments:edit` (RLS bypassed) | **Fix 07-04a:** explicit `has_permission` for every table family each command writes (prescriptions:edit for sign/finalize, appointments:edit for visit status), so a future matrix change cannot widen access. Definer mode itself: PO ruling at the gate (VERIFICATION_LOG 2026-11-20) |
| F-3 | adv 3 | L | `location_id` editable on signed visits; caller-chosen on queue tokens | **Fix 07-04a:** add `location_id` to the signed-visit immutability guard; pgTAP |
| F-4 | adv 4 | L | `command_claim`/`command_complete` granted to `authenticated`/`service_role` although only definer owners call them; system path lacks the `role = service_role` check; stale header comment | **Fix 07-04a:** revoke EXECUTE from authenticated and service_role; system path requires `current_setting('role') = 'service_role'`; catalog test updated |
| F-5 | adv 5, rev 6 | L | `finalize_visit_amendment` stores `amendment_reason` (free text, possible PHI) in `command_results.result` | **Fix 07-04a:** stored results hold ids, numbers, amounts and flags only (audit all 07 commands for free text); the service reads the reason from `visit_revisions` when needed. Retention purge stays V2-13 (backlog, gating) |
| F-6 | adv 6, rev 7 | L | Sign-off accepts cancelled / no_show / booked visits and now emits guaranteed webhooks for them | **Fix 07-04a:** sign only from `waiting` or `in_consultation` (check the cabin flow), else `VISIT_NOT_SIGNABLE` |
| F-7 | rev 1 | M | A replay skips the post-commit PDF, so a commit followed by a lost response never archives the Rx PDF | **Fix 07-04a:** after a replay, render if the archive is missing (sign-off, finalize, and 07-03's complete_and_bill receipt) |
| F-8 | rev 2 | M | DB invoice-item bounds (description 1-200, no control chars, qty ≤ 99, price ≤ 10,00,000) are stricter than zod; one generic `INPUT_INVALID` | **Fix 07-04a:** mirror the bounds in `invoiceItemSchema` and the item inputs (field-level errors), distinct reasons per cause. Price cap kept (PO may raise it; noted at the gate) |
| F-9 | rev 3 | M-L | `useCommand` has no client timeout: a hung request wedges the hook and holds `registerBusy` | **Backlog V2-08 (PWA-06b):** client timeout, retry-once and SaveStatus are that item's scope (plan R-10) |
| F-10 | rev 4 | L | Zero-amount checkout wraps every failure as `CONFLICT`, so lock/sign-out/mismatch handling never fires | **Fix 07-04a:** `Result`-returning `createInvoice` command action, as for `collectPayment` |
| F-11 | rev 5 | L | Amendment reason > 500 chars gets the "at least 10 characters" message | **Fix 07-04a:** service checks both bounds; separate message |
| F-12 | rev 8 | L | `reopen.reset()` called during render in the amendment modal | **Fix 07-04a:** reset in an effect on open (or `key` the form) |
| F-13 | rev 9 | L | After a committed-but-lost payment, editing the form rotates the id and can record a second partial payment | **Fix 07-04a:** after a failure whose outcome is unknown (network/timeout/INTERNAL), the drawer reloads billing details before a new id may be issued |
| T-1 | rev tests | — | `collect_payment` mismatch tests don't vary reference/notes/discount/tax | **Fix 07-04a:** add cases |
| T-2 | rev tests | — | No end-to-end `40P01` → `CONCURRENT_WRITE` test (sign-off vs draft save) | **Backlog V2-14** (security/robustness sweep) |
| N-1 | rev note | — | Per-tenant advisory lock on invoice numbering can give `LOCK_TIMEOUT` under a burst of checkouts; numbering is count-based and safe only while every writer takes the lock | **07-04:** confirm no other invoice writer remains after the revoke; FY counter table replaces count-based numbering in V2-10 (P1-06) |

Backlog entries go to `docs/v2/V2_MASTER_ROADMAP.md` §10 notes at close (F-9 → V2-08, T-2 → V2-14, command_results
retention → V2-13).
