# Codebase Concerns

**Analysis Date:** 2026-10-06

> **Legend.** Every entry is tagged:
> - **[OBSERVED]** — verified directly in files/state on disk today.
> - **[IMPLIED]** — not present in code; a risk/requirement derived from the documented intent in `AGENTS.md` (engineering), `DESIGN.md` (UI), and `docs/clinic-management-prd.md` (product). These are not "bugs in code" — they are the security/quality controls the documentation mandates that **do not exist yet**, and which must land *before* the first real data/auth code does.
>
> **Repo state (OBSERVED):** pre-scaffold. Git repo exists on branch `main` with **zero commits** (`git status` → "does not have any commits yet"; `git ls-files` → 0 files). No application code anywhere: no root `package.json`, `tsconfig.json`, lockfile, `src/`, `app/`, `.github/`, `.env.example`, `.gitignore`, migrations, or test files. Existing content is documentation (`AGENTS.md` 1,698 lines, `DESIGN.md` 2,200 lines, `docs/clinic-management-prd.md` 247 lines), the GSD/OpenCode tooling vendored under `.opencode/`, and mapper output under `.planning/codebase/`. Consequently there is **no application tech debt in the classic sense** — the concerns below are (a) repository-hygiene defects observed now, and (b) unimplemented controls implied by the documented intent.

## Tech Debt

**Repository has no commit history — nothing is version-controlled yet [OBSERVED]:**
- Issue: `main` has zero commits; every file (`AGENTS.md`, `DESIGN.md`, `docs/clinic-management-prd.md`, `.opencode/`, `.planning/`) is untracked. There is no baseline to diff, revert, or review against.
- Files: `.git/` (empty history), repo root
- Impact: `AGENTS.md` §37 (focused/reversible commits) and §28 (review the diff) are unenforceable; a GSD `gsd-undo`/`gsd-pr-branch` workflow that depends on a phase manifest will have nothing to anchor to; the first commit will be a monolith mixing docs, tooling, and any early code.
- Fix approach: create `.gitignore` first (see next item), then make a focused initial commit of documentation only, before any scaffold lands.

**No `.gitignore` [OBSERVED]:**
- Issue: repo root has no `.gitignore` and no `.git/info/exclude` entries for this project (the exclude file only contains stale `.kilo/`/`.kilocode/` patterns from a different AI tool). `.DS_Store` sits at the repo root; `.opencode/node_modules/` exists and is untracked-but-unguarded.
- Files: repo root (missing `.gitignore`), `.DS_Store`, `.opencode/node_modules/`, `.git/info/exclude`
- Impact: the first `git add -A` commits macOS cruft and ~thousands of vendored tooling files; secrets guard depends entirely on `.opencode/hooks/gsd-secret-read-guard.js` rather than ignore rules; `.env*` files (once created for Supabase/Vercel) have no ignore protection — a direct `AGENTS.md` §32 violation waiting to happen.
- Fix approach: add `.gitignore` covering `.env`, `.env.*`, `.DS_Store`, `node_modules/`, `.opencode/node_modules/`, build output, and decide deliberately whether `.planning/` is committed (GSD convention) before the first commit.

**`.env.example` missing although mandated [OBSERVED / IMPLIED gap]:**
- Issue: `AGENTS.md` §32 requires committing `.env.example` and lists it in the §6.2 structure; `AGENTS.md` §51 names `README.md` and `.env.example` as canonical references. None exist. No `.env*` file exists either (verified by glob — existence check only).
- Files: repo root (missing), `AGENTS.md:334-336`, `AGENTS.md:1230`, `AGENTS.md:1695`
- Impact: when scaffold begins, the required env surface (Supabase URL/anon key/service role, Vercel vars) will be discovered ad hoc; "configuration should fail clearly when required production values are missing" (§32) has no artifact to encode against.
- Fix approach: create `.env.example` with non-sensitive key *names* alongside the first Supabase integration; create `README.md` with the canonical commands per §48.

**Broken cross-document references [OBSERVED]:**
- Issue: `DESIGN.md` §3 ("Stripi reference file", ~line 266) instructs readers to consult `DESIGN-stripe.md`, which does not exist anywhere in the repo. `AGENTS.md` §51 declares `README.md` a canonical reference; it does not exist.
- Files: `DESIGN.md:266-276`, `AGENTS.md:1695`, missing `DESIGN-stripe.md`, missing `README.md`
- Impact: a future agent/developer following the docs hits dead ends; worse, the DESIGN.md section tells readers to draw rules from an absent source file, inviting invention of "Stripe-like" styling with no authority — an easy way to violate `DESIGN.md` §2 non-negotiables.
- Fix approach: either commit the referenced file, or rewrite §3 to inline the approved takeaways and delete the dangling pointer; add `README.md`.

