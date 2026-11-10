# clinicOS v2.0 — Test Strategy (Workstream E)

> **Status:** Discovery and assessment only. No tests were added or changed.
> **Author role:** QA & Test Automation Architect
> **Date:** 2026-11-10 · **Branch:** `feature/v2`
> **Evidence policy:** Paths are repo-relative. The Vitest suite was re-run **only** in isolated mode, with every external service pointed at a dead endpoint (`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9`, `AI_PROVIDER=mock`, and so on). No test ran against the hosted Supabase project.
>
> Labels: **Fact**, **Problem**, **Risk**, **Assumption (validate)**, **Recommendation**. Priority: P0 (critical/security blocker), P1 (essential for v2), P2 (important), P3 (optional). Sizing is relative (S/M/L/XL).

---

## 1. Executive summary

1. **Fact:** There are 69 spec files and 649 test cases. In isolated mode, **442 pass, 206 are skipped and 1 fails**. **27 of the 69 files** cannot run without the **hosted** Supabase project, because their `beforeAll` seeds real auth users and tenants with the service-role key (`tests/helpers/tenants.ts:34-95`).
2. **Problem (P0):** There is no isolated database for tests. The DB-backed suites write to one hosted project, and nothing cleans up afterwards: `tests/helpers/*.ts` never deletes users or tenants, and only one `afterAll` exists in the whole suite (`tests/api/webhooks-outbox.spec.ts:485`). Every run leaves orphan auth users (`test-doctor-…@example.com`, fixed password `TestPassword123!`, `tests/helpers/tenants.ts:39`) and tenants behind. If that project is production or shared, the tests pollute it.
3. **Problem (P0):** Every test that matters for safety (clinic isolation, RLS, invitations, prescription sign-off, billing, DPDP rights, the API key guard) is DB-backed. That means **none of them can run in CI today**, and all of them are skipped in any clean environment.
4. **Problem (P1):** Several passing tests give false confidence:
   - Some test **logic copied into the spec file** rather than the production code: `tests/cabin/navigation-roles.spec.ts:5-56` and `tests/queue/status-actions.spec.ts:4-…`.
   - One **greps a markdown document** and counts that as backup verification: `tests/ops/backup-restore.spec.ts:17-30`.
   - Some "tenant isolation" tests run against **hand-built Supabase query-builder mocks**, which cannot prove RLS: `tests/patients/visit-history.spec.ts:6,125-132` and `tests/visits/clinic-visits-register.spec.ts:129`.
   - The AI "evals" run the **deterministic local regex parser**, never an LLM, because production code switches on `process.env.VITEST` (`lib/ai/soap-generator.ts:302-318`).
5. **Fact:** There are **no end-to-end tests.** `playwright.config.ts:4` points to `./tests/e2e`, but that directory does not exist. There are no browser component tests (no jsdom, no Testing Library), no accessibility tests, no visual tests, no load tests and no coverage tooling (`@vitest/coverage-*` is not installed; `package.json`).
6. **Fact:** Tests are **not type-checked**. `tsconfig.json` excludes `tests`, so `npm run typecheck` never sees them.
7. **Problem (P1):** The verification records in `.planning` cannot be reproduced and sometimes contradict the code. `.planning/phases/06-api-launch-readiness/06-VERIFICATION.md:261` reports `v1-crud.spec.ts` "37/37 tests passed", but the file has **17** test cases. Line 264 reports dpdp-rights "14/14", but the file has **15**. These records cannot be relied on as release evidence.

**Recommended direction:**
- Run Vitest against a **local, ephemeral Supabase stack** (`supabase start` in Docker, with migrations from `supabase/migrations` applied on each run).
- Add **pgTAP** for an RLS and role matrix over every tenant table.
- Use **MSW** at the HTTP boundary for MSG91, AI providers and S3/R2.
- Add **Playwright with @axe-core/playwright** for about 10 critical journeys at phone and desktop widths.
- Run all of this on every PR in GitHub Actions.

Synthetic data only, created through factories and torn down per run.

---

## 2. Current test inventory (all 69 spec files)

Type legend:

- **U**: pure unit test of production code.
- **M**: unit test with mocked Supabase, `fetch` or env.
- **C**: component markup test via `react-dom/server` string rendering (no DOM, no interaction).
- **DB**: integration test against the **hosted** Supabase project.
- **T**: tautological. It tests logic defined inside the spec file, not production code.
- **D**: asserts on documentation or file text.

Status comes from the isolated run (`p` = passed, `s` = skipped, `f` = failed).

### 2.1 Authentication, roles and clinic isolation

