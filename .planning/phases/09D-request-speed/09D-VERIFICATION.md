# V2-09d Request speed: verification

Gate: light, per PR. Merged on 2026-11-23 under the PO's delegation of the same day. The PO reviews it. Results below
come from tool output in `evidence/` and the linked CI run. There is no `09D-PLAN.md`; the criteria below come from the
PO-approved approach recorded in `09D-NOTES.md` and from ruling R-S in `09D-REVIEW-TRIAGE.md`.

## Runs

| Run | Commit | Result | Source |
|---|---|---|---|
| Local evidence run (1 run, lean process) | `693bd025733a2733fc7ddf629d8dc12288a28412` (working tree had uncommitted planning docs only) | Vitest 399 files, 8151/8151, 0 skipped; pgTAP 69 files, 9025/9025, gate PASS; typecheck, eslint, inventory exit 0; static: 0 P1-34 boundary messages, 0 UTC-today messages, service-role factory only `lib/supabase/system.ts` | `evidence/summary.json`, `full-run-1.json`, `pgtap-run-1.tap`, `static-checks.json`, `commit.txt` |
| Earlier local attempts at the evidence step | | Red, then fixed. (a) The medicine and substance route specs (`tests/prescriptions/medicine-search-route.spec.ts`, `tests/terminology/substance-search-route.spec.ts`) mocked `getUser` but not `getClaims`: fixed in `c9ce9cde`. (b) pgTAP `rx_allergy_check` test 15 counted the audit rows of every clinic: fixed in `c9ce9cde`. (c) 4 pgTAP files select or delete across all clinics, so they fail on a reused local DB. This flaw predates 09D. They pass on a fresh DB, which CI always uses; the re-run after `supabase db reset --local` passed | `09D-NOTES.md` "Verification on the final tree", git history |
| Local runs of the fix round 09D-01a (tree `40854795`, budget spec of `fd6aa691`) | `fd6aa691` | Vitest (auth, security, api, clinics, billing, today, schedule, ci, config, authz, ai, dpdp, staff) 150 files, 3786 passed; e2e desktop-chrome `--retries=0` 652 passed, 9 skipped, 0 failed; pixel-7 and iphone-15 60 passed, 11 skipped, 0 failed; `request-budget.spec.ts` 10 of 10 runs green on each of two versions | `09D-NOTES.md` "09D-01a: Verification on the final tree" |
| CI [45193065167](https://github.com/thecliniqai/cliniqai-app/actions/runs/45193065167) | not recorded in the sources | All jobs success, but **1 retried**: journey 6 on iphone-15, axe colour-contrast on the Print Rx button in the middle of its fade. Not merged. Root cause: in WebKit, `document.getAnimations()` read from an ordinary task can disagree with computed style between rendering updates, so the shared settle helper declared the screen still too early (81 of 100 in a repro; 0 of 100 after the fix). Fixed in `fbacebe9` (`tests/e2e/support/settle.ts`, guard spec `tests/e2e/a11y/settle-guard.spec.ts`). Test-only; not caused by 09D | GitHub run log, `fbacebe9` commit message |
| CI [45221131956](https://github.com/thecliniqai/cliniqai-app/actions/runs/45221131956) | `7a03c74158bce6bb6976229c0794df4071248657` (PR head) | static, security, test, build, e2e all success; Vitest 8151/8151; pgTAP 69 files, 9025, gate PASS; e2e 1115 passed, **0 retried**, 0 flaky | `evidence/ci-run.json`, `ci-pgtap-report.tap`, GitHub run log |

The commits after the local evidence run (`693bd025..7a03c741`) are: the settle helper and its guard spec (`fbacebe9`,
test-only), `68d9cc1b` (`scripts/seed-cdci.ts` reads each file whole; Node 24 `ERR_USE_AFTER_CLOSE`) and docs. Nothing
under `app/`, `features/`, `lib/`, `components/`, `proxy.ts`, `supabase/` or `types/` changed. Product code is unchanged.
The CI run at the PR head covers them.

## Acceptance

Each criterion maps to the approach in `09D-NOTES.md`; test names are from the same file.

| Area | Evidence | Result |
|---|---|---|
| Identity and clinic context resolved once per request, one resolver chain, also in Server Actions and route handlers | Vitest `session-context-db` "one request: one membership read, one access-level read, no Auth call", `request-memo`; fails-without: first-round mutation "`requestMemo` never memoises" and fix-round no. 25, both red | **Met** |
| Identity without a network call (claims verified locally); no `/auth/v1/user` on in-app navigation | e2e `shell/request-budget` (in-app Patients and Today: 0 Auth calls, 0 `my_tenant_access`); red against a build of the base sources (Patients 4 Auth calls, Today full load 8) | **Met** on the local stack (ES256). **Not shown** on staging: a project still on the legacy HS256 key falls back to one `getUser` per request (09D-P2) |
| Signed `clinic_ctx` cookie: 300 s, bound to user, session and active clinic; refused on a bad MAC, expiry, other user, other session or other pin | Vitest `context-cookie` (8), `session-context-db` (incl. another session of the same user); first-round mutations 1-3 (signature, expiry, session binding) red | **Met** |
| The database still decides: a removed member is refused at once | Vitest `session-context-db` "removed member" (reads return `[]`, `checkInVisit` refused, `/api/session-status` 403, control passes); pgTAP unchanged, 69 files, 9025 | **Met** |
| Sensitive actions get a fresh liveness, membership and access check (ruling R-S; A-1, A-2, S-1, S-2) | Vitest `sensitive-actions-db` (every listed entry point refuses a session revoked elsewhere; live control; demoted member refused; every AI-gateway importer listed), `password-service`, `ai-containment`, `page-revoked-session`; fix-round mutations 1-7 red | **Met** (billing writes taken literally, deviation 1, 09D-P5) |
| Cookie issued only by `/api/session-status`; `__Host-` prefix on Secure; claims need this project's `iss`, `aud`, `role`; `private, no-store`; secret not reused (A-3, S-4 to S-7) | Vitest `session-context-db` (A-3, S-5, status poll), `signout-route`, `session-auth-close-db`, `session-claims` (S-6), `env-schema` (S-4); fix-round mutations 8-16 red | **Met**. Staging `iss` check: not shown (09D-P4) |
| Every Fix row has a test that fails without the fix | `09D-NOTES.md` fix round: 25 mutations, each restored and compared with `cmp` (0): 24 red; no. 19 (review-fixes AR-L2, +12 days) is green today and fires on Tuesdays. A-8 fixed by removal, no test | **Met**, with the two exceptions stated |
| Supabase calls per page and per click fall | `npm run perf:roundtrips`, base `0acb544c` against the final tree, app-server calls. Receptionist full load: /today 26 to 10, /schedule 30 to 14, week 38 to 21, /patients 27 to 8, a patient 43 to 17. Doctor full load /consultation 59 to 23. In-app /patients 10 to 2, a patient 26 to 11. Check in 34 to 11. After the fix round: 0 of 28 page rows changed; Save printing settings (listed action) 5 to 7 | Reported; the sources set no numeric target. The call count is the staging-relevant number (local ms are 1-5 ms per call) |
| The PR lane blocks a regression of the identity and context calls, and is deterministic | e2e `shell/request-budget` (2 tests, desktop-chrome): red on the base build, green on the branch; 10 of 10 runs with `--retries=0`; CI e2e 0 retried | **Met** |
| Schedule day and week slot calls go out in one round, each (doctor, date) pair once | Vitest `schedule-slot-round` (fix-round mutation 23 red); receptionist week view 9 to 8 calls | **Met**. `available_slots` is not batched: a range form needs a migration (deviation 4) |
| No migration, no new dependency | 0 files under `supabase/migrations/` in the merge; `package.json` adds only the scripts `perf:roundtrips` and `stack:recycle` | **Met** |
| typecheck, eslint, inventory, existing suites stay green | Evidence run and CI run 45221131956 above; eslint 0 errors | **Met** |
| Staging feels faster (about one round trip per page-data query) | Needs 09D-P1 to 09D-P3 | **Not shown** |

## Reviews

| Review | Result |
|---|---|
| Isolated, whole phase | No Critical; 1 High (A-1, a revoked session passes every action and page for up to 900 s), 5 Medium, 9 Low (`09D-REVIEW-A.md`) |
| Adversarial, whole phase | No Critical or High; 1 Medium (S-1, proved: a session revoked elsewhere passes every Server Action guard), 2 Low, 4 Hardening (`09D-REVIEW-SEC.md`) |
| Fix round 09D-01a | Ruling R-S plus A-3 to A-7, A-9 to A-11, A-14, S-4 to S-7 fixed, each with a fails-without test; A-8 fixed by removal. Left: A-12 (receipt name fallback, V2-10) and A-13 (test harness only). A-15 documented. S-3 accepted (old navigation for up to 300 s on a removed user's own device). No migration (`09D-REVIEW-TRIAGE.md`, `deferred-items.md`) |

## Open finding

A separate rare race in keyboard Rx entry: typed medicine text right after adding a line can be wiped. About 1 in 20
locally on a loaded machine. It predates 09D and did not occur in CI. It is being root-caused; the fix lands in 09E PR 1
or a small separate fix. It is not fixed in 09D.

## PO items

Numbers P1 to P6 are those of `09D-NOTES.md`; P7 to P9 are new.

1. **09D-P7:** gate review. Confirm:
   - R-S: the closed list of sensitive actions (`lib/auth/sensitive-actions.ts`, 24 entry points) and the one extra call on each.
   - S-3: a removed or demoted user's device can show old navigation for up to 300 s; the database refuses their data at once.
   - Page loads no longer detect a session revoked elsewhere; the shell's status check (on load, resume, every 5 min) ends it. Sensitive actions refuse it at once.
2. **09D-P1:** set `SESSION_CONTEXT_SECRET` on the staging Vercel project and redeploy; also on production before it goes live (the app refuses to boot without it). Not shown as done in the sources.
3. **09D-P2:** staging Supabase, JWT signing keys: confirm the JWKS lists an ES256 key. Staging is now the Mumbai project, so check that one.
4. **09D-P3:** after P1 and P2, try Today, Schedule week, Patients, a patient and a consult on staging.
5. **09D-P4:** after the 09D deploy, check the staging logs for `auth.claims.refused` (the `reason` code names the claim). If Today bounces to `/login`, tell Claude the reason.
6. **09D-P5:** confirm or narrow which billing writes count as sensitive (create invoice, add or delete item, record payment, collect payment, Sign & Bill). Each now costs about one more round trip on staging. Narrowing is one line each in `lib/auth/sensitive-actions.ts`.
7. **09D-P6:** add the database-side liveness check (`session_is_live()` inside the definer commands and the `api_keys` and `webhook_subscriptions` insert rules) to the V2-14 backlog (§10).
8. **09D-P8:** retire the Sydney Supabase project after a few days with no issues (`.planning/PO-ACTIONS.md` 1.7).
9. **09D-P9:** the password-reset first attempt on staging stalled for about 30 s; the retry worked. It is to be instrumented in 09E-02. Nothing to do yet.

## Gate decision (2026-11-23)

PR #18 merged into `feature/v2` with a merge commit, `d884b22df8ad53190686f99ddcba6f148e5cc433`, by Claude, under the
PO's delegation of 2026-11-23 ("wait for 9D merge then start 9E automatically even if I am not around"). CI green, 0
retried. The gate approval itself stays with the PO (09D-P7). Staging migrations were not touched by Claude. V2-09e
starts next under the same delegation.
