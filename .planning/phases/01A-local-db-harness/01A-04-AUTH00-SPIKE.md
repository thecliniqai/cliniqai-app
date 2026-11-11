# 01A-04 — AUTH-00 Supabase Auth spike (local)

| | |
|---|---|
| Date | 2026-11-11 |
| Supabase CLI | 2.120.0 (`npx supabase --version`, repo-local `@supabase/cli-darwin-arm64`) |
| Auth container | `public.ecr.aws/supabase/gotrue:v2.197.0` (`/auth/v1/health` → `v2.197.0`) |
| Other images | postgres `17.11.0.004`, postgrest `v16.4`, mailpit `v1.31.3`, kong `2.8.1`, storage-api `v1.79.36` |
| Client libs | `@supabase/supabase-js` 2.117.2, `@supabase/auth-js` 2.117.2, `@supabase/ssr` 0.5.2 (from repo `node_modules`) |
| Scope | Pins the Supabase Auth behaviours that AUTH_REDESIGN §9 step 1 needs, measured on an isolated local stack only. Hosted-only items are listed for the V2-03 staging re-check. |

**Isolation.** All runs used a separate stack (`project_id = "clinicos-auth-spike"`, API 54421, DB 54422, Mailpit 54424, shadow 54420, pooler/studio/analytics/edge off) started from a scratch copy of `supabase/` with `--workdir`. The main `clinicos` stack on 54321–54324 was not stopped, restarted or reset; its 8 containers were still running at the end. Spike scripts lived in the session scratchpad. They built clients with an explicit `http://127.0.0.1:54421` and keys from `supabase status -o env --workdir …`, and every script aborted (exit 99, verified) on a non-127.0.0.1 host. No `--env-file`, no `vitest.config.ts`, and no `.env*` file was read. Spike SQL went in by `psql` against 127.0.0.1:54422 only. Only synthetic `spike-<run>-<n>@example.test` addresses were used. No tokens, passwords or hashes were printed; password changes were compared by md5-of-hash equality inside SQL. The stack was stopped with `--no-backup` (0 spike containers and 0 spike volumes left). The repo is unchanged apart from this file.

**Two supplementary side runs.** Two settings cannot be set through CLI 2.120.0 `config.toml`: require-current-password and the rate-limit header. For those, a second container of the **same GoTrue image** was run on the spike Docker network against the spike DB. It got a copy of the CLI container's env plus one extra variable and was published on 127.0.0.1:54431 only. These results are labelled **[side]**. They are local measurements of the same Auth build, but the CLI does not produce that configuration, so the hosted behaviour still needs the V2-03 re-check.

**Spike config** (scratch copy only): `enable_confirmations = true`, `otp_length = 6`, `otp_expiry = 600`, `max_frequency = "1s"`, `jwt_expiry = 900`, `minimum_password_length = 10`, `secure_password_change = false`, refresh rotation on with a 10 s reuse interval, `{{ .Token }}` templates for confirmation, recovery, magic_link, invite and email_change, and rate limits raised to 1000 except in E9. The GoTrue env was checked with `docker inspect` for each config.

---

## Summary

