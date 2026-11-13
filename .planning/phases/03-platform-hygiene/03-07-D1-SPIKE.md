# 03-07 record: D1 confirmation spike, `record_payment` (C18, R-2, AD-7; TARGET §3.2, §6, §7.1; T-03-19)

**Outcome:** done locally. **C18 verdict: confirmed.** One atomic command runs end to end as a `SECURITY INVOKER`
plpgsql function called through the user-scoped supabase-js client: the RLS checks, `auth.uid()` as the actor, the
invoice lock, the invariants, the payment, the status change, the audit row and the outbox rows all happen in one
transaction, and a fault after the payment insert rolls all of it back. The pattern needs four additions TARGET §3.2 /
§7 did not spell out (§"Findings"). Later phases must copy them.
**Commits:** `aabce1f` (migration 000027, generated types), `218e398` (`AppError`, SQLSTATE mapper, unit spec),
`d160aff` (`recordPayment` → RPC, command id from the checkout drawer, billing system path), `cecd545` (DB integration
spec, `tests/helpers/sql.ts`), `353610e` (teardown leak check chunked: the full lane was green but exited 1 on HTTP
414).
**Evidence (`evidence/03-07/`, all tool output):** `static-checks.txt` (typecheck, lint 0 errors, inventory, migration
immutability, types freshness, local drift, from a clean worktree of `353610e`), `vitest-full.json` +
`vitest-report-gate.txt` (full lane, same worktree), `record-payment-rpc.json` (the spike spec on its own),
`negative-no-row-lock.txt` (mutation: the race test fails without `FOR UPDATE`), `timeout-probe.txt`, `timings.json`,
`playwright-summary.txt` + `playwright-results.json` (`e2e:pr`), `gitleaks.txt`.

## Results (tool output)

| Check | Result | File |
|---|---|---|
| typecheck, eslint, inventory (clean worktree of `353610e`) | exit 0; eslint 0 errors, 422 warnings (427 at `f140a1d`; the rewrite removed `any` casts) | `static-checks.txt` |
| Migration immutability vs `origin/feature/v2`; `db:types` freshness; local drift after a fresh `db reset --local` | PASS; `types/database.ts` unchanged; drift PASS (only the allowlisted `pg_net` line) | `static-checks.txt` |
| Spike specs (`record-payment-rpc` 36, `error-map` 30, `teardown` 3) | 69 passed, 0 failed | `record-payment-rpc.json` |
| Negative: `FOR UPDATE` removed from the live function | both race cases fail (2 payments, 2 successes); pass again after restore | `negative-no-row-lock.txt` |
| Full Vitest lane (clean worktree of `353610e`) | 128 files, 2273 passed, 0 failed, 0 skipped; exit 0; teardown removed 109 tenants, 223 users, verified none remain; report gate PASS (floor 1805) | `vitest-full.json`, `vitest-report-gate.txt` |
| `e2e:build` + `e2e:pr` (clean worktree of `353610e`) | 128 passed, 0 failed, 0 retried (checkout-collect and Sign & Bill on desktop and Pixel 7). A first run started 05:28 IST failed `m0/walk-in-token.spec.ts:17` on 3 projects: the helper's UTC `appToday()` differs from the app's IST token date between 00:00 and 05:30 IST (03-05 scope, not the payment path) | `playwright-summary.txt`, `playwright-results.json`, `playwright-results-0528ist.json` |
| UI | The drawer's markup is unchanged (only the submit handler gained the command id), so no 360/820/1280 or axe delta | — |
| gitleaks after the commits | no leaks found | `gitleaks.txt` |

## What shipped

