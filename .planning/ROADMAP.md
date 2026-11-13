# Roadmap: clinicOS

## Milestones

- ✅ **v1.0 MVP** — 13 phases (shipped 2026-11-11, override closeout; `milestones/v1.0-ROADMAP.md`)
- 🚧 **v2.0 V2 Master Roadmap** — phases 00 … 16 (in progress)

> **Authority.** Generated from `docs/v2/V2_MASTER_ROADMAP.md` §12.2, which is the source of truth: each phase
> there states objective, scope, dependencies, expected changes, plans, acceptance, tests and evidence. GSD phase
> numbers are the roadmap IDs without the `V2-` prefix (V2-01a → `01A`; branch `v2/phase-01a-<slug>`).

> **Execution order is the roadmap's critical path, not GSD's numeric sort.** GSD sorts `01` before `01A`, but
> **V2-01a runs before V2-01**. Always name the phase explicitly (`/gsd-plan-phase 01A`); do not rely on
> auto-advance. Order: 00 → 01A → 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09A → 09B → 09C → 10 → 11 → 12 → 13
> → 13B → 13C → 14 → 15 → 16. V2-DX (design exploration, no production code) runs alongside 01A…02, outside GSD
> numbering. Gates: roadmap §16.

## Phases

<details>
<summary>✅ v1.0 MVP (13 phases, 49 plans) — SHIPPED 2026-11-11</summary>

See `milestones/v1.0-ROADMAP.md`.

</details>

### 🚧 v2.0 V2 Master Roadmap

- [x] **Phase 00: Pre-flight** - make agentic work safe and traceable. (Removing secrets that agents may have seen is deferred to V2-15 by PO ruling C49.) (completed 2026-11-11, G0)
- [ ] **Phase 01A: Local DB harness** - an executable regression net on a local stack before any auth refactor.
- [ ] **Phase 01: Security containment on feature/v2** - the v2 branch never carries the backdoors.
- [ ] **Phase 02: CI & e2e foundations** - automated, CI-produced evidence for everything after this point.
- [ ] **Phase 03: Platform hygiene** - reproducible schema, honest configuration, typed data, diagnosable failures, and a staging environment.
- [ ] **Phase 04: Jobs reliability** - no duplicate or lost messages, and no lost data while Supabase runs on the Free plan.
- [ ] **Phase 05: Database authorisation, integrity & entitlements** - the database is the last line of defence, for roles **and** for subscription access.
- [ ] **Phase 06: Design system, frontend foundation & PWA shell** - one enforced visual and interaction system, implementing the direction approved at G2-D, delivered as an installable PWA.
- [ ] **Phase 07: Atomic server commands** - every critical write is one transaction.
- [ ] **Phase 08: Front desk** - a live, fast front-desk workspace in which the most frequent tasks meet the §4 interaction targets.
- [ ] **Phase 09A: Clinical immutability & amendment** - signed clinical records cannot change except through an audited amendment.
- [ ] **Phase 09B: Consult workspace & save model** - doctors never lose consult work, and the consult is keyboard-first.
- [ ] **Phase 09C: Rx builder & PDF** - fast, safe prescriptions with a printable, trustworthy output.
- [ ] **Phase 10: Billing & collections** - billing is correct, GST-compliant and fast to collect.
- [ ] **Phase 11: Profile, registers, staff & settings, public pages** - complete the remaining screens on the new system and remove v1 UI.
- [ ] **Phase 12: Integrations, AI & API** - messaging, the AI Scribe and the public API are safe, governed and contract-tested.
- [ ] **Phase 13: DPDP lifecycle** - retention and erasure are lawful, reviewed and reversible until approved.
- [ ] **Phase 13B: SaaS subscriptions & billing** - a clinic can sign up, authorise an AutoPay mandate, use a 14-day trial with no restrictions, be debited ₹1,768.82 (₹1,499 + 18% GST) on day 15, renew, cancel at any time with access to the end of the paid period, and be stopped automatically and forcefully when access ends; a clinic can redeem one coupon code (free cycles, trial extension, `uat`, and percentage or fixed discounts once SUB-COUPON-03 is enabled), and the platform can refund a SaaS payment with a credit note (round 3).
- [ ] **Phase 13C: Platform admin & tenant data lifecycle** - the PO can run the business without the SQL editor for routine work, and clinic data follows the agreed lifecycle: 30 days locked, then archive, then purge at expiry + 180 days, with an export offered first.
- [ ] **Phase 14: Security verification & closure** - independent proof that the Critical and High findings are closed and nothing new is open.
- [ ] **Phase 15: Production readiness & UAT launch** - a controlled big-bang build (PO-15) of a new, verified production project, opened to real-world UAT clinics on Supabase Free with `uat` coupon codes (round 3, C46).
- [ ] **Phase 16: Real-world UAT & paid launch** - real clinics use the complete product in daily practice free of charge under `uat` coupons; their feedback is triaged and fixed forward; production is then upgraded to Supabase Pro + PITR, and charging full-price customers starts only after G7.

**Parallel track (not a GSD phase):** V2-DX Design exploration — approve the visual and interaction direction from rendered evidence before any primitive is built. Gate G2-D. See roadmap §12.2.

## Phase Details

### Phase 00: Pre-flight

**Roadmap ID**: V2-00 · size S · gate gate G0 (prompt Phase 0, runs after G1)
**Goal**: make agentic work safe and traceable. (Removing secrets that agents may have seen is deferred to V2-15 by PO ruling C49.)
**Depends on**: G1; PO-10 ✅, PO-11 ✅, PO-1 ✅.
**Requirements**: P0-09, P0-16a, P1-36, P2-04, P2-DOC
**Also delivers parts of**: P0-07, SUB-10
**Scope**: P0-09, P0-07 (confirm PO-1; record the rotation deferral, C49), P0-16a (test project), P1-36 (GSD for Claude Code; retire `.agents/` and `.opencode/`), P2-04, P2-DOC (errata). PO-side in parallel: SUB-10 kickoff (KYC, GST registration, policy page drafts), SES domain, GCP project (§13 table).
**Expected changes**: `.claude/settings.json`, `.planning/config.json`, `CLAUDE.md`, `docs/adr/`, the v1 archive, the tag, errata in `docs/v2/`, the hygiene items in P2-04. No secrets rotated (C49). No app code.
**Success Criteria** (what must be TRUE — roadmap *Acceptance*, verbatim):
  1. a `.env` read is denied in a test session
  2. GSD for Claude Code is installed and refuses commits on `main`
  3. `/gsd-help` works
  4. `.agents/` and `.opencode/` are removed
  5. the rotation deferral (C49) is recorded in `docs/ops/secret-rotation.md`
  6. P0-16a recorded (erratum 2026-11-10, C49).
**Tests**: a manual deny-rule check, recorded. (The post-rotation smoke check moves to V2-15, C49.)
**Evidence**: a log of the denied read; `git tag` output; config diff; the rotation record (names and dates only, never values; deferral per C49); the backup/PITR record or the test-restore log.
**Plans**: completed before GSD v2.0 existed (evidence: `docs/v2/VERIFICATION_LOG.md`, G0) — roadmap split: 00-01 agent safety + config; 00-02 rotation deferral record (C49) + backup check; 00-03 GSD install + v1 archive; 00-04 CLAUDE.md + ADR folder + errata + P2-04 hygiene.

### Phase 01A: Local DB harness

**Roadmap ID**: V2-01a · size M · gate G3-partial (prompt Phase 3; precedes containment)
**Goal**: an executable regression net on a local stack before any auth refactor.
**Depends on**: G0. No PO decision beyond PO-11.
**Requirements**: P0-10
**Also delivers parts of**: AUTH-00
**Scope**: P0-10 (plan 02-01 of the earlier draft): `.env.test`, a global guard refusing non-local Supabase URLs, Vitest stops loading `.env`, migrations + synthetic seed, run-scoped teardown, and the existing 27 DB-backed suites running **unchanged** on `supabase start`; **AUTH-00** local spike (written note pinning `verifyOtp` types, `/otp` behaviour, the pre-account-hijack fix and session deletion).
**Expected changes**: `vitest.config.ts`, `tests/helpers/**`, `supabase/seed*.sql` (synthetic), a test script. No app code.
**Success Criteria** (what must be TRUE — roadmap *Acceptance*, verbatim):
  1. all 69 files run locally with 0 failures attributable to the environment
  2. 0 skipped in the DB lane
  3. the guard aborts a run pointed at any non-local URL
  4. zero tests reach a hosted URL.
