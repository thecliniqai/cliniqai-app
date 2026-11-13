---
phase: 03-platform-hygiene
review: independent (isolated, fresh context)
range: origin/feature/v2..3f81bfb (branch v2/phase-03-platform-hygiene, PR #5)
reviewed: 2026-11-13
depth: deep (cross-file: proxy → routes → services → RPCs/migrations → CI/workflows)
excluded: types/database.ts, package-lock.json, .planning/**/evidence/**
findings:
  critical: 0
  high: 1
  medium: 2
  low: 9
  info: 8
  total: 20
status: issues_found
---

# V2-03 Platform hygiene: independent code review

I read the requirements first: CLAUDE.md, roadmap §12.2 V2-03, and `03-PLAN.md` (plans, threat model, rulings). I formed
the findings below from the code. Only after that did I check `03-WAVE-NOTES.md` and `03-12a-PASSWORD.md` to see which
findings were already known. I mark those **[known]**. I did not open any `.env*` file, contact any hosted service or
change code. I ran three scratch probes (outputs quoted below) from the session scratchpad: the SSRF validator on edge
addresses, and ESLint `lintText` on bypass spellings.

Severity scale: Critical / High / Medium / Low / Info.

---

## High

### H-1: The A00-5 "stale mailbox session" bound is enforced only in the app's server action. GoTrue still accepts a direct password change from any OTP or recovery session, and the reset flow keeps that kind of session for good.

**Files:** `features/auth/service.ts:30,183,211` (app-side 10-minute bound); `app/(auth)/forgot-password/page.tsx:165-170`
(after a successful reset the user stays signed in on the recovery session); `supabase/auth-policy.json` row
`require_current_password` (hosted exemption for OTP/recovery sessions, spike E5, ruling A00-5).

**Failure scenario.**
1. A user resets their password through `/forgot-password`. `completeReset` → `verifyOtp({type:"recovery"})` creates a
   session whose `amr` is `otp`. `setNewPasswordAction` sets the password. `finish()` then does
   `router.replace("/")`, so this session becomes the user's everyday session. Per E7, its `amr` timestamp survives
   every refresh. An invited user who accepts with an emailed code gets the same kind of session.
2. Days later, an attacker gets hold of that session. Realistic routes: a shared front-desk PC left signed in, or
   `@supabase/ssr` auth cookies, which page JavaScript can read, so XSS or a malicious extension can take them.
3. The attacker calls GoTrue directly: `PUT /auth/v1/user {"password": "..."}` with the access token. They can also
   paste `supabase.auth.updateUser({password})` into devtools. Hosted "Require current password" exempts OTP and
   recovery sessions at any age (spike E5, quoted in A00-5). The 10-minute check in `setNewPassword`/`changePassword`
   never runs because the app's action is not involved.
4. Result: the password changes without the current one and without FT-05. GoTrue then ends the owner's other
   sessions (wave note 03-12a: GoTrue does this on its own). The attacker now owns the account long term and the real
   user is locked out.

The threat model lists T-03-12 ("password changed from a stale recovery session", high) as **mitigate**. The
mitigation can be bypassed by anyone who holds the session, which is exactly that threat. R-5/T-03-21 accepts the
direct-`updateUser` path only as a *self-only* FT-05 bypass. It does not cover this escalation from a stolen session to
account takeover. I found no record of this residual in the plan, the 03-12a record or the wave notes.

**Suggested fix (needs a PO decision: the approved AUTH §3.4 diagram ends "signed in → post-login routing").**
- Never keep a mailbox session past the reset. Once `setNewPasswordAction` succeeds, run `signOut({ scope: "global" })`
  server-side, which also revokes the recovery session. Send the user to `/login` with a notice, so the session they
  keep has `amr=password` and hosted require-current-password protects it. Apply the same rule to invite acceptance
  when AUTH-06 lands.
- Until then, record the residual explicitly as an accepted risk with an owner, and add a hosted re-check item to the
  AUTH-00 kit. The item: a recovery session older than 10 minutes calls `PUT /user {password}` directly, and the
  result is recorded.
- Add an e2e or DB-lane test: after the reset completes, the browser's session `amr` is not `otp`/`recovery` (or no
  session remains).

---

## Medium

### M-1: The SSRF guard misses IPv4-embedded IPv6 forms and 198.18/15, and the DNS-rebinding window is still open (T-03-11 is listed as "mitigate") [known: wave note 03-10 lists NAT64/6to4 and rebinding as residuals for review]

**Files:** `lib/webhooks/ssrf.ts:47-75` (`isPrivateIp` IPv6 branch), `lib/webhooks/ssrf.ts:84,103-105` (resolve-then-fetch),
`lib/webhooks/dispatcher.ts:149-161` (`fetch` resolves the name again).

**Verified with a scratch probe** (`validateWebhookEndpoint(url, { resolve: async () => [] })`):

```
https://[::127.0.0.1]/          -> hostname [::7f00:1]           {"valid":true}
https://[64:ff9b::a9fe:a9fe]/   -> NAT64 169.254.169.254         {"valid":true}
https://[2002:7f00:1::]/        -> 6to4 127.0.0.1                {"valid":true}
https://198.18.0.1/             -> benchmarking range            {"valid":true}
```

**Failure scenario.** A clinic owner or admin can create webhook subscriptions. They register
`https://[64:ff9b::a9fe:a9fe]/` or a hostname whose AAAA record is one of these forms. On any runtime with NAT64/DNS64
or 6to4 routing, the dispatcher POSTs to an internal or metadata address. The bigger gap is rebinding: an attacker's
DNS answers a public IP to `dns.lookup` and `127.0.0.1` or `169.254.169.254` to the `fetch` that follows. The
delivery row stores `response_status`, so this is a blind SSRF with a status oracle.

**Suggested fix.** Validate the address actually used for the connection. One way: an undici `Agent` with
`connect.lookup` that runs `isPrivateIp` on every resolved address and fails the connection. Another: resolve once,
then connect to the IP while sending SNI/Host for the original name. Replace the hand-written range checks with a
`net.BlockList` covering the full IANA special-purpose registry. Unwrap embedded IPv4 in `::/96`, `::ffff:0:0/96`,
`64:ff9b::/96`, `64:ff9b:1::/48` and `2002::/16`, and add 198.18.0.0/15, 192.0.0.0/24 and 240.0.0.0/4. Give the
residual an owner and phase in the backlog (V2-04 touches the dispatcher anyway).

### M-2: Schema drift checks cover only `public` and (with migra defaults) no privileges, so the security-relevant parts of 000025–000028 are never drift-checked on staging. The CI "local drift" step compares the migrations with themselves.

**Files:** `scripts/staging/schema-drift.mjs:30` (`--schema public`), `.github/workflows/ci.yml:138-139` +
`scripts/ci/local-drift.mjs`.

**Failure scenario.** This phase's protections live outside `public` tables or in grants:
- the `ops` schema, and `private.outbox_payment_recorded` (EXECUTE revoked from anon);
- the REVOKE/GRANT pairs on `readiness_probe`, `ops_ingest_error` and `referral_source_clinics`;
- the column-level `GRANT INSERT (…)` on `payments` that stops a request-path user forging `recorded_by_system`.

Suppose a manual dashboard change on staging (or later production) grants `EXECUTE ON private.outbox_payment_recorded`
to anon, re-grants table INSERT on `payments`, or alters an `ops` table. The nightly drift job stays green, because
it diffs only `public` and migra does not compare privileges by default. Separately, the CI step
`Local schema drift (supabase db diff --local)` runs right after `supabase start` has applied the same migrations it
diffs against. Unless something outside the migrations writes DDL, it can only ever find the pg_net false positive.
It gives almost no assurance for the acceptance "a fresh db reset matches the target schema".

**Suggested fix.** Diff `public,ops,private,storage` (and the `auth` triggers/policies the app owns). Add a privilege
snapshot to both lanes: a catalogue query over `information_schema.role_routine_grants`,
`role_table_grants`/`column_privileges` for anon and authenticated, plus `pg_policies`. Compare the local stack
against staging. Keep the local step, but describe it as "migrations are deterministic", not as drift = 0.

---

## Low

### L-1: Sign-out when the proxy refreshed the session in the same request: untested, and depends on Set-Cookie order
`proxy.ts:66-98` + `app/auth/signout/route.ts:80-91`. If the access token has expired when the user presses "Sign
out", the proxy refreshes the session and sets new `sb-*-auth-token` cookies on its pass-through response. The handler
then revokes the session and deletes the same cookies. The browser gets both Set-Cookie headers. The local cookie is
gone only if Next emits the handler's deletion after the proxy's write. If the order is reversed, the revoked
session's fresh access token stays usable until it expires: up to 15 minutes, and `getClaims()` verifies it locally
with asymmetric keys. `tests/e2e/auth/signout.spec.ts` covers only a live token. **Fix:** add an e2e case with an
expired access token at sign-out (shorten `exp` or wait out a short local `jwt_expiry` in a dedicated config). Or skip
the proxy refresh for `POST /auth/signout`, the same way `/api/health` and `/api/ready` are skipped.

### L-2: The OA-5 default-deny and the request-id overwrite skip page paths ending in an image extension
`proxy.ts:117`: the matcher excludes `.*\.(svg|png|jpg|jpeg|gif|webp)$` everywhere outside `/api`. A signed-out GET to
`/patients/<id>.png` reaches the dynamic page without the proxy. The default deny doesn't apply, and an inbound
`x-request-id` (any UUID) is not overwritten, so T-03-07 can be bypassed on that path. The layout still refuses
signed-out users, so nothing leaks today. **Fix:** narrow the exclusion to the real static locations (e.g. `/images/`,
`/icons/`), or apply it only when the path has no dynamic page match. Add a `pageNeedsSession` case for it.

### L-3: ESLint boundary rules can be bypassed with package subpaths and computed keys (verified)
`eslint.config.mjs:246-257`: `no-restricted-imports.paths` matches the exact names `@supabase/supabase-js` and
`@supabase/ssr`. Linting `features/patients/probe.ts` with `lintText` gave no boundary message for:
`import { createServerClient } from "@supabase/ssr/dist/main/index.js"`, which resolves because `@supabase/ssr` has no
`exports` map; for `new PostgrestClient(...)` from `@supabase/postgrest-js`; or for
`serverEnv()["SUPABASE_" + "SECRET_KEY"]`. Each needs deliberate effort, so I rate it Low. Still, ADR-0005's control is
"ESLint only". **Fix:** turn the two `paths` into `patterns` with `regex: ^@supabase/(supabase-js|ssr|postgrest-js|auth-js)(/.*)?$`
plus `importNames`. Add a `no-restricted-syntax` ban on computed member access on `serverEnv()` outside `lib/env*`.
Add these three spellings to `lint-fixtures/p1-34`.

### L-4: The migration immutability gate does nothing on pushes to `feature/v2`
`.github/workflows/ci.yml:47` sets `BASE_REF=origin/feature/v2` on `push`. The merge base of `origin/feature/v2` and
`HEAD` is `HEAD`, so the gate compares the commit with itself (`scripts/ci/migration-immutability.mjs:39`). An admin
push or a bad merge that edits an applied migration lands on the branch `staging.yml` migrates from. **Fix:** on
`push`, use `--base ${{ github.event.before }}` (fall back to `HEAD~1`).

### L-5: The staging workflow header claims checks that `workflow-policy.mjs` doesn't run
`.github/workflows/staging.yml:7-15` says that "secrets live only in the env of the single step", `npm ci
--ignore-scripts` with no cache, `persist-credentials: false` and a read-only token are "checked by
scripts/ci/workflow-policy.mjs". The checker only verifies that a staging secret sits inside a job with
`environment:`, plus pinning, top-level `permissions`, PR triggers and the secrets dump. A later edit could move
`STAGING_SECRET_KEY` to job-level `env`, drop `--ignore-scripts`, or add `actions/cache` next to the secret, and still
pass. **Fix:** add these rules (job-level `env:` must not name a staging secret; staging jobs must use `npm ci
--ignore-scripts`, have no `actions/cache`/`cache:` key, and set `persist-credentials: false`). Or reword the header to
say what is actually enforced.

### L-6: The Send Email hook can outlive GoTrue's hook timeout, and has no replay or duplicate guard
`lib/email/ses.ts:30-31` allows `maxAttempts: 2`, `connectionTimeout 1.5s`, `requestTimeout 3s`, so up to about 9 s plus
a cold start. GoTrue's HTTP hook timeout is a few seconds (I couldn't confirm the exact value without hosted access).
If GoTrue gives up and retries while SES has already accepted the first send, the user gets two different codes. The
route also has no `webhook-id` de-duplication: `app/api/auth/send-email/route.ts:116`, with a 5-minute tolerance.
Separately, `EMAIL_PROVIDER=disabled` answers 503, which hook clients usually treat as retryable. **Fix:** keep the
total SES budget below GoTrue's timeout (`maxAttempts: 1`, roughly a 3 s total). Keep a short-TTL record of seen
`webhook-id`s (e.g. a tiny table, or `ops`). Answer `disabled` with a non-retryable status. Confirm GoTrue's timeout
and retry policy in the AUTH-00 hosted re-check.

### L-7: Staging deploys can run new code against the old schema until the PO approves `migrate`
`staging.yml` + R-26: the Vercel Git integration deploys every push to `feature/v2` straight away. The `migrate` job
waits for Environment approval. For a migration-dependent change (e.g. 03-07's `record_payment` RPC, 03-09b's sink),
staging serves 500s until approval. "Wait for release" checks only that the deployment caught up, not the order. This
is acceptable for synthetic staging, but production can't copy the pattern (V2-15). **Fix:** record the window in the
runbook. For production, use a Vercel "Ignored Build Step" or a deploy hook triggered by the migrate job.

### L-8: The scrubber cannot remove names, and lab storage keys embed the patient's name
`features/labs/utils.ts:9-22` builds `<Patient_Name>_<original>_<date>.<ext>` keys.
`lib/storage/supabase-provider.ts:51,83,95` puts the full key into thrown error messages. `lib/observability/scrub.ts`
redacts UUIDs, digits, emails and phones, not names. Today `uploadLabDocument` catches the error (so it never reaches
`onRequestError`), and the sink is safe for now. Any future uncaught storage error on this path would write a
patient's name into `ops.error_events`, which has 180-day retention. Note: the same message already goes back to the
client verbatim (`features/labs/service.ts:181-184`, pre-existing AD-7 debt). **Fix:** remove `[bucket/path]` from the
storage provider's error messages (log the tag only). Consider id-only storage keys when labs are reworked.

### L-9: The `record_payment` outbox subject check (`xmin` = current top-level xid) breaks if the RPC is ever called inside a subtransaction
`supabase/migrations/000027_record_payment_rpc.sql:80`: `p.xmin = pg_current_xact_id()::xid`. If a future caller runs
`record_payment` inside a plpgsql `BEGIN … EXCEPTION` block or a savepoint (both normal in later RPC-per-flow work),
the inserted row's `xmin` is the subtransaction's xid. The outbox then refuses a legitimate payment
(`OUTBOX_SUBJECT_INVALID` → INTERNAL). **Fix:** compare with `pg_xact_status`/`txid_current_if_assigned`
semantics that cover subtransactions. Or pass a per-call nonce that the command writes and the outbox checks. Add a
spec that calls the RPC from inside a savepoint.

---

## Info

- **I-1 `readiness_probe` is anon-executable** (`000025:55-56`), and the publishable key is public, so any
  unauthenticated caller can read cross-tenant outbox counts, the latest migration and (via `/api/ready`) which
  providers are configured. This is by design under ADR-0005 C50(g). Also, `messages_failed_24h`/`webhooks_failed_24h`
  filter on `updated_at`, which the `(status, next_retry_at)` indexes don't serve (`000025:36`). The comment
  "Every count is served by the existing indexes" is inaccurate, and those scans grow with unpurged dead letters.
  Consider an index or a capped `LIMIT` count before V2-04 alerts poll it.
- **I-2 `isLocalDemoKey` catches only the JWT demo keys** (`lib/env.ts:254`). The CLI's fixed local
  `sb_publishable_…`/`sb_secret_…` defaults would pass the staging/production check. The loopback-URL rule makes this
  near-harmless, but a deny-list of the CLI's default opaque keys costs one line.
- **I-3 Staging boots with `PWNED_CHECK=off`, no Turnstile site key and no `ERROR_INGEST_KEY`.** That's allowed (R-16,
  R-17). The hosted acceptance items (FT-05 on staging, Turnstile, sink) therefore depend on PO actions E4/E7/E9 being
  done in the right order. The policy row turns hosted CAPTCHA on: if it's on before the site key is set, every
  staging sign-in fails with `captcha_failed`. Worth one line in the runbook order.
- **I-4 The direct `payments` INSERT and `invoices.status` UPDATE paths stay open for `authenticated`**, bypassing
  `record_payment`'s invariants. **[known: wave note 03-07, owner V2-07]**
- **I-5 CODEOWNERS** doesn't list the new security-sensitive paths (`features/auth/`, `app/auth/`, `app/api/auth/`,
  `lib/env*.ts`, `instrumentation.ts`, `lib/observability/`, `lib/email/`, `supabase/auth-policy.json`,
  `supabase/config.toml`, `scripts/staging/`, `scripts/drift/`, `lint-fixtures/p1-34/`). It's documentary only (`*`
  covers them), but its header says it lists the paths that get the adversarial second review.
- **I-6 `getInboundReferrals` vs `referral_source_clinics`:** the RPC answers for any of the caller's tenants
  (`current_user_tenant_ids()`), not the active one, and checks no role. It matches the existing RLS policy, so it
  discloses nothing new (clinic name and phone only).
- **I-7 Server-rendered dates without `timeZone`** are still in PDFs (`features/prescriptions/pdf/prescription-document.tsx:387,608`
  "Signed on", `features/referrals/pdf/referral-letter-document.tsx:452,618`, `features/dpdp/pdf/medical-summary-doc.tsx`).
  On a UTC runtime, a prescription signed between 00:00 and 05:30 IST shows the previous date. This is outside the
  "UTC today" lint and the 03-05 site list, which defer display formatting, but it's a legal-document date. Suggest a
  backlog item.
- **I-8 Pre-existing raw `err.message` returns** remain in many services and v1 routes (`features/billing/service.ts:228,474,…`,
  `features/labs/service.ts:183`, `app/api/v1/**`). AD-7 per-domain conversion is later scope, so I'm only noting it.

---

## Checked and found sound

- **Proxy (`proxy.ts`, `lib/auth/public-paths.ts`).** The request id is always overwritten and echoed. `/api/v1`,
  `/api/health` and `/api/ready` return early. The session is refreshed only in the proxy, and the setAll cache
  headers are carried onto redirects. The default deny requires both the raw and the normalised path to be public
  (encoded `..` refused, undecodable paths protected). `loginNextValue` refuses `//` and `\`.
- **`safeNextPath`.** It rejects control characters, backslashes, `//`, and encoded slashes in the path after up to 4
  decode rounds, and runs a final URL-origin check. The login page uses it.
- **`POST /auth/signout`.** POST only. The same-origin check uses `Sec-Fetch-Site` + `Origin` and refuses when neither
  is present. Scope is validated. It returns `Clear-Site-Data: "cache"` and `no-store`, and drops cookies when GoTrue
  can't be reached.
- **Send Email hook.** The signature is verified before parsing (standardwebhooks, constant-time, tolerance), with
  fail-closed handling for a missing or invalid secret. `magiclink` and unknown types are dropped. Codes are
  digits-only, so the templates can't be injected into. Logs carry no address or code. The env schema enforces the
  secret format and length.
- **FT-05 (`lib/auth/pwned.ts`).** k-anonymity with padding. Count-0 lines are ignored. The hard deadline works even if
  the fetcher ignores abort. No prefix or suffix is logged. It must be on in production, and the base URL can't be
  overridden outside dev/test/e2e.
- **Password service.** Claims come from the cookie session, with no user id from input. The order is validate →
  freshness → FT-05 → update → `signOut('others')`. Supabase messages are never surfaced. Unreadable `amr` fails
  closed. (Only the GoTrue-side bypass in H-1 is open.)
- **`record_payment` (000027).** SECURITY INVOKER with an empty `search_path` and `lock_timeout`. The actor rule is
  closed (user: no system actor; system: `service_role` + closed set). It narrows to the active tenant, locks the
  aggregate root, checks the role with parity to `appointments:edit`, replays idempotently under the lock, and checks
  overpayment and status invariants. Audit and outbox are in the same transaction. A column privilege stops
  `recorded_by_system` being forged, and payments have no UPDATE policy. The outbox definer refuses a non-current-tx
  subject. The service maps errors to `AppError` with fixed text, and the client keeps the command id across retries.
- **`ops_ingest_error` (000028).** The key hash comes from vault, with a closed key set and per-field shape checks, a
  size cap, a second scrub and a daily new-fingerprint cap under an advisory lock. Purge and size are granted to no
  API role. The `ops` schema has no grants and RLS on.
- **`referral_source_clinics` (000026).** It mirrors `referrals_target_tenant_select`, uses an empty `search_path`,
  and only authenticated is granted.
- **Single factory.** `getSystemDb` uses a closed reason set and a PHI-free log line, and throws without the key. The
  admin factory and the storage service-role fallback are deleted. Every importer is inside the allow-list or the
  C50 register (I checked with `git grep`).
- **Env schema.** Production requires real messaging, SES, the hook secret, the ingest key, Turnstile (not a test key),
  `PWNED_CHECK=on` and https non-loopback URLs. Retired names are refused in deploy tiers, and messages never contain
  values. `next.config.ts` and `instrumentation.register()` both enforce it. The API v1 switch fails closed.
- **Logger.** It has a closed field set with runtime sanitising, and errors enter only through `errorTag`. A
  behavioural spec drives real error branches with PHI-bearing synthetic errors.
- **Error sink e2e.** It proves a real thrown error lands once, scrubbed, under the response's request id. The diag
  route checks the bearer first and is forbidden in production by the schema.
- **Workflows.** No PR trigger on the staging and drift workflows. `environment:` is on every staging job, with
  step-scoped secrets, SHA-pinned actions, `contents: read`, `persist-credentials: false` and `--ignore-scripts`. Input
  values go only through `env`, never inline in `run`. The target guard refuses loopback, IP literals and other refs,
  and masks the DB password.
- **Hosted drift script.** Read-only token, secret fields never mapped or printed, status-only errors, `redirect: "error"`.
- **lib/datetime.** `TZDate`-based, half-open windows, zone-free calendar arithmetic. The CI re-runs the spec under
  `TZ=America/New_York`. The IST boundary DB tests fake only `Date`.
- **Tests sampled** (system-db, storage fallback, no-raw-error-logging, record-payment RPC, error-sink e2e, signout e2e,
  public-paths enumeration). They assert real outcomes against the local stack or the built app, with no source greps.
  The fault-injection trigger is scoped to a marker endpoint and always dropped.

_Reviewer: Claude (isolated independent reviewer, gsd-code-reviewer stance)._