- **Migration `000027_record_payment_rpc.sql`** (expand only):
  - `payments.command_id uuid` + unique `(tenant_id, command_id) where command_id is not null`.
  - `payments.recorded_by_system text` (closed set `system:payment_webhook`), `recorded_by` loses `NOT NULL`, CHECK:
    exactly one of `recorded_by` / `recorded_by_system`. `INSERT` on `payments` for `anon`/`authenticated` becomes a
    column list without `recorded_by_system`, so no request path can forge a system payment.
  - `private` schema (USAGE: `authenticated`, `service_role`; not in `[api] schemas`) with
    `private.outbox_payment_recorded(p_payment_id)`, `SECURITY DEFINER`, `search_path = ''`.
  - `public.record_payment(p_tenant_id, p_invoice_id, p_amount, p_method, p_reference, p_command_id, p_notes default
    null, p_system_actor default null) returns jsonb`, `SECURITY INVOKER`, `search_path = ''`, `lock_timeout = '2s'`.
    Steps: actor rule → input checks → `SELECT … FOR UPDATE` of the invoice **in `p_tenant_id`** → role check
    (`current_user_has_role`, list = `appointments:edit` roles) → replay by command id → invariants (payable status,
    no overpayment) → payment insert → status transition → audit row → outbox fan-out → result
    `{ payment_id, invoice_status, paid_total, total_amount, balance_due, replayed }`. `EXECUTE` revoked from
    `PUBLIC`/`anon`, granted to `authenticated` and `service_role`.
- **`lib/errors/app-error.ts`**: TARGET §6 `AppErrorCode`s, `AppError`, `Result<T>`, default safe messages, reasons only
  in upper-snake shape, `cause` not enumerable (never serialised).
- **`lib/db/errors.ts`** `mapDbError(err, messages?)`: `23505`/`23514`/`23P01` → `CONFLICT` (reason = constraint name),
  `23503` → `PRECONDITION_FAILED`, `42501` → `FORBIDDEN`, `P0001` → the code registered for the raised reason
  (`RPC_REASON_CODES`; unregistered → `CONFLICT`), `P0002` → `NOT_FOUND`, `55P03` → `CONFLICT`/`LOCK_TIMEOUT`, else
  `INTERNAL`. The driver message, details and hint never reach the result.
- **`features/billing/service.ts`**: `recordPayment` checks `appointments:edit`, then `callRecordPayment(ctx.db, …)`
  with `tenantId = ctx.tenantId`; the result is zod-parsed (`recordPaymentRpcResultSchema`); failures return fixed
  texts (`RECORD_PAYMENT_MESSAGES`). The old `err.message` return at the former `service.ts:366` is gone. The old
  five-round-trip flow (read, insert, re-read, update, audit) and its app-side audit are replaced by the RPC; there was
  no app-side `payment.recorded` enqueue, so nothing is double-sent and `lib/webhooks/outbox.ts` is unchanged.
- **`features/billing/schema.ts`**: optional `commandId` (uuid). Without one the service generates a unique id.
- **`components/queue/checkout-drawer.tsx`**: one command id per payment, created on the first submit, re-sent when that
  payment is retried after an error, cleared when checkout completes or the drawer reopens. A lost response or a
  double submit replays the recorded payment.
- **System path:** `features/billing/system.ts` `recordPaymentAsSystem(tenantId, input, systemActor)` through
  `getSystemDb("billing.record_payment_system")` (new `SystemDbReason`, owner `features/billing/system`).
- **Tests:** `tests/billing/record-payment-rpc.spec.ts` (DB lane, 36 cases), `tests/db/error-map.spec.ts` (30 cases),
  `tests/helpers/sql.ts` (local superuser `psql`, factored from `tests/setup/teardown.spec.ts`).

## What was proven (spec → case)

All cases are in `tests/billing/record-payment-rpc.spec.ts` unless named otherwise; results in `record-payment-rpc.json`.

