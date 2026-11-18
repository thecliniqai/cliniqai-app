---
phase: 05
plan: 05-08
subsystem: database integrity (exclusion constraint, queue-token counter, tenant-local dates, FK indexes)
status: complete
requirements: [P1-39, P1-40, P2-08 (FK part), DB-08, DB-09, V2-03 R-33, R-11, R-18, R-19]
plan_head_before: 1dd96408da3de23f9a03a9385b794a169341b052
plan_head_after: caf7779
commits: [e924df3, 8eb1ad3, b500f23, caf7779]
---

# 05-08 record: no double booking, queue-token counter, tenant-local dates, FK indexes

**Outcome:** done locally. Two overlapping, non-overbooked scheduled visits of one doctor in one clinic can no longer
both exist (roadmap acceptance 6), and 50 parallel check-ins get tokens 1…50 dated the clinic's IST day computed in SQL
(acceptance 7). `CURRENT_DATE` (the server's UTC date) is gone from the two column defaults (V2-03 R-33), and every
foreign key has a supporting index. Nothing hosted was contacted; every Supabase CLI call used `--local`; resets and
artifact generation ran under the test-run lock while 05-06 worked in the same tree.

## What shipped

| Commit | Content |
|---|---|
| `e924df3` | migrations `000063_visits_no_double_booking`, `000064_queue_token_counters`, `000065_tenant_local_dates`, `000066_fk_indexes`; `EXPECTED_MIGRATION = "000066"`; schema snapshot; `types/database.ts`; matrix row `queue_token_counters` (all `rpc_only`) + regenerated `authz_matrix`/`authz_completeness`/`AUTHZ-MATRIX.md`; `definer_functions.test.sql` (`next_queue_token` classified `bound`, grantee `authenticated`, two dual-member legs); `features/queue/service.ts` (`checkInVisit` → `next_queue_token`, stores its `token_date`); `features/visits/service.ts` (`createVisit` maps 23P01 → `conflict`, CONFLICT, reason `VISITS_NO_DOUBLE_BOOKING`; `isSlotTakenError`); `features/visits/scheduling-service.ts` (`bookAppointment` passes the conflict through, so the booking drawer opens the overbook dialog); v1 `POST /visits`, `POST /appointments`, `PATCH /appointments/:id` → 409 `SLOT_CONFLICT`; `features/sharing/public-links.ts` (reschedule link 23P01 → `slot_taken`); fixtures adapted (below) |
| `8eb1ad3` | pgTAP `scheduling_exclusion` (26), `migration_edge_cases_overlap` (9), `queue_tokens` (26), `tenant_local_dates` (20), `fk_indexes` (4); `tests/helpers/write-barrier.ts`; `tests/scheduling/no-double-booking.spec.ts` (4), `tests/integration/queue-token-concurrency.spec.ts` (1), `tests/api/v1-slot-conflict.spec.ts` (4); `tests/db/error-map.spec.ts` (+1) |
| `b500f23` | every remaining scheduled-visit seeder (review/review2/review3, share tokens, webhook lockdown, SMS recipient, multi-clinic filters) takes its slot from `tests/helpers/seed-slots.ts`; the multi-clinic control visit moves to 8 days ahead (see deviation 3c) |
| `caf7779` | `createVisit` retries the insert once on 40P01 (deviation 5); `tests/visits/create-visit-slot-race.spec.ts` (4, stubbed database forces each outcome) |
| docs | this record, wave notes, evidence `evidence/05a/05-08/`, diagnostics `before-05-08.json`, `after-05-08.json` |

## Design as built

- **Exclusion constraint (R-11).** `public.visit_slot(p_at, p_mins)` = `tstzrange(p_at, p_at + make_interval(mins =>
  p_mins), '[)')`, IMMUTABLE (minutes never depend on `TimeZone`; pinned by a DST case in pgTAP), `search_path ''`,
  EXECUTE for `authenticated`/`service_role` only (index expressions are permission-checked for the inserting role).
  Predicate = diagnostics D6 **plus `scheduled_at IS NOT NULL`** (deviation 1). D6 was 0 before (`before-05-08.json`;
  the local database held no visits after the previous run's teardown, so the constraint's own creation is the proof on
  seeded data; the overlap edge case is replayed in pgTAP). The roadmap's inline expression fails with 42P17 and
  `NOT VALID` with 0A000 — both pinned in `migration_edge_cases_overlap.test.sql`.
- **Counter (R-18).** `queue_token_counters (tenant_id, date, last_token)`, RLS on, no policy, no privilege for
  PUBLIC/anon/authenticated (service_role keeps Supabase's default table privileges, as for every public table).
  `next_queue_token(p_visit_id)`: SECURITY DEFINER, clinic from the visit, `has_permission(clinic, 'appointments:edit')`
  (active clinic, R-42) else 42501 — also for an unknown visit id (no existence oracle); one `INSERT … ON CONFLICT DO
  UPDATE … RETURNING`; `greatest(last_token, day's MAX(token_number)) + 1`, so a token written without the counter (a
  fixture, a system path) is never handed out again; `SET lock_timeout = '5s'`. EXECUTE `authenticated` only
  (`service_role` revoked explicitly: Supabase's default privileges would grant it; no system path issues tokens).
  Counters were seeded from the existing tokens (idempotent `ON CONFLICT`). `generate_daily_queue_token` stays, with no
  app caller, until 05-b0 (R-37).
- **Clinic date (R-19, R-33).** `tenant_local_date(p_tenant, p_at)` (STABLE, invoker): `Asia/Kolkata` fast path; the
  ECMA-402 offsets `±HH`, `±HHMM`, `±HH:MM` read east-positive like Intl (PostgreSQL would read `-05:00` as POSIX, the
  opposite sign); otherwise a case-insensitive `pg_timezone_names` match; anything else (unknown name, abbreviation such
  as `IST` — PostgreSQL's abbreviation table says +02 — or blank) → Asia/Kolkata. App/SQL parity is asserted for 16 zone
  values × 4 instants (incl. 18:30, 19:00, 23:59:59 UTC) in `ist-boundaries.spec.ts`. The non-fast path costs ~6-10 ms
  (catalogue scan); every clinic has the default zone today. Triggers `private.queue_tokens_fill_date` and
  `private.patient_documents_fill_report_date` (invoker, no EXECUTE grant) fill a NULL with the clinic date; explicit
  values are kept; both columns stay NOT NULL.
- **FK indexes.** 31 single-column indexes (`idx_<table>_<column>`): actor/doctor/recipient references to `auth.users`
  and `referrals.target_tenant_id`. The catalogue loop covers `public`, `ops`, `private`, `authz` (and `billing_internal`,
  `platform` once 05b creates them): 0 FKs without an index whose first N key columns are the FK's N columns (before: 31
  in public; 05-03's 000049 had covered its composite FKs, so the research's 46 had already shrunk).

## Tests that fail without the change (tool output in `evidence/05a/05-08/`)

| Test | Without the change | With it |
|---|---|---|
| `no-double-booking.spec.ts` (barrier: both slot checks pass before either insert) | both bookings stored (2 of 4 cases fail) — `concurrency-specs-without-fix.txt` | exactly one success, the other `{conflict, CONFLICT, VISITS_NO_DOUBLE_BOOKING}` |
| `queue-token-concurrency.spec.ts` (barrier at the token RPC and at the insert, 2 receptionists) | 49 of 50 check-ins fail (duplicate `MAX()+1` → `uq_tenant_date_token`) — same file | tokens 1…50, one date = SQL `tenant_local_date(t, now())` = IST date of the DB clock; counter = 50 |
| `v1-slot-conflict.spec.ts` | without the route/link mapping: 500, 500, 500, 404 — `v1-slot-conflict-without-route-mapping.txt`; without the constraint all four writes are stored | 409 ×4, the reschedule link stays usable |
| pgTAP 5 files | objects missing (functions, constraint, triggers, indexes) | green |
| `ist-boundaries.spec.ts` parity block | (before 05-08 SQL had only `CURRENT_DATE`, the UTC date) | SQL = app at every instant and zone |

Deterministic concurrency: no sleeps or timers. `gateClient` holds the named RPCs/inserts at a barrier until every
caller has arrived, so the pre-fix race happens on every run (49/50 failures, 2/2 double bookings), and the fixed code
must win under that same worst-case interleaving.

## Deviations

1. **[Rule 1] `scheduled_at IS NOT NULL` in the constraint predicate.** A scheduled visit without a time would give an
   unbounded range that overlaps every slot of the doctor. D6 never counted such rows (NULL `&&` is NULL), so the
   predicate matches the diagnostic exactly. Pinned in pgTAP.
2. **[Rule 1/2] 23P01 handled on every writer of a slot, not only `bookAppointment`.** The plan named
   `scheduling-service.ts`; the insert lives in `createVisit` (`features/visits/service.ts`), so the mapping is there
   (also serves waitlist promotion). Writers without (or past) the app check would otherwise answer the new error as a
   500/404: v1 `POST /visits` (no slot check at all — it stored double bookings before), v1 appointment create and
   reschedule (their check reads only the target clinic day, missing a visit that runs past midnight), and the patient
   reschedule link (`consume_reschedule_token` checks ±the doctor's default slot length, missing longer visits; the
   transaction rolls back, so the link stays usable). `lib/db/errors.ts` was not changed: V2-03 already maps 23P01 →
   CONFLICT with the constraint as reason; its spec gained the real constraint case.
3. **[Rule 3] Fixtures.** (a) Generated insert types now require `queue_tokens.date` and `patient_documents.report_date`
   (NOT NULL, no default): four typed fixture inserts pass the clinic date explicitly (`visit-history`,
   `clinic-visits-register`, guard `world.ts`). The `world.ts` hunk was committed inside 05-06's `1dd9640` because both
   plans edited that file in the shared tree; it is behaviour-neutral on either schema. (b) `plantLegacyRow`
   (`session_replication_role = replica`) skips every trigger, the fill triggers included: its lab-document insert in
   `enqueue-webhook-rpc-db.spec.ts` passes `report_date`. (c) Seeders that create one scheduled visit per call for the
   same doctor at random or "now + N days" instants collided under the constraint (guard world, inbound messaging
   helpers, cross-tenant refs in the first full run; review2/review3 in the second — consecutive "now + 5 days" seeds
   are milliseconds apart; random minutes made others flaky): every such seeder takes its slot from
   `tests/helpers/seed-slots.ts` (random base within two days per file, then 20-minute steps; seeds land 2-4 days
   ahead, clear of the specs that reschedule to fixed days 9-11 ahead). One knock-on was root-caused rather than
   retried: in `multi-clinic-tenant-filters.spec.ts`, cancelling the control visit on the waitlist entry's target day
   auto-promoted that entry (`cancelVisit` promotes the day's waitlist), so a later case found it "already promoted"
   (3 of 4 runs); the control visit now sits 8 days ahead (5/5 green). (d) `ist-boundaries.spec.ts`: the two check-in cases faked the app clock to choose the token date;
   the date now comes from SQL, so they assert SQL's clinic-local today (bracketed), and the IST-boundary semantics moved
   to the fixed-instant parity block.
4. **`next_queue_token` refuses an unknown visit with 42501**, not P0002 (no existence oracle across clinics).
5. **[Rule 1] Deadlock under the exclusion race.** A full run surfaced the loser of the barrier race with the generic
   "Failed to schedule visit in database." and log code `40P01` (`evidence/05a/05-08/vitest-full-run-deadlock-found.txt`):
   two concurrent conflicting inserts can each find the other's uncommitted index entry while checking the exclusion
   constraint, and PostgreSQL resolves that as a deadlock instead of 23P01. The survivor commits, so `createVisit`
   retries once; the retry answers 23P01 (CONFLICT) or books. Root-caused, not retried in the test; the barrier spec
   ran 6/6 green afterwards and the stubbed spec forces both retry outcomes. **Residual:** the v1 visit/appointment
   routes do not retry; under a true API race the loser may get a 500 (sanitised) instead of 409 — the invariant still
   holds and API clients retry 5xx. Candidate for the v1 rework.

## Threats

T-05-20 (double-booking race): mitigated by the constraint; proven at DB level (pgTAP, incl. a receptionist through the
API role) and service level (barrier spec). T-05-21 (duplicate tokens; member rewinds the counter): counter + definer
RPC, no tenant privilege (pgTAP: owner cannot read or update it; refused calls leave it unchanged). No new surface
beyond the plan: `tenant_local_date` is invoker and reads only `tenants` rows RLS admits (another clinic's zone reads as
the default); `visit_slot` is pure.

## Notes for later plans

- `generate_daily_queue_token` has no app caller; drop it in 05-b0 (its definer row and two legs go with it).
- Any spec or seed that writes `queue_tokens`/`patient_documents` through `plantLegacyRow` must pass the date; typed
  inserts must too. Seeded scheduled visits of one doctor must not overlap: use `tests/helpers/seed-slots.ts` or
  `is_overbooked: true`.
- 05a gate: add the five pgTAP files (85 tests) to `REQUIRED_FILES` and the FLOOR; the Vitest gate list may add
  `tests/scheduling/no-double-booking.spec.ts`, `tests/integration/queue-token-concurrency.spec.ts`,
  `tests/api/v1-slot-conflict.spec.ts`.

## Local evidence

All under `evidence/05a/05-08/` at `caf7779` (tool output, not hand-typed):

| Check | Result | File |
|---|---|---|
| `npm run typecheck`, `npx eslint .` (0 errors), `npm run inventory`, schema snapshot `--check`, `db:drift:local` | pass | `static-checks.txt`, `local-drift.{txt,json}` |
| full Vitest (`npx vitest run`) | 234 files, 4600 passed, 0 failed | `vitest-full.txt` |
| earlier full run that surfaced the deadlock (deviation 5) | 1 failed (fixed in `caf7779`) | `vitest-full-run-deadlock-found.txt` |
| `npm run test:pgtap` + `assert-pgtap-report.mjs` | 22 files, 3015 tests, 0 failed, gate PASS (includes 05-06's untracked-at-the-time `referrals_rules`; lane total with 05-08's files) | `pgtap-run.tap`, `pgtap-run.txt`, `pgtap-gate.txt` |
| `npm run e2e:build && npm run e2e:pr` (desktop, Pixel 7, iPhone 15) | 220 passed, 9 skipped, 0 unexpected, 0 flaky, 0 retried results | `e2e-pr.txt` |
| specs without the fix (constraint dropped, pre-05-08 queue service) | booking 2 failed, check-in 49/50 failed | `concurrency-specs-without-fix.txt` |
| v1/reschedule spec without the route/link mapping | 4 failed (500/500/500/404) | `v1-slot-conflict-without-route-mapping.txt` |
| diagnostics before/after | D6 = 0 (empty local database after teardown; FKNV 0) | `../diagnostics/before-05-08.json`, `../diagnostics/after-05-08.json` |

The e2e web-server log carries the known `Unauthenticated` page noise (wave note, 05a fix plan), aborted-request
`ECONNRESET` lines and the synthetic diagnostic error; no new kind. JSON reporter outputs were not kept: they echo
local-stack key shapes. gitleaks over the history reports one finding in 05-06's `1dd9640` (not a 05-08 file; wave
note); 05-08's commits add none.
