# V2-09e research notes (2026-11-23, second revision)

Companion to `09E-PLAN.md`. Facts checked in the tree at `3db8b816` (`v2/phase-09d-request-speed`), plus the reasoning behind
the convergence and data-layer rulings, so the plan can stay short. Nothing here is a decision the plan does not already state.

## 1. Inventory checks

### 1.1 Stale-write protection in the V2-07/V2-08 commands (PO decision 6: plan only the gap)

| Command (latest migration) | What it already refuses | Row version the user saw? |
|---|---|---|
| `check_in_visit` (000100) | `VISIT_NOT_CHECKABLE` (completed, cancelled), `VISIT_NOT_TODAY`; repairs a booked visit that holds a token; idempotent by `p_client_request_id` | No |
| `start_consultation` (000112), `complete_visit` (000106) | state-machine preconditions (000100) | No |
| `cancel_visit`, `reschedule_visit`, `mark_no_show`, `confirm_appointment`, `promote_waitlist_entry` (000103) | state preconditions; `slot_conflicts` for reschedule and promote | No: a reschedule or cancel acts on whatever time the visit has now |
| `collect_payment`, `create_invoice`, `complete_and_bill` (000099), `record_payment` (000096) | balance cap, status guards, one live invoice per visit (get or create), `FOR NO KEY UPDATE` on the visit | No: a payment is taken against the invoice as it is now, even if its total changed since the screen showed it |
| invoice item add and delete (`features/billing/service.ts`, direct table writes) | RLS only | No (V2-10 replaces these with commands, P1-06) |
| `save_consultation_draft` (000112) | `draft_version` compare (09B R-2) | **Yes**: the model for 09E-07 |

Every command already locks the visit row, replays by request id before doing anything, and maps refusals to fixed codes.
The gap is a row version: `visits.row_version` and `invoices.row_version` (000123) and `p_expected_version` on the
commands above (000126), except `create_invoice` and `enqueue_walk_in` (they create; nothing to have seen) and
`promote_waitlist_entry` (waitlist rows carry no version; its slot check decides). The invoice-item table writes are left
to V2-10.

### 1.2 Today live updates today

- Row-level `AFTER` triggers (000102, invoices added in 000106): visits insert and update of `status`, `scheduled_at`,
  `doctor_id`; `queue_tokens` insert or update; `payments` insert; `invoices` insert and update of `total_amount`, `status`;
  `clinical_notes` update of `vitals`. One `realtime.send` per row: payload `{kind, visit_id}`, topic `today:<tenant>`,
  private. Policy `authz.today_topic_allowed` (active member, `appointments:view`, access `full`). The send sits in an
  exception-swallowing block. The client never reads the payload.
- `components/today/use-today-live.ts`: polls (`router.refresh()`, 20 s) only while the channel is **not** SUBSCRIBED.
- `.planning/debug/today-signals-flake.md`: Realtime's quota is project-wide, 100 events/s averaged over 60 s, sends plus
  deliveries (a send to a topic with 3 subscribers costs 4). Over the quota every broadcast is refused
  (`too_many_requests`) and an open channel stays SUBSCRIBED with no client-visible error. The local tenant is also
  terminated for rebalancing 10 min after init, after which open channels go deaf until a new join. Both leave the board
  silently stale. Hence the heartbeat while subscribed (PO decision 2).

### 1.3 Observability already built

- Logger: `lib/log` (V2-03 R-6: in-house JSON lines, no pino; not `lib/core/logger` as TARGET §3.8 assumed). Route
  fields go through `routePattern()` (`lib/observability/scrub.ts`): no query, no concrete id.
- Error sink: `ops.error_events` (000028) through `public.ops_ingest_error` (anon-executable definer with an ingest-key hash
  in vault; plain `fetch`, no service role), client render errors through a server action with closed lists
  (`lib/observability/client-render-event.ts`). Retention in `ops.cleanup()` (000040, pg_cron daily).
- `instrumentation.ts` `onRequestError`; `x-request-id` set by `proxy.ts`.
- Perf: `npm run perf:roundtrips` (Kong counter `tests/e2e/support/kong-calls.ts`), `tests/e2e/shell/request-budget.spec.ts`
  (09D ceilings, PR lane), `scripts/perf/command-latency.ts`, LHCI nightly (`tests/e2e/perf/lhci.spec.ts`,
  `scripts/perf/lhci-config.mjs`, `.github/workflows/nightly.yml` job `lhci`, report-only, PWA-09).
- Missing: real-user timings, `Server-Timing`, per-request database call count and time, a `pg_stat_statements` report.
- Next 16.4.6 ships `useReportWebVitals` (`next/web-vitals`, with a compiled copy of web-vitals): no `web-vitals` package
  is needed.
- `lib/supabase/server.ts:84` passes `global.fetch: transport.fetch` (the 06-09d auth transport): the database timing
  wrapper composes around it.

### 1.4 Other facts used by the plan

- No migration after 000120; V2-09d added none; `EXPECTED_MIGRATION = "000120"`; pgTAP FLOOR 9025, Vitest FLOOR 6455.
- `lib/schedule/` and `lib/live/` do not exist (the TypeScript slot twin of the previous revision was never built).
- Playwright 1.63: `page.routeWebSocket` (drop Realtime frames while the channel stays joined) and `page.clock`
  (advance the heartbeat deterministically) are available.
