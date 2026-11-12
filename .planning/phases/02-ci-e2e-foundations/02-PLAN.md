---
phase: 02
roadmap_id: V2-02
name: CI & e2e foundations
gate: G3-partial
requirements: [P0-11, P0-13, P1-27, P1-41, PWA-08a, AI-06-L1]
plans: [02-01, 02-04, 02-05, 02-02, 02-03a, 02-03b]
source: docs/v2/V2_MASTER_ROADMAP.md §12.2 (V2-02); docs/v2/TEST_STRATEGY.md §6-§9; docs/v2/SECURITY_VERIFICATION_PLAN.md §5-§6; docs/v2/FRONTEND_MIGRATION_PLAN.md M0; docs/v2/PWA_STRATEGY.md §9.1; docs/v2/AI_STRATEGY.md §5.3, §7, §8
research: 02-RESEARCH.md
base_commit: 2695964 (stacked on v2/phase-01-security-containment, PR #3)
---

# Phase 02 (V2-02): CI & e2e foundations — plan

**Objective (roadmap):** automated, CI-produced evidence for everything after this point.

**Acceptance (roadmap, verbatim):** the PR lane is green with 0 skipped in the DB lane; adding an unguarded server
action makes the guard test fail; the M0 baseline report is committed.
**Tests (roadmap):** the pipeline runs the full unit + DB lane; a deliberately unguarded fixture action proves the
guard test fails; the 6 characterisation flows on v1 screens.
**Evidence (roadmap):** CI run links; the M0 baseline appendix (screenshots, axe reports, interaction counts).

**Invariant for the whole phase:** no application behaviour changes. Allowed non-test changes: `package.json`
scripts/devDependencies, `eslint.config.mjs` ignores, `.gitignore`, `.nvmrc`, `.github/**`, `scripts/**` (tooling),
`tsconfig.tests.json`, `vitest.config.ts`, `playwright.config.ts`, `docs/v2/m0-baseline/**` and the FMP appendix
table, and the a11y fixes on the three V2-01 auth pages (RL-17). Anything else stops and is raised.

## Execution order

| Order | Plan | Size | Depends on | Why this order |
|---|---|---|---|---|
| 1 | **02-01** CI pipeline, audit gate, gitleaks, inventory (F14), AI-06 L1 greps, CODEOWNERS, lint ignores | M | — | Every later plan lands on a PR that CI checks |
| 2 | **02-04** test type-checking + quality clean-up | S-M | 02-01 | New tests in 02-02/02-03 are type-checked from their first commit |
| 3 | **02-05** coverage reporting (report-only) | S | 02-01 | Small; same `test` job |
| 4 | **02-02** P0-13 guard enumeration + canary | M | 02-01, 02-04 | Needs the inventory extension and the typed test seam |
| 5 | **02-03a** Playwright scaffold: safe server, network blocks, seeds (R7), device projects, smoke, R8 | M | 02-01, 02-04 | The flows need the harness |
| 6 | **02-03b** 6 characterisation flows + journeys 1/8/9 + M0 baseline report | M | 02-03a | Largest UI work last |
| 7 | **Orchestrator: GitHub settings** (RL-3…RL-8) | — | green PR run | Required checks only after their names exist and pass |

Each plan ends with one commit series on `v2/phase-02-ci-e2e-foundations` and an independent-review pass at phase
end (CLAUDE.md DoD 6; CI/security tooling gets the adversarial second review because it is the security gate).

## Orchestrator-only steps (implementer agents cannot run these)

Implementer agents must not run `npx vitest`, `npm test*`, `npx playwright*`, push, or change GitHub settings. They
end a turn that needs a run with **`READY FOR TESTS: <exact command(s)>`**; the orchestrator runs it and returns
the output. Steps marked **[ORCH]** below:
- every Vitest / Playwright run (local stack), including the canary and baseline captures;
- `git push`, opening/retargeting the PR (target `v2/phase-01-security-containment` until PR #3 merges, then
  `feature/v2`), reading CI results (`gh run view`), downloading artifacts;
- all GitHub settings changes (§"02-01 step 9"), applied only after the workflow is green on the PR;
- committing the M0 baseline outputs produced by a run (they are tool output, not agent-typed).
Commands that are fine for implementers: `npx tsc`, `npx eslint`, `node scripts/...` that do not start the app or a
test runner, `npm ls`, `git` (no push), `docker run` of the pinned gitleaks image/binary for a local scan.

---

## 02-01 CI pipeline + branch protection + CODEOWNERS (P0-11, F14, AI-06 L1) · M

### Files
- `.nvmrc` (`24`), `package.json` (`engines.node: ">=24 <25"`; scripts below; devDependency `tsx` exact version).
- `.github/workflows/ci.yml` (PR + push lane), `.github/workflows/nightly.yml` (schedule + `workflow_dispatch`).
- `.github/CODEOWNERS`, `.github/audit-allowlist.json`, `.gitleaks.toml`.
- `scripts/ci/audit-gate.mjs`, `scripts/ci/assert-vitest-report.mjs`, `scripts/ci/ai-l1-greps.mjs`,
  `scripts/ci/ai-l1-allowlist.json`, `scripts/ci/assert-no-env-files.mjs`, `scripts/ci/install-gitleaks.sh`.
- `scripts/phase-evidence.mjs` (use local `tsx`; add `--ci-run <id>` that writes `ci-run.json` from `gh run view
  --json` — run by the orchestrator).
- `eslint.config.mjs` (ignores), `tests/ci/*.spec.ts` (checker tests), `lint-fixtures/ai-l1/**`,
  `lint-fixtures/audit/**` (fixtures for the checkers).

### Steps
1. **Tooling pins.** Add `tsx` as an exact devDependency (reason: the inventory, evidence and seed scripts run
   through `npx tsx`, which today downloads an unpinned package on every run). `package.json` scripts:
   `lint: "eslint ."` (replaces deprecated `next lint`), `typecheck` unchanged here (02-04 extends it),
   `inventory: "tsx scripts/inventory-server-actions.ts"`, `ci:ai-l1`, `ci:audit`. `phase-evidence.mjs` calls
   `npx tsx` → `node_modules/.bin/tsx`.
2. **ESLint ignores** (tooling dirs): add `docs/**` (vendored `docs/temp` template; docs hold no app code),
   `coverage/**`, `playwright-report/**`, `test-results/**`, `blob-report/**`, `playwright/.auth/**`, `.agents/**`,
   `.opencode/**`, `.gsd/**`, `supabase/.temp/**`. Gate = `npx eslint .` exit 0 (errors); warnings reported.
3. **`ci.yml`** — `on: pull_request` (all bases, so stacked PRs run), `push: branches [feature/v2]`,
   `workflow_dispatch`. Top-level `permissions: contents: read`; `concurrency: ci-${{ github.ref }}` with
   cancel-in-progress; `env: NEXT_TELEMETRY_DISABLED: 1`, `CI: true`. Runner `ubuntu-24.04`. Every `uses:` pinned to
   a full SHA with the tag in a comment (SHAs in 02-RESEARCH §2). `actions/setup-node` with `node-version-file:
   .nvmrc`, `cache: npm`; `npm ci`. Jobs (names are the required-check names, keep them stable):
   - **`static`** (~3 min): `scripts/ci/assert-no-env-files.mjs` (only `.env.example` and the committed test
     defaults file are tracked; no other `.env*` exists in the workspace), `npm run typecheck`, `npm run lint`,
     `npm run inventory -- --out inventory.json` (exit 1 on any flag; F14), `npm run ci:ai-l1`, upload
     `inventory.json` artifact.
   - **`security`** (~2 min): `fetch-depth: 0`; `npm run ci:audit`; `npm audit signatures`; gitleaks (step 6).
   - **`test`** (~8 min): `npx supabase start -x studio,edge-runtime,logflare,vector,imgproxy,supavisor` (same
     exclusions as `npm run test:db`; CLI version comes from the lockfile, 2.120.0; images not cached — pulls are
     faster than `docker save/load` round trips); `npx vitest run --reporter=dot --reporter=json
     --outputFile=vitest-report.json` (02-05 adds coverage flags); `node scripts/ci/assert-vitest-report.mjs
     vitest-report.json` (fails on any failed file/test, **any skipped or todo test**, or a total below the previous
     floor recorded in the script: 1,100); upload the report; `npx supabase stop --no-backup` in `if: always()`.
     No repository secrets: the stack issues the `supabase-demo` keys; `.env.test` supplies loopback URLs.
   - **`build`** (~4 min): `next build` with `NODE_ENV=production`, `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`,
     a placeholder anon key, `MESSAGING_PROVIDER=dev`, no other env; cache `.next/cache` keyed on lockfile + source
     hash.
   - **`e2e`** is added by 02-03a (same file).
   Target wall time < 15 min (TEST_STRATEGY §8); jobs run in parallel.
4. **Audit gate** `scripts/ci/audit-gate.mjs` (no new dependency): runs `npm audit --omit=dev --json`; fails on any
   **high/critical** advisory not in `.github/audit-allowlist.json`; fails on an allowlist entry that is expired or
   no longer matches anything (stale waivers must be removed). Entry shape: `{ "id": "GHSA-…", "package": "…",
   "severity": "high", "reason": "…", "owner": "V2-12 P1-19", "ruling": "F20 | P1-19", "expires": "YYYY-MM-DD" }`.
   Seed it from the current output (implementer runs `npm audit --omit=dev --json` locally): postcss-in-next (F20,
   owner V2-03 plan 03-06 / V2-14), AI SDK chain + jsondiffpatch + zod 3 (P1-19, owner V2-12). Expiry **90 days**
   (2027-02-10); renewal is a reviewed PR with a fresh reason. Nightly runs the full `npm audit` (dev included)
   report-only.
5. **AI-06 L1 greps** `scripts/ci/ai-l1-greps.mjs` over `git ls-files` (no ripgrep dependency), allowlist
   `scripts/ci/ai-l1-allowlist.json` (`file`, `rule`, `reason`, `owner`, `expires`), rules:
   - **L1-R1 routes:** no tracked file under `app/api/ai/**`; no `route.ts`/`page.tsx` whose path contains
     `copilot`.
   - **L1-R2 removed AI surfaces:** no `MockAiProvider`, `CopilotDrawer`, `operations-copilot`, `clinical-copilot`,
     `parseShorthandLocally` identifiers in `app/ features/ lib/ components/`.
   - **L1-R3 test branches in AI code:** no `VITEST`, `test-api-key`, `AI_EVAL_LIVE` in `lib/ai/**` and
     `features/ai/**` (whole `lib/` moves to V2-03 with P2-03, RL-12).
   - **L1-R4 AI glyph:** `<Sparkles` JSX or `✦` only in LLM-feature files: `components/consultation/ai-scribe-modal.tsx`,
     `components/consultation/returning-patient-catchup.tsx`. Time-boxed exception: `components/auth/clinic-showcase-panel.tsx`
     (owner V2-06 AI-02; AI-01 residual).
   - **L1-R5 "AI" in UI copy:** the word `AI` (word boundary, case-sensitive) in JSX text or string literals of
     `.tsx` files under `app/ components/ features/` only in the LLM-feature files above plus `features/ai/**`.
     Time-boxed exceptions: the three developer-settings API-key files (owner V2-06 AI-02 / V2-11).
   - **L1-R6 "AI" with a price or purchase action** (PO-21): `AI` within 80 characters of `₹`, `Rs`, `INR`,
     `/month`, `per month`, `Buy`, `Upgrade`, `Subscribe`, `Add to plan`. **No exceptions.**
   Blocking in the `static` job. `tests/ci/ai-l1-greps.spec.ts` runs the checker on `lint-fixtures/ai-l1/*` and
   asserts each rule fires on its fixture and stays silent on an allowed fixture (outcome of the checker, RL-11).
6. **gitleaks** `scripts/ci/install-gitleaks.sh`: download `gitleaks_8.30.1_linux_x64.tar.gz` and the checksums
   file from the v8.30.1 release, verify SHA-256, run `gitleaks git --redact --no-banner --config .gitleaks.toml
   --report-format sarif --report-path gitleaks.sarif` over the **full history** (repo is small; full scan each PR).
   `.gitleaks.toml`: `[extend] useDefault = true`; custom rules `clq_live_[a-f0-9]{48}`, `whsec_[a-f0-9]{48}`,
   `sbp_[a-f0-9]{40}`, MSG91 auth-key pattern; allowlist only the fake `clq_live_` literal in
   `tests/api/v1-auth.spec.ts` (SEC-28) by path + regex, nothing broader. Upload SARIF as an artifact (code-scanning
   upload needs `security-events: write`; not needed now).
7. **`nightly.yml`** — `schedule: cron "30 20 * * *"` (02:00 IST), `workflow_dispatch` with an input
   `lane: nightly|m0-baseline`. Jobs: full device matrix e2e (02-03a), full `npm audit` report, and on failure
   `gh issue create`/comment on one open "Nightly failing" issue (job permission `issues: write` only on that job).
8. **CODEOWNERS** `.github/CODEOWNERS`: `* @skarkhanis95` plus explicit lines (documentation of sensitive paths):
   `/supabase/migrations/`, `/lib/permissions/`, `/lib/auth/`, `/lib/supabase/`, `/middleware.ts`,
   `/eslint.config.mjs`, `/.github/`, `/tests/setup/`, `/tests/security/`, `/scripts/ci/`, `/docs/adr/`. Code-owner
   review is **not** required (RL-5).
9. **[ORCH] GitHub settings**, after `ci.yml` is green on the PR (record each call's JSON response under
   `evidence/github-settings/`):
   - a. Change the default branch to `feature/v2` (RL-3).
   - b. New ruleset **`feature-v2-ci`** on `refs/heads/feature/v2` only, no bypass actors: `required_status_checks`
     (`static`, `security`, `test`, `build`, `e2e`; `strict_required_status_checks_policy: true`), `pull_request`
     (`required_approving_review_count: 0`, `allowed_merge_methods: ["merge"]`, `require_code_owner_review: false`),
     `deletion`, `non_fast_forward`. **`v2rules` is left unchanged** (it keeps protecting `main` and
     `feature/v2`) (RL-4).
   - c. Enable secret scanning + push protection (free on public repos).
   - d. Actions policy `sha_pinning_required: true` (all third-party actions must be SHA-pinned).
   - e. Leave Dependabot to P1-19 (V2-12); leave visibility to the PO (RL-6b).

### Acceptance
- `ci.yml` runs on the PR; `static`, `security`, `test`, `build` green; `test` shows 0 skipped from the runner's JSON.
- The inventory runs in CI and fails the job on a flag (F14) — proven by `tests/ci/` running the tool against a
  fixture module with an override param (exit 1).
- Audit gate: red on a non-allowlisted high (fixture JSON in `lint-fixtures/audit/`), red on an expired entry, red on
  a stale entry, green on the current tree.
- gitleaks green on full history with only the SEC-28 allowlist entry.
- AI-L1: each rule fires on its fixture; current tree green with the listed time-boxed exceptions only.
- Ruleset `feature-v2-ci` active with the five checks; `main` protections unchanged (diff of `gh api` output before
  and after); default branch `feature/v2`; nightly fires once on schedule (run link).
### Tests
`tests/ci/audit-gate.spec.ts`, `tests/ci/ai-l1-greps.spec.ts`, `tests/ci/inventory-gate.spec.ts`,
`tests/ci/vitest-report-gate.spec.ts` (skipped > 0 → exit 1). These assert the checkers' exit codes and messages on
fixtures (no network: the audit gate reads a fixture JSON via an injectable reader).
### Evidence
CI run link + SHA (`scripts/phase-evidence.mjs --ci-run`), `inventory.json` and `gitleaks.sarif` artifacts,
`evidence/github-settings/*.json`.

---

## 02-04 Test type-checking and quality clean-up (P1-27 part, E-5, E-7, T-11, T-12) · S-M

### Files
- `tsconfig.tests.json` (extends `tsconfig.json`; `include`: `tests/**/*.ts`, `vitest.config.ts`,
  `playwright.config.ts`, `scripts/**/*.ts`; `compilerOptions.types`: `["node", "vitest/globals", "vite/client"]`;
  `incremental: false`).
- `package.json`: `typecheck: "tsc --noEmit && tsc --noEmit -p tsconfig.tests.json"`.
- `tests/helpers/db.ts` (new `TestDb` type seam), `tests/helpers/supabase-admin.ts`, `tests/helpers/tenants.ts`,
  `tests/helpers/fixtures.ts` (typed input builders), the ~35 spec files with errors (02-RESEARCH §7).
- Deleted: `tests/cabin/navigation-roles.spec.ts`, `tests/queue/status-actions.spec.ts`,
  `tests/ops/backup-restore.spec.ts`.
- Rewritten: `tests/patients/visit-history.spec.ts`, `tests/visits/clinic-visits-register.spec.ts` (mock
  "isolation" cases → DB).
- `scripts/ci/assert-no-doc-grep-tests.mjs` (+ `static` job step).

### Steps
1. Separate `tsconfig.tests.json` rather than removing the exclusion (RL-13).
2. `TestDb = SupabaseClient<any, "public", any>` used by `getAdminClient()` and `SeededTenant.client`; header comment
   names V2-03 plan 03-03 (generated types) as the owner that switches it back to `Database`. This removes the ~300
   `never` errors without touching `lib/db/types.ts`.
3. Fix the remaining ~45 errors properly: narrow result unions on their discriminant instead of reading
   `.error` blindly; build consultation/vitals inputs with typed builders (exposes the `specialty`/`recorded_by`
   drift — the builders send what the current schema accepts; if a test relied on a forbidden field such as
   `recorded_by`, keep the assertion that the server ignores it by passing it through an explicit
   `as unknown as` cast with a comment, so the security intent stays). No `@ts-ignore`/`@ts-expect-error` without a
   one-line reason.
4. Deletions and rewrites per 02-RESEARCH §8 (only where TEST_STRATEGY T-12 / E-5 say so). Rewrites seed two
   tenants on the local stack and assert A's caller never receives B's rows, plus the original ordering/summary
   assertions; keep `computeDateRange` units and the zero-visits case. `v1-performance.spec.ts` stays.
5. `assert-no-doc-grep-tests.mjs`: fails when a file under `tests/` reads a path under `docs/` (TEST_STRATEGY §9.6);
   allowlist empty.
### Acceptance
`npm run typecheck` (both projects) exit 0 in CI; no `tests` exclusion gap (a deliberately mistyped line in a
spec fails `static` — shown once in the PR by a fixup commit or in `tests/ci/` via a probe config); the three
deleted files and two rewrites listed in the summary with the T-12 citation; total test count drops only by the
deleted tautological/doc-grep cases (the report gate floor is updated in the same commit, with the arithmetic).
### Tests
The existing suite + rewritten DB cases **[ORCH]**; the doc-grep checker test in `tests/ci/`.
### Evidence
CI `static` log (typecheck of both configs), `test` JSON report before/after counts.

---

## 02-05 Coverage reporting, report-only (P1-41 V2-02 part) · S

### Files
`package.json` (devDependency `@vitest/coverage-v8` = **3.2.7**, exact match to Vitest), `vitest.config.ts`
(`test.coverage`: `provider: "v8"`, `enabled: false`, `include: ["app/**", "features/**", "lib/**"]`,
`exclude: ["**/*.d.ts", "lib/db/types.ts"]`, `reporter: ["text-summary", "json-summary", "html"]`,
`reportsDirectory: "coverage"`, **no thresholds**), `scripts/ci/coverage-summary.mjs`, `ci.yml` `test` job.
### Steps
1. `test` job runs Vitest with `--coverage.enabled` (one run, no second suite execution).
2. `coverage-summary.mjs` writes to `$GITHUB_STEP_SUMMARY`: totals plus a table for the TEST_STRATEGY §9.5 domain
   modules (billing, scheduling/appointments, queue, prescriptions, permissions — directory globs listed in the
   script) against the G2 targets (80% lines / 70% branches) marked "report only until V2-14".
3. Upload `coverage/` (html + json-summary) as an artifact (14-day retention).
### Acceptance
CI step summary shows the coverage table; the job never fails on coverage; artifact present.
### Evidence
CI run link + the `coverage-summary.json` artifact copied into `evidence/` by the orchestrator.

---

## 02-02 Guard enumeration test (P0-13, T-05) · M

### Definition of "guarded" (per entry point)
- **Server action** (every function export of every `"use server"` module, from the inventory):
  1. *Authenticated:* no session → auth failure, nothing read or written (existing sweep, kept unchanged).
  2. *Permission:* for an action whose guard names permission P, **every** role lacking P (from
     `ROLE_PERMISSIONS`) gets `PermissionDeniedError`/`{ success:false, reason:"forbidden" }` (or the action's
     documented failure shape), and no tenant-table row count changes.
  3. *Tenant from session:* the least-privileged role holding P in tenant A, called with tenant B's ids in every
     id-shaped parameter and forged acting fields, leaves every tenant-B row unchanged (B-scoped count + hash of B
     rows) and returns nothing containing a B id or B name.
  4. *Membership-only actions* (`resolveServiceContext()` with no permission, 11 today; F4): explicitly listed with a
     reason; legs 1 and 3 apply plus "a signed-in user with no membership is rejected".
- **Route handler** (every exported HTTP method of every `app/**/route.ts`), by category in the manifest:
  - `session(P)`: no session → 401 (or 404) with no body data; lacking-role → 403/404; legs 3 as above.
  - `public-token`: random/expired/wrong-type token → 404, body has no ids (P0-04 rules); no session needed by design.
  - `webhook-secret`: missing/wrong `x-webhook-secret` → 401, unknown provider → 404, no DB write (P0-03).
  - `cron-secret`: `CRON_SECRET` unset → 401; wrong bearer → 401.
  - `api-v1-disabled`: with `API_V1_ENABLED` unset every method → 404 at the handler (switch re-checked, AR2-H2); with
    the switch on (`enableApiV1ForFile`) and no key → 401.
  - `public-health`: allow-listed; response JSON keys equal the committed allowlist (no tenant data).

### Files
- `scripts/inventory-server-actions.ts`: `buildInventory({ scanDirs?, extraDirs? })` (default unchanged); new
  output `routeHandlers: [{ file, methods }]`; per action `guard: { call, permission } | null` extracted from the
  first `requireServiceContext`/`resolveServiceContext`/`requirePermission` call in the export body (or
  `delegated:<name>` when the body calls a local helper that does it).
- `tests/security/guard-manifest.ts` — `ACTION_GUARDS: Record<"file#export", Permission | { member: string }>` and
  `ROUTE_GUARDS: Record<"file#METHOD", RouteGuard>`; CODEOWNERS-listed.
- `tests/security/guard/engine.ts` — case generation + the leg checks as plain functions returning violations.
- `tests/security/guard-actions.spec.ts`, `tests/security/guard-routes.spec.ts` (new, per roadmap naming).
- `tests/security/guard-canary.spec.ts` + `lint-fixtures/p0-13/unguarded-action.ts` (`"use server"`, reads
  `patients` through `createClient()` without a guard and returns rows) and `lint-fixtures/p0-13/unguarded-route.ts`
  (GET returns 200 with data).
- `tests/security/guard-traceability.md` is **not** created; the P0-01…P0-05 → spec mapping goes in the phase
  summary.

### Steps
1. Extend the inventory (backwards compatible; `p0-01-action-sweep.spec.ts` keeps passing unchanged).
2. Manifest completeness test: manifest keys == inventory keys exactly (a new action/route without an entry fails
   with its name); static `guard.permission` == manifest permission (drift either way fails).
3. Dynamic legs per the definition above, sharing one seeded world (tenants A and B; owner, admin, doctor, nurse,
   receptionist in A; owner + patient/visit/invoice/document rows in B; one user with no membership).
   `@/lib/supabase/server` `createClient` is mocked to return the role's real JWT client (same pattern as
   `pdf-route-guards.spec.ts`), so `auth.getUser()` and RLS are real. Row-count snapshots per batch, not per case.
