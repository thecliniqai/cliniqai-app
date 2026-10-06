---
last_mapped_commit: f3441361462d6de5a1925d3d174bde9003273c39
last_mapped_at: 2026-10-06
---
# Coding Conventions

**Analysis Date:** 2026-10-06

> **Repo state:** This is a pre-code (documentation-only) repository. There is **no application source code on disk** — no `src/`, `app/`, `package.json`, `tsconfig.json`, linter/formatter config, or any `*.ts`/`*.tsx`/`*.js` product file. Git has zero commits (every file is untracked). Consequently, **no convention is embodied in code yet.** Conventions exist only as *documented intent* in `AGENTS.md` (engineering) and `DESIGN.md` (UI/visual). Each section below states **Current state** (what is on disk) first, then **Documented intent** (what `AGENTS.md`/`DESIGN.md` require once code exists). The only JavaScript present in the repo is vendored GSD workflow tooling under `.opencode/` (e.g. `.opencode/gsd-core/bin/lib/*.cjs`, `.opencode/hooks/*.js`) — that is tooling infrastructure, not product code, and must not be treated as a style reference for the application.

## Naming Patterns

**Current state:** No product source files exist, so no file/function/variable/type naming is embodied. The only observed naming artifacts are documentation files: `AGENTS.md` and `DESIGN.md` (uppercase), `docs/clinic-management-prd.md` (lowercase kebab-case).

**Files:**
- *Current state:* Not applicable — no source files yet.
- *Documented intent:* AGENTS.md §6.2 (`AGENTS.md` §6.2, "Suggested repository structure") shows lowercase directory names (`features/`, `apps/web/`, `packages/contracts/`) and a kebab-case example file style; `docs/clinic-management-prd.md` follows kebab-case. Prescriptive rule for new code: **use lowercase kebab-case for file and directory names** (`patients/patient-search.tsx`), PascalCase only for React component file names if the project adopts that split (`features/patients/PatientSearch.tsx`).
- *Gap:* Neither `AGENTS.md` nor `DESIGN.md` defines identifier casing (no mention of camelCase/PascalCase/snake_case anywhere — verified by grep). Until a rule is added to `AGENTS.md`, follow TypeScript/React ecosystem defaults: **camelCase for functions/variables/props, PascalCase for components/types, UPPER_SNAKE_CASE for constants.**

**Functions:**
- *Current state:* Not applicable — no source files.
- *Documented intent:* Prescriptive (from `AGENTS.md` §30 "Code Quality"): "small cohesive functions … clear names". No casing rule documented; use camelCase.

**Variables:**
- *Current state:* Not applicable.
- *Documented intent:* `AGENTS.md` §30 prohibits "magic constants" — name extracted values. No casing rule documented; use camelCase, UPPER_SNAKE_CASE for module-level constants.

**Types:**
- *Current state:* Not applicable.
- *Documented intent:* `AGENTS.md` §29 "Type Safety": TypeScript strict mode, "Prefer explicit types for API boundaries", "Avoid `any`", "Do not use type assertions to hide design problems". Backend (if a Python service is ever introduced per `AGENTS.md` §5 Backend): "typed Pydantic schemas". `AGENTS.md` §13: shared Zod schemas between frontend and backend where practical ("Use shared schemas/contracts where practical to reduce frontend/backend drift").

## Code Style

**Formatting:**
- *Current state:* **No formatter configured.** Not detected: `.prettierrc*`, `prettier.config.*`, `biome.json`, `.editorconfig`, `eslint.config.*`, `.eslintrc*` anywhere outside `.opencode/` (grep-verified across the repo root).
- *Documented intent:* `AGENTS.md` §28 "Verification Before Completion" mandates running "linting/formatting checks" before declaring a task complete — so a formatter/linter must be introduced when the first code lands. `AGENTS.md` does not prescribe which tool; stack context (§5: Next.js, TypeScript, Tailwind) makes Prettier + ESLint (or Biome) the natural picks, but that choice is currently **undecided**.

**Linting:**
- *Current state:* No linter configured; no CI (`.github/` absent) to enforce anything.
- *Documented intent:* `AGENTS.md` §28 requires lint checks; `AGENTS.md` §29 requires "type checking in CI" (backend) and TypeScript strict mode (frontend). `AGENTS.md` §31 forbids hard-coded secrets, `AGENTS.md` §30 forbids giant functions/deep nesting — these are the rules a future lint setup should encode.