| File | Type | What it actually asserts | Isolated result |
|---|---|---|---|
| `tests/auth/rbac.spec.ts` | U | `hasPerm`/`assertPerm` matrix in `lib/permissions` per role. Real code, real outcomes. | 6p |
| `tests/auth/invite.spec.ts` | DB | Invitation insert under RLS, atomic consumption, replay and expiry rejection. High value. | 5s |
| `tests/security/cross-tenant.spec.ts` | DB | RLS catalog (RLS on, no `USING(true)`) plus Tenant A→B read, update, insert and delete denial, forged tenant_id, dual-membership users, pagination. **Only 8 tables** (`tests/helpers/rls.ts:3-12`), out of 43 tables with RLS enabled in migrations. | 20s |
| `tests/integration/multi-tenancy.spec.ts` | DB | Own-tenant read, cross-tenant denial, unique membership, `create_clinic_with_owner` atomicity. | 6s |
| `tests/cabin/navigation-roles.spec.ts` | **T** | Tests `getNavForRole`, a function **defined in the spec** "mirroring AppSidebar". It cannot catch a regression in the real sidebar. | 5p |
| `tests/security/ai-rbac.spec.ts` | U | AI tool access per role. | 9p |
| `tests/security/dev-logger-lockout.spec.ts` | M | The OTP and invite dev logger is suppressed when `NODE_ENV=production`. Mocks `fs` and Supabase. | 6p |
| `tests/security/pii-scrubber.spec.ts` | U | Removes PII before text goes to the AI. | 8p |
| `tests/settings/profile-and-credentials.spec.ts` | U | zod schemas for clinic and profile settings. | 7p |

### 2.2 Patients, visits, queue, appointments and scheduling

| File | Type | What it actually asserts | Result |
|---|---|---|---|
| `tests/patients/schema.spec.ts` | U | Patient zod schema. | 7p |
| `tests/patients/dedup.spec.ts` | U + DB | DOB and age derivation and phone normalisation (U). Duplicate detection (DB). | 3p 3s |
| `tests/patients/phone-search.spec.ts` | M | Phone search query construction. | 11p |
| `tests/patients/visit-history.spec.ts` | M | Claims "enforces tenant isolation", but only checks that a hand-built mock was called with filters. **Proves nothing about RLS.** | 2p |
| `tests/utils/phone.spec.ts` | U | Indian E.164 normalisation. | 24p |
| `tests/components/phone-input.spec.ts` | C | SSR markup, aria attributes and pure sanitiser functions. | 16p |
| `tests/visits/clinic-visits-register.spec.ts` | U + M | Date-range maths (U). "Strictly isolates queries" with a mocked client (M). | 7p |
| `tests/integration/visits.spec.ts` | DB | Visit lifecycle. | 6s |
| `tests/integration/queue-flow.spec.ts` | DB | Walk-in token #1, check-in, `called_at`, `completed_at`. Real outcomes. | 4s |
| `tests/queue/status-actions.spec.ts` | **T** | `getActionPropsForStatus` is **defined in the spec**. | 5p |
| `tests/integration/calendar-scheduling-ux.spec.ts` | M | Shift and conflict checks, emergency override and confirmation, all with a mocked client. Useful logic coverage, but no DB constraints are exercised. | 12p |
| `tests/scheduling/availability-blocks.spec.ts` | U | Availability and blocking rules. | 17p |
| `tests/scheduling/calendar-waitlist.spec.ts` | DB | Waitlist behaviour. | 5s |
| `tests/components/doctor-availability.spec.ts` | U + M | Shift validation, plus authorisation of availability edits with mocks. | 11p |
| `tests/integration/cabin-consultation-launch.spec.ts` | DB | Cabin to consultation launch. | 2s |

### 2.3 Consultation, prescriptions, labs and referrals

| File | Type | What it actually asserts | Result |
|---|---|---|---|
| `tests/consultation/schemas.spec.ts` | U | Consultation zod schemas. | 11p |
| `tests/integration/consultation-flow.spec.ts` | DB | Consultation end to end at the server-action level. | 10s |
| `tests/integration/prescription-versioning.spec.ts` | DB | Sign-off seals v1, PDF has a `%PDF-` header, signed URLs, amendment needs a justification, immutable revision, cross-tenant denial. **High value.** | 6s |
| `tests/prescriptions/dosage.spec.ts` | U | Dosage helpers. | 13p |
| `tests/integration/cdci-search.spec.ts` | DB | Drug search over seeded CDCI data. | 6s |
| `tests/dental/odontogram.spec.ts`, `tests/pediatrics/who-growth.spec.ts` | U | Specialty calculators. | 7p, 7p |
| `tests/labs/lab-documents.spec.ts`, `tests/labs/tokenized-sharing.spec.ts` | DB | Lab document upload and access, and token sharing. | 12s, 6s |
| `tests/referrals/referrals-flow.spec.ts` | DB | Referral lifecycle. | 13s |

### 2.4 Billing, compliance and audit