4. Canary: `guard-canary.spec.ts` builds the inventory with `extraDirs: ["lint-fixtures/p0-13"]` and asserts
   (a) completeness check reports the fixture action and route as missing, (b) with a temporary manifest entry
   claiming `clinic:manage`, the engine reports a permission violation for the receptionist and a data-returned
   violation for the unauthenticated leg, (c) the route engine reports 200-without-session.
5. **CI canary step** (in `test`, after the main run): copy `lint-fixtures/p0-13/unguarded-action.ts` to
   `features/__guard_canary__/actions.ts`, run `npx vitest run tests/security/guard-actions.spec.ts`, assert exit ≠ 0
   and output names `features/__guard_canary__/actions.ts`, delete the copy. This is the roadmap acceptance
   "adding an unguarded server action makes the guard test fail", re-proven on every PR.
6. Do **not** fold this into `p0-01-action-sweep.spec.ts`: that spec is V2-01 evidence and stays as the
   unauthenticated leg; the new specs add the authenticated, cross-tenant and route legs (RL-10).
### Acceptance
Every inventoried action and route is in the manifest and passes its legs; the canary spec passes; the CI canary
step shows the unguarded action failing the guard spec; the P0-01…P0-05 regression specs are mapped in the summary.
### Tests
`guard-actions.spec.ts`, `guard-routes.spec.ts`, `guard-canary.spec.ts` + inventory unit tests **[ORCH]**.
### Evidence
CI run link; canary step log; `inventory.json` artifact (routes + guard fields).

