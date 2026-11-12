---
phase: 02
roadmap_id: V2-02
name: CI & e2e foundations
type: research
base_commit: 2695964
date: 2026-11-12
---

# Phase 02 (V2-02) — research

Planner research for V2-02. All paths are repo-relative; `file:line` citations are to commit `2695964`. Nothing
here ran Vitest, Playwright or any app script. Commands actually run: `git`, `grep`, `node -e require(...)`
version reads, `gh api` GET calls, and one `npx tsc --noEmit -p` over a probe config kept in `research/`.

## 1. Scope as approved

- Roadmap §12.2 V2-02 (`docs/v2/V2_MASTER_ROADMAP.md:752-759`): P0-11, P0-13, P1-27 (Playwright scaffold,
  characterisation e2e = M0 using password login, type-checked tests, removal of tautological tests), P1-41
  (coverage reporting, report-only), PWA-08a (Desktop, Pixel 7, iPhone 15 in the PR lane; full matrix nightly),
  AI-06 L1 (copy and route greps). Plans 02-01…02-05 (`:757`). Acceptance: "the PR lane is green with 0 skipped in
  the DB lane; adding an unguarded server action makes the guard test fail; the M0 baseline report is committed"
  (`:758`). Evidence: CI run links; the M0 baseline appendix (screenshots, axe reports, interaction counts) (`:759`).
- Expected changes (`:756`): `.github/workflows/**`, branch protection, `CODEOWNERS`, `eslint.config.*` (tooling
  dirs ignored), `tests/e2e/**`, `tsconfig` for tests, `tests/security/guard-*.spec.ts`.
- Backlog rows: P0-11 (`:416`), P0-13 (`:418`), P1-27 (`:449`), P1-41 (`:464`), AI-06 (`:524`), PWA-08 (`:559`).
- Gates: G3 needs "CI green with 0 skipped" (`:1110`); §15 item 11 "Tests are type-checked", coverage floors
  enforced by P1-41 later, `npm audit --omit=dev` 0 high/critical (`:1093-1096`); §15 item 8 "Smart Assist never
  'AI' (CI copy grep)" (`:1084`).

## 2. Repo facts (verified)

