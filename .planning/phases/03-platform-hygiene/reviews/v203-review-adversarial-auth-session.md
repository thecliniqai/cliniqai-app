# V2-03 adversarial review: group D (auth, session, proxy, Send Email hook, Turnstile, leaked-password check)

- Diff: `origin/feature/v2..3f81bfb` (branch `v2/phase-03-platform-hygiene`)
- Reviewer: isolated adversarial reviewer (fresh context). Implementer records were read only after the findings below
  were written, to check for prior acknowledgement (noted per finding).
- Method: code read of every file in scope, plus local probes: `safeNextPath` fuzzing (22 payloads) and a
  `pageNeedsSession` re-implementation fuzz (15 traversal/encoding payloads), and one live probe against the local
  GoTrue (loopback only; synthetic `adv-probe-*@example.test` user created with the local secret key, deleted afterwards).
  No hosted service contacted, no `.env*` read, no code modified.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 2 |
| Low | 5 |
| Info | 5 |

Nothing allows a direct account takeover without a mailbox or a stolen session. The High finding is that the A00-5
10-minute bound, the mitigation that T-03-12 relies on, runs only in the app. A caller who holds a mailbox-established
session can skip it by calling GoTrue directly, and such sessions never age out.

What held up under attack (no finding):
- `safeNextPath` (`lib/auth/safe-next.ts`). All of these are refused: `//x`, `/\x`, `/%2F%2Fx`, `/%252F%252Fx`,
  `/..//x`, `/.//x`, `/%2e%2e//x`, `/x/../..//x`, `/;/../..//x`, `/%09/x`, `/%5c%5cx`, `/./%2F/x`. Unicode look-alikes
  such as `/∕x` come back percent-encoded and stay same-origin. The returned value is the URL-normalised path, so a
  dot-segment collapse cannot produce `//host`.
- `pageNeedsSession` (`lib/auth/public-paths.ts:48-55`). `/rx` is protected, and so are all of these:
  `/r/%2e%2e/patients`, `/r/..%2fpatients`, `/r/x%2F..%2F..%2Fpatients`, `/_next/%2e%2e/patients`,
  `/api%2f..%2fpatients`, `/api/%2e%2e/patients` and `/join/../staff`. The raw-AND-normalised rule, case-sensitive raw
  plus lower-cased normalised, fails closed. `/__nextjs*` comes out public, but `_`-prefixed app folders cannot be
  routed, so nothing is reachable through it.
- Sign-out CSRF (`lib/auth/same-origin.ts`, `app/auth/signout/route.ts`). POST only. A browser that labels the request
  anything other than `same-origin` is refused, and a request with no `Origin` and no `Sec-Fetch-Site` is refused.
- Hook signature (`app/api/auth/send-email/route.ts:106-121`). The route verifies before it parses, over the raw body.
  standardwebhooks compares in constant time, accepts several signatures and enforces a 5-minute tolerance. Header
  lookup goes through `Headers` and is case-insensitive. With no secret it answers 401 (fail closed). The secret format
  is validated at boot (`lib/env.ts:78, 397-402`), so `slice("v1,".length)` is safe.
- Templates (`lib/email/templates/auth.ts:109`). The code must match `^[0-9]{6,10}$` and the subjects are constants. No
  header or HTML injection is possible: recipients come from the signed payload and go to SES as structured
  `ToAddresses`.
- Pwned check (`lib/auth/pwned.ts`). Only the 5-hex prefix leaves the process, with `Add-Padding`. Nothing about the
  password, hash, prefix or suffix is logged. The base URL cannot be overridden in deployed tiers. The 1.5 s deadline
  holds even if the fetcher ignores the abort signal. Fail-open helps only the caller's own account.
- Sign-in and reset enumeration in the app layer (`features/auth/password-flows.ts:84-103, 165`).
  `email_not_confirmed` is mapped to `invalid_credentials`, and a per-address resend 429 is reported as success.

---

## High

### H-1. The A00-5 10-minute bound is app-only: a mailbox-established session can set a new password at any age through GoTrue directly (T-03-12 mitigation bypassable)