---

## 02-03a Playwright scaffold: safe server, network blocks, seeds, device projects, R8 (PWA-08a, R7, R8) · M

### Safe app server (RL-16)
- `tests/e2e/support/app-env.ts`: `buildAppServerEnv()` returns a **new** env object (does not spread
  `process.env`) containing only: `PATH`, `HOME`, `TMPDIR`, `LANG`, `CI`; `NODE_ENV=production`;
  `__NEXT_PROCESSED_ENV=true` (stops `@next/env` assigning anything from `.env*`; 02-RESEARCH §3);
  `NEXT_TELEMETRY_DISABLED=1`; `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_URL` `http://127.0.0.1:54321`; local-stack
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` from `loadLocalStackKeys`; `NEXT_PUBLIC_APP_URL=
  http://127.0.0.1:3100`; `MESSAGING_PROVIDER=dev`, `MSG91_AUTH_KEY=x`, `AI_ENABLED=false`, `AI_PROVIDER=mock`,
  `STORAGE_PROVIDER=supabase`, `API_V1_ENABLED=false`, `CRON_SECRET=e2e-not-real`; `NODE_OPTIONS=--require
  ./tests/e2e/support/server-net-guard.cjs`.
- `tests/setup/test-env.ts`: export `findTestEnvProblems(env, { allowNodeEnv })`; add `AI_ENABLED: ["false","0"]`
  to `PINNED_IF_SET` (both lanes). `assertLocalAppServerEnv(env)` = the same rules with `NODE_ENV=production`
  allowed.