**Tests**: the existing suites themselves, plus a test that the guard rejects a hosted URL.
**Evidence**: the local run log (counts produced by the runner, not hand-typed) and the guard test output. CI links become available in V2-02.
**Plans**: TBD — roadmap split: 01a-01 harness + non-local-URL guard; 01a-02 run and stabilise the existing DB suites locally; 01a-03 teardown; 01a-04 AUTH-00 spike note.

### Phase 01: Security containment on feature/v2

**Roadmap ID**: V2-01 · size L · gate G3-partial (pulled forward from prompt Phase 5)
**Goal**: the v2 branch never carries the backdoors.
**Depends on**: **V2-01a** (the suites run before and after the override removal); G0; G1 + ADR-005 ratified. It does not wait for the rest of G2, because containment needs no design or frontend decision.
**Requirements**: P0-01, P0-02, P0-03, P0-04, P0-05, P0-06, P1-23, SUB-10, AI-01, AUTH-01
**Also delivers parts of**: AUTH-04
**Scope**: P0-01 to P0-06 (full versions), P1-23, the interim API PATCH guard for signed visits (DB-13/API-04), `/api/v1` disabled behind an env switch (PO-16 default); **AUTH-01** (delete OTP login paths and the dev shortcut) with **AUTH-04a** (minimal password sign-in and forgot password), so a working login always exists; **AI-01** (remove both copilots, the drawer, the mic and the mock provider; the scribe fails closed).
**Expected changes**: the 16 `"use server"` modules' signatures, `server-only` services, the 4 non-action files' override parameters, migrations for memberships, tokens and SECURITY DEFINER functions, webhook route, token routes, lab-orders route, `app/api/v1/visits/[id]` guard, the rewired test helpers.
**Success Criteria** (what must be TRUE — roadmap *Acceptance*, verbatim):
  1. the grep/AST rule finds 0 override params
  2. forged-override calls are rejected
  3. a receptionist PATCH of `role` is denied
  4. `/api/webhooks/messaging/dev` returns 404 or 401
  5. a cross-tenant token returns 404
  6. a PATCH of a completed visit through `/api/v1` is rejected
  7. seeded users sign in by password and a normal login sends 0 emails (Mailpit)
  8. grep finds 0 `shouldCreateUser`/`devOtp`
  9. no `/api/ai/*` copilot route is reachable
  10. the existing suites pass on the local stack before and after.
**Tests**: unit + DB integration (local) + new regression tests for each P0 exploit; the P0-13 guard enumeration lands in V2-02.
**Evidence**: local runner logs for before/after; CI run links once V2-02 merges; the independent security reviewer's sign-off.
**Plans**: TBD — roadmap split: 01-01 overrides → services (tests rewired off `sessionOverride`); 01-02 membership guard RPC; 01-03 webhook lockdown; 01-04 token binding + RPC; 01-05 lab-orders path + next patch + API PATCH guard; 01-06 AUTH-01 + AUTH-04a password login; 01-07 AI-01 containment.

### Phase 02: CI & e2e foundations

**Roadmap ID**: V2-02 · size M · gate G3-partial (prompt Phase 3)
**Goal**: automated, CI-produced evidence for everything after this point.
**Depends on**: V2-01 (override seams gone), V2-01a.
**Requirements**: P0-11, P0-13, P1-27
**Also delivers parts of**: P1-41, AI-06, PWA-08
**Scope**: P0-11, P0-13, P1-27 (Playwright scaffold, characterisation e2e = M0 using password login, type-checked tests, removal of tautological tests), P1-41 (coverage reporting, report-only), PWA-08a (device projects: Desktop, Pixel 7, iPhone 15 in the PR lane; full matrix nightly), AI-06 L1 lane (AI copy and route greps). The L2 gating contract matrix needs the entitlement functions and lands in V2-05 (database part) and V2-12 (gateway part).
**Expected changes**: `.github/workflows/**`, branch protection, `CODEOWNERS`, `eslint.config.*` (tooling dirs ignored), `tests/e2e/**`, `tsconfig` for tests, `tests/security/guard-*.spec.ts`.
**Success Criteria** (what must be TRUE — roadmap *Acceptance*, verbatim):
  1. the PR lane is green with 0 skipped in the DB lane
  2. adding an unguarded server action makes the guard test fail
  3. the M0 baseline report is committed.
**Tests**: the pipeline runs the full unit + DB lane; a deliberately unguarded fixture action proves the guard test fails; the 6 characterisation flows on v1 screens.
**Evidence**: CI run links; the M0 baseline appendix (screenshots, axe reports, interaction counts).
**Plans**: TBD — roadmap split: 02-01 CI pipeline + branch protection + CODEOWNERS; 02-02 guard enumeration test (P0-13); 02-03 Playwright + 6 characterisation flows + axe baseline; 02-04 test type-checking and quality clean-up; 02-05 coverage reporting.

### Phase 03: Platform hygiene

**Roadmap ID**: V2-03 · size M-L · gate G3-partial (prompt Phase 3)
**Goal**: reproducible schema, honest configuration, typed data, diagnosable failures, and a staging environment.
**Depends on**: V2-02; G2 (ADRs ratified); free-tier staging accounts created (PO-side task, §13; PO-17 ✅, FT-01), PO-19 ✅ (email domain), SES domain records (PO-side).
**Requirements**: P1-15, P1-21, P1-34, P1-35a, P1-43, P2-01, P2-03, AUTH-00, AUTH-02, AUTH-04, FT-05
**Also delivers parts of**: P1-25, AUTH-03, FT-01, FT-07
**Scope**: P1-15, P1-21, P1-34, P1-35a (staging), P1-25 (error tracking + structured logger + request IDs), P1-43, P2-01 (Next 16 decision), P2-03, I-07, the **D1 confirmation spike** (C18); **AUTH-02** (auth config as code, drift check), **AUTH-03** on staging (SES + Send Email hook), **AUTH-04b** (change password, error mapping, safe `next`, `POST /auth/signout`, Turnstile) with the **FT-05** leaked-password check, and the AUTH-00 staging re-check; **FT-01** staging layout (Supabase Free in its own organisation, the v1 test project paused first, Vercel staging set up by the PO, with the `bom1` region check) and the **FT-07** event sink.
**Expected changes**: `lib/env.ts` (zod schema), `lib/supabase/system.ts` (single factory) and removal of the other 4 factories, `supabase/migrations/` baseline + drift report, generated `types/database.ts`, ESLint boundary rules, `lib/datetime/**` and the 29 call sites, `lib/storage/**` (R2/S3 removed), `lib/log/**`, error-tracking config, staging project config, removal of `VITEST`/`NODE_ENV` branches, one RPC from the spike, `lib/auth/pwned.ts` (FT-05), event-retention settings (FT-07).
**Success Criteria** (what must be TRUE — roadmap *Acceptance*, verbatim):
  1. production boot fails without real providers
  2. ESLint finds 1 service-role factory (`lib/supabase/system.ts`) and 0 service-role imports outside the allow-list and the ADR-0005 exception register (`app/api/v1/**` + `lib/api/**` until P1-37; `lib/messaging/dispatcher.ts`, `lib/webhooks/**`, `app/api/cron/**` until V2-04), and the bypass fixtures fail lint (erratum 2026-11-10, C50)
  3. a fresh `db reset` matches the target schema (drift = 0 or documented)
  4. `tsc` passes with generated types
  5. 0 UTC "today" sites
  6. the spike report shows RLS, `auth.uid()` actor, audit and outbox in one transaction
  7. staging deploys from CI
  8. a thrown server error appears in the India-resident error sink with PII scrubbed
  9. staging sends a **password-reset** code through SES with DKIM passing
  10. Turnstile is on sign-in and reset (signup does not exist until V2-13b)
  11. `POST /auth/signout` clears the session server-side and returns `Clear-Site-Data: "cache"`
  12. the auth config drift check is green
  13. a password from the Pwned Passwords corpus is rejected by the change-password and reset actions (FT-05)
  14. staging functions run in `bom1`, or the deviation is recorded (FT-01).
