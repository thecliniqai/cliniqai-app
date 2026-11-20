---
phase: 07
roadmap_id: V2-07
name: Atomic server commands
gate: "G4 (light, per PR): one isolated reviewer + one adversarial security reviewer (roadmap §16), one fix round (lean process, VERIFICATION_LOG 2026-11-15). PO approves."
requirements: [P1-05, P1-04 (in-transaction part), BACKEND D2-D4, PR-5 (walk-in, register+book, collect), PR-7 (available slots), PWA-06a, branch data hook (PO 2026-11-15, placed in V2-07 by PO ruling 2026-11-18)]
plans: [07-00, 07-02, 07-01, 07-03, 07-04]
order: "07-00 → 07-02 → 07-01 → 07-03 → 07-04 (sequential; one local stack)"
migrations: {07-00: 000095_clinic_locations, 07-02: 000096_billing_commands, 07-01: 000097_clinical_commands, 07-03: 000098_front_desk_commands, 07-04: 000099_contract_command_writes}
base_commit: "9910249 (feature/v2 after #6 #8 #10 #9 merged, 2026-11-18)"
branch: "v2/phase-07-atomic-server-commands -> PR into feature/v2"
source: docs/v2/V2_MASTER_ROADMAP.md §10 (P1-04, P1-05, PWA-06), §12 V2-07; docs/v2/TARGET_ARCHITECTURE.md §7.1-§7.6; docs/v2/BACKEND_MIGRATION_PLAN.md D2-D4; docs/v2/FRONTEND_MIGRATION_PLAN.md PR-5, PR-7; docs/v2/PWA_STRATEGY.md §10 (PWA-06a); .planning/phases/03-platform-hygiene/03-07-D1-SPIKE.md (pattern + gaps); 05-PLAN R-20, 000072, 000090 (record_payment as shipped); 06-06 contracts (registerBusy, onAppErrorCode); VERIFICATION_LOG PO rulings 2026-11-15 (branches, lean) and 2026-11-18 (V2-07 scope)
research: "No separate research file. The design is settled (C18, D1 spike); the code inventory of the 8 flows is summarised under 'Current state' below."
---

# V2-07 Atomic server commands: plan

## Goal

Every critical write is one database transaction. If any step fails, nothing persists. Audit and outbox rows exist
only for committed commands. A repeated submit with the same `client_request_id` returns the first result and writes
nothing new.

## Current state (inventory 2026-11-18, file:line in the inventory notes of this phase's summary)

| Flow | Today | Partial-write risk |
|---|---|---|
| Sign-off `completeAndSignConsultation` (`features/consultation/service.ts:667`) | 7 round trips: claim visit, seal prescriptions, PDF, `recordAudit`, 2 webhook enqueues (errors swallowed) | signed visit with unsealed Rx; no audit; lost webhook |
| Amendment `reopenVisitForAmendment` / `finalizeVisitAmendment` (`service.ts:815`, `:925`) | revision insert, visit update, audit; finalize Rx update has its error unchecked | revision without reopen; Rx version bumped without re-sign |
| Check-in `checkInVisit` (`features/queue/service.ts:24`) | `issue_queue_token` RPC, then visit status update (error unchecked), audit | token issued, visit not `waiting`; retry skips the fix |
| Walk-in (`components/queue/walk-in-drawer.tsx:104`, `:156`) | client chains `createPatient` → `createVisit` → `checkInVisit` | orphan patient → duplicate on retry; visit without token |
| Register + book (`components/calendar/booking-drawer.tsx:143`) | client chains `createPatient` → `bookAppointment` (TOCTOU slot check, visit insert, best-effort message) | orphan patient; lost booking message |
| Invoice create `createVisitInvoice` (`features/billing/service.ts:112`) | number RPC (falls back to `INV-<year>-<Date.now()>`), invoice insert, items insert, audit | live empty invoice that later retries return |
| Payment `record_payment` (000090:425) | already one transaction (DEFINER, DB-checked tenant, `has_permission`, command id, audit, outbox) | none; but `completeAndBillConsultation` sends a random command id each call |
| Collect at the desk (checkout drawer) and `completeAndBillConsultation` (`billing/service.ts:727`) | sign → invoice → payment as separate commands; payment failure reported as success with `paymentRecorded:false` | payment silently lost after a retry returns `alreadyBilled` |
| Free slots | no staff-side list; only the patient reschedule route generates slots, in UTC | n/a |

