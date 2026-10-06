# Testing Patterns

**Analysis Date:** 2026-10-06

> **Repo state:** **No tests exist.** Verified on 2026-10-06: zero `*.test.*` / `*.spec.*` files outside vendored `.opencode/` tooling, no `package.json` (so no test script), no `jest.config.*` / `vitest.config.*` / `playwright.config.*`, no test runner dependency, no CI (`.github/` absent), no coverage config. Git has zero commits. Everything below under **Documented intent** is the testing contract from `AGENTS.md` §27 (Testing Strategy) and related sections — it is not yet embodied anywhere in the codebase. The `.opencode/gsd-core/` directory contains GSD *workflow* gates (e.g. `.opencode/gsd-core/bin/lib/gate-tdd-red-evidence.cjs`, `.opencode/gsd-core/references/tdd.md`) that enforce planning-phase TDD discipline — those are orchestration tooling, not the application test suite.

## Test Framework

**Runner:**
- *Current state:* **None detected.** No runner installed or configured — no `package.json`, no `jest.config.*`, `vitest.config.*`, `playwright.config.*` anywhere outside `.opencode/`.
- *Documented intent:* `AGENTS.md` §27 names **Playwright** for end-to-end tests ("Use Playwright or the project's established equivalent"). No unit/integration runner is named anywhere in `AGENTS.md` or `DESIGN.md` — Vitest (natural for a Next.js/TS stack per `AGENTS.md` §5) is a reasonable default but the choice is **undecided**. Backend/DB tests: `AGENTS.md` §5 ("No local SQLite requirement") requires "isolated Supabase/Postgres test environments or mocks/fakes at the repository boundary rather than introducing a second production-like database technology."

**Assertion Library:**
- *Current state:* None.
- *Documented intent:* Not specified. Whatever runner is chosen, its native assertions are implied.

**Run Commands (documented, not yet real):**
```bash
npm run test          # AGENTS.md §48 — does NOT exist yet (no package.json)
npm run typecheck     # AGENTS.md §28 — does NOT exist yet
npm run lint          # AGENTS.md §28 — does NOT exist yet
npx playwright test   # AGENTS.md §27/§48 — no playwright.config.* on disk
```
`AGENTS.md` §48 explicitly warns: "Do not assume every command exists. Inspect `package.json` … before running or documenting commands." Today, inspection finds no `package.json` at all.

## Test File Organization

**Location:**
- *Current state:* No test files exist.
- *Documented intent:* No rule fixes test placement. `AGENTS.md` §6.2's *example* structure shows an `apps/web/tests/` directory, but the same section says "Do not reorganize an existing codebase solely to match this example" — so `tests/` is an illustration, not a mandate. `AGENTS.md` §6.1 requires each module to own its "tests", implying module/feature-adjacent tests. **Decision pending** when the first code lands; prefer co-located tests next to the feature module (e.g. `features/prescriptions/prescription-status.test.ts`) unless the project adopts `AGENTS.md` §6.2's `tests/` layout.

**Naming:**
- *Current state:* No precedent. *Documented intent:* Not specified — no `*.test.*` vs `*.spec.*` rule exists in `AGENTS.md`/`DESIGN.md`.

**Structure:**
- *Current state:* Not applicable — no directory structure exists beyond `AGENTS.md`, `DESIGN.md`, `docs/clinic-management-prd.md`, `.opencode/` (tooling), `.planning/` (GSD state).

## Test Structure

**Suite Organization:**
- *Current state:* No test code exists — no `describe`/`it`/`test` blocks to observe.
- *Documented intent:* Organize suites by the test types in `AGENTS.md` §27 (unit / API-integration / frontend / E2E) and by workflow, matching the critical journeys `AGENTS.md` §27 lists for E2E: login, patient creation, patient search, appointment booking, appointment status transition, consultation completion, prescription issue, invoice/payment flow, role restrictions, tenant isolation.

**Patterns:**
- *Setup/Teardown:* Not documented. Database rule that constrains setup: tests must run against "isolated Supabase/Postgres test environments" — no SQLite (`AGENTS.md` §5, "No local SQLite requirement").
- *Assertion pattern:* Not documented.

## Mocking

**Framework:** None — no mock library configured or named.