| File | Type | What it actually asserts | Result |
|---|---|---|---|
| `tests/billing/schemas.spec.ts` | U | Invoice and payment zod schemas only. | 4p |
| `tests/integration/per-visit-billing.spec.ts` | DB | Exact decimal totals, partial then final payment → `paid`, cross-tenant denial. **High value.** | 5s |
| `tests/integration/receipt-reports.spec.ts`, `tests/integration/subscription.spec.ts` | DB | Receipts and reports, subscription state. | 4s, 3s |
| `tests/compliance/consent.spec.ts`, `tests/compliance/dpdp-rights.spec.ts` | DB | Consent records, DPDP export and soft-delete erasure. | 3s, 15s |
| `tests/audit/audit-logging.spec.ts` | DB | Audit rows written. | 4s |

### 2.5 Public API, webhooks and operations

| File | Type | What it actually asserts | Result |
|---|---|---|---|
| `tests/api/v1-auth.spec.ts`, `v1-crud.spec.ts`, `v1-doctor-guard.spec.ts` | DB | API key authentication, CRUD, the clinician guard, cross-clinic 403/404, completion guard. **High value.** | 7s, 17s, 27s |
| `tests/api/v1-performance.spec.ts` | DB | Wall-clock `< 2000ms` **against a remote DB over the internet** (`:52-101`). Mostly measures network latency. Flaky, and not a performance test. | 5s |
| `tests/api/rate-limiting.spec.ts` | U + DB | In-memory limiter (U). The 429 envelope test needs seeding and **fails** (`:93`). | 4p 1f |
| `tests/api/webhooks-outbox.spec.ts` | U + DB | HMAC signing and SSRF validation (U). Delivery queue (DB). | 14p 9s |
| `tests/api/health-probes.spec.ts` | M | `/api/health` and `/api/ready` response shapes. | 8p |
| `tests/api/openapi.spec.ts` | U | OpenAPI document structure. | 3p |
| `tests/ops/backup-restore.spec.ts` | **D** + DB | Asserts that `docs/ops/backup-restore.md` contains strings such as `"< 2 hours"`, `"pg_dump"` and `"nmc regulation 1.3.1"` (`:17-30`), plus "tables are queryable". **It verifies no backup or restore.** | 3s |
| `tests/storage/storage-provider.spec.ts` | M | Provider selection and path-traversal guards. | 13p |

### 2.6 Messaging (MSG91), notifications and AI

| File | Type | What it actually asserts | Result |
|---|---|---|---|
| `tests/messaging/msg91-provider.spec.ts` | M (`fetch` stub) | Request URL, body and headers sent to MSG91, plus error mapping. Good contract-style tests. | 26p |
| `tests/messaging/msg91-webhook.spec.ts` | M | Webhook auth (authkey, query secret, header), the dev bypass when secrets are unset, button replies, DLR monotonic status, tenant resolution through `replyMsgId`. | 19p |
| `tests/messaging/msg91-sync-templates.spec.ts`, `outbox-queue.spec.ts`, `two-way-bot.spec.ts`, `tokenized-sharing.spec.ts` | M | Template sync, backoff and dead-letter, bot parsing, token sharing. | 14p, 13p, 10p, 14p |
| `tests/messaging/messaging-provider.spec.ts` | U + filesystem side effect | The dev provider **appends to `.planning/dev-messages.txt`** on every run (`:80`, `lib/messaging/dev-logger.ts:89`). Tests write into the planning directory. | 10p |
| `tests/notifications/in-app-notifications.spec.ts` | M | Notification creation and read state. | 12p |
| `tests/ai/ai-gateway.spec.ts`, `gateway-tools.spec.ts`, `prescription-suggestions.spec.ts`, `clinical-copilot.spec.ts` | U/M/C | Provider resolution, tool schemas and role gating, suggestion shaping, copilot markup. | 6p, 17p, 6p, 11p |
| `tests/ai/operations-copilot-ui.spec.ts` | C | Asserts **CSS classes and hex colours** (for example `#F1F2F4`, `:44`) in SSR strings. Brittle, and tied to a v1 design that v2 will replace. | 10p |
| `tests/ai/evals/*.spec.ts` (5 files) | U | Run `parseShorthandLocally`, because `lib/ai/soap-generator.ts:302-318` skips the LLM whenever `VITEST` is set (unless `AI_EVAL_LIVE=true`). They test a regex fallback, **not model behaviour**. The "prescribing guardrail" is never exercised against a real model. | 34p |

### 2.7 Summary by type