No `location_id` or location table exists. Appointments are `visits` rows. Highest migration 000094.

## Rulings (CTO, under the lean process; PO confirms at the gate)

| # | Ruling | Why |
|---|---|---|
| R-1 | A command RPC is `SECURITY INVOKER` (TARGET §7.1) unless it writes a table whose direct writes are revoked for `authenticated` (V2-05 "rpc_only": payments, invoice updates, and from 07-04 invoices/invoice_items inserts); then it is `SECURITY DEFINER` with the `record_payment` (000090) guard block: actor rule, `p_tenant_id` = active clinic (`authz.full_tenant_ids()`), `has_permission`. | Follows the shipped, gated V2-05 precedent (000072); not a new architecture decision. Recorded as a TARGET §7.1 erratum at close |
| R-2 | Every command takes `p_tenant_id` (from `ServiceContext`) and `p_client_request_id uuid` (required). Idempotency goes through one table `private.command_results(tenant_id, client_request_id, command, actor_id, request_hash, result jsonb, created_at)`, PK `(tenant_id, client_request_id)`, RLS on, no API grants, used only through `private.command_claim()` / `private.command_complete()` (definer). Claim first (`INSERT … ON CONFLICT DO NOTHING`; a concurrent duplicate waits on the PK and then reads the stored result). Same id with a different command, actor or request hash → `IDEMPOTENCY_MISMATCH`. `payments.command_id` stays as is. | One mechanism for multi-row commands (walk-in creates up to 3 rows); a rolled-back command leaves no claim. Retention purge job (30 days) is a V2-13 backlog item |
| R-3 | Audit is written inside the RPC through `public.log_audit` (user) / `private.log_system_audit` (system); the matching app-side `recordAudit` calls are deleted. Webhooks and messages are enqueued inside the RPC through `private.enqueue_webhook_internal` / `private.enqueue_message_internal`. | P1-04 in-tx part; V2-04 handover |
| R-4 | PDF rendering and storage archive stay **after** commit (TARGET §7.1: no external calls in a transaction), unchanged best-effort. The consolidated WhatsApp after sign-and-bill stays post-commit with its existing per-visit dedupe key; moving its SQL-side template build is V2-09c. | Storage and rendering cannot join the transaction |
| R-5 | Branch hook: `public.clinic_locations(id, tenant_id, name, is_default, created_at)`, one default per tenant (partial unique index), backfilled for every tenant and created for new tenants by trigger; `location_id` on `visits`, `queue_tokens`, `invoices` with composite FK `(tenant_id, location_id)`, filled by a BEFORE INSERT default trigger, `NOT NULL` in the same migration (no live data, PO-15). Commands write the default location. Invoice and token numbering stay per tenant in v2.0 (one location = same result). | PO 2026-11-15 branch decision; avoids a live-data migration later |
| R-6 | Invoice numbers come only from `generate_tenant_invoice_number` inside the command; the `Date.now()` fallback is deleted (a failure fails the command). | A guessed number can collide and breaks the FY sequence |
| R-7 | "Collect" = `collect_payment`: get-or-create the visit's invoice (with items) and record the payment in one transaction (desk checkout). `complete_and_bill` = sign-off + `collect_payment` in one transaction. Both share internal `private.*` step functions with the standalone commands so the logic exists once. | TARGET §7 list; closes the D1-spike gap and the lost-payment bug |
| R-8 | Available slots: `public.available_slots(p_doctor_id uuid, p_date date)` STABLE INVOKER, in the clinic's timezone, from `availability_schedule`, `schedule_blocks` and booked visits; returns start/end pairs. V2-07 ships the function and its DB tests; the booking sheet and the reschedule route switch to it in V2-08 (P1-20, M4.3). | PR-7; UI is V2-08 |
| R-9 | Out of V2-07 (owners): staff reschedule / no-show / cancel reason and the patient search endpoint (PR-5 rest, PR-6 → V2-08, P1-20/P1-30); `/api/v1` visit writers (V2-12); `addInvoiceItem`/`deleteInvoiceItem` atomicity and refunds (V2-10, P1-06); amendment webhook (backlog V2-09a). | Roadmap backlog owners |
| R-10 | Client: one shared hook `lib/commands/use-command.ts` (one `client_request_id` per logical submit, re-sent on retry after an error, rotated on success; `registerBusy()` while in flight; `onAppErrorCode()` on failure). The five existing forms (checkout drawer, walk-in drawer, booking drawer, sign-and-bill modal, amendment modal) adopt it with no visual change. Retry/SaveStatus UX and PWA spec 7 are V2-08/V2-10 (PWA-06b). | PWA §10 split |

