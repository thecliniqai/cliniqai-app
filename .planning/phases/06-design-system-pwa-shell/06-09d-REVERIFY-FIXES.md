---
phase: 06
plan: 06-09d
subsystem: session/auth re-verification fixes (H-AUTHOUT-R1, M-REMOVED-R1, L-R1..L-R4)
status: complete (local)
plan_head_before: 78e2fa2ffa36e135af482acbf1778e3bf5ef610b
code_head_after: b904d8f1356b7459304a2f93e5482a30b4ba300a
commits_before_docs: 4
---

# 06-09d record: re-verification fixes (H-AUTHOUT-R1, M-REMOVED-R1 and four Lows)

Plan: the "Re-verification outcome … (06-09d)" table in `06-09c-REVIEW-TRIAGE.md`. The reproductions are in
`reviews/v206c-review-reverify.md` (31 probes, checked at `de553cd`). Branch `v2/phase-06-design-system-pwa-shell`,
private worktree, base `78e2fa2`. The change is application code and tests only: no migration, no new dependency, no
dependency upgrade. Every number below comes from a tool output in `evidence/06-09d/` (the file is named per row) or
from the command named in the row.

## Commits

| Commit | What |
|---|---|
| `6d79ef5` | All six findings in the app, with their Vitest specs and the runbook section |
| `c68851a` | e2e: the server-side Auth fault hook (e2e lane only) and `11-refresh-outage-and-pin.spec.ts` |
| `b11e398` | Report gate: REQUIRED_FILES + 2 specs (218 in total), FLOOR 5974 |
| `b904d8f` | e2e harness: the 09 M-REMOVED full-load case waits for the shell's first status check (PR-lane run 1 root cause, below) |
| this commit | This record, the evidence and the wave-note rows |

## Root cause (H-AUTHOUT-R1)

When the access token has expired, auth-js 2.117.2 refreshes it before `getUser()` or `getClaims()` can return. The
call chain is `__loadSession` → `_callRefreshToken`. For any refresh error that is not an `AuthRetryableFetchError`,
auth-js runs `_removeSession()` once the access token is past its real expiry. That covers a 429, a 408, an uncoded
400 and a gateway's 404 or 401. `@supabase/ssr` then hands `setAll` the deletion of every auth cookie. The proxy wrote
those deletions to the browser and to the forwarded request, and `lib/supabase/server.ts` wrote them through
`cookies().set` in route handlers and server actions.

06-09c's classifier only ran after that deletion had already happened. It also treated any JSON 4xx as definitive. A
retryable refresh error has a separate problem: auth-js retries it with back-off for about 25 s per call.

## What changed

- **`lib/auth/auth-failure.ts`.** A failure counts as definitive only when it is one of:
  - `AuthSessionMissingError` (auth-js maps `session_not_found` to it);
  - `AuthInvalidJwtError`;
  - an answer with a GoTrue refusal status (4xx, but not 408 or 429) and a code in `DEFINITIVE_AUTH_CODES`:
    `session_not_found`, `session_expired`, `refresh_token_not_found`, `refresh_token_already_used`,
    `validation_failed`, `bad_jwt`, `user_not_found`, `user_banned`.

  `classifyAuthAnswer` reads the code the same way auth-js does: `body.code` only when the answer carries GoTrue's
  `X-Supabase-Api-Version` header, otherwise `error_code`.