**Spec-heavy, enforcement-light: 3,900 lines of binding rules with zero tooling to enforce them [OBSERVED]:**
- Issue: `AGENTS.md` mandates TypeScript strict mode (§29), lint/format checks (§28), type checking in CI (§29), tests (§27), and `DESIGN.md` (2,200 lines) mandates a strict visual system — yet there is no `eslint`/`prettier`/`biome` config, no `tsconfig.json`, no CI (`.github/` absent), no test runner, and no code at all. The rules exist only as prose.
- Files: `AGENTS.md`, `DESIGN.md`, repo root (missing configs)
- Impact: every rule is at the mercy of agent discipline; drift begins with the first generated component (e.g., an arbitrary Tailwind color or an `any`) and nothing will catch it. `AGENTS.md` §28's "verification before completion" loop cannot be executed today.
- Fix approach: treat scaffold task #1 as encoding the spec into tooling — ESLint (strict + Next.js rules), Prettier, `tsconfig.json` strict, a `typecheck`/`lint` script pair, and a minimal GitHub Actions workflow — before feature code.

**PRD open questions unresolved — scope is not settled [OBSERVED in docs]:**
- Issue: `docs/clinic-management-prd.md` §9 lists six unresolved items: billing/invoicing scope ("confirm before build"), subscription payment gateway, India drug-database and lab-test-catalog sourcing, WhatsApp BSP selection, Supabase data-residency region, and — explicitly — "solo-founder build capacity… a separate build-sequencing conversation… will be needed to make a 3-month timeline realistic." §4.10 is flagged "Not explicitly requested but essential."
- Files: `docs/clinic-management-prd.md:132`, `docs/clinic-management-prd.md:229-236`
- Impact: planning a phase against an unsettled scope risks building the wrong vertical slice; the drug database and WhatsApp BSP are long-lead vendor decisions (Meta BSP approval 1–2 weeks) that gate §4.5/§4.8 features.
- Fix approach: close §9 items before roadmap commitment; record decisions in `.planning/` decisions/PROJECT state.

**GSD planning state incomplete [OBSERVED]:**
- Issue: `.planning/` contains only `codebase/` (mapper output). No `config.json`, `PROJECT.md`, `ROADMAP.md`, or phase directories exist yet.
- Files: `.planning/`
- Impact: downstream `/gsd-plan-phase` / `/gsd-execute-phase` expect roadmap/project state; mapping is running ahead of project initialization.
- Fix approach: run project initialization (`gsd-new-project`/`gsd-onboard` flow) so roadmap and decisions exist before phases are planned.

**Stale tooling leftovers in local git config [OBSERVED]:**
- Issue: `.git/info/exclude` contains `.kilo/` and `.kilocode/` patterns from a different AI coding tool, unrelated to this project's stack; `.DS_Store` is present at root.
- Files: `.git/info/exclude`, `.DS_Store`
- Impact: cosmetic, but signals tool-hopping residue; local excludes are invisible to collaborators.
- Fix approach: clean when establishing the real `.gitignore`.

## Known Bugs

None — there is no application code to contain bugs. All "broken behavior" currently observed is documentation-level (the missing-file references listed under Tech Debt).

## Security Considerations

**Multi-tenant isolation and RLS — the core control — does not exist yet [IMPLIED, highest priority]:**
- Risk: the product's defining security boundary (strict tenant partitioning) is specified only in prose. First schema/auth code that lands without RLS baked in will either leak data across clinics or be painful to retrofit (RLS policies are easiest to write alongside the table).
- Files (specification): `AGENTS.md` §7 (§ multi-tenancy mandatory rules), `docs/clinic-management-prd.md:165` ("row-level security enforced, not just application-level checks")
- Current mitigation: none in code. The only proactive guard today is process-level: `.opencode/hooks/gsd-secret-read-guard.js` (a hook that blocks reads of secret-shaped files during agent sessions) and `.opencode/hooks/gsd-read-injection-scanner.js`.
- Recommendations: make "tenant_id on every tenant-owned table + explicit RLS policy + a cross-tenant access test" a hard gate of the first migration phase (`AGENTS.md` §14 checklist, §27 "Test cross-tenant access explicitly"). Never ship a table without its policy in the same migration file.

