# 03-11a record: AUTH-02 auth config as code + drift check (AUTH-02, A00-1/A00-4/A00-5 config side, R-20)

**Outcome:** done locally. The hosted half is built and tested with an injected `fetch` and a synthetic response
only; the real staging run is **pending PO (E0 origin, E3 apply, E11 read-only token)** and is wired into `drift.yml`
by 03-08.
**Evidence:** `evidence/03-11a/` (tool output only; `commit.txt` is the SHA the static checks ran on).

## Commits

| SHA | Subject |
|---|---|
| `3c76ccf` | chore: `smol-toml` 1.9.1 (dev, exact) |
| `c84a8dd` | feat: auth policy as code; `config.toml` governed by `supabase/auth-policy.json` |
| `1747068` | feat: read-only hosted auth-config drift check against the staging policy column |
| `4ab5643` | ci: auth policy check in the `static` job |
| (next) | docs: this record, the evidence and the wave-note rows |

## What changed

- **Policy (`supabase/auth-policy.json`).** 41 rows. Each row has the `config.toml` path, the Management API field,
  a `transform` (`same`, `invert`, `duration_seconds`, `csv_set`, `file_content`), the `local` / `staging` /
  `production` values, the dashboard label, the `source` (AUTH §4.1 row or ruling), and a `deviation_reason`. The
  reason is required whenever the environments differ and must be null otherwise. The toml → API field mapping is
  the one Supabase CLI 2.120.0 uses for `config push`. It was read from the CLI binary
  (`cli-2.120.0-auth-field-mapping.txt`), so it is not guessed. Values follow research §03-11:
  - `jwt_expiry` 900; refresh rotation on, reuse interval 10 s (defaults made explicit);
  - signups off on every environment (A00-1); anonymous sign-ins off; phone provider off;
  - min password 10, no composition rules;
  - `[auth.rate_limit]` email 60/h, sign-in/sign-up 30, token refresh 150, verifications 30 (A00-4);
  - confirmations on, `max_frequency` 60 s, OTP length 6, OTP expiry 600 s, secure password change off;
  - CAPTCHA Turnstile: off locally (R-22), on for staging/production;
  - Send Email hook: off locally (Mailpit), on for staging/production at `{{STAGING_ORIGIN}}/api/auth/send-email`;
  - TOTP enrol/verify on, phone MFA off;
  - `password_changed` notification on with a code-free body;
  - code-only confirmation and email-change templates added (recovery kept);
  - hosted-only rows: `security_update_password_require_current_password` true (A00-5, R-34) and
    `password_hibp_enabled` false (Free plan, FT-05 / R-5);
  - site URL and redirect allow-list per environment, with no extra redirect URLs on hosted projects.
- **`config.toml`.** The `[auth]` block was rewritten to match the `local` column. The GoTrue container env after the
  restart shows every value applied (`gotrue-env-applied.txt`). Before the restart, the same inspection showed
  `GOTRUE_JWT_EXP=3600`, `GOTRUE_MAILER_AUTOCONFIRM=true`, `GOTRUE_SMTP_MAX_FREQUENCY=1s` and TOTP off.
- **`scripts/ci/check-auth-config.mjs`** (in `static`). It exits 1 and names each `[auth]` key that is mismatched,
  missing, set although the policy keeps it absent locally, or not governed by any row. It also fails on a template
  that carries a link marker or lacks `{{ .Token }}`, and on a notification body that carries a code. A malformed
  policy exits 2. `--print <env>` prints the PO checklist with the values as the hosted fields hold them
  (`po-checklist-staging.txt`). Negative proofs are in `check-auth-config-negative.txt`: `jwt_expiry = 3600` → exit 1
  naming `auth.jwt_expiry`; signups on → exit 1; the pre-03-11a `config.toml` (`bc30ef5`) → exit 1 with 28 problems.
- **`scripts/drift/auth-config-hosted.mjs`** (read-only). It sends
  `GET https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF_STAGING}/config/auth` with
  `SUPABASE_ACCESS_TOKEN_STAGING_RO` and compares the response with the `staging` column. `STAGING_ORIGIN` resolves
  the placeholders.
  - It refuses to run (exit 2, no request) without the token, with a ref that is not 20 `[a-z0-9]`, or with an origin
    that is not a bare https origin.
  - A mapped field missing from the response fails (A4).
  - Secret-bearing fields (`secret`, `smtp_pass`, `auth_token`, `api_key`, `access_key`) cannot be mapped (the
    policy validator rejects them), and the check never reads them.
  - Template bodies are reported as a sha256 prefix plus a length. API errors are reported by status only.
  - The report is JSON, written to `--out` or stdout.
- **`tests/setup/test-env.ts`.** `SUPABASE_ACCESS_TOKEN_STAGING_RO` is in `FORBIDDEN_VARS`, which also adds a case to
  `test-env-guard.spec.ts`.

## Tests