**Tests**: unit; IST boundary tests at 00:00–05:30; the env-schema boot test; the spike RPC's DB integration test incl. rollback on fault; a scrubber test; FT-05 unit tests with a mocked range API (hit, miss, API down).
**Evidence**: CI links; the drift report (read-only against the hosted project); the spike report; a staging deploy link; an `ops.error_events` row export with scrubbed fields.
**Plans**: TBD — roadmap split: 03-01 env schema + fail-closed providers; 03-02 single system DB factory; 03-03 baseline/drift (B1) + migration immutability + generated types; 03-04 ESLint boundaries + tooling ignores; 03-05 `lib/datetime` + replace the 29 sites; 03-06 Next 16 decision (PR or written deferral); 03-07 **D1 confirmation spike** (one atomic RPC end to end); 03-08 staging environment (FT-01); 03-09 error tracking + structured logger + request IDs; 03-10 R2/S3 removal + test-env branch removal; 03-11 AUTH-02 + AUTH-03 (staging); 03-12 AUTH-04b + FT-05 + AUTH-00 staging re-check.

### Phase 04: Jobs reliability

**Roadmap ID**: V2-04 · size M · gate G3-partial (prompt Phase 3)
**Goal**: no duplicate or lost messages, and no lost data while Supabase runs on the Free plan.
**Depends on**: V2-02; V2-03 plans 03-08 (staging) and 03-09 (logging); PO-6, PO-17 ✅; an AWS account in `ap-south-1` (PO-side, shared with SES); pg_cron and pg_net confirmed on the staging Free project.
**Requirements**: P0-12, FT-03
**Also delivers parts of**: P1-25, FT-02, FT-04
**Scope**: P0-12, P1-25 (alerts part), **FT-02** (backup job built and drilled on staging), **FT-03** (heartbeat), **FT-04** (quota monitor job).
**Expected changes**: a migration with the claim/lease/reaper RPC and the scheduler (pg_cron + pg_net, C22), `app/api/jobs/run/route.ts`, `lib/messaging/dispatcher.ts` and `lib/webhooks/dispatcher.ts` (inline dispatch removed), webhook idempotency keys, alert rules; the backup task as code (`ops/backup/`), the S3 bucket policy, heartbeat and quota-check jobs, `docs/runbooks/backup-restore.md`.
**Success Criteria** (what must be TRUE — roadmap *Acceptance*, verbatim):
  1. the parallel-dispatcher test shows 0 duplicate sends
  2. a stuck `processing` row is reclaimed
  3. queue lag p95 < 2 min in staging (**Assumption (validate)**)
  4. an alert fires in the staging drill
  5. an encrypted dump of staging lands in the `ap-south-1` bucket twice a day and a deliberately failed run raises an alert
  6. the first restore drill rebuilds staging data in a local stack and passes the pgTAP RLS suite, with RPO and RTO recorded
  7. the heartbeat row is written every 6 h
  8. the quota job reports database, Storage and MAU usage against the 60 %/70 % thresholds.
**Tests**: concurrency (T-07 subset) with N parallel dispatchers; reaper test; MSW contract for MSG91; scheduler migration test on the local stack; the scripted restore drill; a quota-threshold unit test.
**Evidence**: CI links; the staging alert-drill record; the restore-drill record in VERIFICATION_LOG; a bucket listing (object names and sizes only, never contents).
**Plans**: TBD — roadmap split: 04-01 claim/lease/reaper RPC; 04-02 scheduler + `/api/jobs/run`; 04-03 remove inline dispatch + webhook idempotency; 04-04 dead-letter and lag alerts; 04-05 FT-02 backup job + first restore drill; 04-06 FT-03 heartbeat + FT-04 quota monitor.

### Phase 05: Database authorisation, integrity & entitlements

**Roadmap ID**: V2-05 · size XL · gate G3 (may be split at plan time into 05a role RLS and integrity, plans 05-01…05-04, 05-06, 05-08; and 05b membership, invites and entitlements, plans 05-05, 05-07, 05-09, 05-10) (prompt Phase 3/5)
**Goal**: the database is the last line of defence, for roles **and** for subscription access.
**Depends on**: PO-3 ✅; V2-02; V2-04 (outbox, for invite emails); **V2-03 plan 03-03** (B1 drift baseline + generated types) and **plan 03-07** (D1 spike, for the audit triggers); **P0-16a recorded**; the diagnostics run.
**Requirements**: P1-01, P1-02, P1-08, P1-10, P1-11, P1-39, P1-40, SUB-01, SUB-02
**Also delivers parts of**: P0-14, P1-04, P2-08, AI-03, AI-06, AI-18, AUTH-05, AUTH-06
**Scope**: P1-01, P1-02, P1-04 (trigger part), P1-08, P1-10, P1-11, P1-39, P1-40, P2-08 (FK indexes), P0-14 backend part; **AUTH-05** (replaces P1-09); **AUTH-06** backend (replaces P0-15); **SUB-01** (product catalogue with billing models and GST-exclusive prices, entitlements, access functions, seeds, `comp_until`); **AI-18** (AI catalogue rows not purchasable, the 1,500-draft trial quota, the availability switch); **SUB-02** (hard stop in RLS and storage policies, guards, functional locked pages); **AI-03** DB part (opt-in, objection flag, kill switch, quota reservations); **AI-06 L2** database part (the gating contract matrix against `has_entitlement`, opt-in, objection, kill switch and quota).
**Expected changes**: migrations for `has_permission()` (CASE over 5 roles, C19) and per-domain policies, composite FKs, RESTRICT, `memberships.status`, key revocation, referral and export rules, the exclusion constraint, the queue-token counter, FK indexes; `lib/permissions/**` parity test; invite delivery service; pgTAP files.
**Success Criteria** (what must be TRUE — roadmap *Acceptance*, verbatim):
  1. the pgTAP matrix covers 100% of tenant tables and passes
  2. a receptionist PostgREST read of `clinical_notes` is denied (per PO-3)
  3. a cross-tenant child insert fails
  4. a removed member reads 0 rows with a still-valid JWT
  5. a receptionist can register a patient
  6. two overlapping non-overbooked appointments cannot both be inserted
  7. 50 parallel check-ins produce 50 distinct tokens with the IST date
  8. with `p_now` past `access_ends_at`, a locked tenant gets 0 rows from every clinical table and storage bucket
  9. `authenticated` cannot execute any `billing_internal.*` function
  10. one invite sends exactly one email under retry
  11. **after plan 05-10 (SUB-02) every existing DB suite stays green**, with all test tenants seeded `trialing` or comped
  12. the seeded Standard price derives a 176882-paise charge from base 149900 and 1800 bp
  13. no product is purchasable except Standard, `platform.set_product_availability` refuses `purchasable = true` for a product without an active provider price, and a `trialing` tenant has `ai.scribe` with a 1,500 limit while an `active` Standard tenant has none (PO-25 default). Note: from V2-05 onward `create_clinic_with_owner` creates `incomplete` tenants, so seeds must set a subscription row.
**Tests**: the generated pgTAP matrix (roles × access levels); the `has_permission` parity unit test; time-travel pgTAP for trial, grace, expiry and archive; concurrency tests for check-in, booking and `ai_reserve`; invite pgTAP cases; migration tests on a copy seeded with the diagnostics' edge cases.
**Evidence**: CI pgTAP report; diagnostics report; `/gsd-secure-phase` output; independent reviewer sign-off.
**Plans**: TBD — roadmap split: 05-01 `has_permission()` + parity test + generated pgTAP matrix; 05-02 clinical-table policies per domain; 05-03 composite FKs (NOT VALID → VALIDATE); 05-04 RESTRICT + delete-policy removal; 05-05 AUTH-05 membership status, removal and revocation; 05-06 referrals + exports; 05-07 AUTH-06 invitations v2 backend; 05-08 exclusion constraint + queue-token counter + FK indexes; 05-09 SUB-01 schema, access functions, seeds and SQL runbook + AI-18 catalogue seeds; 05-10 SUB-02 enforcement (RLS, storage, guards, locked pages) + AI-03 DB.

### Phase 06: Design system, frontend foundation & PWA shell