| Fact | Evidence |
|---|---|
| No `.github/` directory, no CI | `ls`; INFRASTRUCTURE_ASSESSMENT.md:92 |
| `lint` script is `next lint` (deprecated in 15.5, removed in 16); evidence uses `npx eslint . --quiet` | `package.json` scripts; `.planning/phases/01-security-containment/evidence/static-checks.json` |
| `typecheck` = `tsc --noEmit`; `tsconfig.json` excludes `tests` and `docs` (E-7) | `tsconfig.json` `exclude` |
| ESLint ignores only `.next/**`, `.claude/**`, `next-env.d.ts`, `lint-fixtures/**` | `eslint.config.mjs` ignores block |
| `docs/temp/` holds a tracked third-party Next admin template (309 files) that ESLint currently lints | `git ls-files docs/temp \| wc -l` = 309 |
| `tsx` is **not** a dependency; `scripts/inventory-server-actions.ts` and `scripts/phase-evidence.mjs` call `npx tsx` (unpinned download) | `npm ls tsx` → empty; `scripts/phase-evidence.mjs` (inventory spawn) |
| Installed: next 15.5.28, @next/env 15.5.28, @playwright/test 1.63.0, vitest 3.2.7, supabase CLI 2.120.0, typescript 5.9.3, @supabase/supabase-js 2.117.2; Node 24.13.0 / npm 11.6.2 locally; no `.nvmrc`/`engines` | `node -e require(pkg/package.json).version` |
| Not installed: `@axe-core/playwright`, `@vitest/coverage-v8` | `node -e require(...)` fails |
| `playwright.config.ts` already runs the V2-01a guard, but `testDir` `./tests/e2e` does not exist; projects are Desktop Chrome + Pixel 5; `baseURL` defaults to `http://localhost:3000`; no `webServer` | `playwright.config.ts:1-34` |
| Vitest lane: `.env.test` + local-stack keys from `supabase status`; guard at config load, globalSetup, every worker; `fileParallelism: false` | `vitest.config.ts:9-25`; `tests/setup/test-env.ts:109-161,181-254` |
| Guard pins `MESSAGING_PROVIDER=dev`, `AI_PROVIDER=mock`, `NODE_ENV` unset or `test`; forbids hosted vars and markers; does not mention `AI_ENABLED` | `tests/setup/test-env.ts:22-33,49-77` |
| Worker guard blocks non-loopback sockets, fetch and DNS in Vitest workers | `tests/setup/worker-guard.ts:1-80` |
| Teardown = everything created after the run start on the server clock; one run per stack (lock file); leak check first; deletes side-effect file `.planning/dev-messages.txt` | `tests/setup/teardown.ts:1-22,121-163,261-315` |
| Seeded test users get a per-run random password (P2-04) | `tests/helpers/tenants.ts:7-13` |
| Full suite on `60d8db0`: 86 files / 1128 tests, 0 skipped, two runs | `.planning/phases/01-security-containment/evidence/summary.json` |
| Supabase local config: signups off, min password 10, OTP expiry 600, code-only recovery template; no `seed.sql`; no realtime use in app code | `supabase/config.toml`; `grep -r "channel(" app features lib components` → none |
| `test:db` starts the stack with `-x studio,edge-runtime,logflare,vector,imgproxy,supavisor` | `package.json` |
| App env reads: `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `API_V1_ENABLED`, `NODE_ENV`, `MESSAGING_PROVIDER`, `MSG91_*`, `TWILIO_*`, `GUPSHUP_*`, `R2_*`, `STORAGE_PROVIDER`, `CRON_SECRET`, `VITEST`, and `AI_ENABLED/AI_PROVIDER/AI_API_KEY/AI_MODEL_NAME/AI_BASE_URL` via `resolveAiProviderConfig(env = process.env)` | `grep -rhoE "process\.env\.[A-Z0-9_]+"`; `lib/ai/client.ts:39-53`; `lib/env.ts:3-56` |
| `lib/env.ts` validates only Supabase keys and `API_V1_ENABLED` (full schema is P1-15, V2-03) | `lib/env.ts:3-25` |
| Dev messaging provider appends recipients to `.planning/dev-messages.txt` (cwd-relative) | `lib/messaging/dev-logger.ts:80-87`; `lib/messaging/index.ts:20-31` (default `dev`) |
| `VITEST`/`NODE_ENV` branches remain in `lib/webhooks/dispatcher.ts:94`, `lib/webhooks/ssrf.ts:103` (E-6, P2-03 → V2-03) | grep |
| Cron routes compare `CRON_SECRET` with `!==` (not constant time); fail closed when unset | `app/api/cron/webhooks/route.ts:5-14` |
| 26 `"use server"` modules; guard call forms: `resolveServiceContext("perm")` (most), `resolveServiceContext()` ×11 (membership only), `requireServiceContext("perm")`, `requirePermission(...)` | grep over `"use server"` modules |
| 25 `route.ts` files (≈45 method handlers): session (3: receipt PDF, Rx PDF, patient export), public token (3), webhook (1, 6 methods), cron (2), health/ready (2), `/api/v1/**` (14, disabled by `API_V1_ENABLED`) | `find app -name route.ts` + export grep |
| Dashboard pages redirect unauthenticated users in the layout (middleware only refreshes the session) | `app/(dashboard)/layout.tsx:1-26`; `middleware.ts:5-60` |
| Inventory tool: `buildInventory()` takes no arguments; scan dirs hard-coded; exits 1 on a flag | `scripts/inventory-server-actions.ts:23,265,366-393` |
| Existing unauthenticated sweep over every action (forged overrides, no client creation, row counts unchanged) | `tests/security/p0-01-action-sweep.spec.ts:1-260` |
| Route guard test pattern: mock `@/lib/supabase/server` `createClient` with a seeded user's JWT client, call the handler in process | `tests/security/pdf-route-guards.spec.ts:1-40` |
| Permission matrix (owner `*`; admin, doctor, receptionist, nurse lists) | `lib/permissions/matrix.ts`; `lib/auth/context.ts:38-85` |

### GitHub (read-only `gh api`)

| Fact | Evidence |
|---|---|
| Repo `thecliniqai/cliniqai-app` is **public**, owned by an **Organization on the Free plan**; default branch **`main`** | `gh api repos/...` (`visibility: public`, `default_branch: main`); `gh api orgs/thecliniqai` (`plan: free`) |
| Ruleset `v2rules` (active, no bypass actors) on `refs/heads/main` and `refs/heads/feature/v2`: block deletion, block non-fast-forward, require PR with **0 approvals**, merge/squash/rebase allowed. No required status checks. Classic branch protection: none | `gh api repos/.../rulesets/26947233`; `.../branches/*/protection` → 404 |
| Actions enabled, all actions allowed, `sha_pinning_required: false`; default `GITHUB_TOKEN` permissions `read`, cannot approve PRs | `.../actions/permissions`, `.../actions/permissions/workflow` |
| Secret scanning, push protection, Dependabot security updates: disabled | `security_and_analysis` |
| Only collaborator `skarkhanis95` (admin) | `.../collaborators` |
| History uses merge commits (PR #1, #2); PR #3 (V2-01) open; this branch is stacked on it | `git log --merges`; `gh pr list` |
| Pinned action SHAs (all releases ≥ 2 weeks old on 2026-11-12): `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1), `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1` (v7.1.0), `actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9` (v6.1.0), `actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9` (v7.0.2); gitleaks v8.30.1 release ships `gitleaks_8.30.1_linux_x64.tar.gz` + `gitleaks_8.30.1_checksums.txt` | `gh api .../releases`, `.../git/ref/tags/*` |