- Settings writes go to `tenants` (clinic profile, statutory, Rx print), `memberships` (staff edit, availability, slot
  length) and `profiles` (`features/settings/service.ts`); `visits` has a `metadata jsonb` column that background jobs may
  write, so the row version must bump only on listed columns.
- The 09D `clinic_ctx` cookie (ids, role, access level, 300 s) only saves app-side lookups; RLS and the commands decide
  every read and write. 09E adds nothing to it.

## 2. Design notes

### 2.1 Why versions must come from the same statement as the data

A read that returns data and a version from two calls run in parallel can return a version newer than its data (a write
committed between the two). The device would then believe it is current and miss the update until the next bump. So:

- A live read returns its versions from the same SQL statement as its data (one snapshot): exact basis.
- Any other read records, as its basis, the highest version the device had seen when the fetch started: a lower bound.
  A lower bound can cause one extra re-read, never a missed one.
- The device re-reads a query whenever it learns a version of one of its domains above the query's basis.

### 2.2 One signal per clinic, domain and transaction

- `public.clinic_versions(tenant_id, domain, version, changed_at, last_xact xid8)`. The bump is
  `INSERT … ON CONFLICT DO UPDATE SET version = version + 1, last_xact = pg_current_xact_id() WHERE last_xact IS DISTINCT
  FROM pg_current_xact_id() RETURNING version`: the first statement of a transaction bumps and sends; later statements of
  the same transaction find their own xact id and do neither.
- `realtime.send` inserts into `realtime.messages` inside the transaction, so the signal is delivered only after commit and
  disappears with a rollback. A reader that sees version v sees every row of that transaction.
- Statement-level triggers need transition tables to know which clinics a statement touched. PostgreSQL allows a
  transition table only on a trigger with one event and, for UPDATE, no column list: so one trigger per table and event,
  and the UPDATE function joins the old and new tables on the key and compares the listed columns itself. An empty
  transition table (a statement that touched no row) bumps nothing.
- Cost: the version row is locked by each writer of that clinic and domain until commit, so concurrent writers of one
  clinic serialise on it for the rest of their transaction. Commands are short (tens of ms); bulk jobs must stay short or
  chunk (the commands' `lock_timeout` is 2 s).

### 2.3 Staleness bound

Heartbeat 12 s. Worst case on staging: 12 s + one state read (about 0.5 to 0.9 s through Vercel) + one screen re-read
(the same) ≈ 13.8 s, inside the PO's 15 s. Signals delivered: about 0.4 s coalescing + one re-read ≈ 1 to 1.5 s.

### 2.4 Realtime capacity (V2-15 hand-off)

Every signal costs 1 + (open subscribed devices of that clinic) events against a project-wide quota, plus the plan's
monthly message allowance and concurrent-connection cap. Coalescing per transaction removes bulk bursts but not volume
from many small writes across many clinics. The heartbeat makes refusals safe (bounded staleness), not free. The V2-15
production sizing must check the Supabase plan's Realtime limits against clinics × devices × writes.

### 2.5 Page pattern with TanStack Query

Pages keep reading on the server (one round trip) and pass the result into the screen's query (`HydrationBoundary`),
so a navigation always shows what the database just answered and first-load content stays server-rendered (small client
JS on low-end phones). The client re-reads only what changes while the screen is open (signals, heartbeat, focus,
reconnect) through the screen's GET route into the same key. Screens with no live domain (patients list, a patient,
visits, billing reports, settings, staff) stay server-rendered and show a "Changed on another device · Refresh" notice
when a domain they display moves; they do not re-render by themselves (a patient page re-render would write another
`patient.view`).

## 3. Package legitimacy audit (new dependencies)

| Package | Version | Source checked | Licence | Verdict | Why |
|---|---|---|---|---|---|
| `@tanstack/react-query` | 5.108.4 (latest on 2026-11-23; pin exact at install) | npm registry metadata (`npm view`): repository `github.com/TanStack/query`, maintainers include `tannerlinsley` | MIT | [VERIFIED] | PO decision 4 (approved 2026-11-23): one client data layer instead of four hand-built stores |

No other package. `web-vitals` is not added (Next's built-in `useReportWebVitals`). No persister, devtools or other
`@tanstack/*` package.

## 4. Previous revision → this revision

| Previous | Now |
|---|---|
| 09E-01 latency lane (blocking ms) | 09E-01 (blocking calls and depth; ms report-only) |
| none | 09E-02 observability (new), 09E-03 TanStack Query (new), 09E-04 live convergence (new), 09E-07 stale-write refusal (new) |
| 09E-02 consult | 09E-05 (doctor lists in the query cache, no `doctor-lists.ts` store) |
| 09E-03 other screens | 09E-06 (adds `today_board` in SQL and the changed-elsewhere notice) |
| 09E-04 saves | 09E-08 (by risk class) |
| 09E-05, 06, 07 catalogues | 09E-09, 10, 11 (no server cache of shards or versions) |
| 09E-08 schedule (TypeScript slot twin) | 09E-12 (slots from SQL only) |
| 09E-09 device-held settings, cookie fields, `tenants.settings_version` | 09E-13 session bootstrap (no cookie fields; the settings version is the `settings` domain of `clinic_versions`) |
| 09E-10a fix round | 09E-14a |
