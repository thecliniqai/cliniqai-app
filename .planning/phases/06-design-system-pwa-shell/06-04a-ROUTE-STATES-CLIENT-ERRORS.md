# 06-04a record: route states, `dvh`/safe-area utilities, client render error capture

Plan: `06-PLAN.md` § 06-04a (Wave 2, no G2-D; P1-28 M3 route states, PWA-03 shell part, V2-03 R-29; ruling R-3).
Branch `v2/phase-06-design-system-pwa-shell`, shared worktree with 06-05 and 06-07. Plan base `ba69ebd`.
Commits: `4c1e35f` (client error capture, tracer), `768f5fd` (route states), `6e3a0fc` (`dvh` utilities, 20 sites,
`screen-height` enforced), plus the docs commit with this record. Numbers below are tool output; files under
`evidence/06-04a/`.

## What changed

| Area | Change | Files |
|---|---|---|
| Client error capture (R-3, T-06-09/T-06-10) | `reportClientRenderError({ name, route })`, `"use server"`, guard `resolveServiceContext()` with no permission (`{ member }`), then zod (`name` ≤ 80, `route` ≤ 200; unknown keys stripped). The stored event is built by `buildClientRenderEvent`: `error_name = client.` + `errorNameOf` (else `client.Error`; never longer than the 80 the database keeps), `route_path` = `routePattern()` of the input, replaced by `/` when it has a query/fragment, a UUID-shaped, 6+ digit or `@` segment, or anything `routePattern` refuses; `route_type = render`; `method`, `digest`, `request_id`, `error_code` null; `message = ""`; `frames = []`; tier from `serverEnv()`, release from `deploymentInfo()`. Then `admitClientKey` (new: at most 50 distinct client route/name keys per instance and UTC day, so made-up names cannot use up the database's 500 new fingerprints/day and blind the sink to server errors) and `admitToSink` (existing flood cap), `sendErrorEvent`, one `log.warn({ event: "client.render_error", route, code })`. Answers `{ ok }` only. | `features/observability/actions.ts`, `lib/observability/client-render-event.ts` |
| Boundary | `RouteError`: heading (focused on mount), plain text, "Try again" (`retry()`), optional "Go to Today", the digest as "Reference: …", never the message. Copy by `clientErrorKind`: offline ("You're offline. Reconnect to continue."), skew ("This app was updated. Reload to continue.", button reloads), other. With `report` (dashboard only): an error **without** a digest is sent once per boundary render with its class name and the route pattern from `usePathname()`/`useParams()` (`routePatternOf`: param values → `[name]`, catch-all once). | `components/shell/route-error.tsx`, `lib/errors/client-error-kind.ts`, `lib/errors/client-route.ts` |
| Diagnostic (tracer) | `/diag/client-error`: `notFound()` unless `DIAG_ERROR_ROUTE_ENABLED` (schema refuses it in production, 03-09b R-18); a button makes a child throw `DiagClientRenderError` (synthetic phone/email in the message, name set explicitly). | `app/(dashboard)/diag/client-error/{page,trigger}.tsx` |
| Route states | `error.tsx` in `(dashboard)` (reports), `(onboarding)`, `(auth)`, `r`, `reports`, `reschedule` (never report); `app/global-error.tsx` (own `<html lang>`, imports `globals.css`, static title, digest only, Reload). `not-found.tsx` in `(dashboard)` (inside the shell) and at the root (own `<main>`). `loading.tsx` (`RouteSkeleton`: `role="status"`, name "Loading", motion-safe pulse) on `(onboarding)` and the dashboard segments `profile`, `referrals`, `settings`, `staff`, `visits`, `patients/new` (deviation 1). | `app/**/{error,loading,not-found}.tsx`, `app/global-error.tsx`, `components/shell/{route-skeleton,route-not-found}.tsx` |
| `dvh` / safe areas (PWA §3.3) | `@utility min-h-app`, `h-app` (100vh then 100dvh), `pb-safe` (`max(0.5rem, env(safe-area-inset-bottom))`), `pt-safe`, `px-safe` (insets, 0 fallback); `body` `min-height: 100vh` + `100dvh`. The 20 `min-h-screen` sites in 10 files → `min-h-app` (no `h-screen` existed). | `app/globals.css`, the 10 files |
| UI policy | `screen-height` → `mode: "enforce"`; own fixture `lint-fixtures/ui-policy/screen-height/` and spec case; the `violations` fixture line 10 is now a passing `md:min-h-app`; baseline 20 → 0. | `scripts/ci/ui-policy/rules/screen-height.mjs`, `scripts/ci/ui-policy-baseline.json`, `tests/ci/ui-policy.spec.ts`, `lint-fixtures/ui-policy/**` |
| Guard manifest | `features/observability/actions.ts#reportClientRenderError: { member: "client render error report (06-04a, R-3) …" }`; `valid-inputs.ts` entry (name, route, `acting(a)`) so leg 3's positive control runs and each acting id is forged one at a time. | `tests/security/guard-manifest.ts`, `tests/security/guard/valid-inputs.ts` |

`lib/log/client.ts` `reportClientError` is unchanged and stays development-only (R-29 as shipped): caught, handled
client errors are not sent; only uncaught render errors reach the sink (for 06-SUMMARY).

## Tests (each fails without its change)

| Spec | Proves | Without the change |
|---|---|---|
| `tests/e2e/observability/client-error.spec.ts` (desktop-chrome) | owner triggers the diag error: boundary shows, none of the synthetic values on the page; exactly one `ops.error_events` row `{client.DiagClientRenderError, /diag/client-error, render, message '', frames [], method/digest/request_id/error_code null, count 1, e2e}`; "Try again" recovers; a second throw → same row, `count 2` | no page, no boundary, no row (production `reportClientError` is a no-op) |
| `tests/observability/client-error-action-db.spec.ts` (12) | live sink: one exact row; repeat counts; `Error123456` → `client.Error`; UUID / 6+ digits / email / query routes → `/`; 300-char route and 81-char name refused, nothing written; extra keys (message, frames, digest, tenant_id) ignored; no session and no membership refused, nothing written; no ingest key → nothing written | module does not exist |
| `tests/observability/client-render-event.spec.ts` (16) | name/route rules, closed event, release shape, 50-key client cap and day roll-over | module does not exist |
| `tests/errors/client-error-kind.spec.ts` (10) | offline, `new UnrecognizedActionError(…)` (Next's own class), `ChunkLoadError`, plain `Error` → offline/skew/skew/other; `routePatternOf` | module does not exist |
| `tests/e2e/shell/route-states.spec.ts` (desktop-chrome, pixel-7) | `/patients/<random uuid>` → dashboard not-found inside the shell, **HTTP 404**, `noindex`, id not echoed; `/no-such-page` → root not-found, 404, no banner; navigation to `/visits` with its RSC response held 1.5 s shows `status` "Loading" inside the shell, then the page; diag error shows "Try again", heading focused, no message | no not-found/loading/error UI (Next defaults) |
| `tests/e2e/design/route-states-axe.spec.ts` (desktop-chrome, 4 widths) | dashboard not-found / error / loading and root not-found at 360/820/1180/1280: 0 serious/critical axe (scoped to `<main>` inside the dashboard, deviation 4), no horizontal scroll; screenshots + JSON to `design-captures/06-04a/` | states do not exist |
| `tests/ci/ui-policy.spec.ts` | `screen-height` fixture fails (exit 1, three file:line findings), `min-h-app h-app` passes | `evidence/06-04a/screen-height-enforced.txt`: the same fixture with the rule at `report` exits 0 |
| `tests/security/guard-actions.spec.ts` | the new action: static guard = manifest, unauthenticated refused, no-membership refused, leg 3/3b positive control and forged acting ids | an action without the manifest entry fails completeness |

## Evidence (tool output, `evidence/06-04a/`)

| Check | Result | File |
|---|---|---|
| UI policy, repository | `screen-height` **[enforce] 0** (baseline 20 at 06-01a), every other count unchanged (arbitrary-color 4, raw-palette 3530, px-font 282, …); PASS | `ui-policy.json` (raw-palette summarised per file), `static-checks.txt` |
| `screen-height` enforced vs report | enforced: exit 1 with `tall.tsx:5/6/7`; same fixture at `mode: "report"`: exit 0 | `screen-height-enforced.txt` |
| Axe + horizontal scroll | 16 captures (dashboard not-found / error / loading, root not-found × 360/820/1180/1280): **0 serious/critical**, no horizontal scroll in any; whole-page results kept for reference (the v1 sidebar's `color-contrast` on 11 px `fg-subtle` text and the section `h2`s, M0 axe report debt) | `axe-route-states.json` |
| e2e PR lane | `npm run e2e:build && npm run e2e:pr` at `6e3a0fc`: **249 expected, 26 skipped, 0 unexpected, 0 flaky, 0 retried** (desktop-chrome, Pixel 7, iPhone 15; the `✘` lines are the annotated known-v1 `test.fail()` cases) | `e2e-pr.json` |

## Suite results (local, at `6e3a0fc`, detached worktree; logs in the session scratchpad)

| Lane | Result |
|---|---|
| `npm run typecheck` | pass |
| `npx eslint .` | 0 errors, 462 warnings (none in 06-04a's files) |
| `npm run inventory` | exit 0, 26 `"use server"` modules, 113 exports, 0 flagged |
| `node scripts/ci/ui-policy.mjs` | PASS, enforced findings 0 |
| `npm run ci:ai-l1` | PASS |
| 06-04a Vitest specs + `guard-actions.spec.ts` | client-error-action-db 12, client-render-event 16, client-error-kind 10, ui-policy 13, guard-actions 630: all pass |
| Full Vitest lane (`npx vitest run`, stack up) | 257 files, 4963 / 4967 pass. The 4 failures are the **stack being ahead of the branch** (local stack at migration `000077`, branch head `000074`; recorded, nothing changed, per the shared-stack rule): `tests/ci/hosted-dump-diff.spec.ts` ×2 (the local dump has the 000075-000077 objects the branch's migrations lack: drift 1 and 13 instead of 0 and 1), `tests/ops/drill-lib-db.spec.ts` `drill_authz_matrix` (the branch's generated RLS matrix expects `patients` insert for admin/doctor of A; the stack's newer policies deny), `tests/billing/invoice-totals-db.spec.ts` (adding a charge returns `success: false` on the newer billing schema). None touch a 06-04a file; re-run after the 05b merge-in. The 06-01a wave-note failure (`review2-fixes-db` I2) passed in this run. |
| `npm run e2e:build && npm run e2e:pr` | as above: 249 / 0 unexpected / 0 flaky / 0 retried |
| gitleaks (docker `zricethezav/gitleaks:v8.30.1`, `--config .gitleaks.toml`) | "no leaks found" (780 commits) |

## Deviations

1. **No `app/(dashboard)/loading.tsx`; loading states on the safe segments only.** A loading boundary starts the
   streamed response with HTTP 200 (Next 16.4.6 docs, `loading.md` "Status codes"; `not-found.md`: "After streaming
   starts, the status code remains 200"). At the group root it would wrap `/patients/[id]` and `/consultation/[id]`,
   whose `notFound()` must answer 404 (the plan's own route-states check, and `journey-09-clinic-isolation.spec.ts`,
   which fails on `status === 200 && same path`), and the `redirect()`s of `/`, `/queue`, `/cabin`, `/calendar`,
   `/billing/*` would become streamed client redirects. So `loading.tsx` sits on `profile`, `referrals`, `settings`,
   `staff`, `visits`, `patients/new` and `(onboarding)`; the loading test navigates to `/visits`. P1-28 M3's "loading for
   every route group" is therefore partial: owner **06-04b** (wave note), with the options there.
2. **"Try again" calls `retry()`, not `reset()`.** Next 16.4.6 passes both; `retry()` re-fetches and re-renders the
   segment (`reset()` only re-renders), which is what a server-side failure needs; the docs recommend it.
3. **The action returns `{ ok }`, not nothing.** The guard engine counts `undefined` as a refusal, so a void action
   would pass the unauthenticated/no-membership legs even without its guard; `{ ok: false }` / `{ ok: true }` makes
   them meaningful (and carries no data).
4. **Axe is scoped to `<main>` inside the dashboard.** The full page fails on the v1 sidebar (11 px `fg-subtle`
   "ClinicOS Console" and the section `h2`s: `color-contrast`, serious), which is the M0 axe report's known debt and
   06-04b's shell; the plan's rule is "0 serious/critical on the screens the plan adds or changes". The whole-page
   result is recorded next to the scoped one; the root not-found is checked whole-page.
5. **The onboarding boundary does not report.** The action is membership-only (the plan's guard) and an onboarding
   user has no clinic membership, so every report would be refused.
6. **Added (Rule 2): `admitClientKey`**, a 50-key-per-day client budget in front of `admitToSink`. Without it a member
   could send 500 made-up names and use up the day's new-fingerprint cap, hiding server errors (T-06-10).
7. **Added files beyond the plan's list:** `components/shell/route-not-found.tsx`, `lib/errors/client-route.ts`,
   `lib/observability/client-render-event.ts` (a `"use server"` module may export only actions, so the pure builder
   lives outside it), `tests/observability/client-render-event.spec.ts`, `tests/e2e/design/route-states-axe.spec.ts`,
   `tests/e2e/shell/support/slow-navigation.ts`, `lint-fixtures/ui-policy/screen-height/**`, and the
   `tests/security/guard/valid-inputs.ts` entry. Shared 06-01a files edited additively: `tests/ci/ui-policy.spec.ts`,
   `lint-fixtures/ui-policy/{README.md,violations/components/samples.tsx}`, `scripts/ci/ui-policy-baseline.json`.
8. **The first full e2e run was invalid and was repeated.** In the shared worktree another `next build` replaced
   `.next` under the running server (500s on `/_next/static/chunks/*`, `ChunkLoadError` in the trace, `.next/BUILD_ID`
   no longer the run's stamp). The run was stopped and repeated in a detached worktree of `6e3a0fc` with its own
   `.next` (cloned `node_modules`, `.cache/ops-bin` copied), under the lane lock: green, above. Not a flaky test.
9. Coordinator note (V2-05 reset the shared database twice): every e2e run seeds its own run data in global setup, and
   the DB-backed Vitest specs seed their own tenants; `seed:local` was not needed and not run.

9. **06-09a addendum (review C Info I-3, M-1).** Deviation 5 (the onboarding boundary does not report) and deviation 3
   (`{ ok }`) stand and are the ones review C named. Deviation 6's per-instance budget did not bound the database's
   shared daily cap on serverless (review C M-1); 06-09a replaced it with closed class-name and route-pattern lists
   plus a per-key repeat debounce (`06-09a-REVIEW-FIXES.md`).

## For the Wave A adversarial review (C: client errors and PHI)

- Residual by design: a member can still store made-up but name-shaped strings (≤ 50 keys per instance and day; more
  across instances) as `client.*` names or lower-case static route segments. No victim data can flow in: messages,
  stacks, query strings, ids, digits ≥ 6 and `@` never reach the row. A free-text class name or a lower-case slug that
  happens to be a person's name cannot be detected by pattern (same limit as the server sink, 03-09b).
- No per-user rate limit on the action (one auth lookup per call); bounded by membership and the key budgets. Low;
  backlog candidate for V2-14 if the review agrees.
- The diag page is reachable by any member when `DIAG_ERROR_ROUTE_ENABLED` (e2e, optionally staging; refused in
  production by the env schema).

## Open

- 06-04b: loading states for `/`, `/patients`, `/patients/[id]`, `/consultation/[id]`, `/queue`, `/cabin`, `/calendar`,
  `/billing/*` (deviation 1).
- After the 05b merge-in: re-run the four stack-ahead Vitest cases above with branch and stack matching.
- 06-SUMMARY: record the split "uncaught render errors → sink; caught client errors → `reportClientError`
  (development only)".
