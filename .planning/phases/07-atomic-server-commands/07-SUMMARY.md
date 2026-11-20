# V2-07 Atomic server commands: summary

**Outcome:** every P1-05 critical write is one database transaction with in-transaction audit and outbox, and
idempotent by `client_request_id`. The branch data hook is in place. Branch `v2/phase-07-atomic-server-commands`,
PR #11 into `feature/v2`, base `9910249`, verified at `9b79e91` (CI 44760574035 green, 0 retried). 22 commits,
102 files.

## What shipped

| Plan | Migration | Commands / changes |
|---|---|---|
| 07-00 | 000095 | `clinic_locations` (one default per clinic) and `location_id` on visits, queue tokens, invoices; `private.command_results` with `command_claim`/`command_complete`; `lib/commands/{use-command,call-command}.ts`; test helpers `fault.ts`, `command-catalog.ts` |
| 07-02 | 000096 | `create_invoice`, `collect_payment`; shared `private.step_create_invoice`/`step_record_payment`; `record_payment` reuses the step; invoice-number fallback deleted; per-clinic numbering lock |
| 07-01 | 000097 | `sign_consultation`, `reopen_visit_for_amendment`, `finalize_visit_amendment`, `check_in_visit`; shared `step_sign_consultation`/`step_check_in` |
| 07-03 | 000098 | `enqueue_walk_in`, `register_and_book` (booking message in the transaction), `complete_and_bill`, `available_slots` (INVOKER, clinic time zone; no UI until V2-08) |
| 07-04a | 000099 | Review fixes (`07-REVIEW-TRIAGE.md`); `invoices` INSERT revoked; command-only audit actions removed from `log_audit`; keyed request hashes; no free text in stored results |

Old multi-statement paths were deleted in the same plans (no flags, PO ruling 2026-11-18).

## Behaviour changes users may notice

- A payment failure in Sign & Bill now fails the action instead of reporting success without a payment.
- Check-in refuses completed/cancelled visits; sign-off requires `waiting` or `in_consultation` (gate item 2).
- Amendment reason 10–500 characters; invoice lines validated field by field (description ≤ 200, quantity ≤ 99,
  price ≤ ₹10,00,000).
- A visit's doctor must be an owner or doctor (gate item 3).
- Booking overrides now clear only their own conflict: an off-duty override no longer hides a taken or blocked slot.
- Finalising an amendment no longer signs a visit that was never signed.

## Not revoked (still used; owner phase)

`invoice_items` insert/delete (`addInvoiceItem`/`deleteInvoiceItem`) → V2-10; `visits` status and draft updates,
staff reschedule/cancel/no-show → V2-08 (P1-20); `patients` insert/update (patients/new page, waitlist, erasure) →
V2-08/V2-13; `/api/v1` writers → V2-12. A member can still change `location_id` on an unsigned visit (same clinic
only) → closed with the branch screens (v2.1).

## Backlog added (owner)

| Item | Owner |
|---|---|
| F-9: client timeout / retry-once / SaveStatus in `useCommand` | V2-08 (PWA-06b) |
| G-3: rule for a doctor with no stored schedule in `available_slots` vs booking | V2-08 (booking sheet) |
| T-2: end-to-end `40P01` → `CONCURRENT_WRITE` test | V2-14 |
| `private.command_results` 30-day purge, and in DPDP erasure | V2-13 |
| N-1: count-based invoice numbering replaced by the FY counter table | V2-10 (P1-06) |
| Re-measure the Vitest report floor (`assert-vitest-report.mjs`) | V2-08 first plan |

## Decisions

Plan rulings R-1…R-10 (`07-PLAN.md`); PO rulings 2026-11-18 (branch hook in V2-07, no per-flow flags);
proposed TARGET §7.1 erratum (definer commands) and applied §7.5 erratum (2026-11-20), pending PO at the gate.