**Roadmap ID**: V2-06 · size L · gate G3 (prompt Phase 3)
**Goal**: one enforced visual and interaction system, implementing the direction approved at G2-D, delivered as an installable PWA.
**Depends on**: **G2-D**; V2-02 (M0); the Next 16 decision (V2-03 plan 03-06) before plan 06-02.
**Requirements**: P1-28, P2-02, AI-02, PWA-01, PWA-02, PWA-04, PWA-07
**Also delivers parts of**: AI-16, PWA-03, PWA-05, PWA-08, PWA-09
**Scope**: P1-28 (M1–M3), P2-02 (bundle budgets), **PWA-01, PWA-02, PWA-03 (shell), PWA-04, PWA-05 (update/skew/lock client side), PWA-07, PWA-08b (specs 1–6, 8, 10, 11), PWA-09 (report-only)**, AI-02 (labelling), AI-16 (help search, if time permits).
**Expected changes**: `app/globals.css` tokens, font loading, `components/ui/**` (shadcn/Radix), `components/clinical/**`, the app shell, nav, command palette, `loading.tsx`/`error.tsx`/`not-found.tsx`, toasts, `/dev/ui`, grep guards, the hex-class codemod; `app/manifest.ts`, icons, `public/sw.js`, `/offline`, `hardSignOut()`, `/api/session-status`, install sheet.
**Success Criteria** (what must be TRUE — roadmap *Acceptance*, verbatim):
  1. axe shows 0 serious or critical issues on the gallery
  2. screenshots at 360/820/1180/1280 (the V2-DX widths) match the G2-D direction and are approved by the PO
  3. the grep guards, including the AI-02 "AI" copy grep, are in report mode
  4. v1 screens still work (M0 e2e green)
  5. Chrome reports the app installable
  6. the cache-audit spec finds no authenticated response in Cache Storage
  7. every sign-out path clears caches and storage.
**Tests**: Playwright screenshot + axe on `/dev/ui`; unit tests for primitives' keyboard and focus behaviour; the M0 characterisation suite.
**Evidence**: CI links, the screenshot set, the bundle report, design review notes.
**Plans**: TBD — roadmap split: 06-01 tokens + fonts + codemod + AI/Smart Assist labels; 06-02 primitives (Radix/shadcn) with input modes + `/dev/ui`; 06-03 clinical components; 06-04 shell (safe areas, `dvh`), IA, palette, route states, toasts; 06-05 manifest, icons, service worker, offline page, `hardSignOut()`; 06-06 install UX, update/skew/lock handling; 06-07 bundle budgets + Lighthouse CI (report-only).

### Phase 07: Atomic server commands

**Roadmap ID**: V2-07 · size L · gate G4 (prompt Phase 4)
**Goal**: every critical write is one transaction.
**Depends on**: V2-05; the D1 spike report (V2-03).
**Requirements**: P1-04, P1-05
**Also delivers parts of**: PWA-06
**Scope**: P1-05, P1-04 (in-tx audit), BACKEND D2-D4, PR-5 to PR-7, **PWA-06a** (`client_request_id` idempotency on every write RPC).
**Expected changes**: one migration per command group with plpgsql RPCs (`SECURITY INVOKER`); thin `server-only` service wrappers mapping errors to `AppError`; idempotency keys; the slots query.
**Success Criteria** (what must be TRUE — roadmap *Acceptance*, verbatim):
  1. fault injection after step 1 persists nothing
  2. double-submit produces one record
  3. concurrency tests pass
  4. audit and outbox rows exist only for committed commands.
**Tests**: DB integration per RPC (happy path, fault injection, RLS denial per role); concurrency tests; idempotency tests.
**Evidence**: CI links.
**Plans**: TBD — roadmap split: 07-01 sign-off, amendment, check-in; 07-02 invoice, payment; 07-03 walk-in, register+book, collect, slots query.

### Phase 08: Front desk

**Roadmap ID**: V2-08 · size L · gate G4 (prompt Phase 4)
**Goal**: a live, fast front-desk workspace in which the most frequent tasks meet the §4 interaction targets.
**Depends on**: V2-06, V2-07, PO-3 ✅.
**Requirements**: P0-14, P1-07, P1-12, P1-20, P1-29, P1-30, P1-31, P2-08, AI-13, AI-14
**Also delivers parts of**: P1-42, PWA-03, PWA-06, PWA-10
**Scope**: P1-29, P1-30, P1-31, P1-20, P1-07, P1-12, P0-14 UI part (receptionist registration; QuickRegister includes the patient AI-objection field `ai_processing_objected` and the AI notice text, with placeholder wording finalised by AI-17 in V2-12, so the flow is not reworked later), P2-08 (trigram search index), P1-42 journeys for this phase (M4.1–M4.3); **AI-13** (slot suggestions), **AI-14** (duplicate detection), **PWA-03b** (tablet two-pane Today), **PWA-06b** (retry and SaveStatus), **PWA-10** early real-device run.
**Expected changes**: `app/(dashboard)/today/**`, `components/today/**`, PatientPicker + QuickRegister, booking/reschedule/cancel/no-show UIs and commands, the visit state machine, the clinic switcher, Smart Assist slot suggestions and duplicate detection, the search GET route, Realtime channel config; the v1 dashboard, queue and booking screens deleted as they are replaced (no flags, PO-15).
**Success Criteria** (what must be TRUE — roadmap *Acceptance*, verbatim):
  1. the M4 template (FRONTEND_MIGRATION_PLAN §3) is met
  2. the two-tenant Realtime isolation test passes
  3. the overbook path creates exactly one patient
  4. slots are correct with the device TZ set to UTC
  5. interaction targets are met
  6. the receptionist can register a patient (PO-3)
  7. a timed-out walk-in retried with the same request ID creates one visit
  8. the tablet layout matches the prototype at 744/820/1180.
**Tests**: e2e golden paths on the device matrix (PWA §9.1), including journeys 2 and 3 (P1-42); the Realtime isolation test; state-machine unit and DB tests; slot tests across IST boundaries.
**Evidence**: CI e2e links, axe report, PO walkthrough notes, the early real-device checklist record.
**Plans**: TBD — roadmap split: 08-01 visit state machine + `/consultation/[id]` gate; 08-02 PatientPicker + QuickRegister + search endpoint; 08-03 Today workspace + Realtime/polling; 08-04 booking, reschedule, cancel, no-show (staff + patient fixes); 08-05 clinic switcher + Smart Assist slots and duplicates; 08-06 early real-device run.

### Phase 09A: Clinical immutability & amendment

**Roadmap ID**: V2-09a · size M · gate G4 (prompt Phase 4, DB)
**Goal**: signed clinical records cannot change except through an audited amendment.
**Depends on**: V2-05, V2-07 (amendment command).
**Requirements**: P1-03
**Scope**: P1-03 (DB and storage parts), BACKEND A6 (full).
**Expected changes**: migrations with immutability triggers on signed visits, notes, prescriptions and items; the amendment RPC; storage policies (no member DELETE on lab documents); write-once PDF paths with SHA-256.
**Success Criteria** (what must be TRUE — roadmap *Acceptance*, verbatim):
  1. an UPDATE of a signed row is blocked except through amendment
  2. an amendment creates a new version with an audit row
  3. a finalised PDF cannot be overwritten
  4. PDF hashes are stored.
**Tests**: pgTAP immutability tests per role; amendment DB integration tests; storage policy tests.
**Evidence**: CI pgTAP report; security reviewer sign-off.
**Plans**: TBD — roadmap split: 09a-01 immutability triggers + amendment RPC; 09a-02 write-once PDFs + hashes + storage policies.

### Phase 09B: Consult workspace & save model

**Roadmap ID**: V2-09b · size L · gate G4 (prompt Phase 4)
**Goal**: doctors never lose consult work, and the consult is keyboard-first.
**Depends on**: V2-09a, V2-06.
**Requirements**: AI-07, AI-09, AI-10, AI-15, AI-16, PWA-03
**Also delivers parts of**: P1-24, P1-32, PWA-06
**Scope**: P1-32 (workspace part), P1-24 (in-consult upload dropzone), P1-42 journey 5; Smart Assist **AI-07** (terminology), **AI-09** (shorthand), **AI-10** (patient snapshot), **AI-15** (follow-up → proposed appointment); PWA-03b (two-pane consult) and PWA-06b. The AI Scribe is added in V2-12 (C37).
**Expected changes**: `app/(dashboard)/consultation/[id]/**`, `components/consultation/**` rebuilt from the 1,681-line workspace, draft versioning, the unload guard, explicit save state, conflict detection, the upload dropzone.
**Success Criteria** (what must be TRUE — roadmap *Acceptance*, verbatim):
  1. kill the tab mid-note and the draft is restored up to the last server autosave (≤ 5 s; PWA D3, no PHI on the device)
  2. a concurrent edit shows a conflict prompt
  3. an upload in the consult is stored and listed
  4. each Smart Assist feature works with AI fully disabled
  5. the PO completes a walkthrough.
