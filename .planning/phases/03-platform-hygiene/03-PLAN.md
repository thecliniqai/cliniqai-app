---
phase: 03
roadmap_id: V2-03
name: Platform hygiene
gate: G3-partial
requirements: [P1-15, I-07, P1-21, P1-34, P1-35a, P1-25, P1-43, P2-01, P2-03, C18-D1, AUTH-02, AUTH-03, AUTH-04b, FT-01, FT-05, FT-07, AUTH-00-recheck, OA-5, AI-06-L1]
plans: [03-06, 03-09a, 03-03, 03-01, 03-10, 03-02, 03-11a, 03-09c, 03-05, 03-07, 03-09b, 03-04, 03-11b, 03-08, 03-12a, 03-12b, 03-12c]
waves: {1: [03-06], 2: [03-09a, 03-03], 3: [03-01, 03-10], 4: [03-02], 5: [03-09c, 03-11a], 6: [03-05, 03-07], 7: [03-09b, 03-04], 8: [03-11b, 03-08], 9: [03-12a], 10: [03-12b, 03-12c]}
source: docs/v2/V2_MASTER_ROADMAP.md §12.2 (V2-03), §10.1-10.3; docs/adr/0005-confine-service-role-client.md; docs/v2/AUTH_REDESIGN.md §3-§9; docs/v2/TARGET_ARCHITECTURE.md §3.8, §6, §7.1; docs/v2/BACKEND_MIGRATION_PLAN.md B1-B8, D1, H1-H2; docs/v2/ARCHITECTURE_DECISIONS.md ADR-016; .planning/phases/01A-local-db-harness/01A-04-AUTH00-SPIKE.md
research: 03-RESEARCH.md
base_commit: e66edf9 (feature/v2 after PR #4)
branch: v2/phase-03-platform-hygiene -> feature/v2 (one PR for the phase)
po_direction: PO unavailable. Nothing external blocks. Every external piece ships behind an interface with a local/offline implementation and a flag that defaults off; production is fail-closed; hosted verification is a PO action marked "pending PO".
---

# Phase 03 (V2-03): Platform hygiene — plan

**Objective (roadmap):** reproducible schema, honest configuration, typed data, diagnosable failures, and a staging
environment.

**Acceptance (roadmap, verbatim):** production boot fails without real providers; ESLint finds 1 service-role factory
(`lib/supabase/system.ts`) and 0 service-role imports outside the allow-list and the ADR-0005 exception register
(`app/api/v1/**` + `lib/api/**` until P1-37; `lib/messaging/dispatcher.ts`, `lib/webhooks/**`, `app/api/cron/**` until
V2-04), and the bypass fixtures fail lint (erratum 2026-11-10, C50); a fresh `db reset` matches the target schema
(drift = 0 or documented); `tsc` passes with generated types; 0 UTC "today" sites; the spike report shows RLS,
`auth.uid()` actor, audit and outbox in one transaction; staging deploys from CI; a thrown server error appears in the
India-resident error sink with PII scrubbed; staging sends a **password-reset** code through SES with DKIM passing;
Turnstile is on sign-in and reset (signup does not exist until V2-13b); `POST /auth/signout` clears the session
server-side and returns `Clear-Site-Data: "cache"`; the auth config drift check is green; a password from the Pwned
Passwords corpus is rejected by the change-password and reset actions (FT-05); staging functions run in `bom1`, or the
deviation is recorded (FT-01).
**Tests (roadmap):** unit; IST boundary tests at 00:00–05:30; the env-schema boot test; the spike RPC's DB integration
test incl. rollback on fault; a scrubber test; FT-05 unit tests with a mocked range API (hit, miss, API down).
**Evidence (roadmap):** CI links; the drift report (read-only against the hosted project); the spike report; a staging
deploy link; an `ops.error_events` row export with scrubbed fields.

**Carry-overs planned into this phase:** OA-5 → 03-12b; AI-06 L1 env-schema checks → 03-01 (+ L1-R3 widening in
03-10); the 2 `VITEST`/`NODE_ENV` branches in `lib/webhooks` incl. the SSRF DNS skip → 03-10; AUTH-02 → 03-11a;
AUTH-04b → 03-12a/b/c; A00-1…A00-5 → rulings table + 03-11a/03-11b/03-12a/03-12c; K-2 → 03-06; K-6 → 03-01;
RL-13b `TestDb` seam → 03-03; ADR-0005 R15 referral names + storage fallback → 03-02; C-3 env name → 03-01; F20 audit
waiver → 03-06.

**Invariants for the whole phase**
- No product behaviour changes beyond the items in this plan. Anything else stops and is raised.
- No call of any kind to a hosted Supabase project, Vercel, AWS, Cloudflare or GitHub settings from an implementer
  session. Hosted steps are PO actions (§"PO actions for this phase") or PO-approved Environment workflows that agents
  never dispatch (R-9).
- Every external integration has a local implementation (Mailpit, Cloudflare Turnstile **test** keys, Postgres error
  sink, loopback fake Pwned range API, `disabled` providers). Flags default **off** locally; staging/production rules
  in the env schema are fail-closed (R-17).
- Migrations are additive and pre-numbered (R-4): `000025_readiness_probe` (03-01), `000026_referral_source_clinics`
  (03-02), `000027_record_payment_rpc` (03-07), `000028_ops_error_events` (03-09b). After each, `npm run db:types`
  regenerates `types/database.ts` (script added by 03-03) in the same commit.
- Synthetic data only. No PHI or secret in fixtures, logs, commits or evidence.

## Execution protocol (changed from V2-02)

- Implementer agents **may** run `npx vitest`, `npm run test:db`, `npm run e2e:build`, `npm run e2e:pr`,
  `npx supabase start|stop|db reset --local|db diff --local|gen types --local`, `npm run seed:local`. There is no
  READY FOR TESTS loop.
- Implementers **must not**: `git push`, open/retarget PRs, change GitHub/Vercel/Supabase-hosted/AWS/Cloudflare
  settings, dispatch `staging.yml`/`drift.yml`, run any CLI command with `--linked` or `db push`, run `seed:cdci*`,
  `seed:diagnoses`, `msg91:*`, anything with `--env-file=.env`, `scripts/seed-staging.ts`,
  `scripts/staging/*`, or `scripts/drift/auth-config-hosted.mjs` with a real token. Never open or print `.env*`
  (including `.env.example`: 03-01 regenerates it from the schema without reading it). Delete
  `.planning/dev-messages.txt` if a run recreates it. The checkout is still linked to the v1 hosted project, so every
  Supabase CLI call passes `--local` (or `--db-url` with a loopback URL).
- **Shared local stack.** Parallel implementers in a wave share one stack. The test-run lock fails fast: on "Could not
  acquire the test-run lock", wait and retry; never delete a lock held by a live process. At most one plan per wave
  resets/restarts the stack (it does so only when no lock is held). The e2e lane is also single-instance (fixed port
  3100, one `.next` build per checkout), so e2e runs inside a wave are serialised. If contention costs more than it
  saves, the orchestrator runs the wave sequentially.
- **File ownership.** Plans in one wave touch disjoint files (checked in the order table). If a plan finds it must
  edit a file owned by its wave partner, it stops that edit and records it for the wave merge.
- **Per-plan done:** `npm run typecheck`, `npx eslint .` (0 errors), `npm run inventory`, the plan's tests, then the
  full Vitest lane (`npm run test:db`) once at the end of the plan; plus `npm run e2e:build && npm run e2e:pr` for any
  plan that touches `proxy.ts`, env, auth pages, routes or UI. UI plans check 360 px, tablet (820) and desktop (1280)
  and axe (0 serious/critical).
- **Env-key checklist (R-15).** A plan that adds an env name adds, in the same commit: the schema entry and tier rules
  in `lib/env.ts` / accessor in `lib/env-server.ts`; unit cases in `tests/config/env-schema.spec.ts`; a pin or
  forbid rule in `tests/setup/test-env.ts`; the e2e value in `tests/e2e/support/app-env.ts`; `.env.example`
  regenerated by `node scripts/ci/env-example.mjs`.
- **Dependencies.** Exact pins; reason stated in the plan; new packages have no install scripts (verified in research).
- **Orchestrator:** after 03-06 lands, push and open the phase PR as **draft** into `feature/v2` so CI proves the
  framework upgrade on Linux runners before wave 2; push after every wave; merge only after the gate.

## Execution order

| Wave | Plan | Size | Depends on | Hot files this plan owns in its wave | Why this order |
|---|---|---|---|---|---|
| 1 | **03-06** Next 16 + `@supabase/ssr` 0.12 | M | — | `package.json`, `middleware.ts`→`proxy.ts`, `eslint.config.mjs`, `ci.yml`, `lib/supabase/{server,client}.ts` | PO direction: first, own commit series; every later plan edits the proxy, ESLint or `lib/supabase` |
| 2 | **03-09a** `lib/log` + request IDs | S-M | 03-06 | `lib/log/**`, `proxy.ts`, `lib/api/envelope.ts` | Logger is needed by 03-01, 03-02, 03-07, 03-09b/c, 03-12 |
| 2 | **03-03** generated types + immutability + drift | M | 03-06 | `types/database.ts`, `lib/db/types.ts`, `tests/helpers/db.ts`, 32 test files, `package.json`, `ci.yml`, `vitest.config.ts` | Independent; adds `db:types` used by every migration plan |
| 3 | **03-01** env schema + `APP_ENV` + readiness RPC | M | 03-09a, 03-03 | `lib/env*.ts`, `next.config.ts`, `instrumentation.ts`, `proxy.ts`, `app/api/{ready,health}`, migration 000025, env-guard files, `ci.yml`, guard manifest | Accessors needed by 03-02 and all later plans; resolves K-6 |
| 3 | **03-10** R2/S3 removal + webhook test branches | S | 03-06 | `lib/storage/{index,r2-provider}.ts`, `features/sharing/system.ts`, `lib/webhooks/**`, `scripts/ci/ai-l1-greps.mjs`, `package.json`, report FLOOR | Removes the files 03-01 would otherwise have to convert |
| 4 | **03-02** single system DB factory | S-M | 03-01, 03-10 | `lib/supabase/{admin,system}.ts`, `lib/storage/supabase-provider.ts`, `app/api/{v1,cron,webhooks}/**`, `features/{sharing,referrals}`, migration 000026 | Needs env accessors + logger; 03-10 already edited `features/sharing/system.ts` |
| 5 | **03-09c** `console.*` sweep (214 lines, 78 files) | M | 03-02 | the 78 files | Touches almost every module, so it runs with no app-code partner |
| 5 | **03-11a** AUTH-02 config as code + drift check | S-M | 03-03 | `supabase/config.toml`, `supabase/auth-policy.json`, `supabase/templates/**`, `ci.yml`, `package.json` | Only stack restart in the wave; no app code |
| 6 | **03-05** `lib/datetime` + UTC sites | M | 03-09c | `lib/datetime/**`, ~35 site files, `package.json`, `ci.yml` | After the sweep so sites are edited once |
| 6 | **03-07** D1 spike `record_payment` | S-M | 03-02, 03-03, 03-09c | migration 000027, `features/billing/{service,actions}.ts`, `components/queue/checkout-drawer.tsx`, `lib/db/errors.ts`, `lib/errors/app-error.ts` | Needs `getSystemDb` (system path) and types |
| 7 | **03-09b** error sink + `onRequestError` + scrubber | M | 03-01, 03-09a | migration 000028, `instrumentation.ts`, `lib/observability/**`, `app/api/diag/error`, env-guard files, guard manifest | Needs `instrumentation.ts` (03-01) |
| 7 | **03-04** ESLint boundaries + acceptance counters | S-M | 03-01, 03-02, 03-05, 03-09c | `eslint.config.mjs`, `lint-fixtures/p1-34/**`, `scripts/phase-evidence.mjs` | Lands after the sites it bans are clean; binds all later code |
| 8 | **03-11b** Send Email hook + `EmailSender` | M | 03-11a, 03-01 | `lib/email/**`, `app/api/auth/send-email`, env-guard files, guard manifest + engine, `package.json` | |
| 8 | **03-08** staging as code | S-M | 03-01, 03-03, 03-11a | `vercel.json`, `.github/workflows/{staging,drift}.yml`, `scripts/staging/**`, `scripts/seed*`, `ci.yml` (policy step), `docs/runbooks/staging.md` | Wires the 03-03/03-11a drift scripts into workflows |
| 9 | **03-12a** FT-05 + change password + reset completion + error catalogue | M | 03-09a, 03-01 | `features/auth/**`, `lib/auth/pwned.ts`, `messages/en.ts`, profile page, forgot-password page, env-guard files, guard manifest + engine, e2e global setup | Alone: owns the auth feature module |
| 10 | **03-12b** `POST /auth/signout` + OA-5 default-deny | S-M | 03-09b, 03-12a | `app/auth/signout`, `proxy.ts`, `lib/auth/public-paths.ts`, user dropdown, guard manifest + engine, `unauth-pages.spec.ts` | OA-5 test reads the error sink (03-09b) |
| 10 | **03-12c** Turnstile + safe `next` + J-A3 + AUTH-00 re-check kit | M | 03-12a, 03-08 | login + forgot-password pages, `features/auth/password-flows.ts`, `lib/auth/safe-next.ts`, e2e fixtures, env-guard files, `package.json`, `staging.yml` | Adds a job to `staging.yml` (03-08) |
| close | Phase close (evidence, reviews, summary, verification) | — | all | `scripts/ci/assert-vitest-report.mjs` REQUIRED_FILES | |

Cross-wave hot files and their owners in order: `proxy.ts` 03-06 → 03-09a → 03-01 → 03-12b; `ci.yml` 03-06 → 03-03 →
03-01 → 03-11a → 03-05 → 03-08; `package.json`/lock 03-06 → 03-03 → 03-10 → 03-11a → 03-05 → 03-11b → 03-12c;
`types/database.ts` 03-03 → 03-01 → 03-02 → 03-07 → 03-09b; `tests/security/guard-manifest.ts` 03-01 → 03-09b → 03-11b →
03-12a → 03-12b; `lib/env*.ts` + `tests/e2e/support/app-env.ts` 03-01 → 03-09b → 03-11b → 03-12a → 03-12c;
`tests/setup/test-env.ts` 03-01 → 03-11a → 03-09b → 03-11b → 03-12a → 03-12c; `eslint.config.mjs` 03-06 → 03-04;
`app/(auth)/forgot-password/page.tsx` + `features/auth/password-flows.ts` 03-12a → 03-12c.

## New dependencies (CLAUDE.md: reason required)

| Package | Pin | Plan | Why | Legitimacy (research audit 2026-11-13) |
|---|---|---|---|---|
| `next`, `eslint-config-next` | same exact 16.4.x patch | 03-06 | P2-01; Next 15 security releases end 2027-01-31 | existing packages, major bump |
| `@supabase/ssr` | exact 0.12.x (0.12.7) | 03-06 | AUTH §4.2 current PKCE/cookie behaviour; `^0.5.2` cannot reach 0.6+ | existing package |
| `supabase` (CLI, dev) | exact `2.120.0` (already resolved) | 03-03 | reproducible `gen types` and `db diff` in CI | existing package |
| `smol-toml` (dev) | 1.9.1 | 03-11a | parse `supabase/config.toml` in the policy check | OK, approved |
| `date-fns` + `@date-fns/tz` | 4.4.0 / 1.5.0 | 03-05 | midnight-in-zone → UTC needs per-instant offsets (`TZDate`) | OK, approved |
| `standardwebhooks` | 1.1.1 | 03-11b | Send Email hook signature (timing-safe, tolerance, multi-signature) | OK, approved |
| `@aws-sdk/client-sesv2` | **3.1155.0** | 03-11b | SES `SendEmail` in `ap-south-1`; SigV4 must not be hand-rolled | **SUS (too-new)**: older pin on the same train as the S3 SDK already in the lockfile; PO confirms before merge (E14) |
| `@marsidev/react-turnstile` | **1.6.2** | 03-12c | widget lifecycle (explicit render, reset, expiry); the component Supabase's CAPTCHA guide uses | **SUS (too-new)**: older pin; PO confirms before merge (E14) |
| removed: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | — | 03-10 | P1-43 (only importer was `lib/storage/r2-provider.ts`) | — |

For the two SUS packages the implementer records `npm view <pkg>@<pin> repository.url dist.integrity scripts time`,
the `npm audit signatures` result and the `package-lock.json` integrity line in
`evidence/package-legitimacy.json` (tool output). The human confirmation (E14) blocks the **merge**, not local work
(PO direction; R-23).

---

## 03-06 Next 16 + `@supabase/ssr` 0.12 (P2-01, FE-1/C24, K-2, F20, AUTH-00 item 12) · M · Wave 1

### Files
- `package.json`, `package-lock.json`: `next` and `eslint-config-next` → the same exact latest 16.4.x patch;
  `@supabase/ssr` → exact 0.12.x; `@supabase/supabase-js` floor `^2.117.2` (ssr peer `^2.114.0`). React stays 19.3.x.
- `middleware.ts` → `proxy.ts` (`git mv`; export `proxy`; `config.matcher` unchanged).
- `lib/supabase/server.ts`, `lib/supabase/client.ts` (0.12 types; `setAll(cookies, headers)`).
- `eslint.config.mjs` (native flat exports `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`;
  drop `FlatCompat` / the transitive `@eslint/eslintrc` import; every existing gate and ignore unchanged in effect).
- `next.config.ts`, `tsconfig.json`, `next-env.d.ts`: only edits Next 16 requires or `next build` writes.
- `tests/e2e/support/build-scan.ts`, `tests/e2e/support/build.ts` (Turbopack output layout).
- `tests/api/api-v1-switch.spec.ts`, `tests/api/health-probes.spec.ts`, `tests/helpers/api-v1.ts` (`@/middleware` →
  `@/proxy`).
- `.github/workflows/ci.yml` (both `.next/cache` keys: `middleware.ts` → `proxy.ts`), `.github/CODEOWNERS`
  (`/middleware.ts` → `/proxy.ts`), `.github/audit-allowlist.json` (F20 postcss-in-next waiver: removed if the advisory
  no longer matches — the gate fails on stale entries — otherwise renewed with a new reason and owner V2-14).
- `.planning/phases/03-platform-hygiene/03-06-NEXT16.md` (upgrade record) and `evidence/03-06/` (before/after tool
  outputs).

### Steps
1. **Baseline** on `e66edf9`: save `npm run typecheck` exit, `npx eslint . -f json` counts, the full Vitest JSON
   (`npm run test:db -- --reporter=json --outputFile=…`) and the Playwright PR-lane JSON into `evidence/03-06/before/`.
2. Upgrade the packages (exact pins); `npm audit signatures`; `npm run ci:audit`.
3. `git mv middleware.ts proxy.ts`; rename the export to `proxy`. Session refresh uses `supabase.auth.getClaims()`.
   Return the response object that `setAll` last built (never a fresh `NextResponse.next()` after cookies are set)
   and copy the headers `setAll` receives (0.12 passes cache-control headers) onto it. The API_V1 gate, the
   `/api/health`/`/api/ready` early returns and the matcher stay byte-identical in behaviour.
4. `lib/supabase/server.ts` (Server Component try/catch kept) and `client.ts` on the 0.12 API.
5. ESLint native flat config. `tests/security/*-lint-gates.spec.ts` must stay green; `npx eslint .` 0 errors. If a rule
   new in config 16 flags v1 code broadly, set that one rule to `warn` with a comment naming the owner phase and record
   it in `03-06-NEXT16.md` with the warning-count delta.
6. Breaking-change checklist from the Next 16 upgrade guide, each with the command used and its result in
   `03-06-NEXT16.md`: sync request APIs (research found 0), `next lint` (not used), `next/image` (0),
   `revalidateTag`/`unstable_*` (0), parallel-route `default.tsx` (check `app/**/@*`), removed `experimental` keys,
   Node ≥ 20.9 (repo pins 24).
7. Turbopack build: `npm run build` with the CI build env and `npm run e2e:build`; update the build-scan globs to the
   Turbopack layout so the scan still covers every client and server chunk (prove it by planting a hosted marker in a
   throwaway build and seeing the scan fail, then removing it). `tests/setup/next-env-flag.spec.ts` (K-2) must pass
   unchanged. If Turbopack cannot build a dependency (e.g. `@react-pdf/renderer`), use `next build --webpack` in
   `build` and `e2e:build` and record why (still Next 16).
8. CI cache keys, CODEOWNERS, audit allowlist.
9. **Gate (one commit SHA):** `npm run typecheck`, `npx eslint .`, `npm run inventory`, `npm run ci:audit`,
   `npm run ci:ai-l1`, `npm run test:db` (full lane, 0 skipped), `npm run e2e:build && npm run e2e:pr` (M0 flows,
   journeys 1/8/9, unauth pages, a11y), and `npm run build` with the CI build env. Outputs into
   `evidence/03-06/after/`. The orchestrator then pushes and opens the draft phase PR (CI on Linux).

### Rollback note
03-06 is the first contiguous commit series on the branch; `03-06-NEXT16.md` records its first and last SHA.
Rollback = `git revert --no-edit <first>^..<last>` (no force-push), then `next@15.5.29` + `eslint-config-next@15.5.29`
(the 15.x security backport) in a separate commit. Later plans then edit `middleware.ts` wherever this plan says
`proxy.ts`.

### Fallback if the upgrade is blocked
Blocked = an incompatibility with no fix inside this session after the `--webpack` option (e.g. a dependency without
Next 16 support, or a red PR lane whose root cause is in the framework). Then: roll back as above; keep
`@supabase/ssr@0.12.x` if it passes the same gate on 15.5 (it supports Next 15); write
`.planning/phases/03-platform-hygiene/03-06-NEXT16-DEFERRAL.md` with the blocker and its evidence (command output,
upstream issue link), the options, and a **dated re-check on 2026-12-14**, with the upgrade landing no later than
2027-01-15 (two weeks before Next 15 security support ends on 2027-01-31). The deferral becomes gate item E15.

### Tests that fail without the change
This plan adds no behaviour. Its gate is the full existing suite on Next 16: the K-2 pin
(`next-env-flag.spec.ts`), the build-output marker scan (re-proven on the Turbopack layout in step 7), the API_V1
switch spec importing `@/proxy`, and the whole PR lane, which exercises `proxy` on every request.

### Acceptance mapping
P2-01 "Next 16 decision (PR or written deferral)": the upgrade on this branch (R-1, R-14), or the dated deferral.
AUTH-00 item 12 (`@supabase/ssr` target version): resolved.

---

## 03-09a Structured logger + request IDs (P1-25 part, BACKEND H1-H2, TARGET §3.8) · S-M · Wave 2

### Files
`lib/log/index.ts`, `lib/log/fields.ts`, `lib/log/client.ts`, `lib/log/request-id.ts`, `proxy.ts`,
`lib/api/envelope.ts` (+ the v1 helper that builds envelopes, if the correlation id is set there),
`tests/observability/logger.spec.ts`, `tests/observability/request-id.spec.ts`, `tests/e2e/security/request-id.spec.ts`.

### Steps
1. **Typed logger (R-6).** `log.info|warn|error(fields)`. `LogFields` is a closed object type: `event` (required,
   `^[a-z0-9]+(\.[a-z0-9_]+)+$`), `requestId`, `tenantId`, `userId` (UUIDs), `route`, `action`, `module`, `reason`,
   `code` (≤ 40 chars `[A-Za-z0-9_.-]`), `status`, `durationMs`, `count`. No index signature, no free-form object, no
   `message`. Runtime defence for `any` callers: unknown keys dropped, non-UUID ids dropped, strings truncated to 120.
   One JSON line per call (`ts`, `level`, then fields) written with `process.stdout.write` / `process.stderr.write`
   (no `console`). No env reads in `lib/log` (03-04 confines `process.env`). Re-export `errorTag` from
   `lib/errors/client-message.ts` as the only way to put an error into `code`.
2. `lib/log/client.ts` `reportClientError(event, err)`: development → one `console.warn` of `event` + `errorTag(err)`;
   production build → no-op (client error capture is V2-06, R-29).
3. **Request IDs in `proxy.ts`** on every path, including the early returns (blocked `/api` 404, `/api/v1`,
   `/api/health`, `/api/ready`): `crypto.randomUUID()`; clone the request headers and **overwrite** any inbound
   `x-request-id`; forward with `NextResponse.next({ request: { headers } })`; set `x-request-id` on the response
   (including the 404). `x-vercel-id` is left alone.
4. `getRequestId()` in `lib/log/request-id.ts`: reads `x-request-id` through `headers()`, returns it only if it is a
   UUID, else `undefined`.
5. The v1 envelope's `correlation_id` is the request id (set where the envelope is built; change only the helper
   signature and its call sites).

