# 03-13c — DB and lint review fixes (V2-03)

Scope: the items `03-13-REVIEW-TRIAGE.md` assigns to 03-13c. Every fix has a regression test that fails on the code
before the fix (outputs in `evidence/03-13c/`). Exploits were replayed on the local stack only (rolled-back
transactions or the run's synthetic tenants, removed by teardown). Synthetic data only.

## Triage ID → commit → test

| Triage ID | Source | Commit | Regression test (fails before → passes after) | Evidence |
|---|---|---|---|---|
| **H-PAY** | B H-1 | `744e668` | `tests/billing/payment-actor-guards.spec.ts` "H-PAY" (3 of 4 fail before: forged `recorded_by` stored; direct insert with `command_id` accepted; RPC replayed another actor's row) | `before-payment-actor-guards.txt` (7 failed), `after-run1.txt` |
| **M-AUDITSYS** | B M-2 | `744e668` | same spec, "M-AUDITSYS" (the reviewer's `actor_type='system'` row and an `api_key`/other-user row are stored as the nurse) | same |
| Low: outbox inside a savepoint | B L-1, IND L-9 | `744e668` | same spec, "Low" (`SAVEPOINT` and plpgsql exception block: `OUTBOX_SUBJECT_INVALID` before) | same |
| **M-PROBE** | A M-2, B M-1, B L-4 | `744e668` | `tests/api/readiness-probe-db.spec.ts` (booleans only, exact-version `schema_current`, anon-only EXECUTE, no `Seq Scan` with seqscan off, `EXPECTED_MIGRATION` = newest file) and `tests/api/health-probes.spec.ts` (body keys, no counts/version, cookie-less client, 503 when the schema is behind) | `before-probe-and-scrub.txt` (6 probe cases failed), `after-run1.txt` |
| **M-SCRUB** (DB half) | C M-2, C L-3/L-4/L-5, B L-3 | `744e668` | `tests/observability/error-sink-scrub-db.spec.ts`: every vector of the shared `tests/fixtures/scrub-vectors.json` (messages, benign, error_name/error_code fields, routes) through `ops_ingest_error` as anon | `before-probe-and-scrub.txt` (46 scrub cases failed) |
| Low: DB ingest truncates after scrubbing | B L-2 | `744e668` | same spec, "cut after the scrub" (498-char `?a ` message stored at 500 instead of a CHECK violation; >2000 refused; hostile inputs bounded) | same |
| **M-LINT** | B M-3, IND L-3 | `dd53153` | `tests/security/p1-34-lint-gates.spec.ts`: fixtures `supabase-client-class.ts`, `gotrue-admin.ts`, `postgrest-client.ts`, `supabase-subpath.ts`, `require-forms.ts`, `computed-secret-key.ts`, `inline-disable.ts`; counters `boundary_directives` and inline-config-off census | `lint-bypass-before-after.txt` (every fixture 0 errors with the HEAD config), `before-lint-and-billing-errmsg.txt` (20 lint cases failed) |
| **M-ALLOWLIST** | B M-4 | `dd53153` | same spec: `factory-import.ts` at `lib/jobs/x.ts` now fails; `tooling-import.ts` at a feature and at a register zone | same |
| Low: `/api/v1` authenticates before the system client | B L-5 | `39695e8` | `tests/api/v1-system-client-order.spec.ts` (switch off → 404, malformed key → 401, `getSystemDb` never called) | `before-v1-system-client-order.txt` (2 failed) |
| M-ERRMSG (the `features/billing/**` share) | C M-3 | `f20c985` | `tests/billing/billing-error-messages.spec.ts` (a PHI-shaped DB error never reaches the result) | `before-lint-and-billing-errmsg.txt` (5 failed) |

## What changed

### Migration `000029_actor_guards_probe_scrub.sql` (expand only)

- `private.payments_actor_guard` (BEFORE INSERT on `payments`): when `current_user` is an API role (`authenticated`,
  `anon`) — a direct PostgREST write or the INVOKER `record_payment` — `recorded_by := auth.uid()`,
  `recorded_by_system := NULL` (no session → `ACTOR_INVALID`), and a non-null `command_id` is refused
  (`COMMAND_ID_RPC_ONLY`) unless `record_payment` marked this payment id in the transaction-local setting
  `clinicos.record_payment_id`. The service role and definer functions are not touched.
- `record_payment`: picks the payment id itself, sets the marker just before the INSERT and clears it after the
  outbox call (the function's own `SET` clauses also restore it at exit); replays a command only when the stored row
  has the same actor (user id or system actor), otherwise `IDEMPOTENCY_MISMATCH`.
- `private.outbox_payment_recorded`: subject check = the marker equals the payment id (was `xmin` = top-level xid,
  which failed in any subtransaction).
- `private.audit_logs_actor_guard` (BEFORE INSERT on `audit_logs`), API-role writers: `actor_type := 'user'`,
  `actor_id := auth.uid()`, `api_key_id := NULL`, `actor_role :=` the caller's membership role in that tenant,
  `metadata - 'system_actor'`.
- `readiness_probe()` dropped; `readiness_probe(p_expected_migration text default null)` returns
  `{db, schema_current, messages_backlog, messages_failed_24h, webhooks_backlog, webhooks_failed_24h}`, all booleans;
  each an `EXISTS` on an index (new partial indexes `idx_comm_queue_failed_updated`,
  `idx_webhook_queue_failed_updated`); EXECUTE for `anon` only.
- `ops.scrub_text` (no API grant): the app's `SCRUB_RULES` (`lib/observability/scrub.ts`, 03-13d) in the same order
  under the same ids, plus NFKC and Indic/Arabic-Indic digit normalisation. `ops_ingest_error` accepts messages up to
  2000 characters, scrubs, then cuts to 500; `error_name` outside the app's name shape or identifier-shaped → `Error`;
  `error_code` outside SQLSTATE / `PGRST…` / upper-snake → NULL; a concrete `route_path` → NULL (same segment rule as
  `routePattern`).

### App

- `app/api/ready/route.ts` + `expected-migration.ts`: calls the probe through `createPublicClient()` (always anon) with
  the build's `EXPECTED_MIGRATION`; ready = DB answered and the schema is current. Body: `status`,
  `checks: {database, schema}`, four boolean outbox flags, `providers`, `correlationId`, `timestamp`. No counts, no
  version.
- `lib/api/auth.ts`: `authenticateApiKey(req, acquireDb)`; the switch and the Bearer format are checked before
  `acquireDb()`; returns `db`. 25 `/api/v1` handlers updated; `SupabaseClient` imported as a type.
- `eslint.config.mjs`: `supabaseValue` pattern (any value import from `@supabase/*`, any subpath) with narrowed
  allowances for the factory (`createClient` only) and the cookie-session modules (`createServerClient` /
  `createBrowserClient` only); require forms; computed / spread / enumerated `serverEnv()` reads and secret-key names
  built from pieces; `clinicos/no-boundary-directive` (inline plugin, no new dependency); `toolingTree` pattern;
  `lib/jobs/**` removed from the factory allow-list (only `lib/jobs/internal/**`).
- `scripts/ci/p1-34-counters.mjs`: census and `boundary_messages` with inline configuration off; new
  `boundary_directives` (boundary messages suppressed by a directive under `npx eslint .`); factory census = any
  Supabase value import except the bare `@supabase/ssr`.
- `features/billing/{service,reports-service}.ts`: every catch returns `clientErrorMessage(err, fallback, event)`; the
  WhatsApp dispatch error is fixed text.

## Deviations and residuals

1. **`schema_current` is an oracle.** Anyone with the publishable key can ask "is migration N applied?" and find the
   live version in about 30 calls. Accepted: no data, no counts; the release SHA is already public on `/api/health`.
   The alternative (a secret-gated detail path) needs the service role or a new secret in the request path.
2. **Rows forged before 000029** (a `command_id` with another actor) cannot be told from RPC rows; the same-actor
   check limits their replay to the stored actor. Local/staging data are synthetic; production is a new instance.
3. **Still open for V2-07 (contract step, accepted in the triage):** overpayment and status changes through direct
   `payments` / `invoices` writes; `recorded_at` remains writable on a direct insert (backdating); a member can still
   write an audit row for an action they did not perform (as themselves). Revoking direct INSERT/UPDATE closes all
   three.
4. **Blanket `/* eslint-disable */`** suppresses the directive rule's own report under `npx eslint .`; the spec and the
   census lint with inline configuration off, where it and the code it hides are reported.
5. **Lint heuristics.** The computed-env rule matches identifiers ending in `env` and `serverEnv()` directly; an alias
   with another name (`const e = serverEnv(); e[k]`) is not caught by syntax. The literal rule catches the reviewers'
   pieces (`"SECRET"`, `"SECRET_KEY"`, `"SUPABASE_"`, …).
6. **`lib/webhooks/**`, `lib/api/**`** stay on the ADR-0005 register (triage), so a factory wrapper there is still
   importable from request paths until V2-04 / P1-37.
7. `DROP FUNCTION readiness_probe()`: an app deploy older than this commit answers 503 on `/api/ready` once 000029 is
   applied (staging applies migrations after the deploy, so the window is the reverse and also 503 until migrate).

## Handoffs (also in `03-WAVE-NOTES.md`)

- **03-13b / orchestrator (wave merge):** `scripts/staging/wait-for-release.mjs` requires `latestMigration` from
  `/api/ready`, which no longer exists. Replace the check with `body.checks.schema === "current"` (the app at the
  verified SHA asks the DB for its own `EXPECTED_MIGRATION`, which `readiness-probe-db.spec.ts` ties to the newest
  file); update `tests/ci/staging-scripts.spec.ts` (`READY` fixture), `docs/runbooks/staging.md` (~line 95) and the
  `staging.yml` header (line 5). Not edited here: those files are 03-13b's.
- **Every later migration:** bump `app/api/ready/expected-migration.ts` in the same commit
  (`tests/api/readiness-probe-db.spec.ts` fails otherwise).
- **V2-04 (04-02):** the factory zone is already narrowed to `lib/jobs/internal/**` (03-04's note "allowed in
  `lib/jobs/**` until 04-02 narrows it" is superseded).
- **close:** add `tests/billing/payment-actor-guards.spec.ts`, `tests/observability/error-sink-scrub-db.spec.ts`,
  `tests/api/v1-system-client-order.spec.ts`, `tests/billing/billing-error-messages.spec.ts` to `REQUIRED_FILES`.
  Highs re-verification (H-PAY) by a fresh reviewer.

## Commits

| Commit | What |
|---|---|
| `744e668` | migration 000029, `types/database.ts`, `/api/ready`, DB specs (H-PAY, M-AUDITSYS, M-PROBE, M-SCRUB DB, Lows) |
| `39695e8` | `/api/v1` switch and key shape before `getSystemDb` (Low) |
| `dd53153` | boundary lint, counters, eight fixtures (M-LINT, M-ALLOWLIST) |
| `f20c985` | billing services return fixed messages (M-ERRMSG share) |
| `25a84b8` | the order spec's synthetic `clq_live_` key built at run time; its two historic fingerprints in `.gitleaksignore` |

## Results (tool output in `evidence/03-13c/`)

| Check | Result | File |
|---|---|---|
| Before the fixes (HEAD code / HEAD config, new tests) | 7 + 52 + 2 + 25 cases fail; 10 lint fixtures give 0 boundary errors | `before-*.txt`, `lint-bypass-before-after.txt` |
| After, targeted (10 files incl. `record-payment-rpc.spec.ts`, `p1-34-lint-gates.spec.ts`) | 359 passed, 1 failed: `api-v1-switch.spec.ts` "the proxy runs for the encoded forms" (03-13a's matcher change `5b70674`, fixed by them in `7dd7811`) | `after-run1.txt` |
| After, billing and every spec importing `features/billing` (13 files) | 155 passed | `after-billing-errmsg.txt` |
| Full Vitest lane at `f20c985` (shared tree, parallel fixers) | 3358 passed, 25 failed, **0 in 03-13c files**: 22 in 03-13d's uncommitted TDD spec `tests/security/no-raw-error-responses.spec.ts`; 1 `no-raw-error-logging.spec.ts` + 2 `system-db.spec.ts` from 03-13d `06fd200` (log `reason` lower-cased, `module` must be a machine word: `getSystemDb`'s `module: "app/api/v1"` is now dropped) | `vitest-full.txt` |
| `npm run e2e:build` + `npm run e2e:pr` | 188 passed, 7 skipped (by design), 0 failed, 0 retried | `e2e-build.txt`, `e2e-pr.txt` |
| `npx eslint .` | 0 errors | `eslint.txt` |
| `npm run typecheck` | app clean; tests: 1 error in 03-13b's uncommitted `tests/ci/migration-immutability.spec.ts` | `typecheck.txt` |
| `npm run inventory` | exit 0 | |
| gitleaks v8.30.1, full history | no leaks found (first scan flagged the synthetic all-zero `clq_live_` key, fixed in `25a84b8`) | `gitleaks.txt` |

Note for 03-13d: `lib/supabase/system.ts` logs `module: REASON_OWNER[reason]` (a path such as `app/api/v1`); under
`06fd200` the field is dropped, so `tests/security/system-db.spec.ts` fails. Either allow a path-shaped module value or
change `REASON_OWNER` to machine words (and the spec).