**Tests**: e2e for the consult journey at both viewports; save-model unit tests; conflict DB test.
**Evidence**: CI e2e links, axe report, PO walkthrough notes.
**Plans**: TBD — roadmap split: 09b-01 save model (draft versions, conflict prompt, unload guard); 09b-02 two-pane workspace + templates; 09b-03 upload dropzone.

### Phase 09C: Rx builder & PDF

**Roadmap ID**: V2-09c · size M · gate G4 (prompt Phase 4)
**Goal**: fast, safe prescriptions with a printable, trustworthy output.
**Depends on**: V2-09b, V2-09a.
**Requirements**: P1-32, AI-08, AI-11, FT-04
**Also delivers parts of**: P2-10, PWA-12
**Scope**: P1-32 (Rx part), P2-10 (Rx print stylesheet and letterhead), **AI-11** (allergy check, replaces P2-12: substance-level only; class-level deferred to v2.1 per PO-22), **AI-08** (Rx favourites fix), PWA-12 (camera capture, Web Share of the Rx PDF), **FT-04** client-side image compression for captured and uploaded documents, and the decision whether Rx PDFs are stored or regenerated on demand (Storage quota, §9.1).
**Expected changes**: `components/prescriptions/**` keyboard Rx builder, the PDF template, print CSS, the allergy check against CDCI salt mapping.
**Success Criteria** (what must be TRUE — roadmap *Acceptance*, verbatim):
  1. a 3-drug Rx can be written without the mouse
  2. the PDF matches the golden file and its hash is stored
  3. a known allergen triggers an inline warning
  4. SA-02 (Rx favourites) never returns another doctor's Rx (RLS/DB test)
  5. a phone photo is compressed below the agreed size budget before upload (FT-04).
**Tests**: golden-file PDF tests; Rx builder e2e; allergy-check unit tests.
**Evidence**: CI links, PDF samples, PO walkthrough notes.
**Plans**: TBD — roadmap split: 09c-01 keyboard Rx builder; 09c-02 PDF + print stylesheet + letterhead; 09c-03 allergy check.

### Phase 10: Billing & collections

**Roadmap ID**: V2-10 · size M · gate G4 (prompt Phase 4)
**Goal**: billing is correct, GST-compliant and fast to collect.
**Depends on**: PO-4 ✅, V2-07.
**Requirements**: P1-06, P1-33, P2-10, PWA-06, PWA-12
**Scope**: P1-06 (PO-4 ✅: cancel, void, refund, Indian-FY numbering), P1-33, P2-10 (receipt print), P1-42 journey 7, PWA-06b, PWA-12 (share the invoice PDF).
**Expected changes**: billing migrations (status guards, money CHECKs, FY counter, one active invoice per visit), cancel/void/refund commands, `lib/money`, the collect UI and collections register, receipt print CSS.
**Success Criteria** (what must be TRUE — roadmap *Acceptance*, verbatim):
  1. an edit after payment is rejected
  2. overpayment is rejected
  3. refund and cancel flows work
  4. FY numbering has no gaps under 50 parallel creates
  5. amounts are formatted en-IN.
**Tests**: concurrency tests; DB constraint tests; `lib/money` unit tests; e2e journey 7.
**Evidence**: CI links, PO walkthrough notes.
**Plans**: TBD — roadmap split: 10-01 invariants + FY counter; 10-02 cancel/void/refund; 10-03 collect UI + collections; 10-04 receipt print.

### Phase 11: Profile, registers, staff & settings, public pages

**Roadmap ID**: V2-11 · size M · gate G4 (prompt Phase 4)
**Goal**: complete the remaining screens on the new system and remove v1 UI.
**Depends on**: V2-06, V2-05 (AUTH-05/06 backend), V2-08; PO-5 ✅.
**Requirements**: P1-24, P1-42, P2-05, AUTH-05, AUTH-06, AUTH-09, FT-06, FT-07
**Also delivers parts of**: AUTH-08
**Scope**: P2-05, staff lifecycle UI (AUTH-05), invites UI (AUTH-06), **AUTH-08 clinic side** (owner TOTP, `requireRecentAuth`, email change, owner transfer), **AUTH-09** (session policy, sign out everywhere, idle local sign-out) with **FT-06** (app-side time-box and inactivity on Supabase Free) and **FT-07** (auth events kept ≥ 180 days), P1-24 (labs relabel, PO-5 ✅), P1-42 journey 10, "Install app" and "Check for updates" entries, M5 cleanup and enforcement (palette reset, grep guards at error).
**Expected changes**: patient profile and history, paginated registers with URL filters, staff and settings pages, public token pages, the labs navigation label, deletion of v1 components, grep guards switched to error.
**Success Criteria** (what must be TRUE — roadmap *Acceptance*, verbatim):
  1. registers are paginated server-side
  2. public token pages pass axe at 320 px
  3. an owner can invite, suspend and remove staff end to end (invite email via Mailpit, set password, sign in)
  4. an owner can enrol TOTP and sensitive actions require aal2 once enrolled
  5. a session older than 14 days or idle for more than 7 days is signed out by the app (FT-06, time-travel test)
  6. every remaining v1 component is deleted (no soak period, PO-15).
**Tests**: e2e for staff onboarding (J-A2), MFA (J-A7) and journey 10; axe on public pages; grep guards at error in CI.
**Evidence**: CI links, axe reports, the deletion diff.
**Plans**: TBD — roadmap split: 11-01 patient profile + history; 11-02 registers; 11-03 staff + invites + settings; 11-04 public token pages + labs relabel; 11-05 owner MFA, re-auth and session policy; 11-06 M5 cleanup.

### Phase 12: Integrations, AI & API

**Roadmap ID**: V2-12 · size XL · gate G4 (may be split at plan time into 12a messaging, dependency majors and API, plans 12-01…12-04 and 12-08; and 12b AI, plans 12-05…12-07) (prompt Phase 4)
**Goal**: messaging, the AI Scribe and the public API are safe, governed and contract-tested.
**Depends on**: V2-04, V2-05, V2-09b (save model); PO-8 ✅, PO-9 ✅, PO-16 ✅, PO-21 ✅, PO-22 ✅, PO-25; GCP/Vertex account and MSG91 templates (PO-side).
**Requirements**: P1-13, P1-14, P1-19, P1-26, P1-37, P2-09, AI-03, AI-04, AI-05, AI-06, AI-17
**Scope**: P1-13, P1-14 (**appointment reminders only**, PO-8 ✅), P1-19, P1-26, P1-37 (P2 while PO-16 = no consumers), P2-09; **AI-03** app part (`requireEntitlement`, opt-in UI, objection flag UI, kill switch, the trial **"Preview"** label and note, PO-21), **AI-04** gateway + Vertex `asia-south1` adapter (supersedes P1-16), **AI-05** Scribe v2 (C37), **AI-06** L2 gateway part and L3 evals, **AI-17** provider setup and terms.
**Expected changes**: governance at enqueue and send, appointment-reminder producers, `lib/integrations/ai` (gateway, pseudonymiser, Vertex adapter, `ai_calls`), the scribe UI with per-section accept, zod 4 + AI SDK + `@supabase/ssr` upgrades, the Postgres rate limiter, `withApi` + `api_authenticate()`, OpenAPI generation, masked webhook secrets.
**Success Criteria** (what must be TRUE — roadmap *Acceptance*, verbatim):
  1. opt-out, consent and quiet hours are enforced (tests)
  2. each appointment gets at most one reminder per window
  3. no PII in the AI outbound body (MSW contract)
  4. Vertex calls go only to the `asia-south1` regional host
  5. a non-entitled, opted-out, objected, over-quota or killed request returns its specific message and never calls the provider
  6. during the trial the scribe carries the "Preview" chip and the note "AI features are in preview and not yet offered as a paid product", shows no quota meter, upsell or price, and still requires the owner's opt-in before the first draft
  7. after the trial (PO-25 default) the scribe entry point is absent and the server denies `ai.scribe`
  8. the L3 thresholds are met
  9. API v1 contract tests are backward compatible
  10. `npm audit --omit=dev` reports 0 high or critical
  11. webhook secrets are not returned by the list action.