- `tests/e2e/support/server-net-guard.cjs`: the socket/DNS block from `worker-guard.ts` (factor `isLoopbackHost`
  into a shared CJS module) for the Next server process — server-side calls to anything but loopback fail.
- `tests/e2e/support/build.mjs` (`npm run e2e:build`): asserts the env, runs `next build` with it, then scans
  `.next/static/**` and `.next/server/**` for the hosted markers from `test-env.ts` and fails on any, then writes
  `.next/e2e-build-stamp.json` (build id + hash of the public env).
- `tests/e2e/support/serve.mjs` (Playwright `webServer.command`): asserts the env, refuses to start unless the stamp
  matches `.next/BUILD_ID`, refuses if port 3100 is busy, then `next start -H 127.0.0.1 -p 3100`.
  `webServer.reuseExistingServer: false` always; `baseURL http://127.0.0.1:3100` (never 3000, where a developer's
  `next dev` with `.env` may run).
- `tests/setup/next-env-flag.spec.ts`: in a temp dir with a `.env` containing a synthetic key, `loadEnvConfig`
  from `@next/env` with `__NEXT_PROCESSED_ENV=true` leaves the key unset, and without the flag sets it (pins the
  internal behaviour; fails loudly on a Next upgrade).

### Browser network block
`tests/e2e/fixtures.ts` extends `test`: per context, `context.route("**/*")` continues only `127.0.0.1`/`localhost`
(and `data:`/`blob:`), aborts everything else and records the host; `context.routeWebSocket` likewise;
`serviceWorkers: "block"` (V2-06 PWA specs opt out explicitly); `afterEach` fails the test if any request was
blocked, naming the hosts.

