# V2-03 adversarial review — group A: env / config / fail-closed rules, staging workflows and secrets

- Scope: `origin/feature/v2..3f81bfb`; files in the brief (lib/env*.ts, next.config.ts, instrumentation.ts, /api/health,
  /api/ready, migration 000025, env-example.mjs, tests/setup/test-env.ts, ci/staging/drift workflows, vercel.json,
  scripts/staging/**, scripts/seed*, scripts/drift/auth-config-hosted.mjs (surface only), workflow-policy.mjs,
  docs/runbooks/staging.md) against 03-PLAN 03-01, 03-08, 03-12c kit, E2/E4/E10/E11, threat model, R-9/R-19/R-21.
- Reviewer: fresh-context adversarial reviewer. Implementer records were read only after the findings were written
  (none of the findings below is acknowledged there).
- Method: source read at `3f81bfb`; probes run locally (no hosted service contacted, no workflow dispatched):
  `parseEnv` edge-case matrix via tsx, `stagingTargetProblems` URL-trick matrix, `workflow-policy.mjs` on a bypass
  fixture, `EXPLAIN` of the readiness counts on the local stack, Next's instrumentation error path in
  `node_modules/next`, actionlint + zizmor (offline, default and pedantic) via docker, and
  `vitest run tests/config/env-schema.spec.ts tests/ci/staging-scripts.spec.ts tests/ci/workflow-policy.spec.ts`
  (171/171 pass).

**Counts: Critical 0 · High 1 · Medium 6 · Low 9 · Info 6**

---

## High

### H-1 · The secret key is accepted in the browser-inlined `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` slot in staging and production
- **Where:** `lib/env.ts:456-460` (deploy-tier key checks only test "is it a local-stack JWT"), `lib/env.ts:110-111`
  (both keys are free text), `lib/env.ts:542-544` (`publicEnv` getter, inlined by Next into client bundles).
- **Probe (tsx, complete production profile):** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_secret_…` → **PASS**;
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<legacy JWT with role service_role, iss supabase>` → **PASS**;
  `SUPABASE_SECRET_KEY=sb_publishable_…` → **PASS**.
- **Failure scenario:** the PO pastes the two keys from the Supabase dashboard into the wrong Vercel fields (they sit
  next to each other in E4; the old names were also easy to swap). The build succeeds, `next build` inlines the
  secret key into every page's JS, and anyone who opens `/login` can read it and call PostgREST/Auth admin with RLS
  bypassed: every tenant's patient records. `sb_secret_` keys are refused from browser-like requests, but not from
  curl. The e2e build-scan that would catch this (`tests/e2e/support/build-scan.ts`) runs only in the e2e lane, never
  in the Vercel build. This is exactly the class of "fail loudly on a bad hosted config" the schema exists for
  (P1-15, T-03-08), and the check costs two lines.
- **Fix:** in `tierIssues` for every tier: refuse `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` that starts with
  `sb_secret_` or is a JWT whose `role` is not `anon`; refuse `SUPABASE_SECRET_KEY` that starts with
  `sb_publishable_` or is a JWT whose `role` is not `service_role`; in staging/production require the
  `sb_publishable_` / `sb_secret_` prefixes (R-K: new projects issue only these). Add the four cases to
  `env-schema.spec.ts` and one to `env-boot.spec.ts`. Optionally run the build-scan's opaque/`service_role` check on
  `.next/static` as a `postbuild` step so the Vercel build also fails.

## Medium

### M-1 · `target-guard` is bypassed by connection-string query parameters; TLS is not required
- **Where:** `scripts/staging/target-guard.mjs:86-94` (checks `hostname` and `username` only; `search` ignored for
  database URLs), consumers `staging.yml:81,85` (`supabase db push --db-url "$STAGING_DB_URL"`) and
  `scripts/staging/schema-drift.mjs:30` (`supabase db diff --db-url <url>`).
- **Probe:** accepted with no problem:
  `postgres://postgres:pw@db.<ref>.supabase.co:5432/postgres?host=127.0.0.1`,
  `…?host=db.<other-ref>.supabase.co`, `postgres://postgres.<ref>:pw@aws-0-…pooler.supabase.com:5432/postgres?user=postgres.<other-ref>`,
  `…?sslmode=disable`. The Supabase CLI parses `--db-url` with pgx/pgconn, which applies URL query parameters
  (`host`, `port`, `user`, `dbname`, `sslmode`, `options`) on top of the authority, so the connection goes to the
  query-string host/tenant while the guard reports "OK … is the staging project". (The psql path in
  `auth00-recheck.ts:86-97` is safe: it rebuilds `PG*` from the parsed parts and forces `sslmode=require`.)
- **Scenario:** the guard's stated contract ("everything else is refused", runbook §2.3) is false; a copied/edited
  connection string (or a tampered Environment secret) can point `db push` at another project, including the future
  production project, with the guard green in the log. pgx's default `sslmode=prefer` also permits a downgrade.
- **Fix:** refuse any database URL with a non-empty `search` other than an allow-listed `sslmode=require|verify-full`;
  require (or append) `sslmode=require`; better, pass the CLI the URL re-serialised from the validated parts. Add the
  four probe URLs to `staging-scripts.spec.ts`.

### M-2 · `readiness_probe()` is an unauthenticated, unthrottled full-table scan exposed directly on PostgREST, and leaks platform-wide metrics
- **Where:** `supabase/migrations/000025_readiness_probe.sql:34-37,55-56`; `app/api/ready/route.ts:65-107`.
- **Evidence:** the only status index on `communication_queue` is the partial `idx_comm_queue_dispatch … WHERE status
  IN ('pending','processing')`; `EXPLAIN` of the `messages_failed_24h` subquery with `enable_seqscan=off` is still a
  `Seq Scan on communication_queue`. The migration comment "Every count is served by the existing (status,
  next_retry_at) indexes" (line 15) is false for this count. `communication_queue` keeps every sent message forever,
  so the scan grows with lifetime volume.
- **Scenario:** anyone with the public publishable key (in every page) can loop
  `POST https://<ref>.supabase.co/rest/v1/rpc/readiness_probe` — bypassing Vercel and any app-side limit — and make
  the database scan the whole outbox per call (bounded only by anon's statement timeout); `/api/ready` offers the same
  without even the key. The body also gives any stranger cross-tenant operational data (pending/failed message and
  webhook volumes per 24 h, provider on/off, live migration number) — not PHI, but business/attack-surface intel the
  plan's "booleans and counts only" did not weigh against anon exposure.
- **Fix:** add `CREATE INDEX … ON communication_queue (status, updated_at) WHERE status IN ('failed','dead_letter')`
  (new migration); revoke `anon` and have `/api/ready` return `{status, database}` only to anonymous callers, with
  outbox counts/providers/migration only for a `CRON_SECRET` bearer (which `wait-for-release` can send) or call the
  RPC as `authenticated`; consider a short-lived cached result.

### M-3 · `workflow-policy.mjs` fails open; most rules the workflow headers claim it checks are not checked
- **Where:** `scripts/ci/workflow-policy.mjs:75-95` (triggers), `:155` (permissions = presence only), whole file
  (no template-injection, cache, `--ignore-scripts`, `persist-credentials`, job-level `permissions` checks);
  claims in `staging.yml:7-16` and `drift.yml:13-14`.
- **Probe:** this `staging.yml` fixture **passes** (`exit 0`):
  `on: { pull_request: {…}, workflow_dispatch: {} }`, `permissions: write-all`, job-level
  `permissions: {contents: write, id-token: write}`, job-level `env: DB: ${{ secrets.STAGING_DB_URL }}`,
  `setup-node … cache: npm`, `run: echo "${{ github.head_ref }}"`.
- **Scenario:** T-03-09's listed mitigation is "workflow-policy check"; a regression in any of these forms reaches
  `feature/v2` green. The real backstop is the Environment's deployment-branch policy (PO config, not code), so this
  is defence-in-depth failing, not an open hole today.
- **Fix:** parse YAML (the `yaml` package is already in the tree, or reuse zizmor), and fail on: any PR/
  `workflow_run` trigger in any form; `write-all`/any `write` scope in staging/drift workflows (top and job level);
  `${{ inputs.* | github.head_ref | github.event.* }}` inside `run:`; `cache:` / `actions/cache` in jobs with an
  `environment`; `npm ci` without `--ignore-scripts` there; checkout without `persist-credentials: false`. Add
  `zizmor --offline` (clean today, verified) to the `static` job. Add the bypass fixture to `workflow-policy.spec.ts`.

### M-4 · Vercel preview deployments can run any pushed branch with staging secrets, bypassing the Environment approval (R-9)
- **Where:** nothing in code; `docs/runbooks/staging.md:51-59` and E4 rely on "Disable preview deployments" and set
  the env vars without saying which Vercel scope (Production/Preview/Development); `lib/env.ts:293-302` never looks at
  `VERCEL_ENV`/`VERCEL_GIT_COMMIT_REF`; `drift.yml` does not check the Vercel project.
- **Scenario:** if previews stay on, or the variables are added with Vercel's default "all environments" scope and
  previews are later re-enabled, any branch pushed to the repo builds and runs on Vercel with `APP_ENV=staging`,
  `SUPABASE_SECRET_KEY`, SES keys and `SEND_EMAIL_HOOK_SECRET` — un-reviewed code with service-role access, no PO
  approval, no `feature/v2` restriction. That is the T-03-09 threat through a side door.
- **Fix:** runbook/E4: scope every secret to **Production** only and state it; in `tierIssues`, when
  `APP_ENV ∈ {staging, production}` and `VERCEL_ENV` is set, refuse `VERCEL_ENV !== "production"` (this does not
  infer the tier from `VERCEL_ENV`, R-11 is kept; it only refuses a deploy tier on a preview) and, for staging,
  `VERCEL_GIT_COMMIT_REF !== "feature/v2"`.

### M-5 · Seeded staging patients carry possibly-real Indian mobile numbers with no code-level stop before messaging is enabled
- **Where:** `scripts/seed/demo-clinic.ts:31-35` (`+919000000001..3`; the file header itself says they "may belong to
  real subscribers"); the only control is prose (`docs/runbooks/staging.md` §7 "run seed-reset before switching").
- **Scenario:** months later staging gets MSG91 credentials (`MESSAGING_PROVIDER=msg91`); the reminder/dispatch cron
  sends WhatsApp/SMS to real strangers. CLAUDE.md forbids sending real WhatsApp messages from non-production paths.
- **Fix:** make it impossible rather than documented: e.g. in staging refuse to send to any number not on an explicit
  `MESSAGING_TEST_RECIPIENTS` allow-list (env schema requires it when `APP_ENV=staging` and the provider is real), or
  seed numbers that cannot be delivered (invalid prefix such as `+91 1xxxxxxxxx`, if the validators allow), or have
  `seed-staging.ts` refuse when the dispatcher is configured with a real provider.

### M-6 · E11 assumes a Supabase "fine-grained, Auth config: read" access token; there is no stated fallback, and a classic token in a no-reviewer Environment would be account-wide write access
- **Where:** `03-PLAN.md` E11; `docs/runbooks/staging.md:68,123`; `drift.yml:47-52` (`staging-readonly`, no reviewer,
  runs nightly and on dispatch by any writer on `feature/v2`).
- **Scenario:** if the dashboard does not offer the scoped token (unverified assumption, not checked anywhere), the
  natural fallback is a classic personal access token — full Management API rights over every org of the PO's account,
  including the future production project — sitting in an Environment that needs no approval.
- **Fix:** runbook: "if a scoped read-only token is not offered, do not create a classic token; leave the
  `auth-config` job failing and record it"; optionally have `auth-config-hosted.mjs` probe a write-only endpoint's
  permission (e.g. read `/v1/projects` and refuse if more than the staging org is visible) and refuse an over-broad
  token.

## Low

- **L-1 · Whitespace-only values count as present.** `lib/env.ts:267-269` (`present` checks `!== ""` only). Probe:
  `CRON_SECRET` of 32 spaces, `SUPABASE_SECRET_KEY=" "`, `MSG91_AUTH_KEY=" "`, `MSG91_WEBHOOK_SECRET=" "` all PASS in
  production. A trailing-newline/space paste produces a weak or broken secret that boots. Fix: `value.trim() !== ""`
  in `present`/`normalise`, and refuse leading/trailing whitespace on secret-shaped keys.
- **L-2 · Deploy-tier URL checks miss loopback/odd forms.** `lib/env.ts:230-243,453-463`. PASS in production:
  `https://localhost./`, `https://0.0.0.0`, `https://[::ffff:127.0.0.1]`, `https://127.0.0.2`, and a Supabase URL
  with userinfo/path/query (`https://u:p@<ref>.supabase.co/x?y`). Fix: treat all of 127/8, 0.0.0.0, `::ffff:127.*`,
  trailing-dot `localhost.` as loopback; require a bare origin for `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_APP_URL`.
- **L-3 · The CLI's fixed opaque local keys are not recognised as local-stack keys.** `lib/env.ts:254-265` only
  decodes JWTs; `sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH` / `sb_secret_<redacted>` (current
  CLI defaults) PASS in production. Harmless against hosted Auth, but the rule claims "keys not the local demo keys".
  Fix: add the two constants to the deny check.
- **L-4 · The AUTH-00 re-check hands the owner DB URL to a job that only needs catalogue reads.** `staging.yml:139-156`;
  `has_table_privilege('postgres','auth.sessions','DELETE')` works from `clinicos_drift_ro`. Fix: use
  `STAGING_DB_URL_RO` (move the secret or duplicate it into `staging`).
- **L-5 · The dry run gates nothing.** `staging.yml:78-85`: the PO approves the Environment before the job starts, so
  the `--dry-run` output is never seen before `db push --yes`. Fix: a preceding `plan` job in `staging-readonly`
  (dry run with the RO URL needs `select` on `supabase_migrations.schema_migrations`, grant it) and the `migrate` job
  `needs:` it, so the reviewer sees the plan before approving.
- **L-6 · `wait-for-release` false-fails when a newer commit has deployed.** `scripts/staging/wait-for-release.mjs:97`
  requires `release === github.sha`; if a non-migration commit lands on `feature/v2` while the run waits for approval,
  `/api/health` reports the newer SHA forever → timeout. Fix: accept a release that has `github.sha` as an ancestor
  (`git merge-base --is-ancestor` with `fetch-depth: 0`).
- **L-7 · Database URLs on command lines.** `staging.yml:81,85`, `schema-drift.mjs:30,43`: the password is in argv
  (visible in `/proc`) of `npx supabase …`. Low on single-tenant hosted runners; if the CLI supports it, pass it via
  `PG*`/`SUPABASE_DB_URL`-style env instead.
- **L-8 · The test-lane guard does not forbid the staging names or opaque hosted keys.** `tests/setup/test-env.ts:104-153`:
  `STAGING_DB_URL` is caught only via the `.supabase` marker; `STAGING_SECRET_KEY`, `STAGING_SEED_PASSWORD`,
  `STAGING_PUBLISHABLE_KEY` and any `sb_secret_…` value in an unrelated variable are not. Fix: add `STAGING_*` to
  `FORBIDDEN_VARS` and `sb_secret_`/`sb_publishable_` to `HOSTED_MARKERS` (the local stack's own opaque keys are not
  loaded by the lane).
- **L-9 · Runbook overstates the read-only role.** `docs/runbooks/staging.md:42-49`: "Because every transaction is
  read-only, a write attempt by any tool fails" — `default_transaction_read_only` is a session default any role can
  `SET … = off`; the real control is the absence of grants (verified locally: no SECURITY DEFINER function in `public`
  is executable by PUBLIC today). Reword, and add a drift assertion that `clinicos_drift_ro` holds no table/function
  grants beyond `usage`.

## Info (checked, holds)

- **I-1 · Tier resolution fails closed:** `APP_ENV=Production`, `" production"`, unknown values throw; `NODE_ENV=production`
  without `APP_ENV` throws; `development`/`test` under `NODE_ENV=production` throw; `e2e`/`ci` with hosted URLs throw.
  Errors list keys and rules, never values (spot-checked).
- **I-2 · Boot really stops:** Next 16 rethrows a `register()` error ("An error occurred while loading
  instrumentation hook", `node_modules/next/dist/server/lib/router-utils/instrumentation-globals.external.js:141-144`),
  so `next start`/a function cold start refuses to serve; `next.config.ts` stops build/dev/start.
- **I-3 · Workflows:** no `pull_request*`/`workflow_run` on staging/drift; top-level `contents: read`; every job that
  holds a staging secret has `environment` + `github.ref == refs/heads/feature/v2`; secrets are step-scoped; dispatch
  inputs reach shell only through `env` (choice inputs + regex-checked free text in `auth00-recheck.ts:40,62-63`);
  `npm ci --ignore-scripts` with no cache in environment jobs; the Supabase CLI binary comes from the
  `@supabase/cli-linux-x64` optional package (lockfile), so `--ignore-scripts` does not make `npx` fetch an unpinned
  CLI. actionlint: no findings on staging/drift/ci (one SC2016 info in `nightly.yml`); zizmor 1.32 offline: no
  findings (pedantic: one undocumented-permissions note in `nightly.yml`).
- **I-4 · Seed/target binding:** `seed-staging.ts` and `auth00-recheck.ts` bind the API URL to
  `https://<SUPABASE_PROJECT_REF_STAGING>.supabase.co` exactly (trailing dot, userinfo, port, path all refused);
  `seed-local-dev.ts` keeps its loopback guard; reset deletes only the named clinic owned by the demo owner and the
  five fixed `example.test` users. Residual: everything hinges on the one variable `SUPABASE_PROJECT_REF_STAGING`; a
  hard-coded deny-list of the production ref (once it exists) would make a mis-set variable fail.
- **I-5 · `/api/health`** exposes only status, timestamp, uptime, a shape-checked region and commit SHA; no DB/provider
  call. `/api/ready` echoes no error text and validates the RPC shape before echoing (see M-2 for exposure/cost).
- **I-6 · Test quality:** env-schema/boot, staging-scripts and workflow-policy specs exercise real behaviour
  (spawned `next.config.ts`, CLI exit codes, injected fetch) rather than mirroring the implementation, but each gap
  above (H-1 key swap, M-1 query params, M-3 flow-style/permissions, L-1 whitespace, L-2 loopback forms) is untested
  because the tests enumerate the implementer's own cases. Add the probe inputs listed in each finding.
