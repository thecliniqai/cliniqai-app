# 03-09c record: `console.*` sweep to the typed logger (P1-25, BACKEND H1, T-03-03)

**Outcome:** done locally. Repo-wide enforcement (`no-console`) is 03-04, as the plan says.
**Commits:** `f607d32` (lib), `4671fd2` (features + `clientErrorMessage`), `690b3d7` (app server routes/pages + cron
500 body), `3df32f0` (client components), `6b8fad5` (spec), `f140a1d` (distinct AI query event, spec typing),
`f166341` (runtime-built cron token in the spec + `.gitleaksignore` fingerprint for the `6b8fad5` line).
**Evidence:** `evidence/03-09c/`, all tool output:

| Check | Result | File |
|---|---|---|
| Census before (`git grep -nE "console\.(log\|info\|warn\|error\|debug)" -- app components features lib`) | 216 lines, 78 files (app 28, components 24, features 145, lib 19) at `87e6839` | `console-census-before.txt` |
| Census after (same command) | 2 lines, 1 file: `lib/log/client.ts` (doc comment + the dev-only `console.warn` of `reportClientError`, by design, 03-09a) | `console-census-after.txt` |
| Event names vs `EVENT_PATTERN` | 224 distinct, 0 invalid | `event-names.txt` |
| typecheck, eslint, inventory (clean worktree of `f140a1d`) | exit 0; eslint 0 errors, 427 warnings (same count as `87e6839`) | `static-checks.txt` |
| Full Vitest lane (clean worktree of `f140a1d`) | 124 files, 2186 passed, 0 failed, 0 skipped; report gate PASS | `vitest-full.json`, `vitest-report-gate.txt` |
| Full Vitest lane (main checkout at `6b8fad5`) | 121 files, 2129 passed, 0 failed; gate PASS | `vitest-full-main-6b8fad5.json`, `vitest-report-gate-main-6b8fad5.txt` |
| `npm run e2e:build && npm run e2e:pr` (main checkout at `6b8fad5`) | 128 expected, 0 unexpected, 0 flaky/retried | `playwright-results.json`, `playwright-summary.txt` |
| e2e server log | 0 `log.invalid_event` lines; only `messaging.dev.recorded` and `patients.detail_load.failed` (cross-tenant 404 specs) seen | `e2e-server-log-events.txt` |
| gitleaks v8.30.1, full history at `f166341` | no leaks found | `gitleaks.txt` |

`f166341` changes only the spec's cron token (built at runtime) and `.gitleaksignore`; the spec was re-run green there.

## What shipped

- **Server code** (app routes and pages, features, lib): every `console.*` became
  `log.error|warn|info({ event, code: errorTag(err), requestId: await getRequestId(), tenantId })`. `tenantId` is
  `ctx.tenantId` where a `ServiceContext` parameter is in scope (typecheck proved every reference); `requestId` in
  every async request-path function; background webhook/messaging code (cron, `.catch` callbacks) has no request id.
  No error object, `message`, `details`, row value or input reaches a line. Levels kept (warn stays warn).
- **Client components** (19 files, 25 calls): `reportClientError("<domain>.<op>.failed", err)` (dev-only
  `console.warn` with the tag; no-op in production, R-29).
- **`lib/api/envelope.ts`** (03-09a handoff): the 5xx line is `api.v1.failed` with `reason` = envelope code, `status`
  and `requestId` = the correlation id; the raw message and details no longer reach the log.
- **`lib/messaging/dev-logger.ts`**: recipient/template/params go only to the dev-only file;
  stdout gets `messaging.dev.recorded` (`action` sms|whatsapp, `count` 1); a file-write failure is
  `messaging.dev.write_failed`.
- **`clientErrorMessage(err, fallback, logEvent?)`**: the third argument is now a typed event (was a free-text tag
  with spaces and paths, invalid as an event); it logs through `lib/log`. 19 callers renamed.
