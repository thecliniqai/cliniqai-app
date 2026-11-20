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

# Round 1 for 07-03 (000098 at 1a6c796)

Same two reviewers, fresh context. No Critical or High. Fixed in the same 07-04a round.

| ID | Source | Sev | Finding | Decision |
|---|---|---|---|---|
| G-1 | rev 1, adv L-1 | M | `register_and_book`: the off-duty override hides a block or taken-slot conflict and always stores `is_overbooked = true`, so a free in-shift slot booked with the flag stays bookable (double booking, outside the exclusion constraint) | **Fix 07-04a:** evaluate off-duty, block and taken independently; each override clears only its own conflict; `is_overbooked = p_overbook OR (off-duty overridden AND the slot really is off duty)`; tests: override + block, override + taken, override on a free slot then a second booking → `SLOT_TAKEN` |
| G-2 | rev 2 | M | A replayed Sign & Bill skips the receipt, consolidated WhatsApp and Rx PDF, so a response lost after commit never produces them | **Fix 07-04a with F-7:** on `replayed` run the post-commit steps (idempotent: per-visit WhatsApp dedupe key, archive-if-missing); skip only for `already_billed`; test |
| G-3 | rev 3 | L | `available_slots` lists nothing for a doctor with no stored schedule while booking treats NULL as unrestricted; past slots of today are listed | **Fix 07-04a:** drop past slots. NULL-schedule rule → **backlog V2-08** (decided with the booking sheet that consumes it) |
| G-4 | rev 4 | L | Overbook dialog lost its cause (taken / off duty / blocked) | **Fix 07-04a:** pass `error.reason`; cause-specific text |
| G-5 | rev 5 | L | A template/config fault in the booking message fails the booking with "check the details" | **Fix 07-04a:** `TEMPLATE_NOT_ALLOWED` → INTERNAL with a fixed config text, logged with an error tag |
| G-6 | rev 6 | L | `emergency_contact` accepts any JSON object ≤ 2 KB | **Fix 07-04a:** pin the key set to the old `patientSchema` shape |
| G-7 | rev 7 | — | Mismatch cases missing for `p_reason`, `p_duration_minutes`, `p_override_block`; override combinations; replay post-commit | **Fix 07-04a:** add |
| G-8 | adv L-2 | L | `request_hash` is an unsalted md5 over the new patient's PHI | **Fix 07-04a:** keyed digest (pgcrypto `hmac`, sha256) with a random key held in a private, ungranted table created by the migration; applies to every command's hash |
| G-9 | adv L-3 | L | `p_doctor_id` can be any active member (a receptionist can be "Dr.") | **Fix 07-04a:** require a clinician role (owner/doctor, per `lib/permissions/matrix.ts`) in `step_create_visit`, `slot_conflict` and `available_slots` |

# 07-04 contract (from the 07-03 writer inventory)

- `invoices`: no request-path writer inserts headers any more → **revoke INSERT from `authenticated`** in 000099 (pgTAP).
- `invoice_items` insert/delete (`addInvoiceItem`/`deleteInvoiceItem`), `visits` status/draft updates, `patients` insert/update,
  `/api/v1` writers: still in use → **not revoked**; owners V2-10 (items), V2-08 (visit status commands: reschedule, cancel,
  no-show, P1-20), V2-12 (`/api/v1`). Recorded in 07-SUMMARY.
- `createVisit`/`createPatient` services stay for waitlist promotion, the patients/new page and `/api/v1`.

# 07-04a outcome (the single fix round)

Commits: **DB** = `9f8d198` (migration `000099_command_review_fixes.sql`, pgTAP, snapshot, registries) + `65ae09e` (an `array_append`
fix found by the specs); **APP** = `27735da` (services, forms); **TEST** = `4ddabad` (Vitest specs). Evidence of the tool runs is in
the PR (CI link + SHA), not here. Local at the end of the round: full Vitest 320 files / 6721 tests, pgTAP 49 files / 8083 tests,
typecheck, eslint (0 errors) and `npm run inventory` clean; one browser lane at the end (`npm run e2e:build && npm run e2e:pr`): 629 passed, 233 skipped by the projects' own device filters, exit 0 (the known-bug expected failures and the network-block canary are the lane's designed failures).

