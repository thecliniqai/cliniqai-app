# P1-34 boundary lint fixtures (V2-03 03-04)

Bypass fixtures for the boundary gates in `eslint.config.mjs` (ADR-0005 D2/D4 + A1, C50 a/d/e; P1-21, P1-25, P1-15).
`lint-fixtures/**` is ignored by `npx eslint .`; `tests/security/p1-34-lint-gates.spec.ts` lints each file as text at
the virtual repository paths below, so the real `files:` globs decide, and asserts the rule id, line and backlog
prefix of every boundary message. Since 03-13c it lints with inline configuration **off** (as the census does), so a
directive cannot hide a gate; `inline-disable.ts` is also linted with it on, where `clinicos/no-boundary-directive`
fails the directive itself. `scripts/ci/p1-34-counters.mjs` (the `static-checks.json` counters) is also run
over this directory by the spec.

Rule ids: **imports** = `@typescript-eslint/no-restricted-imports`; **syntax** = `no-restricted-syntax`;
**directive** = `clinicos/no-boundary-directive` (03-13c).

| Fixture | Fails lint at (rule, prefix) | Passes at |
|---|---|---|
| `action-factory-import.ts` | `features/patients/actions.ts` (imports, P1-34) | |
| `page-factory-import.tsx` | `app/(dashboard)/fixture/page.tsx` (imports, P1-34) | |
| `factory-import.ts` | `features/patients/service.ts`, `app/api/r/[token]/route.ts`, `lib/supabase/server.ts`, `lib/jobs/x.ts` (03-13c: the enqueue surface is not the allow-list), `lib/jobs/enqueue.ts`, `lib/jobs/auth.ts` (04-02) (imports, P1-34) | `app/api/webhooks/x/route.ts`, `app/api/jobs/run/route.ts`, `lib/jobs/internal/runner.ts`, `features/x/system.ts`; register: `app/api/v1/x/route.ts`, `lib/api/x.ts`, `app/api/cron/x/route.ts`, `lib/messaging/dispatcher.ts`, `lib/webhooks/x.ts`; `tests/fixture/x.spec.ts` |
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
| `jobs-internal-import.ts` (04-02: imports the real `runJobs`) | `features/patients/actions.ts`, `app/api/v1/x/route.ts`, `lib/jobs/enqueue.ts` (imports, P1-34) | `app/api/jobs/run/route.ts`, `lib/jobs/internal/registry.ts` |
| `jobs-internal-relative.ts` | `lib/jobs/enqueue.ts` (imports, P1-34) | |
| (no fixture, 04-02) the real `app/api/jobs/run/route.ts` source | `features/patients/actions.ts`, `lib/jobs/enqueue.ts` (3 imports), `app/api/v1/x/route.ts` (2 imports: the internals) | where it lives, with `lib/jobs/internal/{registry,handlers/drill}.ts` and `lib/jobs/auth.ts` |
| `process-env.ts` | `features/patients/service.ts`, `lib/supabase/system.ts` (syntax, P1-15, 4 lines) | `lib/env.ts`, `lib/env-server.ts`, `next.config.ts`, `instrumentation.ts`, `lib/log/client.ts`, `tests/fixture/x.spec.ts` |
| `console.ts` | `features/billing/service.ts`, `lib/log/index.ts`, `lib/env.ts` (syntax, P1-25, 3 lines) | `lib/log/client.ts`, `scripts/fixture.ts` |
| `raw-stream.ts` (03-13, High re-verify Low) | `features/billing/service.ts`, `app/api/x/route.ts`, `lib/env.ts`, `instrumentation.ts` (`process.stdout`/`process.stderr` by member, computed, `globalThis`, destructured, `node:process` import and `require`; syntax, P1-25, 6 lines) | `lib/log/index.ts`, `lib/log/client.ts`, `lib/observability/console-scrub.ts`, `scripts/fixture.ts` |
| `client-server-logger.tsx` | `components/fixture/widget.tsx` (syntax, P1-25, 2 lines) | |
| `client-reporter.tsx` | | `components/fixture/widget.tsx` |
| `utc-date-patterns.ts` | `features/visits/service.ts`, `lib/log/client.ts` (syntax, P1-21, 7 lines) | `lib/datetime/x.ts` |
| `supabase-client-class.ts` (03-13c) | `features/patients/service.ts`, `lib/supabase/system.ts` (`new SupabaseClient`; imports, P1-34) | `tests/fixture/x.spec.ts` |
| `gotrue-admin.ts` (03-13c) | `features/patients/service.ts`, `lib/supabase/system.ts`, `lib/supabase/server.ts` (`GoTrueAdminApi`, `@supabase/auth-js`; imports, P1-34, 2 lines) | |
| `postgrest-client.ts` (03-13c) | `features/patients/service.ts`, `lib/supabase/system.ts` (`@supabase/postgrest-js`; imports, P1-34) | |
| `supabase-subpath.ts` (03-13c) | `features/auth/service.ts`, `lib/supabase/server.ts`, `lib/supabase/system.ts` (`@supabase/ssr/dist/…`, `@supabase/supabase-js/dist/…`; imports, P1-34, 2 lines) | |
| `require-forms.ts` (03-13c) | `features/patients/service.ts`, `lib/jobs/internal/runner.ts` (aliased `require`, `module.require`, computed `require()`, `createRequire`; syntax, P1-34, 7 messages) | `scripts/fixture.ts` |
| `computed-secret-key.ts` (03-13c) | `features/settings/service.ts` (secret-key name from pieces, computed / destructured / spread / enumerated `serverEnv()` reads; syntax, P1-34, 11 messages) | `lib/env.ts`, `lib/env-server.ts` |
| `inline-disable.ts` (03-13c) | `features/patients/service.ts` (directive lines 1, 3, 4 + the hidden factory import, line 2) | `tests/fixture/x.spec.ts` |
| `tooling-import.ts` (03-13c) | `features/patients/service.ts`, `lib/webhooks/x.ts` (imports of `lint-fixtures/`, `scripts/`, `tests/`, `docs/`; imports, P1-34, 4 lines) | `tests/fixture/x.spec.ts` |
| `base-gates.ts` | AUTH-01 + P0-13 at every zone path, tooling included (self-test: zones keep the base list) | |

The five ADR-0005 A1 routes: `app/api/r/[token]/route.ts`, `app/r/[token]/page.tsx`, `app/api/reports/view/route.ts`,
`app/reports/view/page.tsx`, `app/api/reschedule/[token]/route.ts`.

Four fixtures start with `// @ts-nocheck` because they import modules that do not resolve at their real location
(relative paths that resolve only at their virtual path: `jobs-internal-relative.ts`, `relative-system-import.ts`; the
laundering probes of `tooling-import.ts`; untyped package subpaths in `supabase-subpath.ts`); `npm run typecheck`
covers `lint-fixtures/`. Since 04-02 `jobs-internal-import.ts` imports the real `lib/jobs/internal/runner` and is
typechecked.