### Seeds
- **E2E seed (per run):** `tests/e2e/global-setup.ts` → `assertLocalTestEnv`, `startRun()` (run lock + marker, same
  stack as Vitest → never concurrent with a Vitest run), seed tenant A (owner, admin, doctor, nurse, receptionist,
  per-run random password via `tests/helpers/tenants.ts`) and tenant B (owner + one patient/visit) → write
  `playwright/.auth/run.json` (ids/emails, git-ignored). `tests/e2e/auth.setup.ts` (setup project) signs in each
  role **through the login UI** (journey 1) and saves `storageState` per role. `global-teardown.ts` → `teardownRun`
  (removes run tenants/users/objects and `.planning/dev-messages.txt` if the run created it).
- **Local dev seed (R7):** `scripts/seed-local-dev.ts` (`npm run seed:local`, `seed:local -- --reset`): uses
  `loadTestEnv` + `loadLocalStackKeys` + `assertLocalTestEnv` (refuses any non-loopback URL or hosted key; never
  reads `.env`); idempotent by fixed synthetic emails (`owner@demo-clinic.example.test`, `doctor@…`, `nurse@…`,
  `reception@…`, `admin@…`) in tenant "Synthetic Demo Clinic"; upserts memberships, a few synthetic patients
  (reserved `+91 90000 0xxxx` range); password = `LOCAL_DEV_SEED_PASSWORD` from the shell if set (≥ 10 chars) else
  generated and printed once to the terminal (never written to disk) (RL-18). `--reset` deletes that tenant and those
  users only. Test runs never touch it (teardown is time-window based; e2e uses its own tenants).

### Projects (`playwright.config.ts`)
`setup` (auth.setup) → dependency of all. PR lane: `desktop-chrome` (Desktop Chrome 1280×720), `pixel-7`,
`iphone-15` (`grep: /@golden/`). Nightly lane: `iphone-se-3`, `galaxy-tab-s4`, `galaxy-tab-s4-landscape`,
`android-tablet-800` (Chromium, Pixel 7 UA, `isMobile`, `hasTouch`, 800×1280), `ipad-gen7`,
`ipad-gen7-landscape`, `ipad-mini-744` (iPad Mini descriptor, viewport 744×1133). Baseline lane: `vp-360`, `vp-768`,
`vp-1280` (Chromium) used only by `tests/e2e/m0/**`. Lanes are selected with `--project` lists in the npm scripts
(`e2e:pr`, `e2e:nightly`, `e2e:baseline`), not env branches. `retries: process.env.CI ? 2 : 0` kept; reporter
`list` + `json` + `html`; the CI step summary lists retried tests (TEST_STRATEGY §8 "report the retries").
`workers: 1` (one run lock per stack).

### Specs in this plan
- `tests/e2e/smoke.spec.ts` (`@golden`): each role's storage state opens its landing page; the page renders its
  main landmark; no console errors; no blocked request (PWA-08a "projects run green on a smoke spec").
- `tests/e2e/security/unauth-pages.spec.ts`: every `app/(dashboard)/**/page.tsx` (enumerated from the filesystem,
  dynamic segments filled with a random UUID) without a session ends on `/login`, with no tenant data in the HTML
  (TEST_STRATEGY §5 "unauthenticated access to every (dashboard) route is rejected").
- `tests/e2e/a11y/v2-01-screens.spec.ts` (R8): login, forgot-password, join (gate: 0 serious/critical axe
  violations, tags `wcag2a, wcag2aa, wcag21aa, wcag22aa`, at 360, 820 and 1280); staff edit, invite form, Sign & Bill
  modal, DPDP export control (report-only, attached JSON, owner phase recorded) (RL-17). Each also asserts no
  horizontal scroll at 360.
- `@axe-core/playwright` added as a devDependency (reason: TEST_STRATEGY §6.1 names it; no in-house alternative).
- `ci.yml` job **`e2e`**: `supabase start` (same exclusions), cache `~/.cache/ms-playwright` keyed on the
  Playwright version, `npx playwright install --with-deps chromium webkit`, `npm run e2e:build`, `npm run e2e:pr`,
  upload `playwright-report/` and `test-results/` (14 days). Nightly: `npm run e2e:nightly`.

