# Technology Stack

**Analysis Date:** 2026-10-06

> **Current state: pre-scaffold.** This repository contains no application code yet. There is no root `package.json`, no `tsconfig.json`, no lockfile, no `src/`, `app/`, or `components/` directory, no CI config, no Docker files, and no `.env.example`. The git repository exists but `main` has zero commits (all files are untracked). Everything below is split into **what exists on disk today** and **documented intent** (the intended stack defined in `AGENTS.md`, `DESIGN.md`, and `docs/clinic-management-prd.md` — treat as specification, not current state).

## Languages

**Primary (application):**
- Not detected — no application source files (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.sql`, `.css`, `.html`) exist anywhere outside `.opencode/`.

**Tooling (agent/dev infrastructure, exists on disk):**
- JavaScript (Node) - GSD/OpenCode lifecycle hooks and guards, e.g. `.opencode/hooks/gsd-write-guard.js`, `.opencode/hooks/gsd-secret-read-guard.js`, `.opencode/hooks/gsd-statusline.js`
- Shell (bash/zsh) - hook runners and wrappers, e.g. `.opencode/hooks/gsd-node-runner.sh`, `.opencode/hooks/gsd-phase-boundary.sh`
- Markdown - all product/engineering documentation: `AGENTS.md` (1,698 lines), `DESIGN.md` (2,200 lines), `docs/clinic-management-prd.md` (247 lines)

**Documented intent:**
- TypeScript strict mode for all frontend/backend code — `AGENTS.md` §5, §29 (no TypeScript config exists yet)

## Runtime

**Environment (application):**
- Not defined — no application runtime configuration on disk (no `package.json`, `.nvmrc`, `.node-version`, `Dockerfile`, or deploy manifest).

**Environment (tooling only):**
- Node.js - required by the OpenCode/GSD tooling; transitive dependencies declare `engines.node >= 18` (see `node_modules/@ai-sdk/provider` entry in `.opencode/package-lock.json`)
- Observed dev machine: macOS (darwin), Git available

**Package Manager:**
- npm - only for tooling; lockfile `lockfileVersion: 3` at `.opencode/package-lock.json`
- Application package manager: Not selected

**Lockfile:**
- Root application lockfile: missing
- Tooling lockfile: present (`.opencode/package-lock.json`)

## Frameworks

**Core (application):**
- None installed or configured.

**Documented intent (application):**
- Next.js latest stable, App Router, Turbopack where supported - `AGENTS.md` §5 ("Frontend")
- React latest compatible with the chosen Next.js release - `AGENTS.md` §5
- TanStack Query (server state), Zustand (small shared client state), React Hook Form (complex forms), Zod (validation/schemas) - `AGENTS.md` §5
- Tailwind CSS as styling engine with tokens defined in `DESIGN.md` (light-only, Inter, canonical blue `#1769E0`; explicit ban on arbitrary Tailwind palette values in `DESIGN.md` §5.1) - `DESIGN.md` §5.1, §41
- Radix UI primitives (accessible interactions), Lucide icon set - `AGENTS.md` §5, `DESIGN.md` §1682 ("Lucide-style outline icons")
- Backend: Next.js server primitives only (Server Components, Server Actions, Route Handlers) — no separate API service — `AGENTS.md` §5 ("Backend")

**Testing:**
- None configured (no `jest.config.*`, `vitest.config.*`, `playwright.config.*`, or test files anywhere in the repo).

**Documented intent (testing):**
- Playwright or established equivalent for E2E critical journeys - `AGENTS.md` §27
- Unit/integration/frontend test framework: not yet chosen in `AGENTS.md` §27

**Build/Dev:**
- None configured (no bundler, linter, or formatter config files exist: no `eslint.config.*`, `.prettierrc*`, `biome.json`, `next.config.*`).

## Key Dependencies

**Critical (application):**
- None — zero application dependencies declared.

**Infrastructure (tooling, exists on disk):**
- `@opencode-ai/plugin` `1.18.23` - OpenCode plugin API, declared in `.opencode/package.json`
- `@opengsd/gsd-core` (fetched ad-hoc via `npx -y -p`) - GSD MCP server launched by `.opencode/opencode.json` (`mcp.gsd.command`)
- GSD skill/agent/hook suite - vendored under `.opencode/skills/`, `.opencode/agents/`, `.opencode/hooks/` (not published packages)

**Documented intent (application, none installed):**
- `@supabase/ssr` + Supabase client libraries - `AGENTS.md` §5 ("Database & Backend Platform")
- Provider SDKs must stay behind adapters (`AGENTS.md` §41): WhatsApp/SMS, AI, storage, payments — PRD §6

## Configuration

**Environment:**
- No `.env`, `.env.*`, or `.env.example` files exist at the repo root.
- `AGENTS.md` §32 requires committing `.env.example` and never committing `.env` with secrets — this file does not exist yet and should be created at scaffold time.
- Documented intent for config storage: Vercel environment variables for the application layer (`AGENTS.md` §5 "Infrastructure").

**Build:**
- No build configuration files exist (`next.config.*`, `tsconfig.json`, bundler configs — all absent).

**Tooling config (exists on disk):**
- `.opencode/opencode.json` - OpenCode config: file permissions for `.opencode/gsd-core/*`, MCP server registration (`gsd` → `npx -y -p @opengsd/gsd-core gsd-mcp-server`)
- `.opencode/settings.json` - empty object `{}`
- `.opencode/gsd-install-state.json`, `.opencode/gsd-file-manifest.json` - GSD install bookkeeping

**Design specification (not code config):**
- `DESIGN.md` frontmatter: `version: 1.0`, `status: canonical`, `theme: light-only`, `font: Inter` — the single source of truth for all visual tokens/components (`AGENTS.md` §3).

## Platform Requirements

**Development:**
- macOS observed; Git required (repo initialized, no commits yet on `main`)
- Node.js ≥ 18 for `.opencode/` tooling only
- No application dev-server command exists (no scripts anywhere)

**Production:**
- Not deployed — no CI/CD pipeline (`.github/` absent), no `Dockerfile`, no hosting config.
- Documented intent: Vercel (app) + Supabase (Postgres/Auth/Storage/RLS) + GitHub-based CI/CD, HTTPS everywhere — `AGENTS.md` §5 "Infrastructure"; `docs/clinic-management-prd.md` §6.

## Documented Intent (reference, not current state)

The authoritative intended stack lives in:
- `AGENTS.md` §5 (Technology Stack), §6 (Architecture — modular monolith, `apps/` + `packages/` layout suggested but explicitly "Adapt to the existing repository… Do not reorganize an existing codebase solely to match this example")
- `docs/clinic-management-prd.md` §6 (Technical Architecture starting point: responsive web, Supabase, Vercel, pluggable WhatsApp/SMS providers, LLM API)
- `DESIGN.md` (design tokens/components; Tailwind values must derive from it)

Scaffold order implied by the docs: Next.js App Router + TypeScript strict + Tailwind/`DESIGN.md` tokens + `@supabase/ssr` auth → then feature modules (`AGENTS.md` §22 `features/` layout).

---

*Stack analysis: 2026-10-06*