## Command pattern (copy of the D1 spike, updated for V2-05)

1. Signature `public.<command>(p_tenant_id uuid, <subject ids>, <inputs>, p_client_request_id uuid, p_system_actor text default null) returns jsonb`, `SET search_path = ''`, `SET lock_timeout = '2s'`, every name schema-qualified.
2. Actor rule, then tenant = active clinic, then `has_permission` (42501). The permission strings match `lib/permissions/matrix.ts` (parity case).
3. `private.command_claim(...)`; on replay return the stored result with `replayed: true`.
4. Lock the aggregate root `FOR UPDATE` in `p_tenant_id`; not found → `P0002`.
5. Invariants → `P0001` machine reasons (register each in `RPC_REASON_CODES`, `lib/db/errors.ts`). Writes. Audit. Outbox. `private.command_complete(...)`.
6. `REVOKE ALL … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated` (+ `service_role` only where a system path exists). `npm run db:types` in the same commit.
7. Service wrapper: permission check → `.rpc()` with `ctx.tenantId` → `mapDbError` with fixed messages → zod-parse the result. The old multi-statement code is deleted in the same plan (no flags, PO 2026-11-18).

## Plans

### 07-00 Foundations · S · migration 000095
- `000095_clinic_locations.sql` (R-5) and the `private.command_results` table + `command_claim`/`command_complete` (R-2).
- `lib/commands/use-command.ts` (R-10) and `lib/commands/call-command.ts` (rpc + `mapDbError` + zod parse helper).
- `tests/helpers/fault.ts`: extract the scoped fault-trigger pattern from `tests/billing/record-payment-rpc.spec.ts:220-240`; `tests/helpers/command-catalog.ts`: one shared catalog assertion (prosecdef matches R-1, `search_path`, `lock_timeout`, grants, anon 42501).
- Tests: location backfill + new-tenant default + composite FK cross-tenant refusal (pgTAP); claim/replay/mismatch/concurrent-duplicate (Vitest DB).