**Tests**: governance unit and DB tests; MSW contracts for MSG91 and AI; API contract tests; rate-limit tests across two instances; the full CI suite after each major upgrade.
**Evidence**: CI links, the audit report, the OpenAPI diff; AI-17 configuration evidence (Vertex context caching and request-response logging off, the ZDR request outcome, the GCP budget alert and Vertex quota set).
**Plans**: TBD — roadmap split: 12-01 messaging governance; 12-02 appointment reminders; 12-03 dependency majors; 12-04 Postgres rate limiting (P1-26; needed by the gateway); 12-05 AI gateway + gating + provider setup (AI-03/04/17); 12-06 Scribe v2 (AI-05); 12-07 L3 evals + kill-switch and outage drills (AI-06); 12-08 API hardening + webhook secret masking.

### Phase 13: DPDP lifecycle

**Roadmap ID**: V2-13 · size L · gate G4 (prompt Phase 4/5)
**Goal**: retention and erasure are lawful, reviewed and reversible until approved.
**Depends on**: PO approval of the retention schedule (PO-12: no counsel); V2-04 (jobs); V2-05 (RLS); P0-16a.
**Requirements**: P1-17, P2-11
**Scope**: P1-17, consent v2, P2-11 (tamper-evident audit).
**Expected changes**: retention policy table, purge/anonymise jobs with dry-run and two-person approval, restrict-vs-erase workflow + staff UI, storage deletion, RLS hiding erased rows, audit hardening triggers.
**Success Criteria** (what must be TRUE — roadmap *Acceptance*, verbatim):
  1. dry-run purge counts reviewed
  2. PO approval recorded after an isolated reviewer's check
  3. erasure end to end on synthetic patients
  4. erased rows hidden from non-owner roles
  5. audit rows cannot be updated or deleted.
**Tests**: DB integration for each job in dry-run and live mode on the local stack; pgTAP for erased-row visibility; e2e for the staff erasure UI.
**Evidence**: CI links, the dry-run report, the approval record, the PO's retention-schedule approval.
**Plans**: TBD — roadmap split: 13-01 retention policy + dry-run reports; 13-02 erasure workflow + UI; 13-03 purge jobs with approval; 13-04 audit tamper evidence.

### Phase 13B: SaaS subscriptions & billing

**Roadmap ID**: V2-13b · size XL · gate G4 (adversarial security review) (new; prompt Phase 4)
**Goal**: a clinic can sign up, authorise an AutoPay mandate, use a 14-day trial with no restrictions, be debited ₹1,768.82 (₹1,499 + 18% GST) on day 15, renew, cancel at any time with access to the end of the paid period, and be stopped automatically and forcefully when access ends; a clinic can redeem one coupon code (free cycles, trial extension, `uat`, and percentage or fixed discounts once SUB-COUPON-03 is enabled), and the platform can refund a SaaS payment with a credit note (round 3).
**Depends on**: V2-04, V2-05 (SUB-01/02), V2-06, V2-10 (`lib/fy`), V2-12 (P1-13 for WhatsApp notices, P1-26 rate limiter for code validation), AUTH-03/04; **SUB-10 + PO-20 ✅** (Razorpay test-mode keys at minimum; live keys by V2-15, the GSTIN by G7); PO-21 ✅; SUB-D9/D10 adopted defaults (SUB §14.12).
**Requirements**: SUB-03, SUB-04, SUB-05, SUB-08, SUB-COUPON-01, SUB-COUPON-02, SUB-COUPON-03, SUB-COUPON-04, SUB-COUPON-05, SUB-COUPON-07, AI-18, AUTH-07, PWA-05, PWA-08
**Scope**: SUB-03 (Razorpay `BillingProvider`, checkout with PWA resume, webhooks), SUB-04 (lifecycle, reconcile, notices), SUB-05 (SaaS GST invoices), SUB-08 (owner billing UI, "₹1,499 + GST", AI "Coming soon"; no AI checkout: SUB-11 is deferred and AI-18 moved to V2-05, C41), **AUTH-07** (owner signup, onboarding state machine, post-login routing), **PWA-05** lock path end to end and **PWA-08 spec 9**; **SUB-COUPON-01, -02, -04, -05, -07** (coupons data layer, checkout redemption with deferred `start_at`, discount line and credit notes, refunds, owner code entry) and **SUB-COUPON-03** (flat offers; may slip past paid launch, C47).
**Expected changes**: `lib/billing/**`, `app/api/webhooks/razorpay`, `app/(onboarding)/**` (signup → verify → clinic → "Start trial", with code entry), `/settings/billing`, `/billing/locked*`, `saas_invoices` (discount columns) and PDF, credit-note series, coupon, code, redemption and refund tables and RPCs, `refund.*` webhook handling, lifecycle job handlers, banners, env schema entries.
**Success Criteria** (what must be TRUE — roadmap *Acceptance*, verbatim):
  1. the full lifecycle signup → mandate → trial → day-15 debit → renewal → cancel at period end → lock passes as **time-travel DB tests plus the Fake-provider e2e** (`TEST_NOW`)
  2. **Razorpay test mode on staging** covers mandate authorisation, the first charge (`start_at = now + 15 min`), a failure leading to `pending`/`halted`, cancel, and real webhook delivery (renewal in test mode only if Razorpay supports a short plan interval, Unconfirmed, SUB §11)
  3. a failed debit enters `past_due` and locks after grace or `halted`
  4. Turnstile is on signup
  5. the signup code is delivered through SES on staging
  6. a forged or replayed webhook is rejected and a duplicate event is processed once
  7. a seeded divergence raises the reconcile alert
  8. an open tablet of a locked clinic stops showing data within one poll interval (spec 9)
  9. an unverified email cannot create a clinic or a mandate
  10. a repeat owner gets no second trial (SUB-D5, admin override works)
  11. SaaS invoice numbers are gapless per FY under parallel creation
  12. the Razorpay test-mode plan amount is 176882 paise and the test debit equals it (nothing added by Razorpay)
  13. a SaaS invoice shows ₹1,499.00 taxable plus CGST + SGST (same state) or IGST (other state), totalling ₹1,768.82
  14. every price label reads "₹1,499 + GST"
  15. the billing page shows AI as "Coming soon" and no API or page lets a clinic buy an AI product
  16. **coupons (SUB §14.10):** a `uat` or free-cycles code defers the first debit to the coupon date while the mandate is still authorised with the ₹5 token, a second code on the same subscription is refused (no stacking), code validation is rate-limited with uniform errors, a discounted invoice shows the discount line with GST on the discounted taxable value, a refund is idempotent (a retried call refunds once) and issues a credit note, and a Dashboard refund is imported by reconciliation
  17. the three Unconfirmed Razorpay behaviours on the SUB §14.9 test-mode checklist are recorded.
**Tests**: time-travel pgTAP (incl. coupon kinds, normalised code uniqueness, no stacking, redemption limits, forfeiture on cancel in trial); webhook contract tests with recorded Razorpay test payloads (incl. `refund.*`); `FakeBillingProvider` unit tests; e2e J-A1/J-A10, code entry and the billing journeys on the device matrix; concurrency test for invoice and credit-note numbering and for parallel redemptions of a single-use code; tax-split unit tests (intra- and inter-state, discounted bases, rounding to the paisa; **50 % coupon = 88442 paise intra / 88441 inter**); credit notes for an invoice sum exactly to it (full refund = exact reversal; final credit note takes the remainder); late UAT admission → `start_at = max(trial_end, free_until)`.
**Evidence**: CI links; a Razorpay test-mode run record (IDs only) incl. the §14.9 checklist results; the R12 installed-PWA mandate check on Android and iOS; adversarial reviewer sign-off.
**Plans**: TBD — roadmap split: 13b-01 provider interface + Fake + Razorpay adapter + webhook route; 13b-02 owner signup + onboarding + mandate checkout (AUTH-07, PWA resume); 13b-03 lifecycle tick, reconcile, notices; 13b-04 SaaS GST invoices; 13b-05 owner billing UI + locked pages + banners (incl. the AI "Coming soon" row); 13b-06 coupons data layer + redemption + deferred `start_at` (SUB-COUPON-01/02/07); 13b-07 discount line, credit notes and refunds (SUB-COUPON-04/05); 13b-08 Razorpay flat-offer spike and switch (SUB-COUPON-03, may slip).

