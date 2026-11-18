---
phase: 05
plan: 05-11c
subsystem: application fixes from the 05a reviews (v1 API, visit-slot writers, DPDP export, referrals, page auth)
status: complete
requirements: [05a triage rows tagged 05-11c — M-APINOTES, M-DURATION (app side), INT L-1, INT L-3, INT L-4, IND L7, IND L8, wave note 05-02a/orchestrator (revoked-session pages)]
plan_head_before: 7f65021e41468948ea98223398d1d5e366a0987e
plan_head_after: 05ce4c2
commits: [a9bd392, 45db38d, 0f404cb, c7cbaa0, ab42d3f, 8edd46a, 51d2011, 33b6076, 05ce4c2]
---

# 05-11c record: application fixes from the 05a reviews

**Outcome:** done locally. Application code only; no migration, no generated schema artefact. Every fix has a test
that fails on the pre-fix code (tool output under `evidence/05a/05-11c/`, `*-without-fix.txt` vs `*-with-fix.txt`).
The pre-fix runs used a detached worktree of the commit before each fix with the final spec copied in, so the proof
is the final test against the old code; the shared test-run lock (os tmpdir, keyed by the stack URL) and, for e2e,
the coordinator's lane lock (`scratchpad/e2e-lane.lock`) serialised every run with 05-11a, 05-11b and V2-06.

## Findings → fix → test → fails without

| Finding | Fix (commit) | Test | Without the fix |
|---|---|---|---|
| **M-APINOTES** (IND M5, RLS L-2; R-9) `/api/v1/visits/*` embedded and wrote `clinical_notes` for any API key (admins mint keys and hold no clinical access) | `0f404cb`: GET list/by id select only `V1_VISIT_COLUMNS` (`lib/api/visit-dto.ts`; no `clinical_notes` embed, none of the six cleared legacy columns); POST/PATCH refuse any clinical field with 403 `CLINICAL_ACCESS_DENIED`; PATCH also refuses `status: "completed"` (signing, IND M4: it signed as the key's creator); OpenAPI updated | `tests/api/v1-visits-no-clinical.spec.ts` (13) | 13/13 fail (note text returned, writes stored) — `v1-visits-no-clinical-without-fix.txt` |
| **M-DURATION** app side (INT M-1, IND L1) | `45db38d`: `features/visits/duration.ts` (5–480, the `visits_duration_range` bounds of 05-11a) used by `createVisit`, `bookAppointmentSchema`, `POST /api/v1/visits`, `POST /api/v1/appointments` (422 fixed text; omitted → 15) | `tests/visits/duration-bounds.spec.ts` (18) | 16/18 fail (app refused 480; v1 stored 10^9 minutes, turned 0/negative/"30" into 15, sent 7.5 to the DB) — `duration-bounds-without-fix.txt` |
| **INT L-3** / 05-08 residual: only `createVisit` retried 40P01 | `a9bd392`: `lib/db/retry.ts` `retryOnDeadlock` (one retry) used by `createVisit`, v1 `POST /visits`, `POST /appointments`, `PATCH /appointments/:id` and `consumeRescheduleToken`; a deadlock surviving the retry is the taken slot (`isSlotTakenError`); `mapDbError` maps 40P01/40001 → CONFLICT `CONCURRENT_WRITE` | `tests/scheduling/slot-deadlock-retry.spec.ts` (5): a real deadlock with the writer as the victim (below); `tests/db/retry.spec.ts` (6) | 500, 500, 500, 404 (`createVisit` already retried) — `deadlock-retry-without-fix.txt` |
| **INT L-4, IND L8** raw DB text / every DB error a 500 in `/api/v1` | `c7cbaa0`: `apiDbError` (`lib/api/envelope.ts`) maps through `mapDbError`: 23503/22P02/22007/22008 → 422, 23505/23514/23P01/40P01 → 409, 42501 → 403, else 500, fixed texts only; lookups that turned a DB error into 404 (patient, visit, doctor guard) and the erasure `DELETE` map it; `lib/db/errors.ts` maps 22P02/22007/22008 → VALIDATION_FAILED | `tests/api/v1-error-texts.spec.ts` (149): every handler × 6 SQLSTATEs with sentinel message/details/hint, plus real composite-FK, 22007 and 22P02 errors | 131/149 fail — `v1-error-texts-without-fix.txt` |
| **INT L-1** partial DPDP export shipped as 200 + "completed"; PDF audited twice | `ab42d3f`: each section query error (clinic, encounters, prescriptions, documents, invoices, payments, consents) and a failed patient read raise `ExportIncompleteError` (routes: fixed 500, no audit); `recordDpdpExportAudit` writes the one row; both PDF routes audit once after rendering | `tests/dpdp/export-fail-closed.spec.ts` (9, stubbed), `tests/dpdp/export-routes-audit.spec.ts` (12, both routes on the stack, a wrapped client fails one table) | 18/21 fail (two PDF rows; 200 with a partial archive) — `dpdp-export-without-fix.txt` |
| **IND L7** unchecked referral consent write | `8edd46a`: the insert result is checked; on failure the referral is withdrawn (snapshot cleared, cancelled; DELETE is rpc_only) and the action fails with `REFERRAL_CONSENT_WRITE_FAILED`, no consent audit; 05-06's order (consent after the referral exists) kept | `tests/referrals/referral-consent-write.spec.ts` (2; real fault trigger on `consent_records` for the spec's patient) | fault case fails (success, history sent, no consent) — `consent-and-page-auth-without-fix.txt` |
| **Revoked-session pages** (wave notes 05-02a/orchestrator; 05-02a "Open items") | `51d2011`: `UnauthenticatedError` (message unchanged); `lib/auth/page.ts` `withPageAuth` wraps every dashboard server page: a missing/revoked session → `redirect("/login")`; patient detail redirects instead of 404 | `tests/auth/page-revoked-session.spec.ts` (13; real revoked session via admin global sign-out); e2e `expectSignedOut` (J-A4, J-A5, both sign-out tests) asserts no `request.error` line for the `/patients` request ids and no new "Unauthenticated" `ops.error_events` count | Vitest 7/12 pages fail (6 threw "Unauthenticated", detail 404) — same file; e2e 8/8 fail on desktop-chrome and Pixel 7 — `e2e-signed-out-without-fix.txt` |

