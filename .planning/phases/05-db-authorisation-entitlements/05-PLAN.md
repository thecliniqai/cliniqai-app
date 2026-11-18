---
phase: 05
roadmap_id: V2-05
name: Database authorisation, integrity & entitlements
size: XL (split at plan time into 05a and 05b, as the roadmap allows; order unchanged)
gate: G3 (security reviewer gate). 05a and 05b each close with their own gate review and their own PR; G3 also needs V2-06
parts:
  05a: {name: "Role RLS & integrity", plans: [05-01a, 05-01b, 05-03, 05-04, 05-02a, 05-02b, 05-02c, 05-06, 05-08], branch: v2/phase-05a-db-authz-integrity, pr_base: "V2-04 phase branch (retargets to feature/v2 when V2-04 merges)"}
  05b: {name: "Membership, invites & entitlements", plans: [05-b0, 05-09a, 05-09b, 05-09c, 05-05, 05-07a, 05-07b, 05-10a, 05-10b, 05-10c], branch: v2/phase-05b-membership-entitlements, pr_base: "05a branch (retargets to feature/v2 when 05a merges)"}
waves:
  05a: {1: [05-01a, 05-01b], 2: [05-03], 3: [05-04], 4: [05-02a], 5: [05-02b], 6: [05-02c], 7: [05-06], 8: [05-08]}
  05b: {1: [05-b0], 2: [05-09a], 3: [05-09b], 4: [05-09c], 5: [05-05], 6: [05-07a], 7: [05-07b], 8: [05-10a], 9: [05-10b], 10: [05-10c]}
requirements: [P1-01, P1-02, P1-04-trigger, P1-08, P1-10, P1-11, P1-39, P1-40, P2-08-FK, P0-14-backend, AUTH-05, AUTH-06-backend, SUB-01, SUB-02, AI-18, AI-03-DB, AI-06-L2-DB, V2-03-R-33, V2-03 handovers to V2-05 (active-tenant binding with a multi-membership leg; webhook queue composite FK; lab storage keys without patient names; per-role statement timeouts)]
source: docs/v2/V2_MASTER_ROADMAP.md §1.2 (PO-3, PO-20, PO-21, PO-25), §10.1-10.3 (C13, C18, C19, C41, C44, C48, C50), §12.2 (V2-05); docs/v2/SUBSCRIPTIONS_AND_PLANS.md §6-§8, §11; docs/v2/AI_STRATEGY.md §4.6, §6.2; docs/v2/AUTH_REDESIGN.md §3.2, §3.6, §9; docs/v2/ARCHITECTURE_DECISIONS.md ADR-006; docs/v2/SECURITY_VERIFICATION_PLAN.md §6.1-6.2; docs/v2/BACKEND_MIGRATION_PLAN.md §3, §6; docs/adr/0005-confine-service-role-client.md
research: 05-RESEARCH.md (live-catalogue findings trusted as the evidence base)
depends_on: V2-03 merged as shipped (last migration 000030; env schema + serverEnv; getSystemDb + REASON_OWNER; db:types + immutability + schema snapshot; ESLint boundary zones; record_payment + AppError + mapDbError; actor guards 000029; staging.yml + scripts/seed/demo-clinic.ts; getEmailSender + Mailpit; isPwnedPassword; Turnstile widget with GoTrue-side CAPTCHA only; readiness booleans); V2-04 branch (04-01 ops.jobs + ops.enqueue_job + public.claim_jobs, 04-02 runner, 04-03 enqueue RPCs and private writers, migrations 000031-000039 as planned) for 05a's base and for 05-07/05-10a
po_direction: PO unavailable; agent acts as CTO under delegation. Nothing external blocks 05a or 05b; hosted steps are PO actions (05-P1…05-P6) that close after merge, as in V2-03 R-19.
---

# Phase 05 (V2-05): Database authorisation, integrity & entitlements — plan

## Revision 2026-11-13 (post V2-03)

Written before V2-03 was built (against `03-PLAN.md`); revised against what V2-03 shipped (`03-WAVE-NOTES.md`, the
`03-*` records, `03-13-REVIEW-TRIAGE.md`, code at `14e0811`) and the revised `04-PLAN.md`. Changes and why:

- **Real interfaces and chores.** Migrations take the next free number after V2-04 (expected **000040** onward if V2-04
  lands 000031–000039). Every migration also bumps `app/api/ready/expected-migration.ts`, regenerates
  `scripts/drift/schema-snapshot.txt` (after `db reset --local`) and runs `npm run db:types`; each new schema joins
  `SNAPSHOT_SCHEMAS`; a new anon-executable definer function joins the allowlist in `readiness-probe-db.spec.ts`.
  V2-04 names are the planned ones (`ops.enqueue_job`, `public.claim_jobs`, `private.*` writers).
- **Handed over by V2-03 and added with tests:** **active-tenant binding** (03-07 D1 finding 2, wave note) — RLS
  helpers and RPCs bind the session's active tenant, not "any membership", via `authz.active_tenant_id()` (request-header
  carrier, R-42), with a dual-member principal in the pgTAP matrix and a definer-function sweep (05-01b, 05-02c);
  composite FK `webhook_delivery_queue → webhook_subscriptions` named as the M-XTENANT-WH structural fix (05-03); lab
  storage keys without patient names, no overwrite (triage, owner V2-05 storage; 05-02c, R-45); per-role statement
  timeouts pinned by test (03-07 handover, 05-02c); `record_payment` checks `p_tenant_id` against the DB-side active
  tenant (05-02c). SQL `CURRENT_DATE` defaults (V2-03 R-33) stay in 05-08, now with app/SQL date parity.
- **Already done by V2-03 (removed or narrowed):** the `audit_logs` actor-forcing trigger exists (000029
  `private.audit_logs_actor_guard`, M-AUDITSYS) — 05-02c adds `log_audit`, the INSERT revoke and the active-membership
  refusal only; `23P01` → `CONFLICT` is mapped and tested (`lib/db/errors.ts`); 03-13d removed raw `err.message`
  responses (the 03-09c residual needs no V2-05 work); `/join`, `/billing/*` page protection follows the 03-12b
  default-deny list without edits.
- **Corrected by V2-03 facts:** `features/*/system.ts` may not be imported from server actions (03-04 lint, ADR-0005
  D2), so 05-05 deletes `auth.sessions` inside `remove_member` (definer, fail-soft; R-43) and 05-07b needs ADR-0005
  amendment **A4** for the invite-acceptance importer (R-44); V2-03 has no server-side Turnstile verifier (CAPTCHA is
  GoTrue-side), so 05-07b adds `siteverify` with a new env key `TURNSTILE_SECRET_KEY` (R-46); `EmailTag` is a closed
  union (adds `staff-invite`); `/api/ready` returns no migration version (05-P2/05-P3 verify `checks.schema`); no PWA
  assets exist before V2-06 (05-10b spec scope).
- **PO actions changed:** 05-P1 (adds R-42…R-47, ADR A4), 05-P2/05-P3 (verify text), 05-P4 (kit item 4; the in-RPC
  delete), new **05-P7** (`TURNSTILE_SECRET_KEY` on Vercel staging). New rulings R-42…R-47.

**Objective (roadmap):** the database is the last line of defence, for roles **and** for subscription access.

**Acceptance (roadmap, verbatim, binding):** the pgTAP matrix covers 100% of tenant tables and passes; a receptionist
PostgREST read of `clinical_notes` is denied (per PO-3); a cross-tenant child insert fails; a removed member reads 0
rows with a still-valid JWT; a receptionist can register a patient; two overlapping non-overbooked appointments cannot
both be inserted; 50 parallel check-ins produce 50 distinct tokens with the IST date; with `p_now` past
`access_ends_at`, a locked tenant gets 0 rows from every clinical table and storage bucket; `authenticated` cannot
execute any `billing_internal.*` function; one invite sends exactly one email under retry; **after plan 05-10 (SUB-02)
every existing DB suite stays green**, with all test tenants seeded `trialing` or comped; the seeded Standard price
derives a 176882-paise charge from base 149900 and 1800 bp; no product is purchasable except Standard,
`platform.set_product_availability` refuses `purchasable = true` for a product without an active provider price, and a
`trialing` tenant has `ai.scribe` with a 1,500 limit while an `active` Standard tenant has none (PO-25 default). Note:
from V2-05 onward `create_clinic_with_owner` creates `incomplete` tenants, so seeds must set a subscription row.
**Tests (roadmap):** the generated pgTAP matrix (roles × access levels); the `has_permission` parity unit test;
time-travel pgTAP for trial, grace, expiry and archive; concurrency tests for check-in, booking and `ai_reserve`; invite
pgTAP cases; migration tests on a copy seeded with the diagnostics' edge cases.
**Evidence (roadmap):** CI pgTAP report; diagnostics report; `/gsd-secure-phase` output; independent reviewer sign-off.

**Carry-overs planned into this phase:** V2-03 R-33 (SQL `DEFAULT CURRENT_DATE` defaults) → 05-08; V2-04 R-11 (restore
drill swaps in the generated matrix) → 05-01b; the `record_payment` role check "until V2-05 `has_permission`" (V2-03
03-07) → 05-02c; knownBug F-01 → 05-01b (P1-07 stays with V2-08 unless it genuinely flips); silent RLS no-op deletes
(research Pitfall 11) → 05-04. V2-03 handovers (revision 2026-11-13): bind the **active** tenant, not "any membership",
in helpers and RPCs, with a multi-membership pgTAP leg (03-07 D1 finding 2) → 05-01b (helper + carrier), 05-02c
(definer-function sweep, `record_payment`); composite FK webhook queue → subscription (triage M-XTENANT-WH) → 05-03;
lab storage keys without patient names (triage, accepted to V2-05 storage) → 05-02c; statement timeouts per role
(03-07 gaps) → 05-02c; clinic-date parity for the `CURRENT_DATE` replacements (03-05 note) → 05-08.

## Invariants for the whole phase

- No product behaviour change beyond the items in this plan. The only intended user-visible changes are: receptionists
  register patients and collect (PO-3); doctors and nurses no longer collect (doctors route Sign & Bill to reception
  unless they also hold `billing:collect`, i.e. the owner of a solo clinic); receptionists and admins no longer see
  clinical notes or vitals; locked or onboarding tenants are redirected. Anything else stops and is raised.
- No call of any kind to a hosted Supabase project, Vercel, AWS or GitHub settings from an implementer session.
  Staging migrations run only through V2-03's PO-approved `staging.yml` (Environment `staging`), dispatched/approved by
  the PO (05-P2, 05-P3). Diagnostics run on the local stack only (R-15).
