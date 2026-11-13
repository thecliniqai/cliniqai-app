# V2-03 High findings: fresh adversarial re-verification

- Commit `14e0811` (branch `v2/phase-03-platform-hygiene`). Local stack only: migrations to `000030`, GoTrue with
  `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true`, `GOTRUE_JWT_EXP=900`, OTP length 8.
- Method: I re-ran each original exploit and then tried bypass variants. Each probe runs from a scratch script against
  the live local GoTrue, PostgREST or Next server, using synthetic users, tenants and markers only. I read the fixers'
  records (`03-13a…e`) only after reaching my verdicts.
- I changed no repo code. H-LOG was probed on a `git archive HEAD` copy in the scratchpad with extra probe routes
  added, built with the e2e environment (`buildAppServerEnv`) and served on 127.0.0.1:3100. The copy has been deleted.
- Cleanup: 0 `reverify-*` users, 0 `Reverify*` tenants and 0 MFA factors remain on the local stack. The regression
  tests' own teardown reported none remaining.

| ID | Verdict | New findings |
|---|---|---|
| H-AUTH | **CLOSED** in code and on the local stack. On hosted it depends on PO action 03-E3: the hook is off on staging and production until the PO enables it. | none |
| H-PAY | **CLOSED** (actor and command forgery) | none; the accepted V2-07 residual is confirmed |
| H-ENV | **CLOSED** in staging and production | Info only |
| H-LOG | **CLOSED** for every channel Next.js and React use | Low: `console.dir` and direct `process.stdout/stderr.write` are not scrubbed |

Regression tests run at `14e0811`, 298/298 passed:
- `tests/billing/payment-actor-guards.spec.ts`
- `tests/integration/auth/session-age-token-hook.spec.ts`
- `tests/auth/session-age-token-hook-db.spec.ts`
- `tests/auth/session-age.spec.ts`
- `tests/config/env-schema.spec.ts`
- `tests/config/env-boot.spec.ts`
- `tests/observability/console-scrub.spec.ts`

I read each of these tests. Their assertions are the exploit outcomes (forced `recorded_by`, `COMMAND_ID_RPC_ONLY`,
refresh 403 after 600 s, schema refusal naming the key, captured stderr free of the synthetic values), so each would
fail without its fix. I did not revert the fixes to prove this.

---

## H-AUTH: an emailed-code session can change the password straight through GoTrue

**Verdict: CLOSED (local, code).** Three layers now apply:
1. **Token hook (000030).** `private.session_age_token_hook` refuses to mint any access token for an emailed-code
   session more than 600 s after its newest emailed-code factor.
2. **Proxy.** `proxy.ts` revokes such a session and continues the request signed out.
3. **Reset ends signed out (R-35).** `features/auth/service.ts` `endRecoverySession` calls `signOut({scope:"global"})`
   after the reset.

The hosted half depends on PO action 03-E3 (enable the hook in the dashboard). Until then, a stolen refresh token from
an emailed-code session can still be refreshed directly at hosted GoTrue. The proxy and R-35 cover only paths that go
through the app. The hosted drift check (`auth-policy.json` row `hook_custom_access_token_enabled`) flags the gap.

Probe: `auth-probe.mjs`, raw HTTP to local GoTrue, user created through the admin API, recovery code from
`generate_link`, sessions aged by moving `auth.mfa_amr_claims.updated_at` back by 700 s.