### Tests that fail without the change
- `logger.spec.ts`: an `any`-typed call carrying `message: "Key (phone)=(+919000000001)"` and an email produces a line
  with neither key nor value; a non-UUID `tenantId` is dropped; an invalid `event` is rejected; exactly one line per
  call; nothing is written through `console`.
- `request-id.spec.ts`: `proxy(new NextRequest(".../api/health", { headers: { "x-request-id": "spoofed" } }))` → the
  response `x-request-id` is a UUID ≠ `spoofed` and equals the forwarded request header; same for a blocked
  `/api/v%31/x` (404), `/api/v1/x` with the switch off, and a page path.
- e2e `request-id.spec.ts`: two `GET /api/health` calls return two different UUIDs; a spoofed inbound id is replaced.

### Acceptance mapping
P1-25 "structured logger … request IDs (V2-03)"; prerequisite for "a thrown server error appears in the sink" (03-09b).

---

## 03-03 Generated types + migration immutability + drift baseline (P1-34 B1/B2/B4, RL-13b, R-3, R-4) · M · Wave 2

### Files
- `types/database.ts` (generated), `lib/db/types.ts` (hand-written `Database` deleted; `export type { Database }
  from "@/types/database"`; domain interfaces kept, R-3), `tests/helpers/db.ts` (`TestDb` → `SupabaseClient<Database>`),
  the files behind the 32 test type errors (tests/security 17, tests/compliance 7, visits 3, patients 3, helpers 2).
- `vitest.config.ts` (coverage exclude → `types/database.ts`; correct the "Generated by" comment).
- `package.json` / lock: `supabase` exact `2.120.0`; scripts `db:types` (`supabase gen types typescript --local
  --schema public > types/database.ts`) and `db:drift:local` (`node scripts/ci/local-drift.mjs`).
- `scripts/ci/migration-immutability.mjs`, `scripts/ci/local-drift.mjs`, `scripts/drift/hosted-dump-diff.mjs`.
- `.github/workflows/ci.yml`: `static` checkout `fetch-depth: 0` + immutability step against
  `origin/${{ github.base_ref || 'feature/v2' }}`; `test` after the stack starts: `npm run db:types && git diff
  --exit-code -- types/database.ts`, then `node scripts/ci/local-drift.mjs`.
- `tests/ci/migration-immutability.spec.ts`, `tests/ci/local-drift.spec.ts`, `tests/ci/hosted-dump-diff.spec.ts`.
- `.planning/phases/03-platform-hygiene/evidence/b1/` (local drift output now; hosted report when E1a arrives).

### Steps
1. Pin the CLI; `npm run db:types`; switch `Database`; fix the 32 test errors properly (narrow unions, typed builders;
   no `@ts-ignore`/`@ts-expect-error` without a one-line reason). App code: research measured 0 errors.
2. **Immutability (B2):** `git diff --name-status --find-renames <base>...HEAD -- supabase/migrations`; any status
   other than `A` fails naming file and status; a new file whose number is ≤ the highest number on the base, or two
   files sharing a number, also fail.
3. **Local drift (B1 local half):** `npx supabase db diff --local` to **stdout** (never `-f`; pitfall 1). Allow exactly
   `drop extension if exists "pg_net";` (CLI shadow-DB false positive, cited in the script); any other statement →
   exit 1 printing the statements.
4. **Hosted B1 tool:** `hosted-dump-diff.mjs <dump.sql>`: refuses unless the local stack URL is loopback; creates a
   scratch database in the local Postgres (`docker exec … psql`), loads the PO's schema-only dump with ownership/ACL
   statements stripped, diffs it against the migrations with `npx supabase db diff --db-url
   postgresql://postgres:postgres@127.0.0.1:54322/<scratch> --schema public` (verify at execution that CLI 2.120.0
   compares the target with a shadow DB built from `supabase/migrations`; if not, run the CLI's migra image against a
   second scratch DB built from the migrations), writes `evidence/b1/hosted-drift.txt` + `hosted-drift.json` (counts),
   drops the scratch DB. The dump file is never committed. The agent never connects to a hosted DB.
5. Types freshness and local drift run in CI `test`.

### Tests that fail without the change
- `migration-immutability.spec.ts` (temp git repo fixture): modified, renamed or deleted applied migration → exit 1
  naming it; a new `000025_x.sql` → exit 0; duplicate number → exit 1.
- `local-drift.spec.ts`: the filter on fixture outputs — empty and pg_net-only → 0; one extra statement → 1.
- `hosted-dump-diff.spec.ts` (DB lane, long timeout): a schema-only dump of the **local** DB → only the allowlisted
  line; the same dump with an added column → the report names that column.
- `npm run typecheck` with `TestDb = SupabaseClient<Database>` fails until the 32 errors are fixed.

### Acceptance mapping
"`tsc` passes with generated types": full. "a fresh `db reset` matches the target schema (drift = 0 or documented)":
local half full (CI step; pg_net documented); hosted read-only report **pending PO (E1a)**. Evidence "the drift report
(read-only against the hosted project)": tool ready and tested; report pending E1a.

---

## 03-01 Env schema + fail-closed providers + readiness RPC (P1-15, I-07, K-6, AI-06 L1, R-11, R-K, C-3) · M · Wave 3

### Files
- `lib/env.ts` (rewritten: zod schema for every app env name, `APP_ENV`, tier rules, `parseEnv`,
  `assertDeployEnv(source)`, `publicEnv` with explicit `process.env.NEXT_PUBLIC_*` reads so Next inlines them),
  `lib/env-server.ts` (new, `import "server-only"`, memoised `serverEnv()` typed accessors).
- `next.config.ts` (calls `assertDeployEnv(process.env)`: runs on `next build`, `next start`, `next dev`),
  `instrumentation.ts` (new; `register()` asserts on the `nodejs` runtime).
- Consumers of every `process.env` read except 03-10's files: `proxy.ts`, `lib/supabase/{admin,server,client}.ts`,
  `lib/storage/supabase-provider.ts`, `lib/api/enabled.ts`, `lib/ai/client.ts` (default param → `serverEnv()`),
  `lib/messaging/index.ts`, `lib/messaging/providers/*`, `lib/messaging/webhook-helpers.ts`,
  `app/api/cron/{dispatch-communications,webhooks}/route.ts`, `features/appointments/system.ts`,
  `features/billing/service.ts`, `features/labs/service.ts`, `features/prescriptions/service.ts`,
  `features/referrals/service.ts`. **Not touched here:** `lib/storage/index.ts`, `lib/storage/r2-provider.ts`,
  `features/sharing/system.ts`, `lib/webhooks/**` (03-10).