| Type | Files (approx.) | Comment |
|---|---|---|
| Pure unit (U) | ~20 | Sound, and should be kept. Schemas, phone handling, permissions, calculators. |
| Mocked unit (M) | ~17 | Useful for branching logic. Must not be counted as isolation or RLS evidence. |
| Component SSR string (C) | 3 | No interaction, no DOM, no accessibility tree. Styling asserts will break in v2. |
| DB integration on the hosted project (DB) | 27 (+3 mixed) | The highest-value tests, and currently unusable in CI. |
| Tautological (T) or doc-grep (D) | 3 | Delete or rewrite. |
| E2E (Playwright) | **0** | The config exists; the specs do not. |

---

## 3. Why 206 tests are skipped

- **Fact:** No spec uses `it.skip`, `skipIf` or `todo` (verified with grep). The 206 skips all come from Vitest's behaviour when a `beforeAll` hook throws: every test in that suite is reported as skipped and the file is marked failed. In isolated mode, `seedTenantWithOwner` throws `Failed to create test user: fetch failed` (`tests/helpers/tenants.ts:47`).
- **Risk:** A developer with no DB access, or a CI job with no DB, sees "442 passed", which looks green. In reality **every isolation and RLS test was skipped.** The release gate must require *0 skipped* in the DB lane.

> Verification (2026-11-10): PARTIALLY_CONFIRMED — TEST-ES-3: mostly true, but the no-DB run is not green: 27 files fail with a non-zero exit; some security tests run without a DB. H/P0. See VERIFICATION_LOG.md

---

## 4. Problems with the current approach

| # | Finding | Evidence | Priority |
|---|---|---|---|
| E-1 | **Problem:** Tests depend on a single hosted Supabase project, with the service-role key loaded from `.env` by the Vitest config itself. | `vitest.config.ts:5-20` reads `.env` unconditionally (only already-set variables are protected) | **P0** |
| E-2 | **Problem:** No teardown. Auth users, tenants, invitations and subscriptions accumulate on every run. | `tests/helpers/tenants.ts` (no delete); `grep afterAll` returns one hit | **P0** |
| E-3 | **Risk:** Test users share a weak, hard-coded password on a hosted project with `enable_signup = true` (`supabase/config.toml`). Leftover accounts are a real attack surface if the project is production. | `tests/helpers/tenants.ts:39` | **P0** (if the project is prod or shared) |
| E-4 | **Problem:** RLS coverage is 8 of 43 tables. Visits, consultations, prescriptions, invoices, payments, patient_documents, referrals, communication_queue, document_share_tokens, api_keys and others have no cross-tenant test. They also have no **role-within-tenant** test (for example, can a receptionist read clinical notes at the DB level?). | `tests/helpers/rls.ts:3-12`; ~100 `CREATE POLICY` statements in `supabase/migrations/*` | **P0** |
| E-5 | **Problem:** Tautological and doc-grep tests count as "passing" coverage. | §2.1, §2.2, §2.5 | P1 |
| E-6 | **Problem:** Production code branches on test environment variables, so tests exercise a different path from production: SSRF allows `http` under test, and AI uses the local parser under test. | `lib/webhooks/dispatcher.ts:94`, `lib/webhooks/ssrf.ts:103`, `lib/ai/soap-generator.ts:304` | P1 |
| E-7 | **Problem:** Tests are excluded from type checking. | `tsconfig.json` `"exclude": [..., "tests", ...]` | P1 |
| E-8 | **Problem:** No E2E, accessibility, responsive or visual tests, despite a mobile-first product promise (Indian tier-2/3 clinics on phones). | `playwright.config.ts:4`; `tests/e2e` absent | P1 |
| E-9 | **Problem:** The "performance" tests time remote network calls. There are no load tests on the queue or booking hot paths. | `tests/api/v1-performance.spec.ts:52-101` | P2 |
| E-10 | **Problem:** `fileParallelism: false` plus remote round trips makes the full suite slow. Tests share global tenant-creation state. | `vitest.config.ts:28` | P2 |
| E-11 | **Problem:** Tests write to `.planning/dev-messages.txt`, which is git-ignored but is mutated by test runs. | `lib/messaging/dev-logger.ts:89` | P3 |
| E-12 | **Problem:** Recorded verification evidence does not match the code (37/37 for a 17-test file). | `06-VERIFICATION.md:261,264` | P1 (process) |
| E-13 | **Problem:** No CI runs any tests (there is no `.github/`). | Repo root | **P0** (see INFRASTRUCTURE_ASSESSMENT) |

> Verification (2026-11-10): PARTIALLY_CONFIRMED — E-1: `.env` only fills unset variables and a local config exists but is unwired; production status unverifiable (OI-1). H (Cr if prod)/P0. See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — E-3: weak password confirmed; `enable_signup` evidence is from the local CLI config only, not the hosted project; low exploitability. L-M/P2. See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — E-4: catalog check covers 8 tables, but cross-tenant tests exist for visits, prescriptions, invoices, documents, referrals and API keys; real gaps are role-within-tenant DB tests and comms/share-token/API-key tables. H/P1. See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — E-5: copied logic and mock-only isolation tests confirmed; the backup spec also touches the DB (not only a doc grep); real RLS tests exist for 8 tables. M/P1. See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — E-13: no `.github/` or hooks confirmed; Vercel's build may still catch type errors (hosted config unverifiable). H/P0. See VERIFICATION_LOG.md