- Where: `features/auth/service.ts:183, 211` (the only place the bound exists); `supabase/auth-policy.json`
  (`secure_password_change = false`, and no session time-box or inactivity rows); plan ruling A00-5 and threat T-03-12.
- Facts:
  - Spike E5 [side]: with `security_update_password_require_current_password = true`, GoTrue still accepts
    `PUT /auth/v1/user {password}` with no `current_password` from OTP and recovery sessions, at any age (tested up to
    772 s and after a refresh).
  - Spike E7: the `amr` timestamp survives refresh, so a recovery, invite or signup session stays an `otp` session for
    its whole life. Nothing in this diff ends one: no time-box, and `setNewPassword` keeps the same session after it
    succeeds.
  - Local probe (this review, local GoTrue): `generate_link(recovery)` → `/verify type=recovery` gave
    `amr [{"method":"otp",...}]`. Then direct `PUT /auth/v1/user {"password":"password123"}` → **200**. After
    `refresh_token` → `PUT /user` → **200** again. The app action, the pwned check and the 10-minute bound were never
    involved. (Locally require-current is off, R-34; the hosted exemption is spike E5.)
  - The `@supabase/ssr` auth cookies are readable by JS (`lib/supabase/client.ts`, which uses the browser client by
    design), so anyone at the device can take the tokens.
- Exploit:
  1. A doctor resets their password through `/forgot-password` (or a staff member joins through an invite code). Their
     browser keeps the `otp`-amr session for weeks.
  2. On a shared clinic PC, or through any XSS, the attacker reads `sb-<ref>-auth-token` from devtools or
     `document.cookie`.
  3. `curl -X PUT $SUPABASE_URL/auth/v1/user -H "apikey: <publishable>" -H "Authorization: Bearer <access>" -d
     '{"password":"attacker-chosen-pw"}'` → 200. No current password, no 10-minute window, no FT-05.
  4. The attacker now owns a persistent password, and can also run `signOut(others)` to evict the victim. Hosted
     "require current password" does not help: the session is an `otp` session. The `password_changed` notice is the
     only signal the victim gets.
- Why High: T-03-12 is rated high, and its listed mitigation ("10-min `amr` bound … hosted require-current") does not
  hold against a direct caller. With a password session the same attack is blocked on hosted, so the bypass applies
  only to mailbox sessions, but every password reset creates one. T-03-21 accepts only the FT-05 bypass, not this one.
- Fix (any one closes it; the first is recommended):
  1. Bound the session itself, not only the action. In `proxy.ts` after `getClaims()`, classify with
     `sessionAuthFrom(claims.amr)`. If it is `mailbox` and `ageSeconds > 600`, call `supabase.auth.signOut({ scope:
     "local" })` (revokes that session at GoTrue) and treat the request as signed out. Recovery, invite and signup
     sessions then cannot outlive the window that A00-5 already defines.
  2. And/or after `setNewPassword` succeeds, end the recovery session (`signOut({ scope: "global" })` is already
     implied by `others` plus local) and have the browser sign in with the new password, so the long-lived session is
     a `password` session that hosted require-current protects. Do the same for the AUTH-06 invite set-password step.
  3. Record the residual risk explicitly in T-03-12 / A00-5 if the PO accepts it, and add an AUTH-00 re-check item
     (kit item 3 already measures the exemption; add "a stale otp session can `PUT /user`").

---

## Medium

### M-1. 6-digit recovery codes can be brute-forced with many IPs: `/verify` has no CAPTCHA, the limit is per IP, and there is no per-account attempt cap

- Where: `supabase/auth-policy.json` rows `otp_length = 6`, `otp_expiry = 600`, `rate_limit_token_verifications = 30`
  (per 5 min **per IP**); `features/auth/password-flows.ts:192` (`verifyOtp` runs in the browser, so the app sees no
  attempts). Spike E10 / AUTH §2 confirm that CAPTCHA is not enforced on `/verify`.
- Exploit: request a recovery code for a known doctor email. This needs one Turnstile solve, cheap through solver
  services. Then spread `/verify {type:"recovery", email, token}` guesses over N IPs: 60 guesses per IP per 10-minute
  code lifetime, so 1 - (1 - 60N/10^6). With N = 2,000 residential proxies that is about 12% per issued code. Repeat
  after `max_frequency` (60 s; a new code replaces the old one) and the attack succeeds within hours. The result is a
  recovery session, a full account takeover, plus H-1 persistence. AUTH §4.4 records the "distributed attacks are the
  residual" deviation for **passwords** (10+ chars plus a blocklist). It does not cover a 10^6 code space.