| # | Finding (AUTH_REDESIGN §9 step 1) | Result (measured) | Evidence | Status |
|---|---|---|---|---|
| 1a | `verifyOtp` type for a **signup** code | `type:'email'` works: it returns a session and sets `email_confirmed_at`. `'signup'` and `'invite'` also work. `'magiclink'` and `'recovery'` fail with 403 `otp_expired`, and the code stays usable afterwards. Codes are 6 digits and single-use (second use → 403 `otp_expired`). After `resend({type:'signup'})` a new code is issued and the first one is invalidated. | E1 | Confirmed locally (re-check V2-03) |
| 1b | `verifyOtp` type for a **recovery** code | `type:'recovery'` returns a session. **`'email'` and `'magiclink'` also accept a recovery code**; `'signup'`, `'invite'` and `'email_change'` do not. Single-use. The recovery session's `amr` is `otp`, not `recovery`. | E1, E5 | Confirmed; **doc gap**: a recovery session cannot be told apart from an OTP-login session by `amr` |
| 2 | Endpoints that need a CAPTCHA token | Missing token → 400 `captcha_failed` on `/signup`, `/token` password grant, `/otp`, `/magiclink`, `/recover` and `/resend`. Not enforced on the refresh grant, `/verify`, the PKCE grant or admin API calls. **Calls whose `apikey`/Bearer is the service-role key skip CAPTCHA on `/signup` and on the `/token` password grant.** Positive path and Turnstile single-use were not run (they need Cloudflare siteverify). `/sso` and passkey were not tested. | E10 | Confirmed (C43 list matches); token-accepted and single-use: **Deferred to V2-03** (external network) |
| 3 | `/otp` creates users? How does its email reach the Send Email hook? | Yes. The default (`shouldCreateUser` / wire `create_user` omitted) **creates an unconfirmed user**. `create_user:false` → 422 `otp_disabled`. With `enable_signup=false`, `/otp` for a new address → 422 `signup_disabled`. The created user **has a non-empty `encrypted_password`** (Auth sets one) and the same `app_metadata`, `user_metadata` keys and identities as a `/signup` user. A new-address `/otp` email arrives as **`email_action_type: "signup"`** (confirmation template). For an existing confirmed user it arrives as **`magiclink`**, and that code gives a full session (password bypass by mailbox). The hook payload has **no field** that tells `/otp`-signup apart from `/signup`. | E2, E3 | **Contradicts doc**: "tell it apart by whether the user has a password" does not work (no password field in the hook payload, and the DB row has a password either way). The wire default `create_user=true` is confirmed |
| 4 | Can Before User Created identify the originating endpoint? | **No.** The payload is `{metadata:{name,time,uuid,ip_address}, user:{…}}`. User values were byte-identical for `/signup`, `/otp`, `inviteUserByEmail` and `generateLink(signup)`. **`admin.createUser` did not invoke the hook at all.** | E3 | Confirmed: **No** (the mitigation 2 premise fails) |
| 5 | Pre-account hijack + post-verify fix | Native behaviour: **the attacker's password A is kept**. The victim's `signUp(B)` returns the same user id, does not change the hash, and sends a new code. The victim's verify confirms the account; then A → OK and B → `invalid_credentials`. Same for an `/otp`-created attacker account: B is never set. **Fix works:** `updateUser({password:B})` in the fresh OTP session succeeded, then `signOut({scope:'others'})`, then A → `invalid_credentials`, B → OK, and an attacker session opened between verify and fix → refresh `refresh_token_not_found`. | E4 | Confirmed (hijack is real; the fix is required and works) |
| 6 | "Require current password" in fresh-OTP and recovery sessions | **No CLI 2.120.0 `config.toml` key** (the local default is off). **[side]** With `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD=true`: `updateUser({password})` with no `current_password` **succeeds in OTP and recovery sessions** (tested at 0, 150, 330 and 772 s old and after a refresh). In a password session it fails with 400 `current_password_required`, or 400 `current_password_invalid` for a wrong one. With the setting off, a wrong `current_password` is silently ignored. | E4, E5 | Confirmed [side]; hosted: **Deferred to V2-03** (no local config key). **Doc gap**: the exemption is not time-bounded |
| 7 | `postgres`-owned SECURITY DEFINER may delete `auth.sessions`; this revokes refresh | Yes locally. `postgres` has `rolsuper=false` and `rolbypassrls=true`, and has DELETE on `auth.sessions` (owner `supabase_auth_admin`, RLS enabled). The function deleted 2 of 2 sessions. `refresh_tokens` and `mfa_amr_claims` cascade (`ON DELETE CASCADE`). Both refreshes → 400 `refresh_token_not_found`. `/user` with the unexpired access token → 403 `session_not_found`. PostgREST still accepts the JWT until `exp`. `anon` and `authenticated` → 42501. | E6 | Confirmed locally; hosted privileges: re-check V2-03 |
| 8 | `amr` timestamps | `amr = [{method, timestamp}]`; the timestamp equals the sign-in `iat`. It **survives refresh unchanged**. Re-entering the password via `signInWithPassword` gives a **newer timestamp in a new `session_id`**; the old session row remains. Methods seen: `password`, `otp` (signup verify, recovery verify, `/otp` login, `token_hash` magiclink). | E7 | Confirmed (§3.5 works without the `reauth_at` fallback; re-check hosted V2-03) |
| 9 | Identical signup response for an existing email | **Not identical.** With CLI defaults (`[auth.sms] enable_confirmations=false` → `GOTRUE_SMS_AUTOCONFIRM=true`) a confirmed address returns **422 `user_already_exists`**. With SMS confirmations on, it returns 200 with a fake user, but that user is distinguishable: **`identities: []`, `role: ""`, `user_metadata: {}`** (a new address gives `identities` length 1, role `authenticated` and 4 metadata keys), and no email is sent. An existing **unconfirmed** address gets the same shape as a new one (its real id, resends 1 email). `/recover` is identical: 200 `{}` for both, 1 email vs 0. | E8 | **Contradicts doc assumption** |
| 10 | `[auth.rate_limit]` key for password sign-in | **`token_refresh`** (`GOTRUE_RATE_LIMIT_TOKEN_REFRESH`) governs the `/token` password grant. **`sign_in_sign_ups`** (the CLI maps it to `GOTRUE_RATE_LIMIT_OTP`) governs `/signup`, `/recover` and `/otp`. **[side]** **The CLI-run local stack enforces no per-IP limits at all**: 40 paced grants at `token_refresh=3` all → 200. GoTrue only limits when `GOTRUE_RATE_LIMIT_HEADER` is set and present, and CLI 2.120.0 has no key for it. When enabled, the burst is ~30 whatever the configured value; the value sets only the refill rate per 5 min. 429 code: `over_request_rate_limit`. The per-user `max_frequency` gives 429 `over_email_send_rate_limit`. | E9 | **Contradicts doc** (§7 rate-limit test is not runnable on the CLI stack as designed; "(limit+1)th attempt → 429" is wrong) |
| 11 | What Auth logs record failed sign-ins | `auth.audit_log_entries` records **only the successful** `login`, nothing for failed password grants (known or unknown user). The GoTrue container log records each failure (`path:/token`, `grant_type:password`, `status:400`, `error_code:invalid_credentials`, `remote_addr`, `request_id`) **with no user identifier**. | E11 | Confirmed locally; hosted retention and log access: **Deferred to V2-03**. FT-07 app audit stays required |
| 12 | `@supabase/ssr` upgrade path | The repo already uses the non-deprecated `getAll`/`setAll` cookie API in all three call sites. `package.json` `^0.5.2` cannot reach 0.6+ (caret on 0.x), so the range must change. Target version: **to verify at implementation time** (no registry lookup). | E12 | Deferred (version lookup) to implementation time |
| + | Email delivery decision input (Send Email hook) | The hook works locally over HTTP with standard-webhooks headers (`webhook-id`, `webhook-timestamp`, `webhook-signature`), and the signature verified with the configured `v1,whsec_…` secret. When enabled, Mailpit receives **0** messages, so the hook replaces SMTP entirely. Action types seen: `signup`, `recovery`, `magiclink`, `invite`. Admin `generateLink` and `createUser` send nothing. | E3 | Characterised; SES and hook-vs-SMTP final call: AUTH-03 / V2-03 |

