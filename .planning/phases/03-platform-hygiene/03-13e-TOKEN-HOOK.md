# 03-13e record: session-age bound at the token issuer (Custom Access Token hook, H-AUTH residual)

**Scope:** the residual 03-13a left open on triage row **H-AUTH** (`03-13-REVIEW-TRIAGE.md`; reviews IND H-1, D H-1;
`03-13a-AUTH-FIXES.md` "Local vs hosted" item 1). GoTrue itself had no age bound, so a stolen refresh token of an
emailed-code session could be refreshed straight at GoTrue (never touching the app) and the fresh access token used
for `PUT /auth/v1/user {password}` at any age.
**Outcome:** done locally. GoTrue now refuses to mint any access token (sign-in, verification or refresh) for an
emailed-code session more than 600 s after its code, so a stolen refresh token stops yielding tokens at the bound.
The refusal tests fail on the pre-fix stack (`evidence/03-13e/prefix-failing-run.txt`). An `exp` cap was built,
measured and dropped (see "Design").

## Supabase facts relied on (checked against the current docs, fetched 2026-11-13)

- `supabase.com/docs/guides/auth/auth-hooks`: the Custom Access Token hook is available on **Free and Pro** (MFA /
  password-verification hooks are Teams+). A Postgres hook is `pg-functions://postgres/<schema>/<function>`; GoTrue
  calls it as `supabase_auth_admin`; guidance: grant EXECUTE (and schema USAGE) to `supabase_auth_admin`, revoke from
  `anon`, `authenticated`, `public`, and prefer no `security definer`. A hook returning `{"error": {"http_code",
  "message"}}` makes GoTrue fail the request with that error ("will only take into account the error and disregard the
  rest of the payload"); Postgres hooks are not retried and have a 2 s budget.
- `.../custom-access-token-hook`: input `user_id`, `claims` (required `iss aud exp iat sub role aal session_id email
  phone is_anonymous`; optional `amr`), `authentication_method`; output `{claims}`.

## Payload observed on the local stack (GoTrue v2.197.0, before writing the logic)

A scratch pass-through function (never committed; dropped by the `db reset`) recorded every hook call:

| Flow | `authentication_method` | `claims.amr` | Other event keys |
|---|---|---|---|
| password sign-in | `password` | `[{"method":"password","timestamp":<sign-in>}]` | `user_id`, `metadata {name: "customize-access-token", time, uuid, ip_address}` |
| refresh of that session | `token_refresh` | unchanged (same timestamp) | same |
| recovery code verified (`verifyOtp` type `recovery`) | **`otp`** | `[{"method":"otp","timestamp":<verify>}]` | same |
| refresh of the recovery session after its `auth.mfa_amr_claims.updated_at` was moved back 700 s | `token_refresh` | `otp` timestamp moved back 700 s | same |

Claims keys: `aal amr app_metadata aud email exp iat is_anonymous iss phone role session_id sub user_metadata`. The
call runs with `session_user` = `supabase_auth_admin`. So `amr` is built from `auth.mfa_amr_claims` (factor
`updated_at`), a refresh never moves it, and the age of a real session can be simulated in data without touching any
clock: that is how the integration tests age sessions.

## Design (migration `000030_session_age_token_hook.sql`)

- `private.session_age_token_hook(event jsonb) returns jsonb`, plpgsql, `STABLE`, **SECURITY INVOKER** (runs as
  `supabase_auth_admin`, reads only its argument and `now()`), `SET search_path = ''`. Schema `private` (not served by
  PostgREST). `GRANT USAGE ON SCHEMA private TO supabase_auth_admin`; EXECUTE revoked from `PUBLIC, anon,
  authenticated, service_role`, granted to `supabase_auth_admin` only.
- Classification = `lib/auth/session-age.ts` (03-13a, L-2): non-emailed methods are
  `private.session_age_non_mailbox_methods()` = `password, totp, mfa/totp, mfa/phone, mfa/webauthn`; any other method,
  known or unknown, is an emailed code; a password factor LATER than the newest emailed-code factor makes it a
  password session; bound `private.session_age_fresh_seconds()` = 600. The DB spec asserts both values equal the TS
  constants and that hook refusal equals `sessionMustEnd` on shared vectors.
- Decisions: password session → event returned unchanged. Emailed-code session older than 600 s → `{"error":
  {"http_code": 403, "message": "Session expired. Sign in again."}}` (GoTrue answers the refresh with **403**, no
  tokens; every later refresh too, since the factor only gets older). Younger → the event unchanged. Missing, empty
  or malformed `amr`, or no `claims` object → refused (fail closed).
- **`exp` cap: built, measured, dropped.** A first version also lowered `exp` to code time + 600 s. GoTrue signs the
  lowered `exp` but still reports `expires_at`/`expires_in` from its config (probe: `expires_at - exp` = 300 on verify
  and on refresh), so supabase-js and the proxy disagree with GoTrue for 300 s: `getClaims()` fails on the expired JWT
  before the proxy can read `amr`, so the proxy's 03-13a rule (revoke at GoTrue, delete and strip the cookies) no
  longer runs; 4 of the 03-12a/03-13a stale-session specs failed (`reauth_required` became `session_not_found`;
  cookies not deleted). Kept the assigned design (refuse the refresh) and left 03-13a's behaviour and specs untouched.
  The remaining tail is in "Local vs hosted".
- No test switch: the hook reads `now()`. Unit tests craft the event with old `amr` timestamps; integration tests move
  a real session's `auth.mfa_amr_claims.updated_at` back.
- Wiring: `supabase/config.toml` `[auth.hook.custom_access_token] enabled = true, uri =
  "pg-functions://postgres/private/session_age_token_hook"` (stack restarted; GoTrue env
  `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true`, `..._URI` as above). `supabase/auth-policy.json` rows
  `hook_custom_access_token_enabled` (true everywhere) and `hook_custom_access_token_uri` (same URI everywhere; Management
  API fields confirmed in the CLI 2.120.0 binary; `hook_custom_access_token_secrets` stays unmapped as a secret).
  `scripts/ci/check-auth-config.mjs` makes both **security floors** in every column, so neither the policy nor
  config.toml can drop the hook, and the hosted drift check (`scripts/drift/auth-config-hosted.mjs`, staging column)
  reports drift until staging runs it. `lint-fixtures/auth-policy/hosted-staging.json` gained the three hook fields.
- AUTH-00 kit item 10 (`scripts/staging/auth00-recheck-lib.ts`): the opt-in stale probe now also records the refresh
  grant (`stale_recovery_session_refresh`): expected 403 with the hook, 200 means the hook is off on that project.
  `PUT /user` with the access token minted at verification is still expected 200 (bounded residual below).
- Kit item 8 root cause (found by the full lane, not caused by 000030): GoTrue takes the `amr` time from the session's
  DB row and `iat` from its own clock a few ms later, both cut to seconds, so under load a sign-in straddles a second
  (`iat` = timestamp + 1). Probed: with a 1.5 s hook every sign-in still had `iat` = timestamp (both are fixed before
  the hook runs). `timestamps_equal_iat` → `timestamps_at_iat` (gap 0 or 1 s).
- `app/api/ready/expected-migration.ts` → `000030`; `scripts/drift/schema-snapshot.txt` regenerated after
  `npx supabase db reset --local` (3 new `function private.session_age_*` lines; no grant line: no API role holds
  EXECUTE). `types/database.ts`: `npm run db:types` produced no change (`private` is not in the generated schema).

## Test → commit

| Change | Commit | Test that fails without it | Pre-fix failure (`prefix-failing-run.txt`) |
|---|---|---|---|
| Hook refuses an emailed-code session past 600 s at GoTrue | `28f5dd2` | `tests/integration/auth/session-age-token-hook.spec.ts` "past 600 s the refresh is refused (403, no token) …" and "an unknown amr method fails closed …" | "expected 200 to be 403" (the aged recovery session and the aged unknown-method session both refreshed) |
| Hook logic, fail closed, parity with `lib/auth/session-age.ts`, privileges | `28f5dd2` | `tests/auth/session-age-token-hook-db.spec.ts` (crafted events; 61 cases) | 31 failed against a pass-through hook without the helpers: every refusal case, the list/bound parity, 5 refusal parity vectors, the helper-function privileges; password and fresh cases pass both ways (no-regression checks) |
| Policy floor: hook enabled + URI in every environment | `28f5dd2` | `tests/ci/auth-policy.spec.ts` "03-13e (H-AUTH): the session-age Custom Access Token hook is a floor …" | static check: with HEAD~ `check-auth-config.mjs` no FLOOR line exists for the hook rows (the case asserts them) |
| Kit item 10 records the stale refresh | `8cb366b` | `tests/integration/auth/auth00-recheck-kit.spec.ts` item 10 (`stale_recovery_session_refresh` "not-run" by default) | key absent before |
| Kit item 8 second-boundary race (found by the full lane) | `d1a3fd0` | same spec, item 8 (`timestamps_at_iat`) | first full-lane run of this plan (at `8cb366b`; its output was overwritten by the rerun, not kept): 1 failed of 3454, "expected { present: true, …(4) } to match object …" (`timestamps_equal_iat` false under load) |

Re-run unchanged and passing with the hook on: 03-13a's H-AUTH specs `tests/api/proxy-session.spec.ts`,
`tests/integration/auth/reset-completion.spec.ts`, `tests/integration/auth/change-password.spec.ts`,
`tests/auth/session-age.spec.ts`, `tests/auth/password-service.spec.ts`, plus `auth-config-applied`, `password-auth`,
`request-id`, `readiness-probe-db`, `schema-snapshot`, `auth-config-hosted`, `auth00-recheck-cli`
(`postfix-targeted.txt`: 15 files, 233 tests passed).

## Verification

| Check | Result | File |
|---|---|---|
| New refusal tests fail before the fix | 33 failed / 38 passed (3 files) with a pass-through hook and no helper functions | `prefix-failing-run.txt` |
| Targeted specs after the fix (incl. 03-13a H-AUTH specs) | 15 files, 233 passed, 0 failed | `postfix-targeted.txt` |
| Full Vitest lane at `d1a3fd0` | 162 files, 3454 passed, 0 failed (the 03-13d logger failures named in the brief no longer occur) | `vitest-full.txt` |
| `npm run e2e:build` + `npm run e2e:pr` | 188 passed, 0 flaky (retried), 0 failed, 7 skipped by design | `e2e-pr.txt` |
| `node scripts/drift/schema-snapshot.mjs --local --check` | PASS (2210 lines equal the committed snapshot) | (run log) |
| `npm run typecheck`, `npx eslint` (changed paths), `npm run inventory` | 0 errors; inventory 0 flagged | (run log) |
| `npm run db:types` | no change to `types/database.ts` | (run log) |
| gitleaks v8.30.1 (the 3 fix commits; full history) | no leaks found (3 commits; 505 commits) | `gitleaks.txt` |

## Local vs hosted (honest limits)

- Proven locally against the real GoTrue: refresh refused past 600 s (403, no tokens, again on retry; supabase-js
  gets the 403 and no session), allowed at 0 s and 590 s with claims unchanged, password sessions untouched at 30 days
  (normal 900 s token), an unknown `amr` method allowed fresh and refused past 600 s, hook not executable by anon or
  authenticated.
- Hosted: the hook is OFF on staging/production until the PO enables it (03-E3 below). Until then the drift check
  fails on the two new rows and kit item 10's opt-in stale probe still answers 200. Enable it in the same window as
  (or after) migration 000030 reaches that database: a hook pointing at a missing function fails every sign-in.
- A session refused by the hook cannot be refreshed, so a user who leaves a reset or invite half-finished for more than
  10 minutes must request a new code (same as the proxy rule since 03-13a; no UX change).
- **Remaining window (bounded residual):** an access token already minted keeps its 900 s lifetime, so the last
  token a thief can get (a refresh just before 600 s) can call `PUT /auth/v1/user` until at most ~1 500 s after the
  code (was: unbounded at GoTrue). Inside that window the app's proxy still revokes the session the moment the
  user's browser calls the app (03-13a). Closing the tail fully needs GoTrue to honour a hook-lowered `exp` in
  `expires_at` (it does not, v2.197.0) or a shorter `jwt_expiry` for everyone; neither taken here.

## Hand-offs

- **PO-ACTIONS 03-E3** (orchestrator to add): "Auth Hooks: enable **Customize Access Token (JWT) Claims** hook, type
  **Postgres**, schema `private`, function `session_age_token_hook` (`pg-functions://postgres/private/session_age_token_hook`;
  03-13e, H-AUTH). Only after migration 000030 is applied to that database. Verify: `node scripts/ci/check-auth-config.mjs
  --print staging` rows match; drift workflow green; AUTH-00 kit item 10 with `--stale-wait-seconds` shows
  `stale_recovery_session_refresh` 403."
- Close: add `tests/auth/session-age-token-hook-db.spec.ts` and `tests/integration/auth/session-age-token-hook.spec.ts`
  to `REQUIRED_FILES`.