**Assumption (validate):** The hosted project in `.env` is the same project that production uses, or will use. If it is a dedicated test project, E-3 drops to P1, but E-1 and E-2 remain.

---

## 5. Coverage gap analysis against the critical areas (prompt §8)

| Area | What exists today | Real-outcome coverage in CI today | Gaps to close |
|---|---|---|---|
| **Authentication** | Dev-logger lockout (M), invite flow (DB) | **None** (the DB tests are skipped) | OTP request and verify, using local Supabase Inbucket/Mailpit or the SMS hook. Session refresh in `middleware.ts`. Unauthenticated access to every `(dashboard)` route and server action is rejected. Logout. Expired session. No shared login. Rate limiting of OTP requests. |
| **Role permissions** | `lib/permissions` matrix (U), AI RBAC (U) | Matrix only | **Every server action** calls `requirePermission` with the right permission (enforce with a table-driven test over exported actions). DB-level role restrictions (pgTAP). UI hides what the role cannot do (Playwright per role). |
| **Clinic isolation** | 8-table cross-tenant suite (DB) | None | pgTAP matrix over **all** tenant tables × {select, insert, update, delete} × {own tenant, other tenant, no membership, each role}. Storage bucket path isolation. Tokenised share links scoped and expiring. API keys scoped to one tenant. Webhook tenant resolution. |
| **Patient registration** | Schema (U), dedup (U + DB) | Schema only | Create patient → persisted with E.164 phone, audit row, consent record. Duplicate warning. Concurrent duplicate creation. Validation errors surfaced. |
| **Appointments** | Availability (U), scheduling (M), waitlist (DB) | Logic only | Double-booking prevented **by DB constraint** under concurrency (two parallel bookings → exactly one succeeds). Reschedule and cancel free the slot. Tokenised reschedule link. Timezone (IST) boundaries. |
| **Queue** | queue-flow (DB), status-actions (T) | None | Token numbering is unique and monotonic per doctor per day under concurrency. State machine rejects illegal transitions. Realtime/refresh shows the change to the receptionist. |
| **Patient record access** | visit-history (M) | None real | Doctor of tenant A cannot load a tenant B visit by URL. Nurse and receptionist field-level visibility. Access is audit-logged (PRD §5.3). Lab document signed-URL expiry. |
| **Prescriptions** | prescription-versioning, consultation-flow (DB), dosage (U) | Dosage only | Sign-off immutability (a DB trigger rejects updates to a sealed prescription). Amendment creates a revision. PDF content contains the right patient, drugs and registration number. Only clinicians can sign. |
| **Billing** | schemas (U), per-visit-billing (DB) | Schemas only | Decimal arithmetic. Partial payments. Overpayment is rejected. Concurrent payments. Invoice numbering is unique per tenant. Receipt PDF. Role restriction (no billing for doctor role, `tests/auth/rbac.spec.ts`). |
| **MSG91** | provider, webhook, outbox (M) | Good unit coverage | Contract tests at the HTTP boundary with **MSW** (not `vi.stubGlobal`). Outbox **double-dispatch** when two cron invocations overlap (`lib/messaging/dispatcher.ts:129-150` selects and then updates without an atomic claim). Stuck `processing` rows. Webhook signature in production mode (no dev bypass). DLT template IDs. |
| **AI** | Gateway (U/M), evals (local parser) | Local parser only | PII scrubbing before every provider call (MSW asserts the outbound body has no phone or name). Role gating. Guardrail evals against a **real model** in a separate nightly lane (`AI_EVAL_LIVE=true`) with a pass-rate threshold. Provider-outage fallback. |
| **Storage / documents** | Provider and path tests (M) | Path guards | Upload, signed URL, expiry and tenant-prefix enforcement against local Supabase Storage. |
| **DPDP / compliance** | consent, dpdp-rights (DB) | None | Export completeness, erasure/anonymisation, retention rules, consent gating of communications. |

---

## 6. Target test architecture

### 6.1 Layers and tooling