Consequences:
1. **Scheduled workflows run only from the default branch.** With `main` (frozen v1) as default, a nightly cron in
   `feature/v2` never fires, and putting a workflow on `main` is forbidden by CLAUDE.md. → ruling RL-3.
2. **Rulesets on a private repository need a paid plan** (GitHub Free orgs get rulesets and branch protection only on
   public repos), and private repos on Free get 2,000 Actions minutes a month. The V2-01 summary recommends making
   the repo private (`01-SUMMARY.md` "Open for the PO" item 0). → risk K-1, ruling RL-6.
3. `v2rules` covers `main` and `feature/v2` together; adding required checks there would also bind `main`. → RL-4.
4. The `gitleaks/gitleaks-action` requires a licence secret for organisation repos; running the pinned binary needs
   no secret. → RL-9.

## 3. Next.js environment loading (the e2e server design driver)

- `@next/env` `loadEnvConfig` reads `.env.${mode}.local`, `.env.local` (not in test mode), `.env.${mode}`, `.env`
  from the project root, where mode = `test` if `NODE_ENV=test`, else `development`/`production`
  (`node_modules/@next/env/dist/index.js`, `loadEnvConfig`). **`.env` is loaded in every mode.** File values fill
  only keys not already in `process.env`, so an explicit env alone does not stop a stray key (e.g. `R2_*`,
  `CRON_SECRET`, `AI_ENABLED`) in a developer's `.env` from reaching the server.
- `processEnv` returns early without assigning anything when `process.env.__NEXT_PROCESSED_ENV` is set (and
  `forceReload` is false): `if(!o&&(process.env.__NEXT_PROCESSED_ENV||e.length===0)){return[process.env]}`
  (same file). `forceReload` is used only by the dev server's file watcher. So `next build` / `next start` launched
  with `__NEXT_PROCESSED_ENV=true` and a fully explicit environment load **no** value from any `.env*` file.
  It is an internal flag → it must be pinned by a test that fails if a Next upgrade changes the behaviour (V2-03
  plan 03-06 decides Next 16).