- **Migration numbering:** each migration takes the **next free number at commit time** (highest number on the branch
  + 1, zero-padded as V2-03 R-4; `scripts/ci/migration-immutability.mjs --base auto --against origin/feature/v2`
  rejects duplicates and numbers ≤ the base's highest). V2-03 ends at 000030 and V2-04 plans 000031–000039, so the first
  V2-05 file is expected to be **000040** (`000040_authz_core.sql`). This plan names migrations by **label**
  (`authz_core`, …); the file is `<next>_<label>.sql`. If the parent branch gains a migration after a 05 file was
  numbered, merge the parent in (no rebase) and `git mv` this phase's **not-yet-merged** files to new numbers; never
  renumber a file that is on the base.
- **Per-migration checklist (every V2-05 migration):** (1) every new table has RLS enabled and starts closed:
  `revoke all on <t> from public, anon, authenticated`, then only the grants its matrix row needs; (2) every new function
  has `set search_path = ''` (definer and invoker alike), fully qualified names, `revoke execute … from public, anon`
  and explicit grants; SECURITY DEFINER only where this plan says so; (3) policies call only `authz.*` helpers or
  `(select auth.uid())`, each wrapped in `(select …)` (initPlan, once per statement); (4) a replaced policy is dropped and
  re-created in the **same** migration; (5) backfills are idempotent; no destructive statement except the named contract
  drops; (6) the same commit runs `npm run db:types` and `npm run authz:gen` and commits their output;
  `npm run db:drift:local` stays green; (7) **V2-03 chores** in the same commit: `app/api/ready/expected-migration.ts`
  `EXPECTED_MIGRATION` = the new number (`tests/api/readiness-probe-db.spec.ts` pins it to the newest file), and `npx
  supabase db reset --local && node scripts/drift/schema-snapshot.mjs --local --write` (CI `--check`); a migration that
  creates a schema adds it to `SNAPSHOT_SCHEMAS` in `scripts/drift/schema-snapshot.mjs` first (today `public`, `ops`,
  `private`; the nightly hosted `drift.yml` reads the same list); (8) a public SECURITY DEFINER function that `anon` may
  execute (05-07a `peek_invitation` only) is added to the allowlist in `readiness-probe-db.spec.ts` with its plan id;
  every other new function revokes `anon` explicitly (Supabase default privileges grant it); (9) raise machine reasons
  only (`RAISE 'REASON' USING ERRCODE = 'P0001'`), register each in `RPC_REASON_CODES` (`lib/db/errors.ts`), and use
  `SET lock_timeout`, never a function-level `statement_timeout` (03-07 finding 3).
- Fixed-signature RLS helpers (R-14): after 05-01b, 05-05 and 05-10a change **helper bodies only**; no policy is
  rewritten for membership status or access level.
- Synthetic data only. No PHI or secret in fixtures, logs, commits, evidence or the generated matrix document.

## Execution protocol (as V2-03, adapted)

- Implementer agents **may** run `npx vitest`, `npm run test:db`, `npm run test:pgtap` (added by 05-01a),
  `npm run e2e:build`, `npm run e2e:pr`, `npx supabase start|stop|db reset --local|db diff --local|gen types --local|test
  db --local`, `npm run seed:local`, `npm run db:diagnostics` (loopback-guarded, added by 05-03),
  `npm run authz:gen`.
- Implementers **must not**: `git push`, open/retarget/merge PRs, change GitHub/Vercel/Supabase-hosted/AWS settings,
  dispatch or approve `staging.yml`/`drift.yml`, run any CLI command with `--linked`, `--db-url` to a non-loopback host,
  or `db push`, run `seed:cdci*`, `seed:diagnoses`, `msg91:*`, anything with `--env-file=.env`,
  `scripts/seed-staging.ts`, `scripts/staging/*`. Never open or print `.env*`. Delete `.planning/dev-messages.txt` if a
  run recreates it. Every Supabase CLI call passes `--local`.
- **One plan per wave (R-39), except 05a wave 1.** Every V2-05 plan changes the schema of the single shared local stack
  and regenerates the shared artifacts (`types/database.ts`, the matrix and its generated pgTAP); two schema plans in
  parallel would reset each other's database. Wave 1 of 05a pairs 05-01a (tooling only, never resets the stack) with
  05-01b (the only stack resetter); 05-01a runs its final pgTAP check after 05-01b's last `db reset`.
- **Per-plan done:** `npm run typecheck`, `npx eslint .` (0 errors), `npm run inventory`, the plan's tests, then the
  full lanes once at the end of the plan: `npm run test:db` and `npm run test:pgtap`; plus `npm run e2e:build &&
  npm run e2e:pr` for any plan that touches app code paths used by the M0 flows or journeys (05-01b, 05-02a, 05-02b,
  05-02c, 05-04, 05-08, 05-09c, 05-05, 05-07b, 05-10a, 05-10b). UI plans (05-02b modal, 05-07b `/join`, 05-10b) check
  360 px, tablet (820) and desktop (1280) and axe (0 serious/critical).
- **Interfaces from V2-03 (as shipped, revision 2026-11-13).** `getSystemDb(reason)` (`lib/supabase/system.ts`; a new
  reason needs a `REASON_OWNER` entry, the closed union makes typecheck require it, `tests/security/system-db.spec.ts`
  covers it); `serverEnv()`/`publicEnv` and the R-15 env checklist (`shapeSchema` + `Env` + tier rules + typed
  `ENV_DOCS`, `tests/config/{env-schema,env-boot}.spec.ts`, `tests/setup/test-env.ts`, `tests/e2e/support/app-env.ts`,
  `node scripts/ci/env-example.mjs`); `AppError`/`APP_ERROR_CODES` (`lib/errors/app-error.ts`, isomorphic) and
  `mapDbError`/`RPC_REASON_CODES` (`lib/db/errors.ts`); `log`, `errorTag`, `logWord` (`lib/log`), `getRequestId`
  (`lib/log/request-id`), `clientErrorMessage(err, "<fixed text>", "<domain>.<fn>.failed")`; `getTenantTimeZone`/
  `getTenantToday` (`lib/datetime/server`), `todayInTz`, `resolveTimeZone`, `DEFAULT_CLINIC_TZ`; `getEmailSender()`
  with `EmailMessage { to, subject, html, text, tag: EmailTag }` (closed `EmailTag` union); `isPwnedPassword`
  (`lib/auth/pwned.ts`); `tests/helpers/sql.ts` (`psql`, `psqlAsync`, `psqlSession`, `localDbContainer`);
  `scripts/seed/demo-clinic.ts` (seed core, phones from `SYNTHETIC_PHONE_PREFIX`); the `private` schema (definer
  helpers; USAGE for `authenticated`, `service_role`); `authenticateApiKey(req, () => getSystemDb("api_v1"))`.
  **Interfaces from V2-04 (verify at branch time):** names follow the revised `04-PLAN.md` (`ops.enqueue_job`,
  `public.claim_jobs`, `lib/jobs/internal/registry.ts`, `private.enqueue_*_internal`, enqueue RPCs taking
  `p_tenant_id`). If a merged name differs, use the merged name; never re-create a parallel mechanism.
- **ESLint boundaries in force (V2-03 03-04/03-13c).** A `features/*/system.ts` module may be imported only from
  `lib/jobs/internal/**`, another `features/*/system.ts`, `app/api/{jobs,webhooks}/**` and the ADR-0005 amendment zones
  (A1 share routes; A3 Send Email hook from V2-04); a server action or service importing one fails lint
  (`lint-fixtures/p1-34/other-feature-system-import.ts`). A new allowance = one zone entry + a pass and a fail case in
  `tests/security/p1-34-lint-gates.spec.ts` + an ADR-0005 amendment. Inline disables of boundary rules fail CI.
- **gitleaks and lockfile (V2-03 orchestrator notes).** After committing and before handing back, the gitleaks scan
  (`docker run --rm -v "$PWD":/repo -w /repo zricethezav/gitleaks:v8.30.1 git --redact --no-banner --config
  .gitleaks.toml .`) prints "no leaks found"; synthetic passwords and secrets in specs are built at run time
  (`tests/helpers/auth-flows.ts` pattern). No package is added; if one ever is, `scripts/ci/lock-linux-check.sh --fix`.
- **Dependencies:** none added (see below).
- **Branching (R-1).** 05a: `v2/phase-05a-db-authz-integrity` created from the tip of the V2-04 phase branch (record the
  SHA in the 05a summary); its PR targets that branch while V2-04 is open. 05b: `v2/phase-05b-membership-entitlements`
  created from the 05a branch; its PR targets the 05a branch. CI runs on every PR base (`ci.yml` OA-2). Parents merge
  into `feature/v2` **with a merge commit, never squash**, so the child needs no rebase or force-push; the child PR is
  then retargeted to `feature/v2` (GitHub does it when the parent branch is deleted). Review fixes on a parent reach the
  child by `git merge`, never rebase. Merge order: V2-04 → 05a → 05b.
- **Orchestrator:** push after every wave; open each part's PR as draft after its first wave; merge only after that
  part's gate and the PO's approval.

## New dependencies (CLAUDE.md: reason required)

None. `pgtap` is installed per run by `supabase test db` (CLI 2.120.0 pulls `public.ecr.aws/supabase/pg_prove:3.36`);
`btree_gist` is a contrib extension in the Supabase Postgres image (research: available, 1.7). No npm, PyPI or crates
package is added. The parity test uses an exposed SQL function, not a `pg` driver (R-41).

## Execution order

### 05a — Role RLS & integrity

| Wave | Plan | Size | Depends on | Files this plan owns in its wave (summary) | Why this order |
|---|---|---|---|---|---|
| 1 | **05-01a** pgTAP harness, CI step, evidence | S | V2-04 branch | `supabase/tests/**` (legacy conversion), `scripts/test-pgtap.mjs`, `scripts/ci/assert-pgtap-report.mjs`, `ci.yml`, `package.json`, `scripts/phase-evidence.mjs` | Everything later is proven with pgTAP |
| 1 | **05-01b** `authz` helpers + active-tenant carrier, PO-3 permission set, parity, matrix generator | M | V2-04 branch | migration `authz_core` (+ `expected-migration.ts`, snapshot, `SNAPSHOT_SCHEMAS`), `lib/supabase/server.ts`, `lib/permissions/matrix.ts`, `tests/authz/**`, `scripts/gen-authz-pgtap.ts`, generated SQL + `AUTHZ-MATRIX.md`, parity spec, F-01 marker | Stable helper signatures, the active-tenant binding and the single matrix source before any policy |
| 2 | **05-03** composite FKs + `prescription_items.tenant_id` + diagnostics tool | M | 05-01a, 05-01b | 5 migrations, `scripts/db/diagnostics.*`, FK pgTAP | `prescription_items.tenant_id` feeds 05-02b's policy; integrity before policies |
| 3 | **05-04** RESTRICT proof + all DELETE policies + silent no-op fixes | S | 05-03 | migration `delete_policies`, 4 service files | Owns every DELETE policy so 05-02 owns only S/I/U |
| 4 | **05-02a** clinical split (expand + migrate) | L | 05-04 | migration `clinical_notes_expand`, ~26 app files, ~19 test files | The receptionist denial needs a table; largest app churn first |
| 5 | **05-02b** clinical, front-desk, financial policies + guard call sites | L | 05-02a | 3 policy migrations, `features/billing/**`, sign-and-bill modal, guard manifest | Uses the split table and `billing:collect` |
| 6 | **05-02c** admin/system policies, storage, grants, audit v2 | M | 05-02b | 4 migrations, `lib/audit/audit.ts`, `record_payment` replacement | Closes the matrix: no legacy rule left |
| 7 | **05-06** referrals + exports | S | 05-02c | migration `referrals_directory_consent`, `features/referrals/**`, `features/dpdp/export*`, v1 export route | Builds on the final referral policies |
| 8 | **05-08** exclusion constraint, queue counter, tenant-local dates, FK indexes | M | 05-02c | 4 migrations, `features/visits/scheduling-service.ts`, `features/queue/service.ts`, `lib/db/errors.ts` | Last integrity work; FK index sweep covers every FK added above |
| close | **05a gate** | — | all 05a | report gates, evidence, reviews | |

### 05b — Membership, invites & entitlements

| Wave | Plan | Size | Depends on | Files this plan owns (summary) | Why this order |
|---|---|---|---|---|---|
| 1 | **05-b0** contract of 05a's expands | S | 05a merged; 05-P2 verified (or staging not live) | migration `contract_05a` | Old columns/function dropped only after the switched app is deployed |
| 2 | **05-09a** SUB-01 schema, access + entitlement functions, catalogue + AI-18 seeds | M | 05-b0 | 5 migrations, billing pgTAP | Access functions before anything reads them |
| 3 | **05-09b** `platform.*` RPCs + SQL runbook | S-M | 05-09a | migration `platform_admin_rpcs`, `docs/runbooks/subscriptions-sql.md`, teardown | The availability switch + actor rule |
| 4 | **05-09c** test seeds, dev/staging seed, v1 tables dropped, flip dry run | S-M | 05-09a | `tests/helpers/tenants.ts`, seeds, subscription page, v1 tests | Every tenant gets a row **before** enforcement (acceptance 11) |
| 5 | **05-05** AUTH-05 membership status, removal, session revocation | M | 05-09c | migration `membership_status`, `features/staff/**`, `lib/auth/tenant.ts` | Helper body change #1 (status) |
| 6 | **05-07a** AUTH-06 invitations v2 (DB) | M | 05-05; V2-04 04-01/04-03 on base | migration `invitations_v2`, invitation pgTAP | Uses `invitations.revoked_*` from 05-05 and `ops.jobs` |
| 7 | **05-07b** AUTH-06 app paths + email delivery | M | 05-07a | `features/staff/**`, `features/auth/**`, `/join`, `lib/jobs/internal/handlers/email-invite.ts` | Exactly-one-email proof |
| 8 | **05-10a** SUB-02 enforcement core | M-L | 05-09c, 05-07b | migration `access_enforcement`, guards, storage TTL, `/api/v1` 402, sharing | Helper body change #2 (access level) |
| 9 | **05-10b** layout redirects + functional locked pages | M | 05-10a | `app/(dashboard)/layout.tsx`, `app/billing/locked/**`, `/onboarding/billing` interim page, e2e | UX on top of the DB stop |
| 10 | **05-10c** AI-03 DB + AI-06 L2 DB | M | 05-10a | migration `ai_gating`, AI pgTAP + concurrency spec | Uses access level + entitlements |
| close | **05b gate + phase close** | — | all | report gates, evidence, reviews, summary, verification | |

**Cross-plan hot files (sequential owners):** `types/database.ts`, `app/api/ready/expected-migration.ts` and
`scripts/drift/schema-snapshot.txt` every migration plan in order (one plan per wave, so no reconciliation is needed
except in 05a wave 1, where only 05-01b migrates); `scripts/drift/schema-snapshot.mjs` 05-01b → 05-09a;
`lib/supabase/server.ts` 05-01b only; `features/auth/system.ts` (created by V2-04 04-03c) 05-07b only; `lib/email/types.ts` 05-07b only;
`tests/authz/table-matrix.ts` + `supabase/tests/database/authz_matrix.test.sql` + `AUTHZ-MATRIX.md` 05-01b → 05-03 →
05-04 → 05-02a → 05-02b → 05-02c → 05-08 → 05-09a → 05-09b → 05-05 → 05-07a → 05-10a → 05-10c;
`scripts/gen-authz-pgtap.ts` 05-01b → 05-02c → 05-05 → 05-10a; `package.json` 05-01a → 05-03;
`.github/workflows/ci.yml` 05-01a only; `lib/permissions/**` 05-01b → 05-10a; `features/billing/service.ts` 05-04 →
05-02b; `lib/auth/tenant.ts` 05-05 → 05-10a;
`tests/security/guard-manifest.ts` (+ engine, valid-inputs) 05-02b → 05-05 → 05-07b; `tests/setup/teardown.ts` 05-05 →
05-09b → 05-10c; `tests/helpers/tenants.ts` 05-09c → 05-10b.

## The authorisation model (shared contract for every plan)

**Helpers (05-01b; signatures fixed for the rest of the phase, R-14).** Schema `authz` (not in `[api] schemas`, so
PostgREST cannot call it; `usage` granted to `authenticated` only):

| Function | Kind | Returns | Body at 05-01b | 05-05 adds | 05-10a adds |
|---|---|---|---|---|---|
| `authz.role_has_permission(p_role text, p_perm text)` | IMMUTABLE, invoker | boolean | hard-coded `CASE` over the 5 roles (C19) | — | — |
| `authz.permission_keys()` | IMMUTABLE, invoker | text[] | every key except `*` | — | — |
| `authz.active_tenant_id()` (R-42) | STABLE, definer | uuid | the tenant named by the request header `x-clinicos-tenant` (`current_setting('request.headers', true)::json ->> 'x-clinicos-tenant'`, UUID-shaped) when the caller has a membership there; else the caller's **only** membership when there is exactly one; else `null` | membership must be `active` | — (any access level) |
| `authz.member_tenant_ids()` | STABLE, definer | setof uuid | caller's memberships, **all** clinics (used only for `tenants` SELECT and own `memberships` rows: the clinic switcher) | `status = 'active'` | — (any access level) |
| `authz.full_tenant_ids()` | STABLE, definer | setof uuid | `authz.active_tenant_id()` if it is a membership (0 or 1 row: **bound to the active tenant**, 03-07 finding 2) | `status = 'active'` | access level `full` |
| `authz.tenant_ids_with(p_perm text)` | STABLE, definer | setof uuid | full tenants where the role grants `p_perm` | via full | via full |
| `authz.billing_tenant_ids()` | STABLE, definer | setof uuid | the active tenant where role ∈ owner/admin | `status = 'active'` | access level ∈ `full`/`locked`/`onboarding` |
| `public.has_permission(p_tenant uuid, p_perm text)` | STABLE, definer | boolean | `p_tenant in authz.tenant_ids_with(p_perm)` (ADR-006 name; caller- and active-tenant-bound, for V2-07 RPCs and guard triggers) | inherits | inherits |
| `public.permission_matrix()` | IMMUTABLE, invoker | table(role, perm) | expands the CASE (parity test; static data, R-41) | — | — |
| `public.current_user_tenant_ids()` | kept, definer | setof uuid | shim → `authz.member_tenant_ids()` (existing signature and today's "any membership" behaviour, so legacy policies and RPCs keep working until 05-02c moves every one of them to the bound helpers) | inherits | inherits |

Table groups use: **member** helper for `tenants` SELECT and a caller's **own** `memberships` rows (the switcher lists
every clinic; a locked owner must still resolve the clinic, research Pitfall 7); **billing** helper for
subscription/billing tables; **`tenant_ids_with(<perm>)`** for everything else (R-40). Everything except the switcher
reads is therefore bound to the active tenant (R-42).

**Active-tenant carrier (R-42).** `lib/supabase/server.ts` `createClient()` (the user client every `ServiceContext`
uses) sends `global.headers["x-clinicos-tenant"]` = the `clinic_active_tenant` cookie when it is a UUID (the cookie
`lib/auth/tenant.ts` already resolves; the database checks membership, so a forged value can only name another of the
caller's own clinics). supabase-js passes global headers to PostgREST, RPCs and Storage. Single-clinic users need no
cookie (the sole-membership fallback). Service-role clients carry no JWT and get nothing from the helpers, as today.
The 05-01b tracer proves the carrier on PostgREST, RPC and Storage before any policy depends on it; if Storage does not
expose request headers to policies, the carrier switches to a JWT claim `active_tenant_id` added by the existing Custom
Access Token hook (000030 `private.session_age_token_hook`, `create or replace`, same name so PO action 03-E3 is
unchanged) with a session refresh on clinic switch — same helper signature, body change only; if neither works, stop
and raise it with the PO.

**Permission set after 05-01b (PO-3 + SVP §6.1; R-6).** `matrix.ts` and the SQL `CASE` change in the same commit:
- new key `billing:collect` (owner via `*`, admin, receptionist);
- receptionist gains `patients:edit` (P0-14), `billing:view`, `billing:collect`;
- no other key changes. Doctors and nurses keep their keys; they stop collecting when 05-02b moves the billing guards
  from `appointments:edit` to `billing:collect`.

**Target policy matrix (single source: `tests/authz/table-matrix.ts`; generated pgTAP and `AUTHZ-MATRIX.md`).**
"—" = no policy and no grant for tenant roles. Row-level extras are noted.

| Table group | SELECT | INSERT | UPDATE | DELETE (05-04) |
|---|---|---|---|---|
| `tenants` | member (all of the caller's clinics: switcher) | — | `clinic:manage` (active tenant) | — |
| `memberships` | own rows in any clinic (`user_id = (select auth.uid())` and member helper), plus every row of the active tenant (all roles hold `staff:view`) | — (RPCs) | self profile columns (existing column grants + guard) or `clinic:manage` | — |
| `invitations` | `staff:invite` | `staff:invite` with the owner-only rule for owner/admin roles (05-02c) → — after 05-07a (RPC only) | — | — |
| `patients` | `patients:view` | `patients:edit` | `patients:edit`; `allergies`/`chronic_conditions` changes need `consultations:view` (guard trigger, R-8) | — |
| `consent_records` | `patients:view` | `patients:edit` | — | — |
| `visits` (non-clinical after 05-02a) | `appointments:view` | `appointments:edit` | `appointments:edit` | — |
| **`clinical_notes`** (new, 05-02a) | `consultations:view` | — (created by trigger) | `consultations:edit`, or `vitals:edit` limited to `vitals` (guard trigger) | — |
| `queue_tokens`, `waitlist_entries` | `appointments:view` | `appointments:edit` | `appointments:edit` | — |
| `queue_token_counters` (new, 05-08) | — | — (RPC) | — (RPC) | — |
| `schedule_blocks` | `appointments:view` | own `doctor_id` with `appointments:edit`, or `clinic:manage` | same | same |
| `follow_ups` | `appointments:view` | `appointments:edit` or `consultations:edit` | same | `consultations:edit` |
| `consultation_diagnoses`, `consultations` (dead), `visit_revisions` | `consultations:view` | `consultations:edit` | `consultations:edit` (revisions: —) | diagnoses: `consultations:edit`; others — |
| `prescriptions`, `prescription_items` | `prescriptions:view` | `prescriptions:edit` | `prescriptions:edit` | items: `prescriptions:edit`; prescriptions — |
| `doctor_custom_diagnoses`, `doctor_custom_medicines`, `doctor_prescription_templates` | `consultations:view` | `consultations:edit` and `doctor_id = auth.uid()` | same | same |
| `referrals` (originating) / (target) | `consultations:view` / target in `consultations:view` | `consultations:edit` + directory + consent (05-06) / — | `consultations:edit` / target in `consultations:edit` + existing receiver guard | — |
| `patient_documents` | `labs:view` | `labs:edit` | `labs:edit` | `labs:edit` |
| `document_share_tokens` | by `resource_type`: prescription `prescriptions:view`, invoice `billing:view`, referral `consultations:view`, patient_document `labs:view` | — (RPC) | — | — |
| `invoices`, `invoice_items` | `billing:view`, or `consultations:edit` and own visit (`visits.doctor_id = auth.uid()`) | `billing:collect`, or `consultations:edit` and own visit (Sign & Bill) | same as INSERT (paid-invoice protection is V2-10) | items: `billing:collect` |
| `payments` | as invoices SELECT | `billing:collect` | — | — |
| `communication_queue` | `appointments:view` | — (V2-04 enqueue RPC; API-role writes revoked in 04-03c) | — | — |
| `in_app_notifications` | own (`recipient_user_id = auth.uid()`) in full tenants | — | own (read/dismiss columns) | own |
| `tenant_messaging_config` | `clinic:view` | `clinic:manage` | `clinic:manage` | — |
| `audit_logs` | `clinic:manage` | — (`log_audit` + trigger) | — | — |
| `api_keys`, `api_key_usage_daily`, `webhook_subscriptions` | `clinic:manage` | `clinic:manage` | `clinic:manage` | `clinic:manage` |
| `webhook_delivery_queue` | `clinic:manage` (delivery logs) | — (V2-04 enqueue RPCs and `private` writers; revoked in 04-03c) | — | — |
| `cdci_*` (8), `opd_diagnoses` | `authenticated` (global) | — | — | — |
| `tenant_subscriptions`, `subscription_events` (05-09a) | billing helper | — | — | — |
| `plans`, `plan_prices`, `plan_entitlements`, `entitlement_keys` (05-09a) | `authenticated` where the plan's `visibility <> 'hidden'` | — | — | — |
| `tenant_entitlement_overrides`, `platform_settings`, `platform_admins`, `platform_audit_log`, `ai_usage_monthly`, `ai_quota_reservations` | — | — | — | — |
| `tenant_ai_settings` (05-10c) | `tenant_ids_with('clinic:view')` | — (owner RPC) | — (owner RPC) | — |
| `ops.*` tables with `tenant_id` (V2-03/V2-04) | — | — | — | — |
| storage `prescriptions` bucket: Rx class / receipt class | `prescriptions:view` / `billing:view` | `prescriptions:edit` / `billing:collect` | same (archives upsert, R-23) | — |
| storage `clinic-records` bucket: lab class / referral-letter class / branding class (classes read from the key builders; lab keys carry ids only from 05-02c, R-45) | `labs:view` / `consultations:view` / `clinic:view` | `labs:edit` / `consultations:edit` / `clinic:manage` | same | `labs:edit` / — / `clinic:manage` |

**Principals the generator expands (roles × access levels × active tenant):** owner, admin, doctor, nurse,
receptionist of tenant A (plus a second doctor for own-visit rules); owner of tenant B; `anon`; **a dual member D**
(doctor in A and receptionist in B — the 03-07 guard leg 3b shape) evaluated three ways: header naming A, header naming
B, no header (R-42); from 05-05 a `removed` and a `suspended` member of A; from 05-10a access levels `full`, `locked`,
`onboarding` for tenant A (fixture subscription rows). Cells set `request.headers` alongside `request.jwt.claims`
(`set local`); single-clinic principals run without the header (the sole-membership fallback). Each cell runs
one operation against a fixture row of tenant A inside a plpgsql block that **always aborts its own subtransaction**
(it records the outcome, then raises a sentinel it catches), so cells are independent and pgTAP's own result tables are
untouched; the outcome is then asserted with `is()`. Outcomes: SELECT → visible rows (1/0); INSERT → ok or `42501`;
UPDATE/DELETE → affected rows (1/0) or `42501`. Fixtures (synthetic `auth.users`, memberships, one row per table per
tenant) are inlined by the generator; no `\ir` (research A7).

---

# Part 05a — Role RLS & integrity

## 05-01a pgTAP harness + CI step + evidence (P1-01 harness, roadmap evidence "CI pgTAP report") · S · 05a Wave 1

### Files
- `supabase/tests/memberships_bounds_cleanup.sql` → `supabase/tests/database/memberships_bounds_cleanup.test.sql` and
  `supabase/tests/search_medicines_extension_schema.sql` → `supabase/tests/database/search_medicines_extension_schema.test.sql`
  (`git mv`, then converted to pgTAP: `begin; select plan(n); … select * from finish(); rollback;`, each `PASS:` print
  becomes `ok()`/`is()`/`throws_ok()`; same assertions, synthetic ids). `supabase/tests/` keeps no top-level `.sql`.
- `scripts/test-pgtap.mjs`: takes the existing test-run lock (the helper behind "Could not acquire the test-run lock";
  reuse it, do not fork it), refuses `--linked`/`--db-url` pass-through, runs
  `npx supabase test db --local supabase/tests/database`, tees TAP to the path given (default `pgtap-report.tap`), exits
  with the CLI's code.
- `scripts/ci/assert-pgtap-report.mjs`: parses the TAP: 0 `not ok`, 0 `# SKIP`/`# TODO`, no "Parse errors"/"No plan
  found", every file reports its planned count, total ≥ `FLOOR`, every `REQUIRED_FILES` entry present. Same shape as
  `scripts/ci/assert-vitest-report.mjs`.
- `package.json` scripts: `test:pgtap` (`node scripts/test-pgtap.mjs`), `authz:gen`
  (`tsx scripts/gen-authz-pgtap.ts`, file created by 05-01b; owned here so wave 1 stays file-disjoint).
- `.github/workflows/ci.yml` `test` job, after the stack starts and **before** Vitest: (1) "Pre-pull pg_prove" —
  `node scripts/ci/retry.mjs --attempts 3 --delay 30 -- docker pull public.ecr.aws/supabase/pg_prove:3.36` (image-pull
  retries only; comment ties the tag to the pinned CLI); (2) "pgTAP (RLS matrix and constraints)" —
  `npm run test:pgtap -- pgtap-report.tap`, **never retried** (a test that passes only on retry is a defect);
  (3) "pgTAP report gate" — `node scripts/ci/assert-pgtap-report.mjs pgtap-report.tap`; (4) upload artifact
  `pgtap-report` (`if: always()`).
- `scripts/phase-evidence.mjs`: each of the N runs also runs `npm run test:pgtap` and stores `pgtap-run-<n>.tap` plus
  counts in the summary; `--ci-run <id>` also downloads the `pgtap-report` artifact.
- `tests/ci/pgtap-report.spec.ts`, `tests/ci/test-pgtap-script.spec.ts`.
- `.planning/phases/05-db-authorisation-entitlements/evidence/05a/05-01a/` (before/after tool output).

### Steps
1. **Before:** `npx supabase test db --local` → save the failing output ("No plan found in TAP output … Result: FAIL",
   research A.6) to evidence.
2. Convert the two legacy scripts; run `npm run test:pgtap` → `Result: PASS`; check `select extname from pg_extension
   where extname = 'pgtap'` is empty afterwards (the CLI removes it; research verified) and record it.
3. Wire CI and `phase-evidence.mjs`. Initial `FLOOR` = the converted files' test count; `REQUIRED_FILES` = the two
   converted files (later plans append theirs at each part close).
4. Prove the gate: a throwaway failing file → `assert-pgtap-report.mjs` exits 1 (output to evidence) → delete it.
5. Run after 05-01b's final `db reset` (protocol), so the wave ends with both plans' pgTAP green.

### Tests that fail without the change
- `pgtap-report.spec.ts` (fixture TAP): all ok → 0; one `not ok` → 1 naming the file and test; a "No plan found" parse
  error → 1; a `# SKIP` → 1; a missing required file → 1; below floor → 1.
- `test-pgtap-script.spec.ts`: `--linked` or a `--db-url` argument → exit 1 without invoking the CLI (injected spawn).
- `npx supabase test db --local supabase/tests/database` passes (before: the default directory fails).

### Acceptance mapping
Roadmap evidence "CI pgTAP report": mechanism (CI step + artifact + gate). Acceptance 1 "… and passes": enforced in
CI from here on.

---

## 05-01b `authz` helpers + active-tenant binding + PO-3 permission set + parity + generated matrix (P1-01, ADR-006/C19, P0-14 matrix part, PO-3, V2-03 03-07 finding 2) · M · 05a Wave 1

### Files
- Migration `authz_core` (expected `000040_authz_core.sql`) + chores (`expected-migration.ts`, snapshot);
  `scripts/drift/schema-snapshot.mjs` (`SNAPSHOT_SCHEMAS` gains `authz`) and `tests/ci/` snapshot spec case if one
  enumerates the schemas; `types/database.ts`.
- `lib/supabase/server.ts` (`createClient()` sends `x-clinicos-tenant` from the `clinic_active_tenant` cookie, R-42);
  `tests/helpers/context.ts` / the test client builders (an option to set the header for multi-clinic fixtures);
  `tests/authz/active-tenant-carrier.spec.ts` (tracer, real PostgREST + Storage).
- `lib/permissions/matrix.ts` (PO-3 set: `billing:collect` key; receptionist + `patients:edit`, `billing:view`,
  `billing:collect`), `features/billing/subscription.ts` (SaaS subscription page guard `billing:view` →
  `clinic:manage`, because receptionists now hold `billing:view` and SaaS billing is owner/admin, SUB §7.1).
- `tests/permissions/has-permission-parity.spec.ts`; `tests/auth/rbac.spec.ts` (`:42` receptionist `patients:edit` →
  true; `billing:collect` cases).
- `tests/authz/table-matrix.ts` (single source), `tests/authz/table-matrix.spec.ts`, `tests/authz/generator-drift.spec.ts`,
  `scripts/gen-authz-pgtap.ts`, generated `supabase/tests/database/authz_matrix.test.sql` and
  `supabase/tests/database/authz_completeness.test.sql`, generated
  `.planning/phases/05-db-authorisation-entitlements/AUTHZ-MATRIX.md` (human-readable roles × tables × operations grid).
- `supabase/tests/database/authz_helpers.test.sql` (hand-written).
- `tests/e2e/m0/register-patient.spec.ts` (remove the F-01 `knownBug` wrapper if the body now passes; the assertions
  stay as plain expectations).
- `ops/restore-drill/run.sh` (only if V2-04 04-05 put it on the branch): add `authz_matrix.test.sql` to the drill checks
  (V2-04 R-11 "V2-05 swaps in the matrix").

### Steps
0. **Tracer (R-42, before any other step depends on it):** `authz.active_tenant_id()` + `public.has_permission` and the
   `lib/supabase/server.ts` header, proven end to end by `active-tenant-carrier.spec.ts` for a dual member (A and B)
   through the real stack: (a) PostgREST — `rpc("has_permission", { p_tenant: B, … })` is `false` with the header naming
   A and `true` with B; (b) Storage — a throwaway bucket and a temporary `storage.objects` SELECT policy calling
   `authz.full_tenant_ids()`, created and dropped by the spec through `psql` (`tests/helpers/sql.ts`), lists a B object
   only with the header naming B; (c) no header with two memberships → nothing. If (b) fails because Storage does not
   expose request headers, switch the carrier to the JWT claim (shared contract, R-42) before continuing, and record it.
1. **Migration `authz_core`:** `create schema authz; revoke all on schema authz from public; grant usage on schema
   authz to authenticated;` `alter default privileges in schema authz revoke execute on functions from public;`. Create
   the functions in the shared-contract table with the 05-01b bodies (incl. `authz.active_tenant_id()`, R-42); the
   `CASE` in `authz.role_has_permission` is the new `matrix.ts` verbatim (owner `true`; others `p_perm =
   any(array[…])`). `authz.permission_keys()` lists every key (used to expand `*` and by the parity test).
   `public.has_permission`, `public.permission_matrix`; repoint `public.current_user_tenant_ids()` with `create or
   replace` (same signature, still definer, body `select * from authz.member_tenant_ids()`: today's behaviour, so no
   existing policy or RPC changes meaning here; 05-02c moves every user of it to the bound helpers). Revoke EXECUTE on
   every new function from `public, anon`; grant `authenticated` (and `service_role` for `has_permission`,
   `permission_matrix`). No policy changes here.
2. `npm run db:types`; the V2-03 chores (`EXPECTED_MIGRATION`, snapshot with `authz` in `SNAPSHOT_SCHEMAS`).
3. **Parity:** for every role in `ROLE_PERMISSIONS` and every key in the `Permission` union (with `*` expanded through
   `hasPerm`), the TS answer equals `permission_matrix()`; plus the reverse (SQL has no key the TS union lacks; the TS
   union has no key `permission_keys()` lacks).
4. **Matrix source + generator.** `table-matrix.ts` lists **every** table in `public` (tenant and global), every
   `ops.*` table with a `tenant_id`, and every `storage.buckets` id × path class, each with a rule per operation.
   Rule kinds: `perm(<key>)`, `member`, `billing`, `self(<column>)`, `catalogue`, `rpc_only`, `none`, plus row extras
   (`ownVisit`, `ownDoctor`, `recipient`, `vitalsOnly`), and two **transitional** kinds `legacy_member` and
   `legacy_owner_admin` that describe today's tenant-only policies. 05-01b encodes every table with its **current**
   behaviour (so the matrix is green at every commit and already proves cross-tenant and `anon` denial); 05-02b/05-02c
   switch each table to its target rule; 05-02c deletes the two legacy kinds from the generator types, so a leftover
   cannot compile. The generator writes the matrix SQL, the completeness SQL and `AUTHZ-MATRIX.md`, deterministic order,
   no timestamps.
5. **Completeness (generated):** `set_eq` between the catalogue (all `public` tables; all tables with a `tenant_id`
   column in `ops`, `billing_internal`, `platform`; all `storage.buckets`) and the matrix lists; every `public` table has
   `relrowsecurity`; at the 05a gate also: no `pg_policies` row in `public`/`storage` references
   `current_user_tenant_ids`, `current_user_has_role` or `current_user_is_admin_or_owner` (asserted from 05-02c on).
6. **Hand-written `authz_helpers.test.sql`:** signatures pinned (`has_function` with argument types,
   `function_returns`, `volatility_is`, `is_definer`, `search_path=''` via `proconfig`); `role_has_permission` spot
   checks incl. `receptionist`/`billing:collect` true, `doctor`/`billing:collect` false; `has_permission` is caller-bound
   (member of A → true for A, false for B; `anon` → false); **active-tenant cases (R-42):** a dual member with
   `request.headers` naming A → `active_tenant_id()` = A, `full_tenant_ids()` = {A}, `has_permission(B, …)` false; naming B
   → B; naming a tenant they are not a member of → `null` and nothing; no header → `null` (two memberships) while
   `member_tenant_ids()` still returns both; a single-clinic member with no header → their clinic; a malformed header →
   `null`, no error; `current_user_tenant_ids()` equals `member_tenant_ids()`; `authz` functions not executable by `anon`.
7. e2e: run the PR lane; if F-01's body passes (receptionist now holds `patients:edit`; today's `patients` INSERT policy
   admits any member), remove the marker in this plan (knownBug turns red when fixed).

### Tests that fail without the change
- `active-tenant-carrier.spec.ts` (real JWTs and Storage; the acceptance path for the carrier): the three legs of the
  tracer (before: no helper, no header).
- `has-permission-parity.spec.ts` (no `permission_matrix()` before; after a deliberate one-key edit in either source it
  fails — shown once in evidence, then reverted).
- `authz_helpers.test.sql` (functions absent before).
- Generated matrix: the dual-member principal's cells are encoded with each table's **current** rule (legacy kinds
  admit B with any header) and flip to denied as 05-02a/b/c move tables to target rules; at the 05a gate every cell for
  "header A, B row" is denied.
- `authz_completeness.test.sql`: removing one table from `table-matrix.ts` makes it fail (shown once in evidence).
- `generator-drift.spec.ts`: an edited generated file fails.
- `rbac.spec.ts` receptionist `patients:edit`/`billing:collect` true (before false); M0 F-01 receptionist registration
  passes as a plain test.

### Acceptance mapping
Acceptance 1 (mechanism: 100% coverage by catalogue `set_eq`); roadmap test "the `has_permission` parity unit test";
acceptance 5 (permission part; RLS part in 05-02b); P0-14 matrix. V2-03 handover "bind the active tenant; multi-membership
pgTAP leg": helper, carrier and principal here; every policy and RPC bound by 05-02c.

---

## 05-03 Composite tenant FKs + `prescription_items.tenant_id` + diagnostics (P1-02, BACKEND C1-C3, DB-01) · M · 05a Wave 2

### Files
- Migrations `tenant_parent_keys`, `prescription_items_tenant_id`, `composite_fks_expand`, `composite_fks_validate`,
  `composite_fks_contract` (each with the V2-03 chores); `types/database.ts`.
- `scripts/db/diagnostics.sql` (BACKEND §3 D0-D10 verbatim, D6 as a plain query) and `scripts/db/diagnostics.mjs`
  (refuses any non-loopback URL; runs through `docker exec … psql` like `tests/helpers/sql.ts`; writes counts only to
  `evidence/<part>/diagnostics/<label>.json`); `package.json` script `db:diagnostics`; `tests/ci/diagnostics-script.spec.ts`.
- `supabase/tests/database/composite_fks.test.sql`, `supabase/tests/database/migration_edge_cases_fk.test.sql`.
- `tests/security/cross-tenant-refs.spec.ts` (new case), `tests/authz/table-matrix.ts` (fixture for
  `prescription_items.tenant_id`), regenerated matrix.
- Any `select(…)` string with an explicit FK hint (`!<constraint>`) found by `rg '![a-z_]+_fkey'` in `app/`,
  `features/`, `lib/`, `components/`.

### Steps
1. **Diagnostics (before):** `npm run seed:local`, a full `npm run test:db` and `npm run e2e:pr` (data-producing),
   then `npm run db:diagnostics -- --label before-05-03` → D1/D2/D3/D5 counts in evidence. Non-zero D1-D4 stops the plan
   and is raised (BACKEND §3: possible incident).
2. **`tenant_parent_keys`:** `unique (tenant_id, id)` on patients, visits, invoices, prescriptions, patient_documents,
   referrals, api_keys, webhook_subscriptions (BACKEND C1). Plain DDL (no production data; CONCURRENTLY is impossible in a
   migration transaction).
3. **`prescription_items_tenant_id`:** add nullable `tenant_id`; backfill from `prescriptions`; BEFORE INSERT trigger
   `prescription_items_fill_tenant` (fills from the parent when null; raises `23514` when a supplied value differs);
   `set not null`; index `(tenant_id, prescription_id)`; FK `tenant_id → tenants on delete cascade`. App inserts keep
   working unchanged.
4. **`composite_fks_expand`:** composite FKs `NOT VALID`, created **with the final delete action** (R-12):
   RESTRICT for visits→patients, invoices→patients/visits, payments→invoices, prescriptions→patients/visits,
   consultation_diagnoses→patients/visits, consultations→patients, consent_records→patients, follow_ups→patients,
   patient_documents→patients, communication_queue→patients, queue_tokens→visits, visit_revisions→visits,
   waitlist_entries→patients and →visits(`promoted_visit_id`), referrals→patients; CASCADE for invoice_items→invoices,
   prescription_items→prescriptions, document_share_tokens→patient_documents, api_key_usage_daily→api_keys,
   webhook_delivery_queue→webhook_subscriptions (the structural fix for V2-03 triage M-XTENANT-WH: a queue row can no
   longer name another tenant's subscription; the V2-04 handler's tenant check stays as defence in depth);
   **`on delete set null (<col>)`** (column list, PG ≥ 15; a plain
   `SET NULL` would null `tenant_id`, research Pitfall 3) for follow_ups.visit_id, patient_documents.visit_id,
   communication_queue.appointment_id, referrals.visit_id, audit_logs.api_key_id. Doctor references →
   `memberships(user_id, tenant_id)` (`unique_user_tenant`), RESTRICT: visits, prescriptions, consultations, follow_ups,
   waitlist_entries, schedule_blocks, doctor_custom_diagnoses, doctor_custom_medicines, doctor_prescription_templates
   (`doctor_id`), referrals (`referring_doctor_id`). Kept as is: every `tenant_id → tenants` CASCADE,
   `referrals.target_tenant_id` (cross-tenant by design), every FK to `auth.users`. `(tenant_id, <fk>)` index for each
   composite FK unless one exists.
5. **Diagnostics (after expand):** D1 and D5 must be 0 → `composite_fks_validate` (`alter table … validate
   constraint …` for each).
6. **`composite_fks_contract`:** drop the replaced single-column FKs to tenant parents (only those; names from the
   catalogue, listed in the migration).
7. Update FK hints in select strings (step 1 grep), regenerate types, run the full lanes; record `select count(*) from
   pg_constraint where contype='f' and not convalidated` = 0.

### Tests that fail without the change
- `composite_fks.test.sql`: for every composite FK (expected list asserted `set_eq` against `pg_constraint`), inserting
  a tenant-A child that references a tenant-B parent → `throws_ok(…, '23503')`; a `SET NULL (col)` child keeps its
  `tenant_id` when the parent is deleted as `postgres`; a doctor reference to a non-member user → `23503`.
- `migration_edge_cases_fk.test.sql` (roadmap "migration tests on a copy seeded with the diagnostics' edge cases"; all
  rolled back): drop one composite FK, plant a cross-tenant row, re-add `NOT VALID` (succeeds), `VALIDATE` →
  `throws_ok('23503')`, fix the row, `VALIDATE` → `lives_ok`; same for a non-member doctor (D5).
- `cross-tenant-refs.spec.ts` new case: a direct PostgREST insert with a member's JWT (bypassing the app's friendly
  check) of a visit whose `patient_id` belongs to tenant B → error code `23503` (before: row created; RLS checks only the
  child's own `tenant_id`).
- `composite_fks.test.sql` M-XTENANT-WH case: as `postgres` (the only writer left after V2-04 04-03c), a
  `webhook_delivery_queue` row of tenant A naming tenant B's subscription → `23503` (before: inserted; V2-03 03-13d's
  dispatcher check was the only stop).
- `diagnostics-script.spec.ts`: a non-loopback URL → exit 1 before any query.

### Acceptance mapping
Acceptance 3 "a cross-tenant child insert fails": full. Roadmap evidence "diagnostics report": `evidence/05a/diagnostics/`.
Roadmap test "migration tests … edge cases": FK half (exclusion half in 05-08).

---

## 05-04 RESTRICT proof + DELETE policies + silent no-op fixes (P1-08, BACKEND C4, research Pitfall 11) · S · 05a Wave 3

### Files
Migration `delete_policies` (+ chores); `features/prescriptions/service.ts` (`deletePrescriptionItem`, `:304-316`),
`features/terminology/service.ts` (diagnosis remove, `:272`), `features/billing/service.ts` (invoice item delete,
`:616-617`), `features/consultation/service.ts` (follow-up delete, `:186-188`); `supabase/tests/database/delete_rules.test.sql`;
`tests/integration/delete-paths.spec.ts`; `tests/authz/table-matrix.ts` (every table's DELETE set to its final rule);
regenerated matrix.

### Steps
1. Migration: drop `visits_delete_member` and every parent-row DELETE policy (prescriptions, queue_tokens,
   waitlist_entries, consultation_diagnoses' OA rule); create the final DELETE policies from the shared-contract table
   (05-04 owns all DELETE policies; 05-02 never touches them). DELETE policies are permission-only; draft/signed
   predicates belong to V2-09a (R-21). `webhook_delivery_queue` and `communication_queue` get no DELETE policy (V2-04
   revoked API-role writes, 04-03c).
2. Services: every delete (and update) path that RLS can filter to 0 rows uses `.select("id")` and treats 0 rows as
   `NOT_FOUND`/`FORBIDDEN` (V2-03 `AppError`), with the audit row written **only** after a real delete.

### Tests that fail without the change
- `delete_rules.test.sql`: as `postgres`, deleting a patient that has a visit → `throws_ok('23503')`; deleting a visit
  that has an invoice → `23503`; deleting a **tenant** cascades every child to 0 rows (teardown and future purge depend
  on it, research Pitfall 4); a member cannot delete a visit (0 rows).
- `delete-paths.spec.ts` (real JWTs): doctor deletes own draft Rx item → row gone (before: 0 rows deleted, success
  reported, audit row written); receptionist deletes an invoice item → row gone (before: no DELETE policy, silent
  success); a receptionist attempting an Rx item delete → `FORBIDDEN`, row still present, **no** audit row.

### Acceptance mapping
P1-08: CASCADE → RESTRICT on clinical and financial children (actions set in 05-03, proven here) and
`visits_delete_member` dropped. Supports acceptance 1 (DELETE column of the matrix).

---

## 05-02a Clinical split: `clinical_notes` table, expand + migrate (P1-01, PO-3, SVP §6.1 row "visits.clinical_notes", R-2…R-5) · L · 05a Wave 4

### Files
- Migration `clinical_notes_expand`; `types/database.ts`.
- App reads/writes switched (the files that reference the moved columns today): `app/(dashboard)/cabin/page.tsx`,
  `app/(dashboard)/consultation/[id]/page.tsx`, `app/api/v1/visits/route.ts`, `app/api/v1/visits/[id]/route.ts`,
  `app/api/visits/[id]/prescription-pdf/route.ts`, `components/consultation/{ai-scribe-modal,consultation-workspace,
  vitals-block,patient-history-drawer}.tsx`, `components/patients/patient-visit-history.tsx`,
  `components/visits/read-only-encounter-modal.tsx`, `components/queue/{queue-card,queue-view,triage-vitals-modal}.tsx`,
  `components/cabin/my-queue-card.tsx`, `components/referrals/{create-referral-modal,referrals-register}.tsx`,
  `features/consultation/{schema,service}.ts`, `features/visits/{schema,service,actions}.ts`,
  `features/patients/{schema,service}.ts`, `features/prescriptions/service.ts`,
  `features/prescriptions/pdf/prescription-document.tsx`, `features/referrals/{schema,service,types}.ts`,
  `features/referrals/pdf/referral-letter-document.tsx`, `features/dpdp/export.ts`,
  `features/dpdp/pdf/medical-summary-doc.tsx`, `features/notifications/triggers.ts`, `lib/ai/{soap-generator,sanitizer,
  types}.ts`, `lib/api/openapi-spec.ts` (response shape unchanged), `lib/db/types.ts` (domain interface
  `ClinicalNotes`; `Visit` loses the six fields). Re-grep at start; the list is the research's plus vitals users.
- The ~19 test files that read or write the moved columns (re-grep), `tests/authz/table-matrix.ts`, regenerated matrix,
  `supabase/tests/database/clinical_notes.test.sql`, `tests/security/role-rls.spec.ts`.

### Steps
1. **Migration (expand):** `public.clinical_notes(visit_id uuid primary key, tenant_id uuid not null references
   public.tenants(id) on delete cascade, vitals jsonb not null default '{}', chief_complaints jsonb not null default
   '[]', clinical_notes text, specialty_data jsonb not null default '{}', investigations_advised text[] not null default
   '{}', advice text[] not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not
   null default now())`, `unique (tenant_id, visit_id)`, composite FK `(tenant_id, visit_id) → visits(tenant_id, id) on
   delete restrict`. Column names kept identical to the `visits` columns (R-4).
   RLS on; `revoke all … from public, anon, authenticated; grant select, update on public.clinical_notes to
   authenticated`. Policies: SELECT `tenant_id in (select authz.tenant_ids_with('consultations:view'))`; UPDATE using and
   with check `tenant_id in (select authz.tenant_ids_with('consultations:edit')) or tenant_id in (select
   authz.tenant_ids_with('vitals:edit'))`. No INSERT/DELETE policy.
   Trigger `clinical_notes_guard` (BEFORE UPDATE, invoker): `visit_id`/`tenant_id` never change; when `auth.uid()` is not
   null and `public.has_permission(new.tenant_id, 'consultations:edit')` is false, any change other than `vitals` and
   `updated_at` raises `42501` (nurses record vitals only, R-3).
   Trigger `visits_create_clinical_notes` (AFTER INSERT on `visits`, SECURITY DEFINER, `search_path=''`): inserts the
   empty row for `new.id`/`new.tenant_id` (`on conflict do nothing`); content is fixed, so a receptionist creating a
   visit cannot inject notes.
   Backfill one row per existing visit from the current columns (coalesced to the defaults). Then clear the six columns
   on `visits` (`null` / their defaults) and add `visits_clinical_content_moved` CHECK (all six null or default) —
   VALID, so from here no path can put clinical content back into `visits` (R-2). The columns themselves are dropped in
   05-b0 after the switched app is deployed.
2. **App switch:** reads embed `clinical_notes(...)` over the composite FK (one-to-one; the embed is `null` when RLS
   hides the row) or query by `visit_id`; writes are `from("clinical_notes").update(…).eq("visit_id", id)` with
   `.select("visit_id")` and a 0-row → `FORBIDDEN` check. Vitals writes (triage modal → `features/visits/actions.ts`)
   update `clinical_notes.vitals`. The v1 API keeps its response shape (OpenAPI unchanged; `tests/api/**` stay green).
   Every page/component that a receptionist or admin can reach renders `null` clinical data as absent (no crash, no
   "undefined"). The consultation page for a receptionist (P1-07, V2-08) must not 500 on the `null` embed; the P1-07
   marker stays unless its body genuinely passes. If any Realtime subscription listens to `visits` for notes, move it
   to `clinical_notes` (grep `channel(` at start).
3. `npm run db:types`; then `rg` over `app/ features/ lib/ components/ tests/` for the six column names on `visits`
   (selects, inserts, updates, types) → only `clinical_notes`-table usages remain (output in evidence).
4. Update the ~19 tests; run full lanes + e2e (M0 consult flow, journey 8, cabin/queue flows) and check the
   consultation and queue screens at 360/820/1280 with axe (layout must not change).

### Tests that fail without the change
- `clinical_notes.test.sql`: receptionist and admin SELECT → 0 rows while doctor, nurse and owner see 1; nurse UPDATE
  of `vitals` → 1 row, nurse UPDATE of `clinical_notes` → `42501`; receptionist UPDATE → 0 rows; inserting a visit
  creates exactly one `clinical_notes` row; writing clinical text into `visits` → `throws_ok('23514')`; tenant-B owner
  → 0 rows.
- `role-rls.spec.ts` (Vitest, real receptionist JWT through supabase-js PostgREST — the acceptance path):
  `from("clinical_notes").select("*")` returns `[]` while a doctor's client reads the note; `from("visits")
  .select("clinical_notes, vitals")` returns only empty/default values.
- The updated consult/visit/Rx/AI/PDF/DPDP specs and e2e flows prove the switch (they fail against the cleared `visits`
  columns if any read was missed).

### Acceptance mapping
Acceptance 2 "a receptionist PostgREST read of `clinical_notes` is denied (per PO-3)": full at the 05a gate (the table
denies; the legacy columns hold no data and accept none). Contract (column drop) in 05-b0.

---

## 05-02b Clinical, front-desk and financial policies + guard call sites (P1-01, P0-14 RLS part, PO-3, SVP §6.1) · L · 05a Wave 5

### Files
- Migrations `policies_clinical`, `policies_front_desk`, `policies_financial`; `types/database.ts`.
- `features/billing/actions.ts` (`:39,:47,:61,:67` `appointments:edit` → `billing:collect`), `features/billing/service.ts`
  (`:89,:257,:473,:601` likewise; `completeAndBillConsultation`: sign step `consultations:edit`; invoice step own visit;
  payment step requires `billing:collect` when `payment_collected = true`, otherwise route to reception),
  `components/consultation/sign-and-bill-modal.tsx` (without `billing:collect` the "collected" option is hidden and the
  modal defaults to "send to reception"; the server check is the control).
- `tests/security/guard-manifest.ts`, `tests/security/guard/{engine,valid-inputs}.ts` (permission per action),
  `tests/security/review2-fixes-db.spec.ts`, `tests/security/review3-fixes-db.spec.ts`,
  `tests/integration/consultation-service-guards.spec.ts` (doctor Sign & Bill expectations per PO-3).
- `tests/patients/receptionist-registration.spec.ts`, `tests/billing/collect-permission.spec.ts`;
  `tests/authz/table-matrix.ts` (these domains → target rules); regenerated matrix.

### Steps
1. **`policies_clinical`:** consultation_diagnoses, consultations (the `ALL` policy replaced by per-operation
   policies), visit_revisions, prescriptions, prescription_items (now on `tenant_id`, no subquery),
   doctor_custom_diagnoses/medicines/templates (`doctor_id = (select auth.uid())` on writes), referrals (originating and
   target sides re-expressed with helpers; the existing `referrals_target_update_guard` stays).
2. **`policies_front_desk`:** patients (+ BEFORE UPDATE trigger `patients_clinical_fields_guard`: a change to
   `allergies` or `chronic_conditions` by a caller without `consultations:view` in that tenant raises `42501`; INSERT is
   not restricted, so registration intake can record them, R-8), consent_records, visits, queue_tokens,
   waitlist_entries, schedule_blocks, follow_ups, communication_queue (SELECT only; V2-04 04-03c already revoked every
   API-role write, so this plan drops any leftover INSERT policy and the matrix asserts the revoke).
3. **`policies_financial`:** invoices, invoice_items, payments per the contract table (doctor: own visit, via
   `exists (select 1 from public.visits v where v.tenant_id = invoices.tenant_id and v.id = invoices.visit_id and
   v.doctor_id = (select auth.uid()))`); `generate_tenant_invoice_number` gains a check
   `has_permission(t, 'billing:collect') or has_permission(t, 'consultations:edit')` (Sign & Bill, R-7) and raises
   `42501` otherwise.
4. App guards and the modal as listed; fixed safe messages (no driver text). `record_payment` is SECURITY INVOKER, so
   the payments INSERT policy already binds it; its own role check is replaced in 05-02c.
5. Matrix rows → target rules; `npm run authz:gen`; full lanes; e2e (M0 consult → "routed to reception" stays green;
   receptionist collect flow); sign-and-bill modal at 360/820/1280 + axe, for a doctor and for an owner.

### Tests that fail without the change
- Generated matrix cells for these tables, e.g. receptionist `patients` INSERT → ok; doctor `payments` INSERT →
  `42501`; nurse `invoices` SELECT → 0; doctor sees the invoice of own visit (1) but not a colleague's (0); receptionist
  `prescriptions` SELECT → 0; admin `clinical_notes`/`consultation_diagnoses` SELECT → 0.
- `receptionist-registration.spec.ts` (acceptance 5): a receptionist session calls `createPatient` → success; the row
  exists with `created_by` = receptionist; the receptionist can update `phone` but an update of `allergies` →
  `FORBIDDEN` and unchanged.
- `collect-permission.spec.ts`: receptionist `recordPayment` → ok; doctor and nurse → `FORBIDDEN`, 0 payments; doctor
  `completeAndBillConsultation` with `payment_collected: true` → `FORBIDDEN` and the visit unsigned/unbilled state
  unchanged, with `false` → invoice created unpaid, 0 payments; owner Sign & Bill with collection → ok (solo clinic).
- e2e: M0 consult-rx-finish (doctor routes to reception) green; receptionist collect path green.

### Acceptance mapping
Acceptance 5 "a receptionist can register a patient": full (permission 05-01b + RLS + guard here). Acceptance 1:
rows for these domains. P0-14 backend; PO-3 collect rules.

---

## 05-02c Admin/system policies, storage, grants hardening, audit v2, active-tenant sweep, lab keys (P1-01, P1-04 trigger part, SVP §6.1, BACKEND C9 storage cast fix, V2-03 handovers) · M · 05a Wave 6

### Files
- Migrations `policies_admin_system`, `storage_policies`, `grants_hardening`, `audit_v2`, `definer_active_tenant`
  (each with the V2-03 chores); `types/database.ts`.
- `lib/audit/audit.ts` (user path → `.rpc("log_audit", …)`; system path unchanged); `scripts/gen-authz-pgtap.ts`
  (legacy rule kinds deleted; storage cells; grants expectations), `tests/authz/table-matrix.ts`, regenerated matrix;
  `tests/helpers/rls.ts` (`assertRlsCatalog` expectations → new policy names, or replaced by the completeness test).
- `scripts/drift/schema-snapshot.mjs` (the snapshot query also records `storage.objects` policies, so a dashboard edit
  of a storage policy on staging is drift; hosted `drift.yml` uses the same query) + `tests/ci/schema-snapshot.spec.ts`
  case.
- Lab storage keys (R-45): `features/labs/service.ts` (upload path + `upsert: false`), `features/labs/utils.ts`
  (`formatAmendedFilename` becomes the download name only), `tests/labs/lab-storage-key.spec.ts` (new).
- `supabase/tests/database/{storage_policies,grants,audit_v2,definer_functions}.test.sql`;
  `tests/audit/audit-actor.spec.ts`; `tests/billing/record-payment-rpc.spec.ts` and
  `tests/billing/payment-actor-guards.spec.ts` (V2-03 specs: role expectations per PO-3, active-tenant leg).

### Steps
1. **`policies_admin_system`:** tenants, memberships, invitations, api_keys, api_key_usage_daily,
   webhook_subscriptions, webhook_delivery_queue, tenant_messaging_config, in_app_notifications (own rows only; fixes
   the "any member reads colleagues' notifications" gap), document_share_tokens (by `resource_type`), audit_logs SELECT
   (`clinic:manage`), v1 `subscriptions`/`payment_records` (`clinic:manage` until 05-09c drops them), cdci_*/
   opd_diagnoses SELECT unchanged. `memberships` and `tenants` per the contract table (own rows / all clinics for the
   switcher, everything else on the active tenant, R-42); `webhook_delivery_queue` SELECT only (V2-04 contract).
2. **`storage_policies`:** replace every `storage.objects` policy for the two buckets with per-class policies from the
   contract table. Path classes come from the key builders (`features/prescriptions/pdf/generator.ts`,
   `features/billing/pdf/generator.ts`, `features/labs/service.ts`, `features/referrals/pdf/generator.ts`, the branding
   upload path); objects outside a known class are denied. Tenant check compares **text**
   (`(storage.foldername(name))[1]` or `[2]` for the `tenants/<uuid>/…` shape) with `authz.tenant_ids_with(…)`
   cast to text — no `::uuid` cast on user-controlled names (research anti-pattern; C9). The `prescriptions` bucket keeps
   UPDATE for its writers because both archives upload with `upsert: true` (R-23). The lab class matches the
   `…/patients/<uuid>/labs/<name>` shape for both the new id-only names and the legacy synthetic ones.
   **Lab keys without patient names (R-45; V2-03 triage, accepted to V2-05 storage; review E I-4):** the upload key
   becomes `tenants/<tenant_id>/patients/<patient_id>/labs/<document_id>.<ext>`, where `<document_id>` is a
   `crypto.randomUUID()` used as the `patient_documents.id` inserted after the upload (and in the key, so a key never
   names a person); `upsert: false` (a same-name same-date upload no longer replaces the earlier object);
   `formatAmendedFilename` (patient name + original name + date) is used only as the download filename passed to the
   signed URL's `download` option, never in a key, a log or an audit row. Existing objects keep their keys (synthetic
   data only; production starts empty in V2-15), so no rename job. The key keeps the `[A-Za-z0-9_./-]` shape the 000022
   CHECK enforces.
3. **`grants_hardening`:** `revoke truncate, references, trigger on all tables in schema public from anon,
   authenticated`; revoke insert/update/delete on cdci_*/opd_diagnoses from `anon, authenticated`; revoke every table
   privilege in `public` from `anon` (no `anon` policy exists; anon paths are definer RPCs — the grants test lists any
   exception, expected none); `alter default privileges for role postgres in schema public revoke all on tables from
   anon, authenticated` and `… revoke execute on functions from public, anon` (future objects start closed; R-13).
   Re-grant only what each table's matrix row needs (the generator emits the expected grant set). **Statement timeouts
   per role (03-07 D1 gap, finding 3):** no value changes; `grants.test.sql` pins the role-level `statement_timeout` of
   `anon` and `authenticated` as found at branch time in `pg_roles.rolconfig` (locally `authenticated` 8 s per 03-07),
   because function-level timeouts are not enforced for the calling statement and the role setting is the only bound;
   TARGET §7.5 erratum stays as V2-03 proposed it (R-24 there).
4. **`audit_v2`:** `public.log_audit(p_tenant uuid, p_action text, p_entity_type text, p_entity_id uuid, p_metadata
   jsonb) returns bigint` SECURITY DEFINER: requires `auth.uid()` and `p_tenant = authz.active_tenant_id()` (an active
   membership, R-42; else `42501`); `actor_id = auth.uid()`, `actor_role` = the caller's role, `actor_type = 'user'`;
   grant `authenticated`. The actor-forcing trigger **already exists** (V2-03 000029 `private.audit_logs_actor_guard`,
   M-AUDITSYS: API-role writers get `actor_type 'user'`, `actor_id auth.uid()`, their membership role, no `api_key_id`,
   no `metadata.system_actor`); `create or replace` it (same name) so that an API-role writer whose `new.tenant_id` is not
   `authz.active_tenant_id()` raises `42501` (today it only skips the role). Drop `audit_logs_insert_member`;
   `revoke insert on public.audit_logs from authenticated, anon`. `create or replace` `public.record_payment` (V2-03
   03-07, same signature, 000029 body): role check → `public.has_permission(p_tenant_id, 'billing:collect')`; the user
   path requires `p_tenant_id = authz.active_tenant_id()` (the DB-side check the D1 spike asked for: `p_tenant_id` is
   checked, no longer trusted-from-server); user-path audit via `public.log_audit(…)` (the INSERT revoke would break its
   direct insert); system path, replay rules and the `clinicos.record_payment_id` marker unchanged. Any other SECURITY
   INVOKER function in `public` that inserts into `audit_logs` is converted the same way (catalogue review in the
   migration).
5. **`definer_active_tenant` (R-42 sweep; V2-03 03-07 finding 2):** every SECURITY DEFINER function in `public` and
   `private` that authorises a user by tenant (catalogue list from `pg_proc where prosecdef`, reviewed in the
   migration) moves off `current_user_tenant_ids()`, `current_user_has_role(…)` and direct `memberships` lookups to
   `authz.*`/`has_permission` (active-tenant bound), or compares its tenant argument with `authz.active_tenant_id()`:
   among them V2-04's `enqueue_message`/`enqueue_webhook_event` (their `p_tenant_id` constraint stays),
   `private.outbox_payment_recorded`'s user check, `create_share_token`, `change_member_role`, `referral_source_clinics`,
   `generate_tenant_invoice_number`. Token-scoped anon functions (`resolve_share_token`, reschedule) and system-only
   functions are listed as exempt with the reason. `public.current_user_tenant_ids()` keeps its signature (member
   helper) with no remaining policy user.
6. `lib/audit/audit.ts` user path → RPC; `ALLOWED_METADATA_KEYS` unchanged. Delete the legacy rule kinds from the
   generator; every table now has its target rule. Full lanes + e2e.

### Tests that fail without the change
- `audit_v2.test.sql`: `authenticated` direct INSERT into `audit_logs` → `42501`; `log_audit` by a tenant-A doctor
  records the doctor as actor; `log_audit` for tenant B by a tenant-A member → `42501`; a definer path inserting a forged
  `actor_id` under a JWT → the stored actor is the JWT subject; with INSERT re-granted inside the rolled-back pgTAP
  transaction (the guard is defence in depth behind the revoke), a dual member whose active tenant is A inserting an
  audit row for B → `42501` (before: 000029's guard only looks up the role and lets it through); catalogue: no SECURITY INVOKER function in
  `public` whose source inserts into `public.audit_logs`.
- `audit-actor.spec.ts` (real JWT): `from("audit_logs").insert({ actor_id: <other user> })` → error, no row;
  `logAudit` through the service → row with actor = caller.
- `storage_policies.test.sql` (cells generated from the matrix + hand cases, objects inserted as `postgres` and read as
  simulated users, research Pattern 4): per class × role allowed/denied; receptionist cannot read an Rx PDF but can read
  a receipt; tenant-B prefix → 0; a malformed path `not-a-uuid/x.pdf` → no error, denied (before: `22P02` cast error).
- `grants.test.sql` (catalogue loops): no TRUNCATE/REFERENCES/TRIGGER for `anon`/`authenticated` on any `public`
  table; `anon` holds no table privilege in `public`; the default ACLs for `postgres` in `public` and `authz` grant
  nothing to `anon`/`authenticated`/`PUBLIC`; every table's grants equal the generator's expected set.
- `grants.test.sql` also pins the role-level `statement_timeout` of `anon` and `authenticated` (fails if a migration or
  a local stack upgrade drops it).
- `record-payment-rpc.spec.ts`: doctor and nurse → `FORBIDDEN`; receptionist → ok with audit actor = receptionist; a
  dual member whose active tenant (header) is A calling with `p_tenant_id` = B → `NOT_FOUND`, 0 payments (before: the
  RPC trusted `p_tenant_id` from the server). `payment-actor-guards.spec.ts` (03-13c) stays green.
- `definer_functions.test.sql` (new; the list is `set_eq` with the catalogue's SECURITY DEFINER functions in `public`
  and `private`, so a new definer function without a case fails): for each user-authorised function, a dual member
  whose header names A acting on a B subject → refused (`42501`/`P0002`/empty), and the same call with the header
  naming B → allowed; exempt functions listed with the reason. 05-10a adds the access-level leg to the same file.
- Generated matrix: every "dual member, header A, B row" cell denied for every table and storage class (the V2-03
  handover's multi-membership leg); "no header, two memberships" → only `tenants` and own `memberships` rows visible.
- `lab-storage-key.spec.ts` (DB lane + local Storage, R-45): uploading a report for a synthetic patient named
  "Asha Testpatient" yields a key that matches `^tenants/<uuid>/patients/<uuid>/labs/<uuid>\.[a-z0-9]{1,10}$` and
  contains no part of the name; two uploads of the same file name and date create two objects (before: the key held
  the name and the second upload overwrote the first); the signed URL's download name is the readable filename.
- `schema-snapshot.spec.ts`: a changed `storage.objects` policy shows as drift (before: storage policies were outside
  the snapshot).
- The completeness test now also asserts that no policy references the legacy helpers (step 5 of 05-01b).

### Acceptance mapping
Acceptance 1 for roles: every table and bucket on its target rule (roles × `full`; status and access levels follow in
05b). P1-04 trigger part (actor forced from `auth.uid()` by V2-03's guard, now also active-membership bound; direct
INSERT revoked; the in-transaction part stays V2-07). V2-03 handovers closed here: active-tenant binding of every
policy and definer function (multi-membership leg), `record_payment` `has_permission` + DB-checked `p_tenant_id`, lab
storage keys without names, per-role statement timeouts pinned.

---

## 05-06 Referrals: directory + consent; exports: `exports:create` + minimal DTOs (P1-10, P1-11, ARC-07/C15, API-15) · S · 05a Wave 7

### Files
Migration `referrals_directory_consent`; `types/database.ts`; `features/referrals/{service,schema}.ts` (target lookup
through `public.referral_directory_search` if the current form selects a target tenant; otherwise no app change),
`features/dpdp/export.ts` + new `features/dpdp/export-dto.ts` (explicit allow-list per entity),
`app/api/v1/patients/[id]/export/route.ts` (requires `exports:create`); `docs/runbooks/referral-directory.md` (one SQL line
to list a pilot clinic; UI is V2-11); `supabase/tests/database/referrals_rules.test.sql`, `tests/dpdp/export-dto.spec.ts`,
`tests/api/export-scope.spec.ts`.

### Steps
1. `tenants.referral_directory_listed boolean not null default false` (set by `clinic:manage` through the tenants UPDATE
   policy). BEFORE INSERT/UPDATE OF `target_tenant_id` trigger on `referrals`: a non-null target must be listed and must
   differ from `tenant_id`, else `P0001` `REFERRAL_TARGET_NOT_LISTED`; when the history snapshot column is non-null the
   consent column must be true, else `P0001` `REFERRAL_CONSENT_REQUIRED` (column names from 000013/000021; research:
   `consented_history_snapshot`, `patient_consents_history_sharing`). The receiver-column guard (000021) is unchanged.
2. `public.referral_directory_search(p_query text) returns table(id uuid, name text)` SECURITY DEFINER: callers with
   `consultations:edit` in the active tenant (`authz.tenant_ids_with`, R-42); listed tenants only; at most 20 rows; no
   other columns; joins 05-02c's `definer_functions.test.sql` list.
3. Exports: the staff path already requires `exports:create` (`features/dpdp/export.ts:45-53`, ruling 01-09). Build the
   payload only through `export-dto.ts` (allow-listed fields per entity: patient demographics, visits' non-internal
   fields, `clinical_notes` content, prescriptions + items, invoices + payments, documents' metadata without storage
   paths; never token hashes, storage keys, `created_by` ids or other tenants' data). The API-key route requires an
   `exports:create` scope on the key (keys without it → 403); `/api/v1` stays off in production (PO-16).

### Tests that fail without the change
- `referrals_rules.test.sql`: a referral to a non-listed tenant → `P0001 REFERRAL_TARGET_NOT_LISTED`; to a listed tenant
  → ok; self-target → refused; a snapshot without consent → `REFERRAL_CONSENT_REQUIRED`; receiver changing the clinical
  summary → still refused (regression); `referral_directory_search` returns only listed tenants and only `id, name`.
- `export-dto.spec.ts`: every key of a generated export ⊆ the allow-list; a planted internal column on a fixture row
  does not appear (before: whole rows were exported).
- `export-scope.spec.ts`: an API key without `exports:create` → 403; with it → 200 (API_V1 test switch as in
  `tests/helpers/api-v1.ts`).

### Acceptance mapping
P1-10 (receiver status-only guard: existing; target constrained to the opt-in directory; consent check), P1-11
(`exports:create` on both paths; minimal DTOs).

---

## 05-08 Exclusion constraint + queue-token counter + tenant-local dates + FK indexes (P1-39, P1-40, P2-08 FK part, DB-08, DB-09, V2-03 R-33) · M · 05a Wave 8

### Files
Migrations `visits_no_double_booking`, `queue_token_counters`, `tenant_local_dates`, `fk_indexes` (each with the V2-03
chores); `types/database.ts`; `features/visits/scheduling-service.ts` (`mapDbError(err, { VISITS_NO_DOUBLE_BOOKING:
"<slot taken text>" })`: `23P01` → `CONFLICT` with the constraint as reason is **already** mapped and tested by V2-03,
`lib/db/errors.ts` + `tests/db/error-map.spec.ts`, so neither changes), `features/queue/service.ts` (`:69` →
`rpc("next_queue_token", { p_visit_id })`; today it computes the clinic date with `getTenantToday` and passes
`p_date`, 03-05), `tests/authz/table-matrix.ts` (`queue_token_counters`); `supabase/tests/database/{scheduling_exclusion,
migration_edge_cases_overlap,queue_tokens,tenant_local_dates,fk_indexes}.test.sql`;
`tests/scheduling/no-double-booking.spec.ts`, `tests/integration/queue-token-concurrency.spec.ts`,
`tests/integration/ist-boundaries.spec.ts` (V2-03 spec: SQL/app date parity case).

### Steps
1. `npm run db:diagnostics -- --label before-05-08` → D6 must be 0 (else stop and raise; BACKEND C7 options).
2. **`visits_no_double_booking`:** `create extension if not exists btree_gist with schema extensions;`
   `public.visit_slot(p_at timestamptz, p_mins int) returns tstzrange language sql immutable parallel safe set
   search_path = ''` (`tstzrange(p_at, p_at + make_interval(mins => p_mins), '[)')`; minute-only intervals do not depend
   on `TimeZone`, so IMMUTABLE is sound, R-11); `alter table public.visits add constraint visits_no_double_booking
   exclude using gist (tenant_id with =, doctor_id with =, public.visit_slot(scheduled_at, estimated_duration_minutes)
   with &&) where (origin_type = 'scheduled' and not is_overbooked and status not in ('cancelled','no_show'))`. Created
   valid (exclusion constraints cannot be `NOT VALID`; research Pitfall 2). Revoke EXECUTE on `visit_slot` from `anon`.
3. **`queue_token_counters`:** table `(tenant_id, date, last_token int, primary key (tenant_id, date))`, RLS on, no
   policies, no grants for tenant roles. `public.tenant_local_date(p_tenant uuid, p_at timestamptz) returns date` STABLE
   (`(p_at at time zone t.timezone)::date`, `tenants.timezone` default `Asia/Kolkata`; a null or unknown zone name
   falls back to `Asia/Kolkata` exactly as `resolveTimeZone`/`DEFAULT_CLINIC_TZ` do in `lib/datetime`, so SQL and app
   never disagree about "today"). `public.next_queue_token(p_visit_id
   uuid) returns table(token_number int, token_date date)` SECURITY DEFINER: tenant from the visit; caller must hold
   `appointments:edit` there (`has_permission`, else `42501`); `insert … on conflict (tenant_id, date) do update set
   last_token = queue_token_counters.last_token + 1 returning …` (research Pattern 5; R-18). Seed counters from
   `max(token_number)` per tenant/date. Switch `features/queue/service.ts` to the RPC and pass `token_date`.
   `generate_daily_queue_token` stays until 05-b0 (contract).
4. **`tenant_local_dates`:** `queue_tokens.date` and `patient_documents.report_date` drop `DEFAULT CURRENT_DATE`
   (server `TimeZone` is UTC) and get BEFORE INSERT triggers that fill a null value with
   `tenant_local_date(new.tenant_id, now())` (closes V2-03 R-33 without breaking callers that omit the value; the app
   already passes the clinic date since 03-05, so the triggers cover the remaining SQL and system paths).
5. **`fk_indexes`:** an index whose leading columns cover every FK column set in `public` (the 46 found by research plus
   every FK added in this phase), no exceptions.
6. Full lanes + e2e (booking, overbook, check-in flows).

### Tests that fail without the change
- `scheduling_exclusion.test.sql`: a second overlapping non-overbooked scheduled visit for the same doctor →
  `throws_ok('23P01')`; the same with `is_overbooked = true` → ok; back-to-back 10:00-10:15 / 10:15 → ok; a cancelled
  overlap → ok; another doctor → ok.
- `migration_edge_cases_overlap.test.sql` (rolled back): drop the constraint, plant an overlap, re-adding it →
  `throws_ok('23P01')`; mark one `is_overbooked` → re-add `lives_ok` (BACKEND C7 remedy proven).
- `no-double-booking.spec.ts`: two parallel `bookAppointment` calls for the same slot (`Promise.all`, two receptionist
  sessions) → exactly one success and one `CONFLICT` (before: both succeed).
- `queue-token-concurrency.spec.ts` (acceptance 7): 50 parallel check-ins through the service as receptionists →
  tokens are exactly `1…50`, all distinct, every `date` = `tenant_local_date(tenant, now())` computed in SQL in the same
  test (before: duplicate tokens from `MAX()+1`).
- `queue_tokens.test.sql`: `tenant_local_date` at `2026-11-13 19:00:00+00` = `2026-11-14` (IST boundary); a nurse or
  receptionist without `appointments:edit` in that tenant → `42501`; tenant role cannot read/write the counter table.
- `tenant_local_dates.test.sql`: the two columns have no default and the triggers fill the tenant-local date; an
  invalid `tenants.timezone` value → the `Asia/Kolkata` date, no error.
- `ist-boundaries.spec.ts` (V2-03) new case: at a time between 18:30 and 24:00 UTC, `tenant_local_date(t, now())` from
  SQL equals `getTenantToday(db, t).today` from `lib/datetime/server` (before: `CURRENT_DATE` gave the UTC date).
- `fk_indexes.test.sql` (catalogue loop): 0 FKs without a covering leading index (before: 46).

### Acceptance mapping
Acceptance 6 "two overlapping non-overbooked appointments cannot both be inserted": full. Acceptance 7 "50 parallel
check-ins produce 50 distinct tokens with the IST date": full. P2-08 FK part; roadmap test "concurrency tests for
check-in, booking"; migration edge-case test (overlap half); V2-03 R-33.

---

## 05a gate (part close)

1. **Report gates:** append the 05a pgTAP files to `REQUIRED_FILES` in `scripts/ci/assert-pgtap-report.mjs` and the new
   Vitest specs (parity, active-tenant-carrier, role-rls, receptionist-registration, collect-permission, delete-paths,
   audit-actor, lab-storage-key, no-double-booking, queue-token-concurrency, export-dto, cross-tenant-refs) to
   `scripts/ci/assert-vitest-report.mjs`;
   update both floors with the arithmetic in the same commit.
2. **Local evidence (tool-produced):** `npm run typecheck`, `npx eslint .`, `npm run inventory`;
   `node scripts/phase-evidence.mjs .planning/phases/05-db-authorisation-entitlements/evidence/05a 2` (two full Vitest +
   two pgTAP runs + static checks); `npm run e2e:build && npm run e2e:pr` JSON into `evidence/05a/`; the diagnostics
   JSON files; the generated `AUTHZ-MATRIX.md` at the gate SHA; `select count(*) from pg_policies` per table.
3. **CI (orchestrator):** push; mark the 05a PR ready (base = V2-04 branch while open); all five checks green with 0
   retried tests and the pgTAP gate green; `node scripts/phase-evidence.mjs …/evidence/05a --ci-run <id>`.
4. **Reviews (DoD 6)** into `.planning/phases/05-db-authorisation-entitlements/reviews/`: an independent review of the
   full 05a diff (fresh context) → `v205a-review-independent.md`; **adversarial** reviews: (A) authorisation — helpers,
   the active-tenant carrier (forged or missing `x-clinicos-tenant`, dual members, Storage), every policy and the
   definer-function sweep, storage incl. the lab key scheme, grants, audit v2, the clinical split and its guard
   triggers, PostgREST bypass attempts with each role's JWT → `v205a-review-adversarial-authz.md`; (B) integrity — composite FKs, RESTRICT/cascade, exclusion,
   counter, tenant-local dates, migration safety on staging → `v205a-review-adversarial-integrity.md`. Then
   `/gsd-secure-phase` over T-05-01…T-05-23 → `v205a-secure-phase.md`. Fixes land in a review-fix plan `05a-fix` with
   regression tests; accepted items recorded with a reason and owner.
5. **Documents:** `05a-SUMMARY.md` (what shipped per plan, deviations, the base SHA of the V2-04 branch);
   `05a-VERIFICATION.md` (acceptance rows 1-3, 5-7 with CI link + commit SHA + evidence files; row 1 marked "roles done,
   status/access levels in 05b").
6. **PO:** gate approval + 05-P1. **Merge** only after V2-04 has merged (merge commit), then retarget and merge 05a
   (merge commit). **After merge:** 05-P2 (staging migration approval).

---

# Part 05b — Membership, invites & entitlements

## 05-b0 Contract of 05a's expand steps (expand → migrate → contract) · S · 05b Wave 1

### Precondition
05a is merged into `feature/v2`, and either 05-P2 is verified (staging runs the switched app) or staging is not live yet
(V2-03 E-items open: the first staging bring-up applies every migration before the app deploys). The plan may be
authored earlier on the stacked branch; this precondition gates the **merge** of 05b.

### Files
Migration `contract_05a`; `types/database.ts`; `supabase/tests/database/contract_05a.test.sql`.

### Steps
1. Drop `visits_clinical_content_moved` and the six moved columns from `visits`
   (`vitals, chief_complaints, clinical_notes, specialty_data, investigations_advised, advice`).
2. `revoke execute` then `drop function public.generate_daily_queue_token(uuid, date)`.
3. `npm run db:types`; `npm run typecheck` must pass with no reference to the dropped columns or function.

### Tests that fail without the change
`contract_05a.test.sql`: `hasnt_column('public','visits', …)` for each of the six; `hasnt_function` for
`generate_daily_queue_token`. `tsc` fails if any code still reads the columns.

### Acceptance mapping
Completes acceptance 2's schema change (contract step) and P1-40's replacement of `generate_daily_queue_token`.

---

## 05-09a SUB-01 schema, access + entitlement functions, catalogue + AI-18 seeds (SUB-01, AI-18, PO-20/C44, PO-21/C41, PO-25) · M · 05b Wave 2

### Files
- Migrations `billing_schemas`, `subscription_catalogue`, `tenant_subscriptions`, `billing_access_functions`,
  `subscription_seeds`; `types/database.ts`.
- `tests/authz/table-matrix.ts` (new tables; fixture subscription rows `trialing` for tenants A and B), regenerated
  matrix.
- `supabase/tests/database/{billing_access,billing_entitlements,billing_catalogue,billing_grants,
  subscription_invariant}.test.sql`.

### Steps
1. **`billing_schemas`:** schemas `billing_internal` and `platform`; `revoke all on schema … from public`; `grant usage on
   schema billing_internal to service_role`; `grant usage on schema platform to authenticated, service_role`;
   `alter default privileges in schema billing_internal, platform revoke execute on functions from public`. Neither
   schema is added to `[api] schemas`. Both join `SNAPSHOT_SCHEMAS` (`scripts/drift/schema-snapshot.mjs`) in the same
   commit, so their grants are in the committed snapshot and the nightly hosted drift check.
2. **`subscription_catalogue`** (SUB §7.1 columns): `plans` (`code` unique, `kind`, `category`, `name`, `description`,
   `purchasable`, `visibility` check `public|coming_soon|hidden`, `trial_days`, `trial_plan_id`,
   `first_charge_grace_days`, `renewal_grace_days`, `status`); `plan_prices` (`billing_model` check of the five models,
   `base_amount_paise bigint`, `tax_rate_bp int`, `tax_inclusive boolean not null default false`,
   `charge_amount_paise bigint generated always as (base_amount_paise + round(base_amount_paise * tax_rate_bp /
   10000.0)::bigint) stored`, `currency`, `interval`, `interval_count`, `unit`, `included_units`, `unit_amount_paise`,
   `overage_unit_amount_paise`, `tiers jsonb`, `provider`, `provider_plan_id`, `active_from`, `active_until`);
   `entitlement_keys` (`key` PK, `kind` boolean|limit, `description`, `owner_doc`); `plan_entitlements` (`plan_id`, `key`,
   `enabled`, `limit_value`); `tenant_entitlement_overrides` (`tenant_id`, `key`, `enabled`, `limit_value`, `expires_at`,
   `reason`, `granted_by`). RLS on all; catalogue SELECT for `authenticated` where the plan's `visibility <> 'hidden'`;
   overrides: no tenant access. No DML grants for `anon`/`authenticated` (AI §4.6 write protection).
3. **`tenant_subscriptions`:** `tenant_subscriptions` (PK `tenant_id`, all SUB §7.1 columns incl. `comp_until`,
   `access_ends_at`, mandate columns, `trial_consumed`, `version`; status check of the seven states; index on
   `tenant_id` is the PK), `subscription_events` (append-only **by grants**: no UPDATE/DELETE for any tenant role; no
   delete trigger, research Pitfall 5), `platform_settings` (single row enforced by `id boolean primary key default true
   check (id)`; `lock_window_days 30`, `purge_after_days 180`, `pending_charge_buffer_hours 24`,
   `gst_retention_months 72`, `log_retention_days 365`, `supplier_gstin`, `supplier_state`, `sac`, `ai_features jsonb`).
   SELECT on `tenant_subscriptions`/`subscription_events` through `authz.billing_tenant_ids()`. AFTER INSERT trigger
   on `tenants` `tenants_create_subscription` (SECURITY DEFINER): inserts `(tenant_id, status 'incomplete')` `on conflict
   do nothing` — the single mechanism that makes every tenant, including `create_clinic_with_owner` ones, start
   `incomplete` (R-24). Backfill `incomplete` for existing tenants (local/staging only; production is new).
4. **`billing_access_functions`:** `billing_internal.tenant_access_level(p_tenant, p_now)` exactly as SUB §6.2;
   `billing_internal.has_entitlement(p_tenant, p_key, p_now) returns boolean` and `billing_internal.entitlement_limit(
   p_tenant, p_key, p_now) returns bigint` in the SUB §7.2 order (access `full`; unexpired override wins; `trialing` →
   the base plan's `trial_plan_id` entitlements; else the base plan's; the limit is the largest applicable);
   `billing_internal.start_trial(p_tenant, p_plan_price_id, p_now)` (`incomplete` → `trialing`, trial dates,
   `access_ends_at = trial_end + buffer`, event row, `version + 1`). All `revoke execute … from public, anon,
   authenticated; grant … to service_role`. Caller-bound wrappers (SUB §6.2): `public.my_tenant_access(p_tenant)`
   (level only for an active membership, else `null`) and `public.my_entitlements(p_tenant)` (`key, enabled,
   limit_value` of the caller's own active-membership tenant), granted to `authenticated` only.
   `public.tenant_access_for_system(p_tenant) returns text` (no `p_now`; `service_role` only) for service-role readers
   (`lib/api/auth.ts`, sharing) in 05-10a (R-28). `public.is_platform_admin()` is created in 05-09b.
5. **`subscription_seeds`** (idempotent, SUB §8.1): `standard` (base, core, purchasable, public, trial 14, grace 4/7,
   `trial_plan_id → standard_trial`) with one `flat_recurring` price 149900 / 1800 bp / `tax_inclusive false` / INR /
   month ×1 / `provider 'razorpay'` / `provider_plan_id null` (set later through `platform.create_plan_price`, V2-13b);
   `standard_trial` (trial, hidden, not purchasable); `ai_assist` and `ai_voice_receptionist` (addon, ai, not
   purchasable, `coming_soon`, no price); the `entitlement_keys` of research §D / AI §6.2; plan entitlements:
   `standard` all `assist.*` true, `core.*` true, `ai.scribe` false, `ai.scribe.monthly_drafts` 0 (PO-25 default),
   `messaging.monthly_quota` limit; `standard_trial` = standard + `ai.scribe` true + `ai.scribe.monthly_drafts` 1500
   (PO-21); `ai.operations_copilot`, `ai.clinical_copilot`, `ai.patient_advice`, `ai.scribe.voice` false everywhere;
   `platform_settings` row with every `ai_features` flag present.
6. Until 05-10a the RLS helpers ignore access level, so existing suites are unaffected by `incomplete` rows.

### Tests that fail without the change
- `billing_access.test.sql` (time travel through `p_now`, as `postgres`; SUB §11 table): `incomplete` → `onboarding`;
  `trialing` before `trial_end`, inside the buffer, after `access_ends_at`; trial cancelled → `locked` exactly at
  `trial_end` (no buffer); `active` cancelling → `locked` at `current_period_end`; `past_due` → `locked` at
  `least(grace_until, halted_at)`; grace and buffer 0; comp on `incomplete` and on `expired` → `full`; comp on `purged`
  → `none`; `archived` → `locked`; no row → `null` (never `full`). **Acceptance 8, function half.**
- `billing_entitlements.test.sql`: `trialing` → `ai.scribe` true with `entitlement_limit` 1500; `active` Standard →
  false and 0; an override grants with its own limit and stops at `expires_at`; a `locked` tenant → false for every key.
  **Acceptance 13 (entitlement half).**
- `billing_catalogue.test.sql`: `charge_amount_paise` = 176882 for 149900 @ 1800 bp (**acceptance 12**); `select code
  from plans where purchasable` = `{standard}`; `ai_assist`/`ai_voice_receptionist` are `coming_soon` with no active
  price carrying a `provider_plan_id`.
- `billing_grants.test.sql` (catalogue loops): for **every** function in `billing_internal`
  `has_function_privilege('authenticated'|'anon', oid, 'EXECUTE')` is false (**acceptance 9**); `authenticated` has no
  USAGE on `billing_internal`; no DML grant for `anon`/`authenticated` on any gating table; `my_tenant_access(B)` called by
  a member of A → `null`.
- `subscription_invariant.test.sql`: a service-role `tenants` insert and `create_clinic_with_owner` each yield exactly
  one `incomplete` row (roadmap note).

### Acceptance mapping
Acceptance 8 (function/time-travel half), 9, 12, 13 (entitlements + "no product purchasable except Standard"); SUB-01
schema, access functions, wrappers, seeds; AI-18 catalogue rows and the 1,500 trial limit; roadmap test "time-travel
pgTAP for trial, grace, expiry and archive".

---

## 05-09b `platform.*` RPCs, actor rule, SQL runbook (SUB-01 transition RPCs, AI-18 availability switch, SUB §8.1) · S-M · 05b Wave 3

### Files
Migration `platform_admin_rpcs`; `types/database.ts`; `docs/runbooks/subscriptions-sql.md`;
`supabase/tests/database/platform_rpcs.test.sql`; `tests/setup/teardown.ts` + `tests/setup/teardown.spec.ts`
(`platform_admins` has no `tenant_id`: deleted explicitly before users); `tests/authz/table-matrix.ts`.

### Steps
1. `public.platform_admins(user_id PK → auth.users, granted_at, granted_by, revoked_at)`, `public.platform_audit_log(id,
   actor_id, channel 'sql'|'ui', action, target_tenant_id, payload jsonb (no PII), occurred_at)`; RLS on, no policies,
   no tenant grants (append-only by grants). `public.is_platform_admin()` (definer): active `platform_admins` row for
   `auth.uid()` **and** `auth.jwt()->>'aal' = 'aal2'`.
2. `platform.extend_trial(p_tenant, p_by interval, p_reason, p_actor uuid default null)`, `platform.set_comp(p_tenant,
   p_until timestamptz, p_reason, p_actor)`, `platform.grant_override(p_tenant, p_key, p_enabled, p_limit, p_expires_at,
   p_reason, p_actor)`, `platform.create_plan_price(p_plan_code, p_billing_model, p_base_amount_paise, p_tax_rate_bp,
   p_tax_inclusive, p_provider_plan_id, p_active_from, p_actor)`, `platform.set_product_availability(p_plan_code,
   p_purchasable boolean, p_visibility text, p_actor)`. Every function starts with the SUB §8.1 actor block verbatim
   (`postgres`/`service_role` → `p_actor` must be an active platform admin; any JWT caller → `p_actor` ignored,
   `is_platform_admin()` required, actor = `auth.uid()`), writes `platform_audit_log` (with the channel) and, when
   tenant-scoped, `subscription_events`; maintains `access_ends_at` and `version`. `set_product_availability` refuses
   `purchasable = true` unless the plan has an active `plan_prices` row with a non-null `provider_plan_id`. `revoke
   execute … from public, anon; grant … to authenticated, service_role` (SUB §8.1).
3. Runbook `docs/runbooks/subscriptions-sql.md`: vetted snippets that call these RPCs only (never raw UPDATEs), as SUB
   §8.1, plus how a comp is set for a pilot clinic and how to read `tenant_access_level` safely as `service_role`.

### Tests that fail without the change
`platform_rpcs.test.sql`: `set_product_availability('ai_assist', true, 'public', <admin>)` as `postgres` → raises
(**acceptance 13**); after `create_plan_price` with a provider id → ok; a non-admin `authenticated` caller → `forbidden`;
an admin at `aal1` → `forbidden`; an `aal2` admin passing someone else's `p_actor` → the audit row records the caller;
`postgres` with null or revoked `p_actor` → raises; `extend_trial` moves `trial_end` and `access_ends_at` and writes one
event; `set_comp` makes `tenant_access_level` `full` for an `expired` tenant.

### Acceptance mapping
Acceptance 13 ("`platform.set_product_availability` refuses …"); SUB-01 "transition RPCs; `platform.*` actor rule;
SQL runbook"; AI-18 "the `platform.set_product_availability` RPC".

---

## 05-09c Every tenant gets a subscription row before enforcement; v1 subscription tables dropped (SUB-01 seeds/`comp_until`, SUB §11 test seeds, acceptance 11 preparation) · S-M · 05b Wave 4

### Files
- `tests/helpers/tenants.ts` (`seedTenantSubscription(tenantId, { status?: 'trialing' | 'active' | 'expired' |
  'incomplete', comp?: boolean, accessEndsAt?: Date })`; `seedTenantWithOwner` calls it with `trialing` by default:
  Standard price, `trial_start = now`, `trial_end = now + 14 d`, `access_ends_at = trial_end + 24 h`);
  `tests/helpers/subscription.spec.ts` (new).
- `scripts/seed/demo-clinic.ts` (V2-03 03-08 seed core: subscription `active`, Standard price, `comp_until = now + 1
  year`, research Pitfall 8) and `scripts/seed-local-dev.ts`/`scripts/seed-staging.ts` (print one line `access summary:
  full=<n> locked=<n> onboarding=<n>` — counts only).
- Migration `drop_v1_subscription_tables` (`drop table public.payment_records, public.subscriptions`);
  `features/billing/subscription.ts` and `app/(dashboard)/settings/billing/page.tsx` (owner/admin, `clinic:manage`:
  read `tenant_subscriptions` + `my_tenant_access`; shows status, trial end, access end and "Plan management arrives with
  billing (V2-13b)"); `lib/db/types.ts` (v1 types removed).
- Tests rewritten off v1 tables: `tests/integration/subscription.spec.ts`, `tests/security/cross-tenant.spec.ts`
  (`:61-80`), `tests/security/p0-01-action-sweep.spec.ts` (`:73`), `tests/security/guard/engine.ts`,
  `tests/helpers/rls.ts` (`TENANT_OWNED_TABLES`).

### Steps
1. Helper + seeds. Re-grep every tenant-creation site (research §E) and route test tenants through
   `seedTenantWithOwner` or an explicit `seedTenantSubscription`; tests that call `create_clinic_with_owner` on purpose
   (e.g. `tests/integration/multi-tenancy.spec.ts`) read only `tenants`/`memberships`, which use the member helper.
2. Drop the v1 tables and switch their two readers; rewrite the tests (owner/admin read their own row; doctor 0 rows;
   cross-tenant 0 rows).
3. **Flip dry run (de-risks acceptance 11):** apply an **uncommitted, local-only** migration that makes
   `authz.full_tenant_ids()` require access level `full` (the 05-10a body), run `npm run test:db`, `npm run test:pgtap`
   and `npm run e2e:pr`, save the reports as `evidence/05b/05-09c-flip-dry-run/`, fix every failure in the seeding
   (never by weakening the check), then remove the experiment and `db reset`.

### Tests that fail without the change
`subscription.spec.ts` (helper): a `seedTenantWithOwner` tenant reports `my_tenant_access` = `full` and has the Standard
trial entitlements; the `comp` variant is `full` with `status 'incomplete'`; the rewritten subscription and cross-tenant
specs fail against the dropped v1 tables until switched. The dry-run evidence shows the whole suite green under the
access-aware helper.

### Acceptance mapping
Acceptance 11 preparation ("with all test tenants seeded `trialing` or comped"); SUB-01 "drop v1
`subscriptions`/`payment_records`; `comp_until` for dev and staging tenants".

---

## 05-05 AUTH-05: membership status, removal, session and key revocation (AUTH-05, SEC-07, AUTH §3.6, TC-STAFF-01..04) · M · 05b Wave 5

### Files
- Migration `membership_status` + chores; `types/database.ts`.
- `lib/auth/tenant.ts` (`getActiveMembership` filters `status = 'active'`), `features/staff/{actions,service,schema}.ts`
  (`removeStaff(membershipId, reason)`), `tests/security/guard-manifest.ts` + `guard/{engine,valid-inputs}.ts`. No
  system module: a server action may not import `features/*/system.ts` (ADR-0005 D2, enforced since V2-03 03-04), so
  session revocation happens inside the RPC (R-43).
- `scripts/gen-authz-pgtap.ts` + `tests/authz/table-matrix.ts` (principals `removed`, `suspended`), regenerated matrix;
  `supabase/tests/database/remove_member.test.sql`; `tests/integration/auth/remove-member.spec.ts`;
  `tests/setup/teardown.ts` (`NO_ACTION_USER_REFS` + `memberships.removed_by`, `invitations.revoked_by`) and its spec.

### Steps
1. **Migration:** `memberships.status text not null default 'active' check (status in ('active','suspended','removed'))`,
   `removed_at`, `removed_by` (not in the self-update column grants); `invitations.revoked_at`, `revoked_by` (expand,
   used by 05-07). Helper bodies (`active_tenant_id`, `member_tenant_ids`, `full_tenant_ids`, `billing_tenant_ids`)
   add `m.status = 'active'` — **no policy changes**. `change_member_role`, `current_user_has_role`,
   `current_user_is_admin_or_owner` ignore non-active rows.
   `public.remove_member(p_membership_id uuid, p_reason text) returns jsonb` SECURITY DEFINER: caller holds
   `staff:invite` in the target's tenant; owner/admin targets need an owner caller; self-removal refused; last-owner
   guard (same rule as `change_member_role`); sets `removed`/`removed_at`/`removed_by`; `api_keys.revoked_at = now()`
   where `created_by` = target in that tenant; pending invitations `created_by` = target → `revoked_at`; **sessions
   (R-43):** `delete from auth.sessions where user_id = <target>` in an inner `BEGIN … EXCEPTION WHEN
   insufficient_privilege THEN … END` block, so a hosted refusal never undoes the removal (`sessions_revoked` = the row
   count, or `null` when refused; refresh tokens cascade; AUTH-00 kit item 4 records whether hosted `postgres` may
   delete); audit `staff.removed` through `log_audit` with counts only (`keys_revoked`, `invites_revoked`,
   `sessions_revoked`); returns `{user_id, keys_revoked, invites_revoked, sessions_revoked}`. The caller's tenant
   must be the active tenant (the helpers are bound, R-42). The auth user is never banned (multi-clinic); removing a
   member signs them out of every clinic until they sign in again (recorded as intended).
   `public.session_is_live() returns boolean` SECURITY DEFINER (`authenticated`): the caller's JWT `session_id` still
   exists in `auth.sessions` (AUTH §3.5; an invoker read of `auth.sessions` is denied).
2. `removeStaff`: `requirePermission("staff:invite")` → `remove_member` on the user client (`p_membership_id`; the
   tenant comes from the row and must be the active tenant) → `mapDbError` with fixed messages. Backend only; UI and
   J-A6 in V2-11 (R-31).
3. Matrix: `removed` and `suspended` principals (still holding a valid JWT) are denied every cell.

### Tests that fail without the change
- Generated matrix: every table, every operation → 0 rows / denied for `removed` and `suspended` (**acceptance 4,
  pgTAP**).
- `remove_member.test.sql`: admin removing an owner → `42501`; the last owner → refused; self → refused; keys,
  pending invites and the target's `auth.sessions` rows removed with the counts in the audit row; with DELETE on
  `auth.sessions` revoked from the function owner inside the test (rolled back) → the membership is still `removed` and
  `sessions_revoked` is `null`; a dual member whose active tenant is A removing a B member → `42501`/not found.
- `remove-member.spec.ts` (real sessions, the acceptance path): the removed user's **existing** supabase-js client (JWT
  still valid) reads `[]` from every table in the matrix list; their `refreshSession()` fails right after the removal
  (before: refresh succeeds); their API key → 401 through `lib/api/auth.ts` (already filters `revoked_at`); a re-login
  lands on "no clinic".

### Acceptance mapping
Acceptance 4 "a removed member reads 0 rows with a still-valid JWT": full. AUTH-05 backend (status, removal, session
and API-key revocation, audit with counts).

---

## 05-07a AUTH-06 invitations v2, database (AUTH-06 backend, AUTH-D1, SEC-08, AUTH §3.2) · M · 05b Wave 6

### Precondition
The base contains V2-04 04-01/04-03 (`ops.jobs` with `dedupe_key` NOT NULL UNIQUE, `public.claim_jobs`,
`ops.enqueue_job(p_kind, p_tenant_id, p_payload, p_dedupe_key, p_run_at, p_max_attempts)` returning the existing id on a
duplicate key). Use the merged names.

### Files
Migration `invitations_v2` (+ chores); `types/database.ts`; `supabase/tests/database/invitations_v2.test.sql`;
`tests/authz/table-matrix.ts` (`invitations` INSERT → none), regenerated matrix; `tests/api/readiness-probe-db.spec.ts`
(the anon-executable definer allowlist gains `peek_invitation`, 05-07a); `lib/db/errors.ts` `RPC_REASON_CODES` for the
invitation reasons.

### Steps
1. `invitations`: `token_version int not null default 1`, `last_sent_at`, `send_count int not null default 0`;
   `token_hash` becomes nullable (minted at send time, R-30); unique partial index on `(tenant_id,
   lower(invited_address))` where `consumed_at is null and revoked_at is null`. Drop the INSERT policy; `revoke insert on
   public.invitations from authenticated, anon`.
2. `public.invite_staff(p_tenant uuid, p_email text, p_role text) returns jsonb` SECURITY DEFINER: `p_tenant` comes
   from the server session (`ctx.tenantId`) and is accepted only if it is in `authz.tenant_ids_with('staff:invite')` for
   the caller (else `42501`; V2-04 R-6 pattern); owner/admin roles only by an owner; an unexpired pending invite for the same address → returns it with
   `deduped: true` and enqueues nothing; an expired pending one is revoked first; `expires_at = now() + interval '72
   hours'`; inserts the job **in the same transaction**: kind `email.invite`, payload `{invitation_id, token_version}`,
   `dedupe_key = 'invite:' || id || ':v' || token_version`, `on conflict (dedupe_key) do nothing`. Returns `{id,
   expires_at, deduped}` — never a token.
   `public.resend_invitation(p_invitation_id)`: same permission rules; pending only; `token_version + 1`, `token_hash =
   null` (old link dead now), new expiry, new job. `public.revoke_invitation(p_invitation_id)`: sets `revoked_*`,
   `token_hash = null`.
   `public.invitation_issue_token(p_invitation_id uuid, p_token_version int) returns text` SECURITY DEFINER,
   **service_role only** (the email handler): if the invite is pending and `token_version` matches, mint 32 random bytes
   (`extensions.gen_random_bytes`), store `sha256` hex, bump `send_count`/`last_sent_at`, return the raw token once;
   otherwise return `null` (stale job → no send).
   `public.peek_invitation(p_token_hash text)` (`anon`, `authenticated`): `{clinic_name, role, masked_email, status}`
   with status `pending|expired|revoked|used|not_found`; nothing else.
   `public.consume_invitation(p_token_hash text)` (`create or replace`, same signature): requires a confirmed caller
   (`auth.users.email_confirmed_at` not null) whose `lower(email)` equals `lower(invited_address)`; `for update`; not
   revoked, not expired, not consumed; inserts the membership, or **reactivates** a `removed` one (R-32); audit
   `staff.invite_accepted`.
   `public.consume_invitation_for(p_user_id uuid, p_token_hash text)` service_role only: same checks with the user's
   auth email; idempotent for the same user and invite (AUTH §3.2 risk note).
   Job enqueue calls `ops.enqueue_job('email.invite', p_tenant, jsonb_build_object('invitation_id', id,
   'token_version', v), 'invite:' || id || ':v' || v, now(), 5)` inside the definer RPC (the kind matches `ops.jobs`'
   `^[a-z]+(\.[a-z_]+)+$` check). `invite_staff`, `resend_invitation`, `revoke_invitation` join 05-02c's
   `definer_functions.test.sql` list (dual member with the active tenant A cannot invite into B).

### Tests that fail without the change
`invitations_v2.test.sql` (roadmap "invite pgTAP cases"): mismatched email → refused; expired → refused; revoked →
refused; reused → refused; unconfirmed invitee through `consume_invitation_for` → ok, and `authenticated` cannot execute
`consume_invitation_for` or `invitation_issue_token`; an admin inviting an admin → refused; a duplicate pending invite →
same id, exactly one job row; `resend_invitation` → `token_version` 2, a second job with a new dedupe key, and
`invitation_issue_token(id, 1)` → `null`; a failing statement after the insert rolls back both the invite and its job;
`peek_invitation` with an unknown hash → `not_found` and never reveals the address; re-inviting a removed member
reactivates the same membership row; direct INSERT into `invitations` as `authenticated` → `42501`.

### Acceptance mapping
AUTH-06 backend (email-bound, 72 h, revoke/resend, single use, unconfirmed-invitee path); prerequisite for acceptance
10.

---

## 05-07b AUTH-06 app paths + exactly-one-email delivery (acceptance 10) · M · 05b Wave 7

### Files
- `features/staff/{actions,service}.ts` (`inviteStaff` → `invite_staff` with `p_tenant = ctx.tenantId`; `resendInvite`,
  `revokeInvite`).
- `features/auth/system.ts` (exists from V2-04 04-03c; `import "server-only"`): `createInvitedUser` /
  `completeUnconfirmedInvitee` via `admin.createUser` / `admin.updateUserById` with `email_confirm: true`, only for the
  address `peek`/`consume_invitation_for` validated, plus `consumeInvitationFor`; new `SystemDbReason`
  `auth.invite_accept` → `REASON_OWNER` module `features/auth/system` (`tests/security/system-db.spec.ts` covers it).
- `features/auth/invite-flows.ts` (`import "server-only"`; `acceptInviteWithPassword(token, password, turnstileToken)`:
  server-side Turnstile verify (below), password policy + FT-05 `isPwnedPassword` (`lib/auth/pwned.ts`), then the
  system path + `consume_invitation_for`; `acceptInvite(token)` for a signed-in confirmed user → `consume_invitation`).
  **ADR-0005 amendment A4 (R-44):** `features/auth/invite-flows.ts` is the one non-system module allowed to import
  `features/auth/system.ts` (today a lint error: `lint-fixtures/p1-34/other-feature-system-import.ts`); one zone in
  `BOUNDARY_IMPORT_ZONES` with an owner comment + a pass case (that file) and a fail case (`features/staff/actions.ts`
  importing it) in `tests/security/p1-34-lint-gates.spec.ts`; the proposal text in
  `.planning/phases/05-db-authorisation-entitlements/05-ADR0005-A4-PROPOSAL.md`, applied to the ADR after 05-P1.
- **Server-side Turnstile (R-46):** V2-03 shipped CAPTCHA only inside GoTrue (03-12c; the app holds no Turnstile
  secret), but invite acceptance creates the account through the admin API, which skips GoTrue's CAPTCHA, and AUTH §3.2
  requires "verify Turnstile server-side". New `lib/auth/turnstile.ts` (`verifyTurnstile(token, { remoteIp? })`: POST to
  the fixed `https://challenges.cloudflare.com/turnstile/v0/siteverify`, 3 s timeout, `success` + hostname check,
  error codes only in logs) and a new env name `TURNSTILE_SECRET_KEY` through the full R-15 checklist: required in
  production, optional in staging (unset → invite acceptance refuses with the catalogue copy, never skips the check),
  Cloudflare's documented always-pass/always-fail **test** secrets allowed only in development/test/e2e/ci (built at
  run time in specs, gitleaks rule), `TURNSTILE_VERIFY_URL` override allowed only as a loopback URL in test/e2e (the
  `PWNED_API_BASE_URL` pattern; the e2e lane serves a fake siteverify from Playwright global setup next to the fake
  range API). PO action **05-P7** sets the staging value.
- `app/(auth)/join/page.tsx`: renders from `peek_invitation` (GET has no side effect, scanner-safe); a minimal,
  functional set-password form for invitees without an account; "Sign in to accept" for existing accounts (styled UI and
  J-A2 in V2-11, R-31).
- `lib/jobs/internal/handlers/email-invite.ts` + `lib/jobs/internal/registry.ts` (V2-04): calls
  `invitation_issue_token`; `null` → complete as no-op; else `getEmailSender().send({ to, subject, html, text, tag:
  "staff-invite" }, { signal })` (Mailpit locally) with a link-only message (clinic name, role, link
  `<publicEnv.NEXT_PUBLIC_APP_URL>/join?token=…`, expiry; no PHI); `EmailSendError` is retryable with `safeCode`;
  `EmailDisabledError` → `dead` (`email_disabled`). `lib/email/types.ts`: `EmailTag` (closed union) gains
  `"staff-invite"` (Mailpit records it, so the delivery spec counts only invite messages).
- `lib/email/templates/invite.ts`, `messages/en.ts`; `tests/security/guard-manifest.ts` + guard files (new actions;
  `acceptInviteWithPassword` registered as a public, token-gated action). `/join` is already a public prefix
  (`lib/auth/public-paths.ts`, 03-12b) — no change there.
- `tests/integration/auth/invite-delivery.spec.ts`, `tests/integration/auth/accept-invite.spec.ts`,
  `tests/jobs/email-invite-handler.spec.ts`, `tests/auth/turnstile-verify.spec.ts`, `tests/e2e/auth/join-invite.spec.ts`
  (axe only); env-checklist files for `TURNSTILE_SECRET_KEY`/`TURNSTILE_VERIFY_URL`.

### Tests that fail without the change
- `invite-delivery.spec.ts` (DB lane + Mailpit HTTP API on loopback; **acceptance 10**): (i) `inviteStaff` called twice
  for one address → one job; (ii) 5 parallel runner passes (V2-04's runner entry point, as its parallel-dispatcher test
  does) → Mailpit holds **exactly one** message for the address; (iii) a transport failure injected on the first attempt
  → the job retries and the total is still one; (iv) `resendInvite` → exactly one more message, the first link's `peek` is
  no longer `pending`, the second link consumes. Counts are of messages tagged `staff-invite` to a fresh synthetic
  address per case (GoTrue's own "password changed" notice and other auth mail are not counted, 03-11a). Residual
  window (send accepted, crash before `done`) is documented, not hidden (research Pitfall 16).
- `accept-invite.spec.ts`: new invitee sets a password → account created, membership exists, sign-in works; an
  unconfirmed existing user → password overwritten, membership exists; a confirmed account → `acceptInvite` after
  sign-in; a different signed-in email → refused; a Pwned-corpus password (fake range API) → refused before any account
  change; a Turnstile token the fake siteverify rejects → refused before any account change, and with
  `TURNSTILE_SECRET_KEY` unset in a staging profile → refused, never skipped (before: no server-side check existed).
  Passwords are built at run time (gitleaks rule).
- `turnstile-verify.spec.ts`: success, a failed token, a hostname mismatch, a timeout (fake server delays past 3 s) →
  fail closed; the secret never appears in a log line or error; `env-schema.spec.ts`: production without
  `TURNSTILE_SECRET_KEY`, a test secret in staging/production, and a non-loopback `TURNSTILE_VERIFY_URL` in test → refused
  naming the key.
- `p1-34-lint-gates.spec.ts` (A4): `features/auth/invite-flows.ts` importing `@/features/auth/system` → pass;
  `features/staff/actions.ts` doing the same → fail.
- `email-invite-handler.spec.ts`: a stale `token_version` → no send, job completed; the message body contains no patient
  data and no storage URL.
- `join-invite.spec.ts`: `/join?token=…` at 360/820/1280, axe 0 serious/critical.

### Acceptance mapping
Acceptance 10 "one invite sends exactly one email under retry": full (local Mailpit; optional staging check 05-P5).
AUTH-06 backend complete.

---

## 05-10a SUB-02 enforcement core: helpers, definer RPCs, storage, guards, `/api/v1`, jobs (SUB-02, SUB §6.2/§7.2, acceptance 8 and 11) · M-L · 05b Wave 8

### Precondition
05-09c's flip dry run is green (evidence present).

### Files
- Migration `access_enforcement` (+ chores); `types/database.ts`.
- `lib/permissions/guards.ts` (`requirePermission` → `assertTenantAccess('full')` after resolving the membership;
  typed `TenantLockedError`), `lib/auth/tenant.ts` (membership + access level via `my_tenant_access`),
  `lib/errors/app-error.ts` (`APP_ERROR_CODES` gains `SUBSCRIPTION_LOCKED`, with its `DEFAULT_APP_ERROR_MESSAGES` entry),
  `lib/db/errors.ts` (`RPC_REASON_CODES`: `SUBSCRIPTION_LOCKED` → `SUBSCRIPTION_LOCKED`), new `lib/entitlements/require-entitlement.ts`
  (`requireEntitlement(key)` via `my_entitlements`), `lib/storage/**` (TTL cap), `features/labs/service.ts` (`:260`),
  `features/referrals/service.ts` (`:519`), `features/referrals/pdf/generator.ts` (`:90`),
  `features/sharing/system.ts` (`:41`; SUB-D6), the public share and reschedule pages (neutral "This clinic's online
  services are unavailable"), `lib/api/auth.ts` (402; it authenticates the key first and only then takes the system
  client, `authenticateApiKey(req, () => getSystemDb("api_v1"))`, 03-13c — the access check runs on that `db` after
  authentication).
- `scripts/gen-authz-pgtap.ts` + `tests/authz/table-matrix.ts` (access levels `locked`, `onboarding`), regenerated
  matrix; `supabase/tests/database/access_lock_rls.test.sql`; `tests/subscriptions/lock-enforcement.spec.ts`;
  `scripts/db/explain-rls.mjs` (loopback only) → `evidence/05b/explain-rls.txt`.

### Steps
1. **Helper bodies:** `authz.full_tenant_ids()` (and so `tenant_ids_with`) add
   `billing_internal.tenant_access_level(m.tenant_id, now()) = 'full'`; `authz.billing_tenant_ids()` → owner/admin with
   level in (`full`,`locked`,`onboarding`); `member_tenant_ids()` unchanged (Pitfall 7). Helpers are definer functions
   owned by the migration role, so they may call `billing_internal`. No policy changes.
2. **Definer functions that bypass RLS** get an explicit access check (research Pitfall 9): `resolve_share_token`
   (returns the access level; a prescription of an `expired` tenant resolves to metadata only, nothing at `archived`
   or later — SUB-D6), `get_reschedule_context`, `consume_reschedule_token`, `create_share_token`, `search_medicines`,
   `generate_tenant_invoice_number`, V2-03's `referral_source_clinics` function, and any other SECURITY DEFINER function
   in `public`/`private` that reads tenant rows (the 05-02c `definer_functions.test.sql` list gains an access-level leg
   per function). Functions that go through the bound `authz` helpers since 05-02c inherit the stop;
   `current_user_tenant_ids()` is the member helper and therefore is **not** a stop (no policy uses it after 05-02c).
3. **Jobs skip locked tenants (R-27):** `create or replace public.claim_jobs(p_kinds text[], p_batch int,
   p_lease_seconds int, p_worker text, p_per_tenant int)` (V2-04 04-01; use the merged name and signature) so that
   due jobs whose tenant's level is not `full` are set `cancelled` with `last_error = 'tenant_not_full'` and are not
   returned, except kinds in a closed exempt set (empty in V2-05; V2-13b adds owner billing notices). Patient reminders
   therefore never fire late after a renewal.
4. **App:** `assertTenantAccess('full')` in `requirePermission`; server actions return `SUBSCRIPTION_LOCKED`;
   `requireEntitlement(key)` for gated features (no AI caller yet; V2-12 uses it); signed URLs capped at 300 s for every
   in-app and share view and 900 s for exports, enforced by clamping in `lib/storage` (R-29); `lib/api/auth.ts` returns
   402 `SUBSCRIPTION_LOCKED` for a key whose tenant is not `full`, using `tenant_access_for_system` (R-28); sharing uses
   the same function before signing.
5. **Performance evidence (SUB §7.2):** `scripts/db/explain-rls.mjs` runs `explain (analyze, buffers)` for the patient
   list and the visit list as a simulated doctor on the seeded demo clinic and asserts the helpers appear as an
   `InitPlan` (evaluated once per statement).
6. Full lanes: `npm run test:db`, `npm run test:pgtap`, `npm run e2e:build && npm run e2e:pr` — all green with the
   seeded tenants (**acceptance 11**).

### Tests that fail without the change
- `access_lock_rls.test.sql` (acceptance 8, RLS half): fixture tenant A `trialing` with `access_ends_at` set **before
  the transaction started** (`now()` is frozen per transaction, research Pitfall 10) — this is exactly "`p_now` past
  `access_ends_at`" for the RLS path: every clinical/operational table → 0 rows for every role; every storage class →
  0 objects, uploads denied; owner/admin still read `tenant_subscriptions`, `subscription_events`, `tenants`,
  `memberships`; staff read only `tenants`/`memberships`; `onboarding` (status `incomplete`) behaves like `locked` for
  clinical tables. The generated matrix carries the same cells for every principal × `locked`/`onboarding`.
- Definer-function list test: each listed function refuses a locked tenant (and the list equals the catalogue's
  SECURITY DEFINER functions that read tenant tables).
- Claim test: a due `message.send` job of a locked tenant → `cancelled`, not returned, no send.
- `lock-enforcement.spec.ts`: a server action of a locked tenant → `SUBSCRIPTION_LOCKED`; `requireEntitlement('ai.scribe')`
  → true for `trialing`, false for `active` Standard; `/api/v1` with the test switch → 402; every signed URL TTL ≤ 300 s
  (export 900 s); an `expired` tenant's prescription share link → metadata only, no signed URL; a reschedule link →
  neutral page.

### Acceptance mapping
Acceptance 8 (RLS + storage half; function half in 05-09a), acceptance 11 (the full suites green after the flip with
`trialing`/comped tenants), SUB-02 (RLS + storage policies on the access helper, TTL caps, `assertTenantAccess`,
`requireEntitlement`, `/api/v1` 402, jobs skip locked tenants).

---

## 05-10b Layout redirects + functional locked pages (SUB-02 UX, SUB §7.2 item 3, PWA §9.1 spec 1) · M · 05b Wave 9

### Files
`app/(dashboard)/layout.tsx` (after the membership resolves: `locked` → `/billing/locked` for owner/admin,
`/billing/locked/staff` for others; `onboarding` → `/onboarding/billing`), `app/billing/locked/page.tsx`,
`app/billing/locked/staff/page.tsx`, `app/(onboarding)/onboarding/billing/page.tsx` (interim page stating that billing setup opens with AUTH-07/SUB-03 in V2-13b),
`messages/en.ts`, `tests/helpers/tenants.ts` (locked/onboarding fixtures for e2e), `tests/e2e/subscriptions/locked.spec.ts`.
`lib/auth/public-paths.ts` is **not** edited: V2-03 03-12b made every page default-deny, so the new pages are protected
with no change (a signed-out visit gets the proxy's 307 to `/login?next=…`); `tests/auth/public-paths.spec.ts` must stay
unchanged.

### Steps
1. Pages are outside the `(dashboard)` group (no redirect loop), functional and unstyled beyond existing primitives
   (design system is V2-06): owner/admin page shows the clinic name, status, the date access ended, that data is safe,
   and "Renewal and export open with billing (V2-13b/V2-13c)"; staff page shows "Your clinic's subscription is
   inactive; contact the owner"; both keep the session and offer sign-out (`POST /auth/signout`, V2-03 03-12b). PWA
   assets (`/manifest.webmanifest`, `/sw.js`, `/offline`, icons) do not exist before V2-06 (no `public/` directory or
   `app/manifest.ts` at V2-03 close); the redirect lives in the `(dashboard)` layout only, so they will never be
   redirected, and V2-06 adds their spec cases (handover recorded in 05-SUMMARY).
2. Middleware does not query the database (SUB §7.2 item 5).

### Tests that fail without the change
`locked.spec.ts` (PR lane, three device projects): a locked tenant's owner opening `/` or a deep link lands on
`/billing/locked`; a receptionist lands on `/billing/locked/staff`; an `incomplete` tenant's owner lands on
`/onboarding/billing`; `/api/health`, `POST /auth/signout` and the locked pages themselves answer without a redirect
loop for a locked user; axe 0 serious/critical on the three pages at 360/820/1280.

### Acceptance mapping
SUB-02 "layout redirects, functional `/billing/locked` pages". Client-side `SUBSCRIPTION_LOCKED` hard navigation for
an installed PWA is PWA-05 (V2-06/V2-13b).

---

## 05-10c AI-03 DB + AI-06 L2 gating matrix, database part (AI-03, AI-06 L2, AI §4.6, C48, PO-21, PO-25) · M · 05b Wave 10

### Files
Migration `ai_gating`; `types/database.ts`; `tests/authz/table-matrix.ts` (new tables), regenerated matrix;
`supabase/tests/database/{ai_gating_l2,ai_quota}.test.sql`; `tests/ai/ai-reserve-concurrency.spec.ts`;
`tests/setup/teardown.ts` (`tenant_ai_settings.accepted_by`, `patients.objection_recorded_by`).

### Steps
1. Tables: `tenant_ai_settings(tenant_id PK, enabled boolean not null default false, accepted_terms_version text,
   accepted_by, accepted_at)` (SELECT `clinic:view`; no DML grants); `public.set_ai_opt_in(p_tenant uuid, p_enabled
   boolean, p_terms_version text)` SECURITY DEFINER, **owner only** (role `owner` in a full tenant; stamps `accepted_by =
   auth.uid()`, `accepted_at`; audit) (R-33). `patients.ai_processing_objected boolean not null default false`,
   `objected_at`, `objection_recorded_by` (stamped by a BEFORE UPDATE trigger from `auth.uid()`; follows `patients:edit`,
   AI §4.6 "editable by doctor or receptionist"). `ai_usage_monthly(tenant_id, period text, feature text, units int,
   PK (tenant_id, period, feature))`, `ai_quota_reservations(id, tenant_id, feature, period, expires_at)` — RLS on, no
   tenant access, no DML grants.
2. Functions (SECURITY DEFINER, `search_path=''`, `authenticated` only; tenant and patient derived from the visit,
   V2-04 R-6 pattern):
   `public.ai_preflight(p_feature text, p_visit_id uuid) returns text` in this order: the visit's tenant is not the
   caller's active tenant (R-42) → `forbidden`; access
   level not `full` → `locked`; role lacks `consultations:edit` → `forbidden`; `platform_settings.ai_features ->>
   p_feature` false → `killed`; `has_entitlement` false → `not_entitled`; opt-in off → `not_opted_in`; patient objected →
   `patient_objected`; `units + live reservations ≥ entitlement_limit(<feature>.monthly_drafts)` → `over_quota`; else
   `ok`. `public.ai_reserve(p_feature text, p_visit_id uuid, p_timeout_s int)` (`p_timeout_s` clamped 10…300): runs the
   same checks, then `select … for update` on the usage row (created if missing), counts only `expires_at > now()`
   reservations, inserts a reservation with `expires_at = now() + timeout + 30 s`, returns its id or raises with the
   preflight code. `ai_commit(p_reservation uuid)` deletes it and adds 1 unit; `ai_release(p_reservation uuid)` deletes
   it; both only for the caller's tenant. Period: `'trial:' || trial_start::date` while `trialing` (PO-21: 1,500 over
   the whole trial), else the clinic month `to_char(public.tenant_local_date(<tenant>, now()), 'YYYY-MM')` (05-08's
   helper; `Asia/Kolkata` by default, the same fallback as `lib/datetime`). Env `AI_ENABLED` stays
   app-side (V2-12). Cleanup of expired reservations is not scheduled here (R-33): they stop counting at `expires_at`.

### Tests that fail without the change
- `ai_gating_l2.test.sql` (AI-06 L2, database part): a generated table over subscription state (`trialing`, `active`
  Standard, `active` + override, comp, `locked`, `incomplete`) × opt-in (on/off) × patient objection (on/off) × kill
  switch (on/off) × quota (below/at limit) → the expected `ai_preflight` code for each row; `trialing` → `ok` with limit
  1500; `active` Standard → `not_entitled` (PO-25 default; **acceptance 13**, gating half); a receptionist/nurse →
  `forbidden`.
- `ai_quota.test.sql`: an expired reservation does not count; the trial period key is used while `trialing` and the IST
  month afterwards; commit adds exactly one unit; release adds none; another tenant's reservation cannot be committed.
- `ai-reserve-concurrency.spec.ts` (roadmap concurrency test): with usage at limit − 1, two parallel `ai_reserve` calls
  → exactly one reservation id and one `over_quota`.
- Matrix: no `anon`/`authenticated` DML on `tenant_ai_settings`, `ai_usage_monthly`, `ai_quota_reservations`.

### Acceptance mapping
Acceptance 13 (the `trialing`/`active` gating half); AI-03 DB (opt-in, objection flag, kill switch, quota with expiring
reservations, grants); AI-06 L2 database part; roadmap test "concurrency tests for … `ai_reserve`".

---

## 05b gate and phase close

1. **Report gates:** append the 05b pgTAP files and Vitest specs (subscription helper, remove-member, invite-delivery,
   accept-invite, turnstile-verify, lock-enforcement, ai-reserve-concurrency, rewritten subscription specs) to the two `REQUIRED_FILES`
   lists; update the floors with the arithmetic.
2. **Local evidence:** typecheck, eslint, inventory; `node scripts/phase-evidence.mjs
   .planning/phases/05-db-authorisation-entitlements/evidence/05b 2`; e2e PR lane JSON; `explain-rls.txt`; the 05-09c
   dry-run reports; `AUTHZ-MATRIX.md` at the gate SHA (roles × status × access levels).
3. **CI (orchestrator):** push; mark the 05b PR ready (base = 05a branch while open); all five checks green, 0 retried
   tests, pgTAP gate green; `phase-evidence.mjs … --ci-run <id>`.
4. **Reviews:** independent review of the full 05b diff → `v205b-review-independent.md`; **adversarial** reviews:
   (C) billing and entitlements — access function, wrappers, revokes, platform actor rule, locked enforcement in RLS,
   storage, definer functions, jobs, `/api/v1`, TTL caps, AI gating and quota races → `v205b-review-adversarial-billing.md`;
   (D) membership and invitations — removal, the in-RPC session deletion, invite binding, token minting, `/join`, the
   server-side Turnstile check, the ADR A4 importer and the service-role paths → `v205b-review-adversarial-auth.md`; then `/gsd-secure-phase` over T-05-24…T-05-38 →
   `v205b-secure-phase.md`. Fixes in `05b-fix` with regression tests.
5. **Documents (phase close):** `05b-SUMMARY.md`; `05-SUMMARY.md` (both parts, deviations, deferrals with owners:
   J-A6/J-A2 + styled `/join` → V2-11; `saas_*` tables → V2-13b; reservation cleanup job → V2-12; draft/signed
   predicates and immutable archives → V2-09a/V2-09c; dead `consultations` drop → V2-09b; paid-invoice protection →
   V2-10; patient clinical-field read split if the PO wants it → V2-08); `05-VERIFICATION.md` (the acceptance table below
   with CI run link + commit SHA + evidence file per row; hosted items "pending PO (05-P…)"); the V2-05 gate entry in
   `docs/v2/VERIFICATION_LOG.md`; proposed doc errata (R-38 below) and ADR-0005 amendment A4 (R-44) for PO approval,
   not applied; V2-06 handover: PWA asset non-redirect cases for the locked pages (05-10b).
6. **Proposed CLAUDE.md Commands update (PO approves, 05-P1):** add `npm run test:pgtap` (pgTAP on the local stack),
   `npm run authz:gen` (regenerate the matrix after any policy change), `npm run db:diagnostics` (local only); the
   never-run list gains `scripts/db/diagnostics.mjs` with a non-loopback URL.
7. **PO:** gate approval; merge 05b (merge commit) after 05a merged and 05-b0's precondition holds; then 05-P3, 05-P5.

---

## Acceptance mapping (roadmap V2-05, binding)

| # | Acceptance item | Part | Plan(s) | Local proof (tool output) | Hosted part | Status at the gate |
|---|---|---|---|---|---|---|
| 1 | pgTAP matrix covers 100% of tenant tables and passes | 05a (roles) + 05b (status, access levels) | 05-01a, 05-01b, 05-02a/b/c, 05-04, 05-08, 05-05, 05-10a | `authz_completeness.test.sql` (`set_eq` with the catalogue), generated `authz_matrix.test.sql`, CI pgTAP gate | — | 05a: roles × `full`; 05b: complete |
| 2 | receptionist PostgREST read of `clinical_notes` denied (PO-3) | 05a (+ contract in 05b) | 05-02a, 05-02b, 05-b0 | `clinical_notes.test.sql`, `role-rls.spec.ts` (real JWT) | — | Done at 05a |
| 3 | cross-tenant child insert fails | 05a | 05-03 | `composite_fks.test.sql`, `cross-tenant-refs.spec.ts` | — | Done at 05a |
| 4 | removed member reads 0 rows with a still-valid JWT | 05b | 05-05 | matrix `removed` principal; `remove-member.spec.ts` | session delete on hosted (05-P4) | Done at 05b; hosted fallback per 05-P4 |
| 5 | receptionist can register a patient | 05a | 05-01b, 05-02b | `receptionist-registration.spec.ts`, matrix cell, M0 F-01 test | — | Done at 05a |
| 6 | two overlapping non-overbooked appointments cannot both be inserted | 05a | 05-08 | `scheduling_exclusion.test.sql`, `no-double-booking.spec.ts` | — | Done at 05a |
| 7 | 50 parallel check-ins → 50 distinct tokens, IST date | 05a | 05-08 | `queue-token-concurrency.spec.ts`, `queue_tokens.test.sql` (IST boundary) | — | Done at 05a |
| 8 | `p_now` past `access_ends_at` → 0 rows from every clinical table and storage bucket | 05b | 05-09a (function, `p_now`), 05-10a (RLS + storage; `access_ends_at` before the transaction start ≡ `p_now` past it) | `billing_access.test.sql`, `access_lock_rls.test.sql`, matrix `locked` cells | — | Done at 05b |
| 9 | `authenticated` cannot execute any `billing_internal.*` | 05b | 05-09a | `billing_grants.test.sql` (catalogue loop) | — | Done at 05b |
| 10 | one invite sends exactly one email under retry | 05b | 05-07a, 05-07b | `invite-delivery.spec.ts` (Mailpit), `invitations_v2.test.sql` | optional staging check (05-P5) | Done at 05b |
| 11 | after 05-10 every existing DB suite stays green; test tenants `trialing` or comped | 05b | 05-09c, 05-10a | dry-run reports; full Vitest + pgTAP + e2e at the gate SHA (two runs) | staging re-seed with comp (05-P3) | Done at 05b |
| 12 | Standard price 149900 @ 1800 bp → 176882 | 05b | 05-09a | `billing_catalogue.test.sql` | — | Done at 05b |
| 13 | only Standard purchasable; `set_product_availability` refuses without an active provider price; `trialing` has `ai.scribe` 1,500, `active` Standard none | 05b | 05-09a, 05-09b, 05-10c | `billing_catalogue`, `platform_rpcs`, `billing_entitlements`, `ai_gating_l2` | — | Done at 05b |
| note | `create_clinic_with_owner` creates `incomplete` tenants; seeds set a subscription row | 05b | 05-09a, 05-09c | `subscription_invariant.test.sql`, helper spec | staging re-seed (05-P3) | Done at 05b |

Roadmap tests: generated matrix roles × access levels (05-01b → 05-05 → 05-10a); parity (05-01b); time travel (05-09a);
concurrency check-in/booking (05-08) and `ai_reserve` (05-10c); invite pgTAP (05-07a); migration edge cases (05-03 FK,
05-08 overlap). Roadmap evidence: CI pgTAP report (both gates); diagnostics report (`evidence/05a/diagnostics/`);
`/gsd-secure-phase` outputs (both gates); independent reviewer sign-off (both gates).

V2-03 handovers (revision 2026-11-13): active-tenant binding + multi-membership leg (05-01b, 05-02c; R-42); composite
FK webhook queue → subscription, M-XTENANT-WH (05-03); lab storage keys without names (05-02c; R-45); per-role statement
timeouts (05-02c; R-47); `record_payment` → `has_permission` + DB-checked `p_tenant_id` (05-02c); `CURRENT_DATE`
defaults with app/SQL date parity (05-08). Already done by V2-03 and not re-planned: the `audit_logs` actor guard
(000029), `23P01` mapping, raw `err.message` responses (03-13d).

Scope coverage: P1-01 (05-01b, 05-02a/b/c, 05-04), P1-02 (05-03), P1-04 trigger part (05-02c), P1-08 (05-03, 05-04),
P1-10 + P1-11 (05-06), P1-39 + P1-40 + P2-08 FK (05-08), P0-14 backend (05-01b, 05-02b), AUTH-05 (05-05), AUTH-06 backend
(05-07a/b), SUB-01 (05-09a/b/c), AI-18 (05-09a/b), SUB-02 (05-10a/b), AI-03 DB + AI-06 L2 DB (05-10c), V2-03 R-33
(05-08). Out of scope (owners): SUB-03…SUB-11 and the `saas_*` tables (V2-13b/c), AI gateway (V2-12), staff UI and
J-A2/J-A6 (V2-11), immutability (V2-09a), atomic command RPCs (V2-07), billing invariants (V2-10), trigram (V2-08).

## PO actions for this phase

The orchestrator copies these into `.planning/PO-ACTIONS.md` under "V2-05 Database authorisation, integrity &
entitlements". No secret value appears here. Nothing below blocks local work; 05-P1 blocks the merges; 05-P2…05-P5
and 05-P7 are hosted steps that run after a merge (V2-03 R-19 pattern). They assume V2-03's staging items (E2, E4, E10) are done; if
staging is not live yet, 05-P2/05-P3 are moot until it is (the first bring-up applies every migration).

- [ ] **05-P1 · Confirm the V2-05 rulings**
  - *Do / where:* read the rulings table at the end of this plan and confirm or overturn them in chat. In particular:
    **R-1** (stacked PRs: 05a's PR targets the V2-04 branch and 05b's targets 05a, a deviation from CLAUDE.md's "branches
    off `feature/v2`"); **R-2/R-3** (schema change: clinical notes **and vitals** move from `visits` to a new
    `clinical_notes` table); **R-6/R-7/R-8/R-9** (receptionist: register, `billing:view`, `billing:collect`; doctors and
    nurses stop collecting; doctors keep own-visit invoices and Sign & Bill "send to reception"; receptionists/admins
    edit patient demographics only but still **see** allergies on the patient record; admins have no clinical access);
    **R-10** (`saas_*`, `billing_profiles`, `provider_webhook_events` created in V2-13b); **R-15** (diagnostics on the
    local stack only, replacing the roadmap's test-project run); **R-31** (J-A6/J-A2 Playwright move to V2-11); PO-25
    (still open: the default "AI preview ends with the trial" is what acceptance 13 tests; changing it is one seed row);
    the CLAUDE.md Commands proposal (05b close step 6); the doc errata list (R-38). **Added 2026-11-13 (post V2-03):**
    **R-42** (RLS helpers and RPCs bind the session's **active** clinic through a request header the server sets from
    the clinic cookie — a multi-clinic user sees one clinic's data at a time; fallback carrier is a JWT claim from the
    existing token hook); **R-43** (staff removal deletes the user's sessions inside the removal RPC; a hosted refusal
    leaves the 900 s token expiry as the bound); **R-44** (ADR-0005 amendment A4: the invite-acceptance module may call
    the Auth admin system module); **R-45** (lab file keys carry ids only, no patient names; no overwrite);
    **R-46** (server-side Turnstile check for invite acceptance; new env `TURNSTILE_SECRET_KEY`, 05-P7); **R-47**
    (per-role statement timeouts pinned by test).
  - *Why:* the PO delegated these to Claude as CTO; CLAUDE.md requires raising schema and role changes.
  - *Unblocks:* merging 05a (R-1…R-9, R-15) and 05b (the rest).
  - *Verify (Claude):* the confirmation is recorded in `docs/v2/VERIFICATION_LOG.md` (V2-05 gate section) with the date.

- [ ] **05-P2 · Approve the staging migration run for 05a**
  - *Do / where:* after the 05a PR merges into `feature/v2`: GitHub → `thecliniqai/cliniqai-app` → Actions → workflow
    `staging.yml` → the run for the merge commit → "Review deployments" → approve Environment `staging`.
  - *Values:* none (the workflow uses the Environment's secrets).
  - *Why:* staging must run the switched app (clinical notes read from `clinical_notes`, tokens from `next_queue_token`)
    before 05b drops the old columns and function (R-37).
  - *Unblocks:* merging 05b (05-b0 precondition).
  - *Verify (Claude, read-only):* `gh run list --workflow staging.yml --branch feature/v2 --limit 1 --json
    conclusion,headSha,url` → `success` at the 05a merge SHA (its `plan` job lists the 05a files; its `wait-for-release`
    step requires `checks.schema: "current"`); `curl -s https://staging.<domain>/api/ready` → `"status":"ready"` and
    `checks.schema` `"current"` (since V2-03 03-13c the probe returns no migration version: the deployed build reports
    whether its own `EXPECTED_MIGRATION`, the newest 05a file, is applied).

- [ ] **05-P3 · Approve the staging migration run for 05b, then re-seed staging**
  - *Do / where:* after the 05b PR merges: approve the `staging.yml` run for the merge commit as in 05-P2; then Actions →
    `staging.yml` → "Run workflow" on `feature/v2` with task `seed` → approve Environment `staging`.
  - *Why:* 05b makes access subscription-aware. Existing staging clinics are backfilled `incomplete` (onboarding only);
    the idempotent seed sets the synthetic clinics to `active` with `comp_until` one year ahead (R-24, R-25).
  - *Unblocks:* using staging after V2-05; G3 evidence.
  - *Verify (Claude, read-only):* both runs `success` (`gh run list --workflow staging.yml --limit 2 --json
    conclusion,displayTitle,url`); `gh run view <seed run id> --log` contains `access summary: full=<n> locked=0
    onboarding=0` (counts only); `/api/ready` → `checks.schema` `"current"` for the 05b merge build. You confirm one
    sign-in on staging lands on the dashboard, not `/billing/locked`.

- [ ] **05-P4 · Confirm the hosted result for deleting `auth.sessions` rows**
  - *Do / where:* nothing new to run: confirm the AUTH-00 staging re-check result recorded by V2-03 (03-12c kit
    `scripts/staging/auth00-recheck.ts`, **item 4** "postgres DELETE privilege on auth.sessions", dispatched as
    `staging.yml` task `recheck`). If it shows the delete is **denied** on hosted Supabase, accept the documented
    fallback for staff removal: `remove_member` still removes the membership (its session delete is fail-soft and
    records `sessions_revoked: null`), data access stops immediately through membership status in RLS, and the session
    ends within the 900 s access-token lifetime (AUTH §3.6).
  - *Why:* the in-RPC session delete (05-05, R-43) is proven locally only (research A9).
  - *Unblocks:* closing acceptance 4's hosted note.
  - *Verify (Claude):* the V2-03 re-check entry in `docs/v2/VERIFICATION_LOG.md`; your acceptance of the fallback (if
    needed) recorded next to it.

- [ ] **05-P5 · (Optional, not gating) One staff invite on staging**
  - *Do / where:* after 05-P3 and 05-P7, sign in on staging as the seeded owner, invite your own SES-verified address once (staff
    invite server action through the existing staff page or the runbook command), and open the email.
  - *Why:* acceptance 10 is proven locally with Mailpit; this shows the same path through SES.
  - *Verify:* you confirm exactly one email arrived and paste its `Authentication-Results` line (`dkim=pass`); Claude
    checks nothing else on the hosted project.

- [ ] **05-P6 · Gate approvals** — approve the 05a gate and then the 05b gate (reviews, evidence and
  `05a-VERIFICATION.md` / `05-VERIFICATION.md` links). *Verify:* recorded in VERIFICATION_LOG.

- [ ] **05-P7 · Turnstile secret for the app on staging (05-07b, R-46)**
  - *Do / where:* Vercel → `clinicos-staging` → Settings → Environment Variables (Production scope only, as 03-E4):
    `TURNSTILE_SECRET_KEY` = the **secret key** of the Turnstile widget `clinicos-staging` you created in 03-E7 (the
    same value already pasted into Supabase Auth's CAPTCHA settings; sensitive). Redeploy.
  - *Values:* the existing widget secret; no new widget.
  - *Why:* invite acceptance creates the account through the Auth admin API, which skips Supabase's CAPTCHA, so the
    app verifies the Turnstile token itself (AUTH §3.2). Without the value staging refuses every invite acceptance.
  - *Unblocks:* 05-P5 (the optional staging invite) and any invite acceptance on staging after the 05b merge.
  - *Verify (Claude, read-only):* `curl -s https://staging.<domain>/api/health` → 200 (the env schema accepted the
    value at boot); the acceptance itself is checked in 05-P5.

## Threat model (STRIDE register, phase-wide)

| Threat ID | Category | Component | Severity | Disposition | Mitigation |
|---|---|---|---|---|---|
| T-05-01 | Info disclosure | receptionist/admin reads clinical notes or vitals through PostgREST | high | mitigate | `clinical_notes` table with `consultations:view` RLS; legacy columns cleared + CHECK, then dropped (05-02a, 05-b0) |
| T-05-02 | Tampering | nurse writes clinical text through the vitals path | medium | mitigate | `clinical_notes_guard` trigger: without `consultations:edit` only `vitals` may change (05-02a) |
| T-05-03 | Tampering | notes injected through the visit-creation trigger | medium | mitigate | definer trigger inserts fixed empty content only (05-02a) |
| T-05-04 | Tampering | cross-tenant reference (tenant A row → tenant B parent) | high | mitigate | composite `(tenant_id, id)` FKs, validated after D1 = 0 (05-03) |
| T-05-05 | Tampering | visit/Rx attributed to a non-member doctor | medium | mitigate | composite FK to `memberships(user_id, tenant_id)` after D5 = 0 (05-03) |
| T-05-06 | DoS / integrity | cascade deletes erase clinical or financial history | high | mitigate | RESTRICT on clinical/financial children; no parent DELETE policies (05-03, 05-04) |
| T-05-07 | Repudiation | RLS-filtered delete reported as success with an audit row | medium | mitigate | affected-row checks; audit only after a real delete (05-04) |
| T-05-08 | Elevation | doctor or nurse collects payments contrary to PO-3 | medium | mitigate | `billing:collect` guards, payments RLS, `record_payment` check (05-02b, 05-02c) |
| T-05-09 | Info disclosure | roles read prescriptions/invoices beyond their job | medium | mitigate | per-key RLS; doctor limited to own-visit invoices (05-02b) |
| T-05-10 | Tampering | receptionist/admin edits allergies | medium | mitigate | `patients_clinical_fields_guard` (05-02b) |
| T-05-11 | Info disclosure | member reads colleagues' notifications | low | mitigate | own-row policy (05-02c) |
| T-05-12 | Repudiation | forged audit actor | high | mitigate | actor-forcing trigger, INSERT revoked, `log_audit` (05-02c) |
| T-05-13 | Elevation / tampering | TRUNCATE/REFERENCES/TRIGGER by tenant roles; new tables open by default | high | mitigate | revokes + `alter default privileges` + grants catalogue test (05-02c) |
| T-05-14 | Elevation | SECURITY DEFINER helper callable through the Data API | high | mitigate | `authz` not exposed; `search_path=''`; EXECUTE revoked from PUBLIC/anon (05-01b) |
| T-05-15 | DoS / elevation | storage policy `::uuid` cast error; path-class confusion | medium | mitigate | text comparison; per-class policies; unknown class denied (05-02c) |
| T-05-16 | Info disclosure | receptionist reads Rx PDFs or lab files from Storage | high | mitigate | class policies on `prescriptions:view`/`labs:view` (05-02c) |
| T-05-17 | Repudiation | policy matrix drifts from deployed policies | medium | mitigate | single source + generated pgTAP + completeness `set_eq` + drift spec (05-01b) |
| T-05-18 | Info disclosure | referral to an unlisted clinic or without consent | medium | mitigate | directory + consent trigger (05-06) |
| T-05-19 | Info disclosure | export over-shares internal fields; API key exports without scope | medium | mitigate | DTO allow-list; `exports:create` on both paths (05-06) |
| T-05-20 | Tampering | double-booking race | medium | mitigate | exclusion constraint (05-08) |
| T-05-21 | Tampering | duplicate queue tokens; counter rewound by a member | low | mitigate | counter table + definer RPC, no tenant grants (05-08) |
| T-05-22 | Info disclosure | diagnostics executed against a hosted DB | medium | mitigate | loopback guard + spec (05-03) |
| T-05-23 | DoS | staging deploy race after a column drop | low | mitigate | expand + migrate in 05a, contract in 05b after 05-P2 (05-02a, 05-b0) |
| T-05-24 | Elevation | removed staff keeps reading with a live JWT | high | mitigate | `status = 'active'` in every helper body (05-05) |
| T-05-25 | Elevation | removed staff refreshes the session | high | mitigate / transfer | `auth.sessions` rows deleted inside `remove_member` (fail-soft, 05-05, R-43); hosted privilege per 05-P4, fallback 900 s JWT |
| T-05-26 | DoS | last owner removed; admin removes the owner | medium | mitigate | last-owner and owner-only guards, self-removal refused (05-05) |
| T-05-27 | Spoofing | invite link used by a different person | high | mitigate | consume requires the confirmed `invited_address` (05-07a) |
| T-05-28 | Info disclosure | raw invite token at rest (table or job payload) | medium | mitigate | minted at send time by the service-role handler; only the hash is stored (05-07a/b) |
| T-05-29 | Spoofing | pre-account hijack of an invitee | medium | mitigate | server overwrites the password of an unconfirmed invitee after hash validation (05-07b) |
| T-05-30 | DoS | duplicate invite emails under retry | low | mitigate / accept residual | dedupe key + atomic claim + version check; crash window documented (05-07b) |
| T-05-31 | Elevation (billing bypass) | locked clinic keeps using data or files | high | mitigate | access level in helpers, storage policies, definer-function checks (05-10a) |
| T-05-32 | Tampering | `billing_internal` called with a forged `p_now` | high | mitigate | schema/function revokes + catalogue test; caller-bound wrappers only (05-09a) |
| T-05-33 | Spoofing | platform RPC with another admin's `p_actor`; aal1 admin | high | mitigate | SUB §8.1 actor rule; `aal2` in `is_platform_admin()` (05-09b) |
| T-05-34 | DoS | tenant without a subscription row is silently locked | medium | mitigate | AFTER INSERT trigger + backfill + seeds + 05-P3 (05-09a, 05-09c) |
| T-05-35 | Info disclosure | locked clinic's reminders/webhooks still sent, or sent late after renewal | medium | mitigate | claim cancels non-`full` tenants' jobs (05-10a) |
| T-05-36 | Info disclosure | long-lived signed URLs outlive a lock | medium | mitigate | TTL caps 300 s / 900 s (05-10a) |
| T-05-37 | DoS (cost) | AI quota race or abuse | medium | mitigate | `for update` reservation, expiry, kill switch (05-10c) |
| T-05-38 | Info disclosure | AI used for an objecting patient or without owner opt-in | high | mitigate | `ai_preflight`/`ai_reserve` checks in SQL (05-10c) |
| T-05-39 | Elevation / info disclosure | a multi-clinic user acting in clinic A reads or writes clinic B rows through a row id (V2-03 03-07 finding 2) | high | mitigate | helpers bound to `authz.active_tenant_id()`; header carrier set server-side, membership-checked in SQL; dual-member principal in the generated matrix; definer-function list test with a dual-member leg (05-01b, 05-02c, R-42) |
| T-05-40 | Spoofing | forged `x-clinicos-tenant` header or `clinic_active_tenant` cookie | low | accept | the header can only name another clinic the caller is already an active member of (SQL checks membership); no escalation beyond the user's own clinics (05-01b) |
| T-05-41 | Info disclosure | patient names in lab storage keys and signed-URL paths; silent overwrite of an earlier report | medium | mitigate | id-only keys, `upsert: false`, readable name only as the download filename (05-02c, R-45) |
| T-05-42 | Elevation | Auth admin (service-role) calls reachable from a public server action | high | mitigate | one importer allowed by ADR A4 and ESLint (pass/fail fixtures); called only after token-hash validation, Turnstile and FT-05 checks (05-07b, R-44) |
| T-05-43 | Spoofing / DoS | invite acceptance by bots (the admin API skips GoTrue's CAPTCHA) | medium | mitigate | server-side Turnstile `siteverify`, fail closed when unset or unreachable (05-07b, R-46) |
| T-05-SC | Tampering | npm/pip/cargo installs | high | mitigate | no package is added; any later addition goes through the legitimacy gate and a blocking PO check |

## Risks

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| K-1 | Clinical split churn (~26 app files, consult screen) breaks a flow | M | H | first in 05-02 ordering; moved CHECK makes a missed write fail loudly; e2e + grep evidence |
| K-2 | RLS latency with stacked helpers | L | M | `(select …)` initPlan pattern; `explain-rls` evidence (05-10a); indexes from 05-08 |
| K-3 | Suites go red when enforcement flips | M | H | 05-09c dry run before 05-10a; seeds through one helper |
| K-4 | V2-03/V2-04 names differ from 03-PLAN/04-RESEARCH | L (V2-03) / M (V2-04) | M | revision 2026-11-13 aligned V2-03 names with what shipped; V2-04 names follow the revised 04-PLAN; use merged names; never re-create a mechanism; preconditions per plan |
| K-5 | Hosted Supabase denies the `auth.sessions` delete | L | M | 05-P4 fallback (RLS status + 900 s JWT) |
| K-6 | A parent PR is squash-merged, forcing a rebase of the stacked branch | L | M | merge-commit rule (R-1); no force-push |
| K-7 | Migration number collisions with parent-branch fixes | M | L | renumber only this phase's unmerged files; immutability check catches the rest |
| K-8 | Shared local stack contention | M | M | one plan per wave (R-39) |
| K-9 | Generated matrix runtime grows (~45 tables × 10 principals × 4 operations × 3 levels) | M | L | cells are plpgsql subtransactions; measure in 05-01b and 05-10a; split the file by table group if > 60 s |
| K-10 | Explicit FK hints in select strings break after FK renames | M | M | grep + fix in 05-03; e2e |
| K-11 | knownBug markers flip (F-01, P1-07) and turn e2e red | M | L | remove only markers whose body passes, in the plan that fixes them |
| K-12 | Staging clinics locked after 05b until the re-seed | H | L | 05-P3 right after the migration run |
| K-13 | V2-04 slips, delaying 05a's base and 05-07 | M | M | 05a needs only the branch; 05-07a states its precondition; 05b can author 05-09/05-05 first |
| K-14 | Storage API does not expose request headers to policies, so the header carrier fails for Storage | M | M | 05-01b tracer runs first; documented fallback carrier (JWT claim from the existing token hook, body change only); stop and raise if neither works |
| K-15 | Tests and seeds that act as a multi-clinic user without the header start reading nothing after 05-02c | M | L | test client builders gain the header option in 05-01b; the 05-09c flip dry run also covers the binding |

## Rulings (agent acting as CTO under PO delegation; PO confirms at the gate, 05-P1)

| # | Decision | Rationale |
|---|---|---|
| R-1 | Split 05a/05b (roadmap-sanctioned). 05a branches from V2-04's branch and its PR targets it; 05b branches from 05a and targets it; parents merge with a merge commit, children are retargeted, never rebased. **Deviates from CLAUDE.md "branches off `feature/v2`"** | The orchestrator's direction; keeps each part reviewable by an isolated and an adversarial reviewer; CI already runs stacked PRs (OA-2); no force-push needed |
| R-2 | Clinical content moves from `visits` to a new 1:1 table `public.clinical_notes` (PK `visit_id`, composite FK to visits) with `consultations:view`/`consultations:edit` RLS: expand + backfill + app switch in 05a with a VALID "moved" CHECK on the cleared columns; contract (drop) in 05b. **Schema change: PO acknowledgement** | Acceptance 2 needs a table: every user is the `authenticated` Postgres role, so column privileges cannot tell roles apart, and Supabase advises against them (`select *` fails). The CHECK makes the denial true at 05a and keeps staging deploys safe; no production data exists (PO-15) |
| R-3 | `vitals` moves too; nurses update `vitals` only, via a guard trigger | Receptionists lack `vitals:view` in `matrix.ts`; leaving vitals readable on `visits` would be a known gap; same expand/contract, one column more |
| R-4 | Column names stay identical in the new table | Mechanical switch; AI, PDF and API mappers keep their field names |
| R-5 | Each visit's `clinical_notes` row is created by a definer AFTER INSERT trigger with fixed empty content; tenant roles only SELECT/UPDATE | No INSERT/DELETE surface; no way to inject content at booking |
| R-6 | PO-3 permission set: new key `billing:collect` (owner, admin, receptionist); receptionist gains `patients:edit`, `billing:view`, `billing:collect`; billing guards move from `appointments:edit` to `billing:collect`; no other key changes | Follows the docs that decide it: PO-3 (register, book, collect; doctors do not collect) and SVP §6.1 (invoices/payments: owner, admin, receptionist; doctor and nurse ❌); least privilege |
| R-7 | Doctors: SELECT invoices/payments of their own visits; INSERT/UPDATE invoices and items for their own visit (Sign & Bill); no payments; Sign & Bill with collection needs `billing:collect` (the owner of a solo clinic keeps it); `generate_tenant_invoice_number` allowed for `billing:collect` or `consultations:edit` | PO-3 ("view invoices for their own visits and use Sign & Bill"); PO-3 overrides SVP §6.1's doctor ❌ for invoice numbering on the Sign & Bill path |
| R-8 | Receptionists and admins update patient demographics only (`allergies`/`chronic_conditions` changes need `consultations:view`); INSERT at registration may record them; receptionists still **read** them on `patients` | SVP §6.1 "UPDATE demographics only"; allergy intake at the desk is a safety benefit; hiding the read would need a second table split (offered to the PO as a V2-08 follow-up) |
| R-9 | Admins get no clinical access (`consultations:*`, `vitals:*`, `prescriptions:*`) | PO-3 default; SVP marks it a product decision |
| R-10 | SUB-01 creates `plans`, `plan_prices`, `entitlement_keys`, `plan_entitlements`, `tenant_entitlement_overrides`, `tenant_subscriptions`, `subscription_events`, `platform_settings`, `platform_admins`, `platform_audit_log`; `saas_payments`, `saas_invoices`, `saas_invoice_sequences`, `billing_profiles`, `provider_webhook_events` are created in V2-13b with their first writer | Roadmap SUB-01 row names catalogue, prices, keys, subscriptions, settings and events; expand-only later, no data; YAGNI |
| R-11 | Exclusion constraint through an IMMUTABLE wrapper `public.visit_slot(timestamptz, int)`, created valid after D6 = 0 | `timestamptz + interval` is STABLE and rejected in index expressions; exclusion constraints cannot be `NOT VALID` (both verified) |
| R-12 | Composite FKs created `NOT VALID` with their final delete action, validated after diagnostics, old FKs dropped; nullable refs use `ON DELETE SET NULL (<col>)`; doctor refs → `memberships(user_id, tenant_id)`; `tenant_id → tenants` CASCADE, `auth.users` FKs and `referrals.target_tenant_id` unchanged | Plain `SET NULL` nulls `tenant_id` (verified); tenant purge and teardown need the cascade; referrals cross tenants by design |
| R-13 | Every new table/function starts closed (explicit REVOKEs from PUBLIC/anon/authenticated, then minimal grants); TRUNCATE/REFERENCES/TRIGGER revoked from tenant roles; default privileges revoked for future objects | Supabase's default ACL grants full DML and EXECUTE to API roles (verified) |
| R-14 | Fixed-signature helpers in the non-exposed `authz` schema (+ `public.has_permission`, the ADR-006 name, and the `current_user_tenant_ids()` shim); 05-05/05-10a change bodies only; signatures pinned by pgTAP | One policy rewrite instead of three; definer functions stay off the Data API |
| R-15 | Diagnostics D0-D10 run on the local stack only (loopback-guarded script, after seeded runs, plus planted edge cases in rolled-back pgTAP); P0-16a stays "accepted as not required" | CLAUDE.md forbids hosted access; the roadmap's test-project run is replaced; staging holds synthetic data only |
| R-16 | The two psql scripts are converted to pgTAP under `supabase/tests/database/`; the pg_prove image pull is retried, the test run never is | `supabase test db` fails on non-TAP files; retry-to-pass hides defects |
| R-17 | `tests/authz/table-matrix.ts` is the single source; the generator writes the pgTAP matrix, the completeness test and `AUTHZ-MATRIX.md`; transitional `legacy_*` rule kinds describe today's policies and are deleted in 05-02c | SVP §6.1 "one policy-matrix file"; the matrix is green at every commit; leftovers cannot compile |
| R-18 | `next_queue_token(p_visit_id)` is SECURITY DEFINER with an explicit `appointments:edit` check; the counter table has no tenant grants. Deviates from BACKEND C6 ("SECURITY INVOKER") | An invoker function would need UPDATE on the counter, letting any member rewind it; the tenant comes from the visit (V2-04 R-6 pattern) |
| R-19 | SQL `DEFAULT CURRENT_DATE` on `queue_tokens.date` and `patient_documents.report_date` replaced by tenant-local-date triggers | V2-03 R-33 assigned it here; the server runs in UTC |
| R-20 | Audit (P1-04 trigger part): `log_audit(p_tenant, …)` definer with the tenant validated against the caller's active memberships; actor forced by trigger; INSERT revoked; invoker SQL calls `log_audit`; service-role paths unchanged | Forgeable actor today; the in-transaction command audit is V2-07 |
| R-21 | DELETE policies are permission-only; draft/signed predicates belong to V2-09a | BACKEND §6: immutability before the amendment rework breaks v1 amendment |
| R-22 | Services check affected rows wherever RLS can silently filter a write | Three verified silent no-ops reported success and wrote audit rows |
| R-23 | Storage policies are per artefact class (Rx vs receipts in `prescriptions`; labs, referral letters, branding in `clinic-records`), tenant matched as text; the `prescriptions` bucket keeps UPDATE for its writers. SVP §6.1 "UPDATE ❌" deferred to V2-09a/V2-09c | Both PDF archives upload with `upsert: true`; versioned immutable keys come with the Rx rebuild |
| R-24 | One mechanism creates the subscription row: an AFTER INSERT trigger on `tenants` (`incomplete`, `on conflict do nothing`); `create_clinic_with_owner` unchanged; existing tenants backfilled `incomplete` | Covers service-role inserts too; no double rows; production starts empty |
| R-25 | Test tenants default to `trialing` on Standard; local and staging demo clinics are comped `active` with the Standard price; lands in 05-09c and is proven by a flip dry run before 05-10a | SUB §11; research Pitfall 8 (comp without a price has no `assist.*` keys) |
| R-26 | SUB §7.2's `current_user_billing_tenant_ids()` is implemented as `authz.billing_tenant_ids()` | Same behaviour; helpers live in `authz` |
| R-27 | Jobs of non-`full` tenants are cancelled in V2-04's claim function, with a closed exempt-kind list (empty now) | No reminders from a locked clinic, and none sent late after a renewal; owner billing notices (V2-13b) must still run |
| R-28 | Service-role readers use `public.tenant_access_for_system(p_tenant)` (no `p_now`, `service_role` only) | `billing_internal` stays unexposed; `p_now` stays test-only |
| R-29 | Signed URLs capped at 300 s for in-app and share views and 900 s for exports, clamped in `lib/storage` | SUB §7.2; share links are views too |
| R-30 | Invite tokens are minted at send time by the email handler through a service-role RPC that stores only the hash; resend bumps `token_version`; stale jobs send nothing. Differs from AUTH §3.2's sequence, same contract | No raw token at rest in `invitations` or `ops.jobs` |
| R-31 | Playwright J-A6 (staff removal) and J-A2 (invite) plus the styled `/join` form move to V2-11 with the staff UI; V2-05 proves them at DB and service level, with a minimal functional `/join` form | Roadmap V2-05 acceptance does not list them; no staff-removal UI exists; the roadmap is the source of truth over AUTH §9 |
| R-32 | Membership statuses `active`, `suspended`, `removed`; self-removal refused; re-inviting a removed member reactivates the same row | `unique_user_tenant` allows one row per user and clinic; `suspended` is reserved for V2-11/V2-13c |
| R-33 | AI: `ai_preflight(p_feature, p_visit_id)` and `ai_reserve(p_feature, p_visit_id, p_timeout_s)` derive tenant and patient from the visit; owner opt-in through `set_ai_opt_in` (owner-only RPC) instead of a table UPDATE grant; the expired-reservation cleanup job is deferred to V2-12 | One subject row gives both tenant and objection; stricter than an RLS UPDATE; expired reservations stop counting without a job (AI §4.6) |
| R-34 | The dead `consultations` table is gated by `consultations:*` now and dropped in V2-09b | Research Open Q5 |
| R-35 | Referral directory = `tenants.referral_directory_listed` (set by `clinic:manage`; UI in V2-11) + `referral_directory_search` returning id and name only | Simple, reversible opt-in |
| R-36 | v1 `subscriptions`/`payment_records` are dropped in 05-09c in the same PR as their read switch; the staging-only race on one owner settings page is accepted | Synthetic staging, minutes; SUB-01 requires the drop in V2-05 |
| R-37 | 05a's contract steps (visit clinical columns, `generate_daily_queue_token`) ship in 05-b0 and merge only after 05-P2 (or before staging exists) | Expand → migrate → contract across two deploys |
| R-38 | Proposed doc errata (applied only after 05-P1): roadmap V2-05 and DB-08 (exclusion via an IMMUTABLE wrapper); SVP §6.1 (doctor invoice numbering for Sign & Bill; `prescriptions` bucket UPDATE deferred; receptionist reads allergies pending PO); AUTH §3.2 (token minted at send) and §9 (J-A6 → V2-11); BACKEND C6 (`next_queue_token` definer) and §3 (diagnostics local); SUB §7.1 (`saas_*` in V2-13b), §7.2 (helper name) | CLAUDE.md: never silently change approved docs |
| R-39 | One plan per wave, except 05-01a ∥ 05-01b | Shared local stack and shared generated artifacts |
| R-40 | `tenants`/`memberships` use the member helper; billing tables the billing helper; all else the full-access helper | A locked owner must still resolve the clinic to reach `/billing/locked` (Pitfall 7) |
| R-41 | `public.permission_matrix()` (static, invoker) is exposed for the parity test | Avoids adding a `pg` dependency |
| R-42 | **New 2026-11-13.** RLS helpers and RPCs bind the session's **active** tenant: `authz.active_tenant_id()` reads the `x-clinicos-tenant` request header that `lib/supabase/server.ts` sets from the `clinic_active_tenant` cookie, accepts it only for a membership, else the sole membership, else nothing; `full_tenant_ids`/`tenant_ids_with`/`billing_tenant_ids`/`has_permission` return at most that tenant; `member_tenant_ids` (all clinics) only for `tenants` and own `memberships` rows; every definer function swept in 05-02c; `current_user_tenant_ids()` stays as the member helper. Fallback carrier if Storage cannot see the header: a JWT claim from the existing token hook (same helper signature). **Architecture change: PO acknowledgement** | V2-03 03-07 finding 2 and wave note: "any membership" let a dual-clinic user acting in A write B rows; the header keeps the cookie as the single source (no token refresh on switch, no hosted hook change) and the SQL membership check means a forged value names only the caller's own clinics |
| R-43 | **New 2026-11-13.** `remove_member` deletes the target's `auth.sessions` rows itself (definer, inner block tolerant of `insufficient_privilege`, `sessions_revoked` recorded); no `revoke_user_sessions` service-role RPC and no system-module call from the server action | ADR-0005 D2 (enforced since V2-03 03-04) forbids a server action importing `features/*/system.ts`; one transaction, no service role; the hosted fallback (05-P4) is unchanged |
| R-44 | **New 2026-11-13.** ADR-0005 amendment A4 (proposed): `features/auth/invite-flows.ts` may import `features/auth/system.ts` (Auth admin `createUser`/`updateUserById` and `consume_invitation_for`), called only after the token hash, Turnstile and FT-05 checks; one ESLint zone with pass/fail fixtures | AUTH §3.2's invite flow needs the Auth admin API from a public, token-gated action; ADR-0005's importer list has no such entry (A1 is the precedent for share routes) |
| R-45 | **New 2026-11-13.** Lab storage keys are `tenants/<tenant>/patients/<patient>/labs/<document_id>.<ext>` with `upsert: false`; the readable name is only the download filename; legacy synthetic keys are not renamed | V2-03 triage (accepted, owner V2-05 storage) and review E I-4: patient names in keys and signed-URL paths are PHI, and the old upsert silently replaced earlier reports |
| R-46 | **New 2026-11-13.** Invite acceptance verifies Turnstile server-side (`lib/auth/turnstile.ts`, Cloudflare `siteverify`, fail closed) with a new env name `TURNSTILE_SECRET_KEY` (R-15 checklist; required in production; PO sets staging in 05-P7) and a loopback-only `TURNSTILE_VERIFY_URL` for test/e2e | V2-03 shipped CAPTCHA only inside GoTrue; the admin API used for invitees skips it; AUTH §3.2 requires a server-side check |
| R-47 | **New 2026-11-13.** Role-level `statement_timeout` for `anon`/`authenticated` is pinned by `grants.test.sql` at the values found at branch time; no value change | V2-03 03-07 finding 3: function-level timeouts are not enforced for the calling statement, so the role setting is the only bound; handed to V2-05 |

## Open for the PO (not blocking)
1. 05-P1: confirm the rulings, especially R-1, R-2/R-3, R-6…R-9, R-10, R-15, R-31, PO-25 and the post-V2-03 rulings
   R-42 (active-clinic binding), R-43, R-44 (ADR A4), R-45, R-46 (Turnstile secret), R-47.
2. 05-P2 after the 05a merge; 05-P3 and 05-P7 after the 05b merge; 05-P4 when V2-03's re-check is recorded.
3. 05-P5 is optional.