| Layer | Tool | Scope | Runs |
|---|---|---|---|
| Static | `tsc --noEmit` (**including `tests/`**), ESLint (tooling directories ignored), Prettier check | All | PR |
| Unit | **Vitest** (keep it) | Pure domain logic: scheduling, billing maths, phone handling, permission matrix, state machines, zod schemas | PR |
| Integration (DB) | **Vitest + local Supabase** (`supabase start` via the `supabase` CLI already in devDeps, or `supabase/setup-cli` in CI). Migrations applied from `supabase/migrations`, plus a minimal synthetic seed. | Server actions and route handlers against real Postgres, Auth, RLS and Storage | PR |
| RLS / DB contract | **pgTAP** (`supabase test db`) | Policy matrix, constraints, triggers (immutability, unique tokens), functions such as `create_clinic_with_owner` | PR |
| HTTP integrations | **MSW** (`msw/node`) | MSG91, AI provider HTTP, S3/R2. Assert the outbound request (no PII to AI, correct DLT IDs) and simulate 4xx, 5xx and timeouts. | PR |
| Component | **Vitest browser mode** or **Testing Library + jsdom/happy-dom**, for v2 design-system primitives only | Interaction, focus and keyboard behaviour of form controls (phone input, date and time pickers, dialogs). Not CSS classes. | PR |
| E2E | **Playwright** (already in devDeps), against `next start` built with local-Supabase env | ~10 critical journeys (§7) on a Desktop Chrome and a Pixel 5 profile (`playwright.config.ts` already has both) | PR (smoke subset), nightly (full) |
| Accessibility | **@axe-core/playwright** | Every page visited in E2E. Zero serious or critical violations. | PR |
| Visual regression | Playwright `toHaveScreenshot` on a small set of design-system pages | Only once the v2 design system stabilises. Not a primary safety net. | Nightly, P3 |
| Performance | **k6** (or Artillery) against staging; Lighthouse CI on 3 key pages with mobile throttling | Booking, queue and patient-open p95 under the PRD target of 1–2 s on 3G/4G (`docs/clinic-management-prd.md:170`) | Pre-release |
| Security | gitleaks, `npm audit`/OSV, Semgrep (or CodeQL), OWASP ZAP baseline on staging | See SECURITY assessment | PR / nightly |
| AI quality | Vitest eval lane with `AI_EVAL_LIVE=true` and a real provider key in a protected CI environment, **synthetic cases only** | Guardrail, SOAP extraction, ICD-10 ranking pass-rate thresholds | Nightly / pre-release |

**Recommendation (P1):** Remove the test-mode branches in production code (E-6). Inject dependencies instead: an `allowHttp` option passed explicitly by tests, and the AI provider set to `mock` through config rather than detected through `VITEST`.

### 6.2 Test environment and isolation

- **Recommendation (P0):** Create a `tests/setup/global-setup.ts` that refuses to run unless `NEXT_PUBLIC_SUPABASE_URL` points to `127.0.0.1` or `localhost` (or an allow-listed CI project). Stop reading `.env` in `vitest.config.ts`; use `.env.test` (committed, local-stack defaults only).
- **Recommendation (P0):** Run the DB lane against `supabase start`. Apply migrations from scratch on each CI run, which also catches migration drift. The local stack provides anon and service keys for local use only.
- **Recommendation (P1):** Each test file creates its own tenants through factories, using a unique run ID. A `globalTeardown` deletes every auth user and tenant tagged with that run ID. Use `supabase db reset` between CI jobs.
- **Recommendation (P1):** Allow parallel files once each file is fully tenant-scoped. Remove `fileParallelism: false`.

### 6.3 Test data strategy

- **Synthetic only.** Never copy or anonymise production data into tests.
- Phone numbers come from a reserved fake range (for example `+91 90000 0xxxx`), clearly marked. Emails use the `example.com`/`example.test` domain, which is already the convention (`tests/helpers/tenants.ts:36`). Names come from a fixed synthetic list. Never put free-text clinical notes that resemble real patients into fixtures.
- **Factories:** `tests/factories/{tenant,member,patient,visit,prescription,invoice}.ts` build on the existing `tests/helpers/tenants.ts` functions (keep them; they work). Each factory returns IDs plus an authenticated client, and registers the records for cleanup.
- **Reference data:** Use the CDCI test fixture (`scripts/seed-cdci-test-fixture.ts`) and the ICD subset, loaded into the local DB by seed. Make sure the seed scripts can target the local stack. Today they use `--env-file=.env` (`package.json` scripts), which points at the hosted project.
- **Secrets:** CI uses only local-stack keys. The AI and MSG91 live lanes use dedicated sandbox credentials held in GitHub Environments, never the production keys.

---

## 7. Critical journeys for E2E (Playwright)

All journeys run at a **phone viewport (Pixel 5)** and at desktop, with an axe scan on each page.

1. **Staff login with OTP** (local Supabase Inbucket/Mailpit, or an SMS hook stub) → lands on the role-appropriate home.

   > Update (2026-11-10, PO decisions): Journey 1 becomes **password login** (AUTH_REDESIGN J-A3). Mailpit is used only for the signup, forgot-password and invite journeys. Journeys run on the PWA device matrix (PWA_STRATEGY §9.1). New suites cover the subscription lifecycle (time-travel pgTAP, Razorpay test-mode webhooks) and AI gating (AI_STRATEGY §7). The pre-release reviewer is an isolated Claude reviewer agent (PO-10).