- `next build` inlines `NEXT_PUBLIC_*` into client bundles at build time, so a `.next/` built earlier with the
  developer's `.env` would carry the hosted Supabase URL into the e2e browser. The e2e lane must build its own
  output and refuse to serve an output it did not build.
- Next telemetry is outbound network (`NEXT_TELEMETRY_DISABLED=1` needed in CI and the e2e server).
- In CI the checkout has no `.env` (git-ignored), so CI is safe by construction; the risk is local runs.

## 4. Docs that define the e2e content

- **M0 / 6 characterisation flows** (`docs/v2/FRONTEND_MIGRATION_PLAN.md:48-61`): "register patient · walk-in to
  token · book appointment (incl. overbook path) · cancel · consult → Rx → finish · checkout/collect"; assert
  **outcomes** (DB state, visible results), not v1 selectors; baseline metrics = axe per route on the PR-lane
  projects, route JS from `next build`, screenshots at 360/768/1280, click/keystroke counts recorded in the plan's
  appendix (`:269-279`); acceptance: specs pass on v1 or failures documented as known v1 bugs (F-01, F-04); baseline
  report committed under `docs/v2/`; **no production code changed**. M0 also lists a `/dev/ui` scaffold and
  report-only design grep guards/jsx-a11y/bundle report (`:54-55`) — the roadmap places `/dev/ui`, grep guards and
  bundle budgets in V2-06 (`V2_MASTER_ROADMAP.md:794-797`). → RL-14.
- Known v1 bugs on these flows: F-01 receptionists cannot register patients; F-03 walk-in/checkout not atomic;
  F-04 overbook path duplicates the patient; F-08 consult edits lost / dead dropzone (`VERIFICATION_LOG.md:107-110`).
- TEST_STRATEGY journeys (`docs/v2/TEST_STRATEGY.md:247-262`); T-10 assigns journeys 1, 4, 6, 8, 9 + axe to the
  scaffold (`:312`), P1-42 assigns 2, 3, 5, 7, 10 to later phases (`V2_MASTER_ROADMAP.md:465`). PR-lane target
  < 15 min, blocking, 0 skipped in the DB lane (`TEST_STRATEGY.md:271`); nightly opens an issue on failure (`:273`);
  `retries: 2` only in CI e2e, reported (`:276`). → RL-15.
- **Device matrix** (`docs/v2/PWA_STRATEGY.md:381-404`): PR = Desktop Chrome 1280, Pixel 7, iPhone 15 (golden
  path only); nightly = iPhone SE (3rd gen), Galaxy Tab S4 (712×1138) and landscape, custom Android tablet 800×1280
  (Chromium, mobile UA, `isMobile`, `hasTouch`), iPad (gen 7) portrait/landscape, custom iPad mini 744×1133 (WebKit).
  PWA-08a acceptance: "Projects run green on a smoke spec in CI" (`:467`). All named descriptors exist in
  Playwright 1.63 (`devices[...]`: Pixel 7 412×839, iPhone 15 393×659, iPhone SE (3rd gen) 375×667, Galaxy Tab S4
  712×1138, iPad (gen 7) 810×1080, iPad Mini 768×1024 → custom 744 needed).
- **Accessibility**: FMP §5 makes axe blocking from M2 (gallery) / M3 (routes) (`FRONTEND_MIGRATION_PLAN.md:221`);
  M0 is a baseline report. CLAUDE.md DoD 3 requires "axe clean" for changed UI; V2-01 deferred DoD 3 for its changed
  screens to V2-02 (R8, `01-PLAN.md` rulings; `01-VERIFICATION.md` "Not verified").