- Fix: route recovery verification through a server action that keeps a Postgres per-email counter (for example 5
  failed codes per issued code, then force a new code) and calls GoTrue `/verify` itself. This needs the
  `Sb-Forwarded-For` question settled, or accept the shared-egress bucket for `/verify` only. Or raise `otp_length` to 8
  (10^8 space) as a config-only mitigation. At minimum, record the risk next to the AUTH §4.4 deviation with the
  arithmetic.

### M-2. The project-wide `email_sent = 60/h` cap can be exhausted by one anonymous actor, silently blocking every clinic's resets and invites (verify whether it applies with the Send Email hook)

- Where: `supabase/auth-policy.json` `rate_limit_email_sent` = 60 (hosted label "per hour"; it is a project-wide
  bucket, not per address); `features/auth/password-flows.ts:165` reports `over_email_send_rate_limit` as **success**.
- Exploit: one attacker requests `/recover` for any existing address, for example a doctor's public email. They rotate
  across a handful of known addresses to beat `max_frequency = 60s`, and solve one Turnstile per request. At 60
  requests an hour the cap is gone. Every legitimate reset or invite in every tenant then gets 429
  `over_email_send_rate_limit`, which the UI shows as "If an account exists we've sent a code". Users wait for an email
  that never comes, and the outage is invisible.
- Caveat: the local comment (`supabase/config.toml` `[auth.rate_limit]`) says the CLI applies `email_sent` only with
  custom SMTP. Whether hosted applies it to hook sends is unconfirmed. Add it to the AUTH-00 re-check kit.
- Fix: raise the cap well above expected peak (the hook and SES carry the real cost limits). Make the UI distinguish
  per-address from global exhaustion if GoTrue's response allows it, or at least log a server-visible signal (the hook
  sees nothing when GoTrue refuses first). Alert on `over_email_send_rate_limit` volume.

---

## Low

### L-1. Stolen password session → unlimited online guessing of the current password through change-password

- Where: `features/auth/actions.ts:13-18` and `features/auth/service.ts:173-197`. There is no app attempt limit, and
  GoTrue `PUT /user` is not in any per-IP bucket the policy sets. Calls through the action leave from the Vercel egress
  IP in any case.
- Exploit: a holder of a hijacked password session loops `changePasswordAction({currentPassword: guess, newPassword})`,
  or `PUT /user` directly. `current_password_invalid` versus success is a perfect oracle. On a hit the password is
  changed and other sessions are signed out. The precondition (session theft) is significant, which is why this is Low.
- Fix: a Postgres per-user limiter on `changePasswordAction` (for example 5 per 15 minutes) that logs `auth.password.
  rejected` with `current_password_invalid` for alerting. Ask in the re-check kit whether hosted rate-limits `PUT /user`.

### L-2. `sessionAuthFrom` fails open for unknown `amr` methods

- Where: `features/auth/service.ts:53-54`. Any method not in `MAILBOX_METHODS` counts as `password`, which means no
  freshness bound and reliance on hosted require-current.
- Risk: if hosted GoTrue reports a mailbox-type factor under a name the app does not list (spike E1b already showed
  that recovery reports as `otp`, contrary to the docs), the A00-5 bound is silently skipped.
- Fix: allowlist the non-mailbox methods (`password`, `totp`, `mfa/*`). Treat anything else as `unknown`, which
  already maps to `reauth_required`. Have re-check kit item 8 assert the full method set.

### L-3. The hook can be used for account enumeration when it fails

- Where: `app/api/auth/send-email/route.ts:176-181` returns 500/503 to GoTrue. GoTrue then fails `/recover` **only for
  existing users**, while unknown addresses still get 200.
- Exploit: on staging with `EMAIL_PROVIDER=disabled`, or during SES sandbox, an outage or suppression (SES sandbox
  rejects unverified recipients), a direct `/recover` caller sees an error for registered addresses and 200 for the
  rest. The app maps the error to a generic failure message (`password-flows.ts:166`), and that differs from the
  success notice too. A timing difference from the SES round-trip exists in any case.