| # | Attempt | Result |
|---|---|---|
| A | Original exploit. Recovery session (`amr` = `otp`) aged 700 s, then `POST /token?grant_type=refresh_token` directly at GoTrue | **403**, no token minted |
| A3 | Repeat the refresh with the same refresh token (reuse interval) | **403** |
| A2 | `PUT /auth/v1/user {password}` with the access token minted before aging | **200**. This is the accepted residual (an access token minted at ≤600 s lives until its `exp`, ≤ ~1,500 s after the code; triage row "H-AUTH residual", owner V2-13b). Reproduced, and within the stated bound. |
| B | After reset: `PUT /user` on the recovery session, then `POST /logout?scope=global` (what `endRecoverySession` does), then reuse that session | `PUT /user` **403 `session_not_found`**; refresh **400 `refresh_token_not_found`**; `GET /user` **403**. A recovery session cannot be kept after the reset. |
| C1 | Bypass: MFA step-up. Enrol and verify TOTP on a fresh recovery session (`amr` = `otp`,`totp`), age only the `otp` claim, refresh | **403**. A fresh `totp` factor does not reset the mailbox clock. |
| C2 | Bypass: a new TOTP challenge and verify on the aged session (`/factors/{id}/verify` also mints a token) | challenge **200**, verify **403**. The hook also gates the MFA mint path. |
| — | Code review of the classification | Unknown or new `amr` methods count as emailed codes in both the hook and `lib/auth/session-age.ts`. A missing, empty or malformed `amr` is refused. Only a `password` factor *later* than the newest emailed code makes it a password session, and an attacker holding only a mailbox session cannot obtain one without the password. |

Notes, not findings:
- `oauth`, `sso/saml` and `anonymous` sessions would also be ended at 600 s (fail closed). No such providers are
  enabled (`enable_anonymous_sign_ins=false`, no external providers), but social sign-in would need these methods
  added deliberately.
- `/api/v1/**`, `/api/health` and `/api/ready` return before the proxy's session-age check. None of them can change a
  password, and the token hook still bounds any token.

## H-PAY: forged `recorded_by` and command replay through direct `payments` inserts

**Verdict: CLOSED** for actor forgery, system-actor forgery and command-id replay.

Probe: `pay-probe.mjs`, PostgREST with each user's own JWT. Tenant A has an owner, a nurse and a receptionist; u2 is
owner of tenant C only. Each invoice has total 100.