**Patterns:**
- *Current state:* No mocking code exists.
- *Documented intent (`AGENTS.md` §5):* "**mocks/fakes at the repository boundary**" — mock the data-access/repository layer, not deep internal modules. Provider vendors (email/SMS/payment/AI) are wrapped behind adapters (`AGENTS.md` §41), so tests mock those adapters, never real vendor APIs.
- *What to mock:* repository/data-access boundary; external vendor adapters (SMS/WhatsApp gateway, payment gateway, AI provider, storage); network-level Supabase calls in unit/frontend tests.
- *What NOT to mock:* business rules under test, permission/role logic, validation logic, status-transition tables — `AGENTS.md` §27 explicitly puts these under unit tests as real code.

## Fixtures and Factories

**Test Data:**
- *Current state:* No fixtures, factories, or seed scripts exist.
- *Documented intent:* `AGENTS.md` §27 lists "business rules, calculations, validation, permission logic, status transitions" as unit-test subjects — fixtures should be small typed objects for these. Financial states must be explicit enums (`AGENTS.md` §19: draft/issued/unpaid/partially paid/paid/refunded/cancelled/failed), so fixtures should construct those states directly rather than deriving them. Tenant fixtures are mandatory: every isolation test needs at least two tenants' worth of data (`AGENTS.md` §7).

**Location:** Not specified anywhere.

## Coverage

**Requirements:** **None enforced** — no coverage tool, threshold, or target exists on disk or in `AGENTS.md`/`DESIGN.md`. No coverage percentage is documented as a goal.

**View Coverage:**
```bash
npm run test          # does not exist yet — no runner configured
```

## Test Types

**Unit Tests (`AGENTS.md` §27):**
- Scope: business rules, calculations, validation, permission logic, status transitions, utility functions.
- Approach: pure, fast, no database; real implementations of domain logic (mock only the repository boundary).

**API/Integration Tests (`AGENTS.md` §27):**
- Scope: authorization, tenant isolation, database behaviour, important workflows, idempotency, error cases.
- Environment: isolated Supabase/Postgres — explicitly **not** SQLite (`AGENTS.md` §5).
- Cross-tenant access must be tested explicitly (`AGENTS.md` §7): "Test cross-tenant access explicitly" — cover IDs, search, filtering, autocomplete, exports, reports, file URLs, background jobs as leak vectors.

**Frontend Tests (`AGENTS.md` §27):**
- Scope: critical form behaviour, important state transitions, accessibility-sensitive interactions, important component logic.
- `DESIGN.md` §42/§43 (Component/Page Acceptance Criteria) supply the concrete behavioral checklist per component: state set (`default/hover/focus/active/disabled/loading/error/empty`, `DESIGN.md` §41.8), keyboard navigation, visible focus, status never conveyed by color alone.

**E2E Tests:**
- *Current state:* None; no `playwright.config.*`.
- *Documented intent:* Playwright for the nine critical journeys listed in `AGENTS.md` §27 (login → patient creation → patient search → appointment booking → appointment status transition → consultation completion → prescription issue → invoice/payment flow → role restrictions → tenant isolation). Constraint: "Do not write brittle screenshot-only tests as the primary safety mechanism."

## Common Patterns

**Async Testing:**
- *Current state:* No async test code exists. *Documented intent:* N/A — no async testing convention documented.

**Error Testing:**
- *Current state:* None.
- *Documented intent:* `AGENTS.md` §27 puts "error cases" in the API/integration tier; `AGENTS.md` §13 requires proving backend validation is authoritative (i.e. tests must bypass client validation); `AGENTS.md` §11 requires asserting the "consistent error structure" and correct HTTP status codes; user-facing error messages must never leak stack traces/DB errors (`AGENTS.md` §12) — an assertion worth encoding once API routes exist.

**Verification loop (`AGENTS.md` §28) — applies to every task:**
1. Run the smallest relevant tests first.
2. Run type checking.
3. Run linting/formatting checks.
4. Run the affected frontend build if UI changed; affected API tests if backend changed.
5. Check migrations if schema changed.
6. Review the diff; verify no secrets; verify UI against `DESIGN.md`.
7. "For larger changes, run the full CI-equivalent suite before declaring completion."

## Coverage Gaps

- **Everything** — the product test suite is at 0% because no source code or tests exist. This is expected for a pre-code repo, not a defect.
- **No CI:** `.github/` is absent, so even once tests exist nothing enforces them (`AGENTS.md` §27/§28 assume a "CI-equivalent suite").
- **No test tooling decision recorded:** runner (Vitest/Jest), test file location, and coverage target are all undefined in `AGENTS.md` — decide these in the first setup phase before feature code accumulates.

---

*Testing analysis: 2026-10-06*