### Where AUTH_REDESIGN assumptions turned out wrong or incomplete

1. **§4.1 Risk mitigation 1 caveat:** "tell `/otp`-signup apart from `/signup` by whether the user has a password". The Send Email hook `user` object has no password field, and `/otp`-created users have a non-empty `encrypted_password` in `auth.users`. No distinguishing field was found (E2, E3).
2. **§4.1 Risk mitigation 2 (Before User Created):** the payload cannot identify the originating endpoint. Also, `admin.createUser` does not trigger the hook, so "reject users not created via `/signup` or the admin API" cannot be built from this payload (E3).
3. **§4.4 Enumeration:** "Signup with confirmations ON returns the same response for existing addresses". It does not: either 422 `user_already_exists` (CLI default, caused by SMS autoconfirm) or a 200 that differs in `identities`, `role` and `user_metadata` (E8). The §7 integration test "a second signup with the same email produces the identical response" would fail as written.
4. **§7 rate-limit test:** lowering `[auth.rate_limit]` in `config.toml` produces no 429 on the CLI stack. When limits are active, the burst is ~30 and does not equal the configured value. The password grant is under `token_refresh`, not `sign_in_sign_ups` (E9).
5. **§3.1 / §3.4 / §4.1 "Require current password":** there is no local config key. On the same build **[side]**, every OTP-type session is exempt (`/otp` login, signup verify, recovery), with no time window. So the admin fallback described in §3.1 is not needed, but the setting gives no protection against someone who controls the mailbox (E5).
6. **§3.5 / §3.1 admin fallback "JWT shows an OTP sign-in less than 5 minutes old":** recovery sessions also carry `amr: otp`, so the check cannot tell recovery from OTP login (E1, E5). This only matters if the fallback is ever built.
7. **§3.4:** a recovery code also verifies with `type:'email'`. Code that must accept only recovery codes cannot rely on the server rejecting other types; it must pass `type:'recovery'` and treat the result as a full session (E1).
8. **C43 detail:** the service-role key bypasses CAPTCHA on public `/signup` and `/token` too, not only on admin endpoints (E10). This is consistent with "admin-credential calls skip it" but wider than the endpoint list implies.

---

## E0 — Harness

**Procedure.** `npx supabase init` in a scratch dir gave the v2.120.0 template key names (`[local_smtp]` replaces `[inbucket]`; `[db] shadow_port`, `[db.pooler] port`, `[studio] port`, `[analytics] port`, `[edge_runtime] inspector_port`). The scratch `config.toml` was written with all ports moved to 544xx. The first start failed: migration 000008 needs `storage.buckets`, so storage cannot be disabled. With storage enabled, all 17 migrations applied. Started with `-x studio,edge-runtime,logflare,vector,imgproxy,supavisor`.

**Observations.** `supabase status -o env` key names: `ANON_KEY, API_URL, DB_URL, GRAPHQL_URL, INBUCKET_URL, JWT_SECRET, MAILPIT_URL, PUBLISHABLE_KEY, REST_URL, S3_PROTOCOL_*, SECRET_KEY, SERVICE_ROLE_KEY, STORAGE_S3_URL`. `API_URL=http://127.0.0.1:54421`. Guard test: the lib copy pointed at `https://abc.supabase.co` printed `ABORT: non-local host` and exited 99 before any call. GoTrue env checked per config (`GOTRUE_JWT_EXP=900`, `GOTRUE_MAILER_OTP_EXP=600`, `GOTRUE_MAILER_OTP_LENGTH=6`, `GOTRUE_PASSWORD_MIN_LENGTH=10`, `GOTRUE_MAILER_AUTOCONFIRM=false`, `GOTRUE_SMTP_MAX_FREQUENCY=1s`, `GOTRUE_SMS_AUTOCONFIRM=true` by default).

**CLI key gaps (facts from the CLI binary and the container env):**
- No `config.toml` key and no `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD` in the env the CLI generates. `security_update_password_require_current_password` exists in the CLI only as a Management API (hosted) field.
- No `GOTRUE_RATE_LIMIT_HEADER` in the env the CLI generates.
- `sign_in_sign_ups` → `GOTRUE_RATE_LIMIT_OTP`; `token_refresh` → `GOTRUE_RATE_LIMIT_TOKEN_REFRESH`; `token_verifications` → `GOTRUE_RATE_LIMIT_VERIFY`. `email_sent` is applied only when SMTP is configured; otherwise it is `360000`.

**Conclusion.** The isolated stack works. A V2-01a harness that needs a second stack must keep storage enabled.

## E1 — `verifyOtp` types

**Procedure.** One fresh user and one code per cell. Codes came from Mailpit via the `{{ .Token }}` templates.
- **Signup:** `signUp` → code → `verifyOtp({email, token, type:T})`.
- **Recovery:** `admin.createUser(email_confirm)` → `resetPasswordForEmail` → code → `verifyOtp` with each T.
- **Other checks:** `resend({type:'signup'})`, second use of a code, wrong code, 8-digit code, and `token_hash` from `admin.generateLink({type:'magiclink'})`.

**Observations.**

| Code from | T | Result | Session | `email_confirmed_at` set |
|---|---|---|---|---|
| signup | `email` | OK | yes | yes |
| signup | `signup` | OK | yes | yes |
| signup | `invite` | OK | yes | yes |
| signup | `magiclink` | 403 `otp_expired` (code still valid: a later `email` verify → OK) | no | no |
| signup | `recovery` | 403 `otp_expired` (code still valid afterwards) | no | no |
| recovery | `recovery` | OK | yes | — |
| recovery | `email` | OK | yes | — |
| recovery | `magiclink` | OK | yes | — |
| recovery | `signup` / `invite` / `email_change` | 403 `otp_expired` | no | — |
| magiclink `token_hash` | `email` / `magiclink` | OK | yes | — |