**Authentication does not exist [IMPLIED]:**
- Risk: PRD requires OTP-based staff login with no shared per-clinic logins (`docs/clinic-management-prd.md:177`); `AGENTS.md` §8 requires short-lived sessions, HttpOnly/Secure/SameSite cookies, CSRF protection, and forbids tokens in localStorage without justification. None of this is implemented — there is no `lib/supabase/`, no session utilities, no auth routes.
- Files (specification): `AGENTS.md` §8, `docs/clinic-management-prd.md:173-179`
- Current mitigation: none.
- Recommendations: build auth behind `@supabase/ssr` cookie sessions before any protected data page; decide OTP flow early (Supabase phone OTP vs. custom) since PRD §4.1 also requires OTP-based *staff invites*.

**Authorization/RBAC is prose-only [IMPLIED]:**
- Risk: roles (Owner, Doctor, Nurse, Receptionist, Billing, Admin) are enumerated in `AGENTS.md` §8 and PRD §4.1 but no permission model, no server-side check helper, and no role tests exist. `AGENTS.md` is explicit that "UI hiding is not authorization."
- Files (specification): `AGENTS.md` §8 ("RBAC"), `docs/clinic-management-prd.md:60`
- Current mitigation: none.
- Recommendations: define a single permission matrix (role × action) as a typed module at first feature build, and require a server-side permission assertion in every Server Action/Route Handler — not per-page ad-hoc checks.

**Audit logging absent [IMPLIED]:**
- Risk: `AGENTS.md` §10 and PRD §5.3 require audit events for clinical/administrative actions and viewing (not just editing) of patient records; PRD §7 sketches an `AuditLog` entity. Nothing implements it, and audit is expensive to backfill — missed events are unrecoverable.
- Files (specification): `AGENTS.md` §10, `docs/clinic-management-prd.md:176`, `docs/clinic-management-prd.md:215`
- Current mitigation: none.
- Recommendations: ship the audit-log table + write helper with the first patient-data mutation; keep payloads metadata-only (§10 "Do not store full sensitive payloads").

**Consent records (DPDP Act) not modeled [IMPLIED]:**
- Risk: PRD §4.13 requires consent events to be "first-class, immutable records from day one" (needed for both DPDP compliance and future ABDM consent-manager integration). No schema exists; retrofitting immutability onto an existing table is hard.
- Files (specification): `docs/clinic-management-prd.md:157`, `docs/clinic-management-prd.md:82`, `docs/clinic-management-prd.md:214`
- Current mitigation: none.
- Recommendations: include `ConsentRecord` (append-only, no UPDATE/DELETE path in app code) in the initial schema migration alongside `Patient`.

**Secrets handling — currently clean, but unprotected against the first commit [OBSERVED]:**
- Risk: no secrets found. A repo-wide pattern scan on 2026-10-06 (looking for `sk-…` keys and `api_key = <long literal>`) matched only false positives in tooling docs (`.opencode/gsd-core/workflows/settings-integrations.md` masking examples, hash strings in `.opencode/gsd-file-manifest.json`). However there is no `.gitignore` to keep future `.env` files out, and `AGENTS.md` §31/§32 rules have no enforcement.
- Files: repo root (no `.env*` present — existence check only), `.opencode/hooks/gsd-secret-read-guard.js`, `.gitignore` (missing)
- Current mitigation: GSD secret-read guard hook; no committed secrets.
- Recommendations: `.gitignore` **before** creating any `.env`; keep `.env.example` key-name-only; verify `git status` shows no `.env` at first commit (`AGENTS.md` §37).

**PHI-in-logs and analytics rules unenforceable [IMPLIED]:**
- Risk: `AGENTS.md` §9/§12 forbid logging clinical notes, passwords, tokens, and sensitive personal data; §40 forbids sending PHI to AI providers unprotected. With no logger, no structured-logging convention, and no AI provider adapter yet, these rules have no chokepoint to attach to.
- Files (specification): `AGENTS.md` §9, `AGENTS.md` §12, `AGENTS.md` §40
- Current mitigation: none.
- Recommendations: introduce one internal logger module at scaffold time (structured, with redaction hooks) so all future code routes through it — do not allow raw `console.log` in server code.