- **`lib/supabase/auth-transport.ts`.** This is the `global.fetch` of every cookie client. For each `/auth/v1/*`
  answer it records the outcome (`ok`, `definitive` or `unavailable`).
  - `keepSessionCookies` drops every auth-cookie deletion in a `setAll` batch when the last Auth answer was
    `unavailable`.
  - Budget: `AUTH_REQUEST_BUDGET_MS` = 3.5 s per client, counted from its first Auth call. A call still running at
    the deadline is aborted. That call, and every later one, gets a synthetic 408 with code
    `clinicos_auth_unavailable`. auth-js does not retry a 408, so its loop ends there.
  - A refresh that fails retryably (network error, or auth-js's statuses 500–504 and 520–530) also gets the 408 as
    soon as auth-js's next back-off sleep (200 ms × 2^n) would end past the deadline.
  - With `unavailable: true`, `GET /user` and the refresh-token grant get the 408 without a request being sent.
- **`proxy.ts`.**
  - `setAll` only buffers its writes.
  - `getClaims()` is raced against the budget plus 250 ms.
  - Three outcomes:
    - Signed in: the buffered writes are applied, as before.
    - Signed out (no session, or a definitive answer): the writes are applied (the deletions) and a page goes to
      `/login`, as before.
    - Unavailable (non-definitive error, a thrown error, or the deadline): no write reaches the browser or the
      request, and there is no `/login` redirect. The request continues with `x-clinicos-auth-state: unavailable`,
      GET/HEAD responses get no-store, and the log line `auth.proxy.unavailable` (code only) is written.
  - An inbound `x-clinicos-auth-state` header is stripped on every path.
- **`lib/supabase/server.ts`.** Uses the same transport (with `unavailable` set from the proxy's mark) and passes
  `setAll` through `keepSessionCookies`.
- **Callers.**
  - `withPageAuth` rethrows `AuthUnavailableError`, so the route error boundary handles it.
  - The Today page no longer reads the user itself; `getActiveMembership` classifies the failure.
  - `resolveServiceContext` returns `reason: "unavailable"`. The receipt-PDF, prescription-PDF and export routes
    answer it with 503.
  - `/auth/signout` always deletes the auth cookies. Otherwise a gateway 404 or 401 to `/logout`, which supabase-js
    treats as signed out, would now leave the cookies in place.
- **Client (`lib/pwa/session-status.ts`).** `retryDelayMs` stretches each back-off step by a random 0–50 %, using
  `WatchDeps.random`.
- **Pinning the clinic.**
  - When no clinic-id cookie is set, `/api/session-status` sets `clinic_active_tenant` to the clinic it resolved
    (HttpOnly, SameSite=Lax, Path=/, 400 days, Secure on https).
  - The `(dashboard)` layout passes the clinic it resolved, while none is pinned, to the shell (`shellClinic`).
    `PwaRuntime` sends it with each check as `x-clinicos-shell-clinic`. The route resolves this header as an explicit
    clinic, exactly like the cookie: a clinic that is not an active membership answers 403.
  - `getActiveMembership` throws `ActiveClinicMembershipEndedError` when a clinic is pinned and the user has no
    active membership at all.
- **`docs/runbooks/pwa.md`.** The session-status table now has two new paragraphs: "Auth incidents are not sign-outs"
  and "Pinned clinic".

## Finding → fix → test → fails without → probe before/after

**Before** is the same spec run on `78e2fa2` (`fails-without-vitest.txt`, `fails-without-e2e.txt`). **After** is the
06-09d tree (`probes-after-vitest.txt`, the full run and the PR lane). The probe lines use the re-verifier's `RV …`
format.

### H-AUTHOUT-R1 (High)

**Fix.** Refresh failures that are not definitive never delete cookies, in the proxy (buffered `setAll`) or in
route handlers and actions (`keepSessionCookies`). The proxy marks the request instead of redirecting, and the route
answers 503.

**Tests.**
- `session-auth-reverify-db.spec.ts`, against real local GoTrue sessions in ssr cookies. It runs the real route,
  proxy and actions, with an injected refresh failure for the session under test. The 12 modes are network, abort,
  503, 500, 520, 429, 408, uncoded 400, Kong 404, Kong 401, HTML 403 and `no_authorization`.
  - The route answers 503 twice, with no deletion and the jar unchanged.
  - The proxy answers 200, sends no `/login`, makes no `Set-Cookie`, sets the mark and sends no-store.
  - An action under a 429 gets `unavailable`.
  - Controls: a real revoked session, a synthetic `refresh_token_not_found` and a real malformed refresh token
    (`validation_failed`) still give 401, the cookie deleted and `/login`.
- e2e `11-refresh-outage-and-pin` `@golden`, through the server-side 429 fault hook:
  - two polls answer 503;
  - the URL, the typed text, the page (not concealed), the exact auth cookies and the device data are all kept;
  - there is no `auth.signout.done`;
  - a full load shows "Something went wrong" (the unavailable state), not `/login`;
  - a reload after the incident refreshes the session;
  - control: a definitive answer sends the device to `/login` with no cookies.

**Fails without.** Vitest:
- the route under 429 or 408 gives `503` then `401`, with `cookieKept=false`;
- the proxy gives a 307 to `/login` in all 12 modes, with `authCookieDeletions=1` for 429, 408, 400gw, 404kong,
  401kong, 403html and 401noauth;
- an action under a 429 gets `no_membership` with the cookie deleted.

e2e: `poll 1 during the rate limit` was 401 instead of 503 on desktop, Pixel 7 and iPhone 15. The fault fired 3
times.

**Probe before → after.**

| Probe | Before | After |
|---|---|---|
| Route, refresh `429` | `first 503 cookieKept=false; next poll 401` | `first 503 cookieKept=true; next poll 503` |
| Proxy, refresh `429` | `307 /login authCookieDeletions=1` | `200 next authCookieDeletions=0 mark=unavailable` |
| Route, refresh `network`, `503`, `500` | 503 / 503, with 50.8 s for two polls | 503 / 503, with about 6 s for two polls |

### L-R1 (classify)

**Fix.** Failures are classified by GoTrue's code, not by the 4xx status, as described for `auth-failure.ts` above.
A Kong "Invalid API key" 401 is unavailable.

**Tests.**
- `auth-failure.spec.ts`: the classifier, including the API-version header rule.
- `session-auth-reverify-db.spec.ts`: `/user` (unexpired token) in 12 modes gives 503 and keeps the cookies.

**Fails without.** `auth-failure.spec.ts` fails to import at the base. The route probes `user=400gw`, `404kong`,
`401kong` and `401noauth` gave `401 unauthenticated`.

**Probe before → after.** `user=400gw/404kong/401kong`: `401` before, `503` after.

### L-R2 (outage navigation)

**Fix.**
- The proxy no longer redirects to `/login` when Auth is unavailable.
- Under the mark, nothing refreshes a second time.
- The layout throws `AuthUnavailableError`, which reaches the global error state.
- `withPageAuth` rethrows it, which reaches the route boundary.
- Today no longer redirects on `!user`.

**Tests.**
- `session-auth-reverify-db.spec.ts` "L-R2": under the mark the route answers 503, refresh requests sent = 0, and
  both the layout and Today throw `AuthUnavailableError` with no `/login` digest.
- The proxy strips an inbound mark.
- e2e: a full load during a 429 shows the unavailable state.

**Fails without.** The L-R2 case timed out at 180 s on `78e2fa2`: under the mark, the base code refreshed again and
retried. The proxy probes went to a `/login` redirect.

**Probe before → after.** `proxy token=network`: `307 /login` (25 415 ms) before, `200 mark=unavailable`
(3 014 ms) after.

### L-R3 (retry)

**Fix.** Server budget (see `auth-transport.ts` above) and client jitter.

**Tests.**
- `auth-failure.spec.ts`: a hang is cut at the deadline; a 503 loop is cut before its sleep would pass the deadline.
- `session-auth-reverify-db.spec.ts` "L-R3": hang, network and 503 each finish under 5 s for the proxy and the
  route, and proxy + route stay under the 10 s `STATUS_TIMEOUT_MS`.
- `session-status.spec.ts`: `retryDelayMs` covers the range, and the watch uses `WatchDeps.random`.

**Fails without.** The L-R3 case timed out (120 s) on `78e2fa2`. Proxy calls took about 25.4 s. The jitter cases
failed.

**Probe before → after.**

| Probe | Before | After |
|---|---|---|
| Proxy `network` | 25 415 ms | 3 014 ms |
| Route `network` | 25 400 ms per poll | 3 012 ms |
| `hang`, proxy and route | — | 3 506 ms and 3 507 ms |

### M-REMOVED-R1 (Medium)

**Fix.** `/api/session-status` pins `clinic_active_tenant` when none is set, and the shell sends the layout's clinic
as `x-clinicos-shell-clinic`.

**Tests.**
- `session-auth-reverify-db.spec.ts` R3: a member of A only, with no cookie, gets the pin (HttpOnly, Lax, `/`).
  After being added to B the answer is 200 (A). After removal from A the answer is 403, and the action gets
  `no_membership`.
- The pin is written only when no cookie is set. A dual member with no cookie gets 409 and no pin.
- The header pins the user's own clinic, answers 403 for another clinic, and is ignored once a cookie is set.
- The layout hands the clinic to the shell only while nothing is pinned.
- `session-status.spec.ts`: the header is sent only for a clinic id.
- e2e `@golden`: a member who never had the cookie, added to B and removed from A, is signed out and purged on the
  next resume. The server ends the session, and the next sign-in opens B.

**Fails without.** Vitest R3 on `78e2fa2`:
`A-only 200 pin=none; +B 409; -A 200 {"accessLevel":"full"}; action tenant=B` (the re-verifier's reproduction).
e2e: the pin precondition failed (`clinic_active_tenant` stayed `null`) on all three projects.

**Probe before → after.** R3 cookie-less: `-A 200`, `action tenant=B` before; `-A 403 no_membership`,
`action no_membership` after.

### L-R4 (last clinic)

**Fix.** With a clinic pinned and no active membership left, `getActiveMembership` throws
`ActiveClinicMembershipEndedError`. The layout renders `MembershipEnded`, which signs out and purges.

**Tests.**
- `session-auth-reverify-db.spec.ts`: the layout returns `MembershipEnded` and the route answers 403. A new account
  with no pinned clinic still goes to `/clinic/new`.
- e2e: after removal from the last clinic, a full load reaches `/login`, never visits `/clinic/new`, and is purged.

**Fails without.** On `78e2fa2` the Vitest and e2e cases fail at the pin precondition (nothing pins a clinic there;
the e2e fails on desktop and Pixel 7, and the test is not `@golden`, so it does not run on iPhone 15). The L-R4 rule on
its own is proved by a mutation on the 06-09d tree (`lr4-mutation.txt`): without the new branch in
`getActiveMembership`, the layout redirects with `NEXT_REDIRECT;replace;/clinic/new` (the re-verifier's R6
reproduction) and the case fails.

**Probe before → after.** R6, removed from the last clinic and pinned: `/clinic/new` before (the re-verifier's
probe); `layout MembershipEnded; route 403` after.

### Regression that 06-09d introduced and fixed

`/auth/signout` while `/logout` answers a gateway 404 or 401: the auth cookies are deleted all the same.
`signout-mutation.txt` shows what happens with the old `if (failed)` rule on the 06-09d tree: 404kong and 401kong
give `authCookieLeft=true`, and 2 tests fail.

### Re-verifier probes not changed by 06-09d

These held before and still hold:
- `/user` network, abort, 503, 500, 520, 429, 408 and HTML 403 give 503.
- A revoked session gives 401.
- R1 and R2 (removed or suspended with a cookie) give 403.
- Forged and junk cookies: the 06-09c specs stay green in the full run.

## Deviations

1. **`no_authorization` is not definitive**, although the re-verifier listed it. auth-js never sends a session call
   without a bearer; with no bearer it answers `AuthSessionMissingError` itself. So when GoTrue says "no bearer" to a
   session call, a gateway dropped the header, and that must not sign out the whole fleet.
   **`validation_failed` is definitive.** Local GoTrue answers it to a malformed refresh token ("Refresh token is not
   valid"; checked with curl and in the spec), and only the session calls are classified.
2. **The layout cannot set cookies**, because it is a Server Component. Instead it passes the clinic it resolved to
   the shell, and the shell's first status check pins it through the route. The header can only confirm the clinic
   on screen or end the session; it cannot select a clinic the user does not belong to.
   This narrows the route doc's "no input is read". The guard's forged `?tenant=` leg is unchanged and still passes.
3. **The pinned cookie is HttpOnly**, as the re-verifier suggested, so JavaScript cannot forge it or switch the
   clinic. As a result the client fallback (`expireAuthCookies`, used when `/auth/signout` cannot be reached) cannot
   clear it. A stale pin then costs one sign-out on the next sign-in by a user who is not a member of that clinic,
   and that sign-out clears it. The V2-11 switcher must write this cookie with the same attributes.
4. **The tests' blip imitation of GoTrue was corrected.** `tests/helpers/blip-client.ts` answers now carry GoTrue's
   `X-Supabase-Api-Version` header. Without it, auth-js reads the answer as uncoded, which is now "unavailable".
   A `session_not_found` makes auth-js drop the in-memory session, as the real answer does, so the spec restores it
   (`restoreSession`).
5. **auth-js still logs a refresh failure itself** (`console.error` in `_emitInitialSession`) when
   `@supabase/ssr` subscribes. The message is the error text only (for example "Request rate limit reached"), with no
   PHI. This behaviour predates 06-09d and was not changed (no dependency change).
6. **The e2e fault hook** (`tests/e2e/support/server-auth-faults.cjs`) is a second `NODE_OPTIONS` preload in the e2e
   server only, loaded after the network guard, and it only affects loopback requests.
   `page.route` cannot reach the server's refresh, which is why the hook exists. Tokens are hashed and never written
   or logged. `tests/setup/e2e-app-env.spec.ts` checks it.

## Results (tools)

| Check | Result | Evidence |
|---|---|---|
| Full Vitest at `c68851a` (shared stack 000094) | 305 files, 6288 tests: 6288 passed, 0 failed, 0 skipped | `vitest-full-summary.txt` |
| Report gate | PASS: floor 5974 (6288 × 0.95 = 5973.6 → 5974), 218 required files | `vitest-gate.txt` |
| typecheck, eslint, inventory, ui-policy, ai-l1, React Compiler waivers | all exit 0; eslint has 0 errors and 440 warnings (276 in app code, the same as 06-09c); ui-policy deltas are all 0 | `static-checks.txt` |
| Probes before (`78e2fa2`) | 36 failed, 61 passed | `fails-without-vitest.txt` |
| Probes after (06-09d) | 109 passed | `probes-after-vitest.txt` |
| e2e fails without (`78e2fa2` build) | 8 of 8 new e2e cases fail on desktop, Pixel 7 and iPhone 15 | `fails-without-e2e.txt` |
| Targeted e2e (09 + 11, three projects, `--retries=0`) | 24 passed | `e2e-targeted.txt` |
| e2e PR lane run 1 (`npm run e2e:pr -- --retries=0`, build of `b11e398`) | 585 passed, 1 failed (root cause below), 196 skipped, 0 retried; the 8 expected failures are the known-bug cases | `e2e-pr-run1-summary.txt` |
| e2e repeat after the harness fix (09 + 11, three projects, `--repeat-each=4`, `--retries=0`) | 72 passed | `e2e-repeat.txt` |
| e2e PR lane run 2 (`npm run e2e:pr -- --retries=0` at `b904d8f`, build of `b11e398`) | desktop-chrome 389 passed / 5 skipped; iphone-15 38; pixel-7 144 / 191 skipped; pwa-ipados 7; setup 8; **0 failed, 0 retried**; the 8 expected failures are the known-bug cases | `e2e-pr-run2-summary.txt` |
| Mutations on the 06-09d tree | the sign-out rule (2 failed) and L-R4 (1 failed) | `signout-mutation.txt`, `lr4-mutation.txt` |
| gitleaks (every 06-09d commit, `--redact`) | written after this record is committed | `gitleaks.txt` |

### e2e PR-lane run 1: root cause (`e2e-root-causes.txt`)

One failure, on desktop-chrome, in 06-09c's `09-outage-and-removal` "a full page load after the removal signs out
too": `page.goto("/patients")` failed with `net::ERR_ABORTED`. The trace shows the sequence:
- the shell's start poll, sent right after sign-in, was still in flight when the test removed the membership;
- the poll answered 403, so `hardSignOut` posted `/auth/signout` and replaced the page with `/login`;
- that navigation aborted the spec's own `goto`.

Landing on `/login` with a purged device is the designed outcome; the race was in the spec. This is the 06-06 wave
note's rule: wait for the page's first status answer before changing what it will answer. The fix (`b904d8f`) makes
`dualMember` wait for the first 200. No test was retried.

G3 is not regenerated: no G3 screen changed. The only UI difference is the unavailable state during an Auth
incident, which is the existing global error screen, and the shell's new prop renders nothing.

## Open items

- **Orchestrator:** a fresh adversarial re-verification of the session and auth items, which are security-sensitive.
  The PO approves the gate.
- **V2-11 (clinic switcher):** write `clinic_active_tenant` with the same attributes, and only to an active
  membership (wave note).
- **`requireAccessDestination` (the locked and onboarding pages)** still throws `ActiveClinicMembershipEndedError` to
  the error page rather than signing out. These pages are outside the dashboard shell; the session-status poll does
  not run there, and the next dashboard load signs the device out. Low; owner V2-13b.
- **Lane note:** the base worktree `before09d` (detached at `78e2fa2`, its own `npm ci`) is removed after the
  evidence is written.
