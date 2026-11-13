# 03-12c record: Turnstile + safe `next` + J-A3 + AUTH-00 re-check kit (AUTH-04b part, C43, A00-4 probe, AUTH-00 staging re-check, R-22)

**Outcome:** done locally. Roadmap acceptance 10 ("Turnstile is on sign-in and reset; signup does not exist until
V2-13b") is proven locally: Cloudflare's always-pass test key, the widget script answered by a local stub, and local
GoTrue with CAPTCHA off (R-22), so the lanes prove the token wiring and the refusals, not Cloudflare. Live Cloudflare
on staging is **pending PO (E7, E3)**. AUTH-04b safe `next`: full. AUTH-00 staging re-check: the kit is built and runs
end to end on the CLI stack; the hosted run is **pending PO (E2, E3, E7, E10)**. No Cloudflare, Supabase-hosted or
GitHub-settings call was made.
**Evidence:** `evidence/03-12c/` (tool output only; `commit.txt` is the SHA the full lanes ran on) and the `03-12c`
part of `evidence/package-legitimacy.json`.

## Commits

| SHA | Subject |
|---|---|
| `7d5981f` | feat: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` env rules (R-15 checklist) and the `@marsidev/react-turnstile` 1.6.2 exact pin |
| `bb324cf` | feat: Turnstile on sign-in and the reset request; `safeNextPath` after sign-in |
| `41f26f6` | feat: local Turnstile stub in the e2e network block; J-A3, Turnstile and a11y specs |
| `aebe35d` | feat: AUTH-00 re-check kit and the `staging.yml` `auth00-recheck` job |
| `407d47a` | feat: safe `next` keeps the proxy's path + query; J-A3 round trip through the 03-12b redirect |
| `0bf9e16` | docs: this record, the evidence and the wave-note rows |
| `096116b` | fix: the kit CLI spec's JWT-shaped fixture built at runtime; its exact historic fingerprint in `.gitleaksignore` (repo convention; the spec re-ran 16/16) |
| (next) | docs: gitleaks evidence |

## What shipped

- **Dependency:** `@marsidev/react-turnstile` **1.6.2** (exact). No dependencies, no install scripts, integrity equal
  to the registry, `npm audit signatures` clean (`evidence/package-legitimacy.json` → `plans.03-12c`, tool output).
  Flagged SUS "too-new" in research: **the PO confirms it at E14 (blocks the merge, not local work, R-23).** The lock
  was rewritten and re-checked with Linux npm (`scripts/ci/lock-linux-check.sh` PASS).
- **Env (R-15):** `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Production: required, and Cloudflare test keys are refused.
  Staging: optional until E7. development/test/e2e/ci: only Cloudflare's documented test site keys
  (`TURNSTILE_TEST_SITE_KEYS`). Shape `<digit>x<16-64 chars>`. `publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY` (blank =
  unset). `.env.example` regenerated; test-env pin (unset or a test key; the two lists are kept equal by a spec); e2e
  value `1x00000000000000000000AA`; production profiles in `env-schema`/`env-boot` carry a key.
- **`components/auth/turnstile-field.tsx`** (Managed mode, C43): renders only with a site key. The handle's
  `token()` returns the current token or waits for it (15 s) while the widget is working, and returns `null` at once
  when it failed or could not load. `reset()` after every attempt (single-use tokens). `refresh-expired: auto`,
  `retry: auto`, no hidden response field. Loading / failed / expired / unavailable copy in a polite live region
  (`messages/en.ts` → `en.auth.captcha`).
- **`features/auth/password-flows.ts`:** `signIn(client, input, captcha?)` and `requestReset(client, input, captcha?)`.
  With `{ required: true }` and no token the flow returns `captcha_required` before any Supabase call; with a token it
  goes to GoTrue as `options.captchaToken` (wire: `gotrue_meta_security.captcha_token`). No app-side `siteverify`
  (Supabase verifies). Without a site key the calls are byte-identical to before.
- **Pages:** login has the widget above "Sign in"; a refused CAPTCHA keeps the typed password. Forgot password has the
  widget on the request step and an `interaction-only` widget for "Resend code" (only one mounted at a time).
- **Safe `next` (`lib/auth/safe-next.ts`, T-03-04):** accepts only `^/(?![/\\])`, ≤ 512 characters. It refuses
  control characters (raw or decoded), a raw backslash anywhere, malformed or never-settling encodings, and an encoded
  slash or backslash in the **path** in any decoded form. The query and fragment may carry encoded slashes (03-12b's
  proxy puts path + query in `next`). A final URL-parser check must stay on the origin. Login goes to
  `safeNextPath(next) ?? "/"`. `lib/auth/same-origin.ts` (03-12b) was not reused: it checks request headers for CSRF,
  not a redirect target.
- **E2E stub (R-22):** `tests/e2e/fixtures.ts` `routeLoopbackOnly()` fulfils exactly
  `https://challenges.cloudflare.com/turnstile/v0/api.js` from `support/turnstile-stub.js`. Every other non-loopback
  request is still aborted and fails the test. The stub implements the explicit-render API and Cloudflare's test-key
  behaviour (pass / block / interactive), issues `XXXX.DUMMY.TOKEN.XXXX-<n>` tokens, and exposes controls for specs.
- **AUTH-00 re-check kit** (`scripts/staging/auth00-recheck-lib.ts` + CLI `auth00-recheck.ts`). It creates synthetic
  users with the secret key, takes codes from `generateLink` (no mailbox), runs nine items, writes a JSON report and
  deletes its users (a sweep by run tag as well). The report holds statuses, error codes and shapes only. The kit
  withholds a report that would contain a configured key, a JWT, an `sb_` key or any password, code or token of the
  run. Items: (1) `verifyOtp` type matrix vs the spike; (2) password grant and `/recover` without a token, the
  secret-key bypass (T-03-20), and the PO's browser check (input); (3) require-current-password no/wrong/right, the
  recovery exemption, the other session after a password change (03-12a finding 4), and the old tokens after a
  `/logout` (03-12b request); (4) `postgres` DELETE on `auth.sessions` (read-only catalogue session); (5) signup for
  an existing address (publishable and secret key); (6) **one** burst of ≤ 40 password grants, stopping at the first
  429, run last; (7) `auth.audit_log_entries` rows for the burst user plus the PO's retention note; (8) `amr` of
  password and recovery sessions and after a refresh; (9) `@supabase/ssr` pin and installed version.
  - CLI `--target local`: the lane's loader and guard, loopback only, `docker exec psql`. `--target staging`: refuses
    unless `GITHUB_ACTIONS=true`, `GITHUB_REF=refs/heads/feature/v2`, `APP_ENV=staging`, the API URL and database
    pass `target-guard.mjs`, and the keys are `sb_secret_`/`sb_publishable_`. `psql` gets the connection as `PG*`
    variables (no URL on a command line), only PATH plus those, inside `begin read only` … `rollback`.
  - Staging addresses are `success+auth00-<run>-<n>@simulator.amazonses.com` (SES mailbox simulator), so the
    password-change notices from item 3 do not bounce.
- **`staging.yml`:** task `recheck` plus dispatch inputs `captcha_browser_check` (choice) and `auth_log_retention`
  (string, passed through step `env` only and validated by the CLI). Job `auth00-recheck`: dispatch on `feature/v2`
  only, `environment: staging`, `npm ci --ignore-scripts`, target guard with `--mask`, secrets in the step `env`
  only, report uploaded as an artifact (SHAs as in `ci.yml`). `workflow-policy.mjs` PASS; actionlint clean on
  `staging.yml`.

## Tests (each fails without the change; `evidence/03-12c/mutation-run.txt`)

| Spec | Cases | Proves |
|---|---|---|
| `tests/auth/safe-next.spec.ts` | 68 | Kept: `/patients`, the proxy's `/patients?x=1`, queries/fragments (incl. encoded slashes there), dot segments inside the origin. Refused → default page: `//evil.example`, `/\evil.example`, `https://…`, `javascript:…`, `data:`, `/%2F%2Fevil.example` (single, lower case, double-encoded, before a query, behind an encoded `?`), encoded scheme, tab/newline/CR/NUL/DEL/C1 raw and encoded, malformed escapes, deep encodings, 600 characters, `/.//evil.example`, non-strings |
| `tests/auth/password-flows-captcha.spec.ts` | 13 | Widget on and token missing (`undefined`/`null`/`""`) → `captcha_required`, **no Supabase call** (sign-in and reset); a token goes as `options.captchaToken` / `{ captchaToken }`; no widget → calls unchanged; GoTrue `captcha_failed` → catalogue copy; input validation runs first |
| `tests/config/env-schema.spec.ts` / `env-boot.spec.ts` / `tests/setup/test-env-guard.spec.ts` | +10 / +1 / +1 | Production without a key or with any test key fails (boot names it); staging optional; local tiers test keys only; bad shapes refused; the e2e env builds with the always-pass key; guard pins and list parity |
| `tests/integration/auth/auth00-recheck-kit.spec.ts` (local stack) | 12 | The kit completes; the report has all nine items, none in error; local values recorded (CAPTCHA not enforced; require-current-password "not configurable on the CLI stack"; 40 grants, no 429; `signup_disabled`; `postgres` may delete `auth.sessions`; other session ended by GoTrue; old tokens refused after `/logout`; `amr` shapes; `@supabase/ssr` 0.12.7); no key or JWT in the report; **no synthetic user left** |
| `tests/ci/auth00-recheck-cli.spec.ts` | 16 | Staging refusals (outside Actions, other branch, no `APP_ENV`, local or other-project API/DB URL, JWT secret key, missing publishable key, bad PO inputs) with no value echoed; local refusals; `PG*` split; the CLI exits 1 before any request, 2 on usage |
| e2e `tests/e2e/auth/turnstile.spec.ts` (desktop-chrome, pixel-7) | 6 × 2 | The widget renders with the build's key and action; the `/token` body carries `gotrue_meta_security.captcha_token` equal to the stub's token; after a failed sign-in the retry carries a **different** token; `/recover` carries one; with the always-fail key `2x00000000000000000000AB` sign-in and the reset request are refused with **0** `/token` / `/recover` requests; a script that does not load → "could not load" copy, refused; expiry copy, then the refreshed token is the one sent |
| e2e `tests/e2e/auth/j-a3-login.spec.ts` (desktop-chrome, pixel-7) | 4 × 2 | Wrong password → "Email or password is incorrect", no session; right password → the role's home; `?next=/patients` honoured; signed out `/patients?x=1` → 307 `/login?next=/patients?x=1` → sign in → `/patients?x=1`; `//evil.example`, `/\evil.example`, `https://evil.example/patients`, `/%2F%2Fevil.example`, `javascript:alert(1)` → the default page, browser never leaves loopback |
| e2e `tests/e2e/a11y/turnstile-screens.spec.ts` (desktop-chrome) | 8 | Login and forgot-password **with the widget** at 360/820/1280, and the failed state at 360: 0 serious/critical axe, no horizontal scroll at 360, widget ≥ 300 × 65 inside the form column. Screenshots (`evidence/03-12c/screenshots/`) checked by eye at all three widths |

Mutation run (scratch worktree at `aebe35d`, main tree untouched): `safeNextPath` accepting any leading slash, the
CAPTCHA refusal and token passing removed, the production and test-key env rules removed, and the CLI's Actions check
removed. **41 tests in 5 files failed.** E2E: without `safeNextPath` the login would `router.replace(next)` to the
evil host, and the fixture's network block fails the test. Without the token wiring the `captcha_token` assertions
fail.

## Checks (on the SHA in `evidence/03-12c/commit.txt`)

| Check | Result | Evidence |
|---|---|---|
| `npm run typecheck` | exit 0 | `static-checks.txt` |
| `npx eslint .` | 0 errors, 422 warnings (none new in 03-12c files) | `static-checks.txt` |
| `npm run inventory`, `env-example --check`, `check-auth-config`, `workflow-policy`, actionlint (`staging.yml`), `lock-linux-check` | all pass (actionlint's SC2016 info is in `nightly.yml`, pre-existing) | `static-checks.txt` |
| Full Vitest lane (`npm run test:db`) | 146 files, 2842 passed, **0 failed**, 0 skipped. Report gate PASS (floor 1805) | `vitest-full.json`, `vitest-full-tail.txt`, `vitest-report-gate.txt` |
| `npm run e2e:build && npm run e2e:pr` | 183 expected, **0 unexpected, 0 flaky / retried**, 7 skipped (by design), 10 known-bug expected failures | `playwright-results.json`, `playwright-summary.txt` |
| AUTH-00 kit CLI, `--target local` | 9 items, 14/14 synthetic users deleted, 0 left | `auth00-recheck-local.{json,txt}` |
| gitleaks v8.30.1 (full history, after the fix commit) | no leaks found (the first scan flagged one synthetic JWT-shaped fixture, fixed as above) | `gitleaks.txt` |

**Flake check.** One a11y run during the work had one failure ("forgot-password at 1280px"). At that moment the
parallel 03-12b implementer had rebuilt `.next/` under the running server (the e2e build stamp changed to 02:10:28
UTC), and a later run of theirs cleared `test-results/` mid-run. The spec then passed 6 × 8 (`--repeat-each=6`, 53/53)
and in the full lane with 0 retries. The failure came from the shared `.next/` and `test-results/`, not from the spec.

## Deviations and interpretations (for review D / A and the PO)

1. **"With the always-fail test key" runs the stub as Cloudflare runs `2x00000000000000000000AB`.** The e2e build
   inlines one public key (`1x…AA`); a second build per spec is not workable. The spec sets
   `window.__turnstileStubSiteKey` before load, and the stub then behaves as Cloudflare documents for that key (error
   callback, no token). A GoTrue-level refusal locally is not possible: GoTrue would call Cloudflare `siteverify`
   (R-22). The hosted refusal is kit item 2.
2. **Refusal without a token is client-side, before any request** (`captcha_required`). The server-side refusal is
   Supabase's (`captcha_failed`, mapped to the catalogue copy); no app-side `siteverify`, as planned.
3. **Safe `next` is stricter than the plan's one-line rule.** Encoded slashes and backslashes are refused in the path
   only, so the proxy's path + query (03-12b) round-trips. A literal `%` that does not decode, and a raw backslash
   anywhere, also fall back to the default page.
4. **Kit uses `admin.generateLink`.** The AUTH-01 lint gate bans it everywhere, scripts included. One scoped
   `eslint-disable-next-line` with a reason sits in `auth00-recheck-lib.ts` (test tooling, plan step 3, synthetic
   users, no email sent). For review A.
5. **Kit signs its own users in with the secret key on staging** (CAPTCHA would refuse a token-less grant). Item 2
   records whether that bypass still works (T-03-20). If it does not, items 3 and 8 report `blocked`, not a false
   pass.
6. **Kit additions beyond the nine-item text:** the other-session check (03-12a finding 4) and the post-`/logout`
   token check (03-12b request) sit inside item 3. Item 7 also reads `auth.audit_log_entries` (read-only).
7. **New Environment variable `STAGING_PUBLISHABLE_KEY`** (public). See PO-ACTIONS corrections below.
8. **Files beyond the plan list:** `tests/auth/password-flows-captcha.spec.ts`, `tests/ci/auth00-recheck-cli.spec.ts`,
   `tests/e2e/a11y/turnstile-screens.spec.ts`, `scripts/staging/auth00-recheck-lib.ts` (the kit, separate from its
   CLI), `messages/en.ts` (copy), `tests/e2e/support/password-journeys.ts` (its own context now gets the stub),
   `tests/config/env-boot.spec.ts`, `tests/setup/test-env-guard.spec.ts`.

## PO-ACTIONS corrections

- **E10:** add Environment `staging` variable `STAGING_PUBLISHABLE_KEY` (the staging `sb_publishable_…` key).
- **E7 / E3 verify:** after the browser sign-in with the live widget, dispatch `staging.yml` → task `recheck`, with
  `captcha_browser_check=passed|failed` and `auth_log_retention` from Dashboard → Logs. Claude reads the
  `auth00-recheck-report` artifact into VERIFICATION_LOG.
- **E14:** confirm `@marsidev/react-turnstile@1.6.2` from `evidence/package-legitimacy.json`.

## Threat flags

| Flag | File | Description |
|---|---|---|
| threat_flag: egress (browser) | `components/auth/turnstile-field.tsx` | The login and forgot-password pages load `challenges.cloudflare.com` (script + iframe) when a site key is set (C43, DATA_HANDLING: Turnstile outside India, Managed mode). No app-server egress |
| threat_flag: hosted tooling | `scripts/staging/auth00-recheck*.ts`, `staging.yml` | A PO-approved job creates and deletes synthetic users on staging with the secret key, sends ≤ 40 failing grants from the runner IP, and reads two catalogue facts. It is guarded and dispatch-only, and the report holds no secret |
