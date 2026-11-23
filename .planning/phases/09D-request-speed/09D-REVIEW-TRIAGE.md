# 09D review triage (2026-11-23)

Inputs:
- `09D-REVIEW-A.md` (isolated): 1 High, 5 Medium, 9 Low.
- `09D-REVIEW-SEC.md` (adversarial): 1 Medium, 2 Low, 4 Hardening.

The phase gets one fix round, 09D-01a. Every Fix row needs a test that fails without the fix, recorded in NOTES.

## Ruling R-S: sensitive actions get a fresh check (A-1, S-1, A-2, S-2)

AUTH_REDESIGN §3.5 step 3 requires a liveness check on the most sensitive actions. A closed list of permissions and
actions always gets three checks:
- `session_is_live()` (migration 000087);
- a fresh membership and role read, never from the cookie or the per-request memo's cookie path;
- the access level.

The list is:
- staff management: invite, remove, role or permission edit;
- API keys and webhook subscriptions: create, rotate, delete;
- the DPDP export and erasure;
- clinic settings writes;
- billing and subscription writes;
- password and account security;
- any call to an external AI provider (`generateSoapAction` and every AI gateway entry point).

The list lives in one place in code, and a test fails if one of those actions skips the check. Everything else keeps the
fast path; the database re-checks membership and permission on every data read and write. The database-side liveness
check inside the RPCs and the insert rules (S-1's stronger option) goes to the V2-14 backlog. The database never had it,
so 09D does not regress it.

## Fix

| ID | Fix |
|---|---|
| A-1, S-1, A-2, S-2 | R-S above. One extra call, only on the listed actions. |
| A-3 | Issue `clinic_ctx` only from `/api/session-status` (the on-load, resume and 5-minute poll). No `cookies().set` inside Server Actions, so an action no longer re-renders the route. Clearing on sign-out, switch, removal and role edit stays where it is. |
| A-4 | The revoked-session spec asserts the outcome on every branch, with no vacuous pass. |
| A-5 | The budget spec becomes deterministic. It waits until `clinic_ctx` exists before asserting zero calls, reads the Kong container name from the project id in `supabase/config.toml`, parses stdout and stderr correctly (or uses one stream), and counts only the calls between its own markers. It must pass 10 out of 10 runs in a row locally with `--retries=0`. |
| A-6 | Fixes the date-dependent `review2-fixes-db` cases (+13 days on a Monday, +11 days on a Thursday). In `beforeAll`, open all seven days for the seeded doctor with the `availability_schedule` helper. This goes in its own commit, with the date reasoning in the message. Scan for other fixed `+N days` bookings with the same flaw and fix them the same way. |
| S-4 | The env schema refuses a `SESSION_CONTEXT_SECRET` equal to any other secret it knows: `CRON_SECRET`, `JOBS_RUNNER_SECRET`, the hook secrets. |
| S-5 | Use the `__Host-` prefix whenever the cookie is Secure. Plain localhost over http keeps the bare name. |
| S-6 | `getClaims` results are accepted only with the expected `iss` (the project's auth URL), `aud` `authenticated` and `role` `authenticated`. |
| S-7 | `/api/session-status` and every response that sets the cookie send `Cache-Control: private, no-store`. |
| A-Low | Fix the cheap Lows in `09D-REVIEW-A.md`. Required: the layout redirect should apply only on an auth failure, and stale comments must go. A time-zone fallback must not be memoised on failure. Run the schedule day and week slot calls in one parallel round. For each Low left, write a one-line reason in the Outcome table. |

## Accept

| ID | Disposition |
|---|---|
| S-3 | Accepted. A removed or demoted user's own device can show old navigation for up to 300 s. The database refuses their data at once, and R-S covers every sensitive action. |

## Outcome

Filled by the fix round 09D-01a (2026-11-23). "Mutation N" = row N of the fails-without table in `09D-NOTES.md` §09D-01a
(one change reverted, the named specs run red, the file restored and compared with `cmp`, 0 every time).

| ID | Commit | Fails-without test | Result |
| --- | --- | --- | --- |
| A-1, S-1, A-2, S-2 (R-S) | `2334f532` (+ `40854795` perf report) | `tests/auth/sensitive-actions-db.spec.ts` (every listed entry point refuses a session revoked elsewhere with a still-valid token and cookie, nothing of its body run; live control; demoted member refused by the fresh role; unlisted action keeps the fast path; every AI-gateway importer listed), `tests/auth/password-service.spec.ts`, `tests/security/ai-containment.spec.ts`, `tests/auth/page-revoked-session.spec.ts` (sensitive case). Mutations 1-7 red. | Fixed. List in `lib/auth/sensitive-actions.ts` (24 entry points, 23 action keys). One extra call over the database path (`session_is_live`, same round as `my_tenant_access`), only on the list. Billing writes taken literally (deviation 1, PO action P5). DB-side liveness to V2-14 (`deferred-items.md`). |
| A-3 | `e5700f67` | `session-context-db` › "A-3: a Server Action or route handler … never sets the cookie". Mutation 8 red. | Fixed: `/api/session-status` is the only issuer. |
| A-4 | `404d1742` | `page-revoked-session.spec.ts`: an outcome pinned per page. Mutation 17 (every page asks Auth again) red 10/23; the 09D version of the spec stays green 22/22 under it. | Fixed. Root cause: the old precondition's `getUser()` dropped the client's session, so the "revoked" cases were "no session" cases. |
| A-5 | `67281f76`, `fd6aa691` | Scenario (the shell's first status check forced to 503, as on a loaded runner): the spec **without** the cookie wait is red with the reviewer's failure (`memberships` 2, `my_tenant_access` 2); **with** it green, twice. The spec passed **10/10 runs in a row** with `--retries=0`, on each version. | Fixed. The cookie wait covers the shell's first retry. Each test clears an inherited cookie. The live views' background refreshes are held while measuring (found in the scenario traces). The container name comes from `config.toml`, Kong's access log (stdout) only is read, and `docker logs` is retried. Correction: `67281f76`'s "both streams" claim was a zsh artefact (see NOTES). |
| A-6 | `d7057bae` | `review2-fixes-db` › "reschedule links …" red without the fix today (Monday: +13 = Sunday; mutation 18). review2 +11 fires on Thursdays and review-fixes AR-L2 +12 on Tuesdays (mutation 19 green today, by the same arithmetic). | Fixed in its own commit: the seeded doctor is open all seven days with the default shifts. Scan: no other non-e2e spec books a fixed +N days through the availability check. |
| S-4 | `6235f477` | `env-schema` › "SESSION_CONTEXT_SECRET equal to <key> throws in every tier …" (6 keys). Mutation 16 red. | Fixed. |
| S-5 | `4d6eccec` | `session-context-db` › S-5; `signout-route` › S-5; `session-auth-close-db` › S-5; `context-cookie` unit. Mutations 9-12 red. | Fixed. |
| S-6 | `6859e16b` | `tests/auth/session-claims.spec.ts` › S-6 (8 refusals + control). Mutation 15 red. | Fixed. Staging check: PO action P4. |
| S-7 | `231a7081` | `session-auth-close-db` › "(S-5, S-7)"; `session-context-db` › status poll "private no-store". Mutations 13-14 red. | Fixed. |
| A-7 | `27ac23ec` | `session-claims.spec.ts` › A-7 "an unexpected failure … is rethrown". Mutation 20 red. | Fixed. |
| A-8 | `e5700f67` | none: the code path was removed with A-3 (no resolved-context memo, no in-action issuance). | Fixed by removal. |
| A-9 | `9048fd19` | `session-context-db` › A-9 (a correctly signed "locked" cookie of a `full` clinic: the locked page redirects on). Mutation 21 red. | Fixed. |
| A-10 | `a04fa3c8` | `tests/auth/request-memo.spec.ts` › "a transient failure …". Mutation 22 red. | Fixed. |
| A-11 | `00d92dd8` | `tests/schedule/schedule-slot-round.spec.ts`: all 8 calls in flight before any answers. Mutation 23 red. | Fixed. |
| A-12 | — | — | Left: the membership row (fresh) is the primary source on both screens; the stale value is a fallback for up to 900 s, and the receipt's wrong-person fallback predates 09D. A fix needs a receipt-content test: `deferred-items.md`, V2-10. |
| A-13 | — | — | Left: test harness only (a second wrap waits on an already-settled DOM; the 5 s wait is bounded); the timeout annotation goes with the 09E latency lane's reporting (`deferred-items.md`). |
| A-14 | `2a50a237` | `session-context-db` › two A-14 cases. Mutations 24-25 red. | Fixed. |
| A-15 | — | — | Documented in the NOTES design note (harmless; the next status poll pins the clinic). |
| S-3 | — | — | Accepted (above). |