### 07-02 Billing: invoice create, payment, collect · M · migration 000096
- `create_invoice(p_tenant_id, p_visit_id, p_items jsonb, p_client_request_id)` DEFINER (R-1, R-6): number, header, items, totals by the existing triggers, audit, all-or-nothing; one live invoice per visit returns the existing invoice as today.
- `collect_payment(p_tenant_id, p_visit_id, p_items jsonb, p_amount, p_method, p_reference, p_notes, p_client_request_id)` (R-7) via shared `private.*` steps; `record_payment` keeps its signature (its system path is used by tests only).
- Rewire `createVisitInvoice`, the checkout drawer and `recordPayment` callers; delete the fallback number.
- Tests: happy path with audit; fault after the items insert → no invoice; replay → one invoice and one payment; two concurrent collects on one visit → one invoice, payments capped at the balance; role matrix (`billing:collect`, the visit's own doctor); cross-tenant and dual-member `NOT_FOUND`.

### 07-01 Clinical: sign-off, amendment, check-in · M · migration 000097
- `sign_consultation(p_tenant_id, p_visit_id, p_client_request_id)`: lock visit, require diagnosis or notes, sign visit, seal active prescriptions, audit, `visit.completed` + `prescription.issued` outbox. PDF after commit (R-4).
- `reopen_visit_for_amendment(…, p_reason, …)` and `finalize_visit_amendment(…)`: revision + reopen in one transaction; Rx version bump + re-sign + audit in one transaction.
- `check_in_visit(p_tenant_id, p_visit_id, p_priority, p_client_request_id)`: wraps the token issue (existing counter logic) + visit `waiting` + audit; a retry repairs a visit left without status (today's bug).
- Rewire the actions; delete the old statement chains.
- Tests per RPC: happy (audit + outbox rows), fault injection (fault on the prescription update / visit update → nothing persists, no outbox), replay, role matrix, cross-tenant; one concurrency case: two sign-offs of one visit → one signature, one outbox pair; ten parallel check-ins of different visits → distinct tokens.

### 07-03 Front desk: walk-in, register + book, sign-and-bill, slots · M-L · migration 000098
- `enqueue_walk_in(p_tenant_id, p_patient_id | p_new_patient jsonb, p_doctor_id, p_priority, p_client_request_id)`: patient (existing or new, dedup check unchanged) + walk-in visit + token, one transaction.
- `register_and_book(p_tenant_id, p_patient_id | p_new_patient jsonb, p_doctor_id, p_scheduled_at, p_duration, p_overbook, p_client_request_id)`: patient + scheduled visit; 23P01 → `SLOT_TAKEN`; `appointment_booked` message enqueued in the transaction (existing dedupe key).
- `complete_and_bill(…)` (R-7): sign-off + collect in one transaction; the service returns a real failure if any part fails (no `paymentRecorded:false` success).
- `available_slots` (R-8).
- Rewire the walk-in drawer, booking drawer (new-patient and existing-patient paths) and sign-and-bill modal to single actions.
- Tests: walk-in fault after the visit insert → no patient, no visit; book race (two bookings of one slot) → one visit, one `SLOT_TAKEN`; replay of each; sign-and-bill fault in the payment step → visit not signed; slots: shifts, blocks, booked visits, clinic timezone across the UTC date line, overbooked visits ignored.

### 07-04 Contract, review, gate · S · migration 000099
- Revoke what no request-path writer needs any more: `INSERT` on `invoices`/`invoice_items` and the direct `UPDATE visits.status` paths replaced by commands (exact list from the 07-01..07-03 writer inventory; anything still used elsewhere is listed, not revoked). pgTAP proves each revoke.
- Docs: TARGET §7.1 erratum (R-1), §7.5 timeout erratum (D1 spike finding 3), BACKEND D3/D4 status, roadmap V2-07 status.
- One isolated reviewer (Sonnet) + one adversarial security reviewer (Opus), fresh context, given the diff only. One fix round; Highs re-checked once; Mediums to the backlog with an owner phase unless they are a cross-tenant or PHI leak.
- Evidence: `node scripts/phase-evidence.mjs 07-atomic-server-commands/evidence 1` + `--ci-run <id>`; 07-SUMMARY, 07-VERIFICATION.

## Acceptance (roadmap §12 V2-07)

| Criterion | Proof |
|---|---|
| Fault injection after step 1 persists nothing | one fault case per RPC (`tests/helpers/fault.ts`) |
| Double-submit produces one record | one replay case per RPC + concurrent-duplicate case on `command_results` |
| Concurrency tests pass | sign-off, check-in, collect, book races above |
| Audit and outbox rows exist only for committed commands | asserted in the happy and fault cases |
| PWA-06a | every write RPC takes a required `p_client_request_id` (catalog test) |
| Branch hook | every visit, queue token and invoice has a same-tenant `location_id` (pgTAP) |

## Execution (lean process)

- Executors: Sonnet `gsd-executor`, one plan at a time, migration numbers fixed above; each plan runs only its affected
  Vitest/pgTAP files plus the existing specs of the flows it rewires, then one e2e lane (`npm run e2e:pr`, desktop)
  at the end of the plan; push and let CI run the full set.
- One "fails without" proof per High finding only. No mutant runs.
- Reviews: Opus only for the adversarial security review; docs/evidence by Haiku.
- New dependencies: none.
