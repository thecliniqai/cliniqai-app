# P1-34 boundary lint fixtures (V2-03 03-04)

Bypass fixtures for the boundary gates in `eslint.config.mjs` (ADR-0005 D2/D4 + A1, C50 a/d/e; P1-21, P1-25, P1-15).
`lint-fixtures/**` is ignored by `npx eslint .`; `tests/security/p1-34-lint-gates.spec.ts` lints each file as text at
the virtual repository paths below, so the real `files:` globs decide, and asserts the rule id, line and backlog
prefix of every boundary message. `scripts/ci/p1-34-counters.mjs` (the `static-checks.json` counters) is also run
over this directory by the spec.

Rule ids: **imports** = `@typescript-eslint/no-restricted-imports`; **syntax** = `no-restricted-syntax`.

| Fixture | Fails lint at (rule, prefix) | Passes at |
|---|---|---|
| `action-factory-import.ts` | `features/patients/actions.ts` (imports, P1-34) | |
| `page-factory-import.tsx` | `app/(dashboard)/fixture/page.tsx` (imports, P1-34) | |
| `factory-import.ts` | `features/patients/service.ts`, `app/api/r/[token]/route.ts`, `lib/supabase/server.ts` (imports, P1-34) | `app/api/webhooks/x/route.ts`, `app/api/jobs/run/route.ts`, `lib/jobs/x.ts`, `lib/jobs/internal/runner.ts`, `features/x/system.ts`; register: `app/api/v1/x/route.ts`, `lib/api/x.ts`, `app/api/cron/x/route.ts`, `lib/messaging/dispatcher.ts`, `lib/webhooks/x.ts`; `tests/fixture/x.spec.ts` |
| `traversal-factory-import.ts` | `features/patients/service.ts` (imports, P1-34) | |
| `reexport-factory.ts` | `lib/db/system-reexport.ts` (imports, P1-34) | |
| `sharing-system-import.ts` | `features/patients/service.ts`, `app/api/patients/route.ts`, `app/(dashboard)/patients/page.tsx` (imports, P1-34) | the 5 ADR-0005 A1 routes |
| `other-feature-system-import.ts` | `app/api/reports/view/route.ts` (A1 route, other domain; imports, P1-34) | `features/sharing/system.ts`, `app/api/webhooks/messaging/x/route.ts` |
| `relative-system-import.ts` | `features/billing/actions.ts` (imports, P1-34) | |
| `dynamic-import-factory.ts` | `features/patients/service.ts`, `app/api/webhooks/x/route.ts` (syntax, P1-34) | nowhere |
| `require-factory.ts` | `features/patients/service.ts`, `features/x/system.ts` (syntax, P1-34) | nowhere |
| `computed-import.ts` | `features/patients/service.ts` (syntax, P1-34) | |
| `dynamic-import-supabase-js.ts` | `features/patients/service.ts` (syntax, P1-34) | |
| `second-factory.ts` | `features/reports/service.ts` (imports line 2 + syntax line 6, P1-34) | `lib/supabase/system.ts`, `scripts/fixture.ts` |
| `namespace-supabase-js.ts` | `features/patients/service.ts` (imports, P1-34) | |
| `ssr-client-import.ts` | `features/auth/service.ts` (imports, P1-34) | `lib/supabase/server.ts`, `lib/supabase/client.ts`, `proxy.ts` |
| `type-imports.ts` | | `features/patients/service.ts` (type imports allowed) |
| `secret-key-names.ts` | `features/settings/service.ts` (syntax, P1-34, 2 lines) | `lib/env.ts`, `lib/env-server.ts` |
| `jobs-internal-import.ts` | `features/patients/actions.ts`, `app/api/v1/x/route.ts`, `lib/jobs/enqueue.ts` (imports, P1-34) | `app/api/jobs/run/route.ts`, `lib/jobs/internal/registry.ts` |
| `jobs-internal-relative.ts` | `lib/jobs/enqueue.ts` (imports, P1-34) | |
| `process-env.ts` | `features/patients/service.ts`, `lib/supabase/system.ts` (syntax, P1-15, 4 lines) | `lib/env.ts`, `lib/env-server.ts`, `next.config.ts`, `instrumentation.ts`, `lib/log/client.ts`, `tests/fixture/x.spec.ts` |
| `console.ts` | `features/billing/service.ts`, `lib/log/index.ts`, `lib/env.ts` (syntax, P1-25, 3 lines) | `lib/log/client.ts`, `scripts/fixture.ts` |
| `client-server-logger.tsx` | `components/fixture/widget.tsx` (syntax, P1-25, 2 lines) | |
| `client-reporter.tsx` | | `components/fixture/widget.tsx` |
| `utc-date-patterns.ts` | `features/visits/service.ts`, `lib/log/client.ts` (syntax, P1-21, 7 lines) | `lib/datetime/x.ts` |
| `base-gates.ts` | AUTH-01 + P0-13 at every zone path, tooling included (self-test: zones keep the base list) | |

The five ADR-0005 A1 routes: `app/api/r/[token]/route.ts`, `app/r/[token]/page.tsx`, `app/api/reports/view/route.ts`,
`app/reports/view/page.tsx`, `app/api/reschedule/[token]/route.ts`.

Three fixtures start with `// @ts-nocheck` because they import modules that do not exist at their real location
(`lib/jobs` lands in V2-04); `npm run typecheck` covers `lint-fixtures/`.