- All codes were 6 digits. Second use → 403 `otp_expired`. Wrong code and 8-digit code → 403 `otp_expired` (same message, "Token has expired or is invalid").
- After `resend(signup)` (2 emails total) the first code → 403 `otp_expired` and the resent code → OK.
- `amr` after every successful verify: `[{method:"otp", timestamp}]`, including recovery.
- `admin.generateLink` (magiclink and signup) returns `properties` keys `action_link, email_otp, hashed_token, redirect_to, verification_type`; `email_otp` has 6 digits.

**Conclusion.** Pin `type:'email'` for signup codes and `type:'recovery'` for reset codes. Only the latest code is valid. A failed verify with the wrong type does not burn the code.

## E2 — `/otp` behaviour

**Procedure.** `signInWithOtp` and raw `POST /auth/v1/otp` against new, existing-confirmed and existing-unconfirmed addresses, run with `enable_signup=true` and again after a restart with `enable_signup=false`. `auth.users` was inspected via `psql`.

**Observations.**

| Case | signup ON | signup OFF |
|---|---|---|
| (a) `signInWithOtp({email:new})` default | 200. User created: unconfirmed, `encrypted_password` **non-empty**, `app_metadata {provider:email, providers:[email]}`, `user_metadata` keys `sub,email,email_verified,phone_verified`, 1 identity. Email = **confirmation** template. Its code with `type:'email'` → session, `amr otp`, user confirmed | 422 `signup_disabled`, no user, no email |
| (b) `shouldCreateUser:false`, new | 422 `otp_disabled` "Signups not allowed for otp", no user, 0 email | 422 `otp_disabled` |
| (b) raw `{email}` (no `create_user`) | 200, **user created**, 1 email (so the wire default is `create_user=true`) | 422 `signup_disabled` |
| (b) raw `{email, create_user:false}` | 422 `otp_disabled` | 422 `otp_disabled` |
| (d) existing confirmed password user | 200. Email = **magic_link** template. Code → session, `amr otp` | same (still works with signups off) |
| (d2) existing unconfirmed `/signup` user, `shouldCreateUser:false` | 200. Email = **confirmation** template | n/a |
| (c) `/signup` with signups off | — | 422 `signup_disabled` |
| (c) `admin.createUser` / `inviteUserByEmail` with signups off | — | OK / OK |

**Conclusion.** `/otp` cannot be switched off while email sign-in is enabled. With signups on it creates users, and for existing users it is a mailbox-based password bypass. `enable_signup=false` would block `/otp` user creation but also `/signup`, so it is not an option for owner self-signup. The only server-side controls left are CAPTCHA (E10) and the Send Email hook, and the hook cannot distinguish the two `signup` sends (E3).

## E3 — Send Email hook and Before User Created hook

**Procedure.**
- Config: `[auth.hook.send_email] enabled, uri="http://host.docker.internal:54999/hook", secrets="v1,whsec_<random>"` (spike-only, deleted afterwards), and `[auth.hook.before_user_created] uri="pg-functions://postgres/public/spike_before_user_created"`. Both keys exist in CLI 2.120.0 and map to `GOTRUE_HOOK_SEND_EMAIL_*` and `GOTRUE_HOOK_BEFORE_USER_CREATED_*`.
- The receiver was a Node HTTP server on the host (127.0.0.1:54999). It verified the standard-webhooks HMAC and logged only key names, the action type and token length.
- Before User Created: a scratch plpgsql SECURITY DEFINER function logged `event` into `public.spike_hook_log`, with execute granted to `supabase_auth_admin`.
- `[auth.sms] enable_confirmations=true` was also set in this run (for E8).

**Send Email hook observations.**
- Headers: `content-type, webhook-id, webhook-signature, webhook-timestamp`. **Signature valid on all 6 calls.**
- Body top keys: `metadata, user, email_data`.
- `email_data` keys: `token, token_hash, redirect_to, email_action_type, site_url, token_new, token_hash_new, old_email, old_phone, provider, factor_type`. The token has 6 digits.
- `user` keys: `app_metadata, aud, created_at, email, id, identities, is_anonymous, phone, role, updated_at, user_metadata`, plus `confirmation_sent_at`, `confirmed_at`, `email_confirmed_at` and `recovery_sent_at` when set. **No password-related key.**

| Trigger | `email_action_type` | Notes |
|---|---|---|
| `signUp` (new) | `signup` | `user_metadata` keys `email,email_verified,phone_verified,sub`; 1 identity; unconfirmed |
| `resend({type:'signup'})` | `signup` | same shape, plus `confirmation_sent_at` |
| `signInWithOtp` (new address) | **`signup`** | user object identical in keys and values to `/signup` (apart from id, email, timestamps) |
| `admin.createUser(email_confirm)` | — (no call) | |
| `resetPasswordForEmail` | `recovery` | |
| `signInWithOtp` (existing confirmed) | `magiclink` | |
| `admin.generateLink(magiclink)` | — (no call) | invalidated the previously emailed magiclink code (a later verify of the emailed code → 403 `otp_expired`) |
| `admin.inviteUserByEmail` | `invite` | `user_metadata` empty |
| `admin.generateLink(signup)` | — (no call) | |

- Codes taken from the hook payload verified with `type:'email'` for both the `/signup` and the `/otp`-created user.
- Mailpit received 0 messages while the hook was enabled.