**Rate limiting, upload safety, and API abuse protection all absent [IMPLIED]:**
- Risk: PRD §4.12 requires per-tenant API-key rate limiting and usage logging; `AGENTS.md` §35 requires limits on login/OTP/search/export. Public booking links (PRD §4.2) and patient-facing secure result links (PRD §4.7) are unauthenticated-by-token surfaces that will exist early. No protections exist.
- Files (specification): `AGENTS.md` §35, `docs/clinic-management-prd.md:149`, `docs/clinic-management-prd.md:68`, `docs/clinic-management-prd.md:115`
- Current mitigation: none.
- Recommendations: plan OTP/login rate limits into the auth phase; use short-lived signed URLs for any file/result link rather than ID-based routes (`AGENTS.md` §21, §16).

## Performance Bottlenecks

**No measurable performance surface yet [OBSERVED]** — there are no queries, renders, or endpoints to profile.

**Implied performance requirements with no supporting architecture yet [IMPLIED]:**
- Target: core actions (open patient record, create appointment, save prescription) under 1–2 s on Indian 3G/4E networks; offline-tolerant queue view and draft prescriptions (PRD §5.2).
- Files (specification): `docs/clinic-management-prd.md:169-171`, `AGENTS.md` §24
- Cause/risk when implemented: patient search over fuzzy dedup matching (`docs/clinic-management-prd.md:78` — name+phone+DOB fuzzy match) and unbounded search are the likely first hotspots; `AGENTS.md` §16 forbids unbounded production search and §14 forbids fetching whole tables to filter in app code.
- Improvement path: design the patient-search path with DB-side trigram/index support and pagination from day one; debounce client search (`AGENTS.md` §16); paginate every collection endpoint (`AGENTS.md` §11).

**WhatsApp/SMS synchronous sending would block clinical workflows [IMPLIED]:**
- Problem: PRD §4.8/§5.5 require notifications to be asynchronous and require clinical data entry to keep working if the messaging provider is down.
- Files (specification): `docs/clinic-management-prd.md:188`, `AGENTS.md` §20
- Improvement path: queue-driven delivery with retry/idempotency when notifications are introduced; never send inline in a Server Action.

## Fragile Areas

**The specification documents themselves [OBSERVED]:**
- Files: `AGENTS.md`, `DESIGN.md`, `docs/clinic-management-prd.md`
- Why fragile: with no code, tests, or lint, these three files *are* the system. They are also large (1,698 + 2,200 + 247 lines) and contain dangling references (`DESIGN-stripe.md`, `README.md`). Any internal inconsistency propagates directly into code because nothing mechanically checks compliance (`AGENTS.md` §5 does define an instruction priority — DESIGN.md wins for UI, AGENTS.md for engineering — which helps, but only for humans/agents that read it).
- Safe modification: change them deliberately via a focused commit; when adding a rule, update the canonical file per `AGENTS.md` §51 rather than leaving it in chat history; keep `DESIGN.md` as the single source for any token/component decision.
- Test coverage: none (documentation has no checks; a future `gsd-docs-update`/link-check would catch dead file references).

**Patient dedup fuzzy matching (future) [IMPLIED]:**
- Files (specification): `docs/clinic-management-prd.md:78`
- Why fragile: fuzzy name+phone+DOB matching in a "high-volume, low-friction registration" flow will produce both false merges and lingering duplicates; merges of clinical records are effectively irreversible.
- Safe modification: build as a suggestion-with-review flow (never auto-merge), with an explicit merge audit event, before trusting it.
- Test coverage: none yet — should be a unit-test target when built (`AGENTS.md` §27 lists business rules/calculations).

**Double-booking prevention (future) [IMPLIED]:**
- Files (specification): `docs/clinic-management-prd.md:73`, `AGENTS.md` §43
- Why fragile: two receptionists booking one slot is explicitly in scope; client-side availability checks are insufficient (§17). Requires DB-level exclusion constraints or transactional guards plus configurable overbooking — a classic race.
- Safe modification: server-side transactional/unique-constraint enforcement + an integration test for the concurrent case.
- Test coverage: none yet.

**External provider coupling (future) [IMPLIED]:**
- Files (specification): `docs/clinic-management-prd.md:199`, `AGENTS.md` §41
- Why fragile: WhatsApp BSP (Gupshup/Twilio), SMS gateway, AI provider (Claude API), payment gateway for ₹1,000/month, and a licensed India drug database are all undecided vendors with 1–2 week onboarding lead times (PRD §9.4). Direct SDK calls scattered in code would make swaps expensive.
- Safe modification: provider-adapter interfaces from the first integration (`AGENTS.md` §41; PRD §6 "pluggable providers, not hard-coded").
- Test coverage: none yet.