### Phase 13C: Platform admin & tenant data lifecycle

**Roadmap ID**: V2-13c · size L · gate G4 (adversarial security review) (new; prompt Phase 4)
**Goal**: the PO can run the business without the SQL editor for routine work, and clinic data follows the agreed lifecycle: 30 days locked, then archive, then purge at expiry + 180 days, with an export offered first.
**Depends on**: V2-13b, V2-13 (P1-17), V2-04, AUTH-04.
**Requirements**: SUB-06, SUB-07, SUB-09, SUB-COUPON-06, AUTH-08
**Scope**: SUB-06 (tenant data export), SUB-07 (archive and purge, reusing V2-13 machinery), SUB-09 (admin portal `/platform`), **AUTH-08 platform side** (mandatory TOTP with two factors, break-glass runbook); the Plans & prices screen also shows each product's billing model and the availability switch (PO-21); **SUB-COUPON-06** (Coupons screen and Refund action).
**Expected changes**: `app/(platform)/platform/**`, `features/platform/**` (lint boundary), `platform.*` RPCs and `platform_audit_log`, export job and private India bucket, archive/purge jobs, deletion certificate, runbooks (subscriptions SQL, break-glass).
**Success Criteria** (what must be TRUE — roadmap *Acceptance*, verbatim):
  1. a non-admin, or an admin at aal1, gets `forbidden` from every `platform.*` RPC
  2. the admin portal shows no clinical data
  3. an export downloads only in-app after re-auth and its URL expires in 15 min
  4. a purge runs only after dry-run counts and approval, deletes clinic data and files, and leaves the statutory survivors (SUB §6.6)
  5. a re-purchase inside the archive window restores access instantly
  6. the Plans & prices screen adds a new price version through `platform.create_plan_price` and changes trial length, grace and quotas without a deploy, each change written to `platform_audit_log`
  7. toggling a product's availability is audited, and the screen refuses to make a product purchasable while it has no active price with a provider plan ID
  8. an admin can create a coupon campaign and a batch of single-use codes, see redemptions, and refund a payment (with a re-auth prompt, an audit row and a credit note), and applying a code to an existing subscription creates the owner re-confirm task.
**Tests**: pgTAP for platform RPC access and audit (incl. coupon and refund RPCs); job tests in dry-run and live mode on the local stack; e2e J-A8 and the admin journeys; storage deletion test.
**Evidence**: CI links; dry-run and deletion-certificate samples; adversarial reviewer sign-off.
**Plans**: TBD — roadmap split: 13c-01 export job + function-limits spike; 13c-02 archive + purge with dry-run and approval; 13c-03 admin portal (tenant list/detail, trial extend, comp, overrides, reconcile now, lifecycle queue, Plans & prices screen); 13c-04 platform-admin MFA + break-glass; 13c-05 Coupons screen + Refund action (SUB-COUPON-06).

### Phase 14: Security verification & closure

**Roadmap ID**: V2-14 · size M · gate G5 (prompt Phase 5)
**Goal**: independent proof that the Critical and High findings are closed and nothing new is open.
**Depends on**: V2-01 to V2-13c merged; staging (V2-03); PO-17 ✅.
**Requirements**: P1-18, P2-06
**Also delivers parts of**: P1-41
**Scope**: the full SECURITY_VERIFICATION_PLAN: SAST, SCA, secrets, the authZ matrix, ZAP baseline on staging, an adversarial Claude security review, and no external test (PO-17 round 2: free-tier budget; recommended before scaling beyond the pilot); P1-18 (headers, CSP incl. `worker-src`/`manifest-src`), P2-06; verification of AUTH-08/09 (MFA, sessions); the new-track checks: webhook forgery and replay, platform RPC access from tenant sessions, `billing_internal` not client-executable, locked-tenant RLS and storage denial, share-token revocation on lock, export URL scope and expiry, AI gating bypass attempts and prompt injection against the scribe, proof that no AI purchase path exists (PO-21), coupon-code enumeration and brute-force attempts, redemption races and refund replay (SUB-COUPON), the FT-05 leaked-password check and the FT-06 session policy; triage of the unverified SEC items; P1-41 coverage enforcement.
**Expected changes**: security headers + CSP, SSRF and upload hardening, coverage thresholds switched to enforce, fixes from scanner and review findings.
**Success Criteria** (what must be TRUE — roadmap *Acceptance*, verbatim):
  1. 0 Critical/High open
  2. Mediums fixed or risk-accepted by the PO
  3. coverage floors met.
**Tests**: the authZ matrix and pgTAP suite; header tests; MFA e2e; webhook replay tests; ZAP baseline in the nightly lane.
**Evidence**: scanner reports, the adversarial review report, the triage log, CI links.
**Plans**: TBD — roadmap split: 14-01 headers + CSP; 14-02 P2-06 hardening; 14-03 auth, MFA and session verification; 14-04 scans + authZ matrix + ZAP; 14-05 billing, admin and AI abuse tests; 14-06 adversarial review + triage + fixes.

### Phase 15: Production readiness & UAT launch

**Roadmap ID**: V2-15 · size M-L · gate G6 (UAT start) (prompt Phase 6)
**Goal**: a controlled big-bang build (PO-15) of a new, verified production project, opened to real-world UAT clinics on Supabase Free with `uat` coupon codes (round 3, C46).
**Depends on**: V2-14; PO-6/PO-7 ✅, PO-13 ✅, PO-17 ✅ (UAT scope); **SUB-10 KYC complete and live keys issued** (or the SUB §14.8 comp fallback); SUB-D9/D10 adopted defaults; SUB-D11 UAT exit date (PO operational input); MSG91 templates approved. The GSTIN is **not** needed for UAT start (no debit during UAT); it is a G7 item.
**Requirements**: P0-07, P1-25, P1-35b, P1-38, P1-41, AUTH-03, PWA-09, PWA-10, FT-01, FT-02
**Also delivers parts of**: P0-16b, SUB-COUPON-08, FT-08
**Scope**: **P0-07 secret rotation (mandatory, deferred from V2-00 by PO ruling C49)**, P1-35b (new production project on Supabase Free in its own organisation, FT-01), P0-16b (runbooks + restore drill of an FT-02 production dump), **FT-02** production backups, FT-03/FT-04 live on production, **FT-08** (upgrade runbook and early-trigger watch), P1-25 (uptime; front-end log drain if available), P1-38, P1-41 (k6 + Lighthouse), I-10, AUTH-03 production (SES out of sandbox), **Razorpay live mode** (live plan IDs, webhook secret, real ₹5 mandate test), platform admin bootstrap, **SUB-COUPON-08** first part (`uat` campaign, assigned single-use codes, invite text, comp-access fallback runbook), PWA-09 budgets blocking, **PWA-10 final real-device run**, release docs, the UAT runbook.
**Expected changes**: production Supabase (Free) and front-end configuration (per C26), the production backup task and bucket, `docs/runbooks/free-tier-upgrade.md`, `docs/runbooks/uat.md` (codes, comp fallback, exit checklist), approval-gated migration jobs, reference-data seed (plans, prices, entitlement keys, platform admin, `uat` coupon campaign), Razorpay live configuration, SES production, uptime monitors, one backup runbook, incident runbook, `security.txt`, release notes, in-app help.
**Success Criteria** (what must be TRUE — roadmap *Acceptance*, verbatim):
  1. §17 "UAT start" checklist fully met.