- `lib/messaging/providers/disabled.ts` (new, R-16).
- `app/api/ready/route.ts` (RPC only), `app/api/health/route.ts` (+ `region`, `release`),
  `supabase/migrations/000025_readiness_probe.sql`, `types/database.ts`.
- `tests/setup/test-env.ts`, `tests/e2e/support/app-env.ts`, `vitest.config.ts`, `tests/helpers/supabase-admin.ts`
  (renamed keys), `.github/workflows/ci.yml` (`build` env: `APP_ENV: ci` + renamed keys; `static`: `node
  scripts/ci/env-example.mjs --check`), `.env.example` (regenerated, never opened by the agent),
  `scripts/ci/env-example.mjs`, `tests/security/guard-manifest.ts` (public-health key lists).
- Tests: `tests/config/env-schema.spec.ts`, `tests/config/env-boot.spec.ts`, `tests/api/health-probes.spec.ts`
  (rewrite; R2 case removed here), `tests/api/readiness-probe-db.spec.ts`, `tests/messaging/provider-selection.spec.ts`.

### Steps
1. **Names (≈31 today + `APP_ENV`)**, R-K renames: `NEXT_PUBLIC_SUPABASE_ANON_KEY` → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` → `SUPABASE_SECRET_KEY` (both accept legacy JWT values, which local lanes keep using, so
   `build-scan.ts` is unchanged). Canonical messaging webhook secret: `MSG91_WEBHOOK_SECRET` (matches the code and
   PO-ACTIONS C-3). `region` comes from Vercel's runtime `VERCEL_REGION`, `release` from `VERCEL_GIT_COMMIT_SHA` (both
   optional, read only in `lib/env*.ts`).
2. **Tier rules** (`APP_ENV` ∈ development | test | e2e | ci | staging | production; required when
   `NODE_ENV=production`; never inferred from `VERCEL_ENV`):
   - staging + production: `MESSAGING_PROVIDER` ≠ `dev` and the chosen provider's credentials present (`disabled`
     allowed in staging only); `AI_PROVIDER` ≠ `mock`; Supabase URL `https://` and non-loopback; keys not the local
     demo keys; `NEXT_PUBLIC_APP_URL` `https://`; `CRON_SECRET` ≥ 32 chars; `MSG91_WEBHOOK_SECRET` present when the
     provider is msg91; `API_V1_ENABLED` ≠ `true`; any `R2_*`, `STORAGE_PROVIDER`, or the old key names set → error
     (stale hosted config fails loudly).
   - any tier with `NODE_ENV=production` and `AI_ENABLED=true`: `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL_NAME` (and
     `AI_BASE_URL` where the provider needs it) required (AI-06 L1 carry-over).
   - ci, e2e, test: Supabase URL loopback only; offline providers allowed (K-6).
   - development/test: `NEXT_PUBLIC_APP_URL` defaults to `http://localhost:3000` **in the schema** (documented), required
     elsewhere.
   - The error lists `KEY: rule` pairs and never a value.
3. Replace every in-scope `process.env` read with the accessors. Delete the six `NEXT_PUBLIC_APP_URL || "http://localhost:3000"`
   fallbacks and the msg91 → dev fallback in `lib/messaging/index.ts`. `lib/api/enabled.ts` reads the tier from the
   accessor (still a production guard, PO-16).
4. **`disabled` messaging provider (R-16):** sends nothing and returns a non-retryable `provider_disabled` outcome that
   the dispatcher records with the existing status set (no schema change).
5. **Readiness (C50 g):** `public.readiness_probe()` SECURITY DEFINER, `SET search_path = ''`, returns jsonb with
   booleans and counts only (`db: true`, pending and failed-24h outbox counts, `latest_migration` from
   `supabase_migrations.schema_migrations`); `revoke all … from public; grant execute … to anon, authenticated`.
   `/api/ready` calls it through the cookie client (anon when signed out), reports AI/messaging/email as
   `disabled|configured` from the schema (never calls a provider), sets `correlationId` to the request id, no bucket
   check, no service role, no raw error logging (`log.error` with `code` only). `/api/health` adds `region` and
   `release`; the guard manifest's `public-health` key lists are updated.
6. `scripts/ci/env-example.mjs`: writes `.env.example` from schema metadata (name, tiers, rule, non-secret example such
   as `<set in Vercel>`); `--check` exits 1 on any difference. The agent runs the writer and the checker only; it
   never opens the file. The PO reviews the diff at the gate.
7. Lanes: CI `build` `APP_ENV=ci`; `buildAppServerEnv` `APP_ENV=e2e`; Vitest pins `APP_ENV=test`; `test-env.ts` keeps
   `R2_*` and `STORAGE_PROVIDER` forbidden.

### Tests that fail without the change
- `env-schema.spec.ts` (matrix): each forbidden staging/production combination throws naming its key and the thrown
  text never contains the offending value; `NODE_ENV=production` without `APP_ENV` throws; ci/e2e with a
  non-loopback URL throws; `AI_ENABLED=true` + `NODE_ENV=production` + missing `AI_API_KEY` throws; stale `R2_ACCOUNT_ID`
  in staging throws; a complete synthetic production profile passes.
- `env-boot.spec.ts`: spawns `node_modules/.bin/tsx -e "await import('./next.config.ts')"` with a production env
  lacking providers → exit ≠ 0, stderr names `MESSAGING_PROVIDER`; with the CI profile → exit 0; `register()` from
  `instrumentation.ts` throws on a bad env.
- `provider-selection.spec.ts`: `MESSAGING_PROVIDER=msg91` without `MSG91_AUTH_KEY` no longer yields the dev provider.
- `health-probes.spec.ts` + `readiness-probe-db.spec.ts` (DB lane): `/api/ready` returns only the allow-listed keys with
  booleans/counts; it still answers 200 when `@/lib/supabase/admin` is mocked to throw on import; anon can execute the
  RPC; `pg_proc` shows `prosecdef = true` and `proconfig` `search_path=""`; `anon` cannot execute any other new
  function.

### Acceptance mapping
"production boot fails without real providers": full (local). I-07 (`CRON_SECRET` in `.env.example`): full. K-6
resolved. AI-06 L1 env check: full.

---

## 03-10 R2/S3 removal + test-env branch removal (P1-43, P2-03, E-6, RL-12, R-8) · S · Wave 3

### Files
`lib/storage/r2-provider.ts` (deleted), `lib/storage/index.ts`, `features/sharing/system.ts` (R2 selection only),
`package.json` / lock (remove `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`),
`tests/storage/storage-provider.spec.ts`, `lib/webhooks/ssrf.ts`, `lib/webhooks/dispatcher.ts`,
`tests/api/webhooks-outbox.spec.ts`, `tests/api/webhook-ssrf.spec.ts` (new), `scripts/ci/ai-l1-greps.mjs`,
`lint-fixtures/ai-l1/*`, `tests/ci/ai-l1-greps.spec.ts`, `scripts/ci/assert-vitest-report.mjs` (FLOOR arithmetic in
the same commit if tests are removed), `scripts/inventory-server-actions.ts` (only if it lists the R2 module).

### Steps
1. Delete the R2 provider, the duplicated selection logic (`lib/storage/index.ts:75-77,100-102`,
   `features/sharing/system.ts:78`) and the `export *`. Supabase Storage is the only provider.
2. **SSRF:** delete `isTestEnv` from `lib/webhooks/ssrf.ts`. `validateWebhookEndpoint(url, opts?: { allowHttp?:
   boolean; resolve?: (host: string) => Promise<string[]> })`. DNS resolution **always** runs (default
   `dns.promises.lookup(host, { all: true })`), every answer is checked against the private/reserved ranges, resolver
   errors fail closed, and the `.test`/`.example.com` skip is removed. Tests inject `resolve` instead.
3. **Dispatcher:** delete `isTest` (`lib/webhooks/dispatcher.ts:94`); callers may pass `{ allowHttp, resolve, fetch }`;
   production callers (cron route) pass nothing → https only, real DNS, real fetch.
4. **AI-06 L1-R3** scope widened from `lib/ai|features/ai` to `app/ components/ features/ lib/ proxy.ts`; fixture
   added for a webhook-path `VITEST` reference.
5. The live AI eval lane is deferred to V2-12 (R-8): recorded in 03-SUMMARY, no code.

### Tests that fail without the change
- `webhook-ssrf.spec.ts`: `https://hooks.example.test/x` with a resolver answering `10.0.0.5` → rejected (before:
  accepted, DNS skipped under Vitest); a public answer → accepted; `http://` without `allowHttp` → rejected even inside
  Vitest (before: allowed); resolver throws → rejected; mixed public + private answers → rejected.
- `webhooks-outbox.spec.ts`: rewired to inject `resolve` and `fetch`; still green.
- `storage-provider.spec.ts`: with `STORAGE_PROVIDER=r2` and `R2_*` stubbed in the test, the provider is still
  Supabase (before: R2).
- `ai-l1-greps.spec.ts`: the new fixture fires L1-R3 (before: out of scope).

### Acceptance mapping
P1-43 and P2-03 branch removal: full. AI-06 L1-R3 carry-over: full. P2-03 live lane: deferred (R-8).

---

## 03-02 Single system DB factory (P1-34, ADR-0005 D2/V4, C50 b/c/e, R15) · S-M · Wave 4

### Files
`lib/supabase/system.ts` (new), `lib/supabase/admin.ts` (deleted), `lib/storage/supabase-provider.ts` (service-role
fallback deleted), importers: `app/api/v1/**/route.ts` (14), `app/api/cron/{dispatch-communications,webhooks}/route.ts`,
`app/api/webhooks/messaging/[provider]/route.ts`, `features/sharing/system.ts`, `features/referrals/service.ts`;
`supabase/migrations/000026_referral_source_clinics.sql`, `types/database.ts`; tests importing the old module:
`tests/messaging/msg91-webhook.spec.ts`, `tests/security/ai-containment.spec.ts`, `tests/security/share-path-encoding.spec.ts`,
`tests/security/webhook-lockdown.spec.ts`; new `tests/security/system-db.spec.ts`, `tests/referrals/referral-source-clinics.spec.ts`,
`tests/storage/no-service-role-fallback.spec.ts`; `scripts/inventory-server-actions.ts` (only if it names `admin.ts`).

### Steps
1. `getSystemDb(reason: SystemDbReason)` with `import "server-only"`. `SystemDbReason` is a closed union built from the
   current call sites (e.g. `api_v1`, `cron.dispatch_communications`, `cron.webhooks`, `webhook.messaging_inbound`,
   `share.resolve`, `share.sign`), each mapped to its owning module in a `REASON_OWNER` table. The client uses
   `serverEnv().SUPABASE_SECRET_KEY`, `persistSession: false`, `autoRefreshToken: false`. Every call writes exactly one
   line `log.info({ event: "system_db.acquired", reason, module })`. An unknown reason at runtime throws.
2. Move the importers; delete `lib/supabase/admin.ts`.
3. `lib/storage/supabase-provider.ts`: if the cookie client cannot be created, throw. No service-role fallback (ADR D2).
4. **Referral names (R15):** `public.referral_source_clinics(p_ids uuid[]) returns table(id uuid, name text, phone text)`,
   SECURITY DEFINER, `search_path = ''`; returns a tenant only if it is in `p_ids` **and** a referral row exists with
   that tenant as source and a target tenant in `public.current_user_tenant_ids()` (read the referral columns in
   `000013_labs_and_referrals.sql`); `revoke all from public, anon; grant execute to authenticated`.
   `features/referrals/service.ts` calls it through the user client instead of the dynamic import.
5. ADR-0005 A1 list (5 public routes for `features/sharing/system.ts`) unchanged.

### Tests that fail without the change
- `system-db.spec.ts`: `getSystemDb("cron.webhooks")` writes exactly one JSON line whose keys are `ts, level, event,
  reason, module` (stdout spy); an unknown reason throws.
- `no-service-role-fallback.spec.ts`: with `@/lib/supabase/server` mocked to throw and the secret key set, the storage
  provider rejects instead of returning a client (before: service-role fallback).
- `referral-source-clinics.spec.ts` (DB lane): tenant-B staff see A's name only after A referred to B; ids of an
  unrelated tenant C → 0 rows; anon → permission denied; the inbound-referral list from `features/referrals/service.ts`
  still shows the originating clinic name.
- `npm run typecheck` fails while any import of `@/lib/supabase/admin` remains.

### Acceptance mapping
"ESLint finds 1 service-role factory (`lib/supabase/system.ts`)": the factory side is full here; the lint proof is
03-04.

---

## 03-09c `console.*` sweep to the typed logger (P1-25, BACKEND H1) · M · Wave 5

### Files
The 78 files from `git grep -nE "console\.(log|info|warn|error|debug)" -- app components features lib` (214 lines:
app 29, components 24, features 144, lib 17), including `lib/messaging/dev-logger.ts`;
`tests/observability/no-raw-error-logging.spec.ts`.

### Steps
1. Server code: `log.error({ event: "<domain>.<operation>.failed", code: errorTag(err), requestId: await getRequestId(),
   tenantId })` where those values are in scope. Never the error object, `err.message`, row values or inputs.
2. Client components: `reportClientError("<domain>.<operation>.failed", err)`.
3. `dev-logger.ts`: the `console.log` of recipient/template/params becomes `log.info({ event: "messaging.dev.recorded",
   count })`; the dev-only file append stays (staging/production forbid the dev provider, 03-01).
4. Event names follow `domain.operation.outcome`; the list goes in 03-SUMMARY.

### Tests that fail without the change
`no-raw-error-logging.spec.ts`: drives at least three server paths (a patients write, a labs write, the prescription
PDF route) into their error branch with a mocked client error whose message carries `Key (phone)=(+919000000001)` and
`synthetic.user@example.test`; captured stdout/stderr contains the event and code but neither the phone, the email
nor the message text (before: `console.error` printed the raw error). Repo-wide enforcement is the `no-console` gate
in 03-04.

### Acceptance mapping
P1-25 "structured logger replacing `console.*`": full.

---

## 03-11a AUTH-02 auth config as code + drift check (AUTH-02, A00-1/A00-4/A00-5 config side, R-20) · S-M · Wave 5

### Files
`supabase/auth-policy.json`, `supabase/config.toml`, `supabase/templates/{confirmation,email_change,password_changed}.html`
(recovery kept), `scripts/ci/check-auth-config.mjs`, `scripts/drift/auth-config-hosted.mjs`,
`lint-fixtures/auth-policy/*` (config and response fixtures), `tests/ci/auth-policy.spec.ts`,
`tests/ci/auth-config-hosted.spec.ts`, `tests/integration/auth/auth-config-applied.spec.ts`, `.github/workflows/ci.yml`
(`static` step), `package.json` / lock (`smol-toml`), `tests/setup/test-env.ts` (`SUPABASE_ACCESS_TOKEN_STAGING_RO` in
`FORBIDDEN_VARS`), and existing auth specs only if `max_frequency` needs a fresh synthetic address per request
(`tests/integration/auth/password-auth.spec.ts`, `tests/auth/invite.spec.ts`).