**Styling (UI):** — this is the one area with a fully specified, non-negotiable convention set:
- *Current state:* No components exist, but `DESIGN.md` (2,200 lines) fully specifies the visual convention contract.
- *Documented intent (binding):*
  - `DESIGN.md` §2 "Non-Negotiable Rules": light theme only, no decorative gradients, one structural accent, cards are not the default container, no visual noise, progressive disclosure, one primary action per view.
  - `DESIGN.md` §5.1 "Core Tokens": all colors come from the token tree (`colors.brand.primary: #1769E0`, `colors.canvas.*`, `colors.surface.*`, `colors.border.*`, `colors.text.*`, `colors.semantic.*`). "`#1769E0` is the canonical product blue. Do not replace it with arbitrary Tailwind blues such as `blue-500`, `blue-600`, or `#2563EB`."
  - `DESIGN.md` §7: 4px-base spacing scale (`1: 4px … 16: 64px`); "Do not use random spacing values when a token exists."
  - `DESIGN.md` §8: radius scale (`none/xs/sm/md/lg/xl/pill`); pill reserved for status badges only.
  - `DESIGN.md` §41.3 "No Arbitrary Visual Values": never invent hex colors or radius/spacing values — use canonical tokens.
  - `DESIGN.md` §41.2 "Reuse Before Creating": check existing token/component before adding a color, radius, spacing value, button variant, card style, badge, input, or modal.
  - `AGENTS.md` §3: `DESIGN.md` wins for all UI/UX decisions; `AGENTS.md` wins for engineering; "Do not introduce a second spacing scale / typography scale"; Tailwind may be the styling engine but "design tokens and component styling must come from `DESIGN.md`".
  - `AGENTS.md` §29 + `DESIGN.md` §41.8: every reusable component must consider the state set `default/hover/focus/active/disabled/loading/error/empty`.

## Import Organization

**Order:**
- *Current state:* Not applicable — no modules exist; no import graph to observe.
- *Documented intent:* No import-ordering rule is documented in `AGENTS.md` or `DESIGN.md`. Once tooling lands, encode an ordering convention in ESLint/Prettier (e.g. external → internal aliases → relative). Structural rules that *are* documented:
  - `AGENTS.md` §5 (Supabase rules): "Keep Supabase access centralized in `lib/supabase/` and feature-level data-access/service modules" — components must not import Supabase clients directly.
  - `AGENTS.md` §5 (Frontend rules): "Prefer typed service/data-access functions over ad-hoc fetch logic scattered across components"; "Keep business logic out of presentation components."
  - `AGENTS.md` §41 "External Integrations": vendor SDKs (email/SMS/payment/storage/AI) must be wrapped behind internal adapters — never scatter vendor SDK calls through the app.
  - `AGENTS.md` §22: cross-feature imports go through the shared layer only when genuinely reusable ("A component should not become a shared component simply because it exists in two files").

**Path Aliases:**
- *Current state:* Not configured — no `tsconfig.json` exists (verified).
- *Documented intent:* `AGENTS.md` §6.2 suggests a `features/`, `components/`, `hooks/`, `lib/` layout under `apps/web/src/`, but explicitly says "Do not reorganize an existing codebase solely to match this example." No alias names (`@/…`) are specified anywhere.

## Error Handling

**Patterns:**
- *Current state:* No error-handling code exists.
- *Documented intent (`AGENTS.md` §12 "Error Handling" — the authoritative contract):*
  - **User-facing errors must tell the user:** what failed, whether anything was saved, what they can do next. Never expose stack traces, database errors, internal service names, or raw exception messages.
  - **Developer-facing errors:** structured logging with request/correlation ID, error type, route/action, tenant context when safe, actor context when safe, stack trace in server logs.
  - Never log: passwords, access tokens, session cookies, secrets, full payment credentials, unnecessary clinical content.
  - Validation errors: frontend validation "improves UX" but backend validation "is authoritative and must always exist for external input" (`AGENTS.md` §13). Client validation is never a security control.
  - API error shape: "consistent error structure" and "correct HTTP status codes" (`AGENTS.md` §11); "Never expose internal exception messages to users."
  - Multi-step state changes: "Transactions must be explicit" (`AGENTS.md` §5 Backend rules); "Use transactions around multi-entity state changes" (`AGENTS.md` §14).
  - Background jobs: "jobs must be retry-safe, side effects should be idempotent, retry policies must avoid infinite loops, failed jobs must be observable" (`AGENTS.md` §20, §42).
- **When implementing:** follow the two-audience split literally — a user-safe message + a structured server log with correlation ID, from the same catch site.