| Spec | Cases | What fails without the change |
|---|---|---|
| `tests/ci/auth-policy.spec.ts` | 11 | repo config passes; `jwt_expiry = 3600` → exit 1 naming `auth.jwt_expiry`; signups on → exit 1; confirmations off; removed key; ungoverned `[auth.external.google]`; hook URL set locally; a link template; policy without source / unexplained deviation / mapped secret field → exit 2; `--print staging` values. Before: no policy and no checker; the pre-change config fails it (`check-auth-config-negative.txt`) |
| `tests/ci/auth-config-hosted.spec.ts` | 11 | matching response → 0 with one GET (Bearer token); `disable_signup: false` → 1 naming the field; missing `security_update_password_require_current_password` → 1; rate-limit, `smtp_max_frequency`, template and hook-origin drift; extra redirect URL; secret markers and the token never in the lines or the report; refusals without the token / bad ref / http origin make no request; HTTP 401 reported by status only; the CLI exits 2 without the token and writes no report |
| `tests/integration/auth/auth-config-applied.spec.ts` (DB lane, real GoTrue) | 6 | `/auth/v1/settings`: `disable_signup` true, `mailer_autoconfirm` false, email on, phone and anonymous off; password sign-in `expires_in` 900 and `exp - iat` 900; `signUp` → `signup_disabled`; second recovery within 60 s → 429 `over_email_send_rate_limit` and only one email; password change → code-free "password changed" email; TOTP enrol succeeds. Before the restart GoTrue ran 3600 s tokens, autoconfirm, a 1 s interval, no notification and TOTP off, so 4 of 6 fail |

## Checks (on the SHA in `evidence/03-11a/commit.txt`)

| Check | Result | Evidence |
|---|---|---|
| `npm run typecheck` | exit 0 | `typecheck.txt` |
| `npx eslint .` | 0 errors, 427 warnings | `eslint-summary.json` |
| `npm run inventory` | exit 0 | `inventory.txt` |
| `node scripts/ci/check-auth-config.mjs` | PASS (39 config.toml settings) | `check-auth-config.txt` |
| `scripts/ci/lock-linux-check.sh --fix` | PASS; lock diff adds only `smol-toml` | commit `3c76ccf` |
| Full Vitest lane (`npm run test:db`) | 120 files, 2124 tests, 2124 passed, 0 failed, 0 skipped; report gate PASS (floor 1805); 1 m 58 s, well under the 15-min token lifetime (K-2) | `vitest-full.json`, `vitest-report-gate.txt` |
| `npm run e2e:build && npm run e2e:pr` | 128 expected (incl. 10 KNOWN-BUG expected failures), 0 unexpected, 0 flaky / retried | `playwright-results.json`, `playwright-summary.txt` |

## Deviations and interpretations

1. **"Email signup off on every environment" (A00-1)** is encoded as `[auth] enable_signup = false`
   (`disable_signup = true`). The CLI key `[auth.email] enable_signup` is the **email provider switch**
   (`external_email_enabled`; CLI mapping). Turning it off would disable password sign-in, so it stays `true` and the
   row says why.
2. **Secret-field rule (T-03-10).** The plan says fields whose names contain `secret`, `password`, `smtp_pass` or
   hook secrets are never compared. Read literally, `password` would exclude `security_update_password_require_current_password`
   and `password_min_length`, which the same plan requires to be compared. The rule therefore follows the CLI's own
   secret list (`secret|smtp_pass|auth_token|api_key|access_key`, which covers the hook `secrets`). Password policy
   fields are compared.
3. **Stricter than planned:** any `[auth]` key not governed by a policy row fails, and a governed key missing from
   `config.toml` fails. CLI defaults are not accepted silently. Defaults that matter were made explicit as rows:
   refresh rotation and reuse interval, anonymous sign-ins, password requirements, phone provider, phone MFA, and
   HIBP (hosted only).
4. **`email_sent = 60` is encoded locally but not enforced locally.** The CLI applies it only with custom SMTP, so
   local GoTrue keeps `GOTRUE_RATE_LIMIT_EMAIL_SENT=360000` (`gotrue-env-applied.txt`; comment in `config.toml`). The
   hosted value is drift-checked.
5. **Not encoded (gap against AUTH §4.1, follow-up):** the "email changed" and "MFA factor added/removed" security
   notifications (the plan scoped `password_changed` only; they need their own templates, and MFA has no UI until
   V2-11), and the session time-box / inactivity timeout (Pro only; app-side FT-06 until then).
6. **The hosted checker is wired for `staging` only** (`HOSTED_TARGETS`). The `production` column is used by
   `--print production` until a production drift job exists.
7. **New file not in the plan's list:** `scripts/ci/auth-policy-lib.mjs`, shared by the two scripts.
8. **K-3 did not occur.** The existing auth specs already use one fresh seeded user per code request, so
   `password-auth.spec.ts` and `invite.spec.ts` needed no change.

## For 03-08 (`drift.yml`, Environment `staging-readonly`)

`node scripts/drift/auth-config-hosted.mjs --out <artifact>/auth-config-drift.json` with env
`SUPABASE_ACCESS_TOKEN_STAGING_RO` (secret), `SUPABASE_PROJECT_REF_STAGING` and `STAGING_ORIGIN` (bare https origin,
E0). Exit 0 = no drift, 1 = drift or missing field, 2 = refused or API error. The script prints only mapped,
non-secret fields.

## PO actions (pending)

- **E3:** apply the staging settings from `node scripts/ci/check-auth-config.mjs --print staging` in the dashboard,
  pasting the four template bodies from `supabase/templates/`. Do not use `config push` (R-20).
- **E11:** create a fine-grained token with Auth Config: Read only. **E0:** supply the staging origin.
- **First real run:** if a field is reported MISSING, pin its name from the response (A4) and update the policy row.