### Steps
1. **Policy file:** one row per setting: `toml` path, `hosted` field, `local`, `staging`, `production`, `source`
   (AUTH §4.1 row or ruling id), `deviation_reason`. Values per research §03-11: `jwt_expiry` 900;
   `[auth.email] enable_confirmations = true`, `max_frequency = "60s"`, `otp_length = 6`, `otp_expiry = 600`,
   `secure_password_change = false`, `double_confirm_changes = true`; `[auth] enable_signup = false` and email signup
   off on **every** environment (A00-1); `minimum_password_length = 10`; `[auth.rate_limit]` `email_sent = 60`,
   `sign_in_sign_ups = 30`, `token_refresh = 150`, `token_verifications = 30` (A00-4); `[auth.mfa.totp]` enroll/verify
   on; `password_changed` notification on with a code-free template; templates code-only (`{{ .Token }}`, no links);
   `security_update_password_require_current_password` true on staging/production (hosted-only key, A00-5); CAPTCHA:
   local off (deviation: local GoTrue would call Cloudflare), staging/production Turnstile; Send Email hook: local off
   (Mailpit SMTP), staging/production on with URI `{{STAGING_ORIGIN}}/api/auth/send-email` (origin resolved from env at
   check time; E0 supplies it); `site_url` per environment, no extra redirect URLs on staging.
2. `check-auth-config.mjs`: compares the `local` column with `config.toml` (`smol-toml`), exits 1 naming each
   mismatched key; `--print <env>` prints the PO checklist (dashboard label + value) used by E3. Runs in `static`.
3. `auth-config-hosted.mjs`: `GET https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF_STAGING}/config/auth` with
   `SUPABASE_ACCESS_TOKEN_STAGING_RO`; compares the mapped fields with the `staging` column; an expected field missing
   from the response fails ("pin the mapping from the first real response", assumption A4); fields whose names contain
   `secret`, `password`, `smtp_pass` or hook secrets are never compared or printed; writes a JSON report. Refuses to run
   without the token (agents never have it). Wired into `drift.yml` by 03-08.
4. Restart the stack (`npx supabase stop && npx supabase start -x studio,edge-runtime,logflare,vector,imgproxy,supavisor`)
   when no test-run lock is held; then the full Vitest lane.

### Tests that fail without the change
- `auth-policy.spec.ts`: a fixture config with `jwt_expiry = 3600` → exit 1 naming `auth.jwt_expiry`;
  `enable_signup = true` → exit 1; the repo config → exit 0 (before: no policy, config at 3600).
- `auth-config-hosted.spec.ts` (injected fetch, synthetic responses): matching → 0; `disable_signup: false` → 1 naming
  the field; missing `security_update_password_require_current_password` → 1; a fake secret string in the fixture never
  appears in the output.
- `auth-config-applied.spec.ts` (DB lane, real local GoTrue): `GET /auth/v1/settings` shows signup disabled and
  autoconfirm off; `signInWithPassword` returns `expires_in === 900`; `signUp` → `signup_disabled`; a second recovery
  request for the same address within 60 s → `over_email_send_rate_limit`.

### Acceptance mapping
"the auth config drift check is green": local policy check green in `static` (full); hosted drift green **pending PO
(E3, E10, E11)**. AUTH-02: full locally.

---

## 03-05 `lib/datetime` + replace the UTC "today" sites (P1-21, ADR-016, FE-6) · M · Wave 6

### Files
- `lib/datetime/index.ts` (isomorphic): `DEFAULT_CLINIC_TZ = "Asia/Kolkata"`, `todayInTz(tz, now?)`, `ymdOf(instant, tz)`,
  `addDaysYmd(ymd, n)`, `nextNDays(tz, n, now?)`, `dayWindowUtc(ymd, tz) → { startIso, endIsoExclusive }`, `isYmd(s)`.
- Sites (research §03-05): A — 25 `toISOString().split("T")[0]` sites; B — 9 UTC-timestamp-to-date sites; C — 9 UTC
  day-window sites (17 lines, `T00:00:00.000Z`/`T23:59:59.999Z` → half-open `.gte(start).lt(endExclusive)`);
  `components/calendar/block-time-modal.tsx:71-81` `+05:30` literals; `features/patients/schema.ts:19-31` age from
  today.
- `package.json` / lock (`date-fns`, `@date-fns/tz`); `.github/workflows/ci.yml` (`test` job step:
  `TZ=America/New_York npx vitest run tests/utils/datetime.spec.ts`).
- `tests/utils/datetime.spec.ts`, `tests/integration/ist-boundaries.spec.ts`.

### Steps
1. Build the module on `TZDate`; display formatting stays `Intl.DateTimeFormat` (DESIGN_SYSTEM).
2. Server code gets the tenant zone from `tenants.timezone` through the existing tenant context
   (`features/clinics/profile.ts`, `lib/auth/context.ts`); public token pages use the token's tenant; client components
   receive `timeZone` as a prop from their server parent. The browser zone is never used.
3. Queue check-in and the lab `report_date` pass the tenant date explicitly. The SQL `DEFAULT CURRENT_DATE` defaults
   stay (V2-05 05-08 owns the counter/date rework); the invoice-number year stays (V2-10 P1-06) — R-33.

### Tests that fail without the change
- `datetime.spec.ts`: `now` 2026-11-12T18:29:59Z → `2026-11-12`; 18:30:00Z → `2026-11-13`; 23:59:59Z → `2026-11-13`;
  `dayWindowUtc("2026-11-13","Asia/Kolkata")` → `2026-11-12T18:30:00.000Z` / `2026-11-13T18:30:00.000Z`; month/year
  rollover in `addDaysYmd`; identical results under `TZ=America/New_York` (CI step).
- `ist-boundaries.spec.ts` (DB lane, `vi.setSystemTime(2026-11-12T19:00:00Z)` = 00:30 IST on 13 Nov): check-in creates
  a queue token dated 2026-11-13 (before: 2026-11-12); a visit at 2026-11-12T20:30:00Z (02:00 IST) is in the 13 Nov
  list from the visits service and not in 12 Nov (before: reversed); a lab document defaults to 2026-11-13.

### Acceptance mapping
"0 UTC 'today' sites": sites replaced here; the count (0) is enforced and measured by 03-04's lint rule and evidence
counter. Roadmap test "IST boundary tests at 00:00–05:30": full. (Roadmap says 29 sites; measured 25 + 9 + 9, R-24.)

---

## 03-07 D1 confirmation spike: `record_payment` (C18, R-2, AD-7, TARGET §6 and §7.1) · S-M · Wave 6

### Files
`supabase/migrations/000027_record_payment_rpc.sql`, `types/database.ts`, `lib/errors/app-error.ts`,
`lib/db/errors.ts`, `features/billing/service.ts` (`recordPayment` → RPC), `features/billing/actions.ts`,
`features/billing/schema.ts` (optional `commandId`), `components/queue/checkout-drawer.tsx` (per-attempt UUID),
`lib/supabase/system.ts` (reason `billing.record_payment_system`), `lib/webhooks/outbox.ts` (only if the app-side
`payment.recorded` enqueue moves into the RPC), `tests/helpers/sql.ts` (factored from `tests/setup/teardown.spec.ts`'s
`docker exec … psql`), `tests/billing/record-payment-rpc.spec.ts`, `tests/db/error-map.spec.ts`,
`.planning/phases/03-platform-hygiene/03-07-D1-SPIKE.md`.

### Steps
1. Migration (expand only): `payments.command_id uuid` + unique `(tenant_id, command_id)` where not null;
   `public.record_payment(p_invoice_id uuid, p_amount numeric, p_method text, p_reference text, p_command_id uuid,
   p_system_actor text default null) returns jsonb`, **SECURITY INVOKER**, `SET search_path = ''`,
   `SET statement_timeout = '5s'`. Body: actor rule (user path: `auth.uid()` not null and `p_system_actor` null; system
   path: `auth.uid()` null and `p_system_actor` in a closed `system:*` set; otherwise `P0001` `ACTOR_INVALID`);
   idempotent replay by `p_command_id`; `SELECT … FOR UPDATE` on the invoice (RLS hides other tenants → `P0002`);
   role check mirroring the app permission for collecting payments (`current_user_has_role`, until V2-05
   `has_permission`) → `42501`; invariants (amount > 0, invoice payable, amount ≤ balance → `P0001` `OVERPAYMENT`);
   insert payment; recompute total; status transition; `audit_logs` row with `actor_id = auth.uid()` (or `actor_type =
   'system'`); outbox rows in `webhook_delivery_queue` for the tenant's active endpoints subscribed to
   `payment.recorded`; returns `{ payment_id, invoice_status, paid_total, replayed }`. `revoke … from public, anon;
   grant execute … to authenticated, service_role`.
2. `lib/errors/app-error.ts` (`AppError` + codes per TARGET §6) and `lib/db/errors.ts` (SQLSTATE / `P0001` reason →
   `AppError`; unknown → `INTERNAL` with no driver text).
3. `recordPayment` calls the RPC through the user client, zod-parses the result, returns fixed safe messages (the
   current `err.message` leak at `features/billing/service.ts:366` is removed). The checkout drawer sends a fresh UUID
   per submit attempt; the app-side payment enqueue is removed if the RPC now writes the outbox (no double events).
4. **System path (TARGET §7.1):** proven by calling through `getSystemDb("billing.record_payment_system")`.
5. Spike report: what was proven (RLS, actor, audit + outbox in one transaction, rollback, error mapping, idempotency,
   system path), timings, the C18 verdict, and the gaps handed to V2-05/V2-07.

### Tests that fail without the change
- `record-payment-rpc.spec.ts` (DB lane, user-scoped clients): happy path → one payment, audit actor = caller,
  one outbox row for a subscribed endpoint, status `paid` when settled; **rollback:** a temporary trigger created by the
  test on `public.webhook_delivery_queue` (scoped to a marker endpoint URL, dropped in `finally`) raises → the RPC
  fails and 0 payments, 0 audit rows, invoice unchanged; cross-tenant invoice id → `NOT_FOUND`, B unchanged; role
  matrix derived from `ROLE_PERMISSIONS` (allowed roles succeed, others `FORBIDDEN`); overpayment → `CONFLICT`, no
  rows; replay of one `p_command_id` → same `payment_id`, `replayed: true`, one row; system path with
  `p_system_actor` → `actor_type = 'system'`; a user session passing `p_system_actor` → rejected; service role without
  it → rejected.
- `error-map.spec.ts`: `42501` → FORBIDDEN, `P0002` → NOT_FOUND, `23505` → CONFLICT, `P0001` reasons → their codes,
  unknown → INTERNAL without the driver message.
- `recordPayment` action failure returns the fixed safe message (before: the raw message).

### Acceptance mapping
"the spike report shows RLS, `auth.uid()` actor, audit and outbox in one transaction": full. Evidence "the spike
report": `03-07-D1-SPIKE.md` citing the spec run JSON.

---

## 03-09b Error sink + `onRequestError` + scrubber (P1-25, FT-07 sink, C39/PO-12, R-7, R-18) · M · Wave 7

### Files
`supabase/migrations/000028_ops_error_events.sql`, `types/database.ts`, `lib/observability/scrub.ts`,
`lib/observability/error-event.ts`, `lib/observability/sink.ts`, `instrumentation.ts` (`onRequestError`),
`app/api/diag/error/route.ts`, `lib/env.ts` + `lib/env-server.ts` (`ERROR_INGEST_KEY`, `DIAG_ERROR_ROUTE_ENABLED`),
`.env.example`, `tests/setup/test-env.ts`, `tests/e2e/support/app-env.ts`, `tests/setup/global-setup.ts` and
`tests/e2e/global-setup.ts` (install the synthetic key hash into the local vault if absent),
`tests/security/guard-manifest.ts` (diag route: `cron-secret`), `scripts/ops/export-error-events.mjs`,
`scripts/ops/check-error-export.mjs`, `docs/runbooks/error-sink.md`; tests `tests/observability/scrub.spec.ts`,
`tests/observability/error-sink-db.spec.ts`, `tests/observability/on-request-error.spec.ts`,
`tests/e2e/observability/error-sink.spec.ts`.

### Steps
1. **Migration:** schema `ops` with no grants to `anon`/`authenticated` and not in `[api] schemas`;
   `ops.error_events` (bigserial id, `fingerprint`, `occurred_on date`, `first_seen`, `last_seen`, `count`,
   `environment`, `release`, `route_path`, `route_type`, `method`, `error_name`, `error_code`, `digest`, `message`
   ≤ 500, `frames text[]` ≤ 20, `request_id uuid`, `tenant_id uuid null`, `user_id uuid null`, unique
   `(fingerprint, occurred_on)`); `ops.error_event_overflow(day date primary key, dropped int)`;
   `public.ops_ingest_error(p_ingest_key text, p_event jsonb) returns void` SECURITY DEFINER, `search_path = ''`:
   compares `encode(extensions.digest(p_ingest_key, 'sha256'), 'hex')` with the vault secret
   `ops_error_ingest_key_sha256`, validates types and lengths, enforces a daily cap of new fingerprints (overflow
   counter beyond it), upserts `count`/`last_seen`; `revoke all … from public; grant execute … to anon, authenticated`.
   `ops.purge_error_events(p_older_than interval default '180 days') returns int` and `ops.error_events_size()`, not
   granted to API roles; scheduling the purge is V2-04 (R-27).
2. **Scrubber:** `scrubMessage`: `stripPiiFromText` (Indian mobile, Aadhaar, ABHA) + email, PAN, `Key (…)=(…)` details,
   `Failing row contains (…)`, digit runs ≥ 6, UUIDs, URL query strings; truncate to 500. Frames: `file:line`
   relative to the repo, ≤ 20. Paths: only `context.routePath` (the pattern, e.g. `/r/[token]`) is stored, never
   `request.path` (it carries tokens and the query string).
3. **Capture:** `onRequestError(err, request, context)` builds the event (name, SQLSTATE/code, digest, scrubbed
   message, frames, route pattern and type, method, request id from the request headers, `APP_ENV`, release) and
   writes `log.error({ event: "request.error", requestId, route, code })`. If `ERROR_INGEST_KEY` is set, the sink POSTs
   to `${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/ops_ingest_error` with the publishable key, a 2 s timeout, and never
   throws. Plain `fetch` — no new Supabase client factory, so the ADR-0005 D4 list is unchanged (R-7).
4. **Diag route (R-18):** `POST /api/diag/error`: `Authorization: Bearer <CRON_SECRET>` checked first (timing-safe,
   401), then `DIAG_ERROR_ROUTE_ENABLED !== "true"` → 404, then throws a synthetic error containing a synthetic phone,
   email and a `Key (phone)=(…)` detail. The schema forbids `true` in production. GET → 405.
5. `export-error-events.mjs` (loopback only): exports the scrubbed columns for given request ids as JSON (evidence).
   `check-error-export.mjs <file>`: passes only if the columns are the allowed set and no scrub pattern matches (used
   for the staging export, E9). Runbook: the E9 SQL (hash only) and the staging export query.

### Tests that fail without the change
- `scrub.spec.ts` (the roadmap's scrubber test): a corpus of synthetic Indian mobiles (+91, 0-prefixed, bare 10
  digits), Aadhaar with spaces, ABHA, PAN, emails, Postgres `Key (phone)=(…)` and `Failing row contains (…)` details,
  long digit runs, UUIDs and tokens → none survive; benign text is kept; truncation holds.
- `error-sink-db.spec.ts` (DB lane): wrong key → no row; right key → row; the same fingerprint twice on one day →
  one row with `count = 2`; oversize input rejected; past the cap → overflow increments; `anon` cannot `select` from
  `ops.error_events`; `/rest/v1/error_events` is not served.
- `on-request-error.spec.ts` (DB lane): the exported `onRequestError` with an error carrying synthetic PII and a
  request path with `?phone=…` → one row whose message is scrubbed, whose `route_path` is the pattern, and with no query
  string anywhere.
- e2e `error-sink.spec.ts`: `POST /api/diag/error` with the e2e cron secret → 500; exactly one `ops.error_events` row
  carries the response's `x-request-id`; its message has no phone or email; `export-error-events.mjs` writes
  `evidence/error-events-export.json`. Guard routes: the diag route passes the `cron-secret` legs.