- **R7** local dev seed with known synthetic logins, guarded to 127.0.0.1, never `--env-file=.env`
  (`.planning/phases/01-security-containment/briefs/01-06-auth.md:254,273`; `01-PLAN.md` R7).

## 5. Security guard docs (P0-13)

- SECURITY_VERIFICATION_PLAN §5 (`:59-65`): action manifest, forged overrides, AST check — already delivered by
  V2-01 (`p0-01-action-sweep.spec.ts`, `override-lint-gates.spec.ts`, inventory).
- §6 (`:67-123`): Vitest suites on the local stack with real signed-in sessions; §6.2 lists TC-SA, TC-WH, TC-TOK,
  TC-API families. TEST_STRATEGY T-05 (`:308`): "enumerate server actions and route handlers; assert unauthenticated
  → rejected and wrong role → rejected"; §9.3 (`:286`): "every exported server action and `app/api/**/route.ts`
  handler enforces authentication and the correct permission".
- ADR-0005 Verification 3 (`docs/adr/0005-confine-service-role-client.md`): "the P0-13 guard test over every server
  action and route handler (V2-02) is the standing proof".
- Regression tests for P0-01…P0-05 already exist from V2-01 (`01-VERIFICATION.md` acceptance table:
  `p0-01-action-sweep`, `p0-01-forged-overrides`, `membership-guard`, `webhook-lockdown`, `share-tokens`,
  `review2-fixes-db`, `share-path-encoding`, `v1-doctor-guard`, `api-v1-switch`).
- F14 (`01-PLAN.md` follow-ups): the type-aware inventory must run in CI.

## 6. AI-06 L1 ("copy and route greps")

- AI_STRATEGY §7 L1 (`docs/v2/AI_STRATEGY.md:389`) is unit tests of Smart Assist, `pseudonymise()`, post-checks and
  the entitlement matrix — none of which exist yet (AI-04/AI-03 land in V2-05/V2-12). The roadmap narrows V2-02 to
  "copy and route greps" (`V2_MASTER_ROADMAP.md:524,754`).
- The greps come from: AI-P0 acceptance "No `/api/ai/*` route reachable. `grep` finds no `VITEST`/`test-api-key`
  in `lib/`. … No sparkle glyph on deterministic UI" with tests "L1 and L2 CI greps; env-schema unit test; a CI build
  job with incomplete AI env expecting failure" (`AI_STRATEGY.md:404`); §5.3 labelling: only LLM features carry
  "AI" or the sparkle glyph; CI copy grep fails on "AI" next to a price or a Buy/Upgrade action (`:319-324`);
  roadmap §15.8 "Deterministic features are labelled 'Smart Assist' and never 'AI' (CI copy grep)" (`:1084`).
- Current state:
  - `app/api/` has no `ai/` directory; `tests/security/ai-containment.spec.ts:24` already proves no copilot route at
    runtime via `import.meta.glob`.
  - Sparkle glyph (`<Sparkles`) in JSX: `components/consultation/ai-scribe-modal.tsx:94,163,176` (LLM scribe),
    `components/consultation/returning-patient-catchup.tsx:90,121` (LLM catch-up, fails closed; SA-10 replaces it in
    V2-09b), **`components/auth/clinic-showcase-panel.tsx:57`** (login marketing badge — deterministic copy, an AI-01
    residual). `components/consultation/diagnosis-section.tsx:25` imports `Sparkles` without using it. `✦` only in
    the two LLM files.
  - "AI" in UI copy outside LLM files: `components/settings/developer/api-key-table.tsx:90`,
    `create-api-key-modal.tsx:66,75`, `revoke-key-modal.tsx:47` ("AI voice agent" integration examples — a v2.1
    product, AI_STRATEGY AI-21…26).
  - `VITEST` remains in `lib/webhooks/*` (E-6, P2-03 owned by V2-03), so a whole-`lib/` grep would be red today.
  - `lib/env.ts` has no AI keys, so "next build with `AI_ENABLED=true` and incomplete config fails" is not
    implementable before P1-15 (V2-03).