| Claim | Case(s) | Result |
|---|---|---|
| RLS applies (INVOKER, user JWT) | "a cross-tenant invoice id is NOT_FOUND and nothing changes in either tenant"; "a user with no membership gets NOT_FOUND" | `P0002` → `NOT_FOUND`; 0 payments/audit in A and B |
| Active tenant narrows RLS (multi-clinic) | "a member of A and B acting in B cannot pay A's invoice (the active tenant narrows RLS, AR-M2b)"; guard suite leg 3b | `NOT_FOUND` in B; succeeds when acting in A |
| `auth.uid()` is the actor | "happy path …"; role matrix rows | audit `actor_id` = caller, `actor_role` = caller's role, `actor_type = 'user'`; `payments.recorded_by` = caller |
| Audit + outbox in the same transaction | "happy path …"; "the same command twice …" | 1 payment, 1 audit row, 1 outbox row for the subscribed endpoint (0 for unsubscribed, inactive or another tenant's) |
| Rollback on fault | "rollback: a fault in the outbox insert (after the payment and audit inserts) leaves 0 payments, 0 audit, 0 outbox rows and the invoice unchanged" | `XX000` → `INTERNAL`; 0/0/0; invoice still `issued`; the same command id then records normally (nothing survived) |
| Error mapping, no driver text | rollback case via the service; "overpayment …" via the service; `tests/db/error-map.spec.ts` | fixed messages; `SPIKE_FAULT` absent from the result |
| Lock + invariant under concurrency | "concurrent overpayment race: of two 600 payments on a 1000 invoice exactly one succeeds (3 rounds)"; "concurrent full-balance race …" | exactly 1 success, 1 `CONFLICT`/`OVERPAYMENT`, 1 payment row per round. **Negative:** without `FOR UPDATE` both race cases fail (`negative-no-row-lock.txt`) |
| Bounded lock wait (T-03-19) | "a held invoice lock makes the call fail fast with CONFLICT/LOCK_TIMEOUT (lock_timeout 2s), not hang" | `55P03` after ≥ 1.9 s and < 4.5 s while a holder sleeps 5 s |
| Idempotency | "the same command twice …"; "two concurrent submits of one command …"; "reusing a command id with a different amount is IDEMPOTENCY_MISMATCH"; "the service passes the client's commandId …" | same `payment_id`, `replayed: true`, one row/audit/outbox; mismatch → `IDEMPOTENCY_MISMATCH` |
| Role parity with the TS matrix | "the function's role list equals the roles the matrix allows"; `it.each(roles)` | SQL list = `ROLE_PERMISSIONS` roles with `appointments:edit` (all 5 today); every role succeeds and gets its outbox row |
| System path (TARGET §7.1) | "system path via getSystemDb …"; "the system path is bound to the tenant it names …" | `recorded_by = null`, `recorded_by_system = 'system:payment_webhook'`; audit `actor_type/actor_role = 'system'`, `actor_id = null`, `metadata.system_actor`; outbox row; other tenant → `NOT_FOUND` |
| Actor rule | "a user session passing p_system_actor is ACTOR_INVALID"; "the service role without a system actor, or with one outside the closed set, is ACTOR_INVALID" | `P0001 ACTOR_INVALID` → `FORBIDDEN`; 0 rows |
| anon cannot execute | "anon cannot execute record_payment (EXECUTE revoked)"; catalog case | PostgREST `42501`; `has_function_privilege`: anon f, authenticated t, service_role t |
| The definer helper cannot be abused | "the outbox writer is not served by PostgREST" (`PGRST202`); "the outbox writer refuses a payment the current transaction did not insert …" (`OUTBOX_SUBJECT_INVALID`); catalog: anon has no USAGE on `private` | as stated |
| No forged system payment | "a request-path client cannot write recorded_by_system (column privilege) …" | `42501` |
| Invariants | "overpayment is CONFLICT/OVERPAYMENT …"; "a paid/cancelled invoice is CONFLICT/INVOICE_NOT_PAYABLE"; validation `it.each` | as stated, 0 rows |

## Timings (`timings.json`, local CLI stack, nurse session, one subscribed endpoint)

| Measure | Value |
|---|---|
| 30 sequential `record_payment` calls (HTTP through Kong + PostgREST, RLS, definer fan-out) | p50 1.8 ms, p95 2.8 ms, max 2.9 ms |
| 10 parallel payments on one invoice (serialised by the row lock) | all 10 succeed, 47.6 ms wall |
| 10 parallel 300 payments on a 1000 invoice | 3 succeed, 7 `OVERPAYMENT` |
| Lock wait bound (holder sleeps 5 s) | `55P03` after the 2 s `lock_timeout` (spec asserts 1.9–4.5 s) |

The old service flow made five sequential round trips (invoice read, payment insert, payments re-read, invoice
update, audit insert) with no transaction. The command now makes one.

## Findings (what TARGET §3.2/§6/§7 did not say; the pattern must include them)

1. **Outbox tables are owner/admin-only under RLS.** `webhook_subscriptions` and `webhook_delivery_queue` (000018)
   allow only owner/admin, so an INVOKER command run by a doctor, nurse or receptionist cannot see the subscriptions
   it must fan out to. Plain INVOKER silently drops the event (the same latent drop V2-04 04-03b fixes for the
   app-side `enqueueWebhookEvent`). Pattern: a per-event **definer writer in a non-exposed schema** (`private`) that
   takes only the subject id, builds the payload in SQL from the subject row, and refuses a subject row the current
   transaction did not insert (`xmin = pg_current_xact_id()::xid`) and, for a user caller, a subject outside the
   caller's tenants. It cannot forge, replay or cross tenants even if it were exposed.
2. **RLS is "member of any of my tenants", not "my active tenant".** A user in clinics A and B sees both. Deriving the
   tenant from the locked row let a dual member working in A pay B's invoice. The guard suite's leg 3b (AR-M2b) caught
   it in this plan. Pattern: every INVOKER command takes `p_tenant_id` **from the server context**
   (`ServiceContext.tenantId`, session-derived, never request input) and matches it on the locked row. It only
   narrows what RLS already allows. Until V2-05 adds a DB-side notion of the active tenant, this argument is
   required.
3. **A function-level `SET statement_timeout` is not enforced for the statement that calls the function**
   (`timeout-probe.txt`: a 1 s function timeout, a 2 s sleep, no cancel). The plan's `SET statement_timeout = '5s'` was
   therefore not used. What bounds a call is the role-level `statement_timeout` (`authenticated` 8 s locally) plus a
   function-level **`lock_timeout`**, which is enforced per lock wait and proven by the LOCK_TIMEOUT case. TARGET §7.5
   ("set per function … where a command needs a different limit") needs an erratum (proposed, R-24).
4. **The system path needs a non-null actor column.** `payments.recorded_by` was `NOT NULL` → `auth.users`. Under the
   service role `auth.uid()` is null, so the system actor must be stored (`recorded_by_system`, closed set, XOR check).
   Its column must be withheld from request-path roles (column-list `INSERT`), or any member could forge a system
   payment. The function also requires `current_user = 'service_role'` for the system branch, not just
   `auth.uid() is null`.

Smaller points:
- PostgREST surfaces `RAISE … USING ERRCODE` faithfully: `P0001`/`P0002`/`42501`/`55P03` arrive as `error.code` with the
  raised text as `error.message`. Raising **machine reasons only** (upper snake) makes the mapper safe by shape.
  Unregistered free text is dropped.
- `supabase gen types` types every RPC argument as non-null `string`/`number` (`p_command_id: string`,
  `p_reference: string`). Optional semantics live in SQL (`NULLIF(btrim(p_reference), '')`), and the service always
  sends a command id.
- Same-invoice replays are serialised by the invoice lock, so the replay lookup after the lock sees the first commit
  (READ COMMITTED takes a new snapshot per statement). No `EXCEPTION` block is needed, which also keeps the definer
  writer's `xmin` check valid (a subtransaction would give the row a sub-xid).

## The pattern later phases copy (V2-07 P1-05 commands, V2-04 enqueue RPCs)

1. `public.<command>(p_tenant_id uuid, <subject ids>, <inputs>, p_command_id uuid, p_system_actor text default null)
   returns jsonb`, `LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET lock_timeout = '2s'`; schema-qualify
   every name.
2. Actor rule first: user = `auth.uid() is not null and p_system_actor is null`; system = `auth.uid() is null and
   current_user = 'service_role' and p_system_actor in (<closed set>)`; else `RAISE 'ACTOR_INVALID' USING ERRCODE =
   'P0001'`.
3. Validate inputs (`P0001` + machine reason). Lock the aggregate root `WHERE id = … AND tenant_id = p_tenant_id FOR
   UPDATE`; not found → `P0002` reason. Role check (`current_user_has_role` until V2-05 `has_permission`) → `42501`,
   with a spec asserting parity with `lib/permissions/matrix.ts`.
4. Replay by `(tenant_id, command_id)` (unique partial index) after the lock; mismatch → `IDEMPOTENCY_MISMATCH`.
5. Invariants → `P0001` reasons. Writes. Audit row (`actor_id = auth.uid()`, or `actor_type/actor_role = 'system'` +
   `metadata.system_actor`). Outbox via a `private.*` definer writer keyed by the subject id (finding 1).
6. `REVOKE ALL … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated, service_role`. `npm run db:types` in the same
   commit.
7. Service: permission check → `db.rpc(...)` with `tenantId` from `ctx` → `mapDbError(error, FIXED_MESSAGES)` →
   zod-parse the result → fixed messages only; log `errorTag` for `INTERNAL`. System adapter in
   `features/<domain>/system.ts` with its own `SystemDbReason`.
8. Client: one command id per logical submit, re-sent on retry, rotated on success.
9. Tests (DB lane): happy path with audit + outbox rows, rollback via a temporary scoped fault trigger
   (`tests/helpers/sql.ts`), cross-tenant + dual-member `NOT_FOUND`, role matrix + parity, invariants, a concurrency
   race, replay, system path + actor rule, anon `42501`, catalog (`prosecdef`, `proconfig`, privileges).

## Deviations from the plan

| # | Plan said | Done | Why |
|---|---|---|---|
| D1 | signature `(p_invoice_id, p_amount, p_method, p_reference, p_command_id, p_system_actor)` | + `p_tenant_id` (first) and `p_notes` | `p_tenant_id`: finding 2 (Rule 1, caught by the guard suite). `p_notes`: the drawer and service record payment notes today; dropping them would be a behaviour change |
| D2 | `SET statement_timeout = '5s'` | `SET lock_timeout = '2s'`; no function-level statement timeout | finding 3 (measured, not enforced); T-03-19 is met by the lock timeout |
| D3 | outbox rows in `webhook_delivery_queue` | through `private.outbox_payment_recorded` (definer) | finding 1; plain INVOKER drops the event for 3 of 5 roles |
| D4 | system path "proven by calling through `getSystemDb`" | also `features/billing/system.ts` (`recordPaymentAsSystem`) | a `SystemDbReason` needs an owning module under ADR-0005's `features/<domain>/system.ts`; gives V2-04 the adapter shape |
| D5 | "the checkout drawer sends a fresh UUID per submit attempt" | one id per payment, re-sent on retries after an error, rotated on completion | a fresh id per click would not protect the lost-response retry the key exists for (TARGET §7.6 idempotency-key semantics) |
| D6 | expand only | also `recorded_by` drops `NOT NULL` and authenticated `INSERT` on `payments` becomes a column list | finding 4; both are additive for every existing writer (all name `recorded_by`; none names `recorded_by_system`) |
| D7 | (not in plan) `55P03` mapping | `CONFLICT`/`LOCK_TIMEOUT` | TARGET §6 table has no entry; proposed addition (R-24) |

User-visible changes (all in the plan): an amount above the balance is refused ("The amount is more than the balance
due on this invoice.") where v1 accepted it; a paid or cancelled invoice refuses payments; failures show fixed texts.

## Gaps handed on

| To | Gap |
|---|---|
| V2-07 (P1-05, contract) | Direct writes still bypass the command: `authenticated` can `INSERT` into `payments` (column list) and `UPDATE invoices.status` under 000009's policies. Revoke both once every writer is an RPC. `completeAndBillConsultation` still runs invoice + payment as two commands (P1-05 "create invoice" + "collect"). |
| V2-05 | Replace the role array with `has_permission(p_tenant_id, 'appointments:edit')`; the parity case moves with it. Statement timeouts per role (finding 3). Consider a DB-side active tenant (claim) so `p_tenant_id` can be checked rather than trusted-from-server. |
| V2-04 (04-03b) | `record_payment` outbox rows have no `event_key`. When 04-03b adds the column, set `payment.recorded:<payment_id>` in `private.outbox_payment_recorded` (that function, not `record_payment`, is the place). The AFTER INSERT trigger gives these rows jobs as planned. `private` schema exists (03-09b's `ops` is separate). |
| PO (product) | `payment.recorded` is not in `ALLOWED_WEBHOOK_EVENTS`, so the developer settings UI cannot subscribe to it yet; rows are written only for subscriptions created otherwise (tests). Offering the event is a product decision. |
| 03-04 | New system-factory importer `features/billing/system.ts` (inside the `features/<domain>/system.ts` allow-list). |
| close | Add `tests/billing/record-payment-rpc.spec.ts` (already listed) and `tests/db/error-map.spec.ts` to `REQUIRED_FILES`. |
| test infra (done here, `353610e`) | The global teardown's leak check sent every run tenant in one `not tenant_id in (…)` filter next to a 100-id user chunk. Past about 8 KB of URL the gateway answers HTTP 414 with an empty body (probe: 200 tenants with 1 user id ok, 210 → 414). A green lane then exited 1 and left its data. The fix counts per bounded chunk; the regression case uses 400 run tenants. |