**AI-assisted clinical content (future) [IMPLIED]:**
- Files (specification): `AGENTS.md` §40, `docs/clinic-management-prd.md:138-143`
- Why fragile: AI outputs touch the medical record; a missing "AI_generated_flag" or silent write would violate both docs ("never auto-finalized without doctor confirmation", "AI as an assistant, never the record of truth").
- Safe modification: enforce AI-flagging at the data-model level (column + UI label) rather than by convention; audit AI-assisted actions.

## Scaling Limits

**None measurable yet [OBSERVED].** Documented capacity intent for planning purposes:
- Target: "handful of pilot clinics to thousands of tenants without a redesign" on Vercel + Supabase Postgres, stateless app layer for horizontal scaling (`docs/clinic-management-prd.md:166-167`).
- Known future ceiling per PRD §6/§9.5: shared-tenant Supabase plan and region/data-residency constraints will force migration evaluation (AWS/GCP/Azure India regions) once scale or DPDP compliance demands it; PRD §6 explicitly warns against deep coupling to Supabase-specific features to keep that exit open (aligned with `AGENTS.md` §5 "No direct database-platform coupling").

## Dependencies at Risk

**No application dependencies installed [OBSERVED]** — no root `package.json`/lockfile, so there is nothing vulnerable today.

**Documented-intent dependency risks [IMPLIED]:**
- `next@latest` / floating "latest stable" pins (`AGENTS.md` §5): acceptable as a directive, but the moment scaffold lands, commit a lockfile immediately — floating versions without a lockfile is how reproducibility dies.
- India drug database (PRD §9.3): commercial/licensed source still undecided; blocks §4.5 e-prescription drug search and §4.13 structured-medication readiness.
- WhatsApp Business API via BSP (PRD §9.4): 1–2 week Meta approval onboarding — long-lead item on the critical path for reminders.
- Supabase region (PRD §9.5): must be chosen at project creation, not later — changing it later means data migration.

## Missing Critical Features

Everything product-facing is missing (expected — pre-scaffold). Listed as the gap between documented requirement and code, in the order they gate others:

- **Tenant isolation + RLS migrations** — blocks any data feature (`AGENTS.md` §7, PRD §5.1).
- **Auth (OTP staff login, session cookies)** — blocks every protected screen (`AGENTS.md` §8, PRD §5.3).
- **RBAC permission checks** — blocks role-specific workflows (PRD §4.1).
- **Audit log + consent records** — unrecoverable if deferred past first patient data (`AGENTS.md` §10, PRD §4.13).
- **Scaffold verification tooling** (lint, format, `typecheck`, CI) — `AGENTS.md` §28/§29 currently have nothing to run.
- **Test harness + tenant-isolation tests** — `AGENTS.md` §27 unexecutable (see Test Coverage Gaps).
- **Health/readiness endpoints** — `AGENTS.md` §34.
- **`.gitignore` / `.env.example` / `README.md`** — `AGENTS.md` §32/§51.

## Test Coverage Gaps

**Overall: 0% — no test infrastructure exists at all [OBSERVED]:**
- What's not tested: everything (there is no application code), and critically there is also no *test scaffolding*: no `jest.config.*`/`vitest.config.*`/`playwright.config.*`, no `tests/` directory, no test script in any `package.json` (none exists), no CI workflow.
- Files: repo root (all missing); specification at `AGENTS.md` §27
- Risk: when code starts landing, the first features will ship with no harness to add tests *into*, and the mandatory verification loop (`AGENTS.md` §28: "Run the smallest relevant tests") cannot run — meaning "done" will be declared on faith.
- Priority: **High** — choose and install the test runner (Vitest + Playwright per `AGENTS.md` §27's Playwright/E2E direction) as part of scaffold, before feature 1, with one smoke test proving the pipeline works.

**Highest-risk future areas needing tests from day one (currently 0 coverage):**
- Cross-tenant access attempts (`AGENTS.md` §7, §27) — **High**
- Concurrent double-booking (`AGENTS.md` §43) — **High**
- RBAC denials per role (`AGENTS.md` §8) — **High**
- Prescription/consultation state transitions (draft→finalized) (`AGENTS.md` §18) — **Medium**
- Payment/idempotency side effects (`AGENTS.md` §19, §42) — **Medium**
- Patient fuzzy dedup behaviour (PRD §4.3) — **Medium**

---

*Concerns audit: 2026-10-06*