## 7. Test type-checking estimate (02-04)

Probe: `research/tsconfig.tests-probe.json` (extends root config, includes everything incl. `tests/`, excludes
`docs`, `node_modules`, `.next`, `lint-fixtures`; `incremental: false`). Output: `research/tsc-tests-probe.txt`.
`npx tsc --noEmit -p .planning/phases/02-ci-e2e-foundations/research/tsconfig.tests-probe.json` → exit 2,
**346 errors, all in `tests/`** (app code is clean).

By root cause:

| Category | Count (≈) | Cause | Fix |
|---|---|---|---|
| `Property 'x' does not exist on type 'never'` / object literal not assignable to `never[]` / RPC args "not assignable to `undefined`" | ~300 (195 TS2339, 63 TS2353, ~40 TS2345) | The hand-written `Database` type in `lib/db/types.ts` uses `interface` row types and lacks `Enums`/`CompositeTypes`, so supabase-js 2.117 resolves many tables and functions to `never` for **typed** clients (`tests/helpers/supabase-admin.ts` `createClient<Database>`, `SeededTenant.client`) | Test clients typed through one seam (`TestDb`) with a loose schema until generated types land (V2-03 plan 03-03), then switched back |
| Missing Vitest globals (`afterEach`, `afterAll`) | 2 | `globals: true` without `types: ["vitest/globals"]` | tests tsconfig `types` |
| `import.meta.glob` | 1 | needs `vite/client` types | tests tsconfig `types` |
| `ProcessEnv` requires `NODE_ENV` | 3 | `@types/node` augmentation by Next | cast via a typed helper |
| `null as X` conversions (TS2352), possibly-null (TS18047), implicit any (TS7006) | ~20 | sloppy test code | local fixes |
| Result/input shape drift: `CancelVisitResult` fields, `UploadLabDocumentResult.error`, `GetReceiptPdfResult.error`, consultation input missing `specialty`, `recorded_by` in vitals input | ~20 | tests pass shapes the current types reject (runtime defaults hide it) | narrow on the discriminant; build inputs with typed fixture builders |

Top files: `tests/compliance/dpdp-rights.spec.ts` (43), `tests/integration/cdci-search.spec.ts` (27),
`tests/scheduling/calendar-waitlist.spec.ts` (26), `tests/integration/visits.spec.ts` (24),
`tests/integration/consultation-flow.spec.ts` (23), `tests/api/v1-doctor-guard.spec.ts` (21). After the `TestDb`
seam, ~45 genuine errors remain — one implementer session.

## 8. Tautological / doc-grep / mock-isolation candidates (02-04)

TEST_STRATEGY T-12 (`:314`): "Delete or rewrite the tautological and doc-grep tests (`navigation-roles`,
`queue/status-actions`, `ops/backup-restore` §1). Rewrite the mock-based 'isolation' tests as DB tests." E-5
verification (`:181`) confirms them. Current files:

| File:test | Class | Evidence | Disposition |
|---|---|---|---|
| `tests/cabin/navigation-roles.spec.ts` (5 tests: "verifies owner has Doctor's Cabin…", "verifies doctor role is focused…", etc.) | T | `getNavForRole` and `segregateCabinVisits` are **defined in the spec** (`:5-56`); neither exists in app code (`grep` → none) | Delete (T-12). Real coverage: role landing in the e2e auth setup + journey 8 spec |
| `tests/queue/status-actions.spec.ts` (5 tests) | T | `getActionPropsForStatus` defined in the spec (`:4-46`); not in app code | Delete (T-12) |
| `tests/ops/backup-restore.spec.ts` §1 "verifies docs/ops/backup-restore.md exists and specifies RTO…" | D | greps a markdown file (`:17-30`) | Delete (T-12 names §1) |
| `tests/ops/backup-restore.spec.ts` §2 "tables queryable by admin", §3 "snapshot … restoration data fidelity" | DB, no backup | §3 inserts rows then selects them; "It verifies no backup or restore" (`TEST_STRATEGY.md:117`) | Delete with §1 (whole file): no behaviour is lost — table existence and insert/select are exercised by every DB suite; the real restore check is the P0-16b drill (V2-15). Record in the summary |
| `tests/patients/visit-history.spec.ts` "enforces tenant isolation and returns reverse chronological visits…" | M ("isolation" on a mock) | hand-built query-builder mock (`:6,125-132`) | Rewrite as a DB test on the local stack (tenant A cannot see B's visits; ordering), keep the zero-visits case |
| `tests/visits/clinic-visits-register.spec.ts` "strictly isolates queries to active tenant…" (`:127`), "filters active clinic doctors by tenant" (`:282`) | M | mocked client (`:64-127`) | Rewrite both as DB tests; keep the `computeDateRange` unit tests (`:7-62`) |
| `tests/api/v1-performance.spec.ts` | timing (E-9, P2) | wall-clock thresholds | **Keep** (docs give no removal directive); on the local stack it is no longer network latency; quarantine per the flaky policy if it flakes in CI |

Already retired in V2-01 (not candidates): copilot specs, regex evals, `ai-rbac`, `dev-logger-lockout`
(`01-SUMMARY.md` "Retired specs").

## 9. Coverage (02-05)

- P1-41 (`V2_MASTER_ROADMAP.md:464`): coverage reporting in CI, report-only from V2-02, enforced at the G2
  thresholds by V2-14. TEST_STRATEGY §9.5: ≥ 80% lines / ≥ 70% branches on domain modules (billing, scheduling,
  queue, prescriptions, permissions) (`:288`); T-15 `@vitest/coverage-v8` (`:317`).
- Provider must match Vitest 3.2.7 exactly (`@vitest/coverage-v8@3.2.7`).

## 10. Conflicts and gaps found (ruled in 02-PLAN.md)

1. Nightly cron cannot run from `feature/v2` while `main` is default (§2 consequence 1).
2. INFRASTRUCTURE_ASSESSMENT.md:221 and GSD_WORKFLOW_ASSESSMENT.md:184 ask for 1 required review / CODEOWNERS
   sign-off; PO-10 (no human reviewer) and the single admin make that impossible (self-approval is not allowed).
3. TEST_STRATEGY §8 nightly "Cron on `main`" (`:273`) predates the v1/v2 branch split.
4. Making the repo private on the Free plan disables ruleset enforcement and caps minutes.
5. `require_code_owner_review` would deadlock every PR for the same reason as item 2.
6. M0 lists `/dev/ui`, design grep guards, jsx-a11y and bundle report; the roadmap puts those in V2-06.
7. TEST_STRATEGY T-10 puts journeys 1, 4, 6, 8, 9 in the scaffold; the roadmap names "6 flows".
8. AI-P0 acceptance "grep finds no `VITEST` in `lib/`" vs remaining E-6 branches owned by V2-03; "build fails with
   incomplete AI env" needs the P1-15 env schema (V2-03).
9. Login-page sparkle badge violates AI §5.3 (AI-01 residual); M0 forbids production code changes.
10. CLAUDE.md DoD 1 bans source-grep tests, while AI-06 L1 is defined as greps.
11. `npx tsx` unpinned supply-chain fetch in the evidence and inventory paths.
12. Production guard P1-15 (V2-03) will forbid `MESSAGING_PROVIDER=dev` in production builds, while the e2e server
    runs a production build with offline providers → V2-03 must add an explicit e2e/local deployment mode.
13. CLAUDE.md "Commands" still shows the pre-V2-01a override command (open since V2-01a).