- **`errorTag`** moved to `lib/errors/error-tag.ts` (dependency-free) so `lib/log` and `lib/errors/client-message.ts`
  import it without a cycle; `client-message.ts` re-exports it.
- **Cron routes** (03-01 handoff, Rule 2): `app/api/cron/{webhooks,dispatch-communications}` no longer return
  `err.message` in the 500 JSON; fixed body plus `jobs.cron_webhooks.failed` / `jobs.cron_dispatch_communications.failed`.
- Event naming: `domain.operation.outcome`, first segment without `_` (03-09a rule). Domains: `ai, api, apikeys,
  appointments, audit, auth, billing, clinics, consultation, dpdp, jobs, labs, messaging, notifications, patients,
  prescriptions, queue, referrals, search, settings, sharing, staff, terminology, visits, waitlist, webhooks`. Query-level
  failures use `<op>_query.failed`; the enclosing catch (or `clientErrorMessage`) uses `<op>.failed`, so a failure that
  is logged twice is two different events. The full list (for 03-SUMMARY, plan step 4) is `event-names.txt`.

## Tests that fail without the change

| Spec | Without the change | File |
|---|---|---|
| `tests/observability/no-raw-error-logging.spec.ts` (new, 5 cases) | spec copied into a detached worktree of `87e6839`: 5/5 fail. createPatient, deleteLabDocument and the envelope fail on the captured output containing the synthetic phone; the PDF route on `console.error` being called; the cron route on the 500 body carrying the error text | `negative-no-raw-error-logging.txt` |

The spec drives createPatient (patients write), deleteLabDocument (labs write), the prescription PDF route, `apiError`
and the cron route into their error branches with a synthetic error (`code` 23505, message with
`Key (phone)=(...)` and a `.test` email). It captures stdout, stderr and all `console.*` calls; the event and `23505`
must be there, the phone (also its 10 digits), the email and the message text must not, and no `console.*` may be called.
Updated specs: `messaging-provider.spec.ts` (one closed-field stdout line, no recipient/template/params),
`provider-selection.spec.ts` (disabled provider writes no `messaging.dev.recorded`), `review2-fixes-db.spec.ts`
(the v1 PATCH 22P02 path logs `api.visit_update.failed` with code `22P02` on stderr, no message text),
`request-id.spec.ts` (stderr spy instead of a console spy).

## Deviations

1. **[Rule 2] Cron 500 body** fixed in this plan (03-01 handoff), not only the log line.
2. **[Rule 3] `errorTag` moved** to `lib/errors/error-tag.ts`: `client-message.ts` must import `lib/log`, which
   re-exported `errorTag` from `client-message.ts` (an import cycle otherwise).
3. **`clientErrorMessage` signature**: third argument typed as an event (the old tags were not valid events).
4. Census at plan time said 214 lines; at `87e6839` it was 216 (03-02 added the `referral_source_clinics` line,
   03-09a's `lib/log/client.ts` adds 2 that stay by design).
5. **gitleaks**: `6b8fad5` committed a synthetic cron token literal flagged as `generic-api-key`; `f166341` builds a
   low-entropy token at runtime and pins the historic line in `.gitleaksignore` (exact fingerprint, value not quoted).

## Residuals (not in scope; for review and backlog)

- **Responses, not logs:** 70 catch blocks in `features/**` and `lib/messaging/**` still return
  `err instanceof Error ? err.message : ...` to the caller (`git grep -nE "error: err instanceof Error \? err\.message"`).
  A thrown PostgREST/Postgres error can carry row values into a server-action response. Pre-existing pattern; the fix
  is `clientErrorMessage` per site (P1-25 covers logs only). Candidate for 03-04's counters or V2-05.
- Client errors are not reported in production until V2-06 (R-29): `reportClientError` is a no-op there.
- `features/visits/service.ts` and others log a query-level line and then return; no double log, but the request id is
  read once per line (`headers()` per error path, negligible).
