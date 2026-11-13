# 03-13a record: auth and session review fixes (H-AUTH, M-OTP, M-EMAILCAP, review D Lows)

**Scope:** the 03-13a rows of `03-13-REVIEW-TRIAGE.md`: H-AUTH (High; IND H-1, D H-1), M-OTP (D M-1, ruling R-36),
M-EMAILCAP (D M-2) and the 03-13a Lows (D L-2, L-4, L-5, the sign-out-with-expired-token test, the Send Email hook
`webhook-id` dedupe and SES time budget). Rulings applied: **R-35** (a reset ends signed out), **R-36** (email OTP
length 8).
**Outcome:** done locally. Each fix has a test that fails without it (pre-fix runs in `evidence/03-13a/`). Hosted-only
parts are in the AUTH-00 re-check kit (items 10 and 11) and listed under "Local vs hosted" below.

## Triage ID → commit → test

| ID | Commit | Test that fails without it | Pre-fix failure (evidence) |
|---|---|---|---|
| H-AUTH (a) reset ends the recovery session (R-35) | `44c8fdf` | `tests/integration/auth/reset-completion.spec.ts` "R-35 / H-AUTH: reset completion revokes the recovery session; its tokens then fail on a direct GoTrue PUT /auth/v1/user" | `prefix-hauth-direct-put.txt`: the direct `PUT /auth/v1/user` with the recovery session's access token after the reset answered **200** |
| H-AUTH (b) proxy ends an emailed-code session past 600 s | `44c8fdf` | `tests/api/proxy-session.spec.ts` "03-13a H-AUTH …" (real recovery session from the local GoTrue + Mailpit, aged with a fake `Date` in the spec only) | `prefix-failing-run.txt`: "expected 200 to be 307"; "no auth cookie reaches the handler: expected true to be false" |
| H-AUTH unit (R-35 order, fallback) | `44c8fdf` | `tests/auth/password-service.spec.ts` "R-35: …" (2 cases) | `prefix-failing-run.txt` |
| L-2 unknown `amr` fails closed | `44c8fdf` | `tests/auth/session-age.spec.ts` | module did not exist (`Cannot find module '@/lib/auth/session-age'`); before, an unknown method classified as a password session |
| M-OTP (R-36) | `ff38b2b` (+ copy in `7dd7811`) | `tests/ci/auth-policy.spec.ts` floor cases; `tests/auth/password-schemas-and-errors.spec.ts` "accepts exactly eight digits"; kit item 10 `otp_length` 8 | `prefix-failing-run.txt`: "FLOOR email_otp_expiry … / mailer_otp_length = 8" not found; schema refused 8 digits |
| M-EMAILCAP (page) | `8464afa` | `tests/auth/password-flows-captcha.spec.ts` "03-13a M-EMAILCAP …" | "expected { ok: true } to deeply equal { ok: false, … }" |
| M-EMAILCAP (hook-vs-cap probe) | `9f91c9f` | kit item 11 (`tests/integration/auth/auth00-recheck-kit.spec.ts`), CLI bounds (`tests/ci/auth00-recheck-cli.spec.ts`) | items 10/11 absent; `--email-cap-probe` unknown |
| L-5 `next` → `/api`, `/auth` | `0a709ea` | `tests/auth/safe-next.spec.ts` "03-13a (review D L-5) …" (13 cases) | "expected '/api/patients/abc/export' to be null" etc. |
| L-4 matcher skipped image-extension page paths | `5b70674` | `tests/api/proxy-matcher.spec.ts` (Next's own `unstable_doesMiddlewareMatch`); e2e `tests/e2e/security/unauth-pages.spec.ts` "03-13a (review D L-4) …" (built app: 307 to `/login`, request id) | 7 nested paths "expected false to be true" |
| Low: sign-out with an expired token | `c2a104e` | `tests/auth/signout-route.spec.ts` "03-13a: with an EXPIRED access token …" | **passes before and after**: coverage gap only (supabase-js refreshes, then signs out); no code change needed |
| Low: hook `webhook-id` dedupe | `b57d1e0` | `tests/auth/send-email-hook.spec.ts` "03-13a: webhook-id dedupe …" (replay, concurrent retry, retry after failure) | `resetHookDedupeForTests` absent: whole file failed |
| Low: hook SES budget below GoTrue's timeout | `b57d1e0` | same file "a provider that hangs is aborted at the 3500 ms budget …"; `tests/auth/ses-sender.spec.ts` "03-13a: the hook's time budget reaches the SES HTTP layer" | ses-sender: "Test timed out in 20000ms" (the signal never reached the SDK) |

Follow-ups `7dd7811`: copy ("an 8-digit code"), `tests/api/api-v1-switch.spec.ts` matcher expectation (a nested
`/images/hero.webp` now runs the proxy), the `request-id.spec.ts` `getClaims` double now carries `amr` (the proxy ends a
session without a readable `amr`), `lint-fixtures/auth-policy/hosted-staging.json` `mailer_otp_length` 8. `f4e93a5`:
`tests/e2e/a11y/reset-screens.spec.ts` (the code step and the signed-out done step at 360/820/1280 with axe, on real
resets).

## What changed

- **`lib/auth/session-age.ts`** (new, pure): one `amr` classifier for the proxy and the password actions
  (`features/auth/service.ts` re-exports it). Only `password`, `totp`, `mfa/totp`, `mfa/phone`, `mfa/webauthn` are
  non-emailed factors; any other method (known emailed ones and anything unknown) counts as an emailed code (L-2). A
  password sign-in LATER than the newest emailed-code factor makes it a password session. `sessionMustEnd(amr)`: an
  emailed-code factor older than 600 s, or an unreadable `amr`.
- **`proxy.ts`** after `getClaims()`: when `sessionMustEnd`, `signOut({ scope: "local" })` revokes the session at
  GoTrue (refresh token dead; GoTrue then refuses its access token: `session_not_found`), every `sb-*-auth-token`
  cookie is removed from the forwarded request and deleted in the browser whatever GoTrue answered (fail closed), the
  response is `no-store`, and the request continues signed out: a page GET goes to `/login?next=…`; a Server Action
  POST or an `/api` call reaches its handler with no session. No clock or test switch in production code.
- **Reset completion (R-35)**: `setNewPassword` ends with `signOut({ scope: "global" })` (every session, the recovery
  one included), `local` as a fallback; result `{ ok, otherSessionsSignedOut, signedOut: true }`. The page clears
  this device too, shows "Password changed / Your password was changed. Sign in with your new password." and a
  "Sign in" button to `/login`. Change password from `/profile` is unchanged (`others`).
- **M-OTP (R-36)**: `otp_length = 8` in `config.toml` and every policy column; `check-auth-config.mjs` enforces floors
  on every environment column (`email_otp_length >= 8`, `email_otp_expiry <= 600`), also for `--print`. The reset
  form, schema and test helpers use 8 digits. Stack restarted with the new config (GoTrue env
  `GOTRUE_MAILER_OTP_LENGTH=8`). The hook's template still accepts 6–10 digits so staging keeps delivering until the PO
  applies 8 there (E3).
- **M-EMAILCAP**: `requestReset` maps `over_email_send_rate_limit` to `email_send_limited` ("We can't send a code
  right now. Try again later.") instead of success. GoTrue uses that one code for the per-address interval and the
  project-wide cap; the per-address case already showed to any direct `/recover` caller.
- **L-5**: `safeNextPath` refuses `/api` and `/auth` (case-insensitive, on the URL-normalised path of every decoded
  form).
- **L-4**: matcher excludes only ONE top-level segment with an image extension (`/logo.png`); there is no `public/`
  directory and no top-level dynamic route, so nothing legitimate is lost.
- **Hook**: deliveries remembered by `webhook-id` for 10 minutes (bounded 1 000, per instance); messages sent in
  parallel and aborted at `HOOK_SEND_BUDGET_MS` = 3 500 ms (`GOTRUE_HOOK_TIMEOUT_MS` = 5 000); `EmailSender.send`
  takes `{ signal }` (SES `abortSignal`, Mailpit fetch); SES timeouts 1 s connect / 1.5 s request.
- **AUTH-00 kit** (`KIT_VERSION` 2): item 10 (code length, recovery `amr` methods all treated as emailed codes, tokens
  dead after `/logout?scope=global`, opt-in `--stale-wait-seconds 601..890`), item 11 (opt-in `--email-cap-probe
  <= 70` admin invites to find whether `email_sent` binds hook sends).

## Local vs hosted (honest limits)

Proven on the local stack: GoTrue refuses the recovery session's tokens after the reset (direct `PUT /auth/v1/user`
403, refresh `refresh_token_not_found`); the proxy revokes a recovery session aged past 600 s and GoTrue then refuses
its tokens; 8-digit codes are issued and verified; unknown `amr` methods fail closed.

Not provable locally, now in the kit:
1. **Residual (accepted by design, owner: the proxy bound + R-35):** GoTrue itself has no age bound. An emailed-code
   session whose tokens are stolen and used straight at GoTrue BEFORE the browser next calls the app (for example an
   abandoned reset tab: code verified, tab closed before the password was saved, so the page's unmount sign-out never
   ran) can still `PUT /user {password}` until the proxy sees it. R-35 removes the common case (every completed reset
   ends the session at once). Kit item 10's opt-in stale probe records the hosted answer (expected 200). Closing it
   fully needs a GoTrue-side bound (a Custom Access Token hook refusing refresh for stale `otp` sessions, or Pro
   session time-boxes): a new DB function / plan decision, not taken here.
2. Hosted `require current password` exemption for emailed-code sessions: kit item 3 (unchanged).
3. Whether hosted `/logout?scope=global` kills the recovery tokens: kit item 10.
4. Whether the `email_sent` cap binds hook sends: kit item 11 (opt-in, spends the hourly allowance).
5. GoTrue's hook timeout (5 s in v2.197.0 source; the local binary's message reads "Failed to reach hook within
   maximum time of %f seconds"): not measurable locally (the hook is off on the CLI stack); a hosted change would show
   as hook timeouts in the Auth logs.
6. The per-instance `webhook-id` memory cannot dedupe a retry that lands on another Vercel instance (harmless: the
   same code to the same address); the shared store comes with the V2-04 outbox.

## Hand-offs

- **PO-ACTIONS 03-E3 text** (orchestrator to apply): "Email OTP length: **8** (ruling R-36; was 6)", and apply it
  before (or with) the deploy that carries `ff38b2b`: the reset form accepts 8 digits only.
- **`staging.yml` `auth00-recheck` job** (workflow not owned by 03-13a): add two optional dispatch inputs passed as
  `--stale-wait-seconds` and `--email-cap-probe`, so the PO can run items 10 (stale part) and 11 on staging.
- `messages/en.ts` gained `auth.flows.reset_send_limited` and `auth.flows.reset_done`.
- Pre-fix runs used a detached scratch worktree at `98b7605` with the new test files copied in (no stash, nothing
  committed there).

## Verification (tool output in `evidence/03-13a/`)

| Check | Result | File |
|---|---|---|
| New tests fail without the fixes | 13 of 14 spec files fail at `98b7605`; the sign-out-with-expired-token case passes both ways (coverage only) | `prefix-failing-run.txt`, `prefix-hauth-direct-put.txt` |
| The same specs after the fixes | all pass | `postfix-targeted.txt` |
| Full Vitest, clean checkout of `f4e93a5` | 3347 passed, **3 failed** in 2 files: `no-raw-error-logging.spec.ts`, `system-db.spec.ts`, both from the committed 03-13d log-field change (not 03-13a files); every 03-13a spec passes | `vitest-full-clean-checkout.txt` |
| Full Vitest, shared tree (with other plans' WIP) | 22 failed, all in 03-13d files (`no-raw-error-responses.spec.ts` WIP + the two above) | `vitest-full-shared-tree.txt` |
| `npm run e2e:build` + `npm run e2e:pr` | 183 passed, **0 flaky (retried)**, 0 failed, 7 skipped by design, 10 KNOWN-BUG expected failures; J-A4 (R-35), the L-4 built-app case and the new reset a11y spec pass | `e2e-pr.txt` |
| UI 360/820/1280 + axe (code step, done step) | 0 violations of any impact on all six screens; no horizontal scroll at 360 px; screenshots checked | `axe-reset-screens.json` |
| `npm run typecheck`, `npx eslint` (changed paths), `npm run inventory` | clean (0 errors; inventory 0 flagged) | (run log in this session) |
| gitleaks (the 03-13a commits) | no leaks; full history has 2 findings, both in 03-13c commit `39695e8` (`tests/api/v1-system-client-order.spec.ts`, rule `clinicos-api-key`) | `gitleaks.txt` |
