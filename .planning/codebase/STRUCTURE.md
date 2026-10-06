---
last_mapped_commit: f3441361462d6de5a1925d3d174bde9003273c39
last_mapped_at: 2026-10-06
---
# Codebase Structure

**Analysis Date:** 2026-10-06

> **Current state:** The repository is documentation-only. There is no application source tree, no `package.json`, no configs, no tests, and the git repo has zero commits (all files untracked). The "Where to Add New Code" section below is prescriptive and based on documented intent from `AGENTS.md` §6.2 / §22 — follow it when scaffolding so the first real commit starts clean.

## Directory Layout (actual, on disk)

```text
clinicOS/
├── AGENTS.md                 # Engineering constitution (binding rules, 1,698 lines)
├── DESIGN.md                 # Design system / UI authority (2,200 lines)
├── docs/
│   └── clinic-management-prd.md   # Product requirements + target data model
├── .planning/
│   └── codebase/             # Generated codebase-map docs (STACK, ARCHITECTURE,
│                             #   STRUCTURE, CONVENTIONS, TESTING, INTEGRATIONS, …)
├── .opencode/                # OpenCode/GSD agent tooling (skills, commands, hooks,
│                             #   plugins, gsd-core, node_modules) — NOT product code
└── .git/                     # Repository — 0 commits on main
```

**Absent (verified by full-tree scan):** `src/`, `app/`, `apps/`, `packages/`, `components/`, `features/`, `lib/`, `hooks/`, `migrations/`, `tests/`, `infra/`, `README.md`, `.env.example`, `docker-compose.yml`, `.github/`, any `*.ts`/`*.tsx`/`*.js` product file, any `package.json` outside `.opencode/`, any `tsconfig.json`/`next.config.*`/`eslint`/`prettier` config.

## Directory Purposes

**`docs/` (root):**
- Purpose: project documentation beyond the root authorities.
- Contains: `clinic-management-prd.md` — functional requirements (§4), non-functional requirements (§5), starting-point technical architecture (§6), key entity list (§7), open questions (§9), explicit out-of-scope (§10).
- This is the only subdirectory containing project content.

**`.planning/` (root):**
- Purpose: GSD planning artifacts produced by the project's workflow (roadmap, phases, codebase map).
- Generated: yes (by GSD skills/tools). Contains `.planning/codebase/*.md` analysis documents including this file.
- Committed: not yet — untracked until the first commit.

**`.opencode/` (root):**
- Purpose: OpenCode agent runtime configuration for this project — `opencode.json`, `skills/`, `commands/`, `agents/`, `hooks/`, `plugins/`, `gsd-core/`, `scripts/`, `node_modules/`.
- Generated: mostly (tooling install output); contains its own `package.json`.
- Committed: not yet. Treat as tooling, never as product code; do not import from it in application code.

**Root files:**
- `AGENTS.md` — binding engineering rules: stack (§5), architecture (§6), multi-tenancy (§7), testing (§27), security (§31), workflow (§47).
- `DESIGN.md` — binding UI/UX rules: tokens (§5–§9), app shell (§10), components (§12–§34), accessibility/responsive rules.

## Key File Locations

**Entry points:**
- Application entry point: **none exists yet.** When scaffolded per documented intent, the entry is the Next.js App Router root at `app/` (see `ARCHITECTURE.md`).

**Configuration:**
- `AGENTS.md` / `DESIGN.md`: the only authoritative configuration in the repo today (rules, not runtime config).
- Runtime/environment configuration (`.env.example`, `next.config.*`, `tsconfig.json`): **not present.**

**Core logic:**
- **None.** No domain, service, or persistence code exists. Target data model (Tenant, User, Patient, Appointment, Visit, Prescription, LabOrder/LabResult, Referral, ConsentRecord, AuditLog) is specified in `docs/clinic-management-prd.md` §7 as intent only.

**Testing:**
- **None.** No test files, no test runner config. Intended strategy is documented in `AGENTS.md` §27 (unit / API-integration / frontend / Playwright E2E) — see `.planning/codebase/TESTING.md`.

**Documentation:**
- `AGENTS.md`, `DESIGN.md`, `docs/clinic-management-prd.md`, and the generated `.planning/codebase/*.md`.

## Naming Conventions

Observed in the actual files on disk:

**Files:**
- Top-level authorities: `UPPERCASE.md` (`AGENTS.md`, `DESIGN.md`).
- Documents under `docs/`: `kebab-case.md` (`clinic-management-prd.md`).
- Planning outputs: `UPPERCASE.md` per artifact type (`ARCHITECTURE.md`, `STACK.md`, …).

**Directories:**
- All lowercase, kebab-case (`docs/`, `.planning/codebase/`).

**Code (functions, variables, types, components):**
- Not observable — no code exists. See `.planning/codebase/CONVENTIONS.md` for conventions that become binding once code lands (TypeScript strict, no `any`, etc., per `AGENTS.md` §29).

## Where to Add New Code

**Scaffold the application first.** Follow `AGENTS.md` §6.2's suggested structure (adapted to this repo — the repo has no existing code structure to preserve):

```text
/
├── AGENTS.md
├── DESIGN.md
├── README.md                  # canonical dev commands (AGENTS.md §48)
├── .env.example
├── app/  or  apps/web/src/app/   # Next.js App Router — pick one layout and commit to it
├── components/                # genuinely shared UI only
├── features/                  # feature-first organization
│   ├── patients/
│   ├── appointments/
│   ├── consultations/
│   ├── prescriptions/
│   └── billing/
├── hooks/                     # shared client hooks
├── lib/                       # typed utilities + data-access + supabase/
│   └── supabase/              # ALL Supabase client access lives here (AGENTS.md §5)
├── docs/
├── migrations/                # Supabase/Postgres migrations
└── tests/                     # or co-located tests per TESTING.md
```

`AGENTS.md` §6.2 explicitly says: "Adapt to the existing repository if it already has a strong structure" and "Do not reorganize an existing codebase solely to match this example." Today there is no structure to conflict with — so adopting §6.2 as-is (single Next.js app at repo root, since there is no monorepo yet) is the lowest-risk starting point.

**New feature (e.g., patients module):**
- UI: `features/patients/` (page components under `app/` route segments that delegate to feature code)
- Business rules + data access: `features/patients/` service module or `lib/` typed data-access — Supabase specifics confined to `lib/supabase/` (`AGENTS.md` §5, §22)
- API surface: Server Actions / Route Handlers co-located with the route or feature (`AGENTS.md` §5 "Backend")
- Migration: `migrations/` — schema + RLS policy + tenant-isolation test together (`AGENTS.md` §7, §38)
- Tests: see `.planning/codebase/TESTING.md` (patterns not yet established — no test files exist)

**New shared component:**
- Implementation: `components/` — only if genuinely reusable across ≥2 features (`AGENTS.md` §22); otherwise keep it inside `features/<domain>/`. Follow `DESIGN.md` component rules (§12–§34).

**Utilities:**
- Shared helpers: `lib/` (pure, typed, domain-free helpers) — never import Supabase SDK outside `lib/supabase/`.

**External integration (SMS, WhatsApp, payments, AI, storage):**
- One adapter module per provider under `lib/` (or `lib/integrations/`), exposing an internal interface; vendor SDK imports allowed only inside the adapter (`AGENTS.md` §41).

**What NOT to put in the product tree:**
- Do not place product code in `.opencode/` (tooling) or `.planning/` (planning artifacts).

## Special Directories

**`.planning/`:**
- Purpose: GSD planning + codebase-map artifacts.
- Generated: Yes (by GSD workflows).
- Committed: Not yet (untracked); decide as part of first commit — `gsd-pr-branch` tooling in `.opencode/skills/` filters `.planning/` out of PR branches, implying it is generally committed to the working branch but excluded from review PRs.

**`.opencode/`:**
- Purpose: OpenCode agent runtime, GSD skills/commands/hooks, `gsd-core` engine, its own `node_modules`.
- Generated: Partly (install output via `gsd-install-state.json`, `node_modules`).
- Committed: Not yet. Contains `node_modules/` — add a `.gitignore` before the first commit to exclude `.opencode/node_modules/`, `.DS_Store`, and `.env*` (no `.gitignore` exists today).

**`docs/`:**
- Purpose: durable project documentation (PRD today; architecture/product docs later).
- Generated: No.
- Committed: Yes (once the first commit lands).

---

*Structure analysis: 2026-10-06*