## Logging

**Framework:** Not detected — no logger dependency exists (no `package.json` at all).

**Patterns:**
- *Current state:* Nothing on disk. (The `.opencode/` tooling has its own observability module at `.opencode/gsd-core/bin/lib/observability/logger.cjs` with redaction support — that is GSD workflow logging, not the application's.)
- *Documented intent:*
  - `AGENTS.md` §12 (Developer-facing errors): structured logs carrying request/correlation ID, error type, route/action, tenant + actor context when safe.
  - `AGENTS.md` §33 "Logging & Observability": use structured logs, request/correlation IDs, health endpoints, metrics, error reporting, background job monitoring. Monitor at least: API errors, request latency, database failures, job failures, authentication failures, notification failures, payment failures, storage failures.
  - Prohibition: "Do not log sensitive patient content merely for debugging convenience" (`AGENTS.md` §33); "Never log clinical notes, passwords, tokens, or sensitive personal data unnecessarily" (`AGENTS.md` §9); no sensitive data in analytics events (`AGENTS.md` §9).

## Comments

**When to Comment:**
- *Current state:* Not applicable.
- *Documented intent:* `AGENTS.md` §30: prefer "comments explaining 'why', not obvious 'what'". `AGENTS.md` §30 also: no "speculative abstractions", no "copy/paste business logic".

**JSDoc/TSDoc:**
- *Current state:* No usage. *Documented intent:* Not specified in `AGENTS.md`/`DESIGN.md` — no TSDoc requirement exists. Public service/data-access boundaries should carry explicit types instead (per `AGENTS.md` §29).

## Function Design

**Size:** *Documented intent* (`AGENTS.md` §30): "small cohesive functions"; avoid "giant functions, giant components, deeply nested conditionals".

**Parameters:** *Documented intent* (`AGENTS.md` §30): "explicit dependencies". For forms: `AGENTS.md` §15 prefers fewer initially-visible fields and grouped related fields (a UX constraint that shapes form-handler signatures).

**Return Values:** *Documented intent:* `AGENTS.md` §11 — "Never return database models directly without a deliberate API schema"; `AGENTS.md` §19 — never infer `paid` solely from frontend state (financial states must be explicit enums). No generic result-type convention (e.g. Result/Either) is documented.

## Module Design

**Exports:** *Current state:* N/A. *Documented intent:* `AGENTS.md` §6.1 modular monolith — each module owns "domain models, business rules, API handlers, persistence access, validation, tests", and "Cross-module dependencies must be intentional."

**Barrel Files:** Not specified in any project document; no precedent on disk.

**Feature layout (prescriptive, from `AGENTS.md` §22):**

```text
features/
  patients/
  appointments/
  consultations/
  prescriptions/
  billing/
```

Shared components live in a shared layer "only when they are genuinely reusable" — presence in two files is not sufficient justification.

## Cross-Cutting Rules (binding once code exists)

**Instruction priority (`AGENTS.md` §2):** explicit task requirements → `AGENTS.md` (engineering) → `DESIGN.md` (UI/UX) → consistent existing conventions → framework defaults. On conflict: `DESIGN.md` wins for UI, `AGENTS.md` wins for engineering.

**Multi-tenancy (`AGENTS.md` §7):** never trust browser-supplied tenant IDs; derive tenant from authenticated identity; every tenant-scoped query applies isolation; cross-tenant access must be tested explicitly. "UI hiding is not authorization" (`AGENTS.md` §8).

**Validation (`AGENTS.md` §13):** validate at boundaries; backend is authoritative; shared Zod schemas where practical.

**State management (`AGENTS.md` §23) — priority order:**
1. local React state
2. URL state
3. TanStack Query server state
4. lightweight client store only when genuinely shared (Zustand for small shared client state, `AGENTS.md` §5)

"Do not copy server state into a global client store without a strong reason."

**Verification before completion (`AGENTS.md` §28):** run the smallest relevant tests, type checking, linting/formatting, affected frontend build, affected API tests, migration checks if schema changed, diff review, secret scan, and `DESIGN.md` compliance for UI changes.

**Known convention gaps (not defined anywhere in `AGENTS.md`/`DESIGN.md`):**
- Identifier casing rules (camelCase/PascalCase)
- Import ordering and path aliases
- Formatter/linter selection and configuration
- Test file location and naming (see `TESTING.md`)
- Commit message format (`AGENTS.md` §37 requires only "focused, understandable, reversible" commits)

---

*Convention analysis: 2026-10-06*
