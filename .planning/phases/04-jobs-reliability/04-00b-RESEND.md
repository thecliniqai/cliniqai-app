# 04-00b record: Resend email provider (PO decision 2026-11-13: Resend now, SES after go-live)

**Outcome:** done locally, commit `d6777f4` (code, tests, `.env.example`, `environment.txt.example` §B, runbook).
Nothing contacted Resend or any hosted service: every Resend call in the tests goes to a loopback fake through a
transport that accepts only the real Resend URL. No new dependency, no migration, no `--linked`, no `db push`, the
stack was never reset. `supabase/auth-policy.json` is unchanged: no policy field depends on the email provider.

## What changed

| Area | Change |
|---|---|
| Env schema (`lib/env.ts`, R-15) | `EMAIL_PROVIDERS` = `mailpit, ses, resend, disabled`; `REAL_EMAIL_PROVIDERS` = `ses, resend`. New `RESEND_API_KEY` (shape `re_` + 16-200 of `[A-Za-z0-9_-]`; in `SECRET_ENV_NAMES`, so padding is refused). `resend` needs `RESEND_API_KEY`, `EMAIL_FROM`, `SEND_EMAIL_HOOK_SECRET` in **every** tier (like `ses`). Production: `resend` or `ses` (was `ses` only); staging: `resend`, `ses` or `disabled`; `mailpit` stays refused in both. Server only: `NEXT_PUBLIC_RESEND_API_KEY` is refused in every tier, and so is a Resend-shaped value in any `NEXT_PUBLIC_*` name. `ENV_DOCS` entry; `.env.example` regenerated (`--check` clean). |
| Sender (`lib/email/resend.ts`) | Plain `fetch` `POST https://api.resend.com/emails` (constant, no URL override): `Authorization: Bearer`, JSON `{from, to:[one], subject, html, text, tags:[{category}]}`, `Idempotency-Key` from `SendOptions.idempotencyKey` (shape-checked), `AbortController` timeout `RESEND_REQUEST_TIMEOUT_MS` = 3 000 ms (< `HOOK_SEND_BUDGET_MS` 3 500 < GoTrue 5 000), caller signal chained, `redirect: "error"`. Errors: `EmailSendError` `resend_timeout` / `resend_aborted` / `resend_unreachable` / `resend_http_<status>` / `resend_no_id`; Resend's body is never read into an error. The sender never logs. |
| Factory, types | `getEmailSender()` `case "resend"` (`EmailConfigError resend_config` without key or sender); `SendOptions.idempotencyKey`. |
| Hook route | Each provider call carries `idempotencyKeyFor(webhookId, index)` = `auth-email/<sha256 hex of webhook-id>/<n>` (per message: `email_change` sends two). Same-instance retries are still answered from the route's memory; a retry on another instance repeats the key, so Resend sends nothing new. |
| `/api/ready` | `providers.email` = `configured` for `resend` and `ses` (from the schema only; no provider call). |
| Test lane | `RESEND_API_KEY`, `NEXT_PUBLIC_RESEND_API_KEY` forbidden; `api.resend.com` is a hosted marker; `EMAIL_PROVIDER` stays pinned to `disabled`/`mailpit` (specs stub `resend` after the guard). The e2e server stays on Mailpit (comment in `app-env.ts`). The e2e build scan flags a Resend-key-shaped string literal in any bundle (clean over the real build, 1 352 files). |
| Docs | `environment.txt.example` §B: `EMAIL_FROM` is now a plain address (the old `ClinicQ <…>` display-name form is refused by the schema's email check), "(after 04-00b)" markers removed, `NEXT_PUBLIC_RESEND_API_KEY` in the do-not-set list. `docs/runbooks/auth-email.md`: env table, a "Resend (until go-live)" section (request shape, idempotency, timeout, error codes, PO steps, key rotation, move to SES), E8 and rollback wording, local/CI notes. |

## Tests (each fails without the change; before-run below)

| Spec | Proves |
|---|---|
| `tests/auth/resend-sender.spec.ts` (24) | URL `https://api.resend.com/emails`, `POST`, `Bearer`, JSON, `Idempotency-Key`; body has exactly one recipient, html + text, tag; repeated key delivers once; bad key shape refused before any request; default timeout fires at exactly `RESEND_REQUEST_TIMEOUT_MS` (fake timers) and is `< HOOK_SEND_BUDGET_MS`; real-HTTP hang → `resend_timeout` within budget; caller abort → `resend_aborted`; 400/401/403/404/409/422/429/500/502/503 → `resend_http_<n>` with no key, recipient or code in the error; wrong key → 401 mapped; redirect not followed (second server never hit) → `resend_unreachable`; refused connection; 200 without id → `resend_no_id`; factory picks Resend and refuses without the key. |
| `tests/auth/send-email-hook-resend.spec.ts` (6) | Real route, real env parse, real sender, loopback fake Resend: one send per signed recovery; retries on the same and on "another" instance (memory cleared) deliver once with one key; `email_change` two keys, each delivered once; provider 500 → hook 500, retry sends once with the same key; hang → 500 `resend_timeout` in ~3 s (< 3.5 s budget, < 5 s GoTrue); wrong key → `resend_http_401`; no log line carries the key, an address, a code or a token hash. |
| `tests/config/env-schema.spec.ts` (+11) | resend parses in production and staging; missing / blank key refused in both; missing sender / hook secret refused; local tiers need all three; non-Resend values refused, never echoed; `NEXT_PUBLIC_RESEND_API_KEY` refused in production, staging, test and ci; a Resend key in `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` refused; padded key refused; mailpit refused in staging and production; updated production-provider messages. |
| `tests/setup/test-env-guard.spec.ts` (+1), `tests/setup/e2e-app-env.spec.ts` (+1), `tests/api/health-probes.spec.ts` (extended) | Guard forbids the Resend names and `api.resend.com`, refuses `EMAIL_PROVIDER=resend`; build scan flags a key literal and not the provider name/URL; `/api/ready` reports resend `configured`, never calls Resend, never echoes the key, and fails closed to `disabled` without the key. |

## Evidence (tool output, `evidence/04-00b/`)

- `before-vitest.txt`: the 04-00b specs run against the pre-plan code (`d6777f4^`, a throwaway worktree with only the
  spec files copied in): 6 files failed, 14 tests failed, the two new spec files fail at import (no
  `lib/email/resend.ts`). The pre-existing "mailpit refused in staging/production" rule already held (it passes before).
- `after-vitest-full.txt`: full Vitest lane on the working tree (including 04-05a's in-progress files):
  175 files, 3 686 tests passed, 0 failed.
- `e2e-build.txt`: guarded e2e build, output scan clean (1 352 files) with the new Resend-literal rule.
- `e2e-pr.txt`: e2e PR lane (desktop, Pixel 7, iPhone 15): 188 passed, 7 skipped, 0 failed, 0 retried.
- Static: app `tsc` clean; `tsconfig.tests.json` errors only in `tests/ops/**` (04-05a in progress at the time);
  `npx eslint .` 0 errors; `npm run inventory` exit 0; gitleaks 8.30.1 (docker, `--network none`) on `d6777f4` and the
  full history: no leaks. Every key-shaped fixture is assembled at run time (`["re", …].join("_")`).

## Deviations

1. **Key required in every tier, not only staging/production.** `resend` without `RESEND_API_KEY` is refused in
   development/test too, matching `ses` (no silent fallback; `getEmailSender` would otherwise throw at send time).
2. **No URL override env name.** Tests reach the fake through an injected/global transport that accepts only the real
   Resend URL, so no `RESEND_API_BASE_URL` exists for a deployment to misconfigure.
3. **`from` is the plain `EMAIL_FROM` address** (as SES). A display name would need a new env name or a brand decision;
   not added. `environment.txt.example` §B had `ClinicQ <no-reply@…>`, which the schema refuses; corrected.
4. **Extra hardening beyond the brief:** `NEXT_PUBLIC_RESEND_API_KEY` / Resend-shaped public values refused at boot, and
   the e2e build scan rule (the brief's "forbidden in the browser bundle").
5. Wave-1 coordination: my `npm run e2e:build` ran while another agent's Playwright session was open (`.next/` is
   shared); my e2e PR run waited for it to finish.

## For the PO (Vercel `clinicos-staging`, Production scope only)

`RESEND_API_KEY` = Resend key "clinicos-staging", Sending access, domain `auth.thecliniqai.com` (Sensitive);
`EMAIL_FROM=no-reply@auth.thecliniqai.com`; then `EMAIL_PROVIDER=resend` (with `SEND_EMAIL_HOOK_SECRET` set), redeploy.
Never a `NEXT_PUBLIC_` name for the key. Open note (not blocking, unverified from here): the sending region is chosen when
the domain is added in Resend; to our knowledge none is in India, so check the region shown on the domain page. Auth emails carry an address and a one-time code, no PHI; PO-A3 (SES in
Mumbai) applies again after go-live.