### Acceptance mapping
"a thrown server error appears in the India-resident error sink with PII scrubbed": full locally (e2e on the local
Postgres sink); staging row export **pending PO (E9, E4)**. Evidence "an `ops.error_events` row export with scrubbed
fields": local export by tool now; staging export after E9. FT-07 sink: full (retention scheduling V2-04).

---

## 03-04 ESLint boundaries + acceptance counters (P1-34, ADR-0005 D4, C50 a/d/e, P1-21 ban, P1-25, 03-01 confinement) · S-M · Wave 7

### Files
`eslint.config.mjs`, `lint-fixtures/p1-34/*.ts` (+ `README.md` table of virtual target paths),
`tests/security/p1-34-lint-gates.spec.ts`, `scripts/phase-evidence.mjs` (V2-03 counters), and any straggler fixes the
new rules find (expected 0; each listed in 03-SUMMARY).

### Steps
1. Build the base gate lists once (`no-restricted-imports` paths/patterns, `no-restricted-syntax` selectors). Every
   `files:` override spreads the full base and adds only its own allowance (flat-config lists do not merge; pitfall 4).
   Messages are prefixed `P1-34:` (or `P1-21:`, `P1-25:`, `P1-15:`) so the spec can count them.
2. Rules (allowed paths in brackets; `tests/**` and `scripts/**` excepted per ADR D4):
   - import of `@/lib/supabase/system` [`lib/jobs/**`, `features/*/system.ts`, `app/api/{jobs,webhooks}/**`; register
     with owner and expiry comments: `app/api/v1/**`, `lib/api/**` (P1-37), `app/api/cron/**`,
     `lib/messaging/dispatcher.ts`, `lib/webhooks/**` (V2-04)];
   - import of `@/features/*/system` [same allow-list; `features/sharing/system` additionally from the 5 A1 routes only];
   - value import of `createClient` from `@supabase/supabase-js` [`lib/supabase/system.ts`]; `createServerClient` /
     `createBrowserClient` from `@supabase/ssr` [`lib/supabase/{server,client}.ts`, `proxy.ts`]; type imports allowed;
   - identifiers and string literals `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` [`lib/supabase/system.ts`,
     `lib/env*.ts`];
   - dynamic `import()` and `require()` of the factory or any `features/*/system` [nowhere];
   - imports of `lib/jobs/**` internals from actions/routes [nowhere outside `lib/jobs/**`];
   - `process.env` member access [`lib/env*.ts`, `next.config.ts`, `instrumentation.ts`];
   - `no-console: error` [`lib/log/**`];
   - UTC-date patterns: `.toISOString().split(…)`, `.toISOString().slice(0, 10)` / `.substring(0, 10)`, template or
     string literals containing `T00:00:00` or `T23:59:59` [`lib/datetime/**`].
3. `scripts/phase-evidence.mjs` `static-checks.json` gains: `p1_34_boundary_messages` (ESLint run over app code, count
   of the prefixed messages), `service_role_factories` (files flagged when the `createClient` value-import restriction
   is applied to every file through `overrideConfig` — computed by ESLint, expected `["lib/supabase/system.ts"]`) and
   `utc_today_messages` (count of `P1-21:` messages, expected 0).

### Tests that fail without the change
`p1-34-lint-gates.spec.ts` with `ESLint#lintText(source, { filePath })` at virtual paths:
- fail (severity 2, prefixed): a server action importing the system factory; a dashboard page importing it; a
  feature service importing `features/sharing/system`; a non-A1 route importing it; dynamic `import()` and `require()`
  of the factory; a `createClient` value import in a feature; the secret-key identifier and string in a feature;
  `process.env.X` in a feature; `console.error` in a feature; each UTC-date pattern; an action importing a
  `lib/jobs/internal` module;
- pass: each of the 5 A1 routes; `app/api/webhooks/x/route.ts`; the register paths (`app/api/v1/x/route.ts`,
  `lib/webhooks/x.ts`, `app/api/cron/x/route.ts`); a `type` import of `SupabaseClient`; `process.env` in
  `lib/env.ts`; `console` in `lib/log/x.ts`; the patterns in `lib/datetime/x.ts`;
- self-test: the AUTH-01 and P0-13 bans still fire inside `app/api/v1/x/route.ts` and `app/api/cron/x/route.ts`;
- repo: `lintFiles(["app","components","features","lib","proxy.ts","instrumentation.ts","next.config.ts"])` yields 0
  prefixed messages.

### Acceptance mapping
"ESLint finds 1 service-role factory and 0 service-role imports outside the allow-list and the ADR-0005 exception
register, and the bypass fixtures fail lint": full. "0 UTC 'today' sites": full (with 03-05). Tooling ignores (P1-34):
already present (research), noted in the summary.

---

## 03-11b Send Email hook + `EmailSender` (AUTH-03 local half, A00-1 magiclink drop, PO-A3, R-10, R-31) · M · Wave 8

### Files
`lib/email/{types,index,ses,mailpit,disabled}.ts`, `lib/email/templates/auth.ts`, `app/api/auth/send-email/route.ts`,
`lib/env.ts` + `lib/env-server.ts` (`EMAIL_PROVIDER` = `mailpit|ses|disabled`, `EMAIL_FROM`, `MAILPIT_API_URL`,
`AWS_REGION`, `SEND_EMAIL_HOOK_SECRET`), `.env.example`, `tests/setup/test-env.ts` (AWS credential names forbidden;
local pins), `tests/e2e/support/app-env.ts`, `tests/security/guard-manifest.ts` + `tests/security/guard/engine.ts` (new
kind `webhook-signature`), `package.json` / lock (`standardwebhooks`, `@aws-sdk/client-sesv2`),
`lint-fixtures/auth-hook/*.json` (synthetic payloads with the spike E3 key lists), `tests/auth/send-email-hook.spec.ts`,
`tests/auth/ses-sender.spec.ts`, `tests/integration/auth/mailpit-sender.spec.ts`, `docs/runbooks/auth-email.md`,
`evidence/package-legitimacy.json` (SES SDK part).

### Steps
1. `EmailSender.send({ to, subject, html, text, tag }) → { providerMessageId }`. `SesEmailSender`: SESv2
   `SendEmailCommand`, region `ap-south-1`, from `EMAIL_FROM`, credentials from the SDK default chain (Vercel env keys of
   a least-privilege IAM user, R-31), client injectable. `MailpitEmailSender`: loopback `POST ${MAILPIT_API_URL}/api/v1/send`;
   refused unless the URL is loopback and `APP_ENV` ∈ development | test | e2e | ci. `DisabledEmailSender` throws
   `EmailDisabledError`. Env rules: production requires `ses` + `EMAIL_FROM` + `AWS_REGION=ap-south-1` + hook secret
   (`v1,whsec_` format); staging allows `ses` or `disabled`; `mailpit` is forbidden in staging/production.
2. Code-only templates (signup confirmation, recovery, invite, email change): subject + HTML + text containing the
   6-digit code and no URL, matching the copy of `supabase/templates/*.html`.
3. Route (public, authenticated by signature): POST only; verify the standard-webhooks signature over the raw body with
   `SEND_EMAIL_HOOK_SECRET` (timestamp tolerance from the library) → 401 on failure; zod-parse the payload;
   `email_action_type` `magiclink` → 200 and **no send** (`log.info({ event: "auth.email.dropped", reason:
   "magiclink" })`, A00-1); `signup`, `recovery`, `invite`, `email_change` → render + send, 200 only after the provider
   accepts; any other type → 200 dropped with a log line; sender failure or `disabled` → 500/503 with the Supabase hook
   error shape so Auth surfaces it; logs carry the event, action type and request id only — never the address or code.
4. Runbook `docs/runbooks/auth-email.md`: SES identity, Easy DKIM, custom MAIL FROM, DMARC, sandbox and production
   access, IAM policy (`ses:SendEmail` on the identity ARN with a `ses:FromAddress` condition), account-level
   suppression list for bounces/complaints (R-10), hook configuration, SMTP fallback (dashboard SMTP to
   `email-smtp.ap-south-1.amazonaws.com:587`), rollback (disable the hook → built-in mailer).

### Tests that fail without the change
- `send-email-hook.spec.ts` (fake sender, signed synthetic payloads): valid `recovery` → 200 and one send whose text
  contains the code; `magiclink` → 200 and zero sends; bad signature → 401 and zero sends; stale timestamp → 401;
  unknown action → 200 and zero sends; sender throws → 500; `disabled` → 503; log lines contain no address and no code.
- `ses-sender.spec.ts`: injected client receives one `SendEmailCommand` with region `ap-south-1`, the configured
  `FromEmailAddress`, one recipient and both bodies; no network.
- `mailpit-sender.spec.ts` (local stack): a message sent through `MailpitEmailSender` is readable from the Mailpit API
  with the expected subject; a non-loopback URL is refused.
- Guard routes: `webhook-signature` legs (no signature → 401, zero sends).

### Acceptance mapping
"staging sends a password-reset code through SES with DKIM passing": code, local proofs and runbook full; the staging
send **pending PO (E0, E5, E6, E8, E4)**. AUTH-03 bounce webhook: R-10 (V2-04).

---

## 03-08 Staging environment as code (P1-35a, FT-01, R-9, R-19, R-21, R-26, R-30) · S-M · Wave 8

### Files
`vercel.json` (`regions: ["bom1"]`), `.github/workflows/staging.yml`, `.github/workflows/drift.yml`,
`scripts/staging/target-guard.mjs`, `scripts/staging/wait-for-release.mjs`, `scripts/seed/demo-clinic.ts` (seeding core
extracted from `scripts/seed-local-dev.ts`; its loopback guard unchanged), `scripts/seed-local-dev.ts`,
`scripts/seed-staging.ts`, `scripts/ci/workflow-policy.mjs` + `.github/workflows/ci.yml` (`static` step),
`lint-fixtures/workflows/*.yml`, `tests/ci/workflow-policy.spec.ts`, `tests/ci/staging-scripts.spec.ts`,
`docs/runbooks/staging.md`.

### Steps
1. **`staging.yml`:** `on: push` to `feature/v2` with `paths: supabase/migrations/**`, and `workflow_dispatch` (input
   `task`: `migrate` | `seed`); **never** `pull_request`; `permissions: contents: read`; `concurrency: staging`
   (no cancel); every `uses:` SHA-pinned. Job `migrate` (`environment: staging`, PO is the required reviewer): checkout,
   `npm ci`, `target-guard.mjs` (refuses a loopback URL or a host not containing `SUPABASE_PROJECT_REF_STAGING`),
   `npx supabase db push --db-url "$STAGING_DB_URL" --dry-run`, then without `--dry-run`, then
   `wait-for-release.mjs "$STAGING_ORIGIN" "$GITHUB_SHA"` (polls `/api/health` until `release` equals the SHA, ≤ 10 min)
   and `/api/ready` → 200 with `latest_migration` equal to the newest file in `supabase/migrations`. Job `seed`
   (dispatch only, `environment: staging`): `scripts/seed-staging.ts` with `APP_ENV=staging`, the staging secret key and
   `STAGING_SEED_PASSWORD` from the Environment; same target guard. Agents never dispatch this workflow (R-9).
2. **`drift.yml`:** `schedule` (`0 21 * * *`, 02:30 IST) + `workflow_dispatch`; `environment: staging-readonly` (no
   reviewer, branch `feature/v2`, read-only secrets); jobs `auth-config` (`scripts/drift/auth-config-hosted.mjs` from
   03-11a), `schema` (`npx supabase db diff --db-url "$STAGING_DB_URL_RO" --schema public` with the same allowlist as
   `local-drift.mjs`; verify at execution that the CLI only reads the target), `region` (`/api/health` → `region ===
   "bom1"`, else fail with "record the deviation (FT-01)").
3. **`workflow-policy.mjs`** (line-based policy checker, documented limits; runs in `static` over `.github/workflows/*`):
   every `uses:` pinned to a 40-hex SHA; top-level `permissions` present; `staging.yml`/`drift.yml` have no
   `pull_request`/`pull_request_target` trigger; any job referencing a `STAGING_*` secret declares an `environment`.
4. Runbook `docs/runbooks/staging.md`: create (E2), Vercel (E4), Environments (E10), the read-only DB role SQL
   (statement without password; the PO sets it), deploy order (expand → migrate → contract makes the Vercel/migration
   race safe), seed, reset, key rotation, pause cap (FT-01), `bom1` check, rollback.

### Tests that fail without the change
- `workflow-policy.spec.ts`: fixture workflows — an unpinned `uses:`, a `pull_request` trigger in a staging fixture, a
  job using `STAGING_DB_URL` without `environment` → each exits 1 naming the rule; the repo's workflows → 0.
- `staging-scripts.spec.ts`: `target-guard` refuses loopback and ref mismatch and accepts a matching synthetic host;
  `wait-for-release` (injected fetch) exits 0 when `release` matches and 1 on timeout; `seed-staging` refuses without
  `APP_ENV=staging` or with a loopback URL; `seed-local-dev` still refuses non-loopback (existing guard unchanged).

### Acceptance mapping
"staging deploys from CI": workflow, guards, runbook full and tested locally; the first approved run + Vercel deploy
link **pending PO (E1b, E2, E4, E10)**; closes after the phase PR merges because these workflows run from
`feature/v2` (R-19). "staging functions run in `bom1`, or the deviation is recorded": `vercel.json` + `/api/health`
`region` (03-01) + the `region` job; result **pending PO (E4)**.

---

## 03-12a FT-05 + change password + reset completion + error catalogue (AUTH-04b part, FT-05, A00-4 unit, A00-5, R-5, R-34) · M · Wave 9

### Files
`lib/auth/pwned.ts`, `features/auth/errors.ts`, `messages/en.ts`, `features/auth/password-flows.ts`,
`features/auth/actions.ts` (new `"use server"`), `features/auth/service.ts` (new, `server-only`),
`features/auth/schemas.ts`, `app/(dashboard)/profile/page.tsx`, `components/profile/change-password-form.tsx`,
`app/(auth)/forgot-password/page.tsx` (final step), `lib/env.ts` + `lib/env-server.ts` (`PWNED_CHECK` on|off default
off, required on in production; `PWNED_API_BASE_URL` overridable only in development/test/e2e), `.env.example`,
`tests/setup/test-env.ts`, `tests/e2e/support/app-env.ts` (`PWNED_CHECK=on`, loopback base),
`tests/e2e/global-setup.ts` + `tests/e2e/support/pwned-range-server.ts` (fake range API on `127.0.0.1`),
`tests/security/guard-manifest.ts` + `tests/security/guard/engine.ts` (new action kind `self`), tests
`tests/auth/pwned.spec.ts`, `tests/auth/password-schemas-and-errors.spec.ts`, `tests/integration/auth/change-password.spec.ts`,
`tests/integration/auth/reset-completion.spec.ts`, `tests/e2e/auth/j-a4-reset.spec.ts`,
`tests/e2e/auth/j-a5-change-password.spec.ts`, `tests/e2e/a11y/v2-01-screens.spec.ts` (profile form).

### Steps
1. **FT-05 `isPwnedPassword(password, { fetcher, timeoutMs = 1500, baseUrl })` → `pwned | clear | unavailable |
   skipped`:** SHA-1 (`node:crypto`), `GET ${baseUrl}/range/<5 hex>` with `Add-Padding: true`; lines with count 0 are
   ignored; unavailable (network, timeout, non-200) → `unavailable` + `log.warn({ event: "pwned.unavailable" })` and the
   password is allowed (FT-05); the prefix is never logged; `PWNED_CHECK=off` → `skipped`.
