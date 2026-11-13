# 03-12a record: FT-05 + change password + reset completion + error catalogue (AUTH-04b part, FT-05, A00-4 unit, A00-5, R-5, R-34)

**Outcome:** done locally. No real network: the Pwned Passwords range API sits behind an injectable fetcher. Unit
tests use a mocked fetcher. The DB lane and the e2e server use a loopback fake range server (`127.0.0.1`; fixed port
3101 for e2e, an ephemeral port for Vitest). Only the 5-character SHA-1 prefix leaves the process. The password, its
hash, the prefix and the suffix are never logged. Roadmap acceptance 13 ("a password from the Pwned Passwords corpus is
rejected by the change-password and reset actions") is proven locally. The real-API check on staging is **pending PO
(E4: `PWNED_CHECK=on`)**. The hosted require-current-password half of A00-5 is **pending PO (E3)**.
**Evidence:** `evidence/03-12a/` (tool output only). `commit.txt` holds the SHA the checks ran on.

## Commits

| SHA | Subject |
|---|---|
| `1bbb791` | feat: FT-05 `lib/auth/pwned.ts`; `PWNED_CHECK` / `PWNED_API_BASE_URL` with the R-15 checklist (schema, docs, `.env.example`, guard, e2e value, env specs) |
| `ea34a3e` | feat: error catalogue (`features/auth/errors.ts`, `messages/en.ts`); `features/auth/service.ts` + `actions.ts`; forgot-password final step through the action; guard kind `self`; unit and DB-lane specs |
| `94cb557` | feat: `/profile` change-password form; fake range API in Playwright global setup; J-A4, J-A5; axe checks |
| `1c91c25` | fix: synthetic password built at runtime in a unit spec; exact historic fingerprints in `.gitleaksignore` (repo convention) |
| (next) | docs: this record, the evidence and the wave-note rows |

## What shipped

- **FT-05 `isPwnedPassword(password, { enabled, baseUrl, fetcher, timeoutMs = 1500 })`** returns
  `pwned | clear | unavailable | skipped`. It hashes with SHA-1 (`node:crypto`) and sends `GET <base>/range/<5 hex>` with
  `Add-Padding: true`. Lines with count 0 are ignored. The deadline holds even when a fetcher ignores the abort signal.
  `unavailable` (network, timeout, non-200) writes one `pwned.unavailable` warn line (reason and status only) and the
  password is **allowed**. `PWNED_CHECK=off` returns `skipped` with no request.
- **Fail-open vs fail-closed (decided):** **fail-open**, as FT-05 and the plan (step 1) and the research say. Reasons:
  a third-party outage must not lock every clinic out of password reset (a safety and availability harm). FT-05 adds to
  the 10-character / 72-byte policy; it does not replace it. The warn line makes the gap visible. The self-only
  `updateUser` bypass is already accepted (T-03-21, R-5). Fail-closed would make HIBP a hard dependency of account
  recovery.
- **Env (R-15):** `PWNED_CHECK` `on|off`, default `off`. It **must be `on` in production**. Staging may be either; PO E4
  sets `on`. `PWNED_API_BASE_URL` defaults to `https://api.pwnedpasswords.com`. It may be set only in
  development/test/e2e, and must be loopback in test/e2e. With the check on in test/e2e/ci the override is required, so
  ci (which cannot override) cannot turn the check on and no test lane reaches the public API. Test-env guard: the Vitest
  lane keeps the check `off` (specs stub it per test). The e2e server option `pwnedCheck` allows `on`, which needs a
  base URL, and the base URL is a loopback URL var.
- **Error catalogue:** `messages/en.ts` (copy) and `features/auth/errors.ts` (codes, `authErrorMessage`,
  `authErrorCodeOf`, `isRateLimitCode`). It covers the AUTH §4.2 GoTrue codes `invalid_credentials`,
  `email_not_confirmed`, `over_request_rate_limit`, `over_email_send_rate_limit`, `otp_expired`, `weak_password`,
  `same_password`, `captcha_failed`, `current_password_required`, `current_password_invalid`, `user_already_exists`,
  `otp_disabled`, `signup_disabled`, `session_not_found`, plus the app codes `pwned_password` and `reauth_required`.
  Anything else gets the generic message. Both 429 codes share one "wait a minute" message (A00-4).
  `password-flows.ts` maps through the catalogue (`AUTH_MESSAGES` now derives from it). It also maps `captcha_failed`
  for sign-in and reset requests, ready for 03-12c.
- **`features/auth/service.ts`** (`server-only`). Check order: `getClaims()` on the request cookie client, then zod,
  then the A00-5 freshness check, then FT-05, then `updateUser`, then `signOut({ scope: "others" })`. Nothing is sent to
  the range API for an unauthenticated caller or an invalid input. Nothing is written when any step refuses.
  - `changePassword({ currentPassword, newPassword })` always sends `current_password`. An emailed-code session older
    than 10 minutes gets `reauth_required`.
  - `setNewPassword({ newPassword })` needs an emailed-code session no older than 10 minutes. A plain password session
    and a stale recovery session both get `reauth_required`, with the copy "This reset has expired. Request a new code
    and try again."
  - `sessionAuthFrom(amr)` / `assertFreshOtpSession(amr, 600)` (deviation 2).
- **`features/auth/actions.ts`** (`"use server"`) has `changePasswordAction` and `setNewPasswordAction`. They take
  password fields only: no id and no `*Override`. Both are in the guard manifest as the new kind `{ self: reason }`.
- **Forgot password (R-5):** the browser still requests the code and runs `verifyOtp({ type: "recovery" })`.
  `completeReset(client, input, setPassword)` then calls `setNewPasswordAction`. The browser `setNewPassword`
  (`updateUser` in the browser) is **removed**. A breached password keeps the code used and retries only the action. A
  `reauth_required` answer ends the recovery session and returns to the request step.
- **`/profile` "Change password"** (`components/profile/change-password-form.tsx`) has current, new and confirm fields
  and a hidden username field for password managers. It shows catalogue errors and the success copy "Password changed.
  Other devices were signed out." The restyle is V2-11.
- **Guard kind `self`.** The engine adds `selfParamViolations` (every input field must be a password field) and
  `selfActionLeg` (signed-in callers with forged tenant-B ids: no access beyond `auth`, a refusal, nothing of B
  returned). `guard-actions.spec.ts` runs the self leg for the outsider, the receptionist and the owner, and checks that
  row counts are unchanged. Self actions skip leg 4 (no membership needed) and leg 3 (no reference to forge, so the
  self leg replaces it). The canary case (e) proves the leg catches a data-reading fixture and an id-shaped input.
- **E2E:** global setup starts the fake range API on `127.0.0.1:3101` (`E2E_PWNED_API_BASE_URL`) and stops it in
  teardown. `tests/e2e/support/pwned-range-server.ts` lists `BREACHED_FIXTURE_PASSWORDS` (synthetic) as breached and
  records only the prefix and whether padding was requested.

## Tests (each fails without the change; `evidence/03-12a/mutation-run.txt`)

| Spec | Cases | Proves |
|---|---|---|
| `tests/auth/pwned.spec.ts` (mocked range API) | 13 | Hit → `pwned`, and exactly one request: 5-character prefix, `Add-Padding: true`, suffix not in the URL. Miss → `clear`. Padded count-0 line equal to the suffix → `clear`. Case and LF tolerance. **API down**: a network error and HTTP 429/500/503/404 each give `unavailable` and one warn line with no password, hash, prefix or suffix. Timeout (aborting fetcher, and one that ignores the abort) → `unavailable` within the deadline. Flag off → `skipped`, no fetch. Env defaults: off in the lane, on with the stubbed loopback base |
| `tests/auth/password-service.spec.ts` (fake auth client) | 22 | Unauthenticated → `session_not_found` with "sign in again" copy, no lookup. Valid change sends `{ password, current_password }`, then `signOut({ scope: "others" })`. Breached → `pwned_password`, no update. API unavailable → change goes ahead. **Wrong current password** (GoTrue `current_password_invalid`) → refused with its copy, nobody signed out, no message echo. `current_password_required`. **A00-4: both 429 codes → "Too many attempts, please wait a minute"** (status logged). `weak_password`, `same_password`, `session_not_found`. Unknown code or thrown error → generic. **A00-5:** emailed-code session at 601 s → `reauth_required`, at 600 s allowed. Unreadable `amr` → fail closed. Invalid input → no lookup. Sign-out failure → `otherSessionsSignedOut: false`. Reset: fresh recovery → update without `current_password` + sign-out. Breached refused. Stale or password session refused. Unauthenticated refused. `sessionAuthFrom` / `assertFreshOtpSession` boundaries. An `afterEach` checks no password appears in any log line |
| `tests/auth/password-schemas-and-errors.spec.ts` | 48 (+20) | Every catalogue code → its fixed copy. The code list equals AUTH §4.2 plus the 2 app codes. Unknown, missing, non-string, `toString` and `__proto__` → generic. Both 429 codes share one copy. Only `error.code` is read. Browser-flow mapping incl. `captcha_failed`. Change-password schemas. `completeReset` never calls `updateUser` in the browser, retries via the action, and maps a thrown action to the reset failure |
| `tests/integration/auth/change-password.spec.ts` (local GoTrue, loopback fake) | 6 | **Breached new password → `pwned_password`, one 5-character padded lookup, old password still works, breached one does not.** Valid change: new password signs in, old fails, the other session's refresh is revoked and its access token resolves no user, the acting session stays. `updateUser` received `current_password`. **Recovery session at 11 min (`vi.useFakeTimers({ toFake: ["Date"] })`) → `reauth_required`, no lookup, password unchanged.** Fresh recovery session may change. Unauthenticated → refused, no lookup. Check off → no lookup |
| `tests/integration/auth/reset-completion.spec.ts` (local GoTrue + Mailpit) | 4 | Mailpit code → `verifyOtp` → `setNewPasswordAction` with a breached password → refused at stage `update`, password unchanged. Retry with a clear one → other device signed out, new password works. **Plain password session → refused, unchanged.** Recovery session at 11 min → refused. Unauthenticated → refused |
| `tests/integration/auth/password-auth.spec.ts` | 12 (changed) | The V2-01 reset cases now run through the action's service on the browser-like session |
| `tests/security/guard-actions.spec.ts` / `guard-canary.spec.ts` | +4 / +1 | Both actions are `self`, the leg is not vacuous, legs pass, nothing written. Canary (e) |
| `tests/config/env-schema.spec.ts` / `env-boot.spec.ts` / `tests/setup/test-env-guard.spec.ts` | +7 / 2 changed / +1 | Production without `PWNED_CHECK=on` fails (boot names it). Override refused in ci/staging/production. Loopback-only in test/e2e. On in a loopback tier needs the override. Defaults. The e2e server env parses with on + loopback. Guard pins |
| `tests/e2e/auth/j-a4-reset.spec.ts` (desktop-chrome, pixel-7) | 1 × 2 | Forgot password → code from Mailpit → breached password refused with the catalogue copy (code field locked) → clear one accepted → lands on `/` → second context signed out → new password signs in, old refused |
| `tests/e2e/auth/j-a5-change-password.spec.ts` (desktop-chrome, pixel-7) | 1 × 2 | `/profile`: mismatch caught in the client, breached refused with the copy, clear accepted with the success copy, fields cleared, this device stays signed in, the other context is signed out, new password works, old refused |
| `tests/e2e/a11y/v2-01-screens.spec.ts` | +6 | Reset "set a new password" step and the change-password form at 360/820/1280: **0 serious/critical axe**, no overflow at 360. Screenshots at 360/820/1280 were also checked by eye; whole-page horizontal scroll on `/profile` was false at all three |

Mutation run (service with FT-05 skipped, the bound removed, the sign-out removed, the 429 and
`current_password_invalid` mapping removed, `current_password` not sent): **16 of 32 failed**, covering every required
case. The service was restored afterwards with no diff.

## Checks (on the SHA in `evidence/03-12a/commit.txt`)

| Check | Result | Evidence |
|---|---|---|
| `npm run typecheck` | exit 0 | `static-checks.txt` |
| `npx eslint .` | 0 errors, 422 warnings (none in 03-12a files) | `static-checks.txt` |
| `npm run inventory`, `env-example --check`, `check-auth-config` | all pass | `static-checks.txt` |
| Full Vitest lane (`npm run test:db`) | 140 files, 2636 passed, **0 failed**, 0 skipped. Report gate PASS (floor 1805, the 5 new or changed 03-12a files required) | `vitest-full.json`, `vitest-full-tail.txt`, `vitest-report-gate.txt` |
| `npm run e2e:build && npm run e2e:pr` (at `94cb557`; `1c91c25` changed only a unit spec and `.gitleaksignore`) | 142 expected, 0 unexpected, **0 flaky / retried**, 10 known-bug expected failures. 4 skipped on pixel-7 (error-sink and send-email specs, by design). J-A4/J-A5 one attempt each on both devices | `playwright-results.json`, `playwright-summary.txt` |
| gitleaks v8.30.1 (full history at `1c91c25`) | no leaks found | `gitleaks.txt` |

## Deviations and interpretations (for review D and the PO)

1. **DB-lane range API = loopback fake server, not a stubbed `globalThis.fetch`.** The plan said to stub `fetch`, but
   the same process's supabase-js uses `fetch` for GoTrue. A loopback server exercises the real `fetch` path and records
   what k-anonymity exposes (prefix, padding). The unit spec still uses a mocked fetcher (roadmap "mocked range API").
2. **A00-5 bound reads every emailed-code `amr` method, not only "the latest entry".** The methods are `otp`,
   `recovery`, `magiclink`, `invite`, `email/signup` and `email_change`. Age runs from the newest such factor. A TOTP
   step-up after an OTP sign-in therefore cannot reset the clock. An empty or malformed `amr` fails closed. Future
   timestamps are tolerated up to 30 s of clock skew. This is stricter than the plan text and stays inside A00-5.
3. **Wrong current password: unit-level proof only (R-34).** The CLI stack cannot enable require-current-password,
   so local GoTrue ignores a wrong `current_password`. The integration spec proves the action sends it. The unit spec
   proves that GoTrue's `current_password_invalid` / `current_password_required` are refused with their copy and that
   nobody is signed out. Hosted enforcement is AUTH-00 re-check item 3 (**pending PO E3**).
4. **Finding: local GoTrue already ends the other sessions on a password change.** Before the action's `signOut`, the
   other session's `getUser()` already fails (`AuthSessionMissingError`) and its refresh is revoked. So the
   integration "other sessions signed out" leg passes even without our sign-out. The explicit
   `signOut({ scope: "others" })` (AUTH §3 contract, defence in depth) is pinned by the unit spec. Add this to the
   AUTH-00 hosted re-check (does hosted GoTrue do the same?) and to VERIFICATION_LOG.
5. **`setNewPasswordAction` refuses a plain password session** with code `reauth_required` and reset-specific copy.
   It does not have its own code. The page treats `reauth_required` as "start again with a new code".
6. **`changePasswordAction` requires the current password even for a fresh emailed-code session.** GoTrue does not
   check it there. A user who does not know it uses forgot password. No OTP sign-in exists today (signups off,
   magiclink dropped, A00-1).
7. **Catalogue copy for codes the app cannot hit yet** (`user_already_exists`, `otp_disabled`, `signup_disabled`) is
   neutral and does not enumerate accounts. The PO may reword it in V2-13b.
8. **Files beyond the plan list:** `tests/auth/password-service.spec.ts`, `tests/helpers/auth-flows.ts`,
   `tests/e2e/support/password-journeys.ts`, `tests/security/guard-actions.spec.ts` and `guard-canary.spec.ts` (needed
   to run the `self` legs), `tests/config/env-boot.spec.ts` and `tests/setup/test-env-guard.spec.ts` (R-15), and
   `.gitleaksignore`.
9. **The e2e "signed out" check** opens `/patients`, as journey-01 does. Without a session the v1 page throws
   `Unauthenticated` before the redirect, which logs one server error per check. This is the pre-existing OA-5 gap that
   03-12b closes.

## Threat flags

| Flag | File | Description |
|---|---|---|
| threat_flag: egress | `lib/auth/pwned.ts` | New outbound HTTPS call from the change-password and reset request paths to `api.pwnedpasswords.com`, only when `PWNED_CHECK=on`, after authentication. At most one call per attempt, 1.5 s deadline, 5-character prefix only. On outage it fails open with a warn line (T-03-21 residual unchanged) |
| threat_flag: log | `features/auth/service.ts` | New info and warn lines `auth.password.changed` / `auth.password.rejected` / `auth.password.others_not_signed_out` / `auth.password.update_failed` carry `userId` (UUID), `action`, `reason` (a catalogue code), `status`, `requestId`. They never carry a password, email or GoTrue message |

## Residuals and handoffs

- **PO E4:** set `PWNED_CHECK=on` on staging (already listed). **Acceptance 13 hosted check:** on staging, change
  password to a known-breached password and see `pwned_password`. **PO E3:** require-current-password on hosted;
  re-check that a wrong current password gives `current_password_invalid` and that recovery and OTP sessions are exempt
  (A00-5 bound covers them). Add deviation 4 to the AUTH-00 re-check kit (03-12c).
- **03-12c:** `app/(auth)/forgot-password/page.tsx` and `features/auth/password-flows.ts` are now yours. `completeReset`
  takes `setPassword` (the page passes `saveNewPassword`, which wraps `setNewPasswordAction`). `mapAuthError` already
  maps `captcha_failed`. The env-guard files have `PWNED_*` entries; follow their pattern.
- **03-12b:** the guard manifest has kind `{ self }` (no membership, no leg 3/3b/4; the self leg instead). J-A4/J-A5
  check "signed out" via `/patients` → `/login`, which still holds under default-deny.
- **Close:** add `tests/auth/pwned.spec.ts`, `tests/auth/password-service.spec.ts`,
  `tests/integration/auth/change-password.spec.ts` and `tests/integration/auth/reset-completion.spec.ts` to
  `REQUIRED_FILES`. Review D (auth) covers `features/auth/**`, `lib/auth/pwned.ts`, the `PWNED_*` env rules, the `self`
  guard kind and the forgot-password page. The 03-11b hook is unchanged: 03-12a does not use `reauthenticate()`.