- Fix: accept and record the outage-only oracle, or return 200 from the hook for `recovery` when the provider fails
  (log `auth.email.failed` and alert). The user can resend after 60 s.

### L-4. OA-5 skipped for image-suffixed paths on dynamic routes (acknowledged residual)

- Where: `proxy.ts:117`, matcher `.*\.(?:svg|png|jpg|jpeg|gif|webp)$`.
- Effect: `GET /patients/abc.png` and `/consultation/x.svg` reach `app/(dashboard)/patients/[id]` without the proxy.
  There is no default-deny redirect and no session refresh, and only the layout's `getUser()` stands in the way. Any
  future page with a dynamic segment that misses the layout guard (for example a route group without the dashboard
  layout) is public through this suffix. Already listed as a residual in the 03-12b wave note.
- Fix: limit the extension exclusion to paths with no dynamic page beneath them, for example
  `/((?!_next/static|_next/image|favicon.ico|[^/]+\.(?:svg|png|…)$).*)` (top-level public files only). Or make
  `pageNeedsSession` apply in the dashboard layouts too.

### L-5. `next` may point at `/api/**` GET endpoints

- Where: `lib/auth/safe-next.ts:64-85` (any same-origin path).
- Effect: `/login?next=/api/patients/<id>/export` makes a freshly signed-in user's browser download an export, or hit
  any GET handler, immediately after sign-in. It stays same-origin and acts on the user's own data, so this is a nuisance
  and a social-engineering aid (the "your data was exported" pretext) rather than a leak.
- Fix: refuse `next` values whose normalised path is under `/api` or `/auth`. The proxy never sets them for those,
  because it does not redirect `/api`.

---

## Info

- I-1. `app/api/auth/send-email/route.ts:98-104`: when there is no `content-length` (chunked), the whole body is buffered
  before the 64 KiB check. The route is unauthenticated until the signature is checked. The platform body cap bounds
  this. Consider streaming with a running byte count.
- I-2. Hook replay: within the 5-minute tolerance a captured signed request can be replayed, which re-sends the same
  code to the same address. Nothing is gained because the payload already holds the code. `webhook-id` dedupe is
  optional.
- I-3. `email_change` token→address mapping (`route.ts:86-90`). The implementer verified it with a scratch `verifyOtp`
  (03-11b record), but no committed integration test pins it. GoTrue's field naming here is notoriously inverted
  (`token_hash_new` ↔ current address in the upstream docs). Add a DB-lane test: request an email change, then verify
  each delivered code against the address it was sent to.
- I-4. The proxy uses `getClaims()`. With asymmetric signing keys, a revoked session's JWT keeps passing the OA-5 gate
  for up to `jwt_expiry` (900 s). The layout uses `getUser()`, and GoTrue rejects revoked sessions on `PUT /user`
  (`session_not_found`). Acceptable, but say so in R-28.
- I-5. The hosted drift check (`scripts/drift/auth-config-hosted.mjs:29-35`) wires **staging only**. Production CAPTCHA,
  require-current-password, the hook URI and signup-off have no automated drift guard yet, and Turnstile is enforced
  only by GoTrue's config. Wire `production` before launch (the policy column already exists).

## Files reviewed

`proxy.ts`, `lib/auth/{public-paths,safe-next,same-origin,pwned,context,tenant}.ts`, `lib/api/enabled.ts`
(normalisation), `features/auth/{service,password-flows,actions,schemas,errors}.ts`, `app/auth/signout/route.ts`,
`app/api/auth/send-email/route.ts`, `lib/email/{ses,templates/auth}.ts`, `app/(auth)/login/page.tsx`,
`app/(auth)/forgot-password/page.tsx`, `components/auth/turnstile-field.tsx`, `lib/env.ts` (auth and email rules),
`supabase/config.toml`, `supabase/auth-policy.json`, `scripts/drift/auth-config-hosted.mjs`,
`scripts/staging/auth00-recheck{,-lib}.ts` (guards and cleanup), `app/(dashboard)/layout.tsx`.