2. **Error catalogue** (`features/auth/errors.ts` + `messages/en.ts`, AUTH §4.2): fixed copy for
   `invalid_credentials`, `email_not_confirmed`, `over_request_rate_limit` and `over_email_send_rate_limit` (one "wait a
   minute" message, A00-4), `otp_expired`, `weak_password`, `same_password`, `captcha_failed`,
   `current_password_required`, `current_password_invalid`, `user_already_exists`, `otp_disabled`, `signup_disabled`,
   `session_not_found`, app codes `pwned_password` and `reauth_required`, and a generic fallback.
   `password-flows.ts` uses it.
3. **`features/auth/service.ts`:** reads claims through the cookie client (`getClaims()`); `assertFreshOtpSession(600)`
   checks the latest `amr` entry's method (`otp`/`recovery`) and timestamp (A00-5 bound).
4. **Actions** (both authenticated from the session, zod 10 chars min / 72 bytes max, FT-05 first, then
   `signOut({ scope: "others" })` on success; no `*Override` params; guard kind `self`):
   - `changePasswordAction({ currentPassword, newPassword })`: if the latest `amr` is `otp`/`recovery` and older than
     10 min → `reauth_required`; `updateUser({ password, current_password })` (verify the supabase-js field name at
     execution). Hosted "require current password" enforces the current password; the CLI stack cannot (R-34).
   - `setNewPasswordAction({ newPassword })`: requires a fresh `otp`/`recovery` session (≤ 10 min); used by the
     forgot-password final step. `verifyOtp({ type: "recovery" })` stays in the browser (R-5).
5. UI: "Change password" section on `/profile` (current, new, confirm; generic errors; success copy "Password changed.
   Other devices were signed out."); restyle is V2-11.

### Tests that fail without the change
- `pwned.spec.ts` (roadmap FT-05 units, mocked range API): hit → `pwned`; miss → `clear`; API down → `unavailable` +
  one warn line without the prefix; padded count-0 line equal to the suffix → `clear`; timeout → `unavailable`; flag
  off → `skipped`, no fetch.
- `password-schemas-and-errors.spec.ts`: each code above maps to its fixed copy; unknown → generic.
- `change-password.spec.ts` (DB lane, real local GoTrue, `globalThis.fetch` stubbed for the range API): breached new
  password → `pwned_password`, password unchanged; valid change → new password signs in, old fails, a second session's
  refresh fails; recovery session older than 10 min (`vi.setSystemTime`) → `reauth_required`; unauthenticated →
  rejected.
- `reset-completion.spec.ts`: recovery code (Mailpit) → `verifyOtp` → `setNewPasswordAction` with a breached password →
  rejected; with a clear one → other sessions signed out; called from a plain password session → rejected.
- e2e J-A4 (pixel-7 + desktop-chrome): forgot → code from Mailpit → breached password rejected with the catalogue copy
  (fake range server) → clear password accepted → the second browser context is signed out. J-A5: change password
  end to end. axe 0 serious/critical on the profile form at 360/820/1280, no horizontal scroll at 360.
- Guard actions: both actions in the manifest; the `self` legs pass.

### Acceptance mapping
"a password from the Pwned Passwords corpus is rejected by the change-password and reset actions (FT-05)": full
locally (mocked range API + loopback fake server); real-API check on staging **pending PO (E4)**. AUTH-04b change
password + error mapping: full. A00-5 app bound: full; hosted part pending PO (E3).

---

## 03-12b `POST /auth/signout` + OA-5 default-deny (AUTH-04b part, PWA D-5, OA-5, R-28) · S-M · Wave 10

### Files
`app/auth/signout/route.ts`, `components/layout/user-dropdown.tsx`, `lib/auth/public-paths.ts`, `proxy.ts`,
`tests/security/guard-manifest.ts` + `tests/security/guard/engine.ts` (new route kind `signout`),
`tests/auth/public-paths.spec.ts`, `tests/auth/signout-route.spec.ts`, `tests/e2e/auth/signout.spec.ts`,
`tests/e2e/security/unauth-pages.spec.ts`.

### Steps
1. **Route:** POST only (GET → 405); same-origin required (`Origin` equals the `NEXT_PUBLIC_APP_URL` origin, or
   `Sec-Fetch-Site: same-origin`) else 403; form field `scope` ∈ `local` (default) | `global`;
   `supabase.auth.signOut({ scope })` on the cookie client (server-side session revocation; auth cookies cleared by the
   client's `setAll`); response 303 → `/login` with `Clear-Site-Data: "cache"`. `hardSignOut()` is V2-06 (PWA-02).
2. **User dropdown:** a `<form method="post" action="/auth/signout">` replaces the client `signOut()` (which signed out
   every device); a second option posts `scope=global` ("Sign out of all devices").
3. **OA-5 default-deny in `proxy.ts`:** after `getClaims()`, no claims + a non-public page path → 307 to
   `/login?next=<path + search>`. Public: `/login`, `/forgot-password`, `/join`, `/r/`, `/reports/view`, `/reschedule/`,
   `/auth/`, Next internals and static files; `/api/**` is excluded (handlers authenticate themselves). Everything else,
   including `/clinic/new`, is protected, so a new page defaults to protected.

### Tests that fail without the change
- `public-paths.spec.ts`: enumerates every `page.tsx` under `app/`; dashboard and onboarding pages → protected; the
  `(auth)`, `r`, `reports`, `reschedule` pages → public; every public prefix matches at least one existing page (no
  stale entries).
- `signout-route.spec.ts`: cross-origin POST → 403, GET → 405, no session → 303 to `/login` with no data.
- e2e `signout.spec.ts`: the sign-out response is 303 with `Clear-Site-Data: "cache"`; the old refresh token then fails
  at GoTrue (`refresh_token_not_found`, server-side revocation); `local` leaves a second context signed in, `global`
  signs out both.
- e2e `unauth-pages.spec.ts` (extended): for every enumerated dashboard route, the **raw** response
  (`maxRedirects: 0`) is 307 with `location` `/login?next=<encoded path>` (before: rendered then redirected by the layout
  without `next`), and `ops.error_events` has 0 rows whose `request_id` is one of those responses' `x-request-id`
  (before: page data loaders threw "Unauthenticated" into the sink). This is the OA-5 proof.

### Acceptance mapping
"`POST /auth/signout` clears the session server-side and returns `Clear-Site-Data: "cache"`": full. OA-5 carry-over:
full.

---

## 03-12c Turnstile + safe `next` + J-A3 + AUTH-00 re-check kit (AUTH-04b part, C43, A00-4 probe, AUTH-00 staging re-check, R-22) · M · Wave 10

### Files
`components/auth/turnstile-field.tsx`, `app/(auth)/login/page.tsx`, `app/(auth)/forgot-password/page.tsx` (request
step), `features/auth/password-flows.ts` (`captchaToken`), `lib/auth/safe-next.ts`, `lib/env.ts`
(`NEXT_PUBLIC_TURNSTILE_SITE_KEY`: production requires a non-test key; local/ci/e2e allow only Cloudflare test keys;
staging optional), `.env.example`, `tests/setup/test-env.ts`, `tests/e2e/support/app-env.ts` (test key
`1x00000000000000000000AA`), `tests/e2e/fixtures.ts` + `tests/e2e/support/turnstile-stub.js` (the Cloudflare script is
fulfilled locally; the network block stays on), `package.json` / lock (`@marsidev/react-turnstile`),
`scripts/staging/auth00-recheck.ts`, `.github/workflows/staging.yml` (job `auth00-recheck`, dispatch only,
`environment: staging`), tests `tests/auth/safe-next.spec.ts`, `tests/e2e/auth/j-a3-login.spec.ts`,
`tests/e2e/auth/turnstile.spec.ts`, `tests/integration/auth/auth00-recheck-kit.spec.ts`,
`evidence/package-legitimacy.json` (Turnstile part).

### Steps
1. **Turnstile (C43, Managed mode):** rendered when the site key is set; passes `options.captchaToken` to
   `signInWithPassword` and `resetPasswordForEmail`; resets after every attempt (tokens are single-use); expiry and
   load-failure states with accessible copy. No app-side `siteverify` (Supabase verifies). Local GoTrue has CAPTCHA off
   (03-11a), so the local lanes prove the wiring, not Cloudflare (R-22).
2. **Safe `next`:** `safeNextPath(raw)` accepts only `^/(?![/\\])`, rejects control characters, encoded slashes or
   backslashes after decoding, and lengths > 512; login uses it after sign-in (`router.replace(safe ?? "/")`).
3. **AUTH-00 re-check kit** (`auth00-recheck.ts`): creates its own synthetic users with the secret key (admin
   `createUser`, `generateLink` returns codes, no mailbox), runs the hosted-only items, writes a JSON report, deletes the
   users. Items: (1) `verifyOtp` type matrix; (2) CAPTCHA: missing token → `captcha_failed` on `/token` and `/recover`,
   token-accepted path recorded from the PO's browser check (E7); (3) require-current-password incl. the OTP/recovery
   exemption; (4) `postgres` DELETE privilege on `auth.sessions` (catalogue read); (5) signup for an existing address
   (`signup_disabled` while signups are off, A00-3); (6) **one** per-IP burst probe of ≤ 40 password grants for a
   synthetic user (A00-4); (7) failed-sign-in log retention (PO dashboard observation, recorded); (8) `amr` shape;
   (9) `@supabase/ssr` version (resolved by 03-06). Locally the kit runs against the CLI stack; on staging only through
   `staging.yml` `auth00-recheck` after PO approval.

### Tests that fail without the change
- `safe-next.spec.ts`: `/patients` → kept; `//evil.example`, `/\evil.example`, `https://evil.example`,
  `/%2F%2Fevil.example`, `javascript:alert(1)`, a control character, 600 chars → rejected.
- e2e `turnstile.spec.ts`: the GoTrue `/token` request body carries `gotrue_meta_security.captcha_token` equal to the
  stub token on sign-in, and `/recover` carries one on reset; after a failed sign-in the second attempt carries a
  different token (reset happened).
- e2e J-A3 (pixel-7 + desktop-chrome): wrong password → the catalogue's generic copy; right password → the role's
  home; `?next=/patients` honoured; `?next=//evil.example` lands on `/`. axe 0 serious/critical on login and
  forgot-password with the widget at 360/820/1280.
- `auth00-recheck-kit.spec.ts` (local stack): the kit completes, writes a report with all nine items, records the
  local values (e.g. require-current-password "not configurable on CLI"), and leaves no users behind.

### Acceptance mapping
"Turnstile is on sign-in and reset (signup does not exist until V2-13b)": full locally (test key + stub); live
Cloudflare on staging **pending PO (E7, E3)**. AUTH-04b safe `next`: full. AUTH-00 staging re-check: kit full; hosted
run **pending PO (E2, E3, E7, E10)**, results to VERIFICATION_LOG.

---

## Acceptance mapping (roadmap V2-03, binding)

| # | Acceptance item | Plan(s) | Local proof (tool output) | Hosted part | Status at the gate |
|---|---|---|---|---|---|
| 1 | production boot fails without real providers | 03-01 | `env-schema.spec.ts`, `env-boot.spec.ts` | Vercel build with `APP_ENV=staging` (E4) | Done locally |
| 2 | 1 service-role factory; 0 imports outside allow-list + register; bypass fixtures fail lint | 03-02, 03-04 | `p1-34-lint-gates.spec.ts`; `static-checks.json` counters | — | Done |
| 3 | fresh `db reset` matches target schema (drift = 0 or documented) | 03-03 | CI `local-drift` step (pg_net documented) | B1 read-only report from the v1 dump | Local done; hosted **pending PO (E1a)** |
| 4 | `tsc` passes with generated types | 03-03 | `npm run typecheck`; CI freshness diff | — | Done |
| 5 | 0 UTC "today" sites | 03-05, 03-04 | `utc_today_messages = 0`; IST boundary specs | — | Done |
| 6 | spike report: RLS, `auth.uid()` actor, audit + outbox in one transaction | 03-07 | `record-payment-rpc.spec.ts`; `03-07-D1-SPIKE.md` | — | Done |
| 7 | staging deploys from CI | 03-08 (+03-01 `release`) | workflow policy + script specs | first approved `staging.yml` run + Vercel deploy link | Code done; **pending PO (E1b, E2, E4, E10)**, post-merge (R-19) |
| 8 | thrown server error in the India-resident sink, PII scrubbed | 03-09b | e2e `error-sink.spec.ts`; `evidence/error-events-export.json` | staging diag error + export check | Local done; staging **pending PO (E9, E4)** |
| 9 | staging sends a password-reset code through SES with DKIM passing | 03-11b | hook/sender/Mailpit specs | reset mail with `dkim=pass` | Code done; **pending PO (E0, E5, E6, E8, E4)** |
| 10 | Turnstile on sign-in and reset | 03-12c | e2e `turnstile.spec.ts` | live widget + `captcha_failed` without token | Local done; live **pending PO (E7, E3)** |
| 11 | `POST /auth/signout` clears the session server-side + `Clear-Site-Data: "cache"` | 03-12b | e2e `signout.spec.ts` | — | Done |
| 12 | auth config drift check green | 03-11a, 03-08 | `static` policy check; hosted checker spec | `drift.yml` `auth-config` green | Local done; hosted **pending PO (E3, E10, E11)** |
| 13 | Pwned password rejected by change-password and reset actions (FT-05) | 03-12a | `pwned.spec.ts`, integration + J-A4 | real API on staging | Done locally; staging check **pending PO (E4)** |
| 14 | staging functions in `bom1`, or deviation recorded | 03-08, 03-01 | `region` job spec; `vercel.json` | `/api/health` `region` | Code done; **pending PO (E4)** |

Roadmap tests: unit (all plans); IST 00:00–05:30 (03-05); env-schema boot test (03-01); spike DB integration incl.
rollback (03-07); scrubber (03-09b); FT-05 hit/miss/down with mocked range API (03-12a). Roadmap evidence: CI links
(phase close); drift report (03-03, pending E1a); spike report (03-07); staging deploy link (03-08, pending); error
row export (03-09b local now, staging pending E9).

## PO actions for this phase

The orchestrator copies these into `.planning/PO-ACTIONS.md` under "V2-03 Platform hygiene". No secret value appears
here; secrets go only into the named store. **Order (lead times):** E0 → E1a → E1b → E1c → E2 → E5 + E6 (in parallel;
DKIM and production access take hours to days) → E4 → E7, E8, E9 → E10, E11 → E3. Hosted verifications that use
`staging.yml`/`drift.yml` run after the phase PR merges into `feature/v2` (R-19); none blocks the gate.

- [ ] **E0 · Decide the final domain**
  - *Do / where:* choose the product domain for "ClinicQ" (PO-19) at your registrar; note whether DNS is hosted at the
    registrar or Cloudflare.
  - *Values:* `<domain>`; derived names `auth.<domain>` (email), `staging.<domain>` (staging app).
  - *Why:* PO-19 fixed the name and the `auth.` pattern but no domain is recorded (R-13).
  - *Unblocks:* E4, E5, E6, E7, E8; the `{{STAGING_ORIGIN}}` value in `supabase/auth-policy.json`.
  - *Verify (Claude, read-only):* `dig +short NS <domain>`; record the domain in `docs/v2/VERIFICATION_LOG.md`.

- [ ] **E1a · Schema-only snapshot of the v1 test project (before pausing it)**
  - *Do / where:* on your machine, outside any agent session:
    `npx supabase db dump --schema-only --db-url "<v1 database URL from Dashboard → Connect>" -f <path outside the repo>/clinicq-v1-schema.sql`.
    Schema only, no data. Tell Claude the file path. Do not commit it.
  - *Why:* B1 requires a read-only drift report against the hosted project; a paused project cannot be dumped
    (pitfall 6).
  - *Unblocks:* acceptance item 3 hosted half; E1b.
  - *Verify (Claude):* `node scripts/drift/hosted-dump-diff.mjs <path>` (local scratch DB only) → writes
    `.planning/phases/03-platform-hygiene/evidence/b1/hosted-drift.{txt,json}`; drift is documented, not reconciled
    (production is built from migrations, C26).

- [ ] **E1b · Pause the v1 test project "TheCliniQ"**
  - *Do / where:* Supabase Dashboard → project "TheCliniQ" → Project Settings → General → Pause project (or delete it
    if nothing else needs it).
  - *Why:* FT-01; the Free plan allows two active projects.
  - *Unblocks:* E2.
  - *Verify (Claude):* `curl -s -o /dev/null -w "%{http_code}\n" "https://$(cat supabase/.temp/project-ref).supabase.co/auth/v1/health"`
    is not 200 (paused projects do not serve; assumption, confirmed by your screenshot of the paused state).

- [ ] **E1c · Unlink the local CLI from the v1 project**
  - *Do / where:* repo root: `npx supabase unlink` (after E1a and E1b).
  - *Why:* any CLI call without `--local` can otherwise target the hosted project (R-12, pitfall 2).
  - *Verify (Claude):* `test ! -e supabase/.temp/project-ref && echo unlinked`.

- [ ] **E2 · Staging Supabase organisation and project**
  - *Do / where:* supabase.com → New organization `clinicos-staging` (plan **Free**) → New project
    `clinicos-staging`, region **South Asia (Mumbai) ap-south-1**, Postgres 17, a generated database password stored in
    your password manager. Enable MFA on your Supabase account. Enable SSL enforcement / network restrictions if the
    Free plan offers them. Record the project ref (not secret) in VERIFICATION_LOG.
  - *Why:* FT-01, P1-35a. New projects issue only `sb_publishable_…`/`sb_secret_…` keys (R-K).
  - *Unblocks:* E3, E4, E8, E9, E10, E11; acceptance 7, 12, 14.
  - *Verify (Claude):* `curl -s -o /dev/null -w "%{http_code}\n" -H "apikey: <publishable key>" https://<staging-ref>.supabase.co/auth/v1/health`
    → 200 (the publishable key is public by design); region from your Settings → General screenshot.

- [ ] **E3 · Staging Auth settings (applied by you, checked by the drift job)**
  - *Do / where:* Claude gives you the output of `node scripts/ci/check-auth-config.mjs --print staging` (dashboard
    label → value). Apply it in Dashboard → Authentication: signups **off**; confirm email **on**; secure email change
    **on**; secure password change **off**; email OTP expiry 600 s, length 6; minimum password length 10; **Require
    current password when updating: on**; access-token (JWT) expiry 900 s; rate limits email sent 60/h, sign-ups and
    sign-ins 30, token refreshes 150, token verifications 30; MFA TOTP on; Site URL `https://staging.<domain>`, no
    extra redirect URLs; security notification "password changed" on; email templates pasted from
    `supabase/templates/*.html` (used only by the SMTP fallback); CAPTCHA after E7; Send Email hook after E8.
  - *Why:* AUTH-02/03, A00-1, A00-4, A00-5; settings are applied by you, not pushed from CI (R-20).
  - *Unblocks:* acceptance 10, 12; AUTH-00 re-check.
  - *Verify (Claude):* after merge, `gh run list --workflow drift.yml --limit 1 --json conclusion,url,headSha` → the
    `auth-config` job is green; `gh run view <id> --log --job <auth-config job id>` shows 0 diffs.

- [ ] **E4 · Vercel staging project**
  - *Do / where:* Vercel → New Project from `thecliniqai/cliniqai-app`, name `clinicos-staging`; Production Branch
    `feature/v2`; custom domain `staging.<domain>` (DNS record from Vercel at your DNS host); Functions region `bom1`
    (also set by `vercel.json`); Deployment Protection off for the production domain (the Send Email hook must reach it;
    assumption A2) and preview deployments disabled. Environment variables (names; values from your secret stores):
    `APP_ENV=staging`, `NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (sensitive), `NEXT_PUBLIC_APP_URL=https://staging.<domain>`,
    `CRON_SECRET` (random, ≥ 32 chars), `MESSAGING_PROVIDER=disabled` (until MSG91 staging credentials exist),
    `AI_ENABLED=false`, `API_V1_ENABLED=false`, `EMAIL_PROVIDER=disabled` (switch to `ses` after E6/E8),
    `EMAIL_FROM=no-reply@auth.<domain>`, `AWS_REGION=ap-south-1`, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` of the E6 IAM
    user, `SEND_EMAIL_HOOK_SECRET` (E8), `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (E7), `ERROR_INGEST_KEY` (E9),
    `PWNED_CHECK=on`, `DIAG_ERROR_ROUTE_ENABLED=false` (true only during E9). Do **not** set `R2_*`,
    `STORAGE_PROVIDER`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (the schema rejects them). On the
    existing v1 Vercel project, stop building `v2/**` and `feature/v2` previews (or set `APP_ENV` there), because v2
    builds now fail without `APP_ENV`.
  - *Why:* P1-35a, FT-01 `bom1`, acceptance 1, 7, 13, 14.
  - *Unblocks:* E8, E9; acceptance 7, 8, 13, 14.
  - *Verify (Claude):* `curl -sI https://staging.<domain>/api/health` → 200 with `x-request-id`;
    `curl -s https://staging.<domain>/api/health` → `"region":"bom1"` and `"release"` equal to
    `git rev-parse origin/feature/v2`; `curl -s https://staging.<domain>/api/ready` → `"status":"ok"`.

- [ ] **E5 · DNS records for `auth.<domain>`**
  - *Do / where:* at your DNS host: the 3 SES Easy-DKIM CNAMEs `<token>._domainkey.auth.<domain>` (values from E6);
    custom MAIL FROM `mail.auth.<domain>`: MX `10 feedback-smtp.ap-south-1.amazonses.com` and TXT
    `v=spf1 include:amazonses.com ~all`; DMARC TXT at `_dmarc.auth.<domain>`:
    `v=DMARC1; p=none; rua=mailto:<your inbox>` (tighten to `quarantine` after a clean week); the `staging` CNAME Vercel
    gives you.
  - *Why:* AUTH-03 DKIM pass.
  - *Unblocks:* acceptance 9.
  - *Verify (Claude):* `dig +short CNAME <token>._domainkey.auth.<domain>`; `dig +short MX mail.auth.<domain>`;
    `dig +short TXT mail.auth.<domain>`; `dig +short TXT _dmarc.auth.<domain>`.

- [ ] **E6 · Amazon SES in ap-south-1**
  - *Do / where:* AWS console, region Mumbai → SES → Identities → Create identity → Domain `auth.<domain>`, Easy DKIM
    RSA 2048, custom MAIL FROM `mail.auth.<domain>`; Account dashboard → **Request production access** (transactional,
    low volume, authentication codes); while in the sandbox, verify your own test recipient address; account-level
    suppression list on for bounces and complaints (R-10); IAM user `clinicos-staging-ses` with only `ses:SendEmail` on
    the identity ARN and condition `ses:FromAddress = no-reply@auth.<domain>`; its access key goes to Vercel (E4) only.
  - *Why:* AUTH-03, PO-A3; production access has lead time (AR-4).
  - *Unblocks:* acceptance 9; `EMAIL_PROVIDER=ses` on staging.
  - *Verify:* you paste the output of the read-only `aws sesv2 get-email-identity --email-identity auth.<domain>
    --region ap-south-1 --query "{verified:VerifiedForSendingStatus,dkim:DkimAttributes.Status}"` and
    `aws sesv2 get-account --region ap-south-1 --query ProductionAccessEnabled`; Claude checks the E5 records with `dig`.

- [ ] **E7 · Cloudflare Turnstile widget**
  - *Do / where:* Cloudflare dashboard → Turnstile → Add widget `clinicos-staging`, hostname `staging.<domain>`, mode
    **Managed**, no pre-clearance. Site key → Vercel `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (E4). Secret key → Supabase
    staging → Authentication → Bot and Abuse Protection → Enable CAPTCHA → Turnstile → secret.
  - *Why:* C43; acceptance 10.
  - *Unblocks:* AUTH-00 re-check item 2.
  - *Verify (Claude):* the `drift.yml` `auth-config` job confirms CAPTCHA enabled with provider Turnstile;
    `curl -s -o /dev/null -w "%{http_code}\n" https://staging.<domain>/login` → 200. You confirm one browser sign-in on
    staging succeeds with the widget (recorded with re-check item 2).

- [ ] **E8 · Send Email hook on staging**
  - *Do / where:* Supabase staging → Authentication → Hooks → Send Email → HTTPS
    `https://staging.<domain>/api/auth/send-email` → generate the secret → Vercel `SEND_EMAIL_HOOK_SECRET`; set
    `EMAIL_PROVIDER=ses` in Vercel and redeploy. Then request a password reset on staging for your SES-verified address.
  - *Why:* AUTH-03; the magiclink drop (A00-1).
  - *Unblocks:* acceptance 9.
  - *Verify:* the `drift.yml` `auth-config` job shows the hook enabled with that URI; you paste the received mail's
    `Authentication-Results` line (expect `dkim=pass header.d=auth.<domain>`; the message holds only a synthetic code).

- [ ] **E9 · Error-sink ingest key on staging + one diag error**
  - *Do / where:* generate a key locally (`openssl rand -hex 32`) → Vercel `ERROR_INGEST_KEY`; compute its hash locally
    (`printf %s "<key>" | shasum -a 256`) and run in the staging SQL editor
    `select vault.create_secret('<sha256 hex>', 'ops_error_ingest_key_sha256');` (hash only). Set
    `DIAG_ERROR_ROUTE_ENABLED=true`, redeploy, run `curl -s -X POST -H "authorization: Bearer <CRON_SECRET>"
    -D - https://staging.<domain>/api/diag/error` (note `x-request-id`), run the export query from
    `docs/runbooks/error-sink.md` for that request id, save it as JSON, then set the flag back to `false`.
  - *Why:* acceptance 8 on staging; evidence "an `ops.error_events` row export with scrubbed fields".
  - *Verify (Claude):* `node scripts/ops/check-error-export.mjs <export file>` passes (allowed columns only, no
    scrub pattern); the export is committed under `evidence/`.

- [ ] **E10 · GitHub Environments `staging` and `staging-readonly`**
  - *Do / where:* repo `thecliniqai/cliniqai-app` → Settings → Environments. `staging`: required reviewer = you,
    deployment branches `feature/v2` only; secrets `STAGING_DB_URL` (direct/session URL with the DB password),
    `STAGING_SECRET_KEY`, `STAGING_SEED_PASSWORD`; variables `SUPABASE_PROJECT_REF_STAGING`, `STAGING_ORIGIN`
    (`https://staging.<domain>`). `staging-readonly`: no reviewer, branch `feature/v2`; secrets
    `SUPABASE_ACCESS_TOKEN_STAGING_RO` (E11), `STAGING_DB_URL_RO` (the read-only role from `docs/runbooks/staging.md`,
    password set by you); same variables.
  - *Why:* R-9, R-21: migrations, seed and re-check only after your approval; nightly drift reads with read-only
    credentials.
  - *Unblocks:* acceptance 7, 12, 14; AUTH-00 re-check.
  - *Verify (Claude):* `gh api repos/thecliniqai/cliniqai-app/environments --jq '.environments[] | {name, rules: [.protection_rules[].type]}'`;
    `gh secret list --env staging` and `--env staging-readonly` (names only); `gh variable list --env staging`.

- [ ] **E11 · Supabase fine-grained read-only token**
  - *Do / where:* Supabase → Account → Access Tokens → fine-grained token `clinicos-staging-drift-ro`, permission
    **Auth config: read** (plus project metadata read if offered), scoped to organisation `clinicos-staging`, 90-day
    expiry → GitHub Environment `staging-readonly` secret `SUPABASE_ACCESS_TOKEN_STAGING_RO`.
  - *Why:* AUTH-02 hosted drift without a write-capable token.
  - *Unblocks:* acceptance 12.
  - *Verify (Claude):* the `drift.yml` `auth-config` job runs green after merge (`gh run view <id> --json jobs`).

- [ ] **E13 · Confirm the V2-03 rulings** — read the rulings table at the end of this plan (A00-1…A00-5, R-1…R-34,
  R-K) and confirm or overturn them; in particular **R-9** (CLAUDE.md says "never `db push`"; staging migrations would run
  only in the PO-approved `staging` Environment workflow that agents never dispatch) and the proposed CLAUDE.md Commands
  update (phase close step 6). *Verify:* your confirmation recorded in VERIFICATION_LOG's gate section.
- [ ] **E14 · Confirm two flagged packages** — `@aws-sdk/client-sesv2@3.1155.0` and `@marsidev/react-turnstile@1.6.2`
  (research verdict SUS "too-new", older pins taken). Review `evidence/package-legitimacy.json` (registry metadata,
  integrity, `npm audit signatures`). Blocks the merge, not local work (R-23). *Verify:* confirmation recorded.
- [ ] **E15 · Confirm the Next 16 outcome** — the upgrade record `03-06-NEXT16.md`, or, if the fallback ran, the
  deferral `03-06-NEXT16-DEFERRAL.md` with its 2026-12-14 re-check. *Verify:* confirmation recorded.
- (E12 = existing C-1, repo visibility; no new action.)

## Phase close

1. **Report gate:** add the new security and acceptance specs to `REQUIRED_FILES` in
   `scripts/ci/assert-vitest-report.mjs` (env-schema, env-boot, system-db, p1-34-lint-gates, record-payment-rpc, scrub,
   error-sink-db, send-email-hook, pwned, change-password, signout-route, public-paths) and update the floor with the
   arithmetic in the same commit.
2. **Local evidence (tool-produced):** `npm run typecheck`, `npx eslint .`, `npm run inventory`, `npm run ci:ai-l1`,
   `npm run ci:audit`; `node scripts/phase-evidence.mjs .planning/phases/03-platform-hygiene/evidence 2` (two full
   Vitest runs + `static-checks.json` with the V2-03 counters); `npm run e2e:build && npm run e2e:pr` with the JSON
   report copied into `evidence/`; `node scripts/ops/export-error-events.mjs` output; `evidence/b1/` (local drift; the
   hosted report if E1a arrived); `evidence/package-legitimacy.json`; the 03-06 before/after outputs.
3. **CI (orchestrator):** push; mark the PR ready; all five checks green with 0 retried tests; then
   `node scripts/phase-evidence.mjs .planning/phases/03-platform-hygiene/evidence --ci-run <id>`.
4. **Reviews (CLAUDE.md DoD 6)** into `.planning/phases/03-platform-hygiene/reviews/`: one independent review of the
   full diff by an isolated reviewer (fresh context, no implementer reasoning) → `v203-review-independent.md`; adversarial
   second reviews, one per security-sensitive group: (A) env/config/fail-closed rules and staging workflows/secrets
   (03-01, 03-08) → `v203-review-adversarial-env-staging.md`; (B) service role, boundaries, migrations, RLS and RPCs
   (03-02, 03-03, 03-04, 03-07, migration 000025-000028) → `…-service-role-db.md`; (C) logging, PII, error sink, diag
   route (03-09a/b/c) → `…-logging-pii.md`; (D) auth, session, proxy, hook, Turnstile, FT-05 (03-06 proxy, 03-11a/b,
   03-12a/b/c) → `…-auth-session.md`; (E) SSRF and webhooks (03-10) → `…-ssrf.md`. Triage as in V2-02: fixes land in a
   review-fix plan `03-13` on this branch with regression tests; accepted items are recorded with a reason and owner.
5. **Documents:** `03-SUMMARY.md` (what shipped per plan, deviations, deferrals with owners: live AI eval lane V2-12,
   SES bounce webhook V2-04, purge scheduling V2-04, client error capture V2-06, SQL date defaults V2-05, FY numbering
   V2-10; event-name list; proposed doc errata for PO approval (R-24); the pending-PO list); `03-VERIFICATION.md`
   (the acceptance table above with tool evidence: CI run link + commit SHA + evidence files; hosted items marked
   "pending PO (E…)"); the V2-03 gate entry in `docs/v2/VERIFICATION_LOG.md`.
6. **Proposed CLAUDE.md Commands update (PO approves, E13):** the never-run list gains `scripts/seed-staging.ts`,
   `scripts/staging/*`, `scripts/drift/auth-config-hosted.mjs` with a real token, and dispatching `staging.yml` /
   `drift.yml`; the commands gain `npm run db:types`, `npm run db:drift:local`, `node scripts/ci/env-example.mjs`.
7. **After merge (post-gate):** the PO works through E0–E11; Claude runs each verify command, ticks the item in
   `.planning/PO-ACTIONS.md` with evidence, and updates `03-VERIFICATION.md` and VERIFICATION_LOG for acceptance items
   3, 7, 8, 9, 10, 12, 13, 14.

## Threat model (STRIDE register, phase-wide)

| Threat ID | Category | Component | Severity | Disposition | Mitigation |
|---|---|---|---|---|---|
| T-03-01 | Elevation | service role reachable from a request path | high | mitigate | single factory, fallback deleted (03-02); ESLint allow-list + register + bypass fixtures (03-04) |
| T-03-02 | DoS | anon-executable `ops_ingest_error` | medium | mitigate | ingest key hash, fingerprint/day upsert, daily cap + overflow counter, size check (03-09b) |
| T-03-03 | Info disclosure | PHI in logs and error rows | high | mitigate | closed logger fields (03-09a), sweep (03-09c), scrubber + route pattern only (03-09b), `no-console` (03-04) |
| T-03-04 | Spoofing | open redirect via `next` | medium | mitigate | `safeNextPath` + unit cases (03-12c) |
| T-03-05 | Spoofing | forged Send Email hook calls | high | mitigate | standard-webhooks signature + tolerance; 401 without send (03-11b) |
| T-03-06 | Elevation | mailbox password bypass via `/otp` magiclink | high | mitigate | hook drops `magiclink`; signups off everywhere (A00-1) |
| T-03-07 | Repudiation | request-id spoofing | low | mitigate | proxy overwrites inbound `x-request-id` (03-09a) |
| T-03-08 | Tampering | stale R2/legacy key config in hosted env | medium | mitigate | schema deny-list fails boot (03-01) |
| T-03-09 | Elevation | staging secrets exfiltrated via a PR workflow | high | mitigate | no `pull_request` trigger, Environment approval + branch policy, workflow-policy check (03-08) |
| T-03-10 | Info disclosure | drift report prints hosted secrets | medium | mitigate | secret-bearing fields never compared or printed; spec asserts it (03-11a) |
| T-03-11 | Tampering | SSRF through webhook endpoints | high | mitigate | DNS always resolved via injectable resolver; private ranges blocked; no test bypass (03-10) |
| T-03-12 | Elevation | password changed from a stale recovery session | high | mitigate | 10-min `amr` bound, others signed out, hosted require-current (03-12a, A00-5) |
| T-03-13 | Spoofing | CSRF sign-out | low | mitigate | POST only + same-origin check (03-12b) |
| T-03-14 | Info disclosure | share tokens in error paths | high | mitigate | only `context.routePath` stored; query strings dropped (03-09b) |
| T-03-15 | Elevation | diag route live in production | medium | mitigate | bearer first, flag second, schema forbids the flag in production (03-09b) |
| T-03-16 | Tampering | edits to applied migrations | medium | mitigate | immutability check in `static` (03-03) |
| T-03-17 | Info disclosure | v1 schema dump handled by the agent | low | mitigate | schema only, never committed, scratch DB dropped (03-03) |
| T-03-18 | Info disclosure | clinic enumeration via `referral_source_clinics` | medium | mitigate | rows only for RLS-visible inbound referrals; anon revoked (03-02) |
| T-03-19 | DoS | lock contention in `record_payment` | low | mitigate | `statement_timeout`, single-row lock (03-07) |
| T-03-20 | Spoofing | CAPTCHA bypass with `sb_secret_` keys | medium | accept | secret key never reaches the browser; behaviour re-checked on staging (A5, 03-12c kit) |
| T-03-21 | Info disclosure | self-only FT-05 bypass via direct `updateUser` | low | accept | affects only the caller's own account; closes with Pro HIBP (R-5) |
| T-03-SC | Tampering | npm installs | high | mitigate | research legitimacy audit, exact pins, no install scripts, `npm audit signatures`, PO confirmation for SUS pins (E14) |

## Risks

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| K-1 | Next 16 / Turbopack breaks the build scan or a dependency | M | H | `--webpack` option; rollback note; dated deferral fallback (03-06) |
| K-2 | `jwt_expiry = 900` expires long-lived test clients mid-run | M | M | supabase-js auto-refresh; re-sign in the seeded world per batch if a run exceeds 15 min (03-11a full-lane check) |
| K-3 | `max_frequency = 60s` breaks specs requesting two codes for one address | H | L | fresh synthetic address per request (03-11a) |
| K-4 | Parallel implementers collide on the single local stack | M | M | lock + one stack disruptor per wave; orchestrator may serialise |
| K-5 | Hosted auth-config field names differ from the mapping (A4) | M | L | checker fails on unmapped fields; pin from the first real run |
| K-6 | Vercel protection blocks the hook (A2) | M | M | production-domain staging project (E4) |
| K-7 | SES sandbox / production-access lead time (AR-4) | M | M | E6 filed on day 1; sandbox + verified recipient is enough for acceptance 9 (A6) |
| K-8 | `supabase db diff --db-url` semantics differ from the assumption | L | M | verify at execution; migra-image alternative (03-03, 03-08) |
| K-9 | v1 Vercel project builds v2 branches and fails on `APP_ENV` | H | L | E4 step on the v1 project |
| K-10 | Hosted acceptance items stay open while the PO is unavailable | H | M | marked "pending PO" with exact steps and verify commands; close post-merge |

## Rulings (agent acting as CTO under PO delegation; PO confirms at the gate, E13)

| # | Decision | Rationale |
|---|---|---|
| A00-1 | `enable_signup = false` on every environment until AUTH-07 (V2-13b); the Send Email hook drops `magiclink`; before V2-13b re-decide with the post-verify `updateUser` + `signOut('others')` fix, CAPTCHA, a 7-day purge of unconfirmed users, and `signup` passed only for addresses with a pending app-side signup intent | With signups off `/otp` cannot create users (spike E2: `signup_disabled`); dropping magiclink closes the existing-user mailbox bypass; default deny (ASVS V2) |
| A00-2 | No Before-User-Created filter; AUTH §4.1 mitigation 2 removed by a proposed erratum | The payload cannot identify the endpoint and `admin.createUser` does not fire it (spike E3) |
| A00-3 | Accept that GoTrue's raw signup API reveals existence; the V2-13b app signup returns one uniform response and sends an "account exists" email; CAPTCHA + per-IP limits bound scraping; erratum to AUTH §4.4 | Signup enumeration cannot be fully hidden; OWASP Authentication Cheat Sheet pattern |
| A00-4 | Unit mapping of `over_request_rate_limit` / `over_email_send_rate_limit` to the "wait a minute" copy (03-12a); hosted drift asserts `rate_limit_*` (03-11a); one recorded staging burst probe ≤ 40 requests (03-12c kit); no side-GoTrue in CI | The CLI stack enforces no per-IP limit; a side-GoTrue tests GoTrue, not the app (spike E9) |
| A00-5 | Require-current-password on hosted (drift-checked); the app always sends `current_password`; server-side 10-minute bound for `otp`/`recovery`-`amr` sessions changing a password | Supabase exempts OTP/recovery sessions at any age (spike E5); NIST 800-63B re-authentication; AUTH §3.5 10-min window |
| R-1 | Upgrade to Next 16.4.x + `@supabase/ssr` 0.12 now (03-06, first); fallback = rollback + `next@15.5.29` + dated deferral (re-check 2026-12-14, land by 2027-01-15) | Next 15 security releases end 2027-01-31, before UAT; 16.x is Active LTS; small exposure |
| R-2 | D1 spike = `record_payment`, including the system path | Exercises lock, invariant, RLS, actor, audit, outbox, rollback and idempotency without the V2-05 counter rework |
| R-3 | `types/database.ts` generated; `lib/db/types.ts` re-exports `Database`; hand-written domain interfaces kept until per-domain conversion | Roadmap path wins over B4; converting aliases now would ripple through 52 files of `as any` casts for no acceptance gain |
| R-4 | Zero-padded migration sequence continues; numbers 000025–000028 pre-assigned to plans | One developer, no collisions; immutability enforced in CI |
| R-5 | FT-05 runs in server actions that set passwords; `verifyOtp` stays in the browser; the self-only direct-`updateUser` bypass is accepted until Supabase HIBP (Pro) | Keeps Supabase per-IP/CAPTCHA semantics; residual harms only the caller's own account |
| R-6 | In-house typed logger with a closed field set; no pino | PHI safety by type rather than a redaction deny-list; low volume; Node runtime everywhere after Next 16 |
| R-7 | Error sink written through `public.ops_ingest_error` (SECURITY DEFINER, ingest-key hash in vault, upsert, cap) via plain `fetch`; no service role; no new client factory | ADR-0005 allow-list and D4 list unchanged; India-resident (C39) |
| R-8 | P2-03 live AI eval lane deferred to V2-12 (AI-06 L3, Vertex `asia-south1`) | No AI provider exists before AI-04 |
| R-9 | Staging migrations, seed and the AUTH-00 re-check run only in `staging.yml` under Environment `staging` with the PO as required reviewer, using `--db-url` (never link state); agents never run or dispatch it. **Needs explicit PO confirmation** because CLAUDE.md says "never `db push`" | Approval-gated deploys are the industry pattern; keeps `ci.yml` secret-free |
| R-10 | SES bounce/complaint webhook deferred to V2-04 (outbox); account-level suppression list until then | V2-03 acceptance has no bounce item; needs the outbox |
| R-11 | New `APP_ENV` tier variable (development, test, e2e, ci, staging, production); never inferred from `VERCEL_ENV` | K-6: CI build and e2e run `NODE_ENV=production` with offline providers |
| R-12 | The PO unlinks the CLI (E1c) after the E1a dump | The checkout is linked to the v1 hosted project |
| R-13 | The PO supplies the domain (E0); config uses `{{STAGING_ORIGIN}}` / env values until then | PO-19 fixed name and pattern only |
| R-K | Env names `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY`; legacy JWT values accepted under the new names (local lanes keep them, so the build scan is unchanged); old names rejected in staging/production; both identifiers lint-banned outside the factory and env modules | New projects have no legacy keys; legacy keys deprecated end-2026 |
| R-14 | One PR for the phase; 03-06 is the first contiguous commit series with a revert range; the PR opens as draft after 03-06 so CI proves it. Deviates from FE-1 "separate PR" and the research's stacked branch | PO direction; isolation and rollback are kept by the commit series |
| R-15 | Each plan owns the env keys it introduces (checklist in the protocol); 03-01 owns the mechanism | Keys land with their consumer and tests; waves stay file-disjoint |
| R-16 | `MESSAGING_PROVIDER=disabled` and `EMAIL_PROVIDER=disabled` allowed in staging (not production) until the PO's accounts exist | Staging must boot fail-closed without external accounts |
| R-17 | External integrations default off locally (`PWNED_CHECK`, sink key, Turnstile key, diag route); production requires them on/real | PO direction + fail-closed production |
| R-18 | `POST /api/diag/error` (cron-secret bearer, flag-gated, forbidden in production) proves the sink end to end locally and on staging | Acceptance 8 needs a deterministic thrown server error |
| R-19 | Hosted acceptance items are "pending PO" at the gate and close after merge, because `staging.yml`/`drift.yml` run from `feature/v2` and never on `pull_request` | PO unavailable; secret-free PR lane |
| R-20 | Staging Auth settings are applied by the PO from the generated checklist; no write token in CI; `supabase config push` not used | `config.toml` carries local deviations (CAPTCHA off, hook off, localhost URLs) that must not reach staging |
| R-21 | Two Environments: `staging` (PO approval, DB owner URL, secret key) and `staging-readonly` (nightly drift, read-only role and token) | Nightly drift without nightly approvals; least privilege |
| R-22 | Local CAPTCHA: Supabase CAPTCHA off locally; the e2e build uses Cloudflare's test site key with the script fulfilled by a local stub; the network block stays on | Local GoTrue would call Cloudflare; the stub proves token wiring offline |
| R-23 | SUS packages installed at older pins with provenance recorded; the PO's confirmation (E14) gates the merge, not local work | PO unavailable; GSD requires a human legitimacy check |
| R-24 | Approved-doc errata (ADR-0005 D4 `middleware.ts` → `proxy.ts`; AUTH_REDESIGN §4.1/§4.4/§7 per A00-2/3/4; roadmap "29 sites" → measured 25 + 9 + 9) are proposed in 03-SUMMARY and applied only after PO confirmation | CLAUDE.md: never silently change approved docs |
| R-25 | Sub-plan splits 03-09a/b/c, 03-11a/b, 03-12a/b/c | One implementer session each; file-disjoint waves |
| R-26 | Staging app deploys via the Vercel Git integration on `feature/v2`; "deploys from CI" is proven by `staging.yml` (migrate, then wait for the deployment whose `/api/health` `release` equals the SHA, then `/api/ready`) | No Vercel token needed; ordering visible |
| R-27 | Error-event purge and size functions now; scheduling with pg_cron in V2-04 | Scheduler is V2-04 scope |
| R-28 | OA-5: proxy default-deny for pages with the listed public prefixes; `/api/**` excluded (handlers authenticate) | New pages default to protected; no "Unauthenticated" render errors |
| R-29 | Client-side error capture stays out of V2-03 (V2-06 error states); client `console` replaced by a dev-only reporter | No browser→sink path designed yet |
| R-30 | Region proof is `/api/health` `region` (Vercel `VERCEL_REGION`), with `x-vercel-id` as a secondary signal | Assumption A1 on the header format |
| R-31 | SES credentials for staging are a least-privilege IAM user's keys in Vercel; an OIDC role replaces them in V2-15 | Avoids a new dependency now; scope limited to one identity |
| R-32 | Canonical messaging webhook secret name `MSG91_WEBHOOK_SECRET` | Matches the code and PO-ACTIONS C-3 |
| R-33 | SQL `DEFAULT CURRENT_DATE` defaults (V2-05 05-08) and the invoice-number year (V2-10 P1-06) stay; the app passes explicit tenant dates | Owned by later phases; app-side dates fix the user-visible defect now |
| R-34 | Require-current-password cannot be enabled on the CLI stack, so a wrong current password is not rejected locally; the check is a hosted re-check item (3) | No CLI config key (spike E5) |

## Open for the PO (not blocking)
1. E13: confirm the rulings, especially R-9 and the CLAUDE.md Commands update.
2. E0–E11 in the order above; E5/E6 have the longest lead time.
3. E14 and E15 before merge.
