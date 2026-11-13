# 03-09b record: error sink + `onRequestError` + scrubber (P1-25, FT-07 sink, C39/PO-12, R-7, R-18)

**Outcome:** done locally. Roadmap acceptance 8 ("a thrown server error appears in the India-resident error sink with
PII scrubbed") is proven on the local Postgres sink by e2e; the staging row export is **pending PO (E9, after E2/E4)**.
Roadmap test "a scrubber test": `tests/observability/scrub.spec.ts`.
**Commits:** `4e270e7` (migration 000028, types, DB spec, local key install, test-lane pins), `3ca1627` (scrubber,
capture, sink, `onRequestError`, diag route, env keys, scripts, runbook, specs).
**Evidence:** tool output only.

| Check | Result | File |
|---|---|---|
| typecheck, eslint (03-04 gates in force), inventory, `.env.example --check` at `3ca1627` | exit 0; eslint 0 errors, 422 warnings; in sync | `evidence/03-09b/static-checks.txt` |
| Full Vitest lane (tree = `3ca1627` before the two-line test-literal amend below) | 133 files, 2490 passed, 0 failed | `evidence/03-09b/vitest-full-tail.txt` |
| `npm run e2e:build && npm run e2e:pr` (same tree) | 130 expected, 0 unexpected, 0 flaky, 0 retried results, 2 skipped (the error-sink spec on pixel-7, by design) | `evidence/03-09b/playwright-results.json`, `playwright-summary.txt` |
| Local `ops.error_events` export of the e2e diag error (`scripts/ops/export-error-events.mjs`, check OK) | 1 row, allowed columns only, no PII pattern | `evidence/error-events-export.json` |
| gitleaks v8.30.1, full history at `3ca1627` | no leaks found | `evidence/03-09b/gitleaks.txt` |

## What shipped

- **Migration `000028_ops_error_events`.** Schema `ops` (no grant to anon/authenticated/service_role, not in
  `[api] schemas`); `ops.error_events` with exactly the planned columns, value-shape CHECKs (route pattern charset has
  no `?`/`=`/`&`/`%`; frames `file:line`; message ≤ 500; frames ≤ 20), unique `(fingerprint, occurred_on)`, RLS on
  with no policy; `ops.error_event_overflow(day, dropped)`. `public.ops_ingest_error(p_ingest_key, p_event)`:
  SECURITY DEFINER, `search_path = ''`, `lock_timeout = 1s`; compares `encode(extensions.digest(key, 'sha256'), 'hex')`
  with vault secret `ops_error_ingest_key_sha256` (missing secret, key < 32 or > 256 chars → `ingest_refused`,
  SQLSTATE 42501); closed key set, types, shapes and a 16 KiB size bound (`invalid_event`, 22023); re-scrubs emails,
  query strings and 6+ digit runs; fingerprint and UTC-day upsert (`count`, `last_seen`, latest request id); new
  fingerprints per day capped by `ops.error_sink_daily_cap()` (500) under a per-day advisory lock, beyond it the
  overflow counter increments. Explicit `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`, then EXECUTE to
  anon/authenticated only. `ops.purge_error_events(interval default '180 days')` (refuses < 1 day; also prunes old
  overflow rows) and `ops.error_events_size()` (rows, bytes, oldest `last_seen`), executable by no API role; scheduling
  is V2-04 (R-27). `types/database.ts` regenerated (`ops_ingest_error` only; `ops` is not an API schema).
- **Scrubber `lib/observability/scrub.ts`.** `scrubMessage`: `Key (…)=(…)` and `Failing row contains (…)` (greedy to
  the line's last `)`), quoted values after a colon, Bearer/Basic credentials, JWTs, emails, query strings, `#k=v`
  fragments, UUIDs, 16+ char mixed tokens, PAN, spaced/0-prefixed mobiles, then `stripPiiFromText` (mobile, Aadhaar,
  ABHA), then 6+ digit runs; whitespace collapsed; input bounded before matching; cut to 500. `scrubFrames`:
  `file:line` relative to the repo, function names and columns dropped, route-group parentheses kept, outside the repo
  only the last two path segments, ≤ 20. `routePattern`: `context.routePath` without `?`/`#`, charset-checked; the
  concrete `request.path` is never read (T-03-14).
- **Capture.** `lib/observability/error-event.ts` builds the closed event (name, SQLSTATE/code, digest, scrubbed message,
  frames, route pattern/type, method, proxy `x-request-id` if a UUID, `APP_ENV`, release). `lib/observability/sink.ts`
  (`server-only`): one `request.error` log line (request id, route pattern, code), then, if `ERROR_INGEST_KEY` is set, a
  plain `fetch` to `${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/ops_ingest_error` with the publishable key, 2 s
  `AbortSignal.timeout`, response body discarded unread; never throws (`observability.sink.refused` with status /
  `observability.sink.failed` with the error tag). No Supabase client factory, no service role (R-7, ADR-0005 D4
  unchanged). `instrumentation.ts` exports `onRequestError` (Node.js runtime only, dynamic import, swallow).
- **Diag route `POST /api/diag/error` (R-18, T-03-15).** `CRON_SECRET` bearer first (SHA-256 digests compared with
  `timingSafeEqual`; unset secret, missing, wrong, lowercase `bearer` or bare secret → 401), then
  `DIAG_ERROR_ROUTE_ENABLED` (off → 404, empty body), then throws `DiagnosticError` (`lib/observability/diag-error.ts`:
  synthetic +91 mobile inside a `Key (phone)=(…)` detail, example.com email, spaced 0-prefixed mobile, share-style
  query token). GET → 405 (Next default). Guard manifest: `app/api/diag/error/route.ts#POST` = `cron-secret`; the guard
  legs pass.
- **Env (R-15 checklist, same commit `3ca1627`).** `ERROR_INGEST_KEY`: ≥ 32 chars in every tier; required in
  production; a `not-real` placeholder refused in staging/production; optional in staging (E9 comes after E4).
  `DIAG_ERROR_ROUTE_ENABLED`: boolean flag, `true` refused in production. `ENV_DOCS` group "Observability";
  `.env.example` regenerated by the script. Test lane (`tests/setup/test-env.ts`, in `4e270e7`):
  `ERROR_INGEST_KEY` unset or `LOCAL_ERROR_INGEST_KEY` (never echoed); `DIAG_ERROR_ROUTE_ENABLED` unset/false for
  Vitest, true allowed for the e2e server (`diagRoute` option). e2e server: local key + route on;
  `E2E_CRON_SECRET` exported from `tests/e2e/support/app-env.ts`.
- **Local key install.** `tests/setup/error-sink-key.ts` (docker exec into the local DB container) creates or corrects
  the vault hash of the local key; called by the Vitest and Playwright global setups after the guard.
- **Scripts.** `scripts/ops/export-error-events.mjs --request-id … --out …` (local stack only, docker exec, no URL
  accepted; runs the check on what it wrote). `scripts/ops/check-error-export.mjs <file>`: non-empty array (or the SQL
  editor's `[{"export": [...]}]` form), exactly the allowed columns, each column's stored shape, and an independent
  PII detector (email, mobile, Aadhaar, ABHA, PAN, 6+ digits, UUID, JWT, long token, credential, query string, quoted
  value, unredacted row detail) over the text columns; failures name row/column/rule, never the value.
- **Runbook** `docs/runbooks/error-sink.md`: E9 steps verbatim with the plan (key → Vercel, `shasum -a 256` → `select
  vault.create_secret('<sha256 hex>', 'ops_error_ingest_key_sha256');`, flag on, curl with `-D -`, export query,
  flag off; verify with the checker), the export SQL (same column list as the tool), operating queries, purge, key
  rotation (`vault.update_secret`), refusal meanings, local lanes, known limits.

## Tests (each fails without the change: the modules, the route, the RPC and the `ops` schema do not exist before it)

- `tests/observability/scrub.spec.ts` (roadmap scrubber test): 25 corpus items (+91, spaced, dashed, 0-prefixed, bare
  and 3-3-4 mobiles; Aadhaar spaced/unspaced; ABHA; PAN; email; `Key (…)=(…)` incl. a name; `Failing row`; quoted
  input; 6+ and 15-digit runs; UUID; JWT; bearer; path token; query string; JSON payload) → none survives and the
  checker passes the output; the checker flags every raw item; benign text kept; one line ≤ 500; frames; route pattern.
- `tests/observability/error-sink-db.spec.ts` (DB lane, 27 cases): wrong/missing/short key and missing vault secret →
  no row; right key → row with the event's fields; same fingerprint twice → one row `count = 2`, latest request id;
  database re-scrub; 10 malformed/oversize inputs refused; cap 0 inside `begin … rollback` → overflow +2, no row;
  existing fingerprint still counted past the cap; shipped cap 500; anon/authenticated/service_role have no `ops`
  usage or table privilege, and `set role anon|authenticated` select/insert fail; PostgREST: `error_events` →
  PGRST205, `ops` schema → PGRST106; function grants; definer + `search_path`; purge and size.
- `tests/observability/on-request-error.spec.ts` (DB lane): `onRequestError` with a `23505` error carrying a mobile,
  email and UUID, on `/r/<token>?phone=…&email=…` with a cookie → exactly one row, message
  `… Key (phone)=([REDACTED]) for [EMAIL] patient [UUID]`, `route_path` `/r/[token]`, no token/phone/email/query/
  cookie/user-agent/absolute path in any column, checker passes; one log line without the message. No key → logged,
  nothing written; failing fetch → `failed`, tag only; wrong key → `refused`, no row; edge runtime → nothing.
- `tests/observability/diag-route.spec.ts`: 401 legs with the flag on and off; 404 + empty body when off/unset;
  throws `DiagnosticError` when on; the synthetic message scrubs clean.
- `tests/config/env-schema.spec.ts` / `env-boot.spec.ts`: production without the key fails (also at boot), short key
  in production/staging/ci, placeholder in staging/production, diag `true` in production, staging `true` allowed,
  non-boolean refused; the e2e server env carries both; no value echoed. `tests/setup/test-env-guard.spec.ts`: the
  two pins. `tests/api/readiness-probe-db.spec.ts`: anon-definer allow-list now includes `ops_ingest_error` (handoff
  from 03-01).
- e2e `tests/e2e/observability/error-sink.spec.ts` (desktop-chrome): `POST /api/diag/error` with the e2e bearer → 500,
  body without synthetic values, `x-request-id` UUID; exactly one row with that id; `export-error-events.mjs` writes and
  checks it; row fields as expected, no synthetic value. Second test: 401 without/with wrong bearer, GET 405.

## Deviations and interpretations (for review C)

1. **Fingerprint computed in SQL** (sha256 of tier, route pattern/type, method, name, code, re-scrubbed message, first 5
   frames), not sent by the app: one definition, cannot be chosen by a caller.
2. **Database re-scrub** of emails, query strings and 6+ digit runs (Rule 2, defence in depth); the app scrubber stays
   the primary.
3. **Cap value 500/day** as a SQL function `ops.error_sink_daily_cap()` (plan gave no number); a change is a migration.
   The spec lowers it inside a rolled-back session so no other test sees it.
4. **`ERROR_INGEST_KEY` required in production, optional in staging** (R-17 fail-closed; staging gets it at E9, after
   E4, so requiring it there would break the first staging boot). PO confirms at the gate (E13).
5. **`lib/observability/diag-error.ts`** (not in the file list): a Next route file may export only route fields.
6. **Extra spec `diag-route.spec.ts`** and helper `psqlSession` in `tests/helpers/sql.ts`.
7. **e2e spec on desktop-chrome only**, writing its export to the test output dir. A row holds the latest request id of
   its fingerprint per day, so a second device in parallel would move it; and a spec writing into the tracked evidence
   path on every run would dirty the tree. The committed `evidence/error-events-export.json` was produced by the tool
   from the e2e run's request id (phase close re-runs it).
8. **`tenant_id` / `user_id` are always null** for now: `onRequestError` gets no session and an auth call inside the
   error path would add latency and a failure mode. Columns exist as planned.
9. **Rule 1 (gitleaks):** two synthetic literals in the first version of `3ca1627` (a share-shaped token next to the
   word "token", and a synthetic JWT in the corpus) were flagged; both are now assembled at runtime and the unpushed
   commit was amended (no `.gitleaksignore` entry). Those two specs were re-run green after the amend.

## Residuals and follow-ups

- **Next.js still prints every uncaught server error to stderr** (`⨯ Error [Name]: <raw message>` + stack), seen in the
  e2e server log for the diag error. On Vercel that is the function log, outside this sink and not scrubbed: a real
  `Key (phone)=(…)` would reach it. Pre-existing (v1). Options for review C / PO: filter `console.error` for Next's
  error print in `register()`, or treat Vercel logs as PHI-bearing (retention, access, region). Not changed here
  (not in the plan; changes platform logging behaviour).
- Pattern scrubbing cannot recognise names or addresses in free text; mitigated by storing only the error's own
  message after removing row details and quoted input values.
- The ingest key travels in the RPC body to PostgREST over TLS; Postgres logs no parameters on error by default
  (`log_parameter_max_length_on_error = 0`). Worth a look in the staging API logs at E9.
- V2-04: schedule `ops.purge_error_events()` and alert on `ops.error_event_overflow` / `ops.error_events_size()`.
  If `tenant_id`/`user_id` are populated later, DPDP erasure must cover `ops.error_events` (no FK by design).
- Client errors remain uncaptured until V2-06 (R-29).