2. **Clinic onboarding:** create clinic → the owner membership exists → invite a receptionist → the receptionist joins.
3. **Patient registration:** receptionist registers a patient with an Indian mobile number → duplicate warning on re-entry.
4. **Book appointment:** receptionist books against doctor availability → the conflicting slot is rejected → the patient appears on the calendar.
5. **Walk-in to queue:** check in → token issued → doctor sees the patient in the cabin queue.
6. **Consultation and prescription:** doctor records notes and diagnosis, adds medicines → signs → the PDF is downloadable → the sealed prescription is read-only → amendment requires a justification.
7. **Billing:** complete and bill → partial cash payment → UPI balance → status `paid` → receipt.
8. **Role restrictions:** a receptionist cannot open a consultation, a nurse cannot prescribe, a doctor cannot see billing. Assert both the UI and a direct URL or server-action call.
9. **Clinic isolation:** a user in clinic A pastes a clinic-B patient or visit URL → 404 or denied, with nothing rendered.
10. **Patient messaging:** booking enqueues a WhatsApp message (MSW-stubbed MSG91) → a simulated DLR webhook updates the delivery status.

---

## 8. Execution strategy

| Stage | Trigger | Contents | Target duration | Gate |
|---|---|---|---|---|
| **Local (pre-push)** | Developer | typecheck, lint, unit, the affected DB tests via `supabase start` | < 3 min | Advisory |
| **PR** | Every PR to `feature/v2` / `main` | Static checks + unit + DB integration (local Supabase in the GitHub Actions service) + pgTAP + MSW contracts + `next build` (dummy env) + Playwright smoke (journeys 1, 4, 6, 8, 9) + axe + gitleaks + dependency audit | < 15 min | **Blocking.** 0 failures, **0 skipped in the DB lane** |
| **Preview** | Vercel preview deploy | Playwright smoke against the preview URL, backed by the **staging** Supabase project with synthetic data | < 10 min | Blocking for merge to main |
| **Nightly** | Cron on `main` | Full Playwright (all journeys × 2 viewports), live AI evals (sandbox key), visual regression, ZAP baseline on staging, `npm audit` | < 60 min | Opens an issue on failure |
| **Pre-release** | Release candidate tag | All of the above, plus k6 load against staging, Lighthouse mobile, a **restore drill** of the staging backup with the cross-tenant pgTAP suite run against the restored DB, and a manual exploratory pass on a real low-end Android device on a 4G network | Hours | **Release checklist sign-off by a reviewer other than the implementer** |

Flaky-test policy: quarantine within 24 h behind a tracked issue. Never use `retries` to hide failures (keep `retries: 2` only in CI for E2E, as configured, and report the retries).

---

## 9. Release acceptance criteria (v2.0)

A v2.0 release candidate is acceptable only if **all** of the following hold:

1. CI is green on the release commit: typecheck (including tests), lint with 0 errors, unit, DB integration and pgTAP all pass with **0 skipped**.
2. **The pgTAP RLS matrix covers 100% of tables with a `tenant_id` column** (generated from `information_schema`, so new tables fail the test until covered), and every case passes.
3. A table-driven test confirms that every exported server action and `app/api/**/route.ts` handler enforces authentication and the correct permission.
4. All 10 E2E journeys pass at phone and desktop viewports, with **0 serious or critical axe violations**.
5. Coverage on `features/**` and `lib/**` domain modules (billing, scheduling, queue, prescriptions, permissions) is **≥ 80% lines and ≥ 70% branches**. Coverage is a floor, not the goal.
6. There are no tautological or doc-grep tests (lint rule or review checklist).
7. MSG91 and AI contract tests pass with MSW. The outbox concurrency test proves no double send.
8. Pre-release k6: p95 < 1.5 s for patient open, booking and queue updates at the expected pilot load. **Assumption (validate):** about 50 concurrent clinics × 3 users; confirm with the product owner. *(Round 2/3: PO-13 accepted 5 clinics × 3 users, which is also the UAT pilot; k6 runs against staging on Supabase Free, whose shared CPU and 500 MB RAM make it a conservative baseline. Cap the k6 duration and volume so it does not exhaust Supabase Free egress or the front-end plan's usage limits (the Vercel plan is handled by the PO, roadmap C45); roadmap §9.1.)*
9. A staging restore drill passed within the last 30 days and is recorded in the ops runbook. *(Round 2, roadmap §9.1/FT-02: on Supabase Free the drill restores the latest encrypted logical dump, of staging before UAT start and of production during UAT, into a local stack and re-runs the pgTAP RLS suite; it repeats monthly. Round 3: before paid launch (G7) a PITR restore drill follows the Supabase Pro upgrade, roadmap V2-16.)*
10. No High or Critical open dependency vulnerability in production dependencies (`npm audit --omit=dev`).
11. Verification evidence (CI run links) is attached to each GSD phase's `VERIFICATION.md`. Hand-typed counts are not accepted.
12. *(Round 3.)* UAT exit checklist (SUBSCRIPTIONS_AND_PLANS §14.8) complete before G7 (paid launch).

---

## 10. Prioritised backlog of tests and enablers

| ID | Item | Priority | Size | Depends on |
|---|---|---|---|---|
| T-01 | Local Supabase test harness: `.env.test`, a global setup guard refusing non-local URLs, stop loading `.env` in `vitest.config.ts`, run migrations plus synthetic seed | **P0** | M | — |
| T-02 | Factories plus run-scoped teardown (delete auth users and tenants); one-off script to inventory, and with product-owner approval delete, orphan `test-*@example.com` users on the hosted project | **P0** | M | T-01 |
| T-03 | GitHub Actions PR workflow running typecheck, lint, unit and the DB lane on local Supabase | **P0** | M | T-01, INFRA CI |
| T-04 | pgTAP RLS matrix generated over all tenant tables × CRUD × {own, other, none} × roles | **P0** | L | T-01 |
| T-05 | Auth and permission guard test: enumerate server actions and route handlers; assert unauthenticated → rejected and wrong role → rejected | **P0** | M | T-01 |
| T-06 | Port the existing high-value DB suites unchanged onto the local stack (cross-tenant, invite, prescription-versioning, per-visit-billing, v1-*, dpdp-rights, queue-flow) | **P0** | S–M | T-01 |
| T-07 | Concurrency tests: double booking, queue token uniqueness, outbox double dispatch, concurrent payments | P1 | M | T-01 |
| T-08 | Prescription immutability at the DB level (trigger or policy) plus PDF content assertions | P1 | M | T-01 |
| T-09 | MSW contract tests for MSG91 (send, DLT, errors, DLR webhook in production mode) and the AI provider (no PII in the outbound body) | P1 | M | — |
| T-10 | Playwright scaffold (`tests/e2e`), auth fixture per role, journeys 1, 4, 6, 8 and 9 + axe | P1 | L | T-01 |
| T-11 | Include `tests/` in type checking (a `tsconfig.test.json`, or remove the exclude) | P1 | S | — |
| T-12 | Delete or rewrite the tautological and doc-grep tests (`navigation-roles`, `queue/status-actions`, `ops/backup-restore` §1). Rewrite the mock-based "isolation" tests as DB tests. | P1 | S | T-01 |
| T-13 | Remove `VITEST`/`NODE_ENV` branches from production code and use explicit injection | P1 | S–M | — |
| T-14 | Remaining E2E journeys (2, 3, 5, 7, 10) at both viewports | P2 | L | T-10 |
| T-15 | Coverage reporting (`@vitest/coverage-v8`) with thresholds on domain modules | P2 | S | T-03 |
| T-16 | Live AI eval lane (nightly, sandbox key, pass-rate thresholds, synthetic cases) | P2 | M | — |
| T-17 | k6 load scripts for booking, queue and patient open; Lighthouse CI mobile | P2 | M | Staging env |
| T-18 | Component interaction tests for v2 design-system primitives | P2 | M | v2 design system |
| T-19 | Visual regression on design-system pages | P3 | S | T-18 |
| T-20 | Mutation testing (Stryker) on the billing and scheduling modules | P3 | M | T-15 |
| T-21 | *(Round 3 pointer.)* Coupon, refund and credit-note test lanes are specified in SUBSCRIPTIONS_AND_PLANS §14.9 (pgTAP time travel, pure unit pricing incl. per-supply-type totals and credit-note sums, webhook contract, e2e, Razorpay test-mode checklist) and run in V2-13b | P1 | — | SUB-COUPON-01…05 |

---

## 11. Outstanding investigations (questions for the product owner)

1. **Is the Supabase project in `.env` production, staging or a dev sandbox? Does it hold any real patient data?** This determines whether E-2 and E-3 are a live-data incident (orphan test accounts with a known password on a production project).
2. Is it acceptable to delete accumulated `test-*`, `member-*`, `unlinked-*` and `dual-*` `@example.com` users and their tenants from the hosted project? (Discovery did not inspect them.)
3. What concurrency and load should v2 be validated for at launch (clinics, users per clinic, peak bookings per minute)?
4. Is there a sandbox MSG91 account and a non-production AI key that CI may use for nightly live checks?
5. Which Android devices and browsers are the support baseline for tier-2/3 clinics (this drives the Playwright device matrix)?