**Before User Created observations.**
- 4 events: `/signup`, `/otp`, `inviteUserByEmail` and `generateLink(signup)`. **`admin.createUser` produced no event.**
- `event` keys: `user, metadata`. `metadata` keys: `name` (= `"before-user-created"`), `time, uuid, ip_address`.
- `user` keys: `app_metadata, aud, created_at, email, id, identities, is_anonymous, phone, role, updated_at, user_metadata`.
- Values across all 4 (excluding id, email, timestamps): `app_metadata {provider:email, providers:[email]}`, `aud authenticated`, `identities []`, `is_anonymous false`, `phone ""`, `role ""`, `user_metadata {}`. They are identical, and there is no password field.

**Conclusion.**
- The hook can drop `magiclink` sends, which covers `/otp` for existing users.
- It **cannot** tell a new-address `/otp` send from a real `/signup` send.
- Before User Created cannot identify the endpoint.
- Interpretation (not measured): any `/otp`-created account stays unconfirmed unless its `signup` email is delivered. If the hook delivers all `signup` sends, `/otp` user creation succeeds just as `/signup` does. Combined with E4, the post-verify `updateUser` fix is what makes this safe, and CAPTCHA plus the 7-day purge limit volume.

## E4 — Pre-account hijack

**Procedure.** Attacker client `signUp(V, A)` (code ignored), then victim client `signUp(V, B)`, then the newest code from Mailpit, then victim `verifyOtp(type:'email')`. Hash equality was compared in SQL. Variant 2: the attacker creates V via `/otp`. Fix run: after verify, the attacker signs in with A (race), the victim calls `updateUser({password:B})` and then `signOut({scope:'others'})`. Run on the CLI stack (require-current-password effectively off) and **[side]** with it on. Both gave identical results.

**Observations.**
- Attacker `signInWithPassword(A)` before confirmation → `email_not_confirmed`.
- Victim `signUp(B)`: no error, **same user id**, password hash **unchanged**, new code (2 emails total). The first (attacker-era) code → 403 `otp_expired`.
- Victim verify → session. Hash still equals the attacker's original.
- **No fix: `signIn(A)` → OK, `signIn(B)` → `invalid_credentials`.**
- Variant 2 (`/otp` attacker): victim `signUp(B)` does not change the hash, then verify OK, then `signIn(B)` → `invalid_credentials`.
- **With fix:** the attacker's `signIn(A)` after the victim's verify → OK (race window). `updateUser({password:B})` → no error. `signOut({scope:'others'})` → no error. Attacker refresh → `refresh_token_not_found`, victim refresh → OK, `signIn(A)` → `invalid_credentials`, `signIn(B)` → OK.

**Conclusion.** The hijack is real on this Auth build. The documented client-side fix closes it, and require-current-password does not block it **[side]**, so the `admin.updateUserById` fallback is unnecessary. Residual (inference): during the race window the attacker's access JWT stays valid until `exp` (≤ 900 s), although its refresh dies. The fix must run before any tenant data is created, which the §3.1 ordering already provides.

## E5 — Require current password

**Procedure.** User with P0. Recovery code → `verifyOtp(recovery)` → `updateUser({password})`. Then a password session: `updateUser` without, with a wrong, and with the correct `current_password`; a weak password; the same password. Run on the CLI stack (setting absent = off) and **[side]** (setting on). [side] age test: OTP-login and recovery sessions were created, then `updateUser({password})` with no `current_password` was called at 0, 150 and 330 s, at 330 s after a refresh, and at 772 s for recovery.

**Observations.**

| Case | Setting off (CLI) | Setting on [side] |
|---|---|---|
| Recovery session, no `current_password` | OK | **OK** |
| Fresh OTP session (signup verify / `/otp` login), no `current_password` | OK | **OK** at 0/150/330 s, after refresh, and recovery at 772 s |
| Password session, no `current_password` | OK | 400 `current_password_required` |
| Password session, wrong `current_password` | **OK (ignored)** | 400 `current_password_invalid` (message also "Current password required when setting new password.") |
| Password session, correct `current_password` | OK | OK |
| New password < 10 chars | 422 `weak_password` (`AuthWeakPasswordError`) | same |
| New password = current | 422 `same_password` | same |

**Conclusion.**
- `errors.ts` must map `current_password_required`, `current_password_invalid`, `weak_password` and `same_password`.
- Recovery and OTP sessions are exempt, apparently by `amr` method and not by age. This is an inference from 5 samples up to 772 s.
- Hosted: the setting must be confirmed through the Management API in V2-03, because the local stack cannot enable it.

## E6 — Session deletion

**Procedure.** `psql` catalogue checks. Scratch function `public.spike_revoke_user_sessions(uuid)`: `language sql security definer set search_path=''`, owner `postgres`, `revoke all … from public, anon, authenticated`, `grant execute … to service_role`. Two sessions were opened, then the function was called via the anon, authenticated and service clients. Afterwards: refresh, raw `GET /auth/v1/user`, and a PostgREST select with the old JWT. Separately, `signOut` scopes were compared.