### Acceptance
PR-lane projects green on smoke in CI; nightly projects green on smoke (one scheduled run link); the
`next-env-flag` spec passes; a run with a deliberately non-loopback `NEXT_PUBLIC_SUPABASE_URL` aborts before the
server starts (output captured **[ORCH]**); a page request to an external host fails the test (fixture test);
`seed:local` twice is idempotent and `--reset` removes only its rows (`psql` counts **[ORCH]**); R8 auth pages axe
clean at three widths.
### Evidence
CI run link; Playwright JSON report; guard-abort output; seed idempotency counts.

---

## 02-03b Six characterisation flows + journeys 1/8/9 + M0 baseline (P1-27, M0) · M

### Flows (FRONTEND_MIGRATION_PLAN M0; assert outcomes = DB state + visible result, role/label locators)
`tests/e2e/m0/`:
1. `register-patient.spec.ts` (`@golden`) — owner registers a patient (synthetic name, reserved phone) → one
   `patients` row with E.164 phone in tenant A, patient visible in the list. Receptionist variant asserts the
   correct outcome under `test.fail()` annotated **F-01** (known v1 bug; flips when PO-3 lands, V2-05/V2-08).
2. `walk-in-token.spec.ts` (`@golden`) — walk-in for an existing patient → a `visits` row `waiting` + a queue token
   with the next number for the doctor today; token visible in the queue.
3. `book-appointment.spec.ts` — book against availability → `visits` row `booked` at the slot, visible on the
   calendar; **overbook path**: the conflicting slot asks for confirmation, override creates the booking flagged
   overbooked; patient count unchanged asserted under `test.fail()` annotated **F-04**.
4. `cancel-appointment.spec.ts` — cancel a booked visit → status `cancelled`, slot free again (a second booking at
   the same time succeeds without override).
5. `consult-rx-finish.spec.ts` — doctor opens the waiting visit, records notes + diagnosis, adds 2 medicines, signs →
   visit completed/signed, prescription version 1 sealed, PDF route returns `%PDF-`, the signed Rx is read-only in UI.
6. `checkout-collect.spec.ts` — bill the completed visit, partial cash then UPI balance → invoice `paid`, two
   `payments` rows, receipt PDF returns `%PDF-`; double-submit of the final payment creates no second payment
   (01-10 AR3-N2 behaviour).