| # | Attempt | Result |
|---|---|---|
| V1 | Original exploit: nurse `POST /rest/v1/payments` with `recorded_by = u2` | 201, row stored with `recorded_by = nurse` (forced) |
| V1b | Receptionist, `recorded_by = owner` | stored as receptionist |
| V2 | Nurse sets `recorded_by_system = 'system:payment_webhook'` (also with `Prefer: missing=default`) | **403 42501**, no column privilege |
| V3 | Nurse direct insert with a chosen `id` and `command_id` (the reviewer's replay plant) | **403 `COMMAND_ID_RPC_ONLY`** |
| V3b | Set the guard's marker GUC through `/rpc/set_config` | **404 PGRST202** (not exposed) |
| V4a | Nurse `PATCH` on the owner's RPC-recorded row (`recorded_by`, `amount`, `command_id`) | 200 with 0 rows: there is no UPDATE policy, so the row is unchanged |
| V4b | Upsert (`resolution=merge-duplicates`) onto the owner's payment id with `recorded_by = u2` | **403** RLS (no UPDATE path) |
| V4c | Upsert-ignore that carries the owner's command id | **403 `COMMAND_ID_RPC_ONLY`** (the BEFORE INSERT trigger fires before conflict handling) |
| V4d | Nurse `DELETE` | 0 rows (no policy) |
| V5 | Nurse calls `record_payment` with the owner's command id | **`IDEMPOTENCY_MISMATCH`**; the owner's own replay still returns `replayed: true` |
| V6 | Receptionist calls `record_payment` with `p_system_actor='system:payment_webhook'` | **`ACTOR_INVALID`** |
| V7 | u2 (other tenant) replays tenant A's command | `INVOICE_NOT_FOUND` |
| V8 | Anon insert | 401 |
| V9 | Bulk array insert, each element forging a different `recorded_by` | every row stored as the nurse |
| V10 | Forged `audit_logs` row (`actor_type='system'`, `actor_id = owner`) | 403 RLS |

**Accepted residual, confirmed.** V1 stored a 99,999 payment on a 100 invoice through a direct insert, with no status
change, audit row or outbox row. This is the overpayment and status residual the triage hands to V2-07 (contract
step); the actor on the row is now correct. Info: `IDEMPOTENCY_MISMATCH` against `OVERPAYMENT` tells a same-tenant
member whether a given command UUID exists. These are random UUIDs, so the risk is negligible.

Grants observed: `authenticated` and `anon` keep table UPDATE, DELETE, TRUNCATE and TRIGGER grants (Supabase
defaults). RLS has no UPDATE or DELETE policy on `payments`, which makes these inert. They are worth revoking in V2-07's
contract step.

## H-ENV: the secret key is accepted in the browser-inlined publishable-key variable

**Verdict: CLOSED in staging and production.** Both tiers now accept only `sb_publishable_` and `sb_secret_` keys. A
key in the wrong variable is refused by prefix (case-insensitive and trimmed) and by decoded JWT `role`. `next.config.ts`
runs `assertDeployEnv(process.env)`, so the build itself fails. No code outside `lib/env.ts` reads a `NEXT_PUBLIC_*`
variable, so a retired name (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) is never inlined.

Probe: `env-probe.ts` calls `parseEnv` with the full synthetic profile of every tier (production, staging,
development, test, ci, e2e). It ran 21 publishable-slot variants and 8 secret-slot variants per tier, plus both keys
swapped and the retired names.

Refused in **every** tier:
- `sb_secret_…`, `SB_SECRET_…`, `Sb_Secret_…`
- leading or trailing space, tab or newline, BOM prefix
- legacy `service_role` JWT, alone, padded with spaces or prefixed `Bearer `
- JWTs with `role` set to `Service_Role`, `["service_role"]`, `supabase_admin` or missing
- standard-base64 payload
- in the secret slot: `sb_publishable_…`, an anon JWT or an `authenticated` JWT
- both keys swapped at once

Refused in staging and production: the retired names, and a legacy anon JWT or an unrecognised opaque key in either
slot.

Not refused (Info, no exploit):
- **Production and staging:** the value `sb_publishable_<x>sb_secret_<y>` (two keys concatenated into one field) passes,
  because the check is prefix-only. Supabase would reject this as an invalid key, so the app would fail visibly, but the
  build would inline the secret substring. Optional hardening: refuse `sb_secret_` anywhere in the publishable value.
- **development, test, ci and e2e only:** obfuscated shapes are treated as opaque and pass: a zero-width-space prefix,
  a JWT with `=` padding in its payload, a 4-part JWT. These tiers are loopback-only (the URL is checked), and Supabase
  would not accept those strings as keys. So "every tier" holds for every real key shape, not for every string.

## H-LOG: Next prints raw uncaught server errors to stderr, bypassing the scrubber

**Verdict: CLOSED** for every channel Next.js and React print through. `instrumentation.ts` `register()` installs
`lib/observability/console-scrub.ts` first, and it wraps `error`, `warn`, `log`, `info`, `debug` and `trace`.

Probe: production build of a scratch copy plus probe routes, served by `next start` with stdout and stderr captured to
files. Markers: `+919812345678`, `rv.marker@example.com`, a Postgres `Key (tenant_id, phone)=(…)` detail, Devanagari
digits, spaced, dashed and bracketed mobiles, a dashed Aadhaar, a Unicode email, an `@abdm` address, and a storage
path containing a patient name.

| Trigger | stdout/stderr content |
|---|---|
| Original exploit: `POST /api/diag/error` (CRON bearer) | `DiagnosticError [DIAG_SYNTHETIC]: … contact [EMAIL], mobile [PHONE REDACTED], link /r/[TOKEN]?[QUERY] … Key (phone)=([REDACTED])`; frames are `file:line` only |
| Route throws a PostgrestError-shaped `Error` with `details` and `hint` | `PostgrestError [23505]: … details: Key (tenant_id, phone)=([REDACTED]) \| hint: mail [EMAIL]` |
| Throws a plain object `{message, details, code, hint}` | `ErrorLike [23505]: failed for [PHONE REDACTED] …` |
| Throws a string | `Key (tenant_id, phone)=([REDACTED])` |
| `cause` chain (Error → Error → plain object) | inner message scrubbed; plain-object cause printed as `[Object]` |
| `AggregateError` with PHI in inner errors and message | `AggregateError: aggregate [EMAIL] \| errors: 2` (inner errors not printed) |
| PHI in `err.name` | printed as `Error: named` (name rejected) |
| Non-string `message`; 2,500-char message with PHI at the end | nothing leaked |
| Unicode, spaced and dashed variants | all redacted |
| Render error (page throws) | `Error [23505]: render failed for [PHONE REDACTED] \| digest=… \| details: Key (phone)=([REDACTED])` |
| Streaming error (Suspense child throws after `await`) | scrubbed, with digest |
| `generateMetadata` throws | scrubbed |
| Server Action throws (POST with `Next-Action`) | scrubbed |
| `after()` callback throws | `An error occurred in a function passed to after(): PostgrestError … [REDACTED] … [EMAIL]` |
| Unhandled rejection | `⨯ unhandledRejection: Error: unhandled [EMAIL] \| details: … ([REDACTED])` |
| Uncaught exception in a timer | `⨯ uncaughtException: Error: uncaught [EMAIL] …`; server stayed up |
| `console.log`, `info`, `warn`, `debug`, `error("%s %o %j")`, `error(<number>)`, `table`, `assert`, `group`, `trace`, `count`, `timeLog` | all scrubbed (objects print as `[Object]`) |

**New finding, Low: two output paths are not wrapped.**
- **Where:** `lib/observability/console-scrub.ts:20` (`CONSOLE_METHODS`).
- **What leaks:**
  - `console.dir(obj)` and `console.dir(err)` printed raw:
    `{ phone: '+919812345678', email: 'rv.marker@example.com' }`, and a full PostgrestError with
    `details: 'Key (…, +919812345678) already exists.'` and its `hint`.
  - `process.stderr.write` and `process.stdout.write` are printed verbatim.
- **Why it is Low:** lint (`eslint.config.mjs:215-224`) bans `console` in app code. A search of `next/dist/server`,
  `next-server` and `@supabase` found no `console.dir(` and no raw `stderr.write` on runtime error paths. The only raw
  stream writer in app code is `lib/log/index.ts:18`, the typed logger. Neither lint nor `CONSOLE_METHODS` covers a
  dependency that calls `console.dir`, or new code that writes to `process.stderr`.
- **Fix:** add `dir` (and `dirxml`) to the wrapped methods, and add a lint ban on `process.stderr` and `process.stdout`
  outside `lib/log/**`.

Info:
- Free-text names are not detected by any pattern; `Failed to upload tenants/[UUID]/patients/[UUID]/labs/Ramesh_Kumar_CBC.pdf`
  printed the name. The scrubber's header documents this limit.
- The real source of such paths is fixed at the source: `lib/storage/supabase-provider.ts:20-21` now throws
  `Storage <op> failed (bucket …)` with no path (M-ERRMSG). The key scheme itself is the accepted V2-05 item.
- A crafted stack frame path with an email (`at x/rv.marker@example.com:1`) passes. Frame paths are code locations,
  not data, so there is no realistic source.

---

Probe scripts (scratchpad, not in the repo): `auth-probe.mjs`, `pay-probe.mjs`, `env-probe.ts`, `start-rv.mjs`. Server
logs: `rv-err.log`, `rv-out.log`.

---

**Fix note (phase close):** the Low above (`console.dir` / direct `process.stdout/stderr.write`) is fixed in `e4eb4c1`:
`dir`, `dirxml` and `table` are wrapped by the console scrubber, and a P1-25 lint gate confines `process.stdout` and
`process.stderr` to `lib/log/**` and `lib/observability/**`. Recorded in `03-13-REVIEW-TRIAGE.md` (Lows fixed).