**Observations.**
- `postgres`: `rolsuper=false`, `rolbypassrls=true`; `has_table_privilege('postgres','auth.sessions','DELETE')=true`.
- `auth.sessions` and `auth.refresh_tokens` are owned by `supabase_auth_admin`. RLS is enabled on `auth.sessions`, and `postgres` holds all table privileges.
- FKs: `auth.refresh_tokens.session_id` and `auth.mfa_amr_claims.session_id` → `auth.sessions(id)` `ON DELETE CASCADE`.
- **`auth.sessions` columns (FT-06):** `id uuid, user_id uuid, created_at timestamptz, updated_at timestamptz, factor_id uuid, aal (enum), not_after timestamptz, refreshed_at timestamp (no tz), user_agent text, ip inet, tag text, oauth_client_id uuid, refresh_token_hmac_key text, refresh_token_counter bigint, scopes text`.
- **Default privileges:** a new `public` function is executable by `anon` and `authenticated` even after `revoke … from public`. It needs an explicit `revoke … from anon, authenticated`.
- RPC as anon → `42501` "permission denied for function"; as authenticated → `42501`. Sessions unchanged (2).
- RPC as service_role → returned `2`. Sessions 2 → 0; refresh_tokens 2 → 0.
- Refresh with both old tokens → 400 `refresh_token_not_found`.
- `GET /auth/v1/user` with the still-unexpired access token: 200 before, **403 `session_not_found`** after. supabase-js `getUser(jwt)` surfaced this as `AuthSessionMissingError`.
- PostgREST select on `memberships` with the old JWT → still accepted (200, 0 rows for this user): **the JWT is not revoked until `exp`**.
- A SECURITY INVOKER function reading `auth.sessions` as `authenticated` → 403 `42501`. A SECURITY DEFINER `session_alive()` → `true` before and `false` after.
- `signOut` scopes (3 sessions): `local` → 2 left, other client refresh OK. `others` → 1 left, other client refresh `refresh_token_not_found`, caller OK. `global` → 0.

**Conclusion.** `revoke_user_sessions` works locally as designed. Refresh is revoked immediately; data cut-off still relies on RLS status (as §3.6 already says), because the access JWT stays valid for PostgREST. The §3.5 `session_id` check must be a SECURITY DEFINER RPC. Hosted privilege on `auth.sessions` needs re-checking in V2-03 (local `postgres` is not superuser, the same as hosted, but grants can differ).

## E7 — `amr`

**Procedure.** `signInWithPassword`, wait 70 s, `refreshSession`, `signInWithPassword` again on the same client, `/otp` login, and `reauthenticate()`. Only `amr`, `session_id`, `iat`, `exp` and `aal` were decoded.

**Observations.**
- Password sign-in: `amr [{method:"password", timestamp:T}]`, `T == iat`, `aal1`, `exp - iat = 900`.
- After refresh: same `session_id`, `iat` advanced, **`amr` timestamp unchanged**.
- Second `signInWithPassword`: **new `session_id`**, newer password timestamp. The old session row still exists (1).
- `auth.mfa_amr_claims` row for the first session: `password` with `created_at` equal to the amr timestamp.
- `/otp` login: `amr [{method:"otp", …}]`.
- `reauthenticate()`: no error (it sends a nonce email; template not customised).

**Conclusion.** `requireRecentAuth` can read `amr[].timestamp` for `method === 'password'`. A password re-entry yields a fresh timestamp but in a **new** session. The re-auth flow should replace the client session and either revoke the previous `session_id` or accept that it lingers until the time-box. A `reauth_at` record is not needed locally.

## E8 — Signup response for an existing email

**Procedure.** Raw `POST /auth/v1/signup` and `supabase-js signUp` for (a) new, (b) existing unconfirmed and (c) existing confirmed addresses, with volatile fields normalised. Run with CLI defaults (`GOTRUE_SMS_AUTOCONFIRM=true`) and again with `[auth.sms] enable_confirmations=true` (`GOTRUE_SMS_AUTOCONFIRM=false`, emails counted at the hook). The same check was run for `/recover`.

**Observations.**

| Case | SMS autoconfirm ON (CLI default) | SMS autoconfirm OFF |
|---|---|---|
| (a) new | 200, user with `identities[1]`, `role:"authenticated"`, 4 metadata keys; 1 email | same; 1 email |
| (b) existing unconfirmed | 200, same shape as (a), **real existing user id**; 1 email (audit `user_repeated_signup`) | same; 1 email |
| (c) existing confirmed (admin-created or self-verified) | **422 `user_already_exists`** "User already registered"; 0 email | 200 with a **fake id** but **`identities: []`, `role: ""`, `user_metadata: {}`**, extra `recovery_sent_at` when the user had one; 0 email |
| supabase-js `signUp` (c) | error `user_already_exists` | no error, `user.identities.length === 0`, no session |
| `/recover` existing vs missing | 200 `{}` both; 1 vs 0 emails | — |

**Conclusion.** Signup leaks existence in both configurations (status code, or `identities`/`role`/`user_metadata`). The UI can show the same "check your email" screen, but the API response is distinguishable to a direct caller. Options for the PO/AUTH owner, not decided here:
- accept and document it as a known residual (CAPTCHA plus rate limits bound it);
- or route signup through a server action that returns a uniform body.

`[auth.sms] enable_confirmations=true` (or the hosted equivalent) is needed at least to avoid the 422. Hosted behaviour: re-check in V2-03.

## E9 — Rate-limit keys

**Procedure.**
1. CLI stack with `sign_in_sign_ups=3, token_refresh=1000`, then `sign_in_sign_ups=1000, token_refresh=3`. Per-endpoint sequences, with the auth container restarted between sequences to reset in-memory buckets.
2. **[side]** the same two settings plus `GOTRUE_RATE_LIMIT_HEADER=X-Forwarded-For`, with a distinct TEST-NET-2 XFF per sequence. Unpaced bursts of 40, then 40 requests paced at 300 ms. Distinct users for `/recover` and `/otp` to avoid per-user `max_frequency`.