## Forcing the deadlock (deterministic, root-caused)

A superuser "holder" session inserts X = [t, t+15), then waits inside its transaction until a backend is blocked on
its transaction id (`pg_locks`): the writer under test R, slot [t+10, t+25). The holder then inserts Z = [t+20, t+35),
which waits on R: a cycle. Each waiting backend runs the deadlock check once, `deadlock_timeout` (1 s) after its own
wait began; the one that finds the cycle is aborted. In the first version both checks were a few ms apart and
scheduling decided the victim (1 run in ~6 aborted the holder: captured, `pg_locks`/timing diagnostics). The holder
now raises its own `deadlock_timeout` (`SET LOCAL`, its transaction only) so only R's check can find the cycle; the
spec asserts the holder survives (else the holder's psql fails the test). 10 consecutive file runs green (50/50).

## Deviations

1. **[Rule 2] v1 PATCH refuses `status: "completed"`.** Completing signs the visit; with no clinical access the key
   principal cannot sign (IND M4 showed it signing as the key's creator). The v1 safety check that read the notes is
   gone with it. P1-37 decides any clinical API scope.
2. **[Rule 1] A deadlock that survives the one retry is reported as the taken slot** (createVisit's stubbed spec case
   changed from "generic failure"): only an overlapping concurrent slot write makes a slot write the victim, and that
   write went on. Other 40P01s map to CONFLICT `CONCURRENT_WRITE` (retry-safe), never 500.
3. **[Rule 2] Lookup errors are no longer "not found".** v1 patient/visit/doctor lookups and the erasure `DELETE`
   used to answer a database failure as 404/403; they now map it (`apiDbError`). The DPDP export treats a failed
   patient read as `ExportIncompleteError`, keeping "not found" for PostgREST's no-row answer (PGRST116).
4. **Referral consent: compensation, not one transaction.** App-only scope (no migration): the referring clinic cannot
   delete a referral, so a failed consent write withdraws it (history cleared, cancelled). A failed withdraw is logged
   as `referrals.consent_withdraw.failed`. One transaction for both writes belongs to the V2-11 referral command.
5. **e2e lane lock wait.** The coordinator's rule says wait until `lsof -i :3100` shows nothing; Docker keeps stale
   `CLOSED` sockets to port 3100 (GoTrue's hook calls), which never clear, so the wrapper waits for any non-CLOSED
   socket on 3100 instead.

## Open items

- **Other v1 resources still carry clinical content for API keys** (`/api/v1/prescriptions`, `/referrals` summaries
  and snapshots, `/lab-orders`): outside the M-APINOTES row (visits only); same R-9 argument. Owner: P1-37 (v1 stays
  off in every deployed tier, PO-16).
- The deadlock spec, the error-text sweep, the export specs and the page-auth specs are candidates for the 05a Vitest
  gate list.
- All Lows in this plan were cheap and local, so all were fixed (PO ruling 2026-11-14, item 3); nothing deferred.

## Also changed

- `33b6076`: `tests/security/review2-fixes-db.spec.ts` AR2-Info (I2) sent a clinical field through the v1 visit PATCH
  to provoke a database error (expected 500). Under M-APINOTES the same body is refused before any write: the case now
  proves 403 `CLINICAL_ACCESS_DENIED`, no write, no echo of the input (wave note from 05-11a).

- `05ce4c2` (05-11b wave note, coordinator): `REFERRAL_TARGET_DOCTOR_INVALID` (raised by 000074) registered in
  `RPC_REASON_CODES` → VALIDATION_FAILED, with fixed texts in `createReferral` and `POST /api/v1/referrals` (422).
  Tests: an error-map case and a real-stack `createReferral` case in `referral-consent-write.spec.ts`. Without the
  registration the reason fell to CONFLICT as an unregistered P0001 (pinned by the existing "unregistered reason"
  row) and the action answered the generic "Failed to create referral."; not separately re-run on the old code.

## Local evidence (tool output, `evidence/05a/05-11c/`)

| Check | Result | File |
|---|---|---|
| `npm run typecheck`, `npx eslint .` (0 errors, warnings of existing kinds), `npm run inventory` (0 flagged) | pass at `33b6076`; typecheck and eslint re-run at `05ce4c2` | `static-checks.txt` |
| full Vitest (`npx vitest run`, shared stack, after 05-11a/05-11b landed) at `33b6076` | 247 files, 4863 passed, 0 failed | `vitest-full-33b6076.txt` |
| full Vitest rerun after the last code commit `05ce4c2` | 247 files, 4865 passed, 0 failed | `vitest-full.txt` |
| `npm run e2e:build && npm run e2e:pr -- --retries=0` (desktop, Pixel 7, iPhone 15) | 220 passed, 9 skipped (project-scoped), 0 failed, 0 flaky, 0 retried; the only `request.error` line is the synthetic `/api/diag/error` (the 8 `/patients` lines are gone) | `e2e-pr.txt` |
| pre-fix runs of each new spec | see the table above | `*-without-fix.txt` |
| post-fix runs of each new spec | all green | `*-with-fix.txt`, `deadlock-retry-with-fix-3x.txt` |
| gitleaks (`zricethezav/gitleaks`, repo config) over `7f65021..HEAD` (18 commits incl. 05-11a/b) and the evidence directory | no leaks (one local signed-URL token printed by a pre-fix assertion diff was redacted in `consent-and-page-auth-without-fix.txt`) | — |

Nothing hosted was contacted; no migration or generated artefact was edited; only 05-11c paths were staged (shared
files such as `features/visits/service.ts` were staged as HEAD + this plan's hunks only).

## Self-Check: PASSED