**Tests**: k6 at go-live load; Lighthouse mobile; the restore drill; the nightly lane; the R1–R15 real-device checklist on 4 devices; a live mandate test; a live redemption of one `uat` code by the PO's own test clinic (deferred `start_at` visible in Razorpay, no debit beyond the ₹5 auto-refunded token).
**Evidence**: the §17 UAT-start checklist with links, the drill record with RPO/RTO, the k6 report, the live-redemption record (IDs only), the G6 reviewer sign-off.
**Plans**: TBD — roadmap split: 15-01 production environment + migration jobs + reference seed; 15-02 live payments + SES production + admin bootstrap; 15-03 uptime + alerts review (+ log drain where available); 15-04 restore drill + runbooks + FT-08 upgrade runbook; 15-05 k6 + Lighthouse; 15-06 real-device run + UAT campaign and codes + UAT runbook + release docs.

### Phase 16: Real-world UAT & paid launch

**Roadmap ID**: V2-16 · size M · gate G7 (paid launch) (new, round 3; prompt Phase 6)
**Goal**: real clinics use the complete product in daily practice free of charge under `uat` coupons; their feedback is triaged and fixed forward; production is then upgraded to Supabase Pro + PITR, and charging full-price customers starts only after G7.
**Depends on**: G6; V2-15; PO-26 (upgrade timing; default applies); PO-20 GSTIN issued before the first full-price debit; SUB-D11 UAT exit date (PO operational input). **G7 timing (addendum 4, fix 4):** G7 must pass at least 5 days before the earliest `uat` `free_until` (before the T-3 notices go out); otherwise the PO runs the SUB §14.8 slip runbook before T-3 (`comp_until` = new date, then cancel each affected subscription before its first debit; testers re-confirm AutoPay at paid launch). No debit may run without a GSTIN. **Late admissions:** a tester admitted less than 14 days before `free_until` gets `start_at = max(trial_end, free_until)` and converts at the end of their own trial (SUB §14.4).
**Requirements**: P0-16b, SUB-COUPON-08, FT-08
**Scope**: onboarding the UAT clinics (PO-13 pilot: 5 clinics × 3 users) with assigned `uat` codes (SUB-COUPON-08); weekly FT-04 quota review and FT-03 heartbeat watch; monthly FT-02 restore drill; feedback triage (bugs fixed forward through the normal PR flow with an isolated reviewer; new scope goes to v2.1, R12); refunds only as the exception (SUB-COUPON-05, SUB §14.8); AI preview for UAT testers with the owner opt-in (SUB-D10 default: until `free_until`); **FT-08 execution: Supabase Pro + PITR upgrade at UAT exit** (default; PO-26) with a PITR restore drill; GSTIN in `platform_settings`; the **UAT exit checklist** (SUB §14.8); paid-launch switch-over (codes closed to new redemptions, public pricing live).
**Expected changes**: mostly data and configuration: Supabase plan, compute and PITR add-on; leaked-password protection and session settings switched on (AUTH §4.1); `platform_settings` (GSTIN, legal name, state); coupon campaign state; forward-fix PRs from UAT feedback; updated backup runbook and §17 evidence. No new features.
**Success Criteria** (what must be TRUE — roadmap *Acceptance*, verbatim):
  1. §17 "Paid launch" checklist fully met
  2. every UAT tester's first debit date and amount listed and their T-3/T-1 notices verified
  3. no open Critical/High from UAT
  4. production on Supabase Pro with PITR (7 days) and a PITR restore drill passed
  5. GSTIN configured and a SaaS invoice PDF for the first real debit checked by the PO.
**Tests**: the nightly lane stays green through UAT; each forward fix carries its regression test; the PITR restore drill; the hosted-settings drift check (AUTH-02) after the upgrade; reconciliation shows no divergence for the UAT tenants.
**Evidence**: the UAT log (clinics, codes as IDs only, issues and their PRs), drill records (FT-02 monthly and PITR), the upgrade record, the UAT exit checklist, the G7 reviewer sign-off and the PO's paid-launch decision.
**Plans**: TBD — roadmap split: 16-01 UAT onboarding + monitoring cadence (codes issued, invite text, quota and backup watch); 16-02 feedback triage and forward fixes (repeatable per batch); 16-03 Supabase Pro + PITR upgrade + PITR restore drill + hosted-settings drift check (FT-08); 16-04 UAT exit checklist + paid-launch switch-over + G7 review.

### Parallel track V2-DX: Design exploration (not a GSD phase; no production code)

**Roadmap ID**: V2-DX · size M · gate gate G2-D
**Objective**: approve the visual and interaction direction from rendered evidence before any primitive is built.
**Scope**: the prompt B3 design-skill exploration; a rendered "Clinic Paper" token palette (colour, type, spacing, en-IN numerals); high-fidelity mock-ups or interactive prototypes of **Today** and **Consult** at 360, **820, 1180** and 1280 px (PWA-03a); the app icon and theme colour (PO-19); low-fidelity mock-ups of the install sheet, offline page, signup → "Start trial" mandate step, `/settings/billing`, the locked pages and the `/platform` tenant list; "AI Assist" vs "Smart Assist" labels (AI-02), the AI "Preview" chip and the "Coming soon" row (PO-21), the "₹1,499 + GST" price display (PO-20); contrast checks.
**Dependencies**: G1; DESIGN_SYSTEM, INFORMATION_ARCHITECTURE and UX_AUDIT §5 as inputs.
**Expected changes**: design artefacts and a throw-away prototype sandbox that is never merged into `app/`. No production code.
**Plans**: DX-01 design-skill exploration, palette and icon; DX-02 Today prototype (phone, tablet, desktop); DX-03 Consult prototype; DX-04 billing, onboarding, admin, install and offline mock-ups; DX-05 PO walkthrough (plus clinic users if PO-13 arranges them).
**Acceptance**: the PO signs off the palette, icon, both prototypes and the billing/admin/install mock-ups; token contrast meets WCAG AA; the interaction targets in §4 are walkable in the prototypes.
**Tests**: an axe run and a contrast check on the prototypes; a recorded walkthrough of the §4 interaction counts.
**Evidence**: screenshots at 360, 820, 1180 and 1280 px, the contrast report, PO sign-off, walkthrough notes.

## Progress

| Phase | Roadmap ID | Gate | Status |
|---|---|---|---|
| 00 | V2-00 | gate G0 | Complete (2026-11-11) |
| 01A | V2-01a | G3-partial | Complete, merged (PR #2) |
| 01 | V2-01 | G3-partial | Complete, merged (PR #3, 2026-11-12) |
| 02 | V2-02 | G3-partial | Complete, merged (PR #4, 2026-11-12) |
| 03 | V2-03 | G3-partial | Complete, merged (PR #5, 2026-11-13). 15 plans + review-fix plans 03-13a–e; 4 High review findings fixed and re-verified; staging live at staging.thecliniqai.com (Mumbai), migrated and seeded |
| 04 | V2-04 | G3-partial | Complete, ready for PO gate (PR #6). 11 plans + review fixes 04-07a–e; 1 High and 12 Mediums fixed and re-verified; 4399 tests ×2, e2e 196, 0 retried |
| 05 | V2-05 | G3 (may be split at plan time into 05a role RLS and integrity, plans 05-01…05-04, 05-06, 05-08; and 05b membership, invites and entitlements, plans 05-05, 05-07, 05-09, 05-10) | Planned (research + plan written, split 05a/05b); not started |
| 06 | V2-06 | G3 | Planned (research + plan written); visual plans wait for G2-D; starts after V2-05 |
| 07 | V2-07 | G4 | Not started |
| 08 | V2-08 | G4 | Not started |
| 09A | V2-09a | G4 | Not started |
| 09B | V2-09b | G4 | Not started |
| 09C | V2-09c | G4 | Not started |
| 10 | V2-10 | G4 | Not started |
| 11 | V2-11 | G4 | Not started |
| 12 | V2-12 | G4 (may be split at plan time into 12a messaging, dependency majors and API, plans 12-01…12-04 and 12-08; and 12b AI, plans 12-05…12-07) | Not started |
| 13 | V2-13 | G4 | Not started |
| 13B | V2-13b | G4 (adversarial security review) | Not started |
| 13C | V2-13c | G4 (adversarial security review) | Not started |
| 14 | V2-14 | G5 | Not started |
| 15 | V2-15 | G6 (UAT start) | Not started |
| 16 | V2-16 | G7 (paid launch) | Not started |
| DX (parallel) | V2-DX | G2-D | Signed off 2026-11-13/14 (PR #7): CliniQ AI brand theme (Claude Design) + Inter/Manrope; ready to merge |