**Observations.**
- **CLI stack:** no 429 `over_request_rate_limit` for any endpoint under either setting (5 requests per endpoint at limit 3, and 40 paced password grants at `token_refresh=3`). Back-to-back `/recover` or `/otp` to the **same** address within 1 s → 429 `over_email_send_rate_limit` (per-user `max_frequency`).
- **[side], paced 300 ms, first 429 at request #:**

| Endpoint | `sign_in_sign_ups=3`, `token_refresh=1000` | `sign_in_sign_ups=1000`, `token_refresh=3` |
|---|---|---|
| `/token` password | none (40/40 OK) | **31** (30 OK, 10 × 429) |
| `/signup` | **31** | none |
| `/recover` | **31** | none |
| `/otp` | **31** | none |

- [side] unpaced bursts: same pattern (30 OK at limit 3; 31–38 OK at limit 1000 depending on request latency). Requests **without** the XFF header were never limited (40/40 OK).
- 429 body `error_code`: `over_request_rate_limit`.
- `/verify` with a bad code always → 403 `otp_expired` (not limit-tested).

**Conclusion.**
- The password grant is governed by **`token_refresh`**. `/signup`, `/recover` and `/otp` are governed by **`sign_in_sign_ups`**.
- Interpretation: the configured number is the refill rate per 5 min with a fixed burst of about 30. It is not "N then 429".
- The CLI stack cannot exercise per-IP limits at all.
- The §7 `rate-limit.spec.ts` needs a different design: a side GoTrue with the header (as here), a test on staging in V2-03, or unit-level coverage of the UI 429 mapping only. `/resend` was not separately attributed. The PO should decide which option to use.

## E10 — CAPTCHA (missing-token part)

**Procedure.** Before enabling CAPTCHA, a confirmed user, an unconfirmed user and a refresh token were prepared. Then restart with `[auth.captcha] enabled=true, provider="turnstile", secret=<Cloudflare always-pass test secret>`. Calls with no `captcha_token`.

**Observations.**

| Call | Result |
|---|---|
| `POST /signup` | 400 `captcha_failed` "captcha protection: request disallowed (no captcha_token found)" |
| `POST /token?grant_type=password` | 400 `captcha_failed` |
| `POST /token?grant_type=refresh_token` | 200 |
| `POST /otp` | 400 `captcha_failed` |
| `POST /magiclink` | 400 `captcha_failed` |
| `POST /recover` | 400 `captcha_failed` |
| `POST /resend` (signup) | 400 `captcha_failed` |
| `POST /verify` (bad code) | 403 `otp_expired` (not CAPTCHA-gated) |
| `POST /token?grant_type=pkce` (bogus) | 404 `flow_state_not_found` (not CAPTCHA-gated) |
| `admin.createUser`, `admin.generateLink` (service key) | OK |
| `POST /signup` with the service-role key as apikey/Bearer | **200** |
| `POST /token` password with the service-role key | **200** |

- No `siteverify`/`challenges.cloudflare` line appeared in the GoTrue log: the missing-token check rejects before any outbound call.
- supabase-js surfaces this as `AuthApiError` 400 `captcha_failed`.

**Conclusion.** This matches C43 for every endpoint tested. `/sso`, passkey and `id_token` were not exercised. The token-accepted path and Turnstile single-use are **deferred to the V2-03 staging re-check** (they need Cloudflare siteverify). New fact: a service-role-keyed client bypasses CAPTCHA on `/signup` and the password grant. Interpretation: a server action that calls `signInWithPassword` must use the anon or cookie client (already required by CLAUDE.md), otherwise CAPTCHA is silently skipped.

## E11 — Failed sign-in logging

**Procedure.** Two wrong-password grants for an existing synthetic user, one for a non-existent address, and one success. Then `auth.audit_log_entries` since the mark, and `docker logs` filtered to `/token`. Only field names were recorded.

**Observations.**
- All three failures → 400 `invalid_credentials`, the same for an unknown user.
- `auth.audit_log_entries` since the mark: **one row, `action=login`** (the success). Its payload keys are `action, actor_id, actor_username, actor_via_sso, log_type, traits`, and `ip_address` was empty.
- Table columns: `instance_id, id, payload, created_at, ip_address`. Distinct actions across the whole run: `login, logout, token_refreshed, token_revoked, user_confirmation_requested, user_modified, user_reauthenticate_requested, user_recovery_requested, user_repeated_signup, user_signedup, user_updated_password`. There is no failed-login action.
- GoTrue container log, failed grant: `component, duration, error, error_code=invalid_credentials, grant_type=password, level=warning, method, msg="request completed", path=/token, referer, remote_addr, request_id, status=400, time`. **There is no user or email field.** A success line has `auth_event`.

**Conclusion.** Failed password grants exist only in the Auth service log, attributable by IP and request id but not by account. FT-07 (app-side sign-in failure audit) stays required. Hosted log retention and log-drain availability: **Deferred to V2-03**.

## E12 — `@supabase/ssr` upgrade path (desk check)

**Observations.**
- `package.json`: `"@supabase/ssr": "^0.5.2"`, `"@supabase/supabase-js": "^2.49.1"`. Lockfile: ssr 0.5.2, supabase-js 2.117.2. ssr 0.5.2 peer: `@supabase/supabase-js ^2.43.4`; dependency `cookie ^0.7.0`.
- 0.5.2 types: `CookieMethodsServer {getAll; setAll?}` is current. `get/set/remove` (`CookieMethods*Deprecated`) are marked `@deprecated`.
- Call sites:
  - `lib/supabase/client.ts`: `createBrowserClient<Database>(url, anon)`, no cookie options.
  - `lib/supabase/server.ts`: `createServerClient` with `getAll`/`setAll` (try/catch for Server Components).
  - `middleware.ts`: `createServerClient` with `getAll`/`setAll`, then `supabase.auth.getUser()`. It reads `process.env.*!` directly rather than `lib/env`.