Journeys: `journey-01-password-login.spec.ts` (`@golden`; covered by `auth.setup` + an explicit wrong-password case),
`journey-08-role-restrictions.spec.ts` (receptionist direct URL to `/consultation/<id>` and `/settings/clinic`, nurse
Rx add, doctor billing — assert the server refuses; UI-hiding characterised as-is; the consult-page gate asserted
under `test.fail()` annotated **P1-07** if v1 lets it render), `journey-09-clinic-isolation.spec.ts` (A user pastes
B's patient/visit URLs → not found / denied, no B data in the DOM or network responses).
Known-bug rule: assert the **correct** outcome and mark `test.fail()` with the finding ID, so the suite stays green
while the bug exists and turns red (forcing an update) when it is fixed (RL-19).

### Baseline capture (`npm run e2e:baseline`, workflow_dispatch `lane=m0-baseline` or local **[ORCH]**)
- `tests/e2e/support/ux-counter.ts`: fixture wrapping `click/fill/press/selectOption/check` to count actions and
  keystrokes per flow; writes `test-results/m0/counts/<flow>.json` (desktop project only).
- Screenshots: key screen of each flow + each dashboard route at `vp-360`, `vp-768`, `vp-1280`, JPEG quality 70,
  frozen clock (`page.clock`), synthetic data only.
- axe: every route visited, on `desktop-chrome`, `pixel-7`, `iphone-15`, written as JSON (violations by rule and
  impact) — **report-only** (RL-17).
- Route JS: `next build` output parsed from the e2e build log.
- `scripts/m0-baseline-report.mjs` compiles those outputs into `docs/v2/m0-baseline/` (`README.md` report,
  `axe/*.json` summaries, `counts.json`, `route-js.json`, `screenshots/*.jpg`) and fills only the "v1 actions /
  keystrokes" and "v1 time (synthetic)" cells of the `FRONTEND_MIGRATION_PLAN.md` appendix table from `counts.json`
  (tool output, no hand-typed numbers).
- The 6 flows also run in the PR lane on `desktop-chrome` and `pixel-7`; mobile failures caused by v1 layout are
  allowed only as `test.fail()` with a UX finding ID; `iphone-15` runs `@golden` only.
### Acceptance
6 specs pass on v1 in CI (or `test.fail()` with F-01/F-04/P1-07 only); journeys 1, 8, 9 pass; `docs/v2/m0-baseline/`
committed from a tool run with its commit SHA in `README.md`; the FMP appendix v1 cells filled by the script.
### Evidence
CI run link of the PR lane; the baseline run link (workflow_dispatch) or local run log; the committed report.

---

## Rulings (agent acting as CTO under PO delegation for this phase; PO confirms at the gate)

| # | Question | Ruling | Why |
|---|---|---|---|
| RL-1 | One `test` job or separate unit and DB jobs | One job runs the full Vitest suite (unit + DB) on the local stack; the 0-skipped assertion covers the whole run | The V2-01a guard requires the stack for every Vitest run (`vitest.config.ts:9-11`); a split would duplicate stack start-up for no signal |
| RL-2 | Repository secrets | None. All lanes use the local stack's `supabase-demo` keys and offline providers; gitleaks runs as a pinned binary; `GITHUB_TOKEN` read-only except `issues: write` on the nightly reporter job | CLAUDE.md: no hosted Supabase in tests; public repo + fork PRs must never see secrets; `pull_request_target` not used |
| RL-3 | Nightly cron cannot run from a non-default branch | **Change the default branch to `feature/v2`.** `main` stays the protected v1 baseline (tag `v1.0-mvp-baseline`) | GitHub schedules run only on the default branch; committing to `main` is forbidden; also makes `feature/v2` the default PR base, avoiding accidental PRs into `main`. TEST_STRATEGY §8 "cron on `main`" predates the branch split |
| RL-4 | Where required checks live; is `main` touched | New ruleset `feature-v2-ci` on `feature/v2` only; `v2rules` unchanged | Adding checks to `v2rules` would also bind `main`; rulesets layer, so the new one only adds restrictions |
| RL-5 | Required approving review | **0 approvals, no code-owner review requirement.** Review stays the isolated Claude reviewer + PO gate approval (CLAUDE.md DoD 6, roadmap §16) | Single admin, PO-10 (no human reviewer); GitHub forbids approving your own PR, so ≥ 1 would deadlock every merge or force bypass actors, which is weaker than an honest 0. Overrides INFRASTRUCTURE_ASSESSMENT:221 / GSD :184. CODEOWNERS still added for ownership and review routing |
| RL-6 | Linear history / merge method | **No linear-history requirement; merge commits only** on `feature/v2` | Phase evidence cites commit SHAs (`01-VERIFICATION.md` `verified_commit`); squash/rebase would orphan them. Stacked phase branches also merge cleanly with merge commits. Force-push and deletion stay blocked |
| RL-6b | Repo visibility | Unchanged by this phase (PO item from V2-01). Recorded: on GitHub Free, a **private** repo loses ruleset enforcement and gets 2,000 Actions minutes/month; if the PO makes it private, upgrade the org to GitHub Team first | Avoids silently losing the CI gate (risk K-1) |
| RL-7 | `npm audit` gate without permanent red | Custom gate with a reviewed allowlist (GHSA id, package, owner phase, reason, **90-day expiry**); expired or stale entries fail; production deps only, high/critical; nightly full audit report-only | Industry practice (audit-ci/Snyk-style time-boxed waivers) without a new dependency; F20 and P1-19 are accepted, owned and dated |
| RL-8 | Action pinning | Every `uses:` pinned to a full commit SHA with the tag in a comment; repo policy `sha_pinning_required: true` | Supply-chain hygiene (tj-actions incident class); the policy makes it enforceable |
| RL-9 | gitleaks delivery | Pinned v8.30.1 release binary with checksum verification, full-history scan on every PR, SARIF artifact | `gitleaks-action` needs a licence secret for org repos; full history is small; SEC-28 allowlist only |
| RL-10 | P0-13: extend `p0-01-action-sweep` or new specs | New `tests/security/guard-*.spec.ts` sharing an engine; the sweep stays as the unauthenticated leg (V2-01 evidence) | Roadmap expected changes name `guard-*.spec.ts`; keeps V2-01 evidence stable |
| RL-11 | CLAUDE.md DoD 1 bans source-grep tests vs AI-06 L1 greps | Greps are **CI policy checks** (like ESLint), run as a `static` step; their tests assert the checker's outcome on fixtures | AI_STRATEGY/roadmap define L1 as greps; DoD 1 targets tests that pass by reading source instead of exercising behaviour |
| RL-12 | AI-P0 checks not implementable yet | `VITEST`/`test-api-key` grep scoped to `lib/ai/**` + `features/ai/**` now, whole `lib/` with P2-03 (V2-03); "build fails with `AI_ENABLED=true` and incomplete config" moves to P1-15 (V2-03) | E-6 branches in `lib/webhooks/*` are V2-03 scope; `lib/env.ts` has no AI keys until P1-15 |
| RL-12b | Login-page sparkle (AI-01 residual) and "AI voice agent" copy | Time-boxed allowlist entries (owner V2-06 AI-02), not fixed here | M0 requires no production code change; the gate blocks any new violation; L1-R6 (AI + price) has no exceptions |
| RL-13 | Type-check tests: remove the exclusion or a second config | `tsconfig.tests.json` + `typecheck` runs both | `next build` type-checks `tsconfig.json`; tests in it would slow/break production builds; vitest/vite types stay out of app code |
| RL-13b | ~300 `never` errors from the hand-written `Database` type | One `TestDb` loose-schema seam in test helpers until generated types (V2-03 plan 03-03), then switched back | Root cause is `lib/db/types.ts` (app code, V2-03 scope); runtime assertions are unchanged, so no coverage is lost |
| RL-14 | M0 items beyond flows/baseline (`/dev/ui`, design grep guards, jsx-a11y, bundle report) | Not in V2-02; they stay with V2-06 (06-02, 06-07) | Roadmap V2-06 expected changes list them; V2-02 scope is "characterisation e2e = M0" + baseline |
| RL-15 | "6 flows" vs TEST_STRATEGY T-10 journeys 1, 4, 6, 8, 9 | V2-02 delivers the 6 M0 flows **plus** journeys 1, 8, 9; journeys 4 and 6 are covered by the M0 book and consult flows on v1 and re-asserted on v2 UI in V2-08/V2-09 | Reconciles T-10 with P1-42 (which only lists 2, 3, 5, 7, 10) |
| RL-16 | Safe e2e server | Explicit allowlisted env (no inheritance) + `__NEXT_PROCESSED_ENV=true` + env guard allowing only `NODE_ENV=production` beyond the test rules + build-output marker scan + build stamp + server-side socket guard + port 3100, never reuse; CI has no `.env` by construction | Next loads `.env` in every mode and only fills unset keys, so explicit env alone is insufficient; build inlines `NEXT_PUBLIC_*`; flag behaviour pinned by a test |
| RL-17 | axe for M0 and R8 | M0: report-only baseline (FMP: blocking from M2/M3). R8: **blocking** (0 serious/critical) on the three new V2-01 auth pages, with any fixes made in V2-02; report-only on the four V2-01-touched v1 components, owners recorded | DoD 3 for new markup; v1 component a11y debt is replaced in V2-06…V2-11 |
| RL-18 | Dev seed password (R7) vs P2-04 "no shared known credential" | Fixed synthetic emails; password from the shell (`LOCAL_DEV_SEED_PASSWORD`) or generated and printed once; never committed; loopback-only guard | Known logins for the PO without a credential in the public repo |
| RL-19 | Known v1 bugs in characterisation specs | Assert the correct outcome under `test.fail()` with the finding ID | Playwright's documented expected-failure pattern; suite green now, red when fixed |
| RL-20 | Device projects in the PR lane for v1 screens | `desktop-chrome` all specs; `pixel-7` all specs with v1-layout failures only as annotated `test.fail()`; `iphone-15` `@golden` only; full matrix nightly runs smoke + `@golden` | PWA_STRATEGY §9.1; keeps PR < 15 min |
| RL-21 | Node version | `.nvmrc` 24 (Active LTS), `engines` `>=24 <25` | Roadmap §353 "pin Node LTS"; matches the local toolchain |
| RL-22 | Supabase services in CI | Same exclusions as `npm run test:db` (realtime and postgres-meta kept for parity) | Local/CI parity first; trimming is a measured follow-up |
| RL-23 | Cron secret compare is `!==` | Recorded for V2-04 (cron replaced by `app/api/jobs/run`); guard test asserts fail-closed only | Out of scope; owner phase exists |

## Risks

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| K-1 | Repo made private on GitHub Free → rulesets stop enforcing, minutes capped | M | H | RL-6b; PO told before any visibility change |
| K-2 | `__NEXT_PROCESSED_ENV` is internal and may change (Next 16 decision in V2-03) | M | H | `next-env-flag.spec.ts` fails loudly; build marker scan + server socket guard are independent layers |
| K-3 | v1 screens break on Pixel 7 / WebKit, making the PR lane flaky or red | H | M | RL-20 annotated expected failures; desktop is the M0 source of truth |
| K-4 | Auth rate limits on the local stack during e2e sign-ins | M | M | Sign in once per role in the setup project; reuse storage state |
| K-5 | Timing test `v1-performance.spec.ts` flakes on shared runners | M | L | Flaky policy: quarantine within 24 h behind an issue, never retries-to-green |
| K-6 | P1-15 (V2-03) forbids dev messaging/mock AI in production builds and breaks the e2e server | H | M | V2-03 must add an explicit local/e2e deployment mode; noted for the V2-03 planner |
| K-7 | CI time > 15 min (stack pulls, browser installs, two builds) | M | L | Parallel jobs, npm/Playwright/`.next/cache` caches; measure on the first runs, trim services (RL-22) if needed |
| K-8 | Guard engine false positives on actions with unusual failure shapes | M | M | Failure-shape rules mirror the existing sweep; per-action notes in the manifest, reviewed |
| K-9 | Teardown run lock collides when Vitest and Playwright target one local stack | L | M | `workers: 1`, sequential local runs; separate runners in CI |
| K-10 | Allowlists (audit, AI-L1) become permanent | M | M | Expiry dates + owner phase; stale entries fail |

## Open for the PO (not blocking)
1. Confirm RL-3 (default branch → `feature/v2`) — the orchestrator applies it after the PR is green.
2. Repo visibility vs plan cost (RL-6b).
3. CLAUDE.md "Commands" text is still stale (from V2-01a) — PO edit.

## Orchestrator adjustments to the rulings (2026-11-12)
| # | Adjusts | Decision | Why |
|---|---|---|---|
| OA-1 | RL-12b | Remove the login-page sparkle in 02-01 (AI-01 residual from V2-01) instead of allow-listing it; the "AI voice agent" developer copy stays allow-listed (owner V2-06) | One-icon fix is cheaper than a tracked exception and closes AI-01 |
| OA-2 | 02-01 triggers | The PR workflow also runs on `pull_request` into `v2/**` branches and on `workflow_dispatch`, so a stacked phase PR proves CI green before its base merges | V2-02 is stacked on V2-01 (PR #3 awaits the PO gate) |
| OA-3 | RL-6b | Gate recommendation to the PO becomes: upgrade the org to GitHub Team, then make the repo private | Free private repos lose ruleset enforcement |
| OA-4 | 02-02 finding | The P0-13 guard found real cross-tenant **reference** writes (tenant-A rows pointing at tenant-B patient/doctor/visit ids) in createVisit/bookAppointment/promoteWaitlistEntry, addToWaitlist, consent writes, recordFollowUp, addConsultationDiagnosis, createReferral, createVisitInvoice, createScheduleBlock, uploadLabDocument (`patient_documents.visit_id`, 02-06). Fixed in app code (`lib/auth/tenant-refs.ts`) with regression tests. The structural fix (composite `(tenant_id, id)` FKs) stays V2-05 P1-02 (F13) and must cover every table listed here | No B data read or modified; integrity defect closed at the service layer now, DB constraint as defence in depth next |
| OA-5 | 02-03a finding | Signed-out requests to dashboard pages end on `/login` (e2e proves it) but page-level data loads throw "Unauthenticated" server errors while the layout redirects (noise, wasted work, error-tracker spam). Fix: middleware-level unauthenticated redirect for `(dashboard)` routes → V2-03 (AUTH-04b / session handling) | Not a leak (no data rendered); belongs with the auth hardening phase |
| OA-6 | RL-19 | P1-03 (signed Rx stays editable in v1 UI/server; owner V2-09a clinical immutability) added to the IDs allowed as `test.fail()` expected failures | Real known defect with an owner; assert the correct outcome so the test turns red when fixed |

## Review triage (reviews/v202-review-independent.md = IR, reviews/v202-review-adversarial.md = AR)
Fix in V2-02 (plan 02-06 review fixes):
- IR-F1 / AR-M1: `uploadLabDocument` stores an unchecked `visit_id` → `visitInTenant(ctx, visit_id, patient_id)` before upload/insert; regression test; add `patient_documents.visit_id` to the V2-05 P1-02 table list.
- IR-F2 / AR-M2a: guard leg 3 forges every reference at once and a pre-write validation failure counts as a pass → forge one reference at a time with otherwise-valid same-tenant inputs (incl. a synthetic file for multipart actions); a positive control proves each action can write with valid inputs, so a rejection is attributable to the forged reference.
- AR-M2b (ruling: fix now, not deferred to V2-08): users with memberships in two clinics act in clinic C with their clinic-A role because by-id visit/queue queries rely on RLS alone → every by-id read/update/delete in services filters `.eq('tenant_id', ctx.tenantId)`; the guard world gains a dual-member user; regression tests for queue/visits paths named in AR.
- IR-F3 / AR-M2c: inventory and lint also catch function-body `"use server"` and `route.{js,jsx,tsx,mjs}` handlers; fixtures prove it.
- IR-F4: every `test.fail()` known-bug test asserts the failure is the expected one (a specific assertion/message), so an unrelated breakage turns it red.
- IR-F5: report-gate floor raised to ≥ 95% of the current count, plus required presence of the security spec files (guard-*, p0-01-*, cross-tenant-refs, share-tokens, membership-guard).
- IR-F8: retry the Supabase stack start (image-pull rate limits) with bounded backoff.
- IR-F9: the clinic-isolation probe sends an invoice id to the invoice route (was a visit id).
- AR-L: nightly issue lookup filters author `app/github-actions`; an audit waiver binds to its recorded severity (re-rated higher → waiver no longer applies); test network guards also block `dns.resolve*`/`dns.promises` and `dgram` for non-loopback; `patientInTenant` excludes soft-deleted/erased patients; fix the "reserved +91 90000 range" comment (use clearly synthetic numbers and say so honestly).
Orchestrator: IR-F7 regenerate `ci-run.json` on the final commit; enable fork-PR approval for all outside contributors; apply ruleset `feature-v2-ci` after PR #3 merges and before PR #4 merges (AR-M3).
Ruling IR-F6: the M0 report stays in the phase evidence directory (same convention as V2-01 evidence, tool-generated and commit-pinned); `docs/v2/FRONTEND_MIGRATION_PLAN.md` M0 appendix gets a pointer to it.
Accepted/recorded: AR-L `.gitleaksignore` editable in a PR (reviewer agents + PO see the diff; CODEOWNERS routes it), check-then-insert window (FK + RLS close it), AI-L1 grep evasions (policy grep, not a sandbox; V2-06 lint rules), failed-run Playwright traces public for 14 days (throwaway local credentials over synthetic data), AR-M2d `/api/v1` B-id leg while the switch is off (P1-37).