| ID | Outcome | Commit | Test |
|---|---|---|---|
| F-1 | **Fixed.** `audit_client_actions()` and `AUDIT_ACTIONS` lose the five command-only actions (`COMMAND_ONLY_AUDIT_ACTIONS` lists them); the commands write them through the new no-grant `private.log_command_audit`. `patient.create`, `visit.create` and `invoice.payment_recorded` stay: app code still writes them (`recordAudit`, `/api/v1`) | DB | pgTAP `command_review_fixes` (5 forged actions refused, control, commands still write their rows); `tests/audit/log-audit-allowlist.spec.ts` (parity, PostgREST refusal for receptionist and owner, no API grant on the writer); every command spec still asserts its audit row |
| F-2 | **Fixed.** `step_sign_consultation`: consultations + prescriptions + appointments:edit; finalize: same three; reopen: consultations + appointments:edit; check-in/walk-in/booking/billing already name the family they write | DB | pgTAP: the matrix is overridden inside the rolled-back transaction (no real role holds consultations:edit without the others) and a caller lacking `prescriptions:edit` / `appointments:edit` is refused by sign-off, finalize and reopen; control with an unrelated permission denied |
| F-3 | **Fixed.** `visits_integrity_guard` adds `location_id` to the signed-visit fields | DB | pgTAP: signed visit refused (`VISIT_SIGNED_FIELD_IMMUTABLE`), unsigned visit allowed |
| F-4 | **Fixed.** `command_claim` / `command_complete`: EXECUTE revoked from authenticated and service_role; a system claim needs `current_setting('role') = 'service_role'`; comments corrected | DB | pgTAP grantee sets (definer registry, clinic_locations); `tests/commands/command-results.spec.ts` (direct call 42501, wrapper calls, system claim outside the service role `ACTOR_INVALID`); catalog helper `noApiGrant` |
| F-5 | **Fixed.** `finalize_visit_amendment` result is ids and flags; the service reads the reason from `visit_revisions`. Audit of the other results: ids, numbers, amounts, statuses, flags only | DB + APP | `expectDataOnlyStoredResult` (no whitespace/free text, keyed hash) in the happy path of all nine commands; exact result in the amendment spec |
| F-6 | **Fixed, with a product note.** Sign only from `waiting` / `in_consultation`, else `VISIT_NOT_SIGNABLE` ("Check the patient in before signing this consultation."). The calendar timeline still links "Start Consultation" for booked/confirmed visits: those now need a check-in before the signature (PO to confirm at the gate) | DB + APP | sign spec (booked, confirmed, cancelled, no_show refused; waiting, in_consultation signed; service text); pgTAP; guard world gets a `waitingVisit` |
| F-7 | **Fixed.** Replayed sign-off, finalize and Sign & Bill render the prescription PDF when `pdf_storage_path` is missing and the receipt when the storage object is missing | APP | sign spec (untouched replay renders nothing, lost post-commit renders once); amendment spec (amended PDF with the reason read back); complete_and_bill spec |
| F-8 | **Fixed.** `private.invoice_items_normalize`: `ITEM_COUNT_INVALID`, `ITEM_DESCRIPTION_INVALID`, `ITEM_PRICE_INVALID`, `ITEM_QUANTITY_INVALID`, `INVOICE_TOTAL_INVALID` (cap 10,00,000 kept); `invoiceItemSchema` mirrors the bounds; the checkout custom-charge row shows field errors; one fixed text per reason | DB + APP | create_invoice input table (18 causes, one reason each), `schemas.spec.ts` bounds, error-map cases |
| F-9 | **Backlog V2-08** (unchanged) | | |
| F-10 | **Fixed.** `createInvoice` Result action (the old `createVisitInvoice` action is replaced; the service keeps the legacy shape for readers); the zero-amount checkout uses it | APP | create-invoice spec (real codes, field errors, `IDEMPOTENCY_MISMATCH`), guard manifest and valid input renamed |
| F-11 | **Fixed.** Service checks 10 and 500 with separate messages | APP | amendment spec |
| F-12 | **Fixed.** The amendment form is a child that exists only while the dialog is open (no reset during render) | APP | component has no jsdom lane; covered by the e2e lane and typecheck |
| F-13 | **Fixed.** `useCommand` keeps the id after an unknown outcome (thrown error, `DEPENDENCY_FAILED`, `INTERNAL`): `settle()` after the checkout reloads billing details, `startOver()` offered by the walk-in and booking drawers; a changed submit is refused until then. The rule lives in the runner, so Sign & Bill, amendment and check-in follow it too | APP | `tests/commands/use-command.spec.ts` (5 cases) |
| T-1 | **Fixed** | TEST | collect_payment (reference, notes, discount, tax, items), create_invoice, complete_and_bill (tax, items, reference, amount) mismatch cases |
| T-2 | **Backlog V2-14** (unchanged) | | |
| N-1 | **Confirmed.** The catalog has exactly one function inserting into `invoices` (`private.step_create_invoice`); the grep finds no request-path insert; INSERT is revoked | DB | pgTAP privilege and direct-insert refusal; matrix `rpc_only` for the invoices INSERT; `invoice-totals-db.spec.ts` |
| G-1 | **Fixed.** `private.slot_conflicts` returns every conflict; `is_overbooked = p_overbook OR (off-duty override used AND slot really off duty)` | DB | register_and_book spec: override + block, override + taken, block override + taken, free-slot overrides then a second booking (`SLOT_TAKEN`), real off-duty overbooking |
| G-2 | **Fixed with F-7.** The consolidated WhatsApp had NO dedupe key (the plan said it did): `sendConsolidatedConsultationWhatsApp` takes an optional `dedupeKey`, Sign & Bill passes `consultation_documents:<visit>`; a manual resend passes none; skipped only for `already_billed` | APP | complete_and_bill spec (one message after two replays; none for already billed) |
| G-3 | **Fixed (past slots).** NULL-schedule rule stays backlog V2-08 | DB | available-slots spec (yesterday empty, today only future, same grid on a future day) |
| G-4 | **Fixed.** `error.reason` reaches the dialog; text per cause (`overbookCauseText`, the title for a taken slot is unchanged for the e2e) | APP | `slot-conflict-text.spec.ts` |
| G-5 | **Fixed.** `TEMPLATE_NOT_ALLOWED` → INTERNAL with a fixed configuration text, `log.error` by tag | APP | `booking-template-fault.spec.ts` (mocked command: no shared template table is touched) |
| G-6 | **Deviated on the source.** The old `patientSchema` had `z.record(z.unknown())` (git history has nothing narrower), so the key set is the shape the app writes and reads: `name`, `phone`, `relation` (strings, 200 characters). `patientSchema` is strict too | DB + APP | walk-in input cases (4 refusals), stored shape, null |
| G-7 | **Fixed** | TEST | register_and_book (reason, duration, both overrides), walk-in (reason, duration), complete_and_bill, collect_payment |
| G-8 | **Fixed.** HMAC-SHA256 with a random key in `private.command_hash_key` read by `private.command_request_hash`; every command uses it. Rows stored before the migration keep md5 (development data only) | DB | pgTAP (key, privileges, stable and keyed digest); `expectDataOnlyStoredResult` checks the 64-hex digest in each command spec |
| G-9 | **Fixed.** Clinician = a role that holds `consultations:edit` (owner, doctor) in `step_create_visit`, `register_and_book`, `slot_conflicts`, `available_slots`. The staff doctor directory also lists an admin with credentials as a doctor; such an admin is now refused as a visit's doctor (they cannot sign either): PO to decide whether the directory should drop them | DB | pgTAP; walk-in, register_and_book (receptionist, nurse, admin refused; owner, doctor allowed), available-slots specs |
| Contract | **Done.** `REVOKE INSERT ON public.invoices FROM authenticated, anon` | DB | pgTAP; `billing_rpc_only` (direct insert refused, definer role still inserts), matrix generator, `invoice-totals-db` |