- No deprecated cookie API is in use.

**Conclusion.** The cookie-API migration is already done. The upgrade changes the `package.json` range (the caret on 0.x blocks 0.6+), the lockfile, and possibly the `setAll` signature in `lib/supabase/server.ts` and `middleware.ts` if newer releases add parameters (to verify against the release notes then). The target version is **not determined here** (no registry access); it is pinned at implementation time per AUTH §4.2.

---

## Deferred to V2-03 staging re-check (with reason)

1. Hosted `verifyOtp` type matrix (E1): confirms AR-1 on the hosted Auth version.
2. Turnstile token-accepted path and single-use (E10): needs Cloudflare siteverify (external network).
3. "Require current password" on hosted, including the OTP and recovery exemption (E4, E5): there is no CLI 2.120.0 key, so it was measured only [side].
4. `postgres` DELETE on `auth.sessions` on hosted (E6): hosted grants may differ.
5. Signup response for an existing email on hosted, including the phone-confirmation setting that drives the 422 vs fake-user branch (E8).
6. Per-IP rate limits on hosted: key mapping, burst size and the 429 code (E9). The CLI stack cannot test them.
7. Auth log retention and access for failed sign-ins on Free and Pro (E11).
8. `amr` shape on hosted (E7).
9. The `@supabase/ssr` target version, at implementation time (E12).

## Pinned tests to write later (not written here)

**Integration (local stack + Mailpit or the hook receiver), `tests/integration/auth/`:**
1. Signup sends exactly 1 email with a 6-digit code. `verifyOtp({type:'email'})` returns a session and sets `email_confirmed_at`. Reusing the code → 403 `otp_expired`. After `resend({type:'signup'})` the old code → `otp_expired` and the new code → OK.
2. A wrong-type verify (`magiclink`) of a signup code → `otp_expired` and does not consume the code.
3. Reset: `verifyOtp({type:'recovery'})` returns a session with `amr[0].method === 'otp'`. Then `updateUser({password})` with no `current_password` succeeds. Reusing the code → `otp_expired`.
4. Pre-account hijack: attacker `signUp(A)`, victim `signUp(B)` (same user id), victim verifies. Without the fix, `signIn(A)` = OK (characterisation, so a Supabase behaviour change is noticed). With the app's post-verify step (`updateUser({password:B})` + `signOut({scope:'others'})`), `signIn(A)` → `invalid_credentials`, `signIn(B)` → OK, and an attacker refresh token obtained between verify and fix → `refresh_token_not_found`.
5. The same for an `/otp`-created attacker account.
6. Change password in a password session: no `current_password` → `current_password_required`; a wrong one → `current_password_invalid`; correct → OK. This needs the setting on, so it runs only where the setting can be enabled (staging or side GoTrue).
7. `revoke_user_sessions(uid)` as service_role deletes all sessions. Each prior refresh → `refresh_token_not_found`. `GET /auth/v1/user` with the old access token → 403 `session_not_found`. The SECURITY DEFINER session-alive RPC returns false.
8. `requireRecentAuth`: a JWT whose `amr` password timestamp is older than 10 min is rejected. After `signInWithPassword` the new JWT has a newer timestamp and a different `session_id`.
9. Signup with an existing confirmed email: assert the **actual** pinned behaviour (`identities.length === 0` with SMS confirmations on, or 422 `user_already_exists`) and that 0 emails are sent. Replace the §7 "identical response" test, or add a server-action wrapper whose response is asserted to be byte-identical.
10. `/recover` for an existing vs a missing email: identical 200 `{}`; 1 vs 0 emails.
11. `/otp` with no CAPTCHA token → 400 `captcha_failed` once CAPTCHA is on. The same for `/signup`, password grant, `/magiclink`, `/recover` and `/resend`. Refresh grant and `/verify` are not gated.
12. `/otp` with `create_user:false` for an unknown email → 422 `otp_disabled`. The app never sends `create_user` true (pairs with the "no `shouldCreateUser`" grep).
13. Send Email hook route: rejects a bad `webhook-signature`; drops `magiclink`; passes `signup`, `recovery`, `invite` and `email_change`. A captured synthetic payload fixture uses the key lists from E3.
14. Rate limit: only where per-IP limiting is active (side GoTrue with `GOTRUE_RATE_LIMIT_HEADER` or staging). The password grant 429s under `token_refresh`; `/signup`, `/recover` and `/otp` under `sign_in_sign_ups`. Assert `over_request_rate_limit` after the burst, not at limit+1.

**pgTAP (`supabase/tests/auth_*.sql`):**
1. `has_function_privilege('anon'|'authenticated', 'public.revoke_user_sessions(uuid)', 'execute')` is false, and true for `service_role`. This guards the default-privilege trap found in E6.
2. `revoke_user_sessions` is `SECURITY DEFINER`, owned by `postgres`, with `search_path=''`.
3. A sessions RPC exposing `created_at`, `refreshed_at`, `not_after`, `aal` and `user_agent` for FT-06 exists, and is not executable by `anon`.

**Unit:**
1. `errors.ts` maps `otp_expired`, `email_not_confirmed`, `invalid_credentials`, `user_already_exists`, `otp_disabled`, `signup_disabled`, `captcha_failed`, `current_password_required`, `current_password_invalid`, `weak_password`, `same_password`, `over_request_rate_limit`, `over_email_send_rate_limit` and `session_not_found`.
2. A config-drift check that `config.toml` sets `[auth.sms] enable_confirmations = true` if the E8 decision depends on it.
