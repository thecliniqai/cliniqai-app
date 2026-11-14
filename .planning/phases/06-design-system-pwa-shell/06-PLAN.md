---
phase: 06
roadmap_id: V2-06
name: Design system, frontend foundation & PWA shell
gate: G3 (isolated Claude design reviewer + PO screenshot approval; adversarial reviews for the PWA/auth/PHI parts). G2-D (V2-DX) is a precondition of Wave B only.
requirements: [P1-28 (M1-M3), P2-02, PWA-01, PWA-02, PWA-03 (shell part), PWA-04, PWA-05 (client side), PWA-07, PWA-08b (specs 1-6, 8, 10, 11), PWA-09 (report-only), AI-02, AI-16 (deferred to V2-09b, R-10), V2-03 handovers to V2-06 (React Compiler rules back to error, client error capture R-29, user-menu dropdown focus management, hardSignOut), V2-05 handover (PWA asset non-redirect cases for locked users, 05-10b)]
plans: [06-01a, 06-07, 06-04a, 06-05, 06-06, 06-09a, 06-01b, 06-02a, 06-02b, 06-02c, 06-03a, 06-03b, 06-04b, 06-08, 06-09b]
waves: {1: [06-01a], 2: [06-07, 06-04a, 06-05], 3: [06-06], A-review: [06-09a], 4: [06-01b], 5: [06-02a], 6: [06-02b], 7: [06-02c], 8: [06-03a], 9: [06-03b], 10: [06-04b], 11: [06-08], close: [06-09b]}
pre_g2d: [06-01a, 06-07, 06-04a, 06-05, 06-06, 06-09a]   # Wave A: execute and merge into the phase branch without G2-D

> **G2-D signed off 2026-11-13 (PO):** direction **A "Calm Confidence — Botanical Teal"**, round-3 component system and
> consult structure, typeface **Inter** (vendored, `next/font/local`). Source of truth: branch
> `v2/phase-dx-design-exploration` at `e95b8b5` (`.planning/sketches/themes/clinic-paper.css`, `006-components/`,
> `004-consult/`). Everything stays tokenised (colour, type, font) so the PO can change it from real usage; direction
> B remains as `direction-b.css`. 06-01b consumes `clinic-paper.css` unchanged; numeric contexts: proportional figures
> for doses, tabular for tables and amounts.
post_g2d: [06-01b, 06-02a, 06-02b, 06-02c, 06-03a, 06-03b, 06-04b, 06-08, 06-09b]   # Wave B: precondition = G2-D row recorded (06-P2)
source: docs/v2/V2_MASTER_ROADMAP.md §1.2 (PO-15, PO-19, PO-20, PO-21), §10.1-10.2 (P1-28, P2-02, PWA-01…09, AI-02, AI-16), §12.2 (V2-DX, V2-06), §16 (G2-D, G3); docs/v2/DESIGN_SYSTEM.md; docs/v2/PWA_STRATEGY.md §3-§6, §9, §10; docs/v2/FRONTEND_MIGRATION_PLAN.md M1-M3; docs/v2/INFORMATION_ARCHITECTURE.md §3.2-§3.7; docs/v2/AI_STRATEGY.md §5.3; docs/v2/VERIFICATION_LOG.md R5, O7; .planning/PO-ACTIONS.md D-1; .planning/phases/03-platform-hygiene/{03-WAVE-NOTES.md, 03-SUMMARY.md} (V2-06 handovers); .planning/phases/05-db-authorisation-entitlements/05-PLAN.md (05-10a, 05-10b handovers)
research: 06-RESEARCH.md (rulings adopted; deviations listed at the end)
depends_on_phase: V2-05 part 05b branch tip (stacked; PO direction). Real code dependencies are listed under "Dependencies on V2-04 / V2-05 code"; everything else in Wave A needs only V2-03 as shipped.
base_commit: tip of v2/phase-05b-membership-entitlements at branch time (recorded in 06-SUMMARY)
branch: v2/phase-06-design-system-pwa-shell (from the 05b branch) -> PR targets the 05b branch; retargeted to feature/v2 when 05b merges (merge commits only, never rebase; V2-05 R-1 pattern)
po_direction: PO unavailable; Claude acts as CTO under delegation (rulings below, PO confirms at the gate, 06-P7). External steps never block local work. PO decisions 2026-11-13 applied: Vercel stays on Hobby until go-live (no Skew Protection on staging, function duration ≤ 60 s), email via Resend (not used by V2-06), the repository stays public until go-live (every committed or uploaded artefact is public).
must_haves:
  truths:
    - "Every component and the codemodded v1 screens style through semantic tokens in app/globals.css only; changing the approved palette edits one file"
    - "The value-neutral codemod (Wave A) changes no screen by more than 0.5 % of pixels at 360/820/1180/1280, and every collapsed v1 colour is listed"
    - "Signed out and as a locked-tenant user, /manifest.webmanifest, /sw.js, /offline and every icon answer 200 with no redirect"
    - "Chrome's installability check returns no errors for the signed-in app"
    - "After browsing Today, a patient, a consult and an invoice, Cache Storage holds only /_next/static/**, /offline, the manifest and icons; IndexedDB is empty; local/session storage hold only allow-listed preference keys"
    - "Every V2-06 sign-out path (sign out, sign out everywhere, switch user, offline sign-out, expired or revoked session, removed member) leaves only the static allowlist in Cache Storage, empty sessionStorage, preference keys only in localStorage, no auth cookie, and Back shows no patient data"
    - "A changed deployment id shows 'A new version is ready · Reload' and never reloads over unsaved input; a locked tenant is moved to its locked page with the session kept"
    - "axe reports 0 serious or critical issues on /dev/ui at 360/820/1180/1280, and every interactive primitive passes its keyboard and focus spec"
    - "The M0 characterisation suite stays green on every plan"
  artifacts:
    - app/globals.css (raw → semantic → structural layers), lib/design/tokens.ts, scripts/design/{codemod-colors.mjs,color-map.json,neutral-diff.mjs,render-icons.mjs,contrast.mjs}
    - scripts/ci/ui-policy.mjs + scripts/ci/ui-policy/rules/*.mjs (report mode; brand-utility, screen-height and signout-guard enforced)
    - scripts/ci/route-js.mjs, scripts/ci/route-js-budgets.json, tests/e2e/perf/lhci.spec.ts
    - app/manifest.ts, app/icon.svg, app/apple-icon.png, public/{sw.js,icon-192.png,icon-512.png,icon-maskable-512.png}, app/offline/page.tsx
    - lib/auth/hard-sign-out.ts, lib/pwa/**, components/shell/**, app/api/session-status/route.ts
    - app/**/loading.tsx|error.tsx|not-found.tsx, app/global-error.tsx, features/observability/actions.ts
    - components/ui/** (Radix/shadcn primitives), components/clinical/**, app/dev/ui/**, lib/nav/nav-for-role.ts
    - tests/e2e/pwa/{01..06,08,10}-*.spec.ts, tests/e2e/design/**, tests/e2e/shell/**
  key_links:
    - "app/globals.css @theme (raw) -> @theme inline (semantic) -> Tailwind utilities -> components; lib/design/tokens.ts mirror -> app/manifest.ts theme/background colours"
    - "browser -> proxy.ts pageNeedsSession (PUBLIC_PAGE_PREFIXES + /manifest.webmanifest, /sw.js, /offline) -> 200 static, no session"
    - "(dashboard) layout -> PwaRuntime -> navigator.serviceWorker.register('/sw.js', {updateViaCache:'none'}) -> sw.js allowlist (navigate: network then /offline; /_next/static: cache-first; else no respondWith)"
    - "every exit path -> hardSignOut(reason) -> cleanups registry -> fetch POST /auth/signout (redirect: manual) [offline: browser signOut local] -> purgeDeviceState() -> location.replace('/login')"
    - "PwaRuntime (visible/online/5 min/any boundary error) -> GET /api/session-status {deploymentId, accessLevel, redirect} -> update toast | D-8 lock redirect | hardSignOut('expired'|'removed')"
    - "dashboard error.tsx -> reportClientRenderError (member-guarded action) -> lib/observability sink -> ops.error_events (client.<Name>, route pattern, no message)"
---

# Phase 06 (V2-06): Design system, frontend foundation & PWA shell — plan

## Basis and split (2026-11-13)

Written against the research (`06-RESEARCH.md`, read-only at `118b3ae`), the code of V2-03 as shipped (on the V2-04
branch, `9dae791`), and the V2-04 and V2-05 plans (V2-06 stacks on them). V2-DX has not produced its evidence yet: it
runs now on `v2/phase-dx-design-exploration` in its own worktree, and its `.planning/sketches/themes/clinic-paper.css`
is the literal input of 06-01b. The phase is split by the one gate that matters:

- **Wave A (no G2-D needed):** 06-01a value-neutral semantic tokens + v1 hex codemod + report-mode guards; 06-07 bundle
  report + Lighthouse CI report-only; 06-04a route states, `dvh`/safe-area utilities, client error capture; 06-05
  manifest, provisional icon, service worker, `/offline`, `hardSignOut()`, `no-store`, public PWA assets; 06-06 install
  UX, update/skew/lock client, `/api/session-status`. Then the Wave A reviews and their fix plan 06-09a.
- **Wave B (after G2-D, roadmap R5 literal "before any primitive is built"):** 06-01b approved values, local fonts, AI
  labels and chips; 06-02a/b/c primitives + `/dev/ui`; 06-03a/b clinical components; 06-04b shell, navigation,
  command palette, toasts; 06-08 close-out; phase reviews and fix plan 06-09b.

PO decisions of 2026-11-13 applied: staging runs on **Vercel Hobby** until go-live, which has no Skew Protection, so
the in-app skew guard (06-06) is the only skew control there (it was already mandatory, PWA §3.7); `deploymentId` is
set explicitly from Vercel's deployment id. **The repository is public until go-live:** every screenshot, report and
artifact is synthetic and carries no session material (06-07 scrubs the cookie header out of Lighthouse results).
Email (Resend, V2-04 04-00b) is not touched by V2-06.

**Objective (roadmap):** one enforced visual and interaction system, implementing the direction approved at G2-D,
delivered as an installable PWA.

**Acceptance (roadmap, verbatim):** axe shows 0 serious or critical issues on the gallery; screenshots at
360/820/1180/1280 (the V2-DX widths) match the G2-D direction and are approved by the PO; the grep guards, including
the AI-02 "AI" copy grep, are in report mode; v1 screens still work (M0 e2e green); Chrome reports the app
installable; the cache-audit spec finds no authenticated response in Cache Storage; every sign-out path clears caches
and storage.
**Tests (roadmap):** Playwright screenshot + axe on `/dev/ui`; unit tests for primitives' keyboard and focus
behaviour; the M0 characterisation suite.
**Evidence (roadmap):** CI links, the screenshot set, the bundle report, design review notes.

**Carry-overs planned into this phase:** React Compiler rules `set-state-in-effect`/`purity`/`immutability` back to
`error` (03-06, owner V2-06) → 06-08; client error capture (V2-03 R-29) → 06-04a; user-menu dropdown focus management,
`aria-expanded`, Escape (03-12b wave note) → 06-02b; `hardSignOut()` on top of `POST /auth/signout` (03-12b, PWA D-5)
→ 06-05; PWA asset non-redirect cases for locked users (V2-05 05-10b handover) → 06-05 spec 1; broken route-JS section
of `npm run e2e:baseline` on Turbopack (research) → 06-07; client-side `SUBSCRIPTION_LOCKED` hard navigation (05-10b
"PWA-05 (V2-06/V2-13b)") → 06-06.

**Dependencies on V2-04 / V2-05 code (real ones only).** None of Wave A needs V2-04 code (V2-04 only changes files
V2-06 later edits: `.github/workflows/{ci,nightly}.yml`, `tests/e2e/global-setup.ts`, `scripts/ci/assert-vitest-report.mjs`;
order only). V2-05 is needed by: **06-05** spec 1's locked-user leg (05-10b layout redirect + locked/onboarding e2e
fixtures in `tests/helpers/tenants.ts`) and spec 5's "removed member" leg (05-05 `remove_member` deletes the sessions;
the leg itself runs in 06-06); **06-06** `/api/session-status` `accessLevel` (05-09a `my_tenant_access` /
`billing_internal.tenant_access_level` through 05-10a's `lib/auth/tenant.ts`), the locked destinations
`/billing/locked`, `/billing/locked/staff`, `/onboarding/billing` (05-10b) and the `SUBSCRIPTION_LOCKED` app error code
(05-10a `APP_ERROR_CODES`). Use the names as merged; if they differ from 05-PLAN, follow the code and note it in
06-SUMMARY. 06-01a, 06-07 and 06-04a need nothing from V2-04 or V2-05.

**No migration in V2-06.** Client error capture fits the existing `ops.error_events` contract (R-3). A plan that finds
it needs a schema change stops and raises it.

**Invariants for the whole phase**
- No product behaviour changes beyond this plan. v1 URLs, page content and flows stay (R-8: no URL renames, no `ui_v2`
  flags, PO-15). The M0 characterisation suite stays green after every plan; a locator may be adapted only where the
  shell moved an element, never an assertion, and each adaptation is listed in 06-SUMMARY.
- No PHI on the device (PWA §4 D-1…D-8). The service worker caches only the positive allowlist; no app code writes
  `localStorage`/`sessionStorage`/IndexedDB except the `clinicos.pref.*` keys of `lib/pwa/device-prefs.ts`.
- Semantic tokens only in components (DESIGN_SYSTEM §2.3, §10): raw palette utilities are reported by the UI policy and
  never introduced by new code.
- Synthetic data only, and the repository is public: screenshots, Lighthouse reports, evidence and fixtures carry
  synthetic names, no cookies, no storage states, no keys. `playwright/.auth/**`, `.lighthouseci/**` and
  `test-results/**` stay git-ignored.
- No call to hosted Supabase, Vercel or GitHub settings from an implementer session. No `next/font/google`, no shadcn
  CLI (both fetch from the network at build/run time; R-4, R-14).

## Execution protocol (same as V2-04, plus the design and PWA lanes)

- Implementer agents **may** run `npx vitest`, `npm run test:db`, `npm run e2e:build`, `npm run e2e:pr`,
  `npm run e2e:baseline`, `npm run e2e:design` (added by 06-01a), `npm run perf:lhci` (added by 06-07; loopback only),
  `node scripts/design/*.mjs`, `node scripts/ci/{ui-policy,route-js,ai-l1-greps}.mjs`,
  `npx supabase start|stop|db reset --local|gen types --local`, `npm run seed:local`.
- Implementers **must not**: `git push`, open/retarget/merge PRs, change GitHub/Vercel/Supabase-hosted settings,
  dispatch any workflow, run any CLI command with `--linked` or `db push`, run `seed:cdci*`, `seed:diagnoses`,
  `msg91:*`, anything with `--env-file=.env`, `scripts/seed-staging.ts` or `scripts/staging/*`; run `npx shadcn` or any
  installer other than the exact pins in this plan's dependency table (from the plan that owns `package.json` in that
  wave); download fonts or images (06-01b copies the font files from the G2-D-approved V2-DX commit). Never open or
  print `.env*`. Delete `.planning/dev-messages.txt` if a run recreates it.
- **Worktrees, never a branch switch.** Other phases' agents use the primary checkout. V2-06 work happens in worktrees
  of `v2/phase-06-design-system-pwa-shell`. V2-DX files are read with `git show <approved sha>:<path>` (binary-safe
  with `> file`), never by checking out or merging the V2-DX branch.
- **Shared local stack and e2e lane.** One local stack; at most one plan per wave resets it (V2-06 has no migration,
  so no plan needs to). The e2e server is single-instance (port 3100, one `.next`), so e2e runs inside a wave are
  serialised; if contention costs more than it saves, the orchestrator runs wave 2 sequentially.
- **File ownership.** Plans in one wave touch disjoint files (order table). A plan that must edit a file owned by its
  wave partner stops that edit and records it in `06-WAVE-NOTES.md` for the wave merge.
- **Tracer first.** Step 1 of every plan is the thinnest end-to-end path through every layer the plan touches, with a
  real test; later steps expand from it.
- **Per-plan done:** `npm run typecheck`, `npx eslint .` (0 errors), `npm run inventory`, `node scripts/ci/ui-policy.mjs`
  (from 06-01a on; enforced rules 0), `npm run ci:ai-l1`, the plan's tests, the full Vitest lane (`npm run test:db`)
  once at the end, and `npm run e2e:build && npm run e2e:pr` (every V2-06 plan touches UI, routes or the proxy).
- **UI checks (DoD 3).** Every plan with UI captures its screens at **360, 820, 1180 and 1280 px** with the `design-*`
  Playwright projects (06-01a) into `test-results/design/<plan>/`, asserts no horizontal scroll at those widths, and runs
  axe (wcag2a, wcag2aa, wcag21aa, wcag22aa; the M0 tags) with **0 serious/critical** on the screens the plan adds or
  changes. The evidence JSON (not the PNGs, except the G3 set) goes to `evidence/<plan>/`.
- **Code rules from V2-03 that bind every new file:** no `console.*` (client code reports through
  `reportClientError` from `@/lib/log/client`; server code through `log` from `@/lib/log`); no `process.env` outside
  `lib/env.ts`, `lib/env-server.ts`, `next.config.ts`, `instrumentation.ts` and `lib/log/client.ts` (client components
  receive tier-dependent switches as props from a server layout); clinic dates and times through `lib/datetime`
  (`ClinicTimeZoneProvider`), never a UTC `toISOString()` cut; `"use client"` code never imports `@/lib/log`.
- **Env-key checklist (V2-03 R-15 as shipped; only 06-06 adds names).** In the same commit: `shapeSchema` entry, `Env`
  type, tier rules and typed `ENV_DOCS` entry in `lib/env.ts`; read through `serverEnv()`/`deploymentInfo()` only; cases
  in `tests/config/env-schema.spec.ts` (and the production profiles of `env-schema.spec.ts`/`env-boot.spec.ts` if a key
  becomes required); a pin or forbid rule in `tests/setup/test-env.ts`; the e2e value in `tests/e2e/support/app-env.ts`;
  `.env.example` regenerated by `node scripts/ci/env-example.mjs` (never opened). A name matching `*_KEY`, `*_SECRET`,
  `*_TOKEN`, `*_PASSWORD` is treated as a secret by the schema (04-00); V2-06's names are `*_ID`.
- **Dependencies.** Exact pins only, from the table below, installed by the plan that owns `package.json` in its wave;
  older pins resolved with `npm install --before=<date>`; then `scripts/ci/lock-linux-check.sh --fix` and
  `node scripts/ci/package-legitimacy.mjs --base <pre-plan sha> --plan <id> --out
  .planning/phases/06-design-system-pwa-shell/evidence/package-legitimacy.json` (exit 0: no install scripts, integrity
  equal, signatures valid) and `npm audit signatures`.
- **gitleaks after commit.** Before handing back: `docker run --rm -v "$PWD":/repo -w /repo zricethezav/gitleaks:v8.30.1
  git --redact --no-banner --config .gitleaks.toml .` prints "no leaks found". A false positive gets an exact-fingerprint
  line in `.gitleaksignore` with a reason, never a quote of the flagged string. Test secrets are built at run time.
- **Wave B precondition.** Before 06-01b starts: (1) the G2-D row exists in `docs/v2/VERIFICATION_LOG.md` with the PO's
  verbatim answer, the approved V2-DX commit SHA and the SHA-256 of `clinic-paper.css` and each font file (06-P2);
  (2) the orchestrator runs `/gsd-ui-phase 06` to turn the approved sandbox into `06-UI-SPEC.md`; (3) if the UI-SPEC
  changes a Wave B detail (a component's states, the 1180 Today variant, chip colours), the planner adds a dated revision
  note at the top of this file and edits only the affected Wave B steps; scope does not change without the PO.
- **Orchestrator:** create the branch from the 05b tip; push after every wave; open the phase PR as **draft** after
  wave 2 (CI proves the public-path and SW changes on Linux); run the Wave A reviews after wave 3 (see "Wave A review
  checkpoint"); merge only after G3 and the PO's approval.

## Execution order

| Wave | Plan | Size | Depends on | Hot files this plan owns in its wave | Why this order |
|---|---|---|---|---|---|
| 1 | **06-01a** semantic tokens (v1-equivalent values) + hex/brand codemod + UI policy (report) + design lanes | M | V2-05 tip (none of its code) | `app/globals.css`, the codemod's ~75 files under `app/**`/`components/**`, `lib/design/**`, `scripts/design/**`, `scripts/ci/ui-policy.mjs` + `scripts/ci/ui-policy/**`, `eslint.config.mjs`, `playwright.config.ts`, `package.json` (scripts only), `.github/workflows/ci.yml` (static step), `tests/design/**`, `tests/ci/ui-policy*.spec.ts`, `lint-fixtures/ui-policy/**`, `tests/e2e/design/**` | Every later screen styles through these tokens; owns the policy framework later plans add rules to |
| 2 | **06-07** route-JS report + M0 report fix + Lighthouse CI (nightly, report-only) | S | 06-01a | `scripts/ci/route-js.mjs`, `scripts/ci/route-js-budgets.json`, `scripts/m0-baseline-report.mjs`, `tests/ci/route-js.spec.ts`, `lint-fixtures/route-js/**`, `tests/e2e/perf/**`, `scripts/perf/**`, `tests/ci/lhci-config.spec.ts`, `playwright.config.ts`, `package.json`/lock, `.github/workflows/{ci,nightly}.yml`, `.gitignore`, `docs/runbooks/performance.md` | Measurement only; independent of the PWA work |
| 2 | **06-04a** route states + `dvh`/safe-area + client error capture | S-M | 06-01a | `app/**/{loading,error,not-found}.tsx`, `app/global-error.tsx`, `app/(dashboard)/diag/client-error/**`, `components/shell/{route-error,route-skeleton}.tsx`, `lib/errors/client-error-kind.ts`, `features/observability/actions.ts`, the 20 `min-h-screen`/`h-screen` sites, `app/globals.css`, `scripts/ci/ui-policy/rules/screen-height.mjs`, `tests/security/guard-manifest.ts`, `tests/e2e/shell/route-states.spec.ts`, `tests/e2e/observability/client-error.spec.ts`, `tests/observability/client-error-action-db.spec.ts`, `tests/errors/client-error-kind.spec.ts` | No design values; boundaries must exist before 06-06's skew/lock reactions |
| 2 | **06-05** manifest, provisional icon, SW, `/offline`, `hardSignOut()`, `no-store`, public assets | M | 06-01a | `app/layout.tsx`, `app/manifest.ts`, `app/icon.svg`, `app/apple-icon.png`, `public/**`, `app/offline/**`, `scripts/design/render-icons.mjs`, `next.config.ts`, `proxy.ts`, `lib/auth/public-paths.ts`, `tests/auth/public-paths.spec.ts`, `lib/auth/hard-sign-out.ts`, `lib/pwa/{register-sw,cleanup,online,device-prefs,purge}.ts`, `components/shell/{pwa-runtime,offline-banner}.tsx`, `app/(dashboard)/layout.tsx`, `components/layout/user-dropdown.tsx`, `scripts/ci/ui-policy/rules/signout-guard.mjs`, `lint-fixtures/ui-policy/signout-guard/**`, `tests/ci/ui-policy-signout-guard.spec.ts`, `tests/pwa/**`, `tests/e2e/pwa/**`, `docs/runbooks/pwa.md` | The installable, PHI-safe base 06-06 builds on |
| 3 | **06-06** install UX, update toast, skew guard, `/api/session-status`, lock client | S-M | 06-05, 06-04a; V2-05 05-09a/05-10a/05-10b | `app/api/session-status/route.ts`, `lib/auth/access-redirect.ts`, `app/(dashboard)/layout.tsx`, `lib/pwa/{session-status,update,skew,lock,dirty-guard,install,platform}.ts`, `components/shell/{pwa-runtime,update-toast,install-entry,install-sheet,install-card}.tsx`, `components/layout/user-dropdown.tsx`, `app/(dashboard)/page.tsx`, `next.config.ts`, `lib/env.ts`, `lib/env-server.ts`, env-guard files, `tests/e2e/support/app-env.ts`, `.env.example`, `tests/security/guard-manifest.ts`, `tests/security/guard/engine.ts`, `playwright.config.ts`, `tests/e2e/pwa/{05,06,10}-*.spec.ts`, `tests/api/session-status*.spec.ts`, `tests/pwa/**`, `docs/runbooks/pwa.md` | Needs the runtime, the exit helper and the boundaries |
| A-review | Wave A reviews → **06-09a** review fixes | — | waves 1-3 | files named by the triage | Security review while the PWA code is fresh, independent of G2-D |
| 4 | **06-01b** approved values, local IBM Plex, AI/Smart Assist tokens + chips, approved icon | S | **G2-D (06-P2)**, 06-05 | `app/globals.css`, `lib/design/tokens.ts`, `app/fonts/**`, `app/layout.tsx`, `app/icon.svg`, `app/apple-icon.png`, `public/icon-*.png`, `components/clinical/ai-*.tsx`, `components/clinical/smart-assist-label.tsx`, `components/consultation/ai-scribe-modal.tsx`, `scripts/ci/ai-l1-greps.mjs`, `tests/ci/ai-l1-greps.spec.ts`, `lint-fixtures/ai-l1/**`, `scripts/design/contrast.mjs`, `lib/design/contrast-pairs.ts`, `tests/design/{approved-tokens,contrast}.spec.ts`, `tests/e2e/design/fonts.spec.ts` | The direction; everything after builds on approved values |
| 5 | **06-02a** form primitives (2a) + input kinds (PWA-07) + `/dev/ui` | M | 06-01b | `components/ui/{button,icon-button,kbd,input,textarea,field,label,native-select,checkbox,radio-group,switch,segmented-control,chip-group}.tsx`, `lib/ui/**`, `app/dev/ui/**`, `lib/dev/gallery.ts`, `package.json`/lock (`radix-ui`), `tests/design/**` (new files), `tests/e2e/design/{gallery-axe,input-modes,keyboard/forms}.spec.ts`, `tests/e2e/pwa/04-offline.spec.ts` | Gallery and the input contract first |
| 6 | **06-02b** overlays + menus + tabs + toast + command (2b); `Modal`/`Dropdown` adapters | M | 06-02a | `components/ui/{dialog,alert-dialog,sheet,drawer,responsive-sheet,popover,tooltip,dropdown-menu,tabs,toast,command,modal,dropdown}.tsx`, `app/dev/ui/**`, `package.json`/lock (`cmdk`, `sonner`), `components/layout/user-dropdown.tsx` (only if the adapter needs it), `tests/e2e/design/keyboard/overlays.spec.ts`, `tests/e2e/shell/user-menu-keyboard.spec.ts` | Fixes focus traps of the 10 `<Modal>` users and the user menu |
| 7 | **06-02c** data display (2c) + date/time and identity inputs (2d) | M | 06-02b | `components/ui/{data-table,data-list,pagination,search-field,filter-chip,skeleton,empty-state,alert,banner,date-field,calendar,day-strip,slot-picker,phone-input,age-or-dob-input}.tsx`, `lib/ui/age.ts`, `app/dev/ui/**`, `package.json`/lock (`react-day-picker`), `tests/design/age.spec.ts`, `tests/e2e/design/keyboard/data-and-dates.spec.ts` | Completes the primitive set the clinical components use |
| 8 | **06-03a** clinical identity and status patterns | M | 06-02c | `lib/visit-status.ts`, `components/clinical/{patient-identity-header,allergy-banner,status-chip,token-chip,queue-row,save-status,share-button}.tsx`, `app/dev/ui/**`, `tests/clinical/visit-status.spec.ts`, `tests/e2e/design/keyboard/clinical-a.spec.ts` | Patterns Today (V2-08) and Consult (V2-09b) consume |
| 9 | **06-03b** clinical entry patterns | M | 06-03a | `components/clinical/{vitals-form,vitals-summary,rx-line-item,rx-entry-row,patient-picker,quick-register-form}.tsx`, `lib/clinical/vitals.ts`, `app/dev/ui/**`, `tests/clinical/vitals.spec.ts`, `tests/e2e/design/keyboard/clinical-b.spec.ts` | Uses Command and the 2d inputs |
| 10 | **06-04b** shell, `navForRole`, command palette, toasts, in-app Back, keyboard-aware bars, refetch on resume | M | 06-03b | `components/shell/**` (app shell files), `components/layout/**` (v1 shell removed), `lib/nav/nav-for-role.ts`, `lib/pwa/{resume,keyboard-aware}.ts`, `app/(dashboard)/layout.tsx`, `features/patients/{actions,service}.ts` (palette projection), `tests/security/guard-manifest.ts`, `app/dev/ui/**`, `tests/nav/nav-for-role.spec.ts`, `tests/e2e/shell/**`, `tests/e2e/pwa/08-layout.spec.ts` | The shell composes everything above |
| 11 | **06-08** close-out: React Compiler rules → error, policy report, G3 screenshot set, evidence | S | all | `eslint.config.mjs`, `scripts/ci/react-compiler-waivers.json`, `tests/ci/react-compiler-waivers.spec.ts`, `scripts/ci/assert-vitest-report.mjs`, `scripts/ci/ui-policy-baseline.json`, `tests/e2e/design/screenshot-set.spec.ts`, `scripts/design/screenshot-index.mjs`, `.github/workflows/nightly.yml` (design lane), evidence | |
| close | Phase reviews → **06-09b** review fixes; documents | — | all | files named by the triage | |

Cross-wave hot files and their owners in order: `app/globals.css` 06-01a → 06-04a → 06-01b; `lib/design/tokens.ts`
06-01a → 06-01b; `app/layout.tsx` 06-05 → 06-01b; `next.config.ts` 06-05 → 06-06; `app/(dashboard)/layout.tsx` 06-05 →
06-06 → 06-04b; `components/layout/user-dropdown.tsx` 06-01a (codemod) → 06-05 → 06-06 → 06-02b → 06-04b;
`playwright.config.ts` 06-01a → 06-07 → 06-06; `package.json`/lock 06-01a (scripts) → 06-07 → 06-02a → 06-02b → 06-02c;
`.github/workflows/ci.yml` 06-01a → 06-07; `.github/workflows/nightly.yml` 06-07 → 06-08; `eslint.config.mjs` 06-01a →
06-08; `tests/security/guard-manifest.ts` 06-04a → 06-06 → 06-04b; `components/shell/pwa-runtime.tsx` 06-05 → 06-06 →
06-04b; `lib/pwa/**` 06-05 → 06-06 → 06-04b; `tests/e2e/pwa/**` 06-05 → 06-06 → 06-02a → 06-04b;
`docs/runbooks/pwa.md` 06-05 → 06-06; `app/dev/ui/**` 06-02a → 06-02b → 06-02c → 06-03a → 06-03b → 06-04b;
`scripts/ci/ui-policy/rules/**` 06-01a → 06-04a (`screen-height`) ∥ 06-05 (`signout-guard`, new file);
`scripts/ci/ai-l1-greps.mjs` 06-01b; `scripts/ci/assert-vitest-report.mjs` 06-08.

## New dependencies and pinned artefacts (CLAUDE.md: reason required)

| Item | Pin | Plan | Why | Legitimacy |
|---|---|---|---|---|
| `@lhci/cli` (devDependency) | **0.15.1** exact (published 2025-06-25; pins `lighthouse` 12.6.1) | 06-07 | Roadmap PWA-09 names Lighthouse CI; report-only nightly on Login, Today, Patients, Consult; a Playwright+CDP substitute would not be "Lighthouse" | Research flags 0.16.x and `lighthouse` 13.x as **[SUS] too-new**; 0.15.1 is 17 months old and not flagged. If 0.15.1 cannot drive the Playwright Chromium build (tool error, not a score), fall back to `0.16.0` (SUS) and record it. PO confirms (06-P4); blocks the **merge**, not local work |
| `radix-ui` | **1.8.1** exact | 06-02a | Focus trap, scroll lock, roving focus, dismiss layers for Dialog, AlertDialog, Popover, DropdownMenu, Tooltip, Tabs, RadioGroup, Checkbox, Switch (F-10: 21+ v1 overlays lack focus traps); shadcn's current unified import | Research audit OK (27.5 M/week, published 2026-10-12, no install scripts); PO confirms (06-P5) |
| `cmdk` | **1.1.1** exact | 06-02b | Command palette and Combobox listbox semantics (`aria-activedescendant`, typeahead) | OK; its `@radix-ui/react-dialog` dependency dedupes under `radix-ui`; PO confirms (06-P5) |
| `sonner` | **2.0.8** exact | 06-02b | Toast queue with `role="status"`/`alert` live regions and stacking | OK, no dependencies; PO confirms (06-P5) |
| `react-day-picker` | **10.0.2** exact | 06-02c | Calendar grid with locale and keyboard grid navigation for DateField | OK; depends on `date-fns ^4.1.0` and `@date-fns/tz ^1.4.1`, satisfied by the existing pins 4.4.0 / 1.5.0 (no second copy; checked in the lockfile diff); PO confirms (06-P5) |
| IBM Plex Sans woff2 (400/500/600, Latin) + `OFL.txt` | the bytes vendored by V2-DX in `.planning/sketches/themes/fonts/` at the G2-D-approved commit; SHA-256 recorded in the G2-D row | 06-01b | `next/font/local` (no build-time network; the e2e build is network-guarded); DESIGN_SYSTEM §3.1 | SIL OFL 1.1; the PO approves the SHA-256 list with G2-D (06-P2) and confirms it with 06-P5 |
| `class-variance-authority` | not added | — | Plain typed variant maps instead (research: optional, avoid) | — |
| `@serwist/turbopack` | not added | — | Hand-written `public/sw.js` (R-12) | — |
| `@testing-library/*`, `jsdom` | not added | — | Keyboard and focus behaviour is tested in a real browser on `/dev/ui` (R-14) | — |

Wave A adds one devDependency (`@lhci/cli`) and no runtime dependency. `lucide-react` (existing)
supplies `Sparkles` (AI only, L1-R4) and `Zap` (Smart Assist). `@playwright/test`, `@axe-core/playwright` (existing)
render the icons and diff screenshots; no image library is added (R-24).

---

## 06-01a Semantic token layer with v1-equivalent values + hex/brand codemod + UI policy (report mode) + design lanes (P1-28 M1 part, DESIGN_SYSTEM §2.3-§2.4, §10; R-22) · M · Wave 1 · no G2-D

Value-neutral by construction: the three token layers exist with values that reproduce today's rendering, so G2-D
(06-01b) only edits values. Proven mechanically by a screenshot diff, not by inspection.

### Files
`app/globals.css`; the codemod's targets (the 70 files with hex arbitrary classes and the files with `brand-*` or
`text-gray-400`/`placeholder:text-gray-400` classes under `app/**` and `components/**`; the exact list is the codemod's
report); `lib/design/tokens.ts`; `scripts/design/{codemod-colors.mjs,color-map.json,neutral-diff.mjs}`;
`scripts/ci/ui-policy.mjs`, `scripts/ci/ui-policy/rules/{arbitrary-color,px-font,raw-palette,brand-utility,window-dialog,link-wraps-button,ai-sdk-import,screen-height}.mjs`,
`scripts/ci/ui-policy-baseline.json`; `eslint.config.mjs` (jsx-a11y at warn); `playwright.config.ts` (projects
`design-360`, `design-820`, `design-1180`, `design-1280`; PR-lane `testIgnore` for capture specs); `package.json` (scripts
`ci:ui-policy`, `e2e:design`; no dependency); `.github/workflows/ci.yml` (one `static` step); `tests/design/{tokens,codemod}.spec.ts`;
`tests/ci/ui-policy.spec.ts`, `lint-fixtures/ui-policy/**`; `tests/e2e/design/neutral/capture.spec.ts`,
`tests/e2e/design/support/{widths,png-diff}.ts`.

### Steps
1. **Tracer:** one semantic token end to end: `@theme` raw `--color-v1-blue-500: #1769e0`, `@theme inline`
   `--color-accent: var(--color-v1-blue-500)`, the codemod rewriting `bg-[#1769e0]` → `bg-accent` in one file,
   `tests/design/tokens.spec.ts` resolving `accent` through both layers and `lib/design/tokens.ts` equal to the CSS, and
   one route captured at 360 before/after with a 0-pixel diff. Then steps 2-7.
2. **`app/globals.css` (the only token source, DESIGN_SYSTEM §10):**
   - *Raw layer* (`@theme`): one `--color-v1-*` entry per distinct v1 colour the codemod maps (named by role, e.g.
     `v1-blue-500`, `v1-blue-50`, `v1-canvas`, `v1-ink-900`, `v1-gray-600`, `v1-red-700`, `v1-amber-700`,
     `v1-green-700`), values copied exactly from the 48 distinct hexes and the Tailwind `gray-400` value the
     `text-gray-400` sites render today.
   - *Semantic layer* (`@theme inline`, the CSS names of DESIGN_SYSTEM §2.4, which spell §2.3's `fg-default` and
     `border-default` as `--color-fg` and `--color-border`): `canvas`, `surface`, `sunken`, `selected`,
     `fg`, `fg-muted`, `fg-subtle`, `fg-placeholder`, `fg-disabled`, `fg-on-accent`, `border`,
     `border-subtle`, `border-control`, `accent`, `accent-hover`, `accent-pressed`, `accent-subtle`, `accent-fg`, `ring`,
     `success-{bg,fg,border,solid}`, `warning-*`, `danger-*`, `info-*`, `status-{booked,waiting,with-doctor,to-bill,done,no-show,cancelled}-{bg,fg}`,
     `alert-allergy-{bg,fg}`, `scrim`; each points at a raw `v1-*` entry. Where DESIGN_SYSTEM has no v1 equivalent
     (status chips, allergy, scrim), the value is the colour the nearest v1 screen uses today (e.g. v1 badge colours),
     listed in `color-map.json` under `provisional_without_v1_site`.
   - *Structural layer* (`@theme`): only names that do not collide with a Tailwind default in use, so nothing renders
     differently: `--text-caption … --text-token` (DESIGN_SYSTEM §3.2; no site uses them yet), `--shadow-popover`,
     `--shadow-overlay`, `--ease-out`, `--duration-{fast,base,sheet}`, shell sizes `--spacing-bar: 3.5rem`,
     `--spacing-bottom-bar: 4rem`, `--spacing-rail: 4rem`, `--spacing-sidebar: 14.5rem`, `--spacing-control: 2.75rem`
     (44 px a11y floor); the existing `--shadow-theme-*` stay. `--radius-*` and `--font-sans` are **not** redefined here
     (DESIGN_SYSTEM's 4/6/10/14 px radii and IBM Plex would change every `rounded-*` and all text): they are approved
     values and land in 06-01b.
   - The dead `:root` block (30 variables) is deleted; `body` uses `var(--color-canvas)` and `var(--color-fg)`;
     `min-height: 100vh` stays until 06-04a. The `--color-brand-*` scale is deleted once the codemod leaves 0 users.
   - The Tailwind default palette stays available (palette reset `--color-*: initial` is M5, V2-11).
3. **`lib/design/tokens.ts`:** the handful of values non-CSS code needs (`themeColor`, `backgroundColor`, `iconTile`,
   `iconGlyph`), typed constants; `tests/design/tokens.spec.ts` parses `app/globals.css` and asserts each mirror value
   equals the CSS value it names (the CSS stays the single source).
4. **Codemod `scripts/design/codemod-colors.mjs` + `color-map.json`:** property-aware table keyed by
   (utility property, lowercase hex) → semantic utility (e.g. `bg`+`#1769e0` → `bg-accent`, `text`+`#1769e0` →
   `text-accent`, `bg`+`#eaf2ff` → `bg-accent-subtle`, `bg`+`#f7f6f3` → `bg-canvas`, `text`+`#111827` → `text-fg`,
   `text`+`#4b5563` → `text-fg-muted`, `border`+`#e5e7eb` → `border-border`, `text`+`#b42318` → `text-danger-fg`,
   `text`+`#9a5b00` → `text-warning-fg`, `bg`+`#155cc0`/`#0f5ab8` → `bg-accent-hover`), plus `brand-<step>` →
   semantic, `text-gray-400` → `text-fg-subtle`, `placeholder:text-gray-400` → `placeholder:text-fg-placeholder`.
   Case-insensitive hex; variants (`hover:`, `focus-visible:`, `md:`), opacity modifiers (`/10`), `!` important and
   `outline`/`ring`/`fill`/`stroke`/`divide`/`from`/`via`/`to` preserved. Scope: `className`/`cn()`/`clsx()` string
   literals and template text in `app/**`, `components/**`, `features/**` `.tsx`. Out of scope with reasons in the
   report: the four react-pdf documents (`features/{referrals,dpdp,billing,prescriptions}/pdf/*`, inline style objects in
   PDF space) and the 22 odontogram inline hexes (SVG drawing colours; V2-09b rebuilds dental). Unmapped
   (property, hex) pairs are left untouched and listed. Idempotent. Writes
   `evidence/06-01a/codemod-report.json` (per file: replacements by rule; totals; unmapped list; collapses: every
   semantic fed by more than one v1 hex, with the hexes and counts).
5. **UI policy `scripts/ci/ui-policy.mjs`** (DESIGN_SYSTEM §10 guards; TypeScript parser like `ai-l1-greps.mjs`, over
   `git ls-files` in `app|components|features|lib`): rules are auto-discovered from `scripts/ci/ui-policy/rules/*.mjs`,
   each exporting `{ id, mode: "report" | "enforce", reason, check(file, sourceFile) }`, so later plans add or flip a
   rule by touching only its own file. Rules now: `arbitrary-color` (report), `px-font` (report), `raw-palette` (report;
   Tailwind default palette utilities and raw `v1-*` utilities outside `components/ui/**`), `brand-utility` (**enforce**:
   the scale is deleted, a reintroduced class would render nothing), `window-dialog` (`alert(`/`confirm(`/`prompt(`,
   report), `link-wraps-button` (report), `ai-sdk-import` (report), `screen-height` (`min-h-screen`, `h-screen`,
   `100vh` in class strings; report until 06-04a). Output: per-rule counts, delta against `scripts/ci/ui-policy-baseline.json`,
   file:line list in `--json`; exit 0 in report mode, exit 1 on any enforce-rule finding, 2 on usage error. The AI-06 L1
   checks stay in `ai-l1-greps.mjs` and stay blocking (R-13). `package.json` script `ci:ui-policy`; `ci.yml` `static`
   job step "UI policy (DESIGN_SYSTEM §10; report mode, enforced rules fail)" with the markdown table appended to
   `$GITHUB_STEP_SUMMARY`.
6. **jsx-a11y recommended rules at `warn`** (report mode) in `eslint.config.mjs`: read the rule list from the
   `jsx-a11y` plugin object that `eslint-config-next` already registers (taken from the imported `nextCoreWebVitals`
   config array, no new import of the plugin package), map each to `"warn"`; record the warning count in the evidence.
7. **Design lanes in `playwright.config.ts`:** projects `design-360` (360×780), `design-820` (820×1180), `design-1180`
   (1180×820), `design-1280` (1280×800), Chromium, `testMatch: /\/design\//` minus keyboard/axe specs (those run in the
   PR lane on `desktop-chrome`); PR-lane projects ignore `tests/e2e/design/{neutral,screens}/**`. `npm run e2e:design`
   runs the four projects. `tests/e2e/design/neutral/capture.spec.ts` reuses `BASELINE_ROUTES` and the M0 clock freeze
   and writes PNGs to `test-results/design/neutral/<label>/<project>/` where `<label>` comes from
   `test-results/design/neutral/label.json` (written by the script; no env read in specs).
   `scripts/design/neutral-diff.mjs capture --label before|after` runs that spec; `compare --before before --after after
   --out evidence/06-01a/neutral-diff.json` loads each PNG pair into a headless Chromium page (`file:`/`data:` only, all
   other requests aborted) and counts pixels whose largest channel delta exceeds 8/255; writes per screen: width,
   route, differing pixel ratio, pass/fail against 0.5 %.
8. Run order for the evidence: `npm run e2e:build` at the plan's base commit → `capture --label before`; apply steps
   2-6 → `npm run e2e:build` → `capture --label after` → `compare`. Every screen above 0.5 % is either fixed (a missing
   mapping) or explained by a listed collapse; none is accepted silently.

### Tests that fail without the change
- `tokens.spec.ts`: every DESIGN_SYSTEM §2.3 semantic name resolves through `@theme inline` to a defined raw value; the
  mirror equals the CSS; no `--color-brand-` and no `:root` block remain; `body` uses semantic variables (before: no
  semantic names exist).
- `codemod.spec.ts` (fixtures in `lint-fixtures/ui-policy/codemod/`): `hover:bg-[#155CC0]/80` → `hover:bg-accent-hover/80`;
  `text-[#1769e0]` and `border-[#1769E0]` map by property; `brand-500` → `accent`; an unmapped hex is left and listed;
  a second run changes nothing; a react-pdf fixture is skipped with its reason (before: no codemod).
- `ui-policy.spec.ts`: each rule finds its fixture violation with file:line; report-mode findings exit 0; a
  `brand-utility` finding exits 1; rules are discovered without a central list (a fixture rule directory with an extra
  rule file is picked up).
- Repository state after the codemod (tool output in `evidence/06-01a/ui-policy.json`): `arbitrary-color` in scope 0
  (before 775 in 70 files), `brand-utility` 0 (before 183), `text-gray-400` 0 (before 247).
- `neutral-diff.json`: every screen at 360/820/1180/1280 ≤ 0.5 % differing pixels; collapses listed.
- e2e: `npm run e2e:pr` green (M0 characterisation, a11y, auth, security specs).

### UI checks
The neutral diff covers the 25 M0 baseline screens at the four widths; axe on the M0 routes is re-run with
`npm run e2e:baseline` and its counts recorded (expected unchanged: values are v1-equivalent).

### Acceptance mapping
P1-28 M1 tokens and codemod (values provisional by design, approved in 06-01b); roadmap "the grep guards … are in
report mode" (DESIGN_SYSTEM §10 guards); v1 screens still work.

---

## 06-07 Route-JS report + M0 report fix + Lighthouse CI report-only (P2-02, PWA-09, PWA §3.9, R-5, R-6) · S · Wave 2 · no G2-D

### Files
`scripts/ci/route-js.mjs`, `scripts/ci/route-js-budgets.json`, `tests/ci/route-js.spec.ts`, `lint-fixtures/route-js/**`
(a small `.next`-shaped tree); `scripts/m0-baseline-report.mjs`; `tests/e2e/perf/lhci.spec.ts`,
`scripts/perf/lighthouserc.base.json`, `scripts/perf/lhci-config.mjs` (pure builder of the run config),
`tests/ci/lhci-config.spec.ts`; `playwright.config.ts` (project `perf-lhci`); `package.json`/lock (`@lhci/cli`
devDependency; scripts `ci:route-js`, `perf:lhci`); `.github/workflows/ci.yml` (`build` job step);
`.github/workflows/nightly.yml` (job `lhci`); `.gitignore` (`.lighthouseci/`); `docs/runbooks/performance.md`.

### Steps
1. **Tracer:** `route-js.mjs` on the fixture tree prints one route's first-load JS (gzip -9) and the framework root,
   with the spec asserting the numbers; then the real `.next` after `npm run build`.
2. **`scripts/ci/route-js.mjs`** (Next 16 Turbopack has no build-output size column and no `app-build-manifest.json`):
   framework root = `rootMainFiles` of `.next/build-manifest.json`; per app route = root ∪ every `entryJSFiles` list in
   that route's `.next/server/app/**/page_client-reference-manifest.js` (evaluated in a `node:vm` sandbox with a fresh
   `globalThis.__RSC_MANIFEST` object, no `require`); sizes gzip -9 of the files under `.next/`. Output
   `route-js.json` + `route-js.md`: per route total, route-specific (total − root), budget from
   `route-js-budgets.json` (PWA §3.9: 150 kB shell-only routes, 200 kB Today and Consult; `/_not-found` and API routes
   excluded), status `ok|over`; method note "Turbopack manifests, gzip -9; not comparable 1:1 with the M0 webpack
   numbers" in the header. Report-only: exit 0; `--enforce` exits 1 on any `over` (for V2-15); exit 2 if a manifest is
   missing.
3. **M0 report:** `scripts/m0-baseline-report.mjs` imports the route-JS function instead of reading
   `.next/app-build-manifest.json`, so `npm run e2e:baseline` reports route JS again.
4. **CI:** in the `build` job after `npm run build`: `node scripts/ci/route-js.mjs --out route-js` → table to
   `$GITHUB_STEP_SUMMARY`, upload artifact `route-js` (14 days). Never fails the job on a budget.
5. **Lighthouse CI as a Playwright spec** (`tests/e2e/perf/lhci.spec.ts`, project `perf-lhci`, never in the PR lane):
   inside the e2e run, so the guarded server (port 3100), the seeded run data and the signed-in storage states exist
   and are torn down as usual. For Login (signed out), Today `/`, Patients `/patients` and Consult
   `/consultation/<run visit id>` (owner/doctor storage state): build the config with `scripts/perf/lhci-config.mjs`
   (`collect.url` loopback only; `settings.preset` mobile defaults, simulated throttling; `settings.extraHeaders` = the
   `Cookie` header from the role's storage state; `chromePath` = Playwright's Chromium executable;
   `chromeFlags` include `--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"`;
   `upload.target: "filesystem"`, `outputDir: test-results/lhci/`; every assertion at `warn` with the PWA §3.9 numbers:
   LCP ≤ 2.5 s, TBT ≤ 300 ms, CLS ≤ 0.1, ≤ 2 font files). The config is written to `testInfo.outputPath()` (git-ignored)
   and deleted in `finally`; the spawned `lhci collect`/`assert`/`upload` processes get an explicit minimal env. After
   upload, a scrub step rewrites every `*.json`/`*.html` report: `configSettings.extraHeaders` removed and any
   `Cookie`/`Authorization` header value replaced by `[REDACTED]`; the spec asserts no report file contains the cookie
   value (the repository and its artifacts are public). Turnstile on `/login` resolves to nothing under the resolver
   rule; the login score is recorded with that note. The spec fails only on tool errors, never on a score.
6. **Nightly:** job `lhci` in `nightly.yml` (only for `lane == nightly`): checkout, `npm ci`, Chromium install, local
   stack, `npm run e2e:build`, `npm run perf:lhci`, upload `test-results/lhci/` as artifact `lhci` (30 days) after the
   scrub, summary table of the four routes. Same workflow rules as today (SHA-pinned actions, no secrets, read-only
   token; `scripts/ci/workflow-policy.mjs` passes).
7. **Runbook** `docs/runbooks/performance.md`: how to read both reports, the method difference to M0, the V2-15
   switch (`--enforce`, LHCI assertions to `error`), the Turbopack framework floor (128.8 kB) and the budget question for
   V2-15 (R-5).

### Tests that fail without the change
- `route-js.spec.ts`: on the fixture, root files counted once; a route's total = root + its entry files; gzip -9 sizes
  equal the fixture's known values; a route over budget is `over` and exit 0; with `--enforce` exit 1; a missing
  `build-manifest.json` exits 2 naming the file (before: no script).
- `m0-baseline-report` route-JS function returns `available: true` with routes on the fixture tree (before:
  `available: false` because `app-build-manifest.json` does not exist under Turbopack).
- `lhci-config.spec.ts`: the built config uses filesystem upload, only loopback URLs (a non-loopback URL throws), the
  host-resolver rule, all assertions `warn`; the scrub removes `extraHeaders` and redacts cookie values in a fixture LHR
  (before: none).
- `perf-lhci` run locally once: four LHR files, no cookie value in any report (tool output in
  `evidence/06-07/lhci-summary.json`).

### Acceptance mapping
P2-02 "bundle budgets in CI" (report-only, budgets in a file; blocking at V2-15); PWA-09 "Lighthouse CI on 4 routes:
report-only"; roadmap evidence "the bundle report"; M0 report repaired.

---

## 06-04a Route states, `dvh`/safe-area utilities, client error capture (P1-28 M3 route states, PWA-03 shell part, V2-03 R-29; R-3) · S-M · Wave 2 · no G2-D

### Files
`app/(dashboard)/{loading,error,not-found}.tsx`, `app/(onboarding)/{loading,error}.tsx`, `app/(auth)/error.tsx`,
`app/{r,reports,reschedule}/error.tsx`, `app/not-found.tsx`, `app/global-error.tsx`;
`components/shell/{route-error,route-skeleton}.tsx`; `lib/errors/client-error-kind.ts`;
`features/observability/actions.ts` (new `"use server"` module); `app/(dashboard)/diag/client-error/{page,trigger}.tsx`;
the 20 `min-h-screen`/`h-screen` sites (`app/(auth)/{login,forgot-password,join}/page.tsx`, `app/r/[token]/page.tsx`,
`app/reschedule/[token]/page.tsx`, `app/reports/view/page.tsx`, `app/(onboarding)/clinic/new/page.tsx`,
`components/auth/clinic-showcase-panel.tsx`, `components/layout/app-layout-shell.tsx`,
`components/consultation/consultation-workspace.tsx`); `app/globals.css` (utilities); `scripts/ci/ui-policy/rules/screen-height.mjs`;
`tests/security/guard-manifest.ts`; `tests/errors/client-error-kind.spec.ts`;
`tests/observability/client-error-action-db.spec.ts`; `tests/e2e/shell/route-states.spec.ts`;
`tests/e2e/observability/client-error.spec.ts`.

### Steps
1. **Tracer:** `app/(dashboard)/diag/client-error` (renders `notFound()` unless `serverEnv().DIAG_ERROR_ROUTE_ENABLED`,
   which the env schema already refuses in production, 03-09b R-18) with a client button that makes a child throw
   `DiagClientRenderError` on render → `app/(dashboard)/error.tsx` → `reportClientRenderError` → `ops.error_events` row,
   proven by `client-error.spec.ts`. Then steps 2-5.
2. **Client error capture (R-3):** `reportClientRenderError({ name, route })` in `features/observability/actions.ts`,
   guard `{ member: "client render error report" }` (membership-only, `resolveServiceContext()` with no permission);
   zod input: `name` ≤ 80 chars, `route` ≤ 200 chars. Server side: `name` through `errorNameOf` (NAME_PATTERN, no
   identifier-shaped values) else `"Error"`; stored `error_name = "client." + name`; `route_path` through `routePattern()`
   and refused (replaced by the route group root, e.g. `/`) if any segment is UUID-shaped, has 6+ digits or an `@`;
   `route_type = "render"`, `method`, `digest`, `request_id` null, `message = ""`, `frames = []`; tier and release from
   `serverEnv()`/`deploymentInfo()`; through `admitToSink` (flood cap) and `sendErrorEvent`; one
   `log.warn({ event: "client.render_error", route, code })`. Returns nothing. Client side
   (`components/shell/route-error.tsx`, used by the dashboard and onboarding `error.tsx`): reports only errors **without**
   a `digest` (a digest means the server already recorded it through `onRequestError`); computes the route pattern from
   `usePathname()` by replacing each segment equal to a `useParams()` value with `[param]`; sends no message, stack or
   query string. Public and auth boundaries (`(auth)`, `r`, `reports`, `reschedule`, `global-error`) never report (no
   session; CLAUDE.md: actions authenticate). `lib/log/client.ts` `reportClientError` stays development-only (R-29 as
   shipped): caught, handled client errors are not sent; only uncaught render errors reach the sink. 06-SUMMARY records
   this split.
3. **Route states:** `error.tsx` per group with `route-error.tsx`: heading, plain-language text, "Try again"
   (`reset()`), "Go to Today" link inside the dashboard; never the error message (PHI); shows the digest as a short
   reference when present. `lib/errors/client-error-kind.ts` classifies: `offline` (`navigator.onLine === false`),
   `skew` (`unstable_isUnrecognizedActionError(error)` from `next/navigation`, or `ChunkLoadError` by name), `other`; the
   boundary shows "You're offline. Reconnect to continue." or "This app was updated. Reload to continue." (06-06 reuses
   the classifier). `loading.tsx` per group renders `route-skeleton.tsx` (`role="status"`, accessible name "Loading").
   `not-found.tsx` in the dashboard (inside the shell) and at the root (`app/not-found.tsx`). `app/global-error.tsx`
   replaces Next's default: own `<html lang>`/`<body>`, digest only, reload button, no message.
4. **`dvh` and safe areas (PWA §3.3):** `@utility min-h-app { min-height: 100vh; min-height: 100dvh; }`, `h-app`
   (same with `height`), `pb-safe { padding-bottom: max(0.5rem, env(safe-area-inset-bottom)); }`, `pt-safe`, `px-safe`
   (left/right insets) in `app/globals.css`; the vh line is the fallback for WebViews without `dvh`. The 20 sites move to
   `min-h-app`/`h-app`; `body` drops `min-height: 100vh` for `min-height: 100dvh` with the vh fallback.
   `rules/screen-height.mjs` flips to `mode: "enforce"`.
5. **Guard manifest:** the new action's entry (`features/observability/actions.ts#reportClientRenderError`:
   `{ member: "client render error report (06-04a, R-3)" }`); the guard specs then run its unauthenticated and
   cross-tenant legs.

### Tests that fail without the change
- `client-error.spec.ts` (e2e, PR lane desktop-chrome): signed in as the owner, triggering the diag render error shows
  the boundary (no error message text on the page) and exactly one `ops.error_events` row appears with
  `error_name = 'client.DiagClientRenderError'`, `route_path = '/diag/client-error'`, `route_type = 'render'`,
  `message = ''`, empty frames; "Try again" recovers (before: no row; production `reportClientError` is a no-op).
- `client-error-action-db.spec.ts`: `name` `Error123456` → stored `client.Error`; route `/patients/0b0e…` (UUID) or
  `/x/1234567` → stored as the group root; a 300-char route → refused by zod; the guard legs (unauthenticated denied,
  no-membership denied) pass from the manifest entry.
- `client-error-kind.spec.ts`: offline, an error built by Next's own unrecognized-action constructor, a `ChunkLoadError`,
  and a plain `Error` classify as `offline`, `skew`, `skew`, `other`.
- `route-states.spec.ts`: `/patients/<random uuid>` renders the dashboard not-found inside the shell with HTTP 404;
  `/no-such-page` renders the root not-found; a client navigation whose RSC response is delayed 1.5 s by `page.route`
  (matching the `RSC` request header) shows the `status` "Loading" skeleton; the diag error page shows "Try again" and
  no message.
- `ui-policy` repository run: `screen-height` 0 findings, enforced (before: 20).

### UI checks
Error, not-found and loading states captured at 360/820/1180/1280 inside the dashboard and at the root; axe 0
serious/critical on each; no horizontal scroll.

### Acceptance mapping
P1-28 M3 "`loading.tsx`, `error.tsx`, `not-found.tsx` for every route group"; PWA-03 safe areas and `dvh` (PWA §10
"0 `min-h-screen`/`h-screen` in the new shell"); V2-03 R-29 client error capture; v1 screens still work.

---

## 06-05 Manifest, provisional icon, service worker, `/offline`, `hardSignOut()`, `no-store`, public PWA assets (PWA-01, PWA-02, PWA-08b specs 1-5 and 11, PWA §3.1, §3.6, §4, §5; R-12, R-18, R-19, R-20, R-23, R-24) · M · Wave 2 · no G2-D

The icon is PO-19's accepted default (teal `#0E716B` tile, "Q" glyph); nobody installs before G6 (PO-15), so 06-01b
swaps it in one commit if G2-D changes it. Everything else here is behaviour and security, fixed by PWA_STRATEGY.

### Files
`app/layout.tsx`; `app/manifest.ts`; `app/icon.svg` (master, outlined glyph, no font); `app/apple-icon.png`;
`public/{sw.js,icon-192.png,icon-512.png,icon-maskable-512.png}`; `scripts/design/render-icons.mjs`;
`app/offline/page.tsx`; `next.config.ts`; `proxy.ts`; `lib/auth/public-paths.ts`; `tests/auth/public-paths.spec.ts`;
`lib/auth/hard-sign-out.ts`; `lib/pwa/{register-sw,cleanup,online,device-prefs,purge}.ts`;
`components/shell/{pwa-runtime,offline-banner}.tsx`; `app/(dashboard)/layout.tsx` (mounts `PwaRuntime`);
`components/layout/user-dropdown.tsx`; `scripts/ci/ui-policy/rules/signout-guard.mjs`,
`lint-fixtures/ui-policy/signout-guard/**`, `tests/ci/ui-policy-signout-guard.spec.ts`;
`tests/pwa/{purge,device-prefs,sw-allowlist}.spec.ts`; `tests/e2e/pwa/fixtures.ts`,
`tests/e2e/pwa/{01-manifest,02-installable,03-sw,04-offline,05-cache-audit}.spec.ts`; `docs/runbooks/pwa.md`.

### Steps
1. **Tracer:** `app/manifest.ts` + `/manifest.webmanifest` added to `PUBLIC_PAGE_PREFIXES` + spec 1's first case (a
   cookie-less GET answers 200 `application/manifest+json`, no redirect) + the public-paths spec extension. Then 2-9.
2. **Public PWA assets (PWA §3.1 rule; V2-03 default deny):** `PUBLIC_PAGE_PREFIXES` gains `"/manifest.webmanifest"`,
   `"/sw.js"`, `"/offline"` with a comment naming PWA §3.1. Icons stay single-segment image files (`/icon-*.png`,
   `/apple-icon.png`, `/icon.svg`), which the proxy matcher already excludes; no `app/icon.tsx` and no
   `generateImageMetadata` (dynamic, extension-less or nested paths would be default-denied, research Pitfall 5).
   `tests/auth/public-paths.spec.ts`: the walker also yields `app/manifest.ts` (pattern `/manifest.webmanifest`) and
   every `public/**` file (pattern `/<name>`); `PUBLIC_DIRS` gains `app/offline/`; the "exactly public" list gains
   `app/offline`; the stale-prefix check therefore covers the three new prefixes; the whole-segment and encoded-path
   cases gain `/sw.jsx`, `/offlinex`, `/manifest.webmanifestx` (protected) and `/offline/..%2Fpatients` (protected).
3. **Manifest and root metadata (`app/manifest.ts`, `app/layout.tsx`):** manifest per PWA §3.1 (`id: "/"`,
   `name`/`short_name` "ClinicQ", `start_url: "/?source=pwa"`, `scope: "/"`, `display: "standalone"`, no
   `orientation`, `background_color` and `theme_color` from `lib/design/tokens.ts`, icons 192/512 `any` + 512
   `maskable`, no shortcuts (P3, R-23 note)). Root layout: `viewport` export `{ themeColor, viewportFit: "cover", width:
   "device-width", initialScale: 1, interactiveWidget: "resizes-content", colorScheme: "light" }` (no `maximumScale`,
   no `userScalable`); `metadata.appleWebApp = { capable: true, title: "ClinicQ", statusBarStyle: "default" }`;
   `metadata.title = { default: "ClinicQ", template: "%s · ClinicQ" }` (D-7: titles never carry patient names);
   `<html lang="en-IN">` (PWA-01; value-free, so not deferred to 06-01b).
4. **Icons (R-24):** `app/icon.svg` is the master (tile `#0E716B` from the token mirror, glyph as an outlined path).
   `scripts/design/render-icons.mjs` renders it with Playwright's Chromium (existing devDependency; `file:` only, all
   other requests aborted) to `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png` (full-bleed
   tile, glyph inside the 80 % safe zone) and `app/apple-icon.png` (180×180, opaque); `--check` re-renders to a temp dir
   and fails if the committed PNG dimensions or the master's SHA-256 recorded in `public/icons.json` differ.
5. **`/offline` (PWA §3.6):** `app/offline/page.tsx`, static (`dynamic = "force-static"`), outside every group: brand
   word, "You're offline. Patient data isn't stored on this device. Reconnect to continue.", and a Retry link to `/`
   (works without JavaScript); semantic tokens only; `min-h-app`; no user, tenant or session reference.
6. **Service worker `public/sw.js`** (plain JS, no imports, ≈ 100 lines; PWA §5, research Pattern 5): caches
   `static-v1` (cap 200 entries, oldest evicted on put) and `shell-v1`; `install` precaches `/offline`,
   `/manifest.webmanifest` and the three icons with `fetch(url, { credentials: "omit", cache: "no-store" })` and throws
   on `!ok` or `redirected` (never caches a login redirect); `activate` deletes every other cache name, enables
   navigation preload, `clients.claim()`; `fetch`: cross-origin or non-GET → return (D-1); `mode === "navigate"` →
   preload response or network, on failure `caches.match("/offline")`, never stored; pathname under `/_next/static/` →
   cache-first (key includes `?dpl=`); everything else (RSC `?_rsc=`, `RSC: 1`, `/api/**`, `/auth/**`, `/r/**`,
   `/reschedule/**`, `/reports/**`, `/_next/image`) → no `respondWith`. `next.config.ts` `headers()` for `/sw.js`:
   `Content-Type: application/javascript; charset=utf-8`, `Cache-Control: no-cache, no-store, must-revalidate`,
   `Content-Security-Policy: default-src 'self'; script-src 'self'`. The app CSP directives (`worker-src`,
   `manifest-src`) stay with P1-18 in V2-14. `lib/pwa/register-sw.ts` registers `/sw.js` with `{ scope: "/",
   updateViaCache: "none" }` only from `PwaRuntime` (authenticated shell), only when the server layout passes
   `swEnabled` (`APP_ENV !== "development"`, so `next dev` never caches dev chunks).
   `docs/runbooks/pwa.md`: the allowlist, how to bump cache versions, and the **kill switch** (a `sw.js` body that deletes
   all caches and unregisters itself, kept verbatim in the runbook and checked by `tests/pwa/sw-allowlist.spec.ts`).
7. **`no-store` on authenticated responses (D-4, R-20):** `proxy.ts` sets `Cache-Control: private, no-cache, no-store,
   must-revalidate, max-age=0` (the existing `SESSION_CACHE_HEADERS` value) on every signed-in GET/HEAD page and RSC
   response (non-`/api`, non-static), instead of relying on Next's default for dynamic pages (research A5).
8. **`hardSignOut(reason)` (D-5 adapted to V2-03's route; research Pattern 6):** `lib/auth/hard-sign-out.ts`,
   reasons `user | everywhere | switch | expired | removed | idle`. Order: (1) `runCleanups("signout")` from
   `lib/pwa/cleanup.ts` (registry: Realtime unsubscribe, abort in-flight requests, clear in-memory state; v1 has no
   Realtime subscriber, the first is V2-08's Today, R-17); (2) `fetch("/auth/signout", { method: "POST", body: scope
   form, redirect: "manual", credentials: "same-origin", signal: AbortSignal.timeout(5000) })` with `scope=global` only
   for `everywhere`; success = opaque redirect or 303; (3) when the server call failed (offline, timeout), the browser
   client's `auth.signOut({ scope: "local" })` (the only client call allowed, R-19); (4) `purgeDeviceState()` from
   `lib/pwa/purge.ts`: delete every Cache Storage entry whose URL is outside the D-2 allowlist (and every cache not
   named `static-v1`/`shell-v1`), `sessionStorage.clear()`, remove `localStorage` keys not in
   `lib/pwa/device-prefs.ts` (`clinicos.pref.installDismissedUntil`, `clinicos.pref.signedInSessions`,
   `clinicos.pref.density`, `clinicos.pref.lastLane`), delete every IndexedDB database; (5) `location.replace("/login")`.
   User menu: the two sign-out forms keep `method="post" action="/auth/signout"` as the no-JS fallback; `onSubmit`
   calls `preventDefault()` and `hardSignOut("user" | "everywhere")`; a new "Switch user" item calls
   `hardSignOut("switch")` (login without any prefill or auto-submit). `idle` exists for V2-11 (AUTH-09 wires the timer,
   PWA §10); `expired`/`removed` are triggered by 06-06.
9. **Online state and banner:** `lib/pwa/online.ts` (`useOnlineStatus`, `useStaleSince`: the clinic-time
   (`lib/datetime`) moment the app went offline); `components/shell/offline-banner.tsx` (`role="status"`): "You're
   offline · showing data from 10:42. Changes are disabled until you reconnect."; mounted by `PwaRuntime` in the
   dashboard layout. Write buttons react to it from 06-02a (Button primitive).
10. **Sign-out guard (spec 11, R-19):** `scripts/ci/ui-policy/rules/signout-guard.mjs`, `mode: "enforce"`: any property
    access or element access named `signOut` in `app|components|features|lib` is a finding unless the file is
    `lib/auth/hard-sign-out.ts`, `app/auth/signout/route.ts`, or a non-`"use client"` file under `features/auth/**`
    (today's server calls in `features/auth/service.ts` and `features/auth/password-flows.ts`). Fixtures cover a client
    component calling it, a destructured `auth`, an element access `auth["signOut"]`, and a `"use client"` file under
    `features/auth/`.
11. **PWA e2e harness:** `tests/e2e/pwa/fixtures.ts` extends the base fixture with `serviceWorkers: "allow"` (the only
    opt-in; config default stays `"block"`), keeps the loopback block, additionally records `context.on("request")`
    URLs (service-worker requests included in Chromium) and fails the test on any non-loopback one (research A3).

### Tests that fail without the change
- `01-manifest.spec.ts` (spec 1; desktop-chrome, pixel-7): with no cookies, `/manifest.webmanifest`, `/sw.js`,
  `/offline`, every manifest icon, `/icon.svg` and `/apple-icon.png` answer 200 with `maxRedirects: 0` and the right
  content type; the manifest has the PWA §3.1 fields and a 192, a 512 and a maskable 512 icon whose PNG header sizes
  match; the same requests with a **locked tenant owner's** and a **locked receptionist's** storage state (V2-05 05-10b
  fixtures) answer 200 with no redirect (before: 307 to `/login?next=…`).
- `02-installable.spec.ts` (spec 2; Chromium only): after sign-in and SW activation, CDP
  `Page.getInstallabilityErrors` returns `[]`; the result JSON is saved as the installability report (before: errors —
  no manifest, no SW).
- `03-sw.spec.ts` (spec 3): the SW registers and reaches `activated`; `/sw.js` answers with `no-store` and the
  `script-src 'self'` CSP; the precache holds exactly the five URLs and totals ≤ 150 kB (PWA §3.9).
- `04-offline.spec.ts` (spec 4, part 1): after one online visit, `context.setOffline(true)` → navigating to `/patients`
  shows the `/offline` text; on Today, going offline shows the banner and the queue rows already on screen stay
  visible; going online removes the banner (write-button part added in 06-02a).
- `05-cache-audit.spec.ts` (spec 5): signed in as owner, browse Today, a patient, the seeded consult and an invoice;
  every URL in every cache matches the D-2 allowlist (`/_next/static/**`, `/offline`, `/manifest.webmanifest`, icons);
  `indexedDB.databases()` is empty; `localStorage`/`sessionStorage` keys ⊆ the D-3 allowlist; the patient page title
  does not contain the seeded patient's name; authenticated HTML and an RSC fetch carry `no-store` and `private`.
  Then per exit path — **sign out**, **sign out everywhere** (a second context of the same user loses its session),
  **switch user**, **offline sign-out** (while offline: the server call fails, the browser client signs out locally,
  the purge runs and the hard navigation lands on the precached `/offline`; back online, no auth cookie is present,
  research A7) — after the exit: caches hold
  only allowlisted URLs, `sessionStorage` is empty, only `clinicos.pref.*` keys remain (a seeded pref key survives), no
  Supabase auth cookie remains, and `page.goBack()` shows no seeded patient name (before: no helper; caches, storage
  and Back are untouched by the plain form POST).
- `ui-policy-signout-guard.spec.ts` (spec 11): each fixture violation is reported with file:line and exits 1; the
  allowed files pass; the repository run reports 0 (before: no rule).
- `public-paths.spec.ts` (extended): the three prefixes are public; their look-alikes and encoded traversals are
  protected; every public prefix still matches a file (before: the new cases fail).
- `tests/pwa/purge.spec.ts`, `device-prefs.spec.ts` (unit, Node with in-memory stand-ins for `caches`/`Storage`):
  allowlist matching keeps `/_next/static/x.js?dpl=1` and `/offline`, drops `/patients`, `/api/x`, `/?_rsc=1`; unknown
  keys removed, pref keys kept. `sw-allowlist.spec.ts`: loads `public/sw.js` in a `node:vm` sandbox with a fake
  `self`/`caches`/`fetch` and asserts which requests get `respondWith` (navigation, static) and which do not (API, RSC
  header, `?_rsc=`, cross-origin, POST), that a redirected precache response aborts `install`, and that the runbook's
  kill-switch body parses and unregisters.

### UI checks
`/offline` and the offline banner at 360/820/1180/1280; the user menu with "Switch user"; axe 0 serious/critical on
`/offline` and on Today with the banner shown.

### Acceptance mapping
"Chrome reports the app installable" (spec 2); "the cache-audit spec finds no authenticated response in Cache Storage"
(spec 5 browse part); "every sign-out path clears caches and storage" (spec 5 exit paths here; expired and removed in
06-06; idle in V2-11 when its timer exists, PWA §10); PWA-01, PWA-02; V2-05 05-10b handover (locked-user PWA asset
cases).

---

## 06-06 Install UX, update toast, skew guard, `/api/session-status`, lock handling client side (PWA-04, PWA-05 client side, PWA-08b specs 6 and 10, PWA §3.7, §6; R-16, R-21, R-28, R-29) · S-M · Wave 3 · no G2-D

The install sheet is only low-fidelity in V2-DX; its copy and logic are fixed by PWA_STRATEGY §6, so it ships now with
semantic tokens and is restyled by nothing but token values at 06-01b.

### Files
`app/api/session-status/route.ts`; `lib/auth/access-redirect.ts` (the role × access level → destination function,
extracted from V2-05 05-10b's `app/(dashboard)/layout.tsx` so the layout and the route share it);
`app/(dashboard)/layout.tsx`; `lib/pwa/{session-status,update,skew,lock,dirty-guard,install,platform}.ts`;
`components/shell/{pwa-runtime,update-toast,install-entry,install-sheet,install-card}.tsx`;
`components/layout/user-dropdown.tsx` ("Install app"); `app/(dashboard)/page.tsx` (install card on Today);
`next.config.ts` (`deploymentId`); `lib/env.ts`, `lib/env-server.ts` (`deploymentInfo().deploymentId`), env-guard files
(`tests/config/env-schema.spec.ts`, `tests/setup/test-env.ts`), `tests/e2e/support/app-env.ts`, `.env.example`;
`tests/security/guard-manifest.ts`, `tests/security/guard/engine.ts` (route kind `session-status`);
`playwright.config.ts` (project `pwa-ipados`); `tests/api/session-status-db.spec.ts`;
`tests/pwa/{platform,dirty-guard,update}.spec.ts`; `tests/e2e/pwa/{06-update,10-ipados}.spec.ts`; extends
`tests/e2e/pwa/05-cache-audit.spec.ts` (expired and removed legs); `docs/runbooks/pwa.md`.

### Steps
1. **Tracer:** `GET /api/session-status` (authenticated, `no-store`) returning `deploymentId` + `accessLevel` +
   `redirect`, polled once by `PwaRuntime` on load, with `session-status-db.spec.ts` proving the owner of a `full`
   tenant gets `{ accessLevel: "full", redirect: null }`. Then 2-7.
2. **Deployment id (R-21):** env names `NEXT_DEPLOYMENT_ID` and `VERCEL_DEPLOYMENT_ID` (optional, shape
   `^[A-Za-z0-9_-]{1,64}$`) through the env-key checklist; `next.config.ts` sets `deploymentId` to
   `NEXT_DEPLOYMENT_ID ?? VERCEL_DEPLOYMENT_ID` (Next then adds `?dpl=` to static assets, the
   `x-nextjs-deployment-id` header and `data-dpl-id` on `<html>`); `deploymentInfo()` exposes the same value to the
   route; the e2e app env sets a fixed `NEXT_DEPLOYMENT_ID` for build and serve. Staging is a Vercel **Hobby** project
   (PO 2026-11-13): no Skew Protection, so this in-app check is the only skew control until go-live (V2-15 checks
   Skew Protection on the production plan).
3. **`/api/session-status`:** reads the session with `auth.getUser()` (a revoked session fails here even while its JWT
   is unexpired); no session → 401 `{ error: "unauthenticated" }`; no membership → 403 `{ error: "no_membership" }`;
   otherwise 200 with keys exactly `deploymentId`, `accessLevel` (05-10a's access level for the session's active
   tenant) and `redirect` (`lib/auth/access-redirect.ts`: locked → `/billing/locked` for owner/admin,
   `/billing/locked/staff` for others; onboarding → `/onboarding/billing`; full → null). Tenant from the session only;
   no input; `Cache-Control: no-store`; no PHI; one `log.info` per non-200 with the code only. Guard manifest: new route
   kind `session-status` in the engine with legs: no session 401, no membership 403, member 200 with keys ⊆ the three,
   `no-store` present, a forged `?tenant=` ignored.
4. **Runtime (`components/shell/pwa-runtime.tsx`, `lib/pwa/session-status.ts`):** check on `visibilitychange` → visible,
   on `online`, every 5 min while visible, and whenever an error boundary or the global `unhandledrejection` handler
   sees an error (any error may be a lock or a revoked session). Reactions: 401 → `hardSignOut("expired")`; 403 →
   `hardSignOut("removed")`; `redirect` set → `onLocked(redirect)` (D-8: `runCleanups("lock")`, then
   `location.replace(redirect)`; the session is kept); `deploymentId` ≠ `document.documentElement.dataset.dplId` →
   update available. `registration.update()` on visible and every 30 min; a waiting worker also means update available.
5. **Update toast and safe-point apply (PWA §3.7, R-28, R-29):** `components/shell/update-toast.tsx` (a token-styled
   `role="status"` live region; moved onto `sonner` by 06-04b): "A new version is ready · Reload". Safe point: on the
   next route change, if `lib/pwa/dirty-guard.ts` reports no form with unsaved input (a document-level `input`/`change`
   listener marks the enclosing `form` dirty until its `submit`/`reset`; inputs outside a form mark the page dirty until
   navigation) and no registered command is in flight (`registerBusy()`; V2-07/V2-08 commands use it), post
   `SKIP_WAITING` to a waiting worker and `location.reload()`; otherwise keep the toast. **Skew guard**
   (`lib/pwa/skew.ts`): an `unhandledrejection` or boundary error classified `skew` by 06-04a's `client-error-kind`
   shows "This app was updated. Reload to continue" and never reloads by itself, so typed input stays on screen.
6. **Lock handling (PWA §6.6 client side, R-16):** the poll, resume and error-triggered checks above are the
   `SUBSCRIPTION_LOCKED` reaction for every screen; `lib/pwa/lock.ts` also exports `onAppErrorCode(code)` for results
   that carry `SUBSCRIPTION_LOCKED` (redirect via a fresh status check) or `UNAUTHENTICATED` (`hardSignOut("expired")`),
   used by the command hook that V2-07/V2-08 forms adopt (PWA-06). The end-to-end lock path with a real DB transition
   (spec 9) is V2-13b.
7. **Install UX (PWA §6):** `lib/pwa/platform.ts` (pure: `isIos(ua)` for `iPhone|iPod`; `isIpadOs(ua, maxTouchPoints)`
   for `Macintosh` with `maxTouchPoints > 1`; `isInAppBrowser(ua)` for `FBAN|FBAV|Instagram|WhatsApp|GSA|; wv\)`;
   `isStandalone()`); `lib/pwa/install.ts` captures `beforeinstallprompt` (`preventDefault()` suppresses the
   mini-infobar), listens for `appinstalled`. "Install app" entry in the user menu whenever installable (Android prompt;
   iOS/iPadOS → `install-sheet.tsx`: three steps "Tap Share", "Choose Add to Home Screen", "Keep 'Open as Web App' on and
   tap Add", plus "You'll need to sign in once inside the app"); in an in-app browser the entry becomes "Open in
   Chrome" (Android `intent://<current host><current path>#Intent;scheme=https;package=com.android.chrome;end`, built
   from `location` only) or "Open in Safari" guidance. `install-card.tsx` on Today only (never login, onboarding,
   consult, checkout): from the second signed-in browser session (`clinicos.pref.signedInSessions`, incremented once
   per browser session), dismissible for 30 days (`clinicos.pref.installDismissedUntil`), hidden when installed or in
   standalone. The More-sheet entry is added with the shell (06-04b); "Install app"/"Check for updates" on the Profile
   page are V2-11 (PWA §10).

### Tests that fail without the change
- `session-status-db.spec.ts`: signed out → 401; signed in without membership → 403; owner of a `full` tenant → 200,
  keys exactly the three, `redirect: null`, `no-store`; owner of a locked tenant → `/billing/locked`; receptionist of a
  locked tenant → `/billing/locked/staff`; owner of an `incomplete` tenant → `/onboarding/billing`; a dual-clinic user
  gets the active tenant's level (before: no route). Guard-route spec legs pass for the new kind.
- `06-update.spec.ts` (spec 6): `page.route` answers `/api/session-status` with a different `deploymentId` → the toast
  appears after a `visibilitychange`; with text typed into a form field, a client navigation does **not** reload (a
  `window` marker survives); with no unsaved input it reloads (the marker is gone); "Reload" reloads; an intercepted
  Server Action POST fulfilled the way Next answers an unknown action id (mechanism read from
  `node_modules/next/dist/client/components/unrecognized-action-error.js` and the action fetch code) shows "This app was
  updated. Reload to continue" and the typed text is still in the field; a mocked `redirect: "/billing/locked"` ends on
  the real locked page via `location.replace` with the auth cookie still present (D-8).
- `05-cache-audit.spec.ts` (extended, spec 5): **expired** — the session is revoked from a second context
  (`scope=global`), the first page gets `visibilitychange` → status 401 → caches/storage purged, `/login`;
  **removed** — the member is removed with V2-05's `remove_member` (sessions deleted) → same purge and `/login`.
- `10-ipados.spec.ts` (spec 10, project `pwa-ipados`: WebKit, `Macintosh` UA, `maxTouchPoints` 5 via init script,
  routed through `routeLoopbackOnly`): "Install app" opens the iOS three-step sheet, never an Android prompt; an
  `iPhone` UA does the same; a `WhatsApp` UA shows "Open in Safari" guidance instead.
- `platform.spec.ts`: a UA table (Android Chrome, Samsung Internet, iPhone Safari, iPadOS-as-Mac, Mac desktop with
  `maxTouchPoints` 0, WhatsApp, Instagram, Gmail `GSA`, Android `; wv)`) classifies as expected; `intent://` is built
  from host and path only. `dirty-guard.spec.ts`: input marks the form dirty, submit/reset clear it.
  `update.spec.ts`: mismatch detection ignores a missing `data-dpl-id` (development) instead of looping.
- `env-schema.spec.ts`: a deployment id with spaces or 65 characters is refused in every tier; both names are optional.

### UI checks
Update toast, skew notice, install sheet, in-app-browser guidance and the Today install card at
360/820/1180/1280; axe 0 serious/critical on each; the card never renders on `/login`, `/clinic/new`, a consult or the
checkout drawer (asserted in `10-ipados.spec.ts` and a desktop-chrome case).

### Acceptance mapping
PWA-04; PWA-05 client side (update toast, skew guard, `/api/session-status`, `SUBSCRIPTION_LOCKED` reaction, Realtime
cleanup hook); "every sign-out path clears caches and storage" (expired, removed); specs 6 and 10.

---

## Wave A review checkpoint (after wave 3; does not wait for G2-D)

The security-sensitive code of V2-06 is all in Wave A. The orchestrator runs, into
`.planning/phases/06-design-system-pwa-shell/reviews/`: an independent review of the Wave A diff
(`v206-review-wave-a-independent.md`); adversarial reviews (A) service worker, public paths, proxy `no-store`,
`hardSignOut`, purge, sign-out guard (06-05) → `v206-review-adversarial-sw-signout.md`; (B) `/api/session-status`, the
lock/skew/update client, deployment-id env (06-06) → `…-session-status.md`; (C) client error capture and the diag page
(06-04a) → `…-client-errors-phi.md`. Triage in `06-09a-REVIEW-TRIAGE.md`; fixes in plan **06-09a** on this branch with a
regression test each; Highs get a fresh re-verification review. The phase-close reviews later cover only what changed
since (plus the Wave B diff).

---

## 06-01b Approved values, local IBM Plex, AI/Smart Assist tokens and chips, approved icon (P1-28 M1 rest, AI-02, PO-19, PO-21; R-4, R-7, R-9, R-13) · S · Wave 4 · **needs G2-D**

*Precondition (executor asserts before step 1):* the G2-D row in `docs/v2/VERIFICATION_LOG.md` names the approved
V2-DX commit SHA and the SHA-256 of `clinic-paper.css` and each font file, and `06-UI-SPEC.md` exists. If not, stop.

### Files
`app/globals.css`; `lib/design/tokens.ts`; `app/fonts/{IBMPlexSans-Regular,IBMPlexSans-Medium,IBMPlexSans-SemiBold}.woff2`
(+ `OFL.txt`; Mono only if G2-D approved it); `app/layout.tsx` (font variables); `app/icon.svg`, `app/apple-icon.png`,
`public/icon-*.png`, `public/icons.json` (only if G2-D changed the icon); `components/clinical/{ai-assist-chip,ai-preview-chip,ai-coming-soon-row,smart-assist-label}.tsx`;
`components/consultation/ai-scribe-modal.tsx`; `scripts/ci/ai-l1-greps.mjs`, `tests/ci/ai-l1-greps.spec.ts`,
`lint-fixtures/ai-l1/**`; `scripts/design/contrast.mjs`, `lib/design/contrast-pairs.ts`;
`tests/design/{approved-tokens,contrast}.spec.ts`; `tests/e2e/design/fonts.spec.ts`;
`.planning/phases/06-design-system-pwa-shell/evidence/06-01b/clinic-paper.approved.css` (verbatim copy, SHA-256 checked).

### Steps
1. **Tracer:** copy the approved `clinic-paper.css` with `git show <sha>:.planning/sketches/themes/clinic-paper.css`
   into the evidence folder, verify its SHA-256 against the G2-D row, set `accent` from it in `app/globals.css`, and make
   `approved-tokens.spec.ts` compare that one token. Then 2-6.
2. **Values:** replace the `--color-v1-*` raw layer with the approved raw palette (DESIGN_SYSTEM §2.1 names: `paper`,
   `sunken`, `ink-*`, `line*`, `primary-*`, `success/warning/danger/info/violet/slate-*`, `focus`, plus the approved
   `ai-*` family) and point every semantic at it; add the AI-02 semantics `ai-bg`, `ai-fg`, `ai-border`, `smart-fg`,
   `preview-bg`, `preview-fg`; set DESIGN_SYSTEM radii and elevation; light only (`color-scheme: light`, R-7). If a
   semantic name in the approved file differs from §2.4's, the approved value goes onto the §2.4 name and the mapping is
   recorded in 06-SUMMARY; if the direction needs a semantic the components cannot express, stop and raise it.
   `lib/design/tokens.ts` gets the approved `theme_color` (`#FFFFFF`) and `background_color` (`paper`).
3. **Fonts (R-4):** copy the approved woff2 files (binary `git show … > file`), verify SHA-256, wire
   `next/font/local` (`display: "swap"`, `adjustFontFallback`, variable `--font-plex-sans`), `--font-sans` per §2.4.
   IBM Plex Sans Devanagari is **not** loaded (no Hindi renders in v2.0 yet; PWA §3.9 allows it only where Hindi
   renders). If the V2-DX glyph check found no ₹ (U+20B9) in the Latin subset, the fallback stack renders it (recorded).
4. **AI-02 (AI_STRATEGY §5.3, PO-21):** `ai-assist-chip.tsx` ("AI Assist" + `Sparkles`), `ai-preview-chip.tsx` ("Preview"
   chip + the note "AI features are in preview and not yet offered as a paid product"), `ai-coming-soon-row.tsx`
   ("AI features: Coming soon", muted, no price, no button), `smart-assist-label.tsx` (`Zap`, "Smart Assist", or
   nothing where G2-D chose no label). Each in its own file with no price copy, added to `LLM_FEATURE_FILES` in
   `ai-l1-greps.mjs` (L1-R4/R5), so L1-R6 (AI within 80 characters of a price, no exceptions) still fails any file that
   puts them next to a price (research Pitfall 7). The scribe modal uses the AI Assist and Preview chips and the note
   instead of its hand-made sparkle header; when the scribe renders stays as it is (entitlement gating is V2-12). The
   "Coming soon" row is placed on the billing page by SUB-08 (V2-13b); here it exists in the gallery (06-02a).
5. **Contrast as a test:** `scripts/design/contrast.mjs` computes WCAG 2.2 relative-luminance ratios from
   `app/globals.css` for the pairs in `lib/design/contrast-pairs.ts` (every text token on canvas/surface/sunken/selected,
   status chip fg/bg, chip and alert pairs, `fg-on-accent` on accent/danger, the focus ring against canvas and surface,
   control borders against surface); writes `evidence/06-01b/contrast.md` (tool output).
6. **Icon:** if G2-D changed the icon, replace `app/icon.svg` and re-run `node scripts/design/render-icons.mjs`;
   `--check` passes.

### Tests that fail without the change
- `approved-tokens.spec.ts`: every raw and semantic value in `app/globals.css` equals the approved file (parsed, not
  text-compared); the evidence copy's SHA-256 equals the G2-D row's; the token mirror equals the CSS (before: v1
  values differ).
- `contrast.spec.ts`: every listed text pair ≥ 4.5:1 (≥ 3:1 for large text and non-text), the focus ring ≥ 3:1 against
  canvas and surface (it sits outside controls with a 2 px offset: research found it 1.01:1 on `primary-600`) (before:
  `fg-subtle` = v1 gray-400 fails on white).
- `fonts.spec.ts` (e2e): on `/login`, `document.fonts.check('16px "IBM Plex Sans"')` is true; at most 2 font files are
  requested on first load, all from `/_next/static/media/` on loopback; the computed `font-family` of body text starts
  with the Plex family.
- `ai-l1-greps.spec.ts` (extended): the chip files pass L1-R4/R5; a fixture file holding the Coming soon row and
  "₹1,499 + GST" fails L1-R6; a fixture using "AI Assist" outside the allowed files fails L1-R5 (before: the chip files
  fail R5).
- e2e: the doctor opening the seeded consult and the scribe sees "AI Assist", "Preview" and the note.
- `npm run e2e:baseline` axe report: `color-contrast` nodes on the M0 routes drop from the 233 (desktop) baseline, 0 of
  the remaining nodes sit on a semantic-token class (each remaining one is a raw palette class, listed with the phase
  that rebuilds the screen).

### UI checks
The M0 routes at 360/820/1180/1280 with `neutral-diff.mjs compare` in report mode (expected change, for the PO's G3
review); axe on the M0 routes (counts above).

### Acceptance mapping
P1-28 M1 tokens and fonts with approved values; AI-02 tokens, glyphs, Preview chip and note, Coming soon treatment,
CI grep; PO-19 icon and theme colour.

---

## 06-02a Form primitives (2a) + input kinds (PWA-07) + `/dev/ui` gallery (P1-28 M2 2a, PWA-07, DESIGN_SYSTEM §6.1-§6.2, §10; R-14, R-26) · M · Wave 5 · after G2-D

### Files
`components/ui/{button,icon-button,kbd,input,textarea,field,label,native-select,checkbox,radio-group,switch,segmented-control,chip-group}.tsx`
(the v1 `button.tsx`, `input.tsx`, `select.tsx`, `field.tsx` keep their v1 props as thin adapters: `variant`,
`startIcon`, `invalid`); `lib/ui/{input-kind,variants}.ts`; `lib/dev/gallery.ts`; `app/dev/ui/{layout,page}.tsx`,
`app/dev/ui/sections/{forms,ai}.tsx`; `package.json`/lock (`radix-ui@1.8.1`); `tests/design/{input-kind,gallery}.spec.ts`;
`tests/e2e/design/{gallery-axe,input-modes}.spec.ts`, `tests/e2e/design/keyboard/forms.spec.ts`,
`tests/e2e/pwa/04-offline.spec.ts` (write-button part).

### Steps
1. **Tracer:** `/dev/ui` with one section (Button: default, hover, focus, disabled, loading) + `gallery-axe.spec.ts`
   at 360 and 1280 + `keyboard/forms.spec.ts` for Button (Tab reaches it, Enter and Space activate, disabled is skipped).
   Then 2-5.
2. **`/dev/ui` (R-26):** `app/dev/ui/page.tsx` outside every group (default-deny proxy: needs a session), `notFound()`
   when `lib/dev/gallery.ts#galleryEnabled(serverEnv().APP_ENV)` is false (production only), wrapped in
   `ClinicTimeZoneProvider` (`Asia/Kolkata`), sections with every state (default, hover, focus, disabled, loading,
   error, empty), synthetic copy only ("Synthetic Patient 01"). Each later plan adds its section file and one line in
   `page.tsx`.
3. **Primitives (shadcn source copied by hand onto semantic tokens, Radix via `radix-ui`):** Button/IconButton
   (44 px minimum target; `loading` keeps width; `requiresNetwork` defaults to true for `type="submit"` and is disabled
   while `useOnlineStatus()` is offline with an `aria-describedby` reason), Kbd, Input, Textarea, Field (wires `id`,
   label, hint and error into `aria-describedby`, `aria-invalid`), Label, NativeSelect (named; fixes M0 `select-name`),
   Checkbox, RadioGroup, Switch (Radix), SegmentedControl, ChipGroup (roving focus). Typed variant maps, no CVA.
4. **Input kinds (PWA-07, PWA §3.5):** `Input kind` ∈ `tel | otp | email | password-current | password-new | pincode |
   numeric | decimal | search | name` sets `type`, `inputMode`, `autoComplete`, `enterKeyHint`, `autoCapitalize` from
   `lib/ui/input-kind.ts`; text 16 px; 44 px height.
5. **AI section:** the 06-01b chips and the Coming soon row rendered in `sections/ai.tsx` (a file in
   `LLM_FEATURE_FILES`, no price copy).

### Tests that fail without the change
- `keyboard/forms.spec.ts` (desktop-chrome, real browser, R-14): per primitive — Tab order, Enter/Space, arrow keys
  in RadioGroup/SegmentedControl/ChipGroup (roving focus, wrap), Space toggles Checkbox/Switch with `aria-checked`,
  disabled controls are skipped, focus ring visible (computed outline ≥ 2 px).
- `input-modes.spec.ts` (PWA-07 guard, behavioural): every numeric-like kind rendered in the gallery has `inputMode`
  and `enterKeyHint`; every input's computed `font-size` ≥ 16 px and height ≥ 44 px.
- `gallery-axe.spec.ts`: axe 0 serious/critical on `/dev/ui` at 360/820/1180/1280.
- `input-kind.spec.ts` (unit): the kind → attributes table; `gallery.spec.ts`: `galleryEnabled` false only for
  `production`.
- `04-offline.spec.ts` (spec 4, completed): offline, the submit buttons on Today's walk-in drawer and the patient form
  (v1 call sites of the Button adapter) are disabled with the offline reason; online again, enabled.
- M0 e2e green with the adapters (v1 call sites unchanged; typecheck proves the props).
- FMP M2 bundle check: `node scripts/ci/route-js.mjs` before and after this plan on `/forgot-password` (a route whose
  UI is only Button, Input and Field through the adapters): the first-load JS delta is < 15 kB gz, recorded in
  `evidence/06-02a/bundle-delta.json` (tool output; a larger delta is investigated before the plan ends).

### UI checks
Gallery screenshots at 360/820/1180/1280 (`design-*` projects); axe as above.

### Acceptance mapping
"axe shows 0 serious or critical issues on the gallery" (2a part); "unit tests for primitives' keyboard and focus
behaviour" (R-14); PWA-07; spec 4 complete.

---

## 06-02b Overlays, menus, tabs, toast, command (2b); `Modal` and `Dropdown` adapters (P1-28 M2 2b, DESIGN_SYSTEM §6.3-§6.4, §6.8; 03-12b carry-over) · M · Wave 6 · after G2-D

### Files
`components/ui/{dialog,alert-dialog,sheet,drawer,responsive-sheet,popover,tooltip,dropdown-menu,tabs,toast,command}.tsx`;
`components/ui/modal.tsx` (v1 `isOpen/onClose` API over Dialog), `components/ui/dropdown.tsx` (v1 `Dropdown`/`DropdownItem`
API over DropdownMenu, keeps `type="submit"` items for the sign-out forms); `app/dev/ui/sections/overlays.tsx`;
`package.json`/lock (`cmdk@1.1.1`, `sonner@2.0.8`); `components/layout/user-dropdown.tsx` only if the adapter cannot
keep its API; `tests/e2e/design/keyboard/overlays.spec.ts`, `tests/e2e/shell/user-menu-keyboard.spec.ts`.

### Steps
1. **Tracer:** Dialog in the gallery with focus trap and restore + the `Modal` adapter + `overlays.spec.ts` Dialog
   case + one v1 `<Modal>` user (Sign & Bill) passing its M0 flow. Then 2-3.
2. The rest of 2b on Radix/cmdk/sonner with semantic tokens and `--shadow-popover`/`--shadow-overlay`, `scrim` (no
   blur), `pb-safe` on sheets, every sheet closable by an on-screen control (PWA §3.2.3), `overscroll-behavior: contain`
   in sheets, ResponsiveSheet (bottom sheet < md, dialog ≥ md). Toast: `sonner` `Toaster` with `role="status"` for info
   and `role="alert"` for errors (mounted by the shell in 06-04b; gallery mounts its own).
3. `dropdown.tsx` adapter fixes the user menu: `aria-expanded`, arrow-key navigation, Escape closes and returns focus to
   the trigger (03-12b carry-over). The 10 `<Modal>` users get focus trap and restore through the adapter.

### Tests that fail without the change
- `overlays.spec.ts`: Dialog/AlertDialog/Sheet/Drawer trap Tab and Shift+Tab, close on Escape and on the close button,
  restore focus to the opener; AlertDialog's initial focus is the safe action; Popover/Tooltip open on focus and close
  on Escape; DropdownMenu/Tabs arrow navigation; Command filters and Enter selects; toasts announce through their live
  region (before: v1 modal has no trap).
- `user-menu-keyboard.spec.ts`: Enter on the account button opens the menu with `aria-expanded="true"`, ArrowDown moves
  through items, Escape closes and focus is back on the button, "Sign out" via keyboard runs `hardSignOut` (the purge
  happens) (before: no focus management, 03-12b note).
- Gallery axe 0 serious/critical; M0 e2e green (Modal users: Sign & Bill, booking and checkout drawers).

### UI checks
Overlay states at 360/820/1180/1280 (sheet below md, dialog at md+); axe.

### Acceptance mapping
P1-28 M2 2b; gallery axe and keyboard/focus (2b part); 03-12b dropdown carry-over closed.

---

## 06-02c Data display (2c) + date, time and identity inputs (2d) (P1-28 M2 2c/2d, DESIGN_SYSTEM §6.6-§6.11, §7.8; R-15) · M · Wave 7 · after G2-D

### Files
`components/ui/{data-table,data-list,pagination,search-field,filter-chip,skeleton,empty-state,alert,banner,date-field,calendar,day-strip,slot-picker,phone-input,age-or-dob-input}.tsx`
(v1 `empty-state`, `alert`, `table`, `phone-input` become adapters; phone parsing logic in `lib/utils/phone.ts` kept);
`lib/ui/age.ts`; `app/dev/ui/sections/{data,dates}.tsx`; `package.json`/lock (`react-day-picker@10.0.2`);
`tests/design/age.spec.ts`; `tests/e2e/design/keyboard/data-and-dates.spec.ts`.

### Steps
1. **Tracer:** DateField + Calendar popover (react-day-picker, clinic time zone from `ClinicTimeZoneProvider`, dates
   formatted through `lib/datetime`, `12 Nov 2026`) in the gallery + keyboard case. Then the rest of 2c/2d.
2. DataTable (≥ lg) and DataList (< lg) share one column model; sortable headers are buttons with `aria-sort`;
   Skeleton honours reduced motion; Banner/Alert with roles (`status`/`alert`); SlotPicker presentational (slots as
   props; booking wiring is V2-08); AgeOrDobInput (age ↔ DOB, `lib/ui/age.ts`, clinic date); PhoneInput restyled, logic
   unchanged. **MoneyInput and InvoiceLines are not built here:** they need `lib/money`, which the roadmap places in
   V2-10 (R-15).

### Tests that fail without the change
- `data-and-dates.spec.ts`: Calendar arrow-key grid navigation, PageUp/PageDown months, Enter selects, Escape closes and
  focus returns to the field; a date picked at 23:30 IST stays on the clinic date; DataTable header sort toggles
  `aria-sort`; Pagination and FilterChip keyboard; DayStrip roving focus.
- `age.spec.ts`: age from DOB and DOB from age on IST date boundaries (00:00-05:30 IST), leap-day DOB.
- Gallery axe 0 serious/critical; M0 e2e green.

### UI checks
Data and date sections at 360/820/1180/1280 (DataList at 360/820, DataTable at 1180/1280); axe.

### Acceptance mapping
P1-28 M2 2c/2d (MoneyInput with V2-10, R-15); gallery axe and keyboard (2c/2d part).

---

## 06-03a Clinical identity and status patterns (P1-28 M2 2e part, DESIGN_SYSTEM §7.1-§7.5, FMP M1 `lib/visit-status.ts`) · M · Wave 8 · after G2-D

### Files
`lib/visit-status.ts`; `components/clinical/{patient-identity-header,allergy-banner,status-chip,token-chip,queue-row,save-status,share-button}.tsx`;
`app/dev/ui/sections/clinical-a.tsx`; `tests/clinical/visit-status.spec.ts`; `tests/e2e/design/keyboard/clinical-a.spec.ts`.

### Steps
1. **Tracer:** `lib/visit-status.ts` (the single map from every appointment/visit status value present in the code
   and `types/database.ts` today to label, status token and order) + StatusChip in the gallery + spec. Then the rest.
2. PatientIdentityHeader (name never truncated below 24 characters, wraps to 2 lines; `42 y · M`; tabular numerals),
   AllergyBanner (`alert-allergy-*`, `role="alert"` only when allergies exist), TokenChip (`--text-token`, tabular),
   QueueRow (actions always visible, ≥ 44 px), SaveStatus (Saved/Saving/Couldn't save · Retry, `aria-live`),
   ShareButton (Web Share where supported, a user action; D-6: nothing stored).

### Tests that fail without the change
- `visit-status.spec.ts`: every status string used in `features/**` and `components/**` (collected by the spec from the
  generated types and the v1 status constants) has exactly one entry; unknown → a neutral chip, never a crash.
- `clinical-a.spec.ts`: QueueRow actions reachable by Tab with visible focus; SaveStatus announces changes; the
  identity header shows a 30-character synthetic name unbroken at 360.
- Gallery axe 0 serious/critical.

### UI checks
Clinical-a section at 360/820/1180/1280; axe.

### Acceptance mapping
P1-28 M2 2e (part); the single status map (FMP M1).

---

## 06-03b Clinical entry patterns (P1-28 M2 2e rest, DESIGN_SYSTEM §7.3, §7.6, §7.9; R-15) · M · Wave 9 · after G2-D

### Files
`components/clinical/{vitals-form,vitals-summary,rx-line-item,rx-entry-row,patient-picker,quick-register-form}.tsx`;
`lib/clinical/vitals.ts` (units, plausible ranges, BMI); `app/dev/ui/sections/clinical-b.tsx`;
`tests/clinical/vitals.spec.ts`; `tests/e2e/design/keyboard/clinical-b.spec.ts`.

### Steps
1. **Tracer:** RxEntryRow in the gallery with the Consult entry interaction (type → ↓/Enter → digit preset → `5d` →
   Enter) proven by a keystroke-count case. Then the rest.
2. VitalsForm (numeric kinds, out-of-range hint, no blocking), VitalsSummary, RxLineItem, PatientPicker (Command; in the
   gallery it uses a synthetic in-memory list; the palette in 06-04b wires the real search), QuickRegisterForm (Field,
   PhoneInput, AgeOrDobInput; in the gallery it submits to a no-op; screens adopt it in V2-08 through the existing
   actions). InvoiceLines is built with `lib/money` in V2-10 (R-15).

### Tests that fail without the change
- `vitals.spec.ts`: unit conversions, BMI, range flags at the boundaries.
- `clinical-b.spec.ts`: the Rx entry sequence completes in the DESIGN_SYSTEM §7.6 keystroke count; PatientPicker
  typeahead and Enter; VitalsForm Tab order and numeric keyboards (`inputMode`).
- Gallery axe 0 serious/critical.

### UI checks
Clinical-b section at 360/820/1180/1280; axe.

### Acceptance mapping
P1-28 M2 2e (rest; InvoiceLines with V2-10, R-15).

---

## 06-04b Shell, `navForRole`, command palette, toasts, in-app Back, keyboard-aware bars, refetch on resume (P1-28 M3, PWA-03 shell part, PWA-08b spec 8, IA §3.2, §3.5, §3.7; R-8, R-29, R-34, R-35) · M · Wave 10 · after G2-D

### Files
`components/shell/{app-shell,top-bar,sidebar,rail,bottom-bar,more-sheet,back-button,command-palette,toaster}.tsx`,
`components/shell/{pwa-runtime,update-toast,install-entry}.tsx` (re-homed); `components/layout/**` (the v1
`app-layout-shell`, `app-sidebar`, `app-header`, `backdrop`, `global-search-modal`, `sidebar-context` removed;
`user-dropdown` becomes the top-bar user menu); `lib/nav/nav-for-role.ts`; `lib/pwa/{resume,keyboard-aware}.ts`;
`app/(dashboard)/layout.tsx`; `features/patients/{actions,service}.ts` (`searchPatientsForPalette`);
`tests/security/guard-manifest.ts`; `app/dev/ui/sections/shell.tsx`; `tests/nav/nav-for-role.spec.ts`;
`tests/e2e/shell/{nav-per-role,palette,back-resume-keyboard,toasts}.spec.ts`; `tests/e2e/pwa/08-layout.spec.ts`.

### Steps
1. **Tracer:** `navForRole(role)` from `lib/permissions` + the Sidebar at 1280 rendering it for the owner, with
   `nav-per-role.spec.ts`'s owner case visiting every item. Then 2-6.
2. **Navigation model (IA §3.2, §3.5):** `navForRole(role, permissions)` derives primary and secondary destinations from
   the permission matrix; destinations use the **v1 URLs and v1 accessible names** (R-8: IA URLs and names arrive with
   each workflow phase), `/settings/billing` (R-34). The server layout resolves the role (never the client).
3. **Shell (DESIGN_SYSTEM §6.5, PWA §3.2-§3.4):** TopBar (56 px, `pt-safe`), Sidebar ≥ xl, Rail md-lg, BottomBar < md
   (`pb-safe`, hidden while a text field has focus on phones via `visualViewport`, `lib/pwa/keyboard-aware.ts`), More
   sheet (secondary items + "Install app"); in-app Back in the top bar on every non-root screen below xl
   (`router.back()`, or the nav parent when there is no history, e.g. a fresh standalone launch); `lib/pwa/resume.ts`
   refetches live views (`/`, `/queue`, `/calendar`, `/cabin`) with `router.refresh()` on `visibilitychange` → visible
   and `online`; offline banner, update toast (moved onto `sonner`, R-29) and install entry mounted here.
4. **Command palette (IA §3.7, DESIGN_SYSTEM §7.9):** ⌘K/Ctrl+K and the top-bar search; groups Patients (server action
   `searchPatientsForPalette(query)`: permission `patients:view`, tenant from the session, projection id, name, age/sex,
   last 4 phone digits only; guard-manifest entry), Today queue matches, Actions (role-filtered), Navigate
   (`navForRole`); no Assist/AI group (R-35); nothing persisted (no recent searches in storage).
5. **Toaster:** `sonner` `Toaster` in the shell (bottom-safe on phones).
6. Every v1 page renders inside the new shell unchanged; M0 locators adapted only where an element moved (listed).

### Tests that fail without the change
- `nav-for-role.spec.ts`: per role, every destination's required permission is held (no nav item leads to a page the
  role cannot use, F-01 class); owner/admin see Settings, receptionist/nurse do not; the result equals the IA §3.2 table
  restricted to v1 URLs.
- `nav-per-role.spec.ts` (each seeded role): every nav item opens with 200 and no redirect to `/login` or a 403 screen;
  every v1 page in `dashboardRoutes()` is reachable through the nav for at least one role that may use it.
- `palette.spec.ts`: open → type the seeded patient's 10-digit phone → Enter opens that patient in ≤ 3 keystrokes after
  typing (ux counter); a receptionist sees no Settings action; the server action returns only the four fields.
- `08-layout.spec.ts` (spec 8): no horizontal scroll at 360/375/744/800/820/1180 on Today, Patients, a patient, the
  consult and Settings; BottomBar visible below 768 and absent at ≥ 768; every interactive shell element ≥ 44×44 px.
- `back-resume-keyboard.spec.ts`: Back present on a non-root page below xl and returns; focusing a text input at 360
  hides the BottomBar; a `visibilitychange` on Today triggers one RSC refresh request.
- `toasts.spec.ts`: the update toast (mocked session status) appears through the sonner live region.
- M0 e2e green.

### UI checks
Shell on Today, Patients, a patient, the consult, Settings for owner and receptionist at 360/820/1180/1280 (these are
the shell part of the G3 set); axe 0 serious/critical on each.

### Acceptance mapping
P1-28 M3 (shell, IA nav model, palette, toasts; route states in 06-04a; redirect map and `ui_v2` flag not used, R-8);
PWA-03 shell (Back, keyboard-aware bars, refetch on resume); spec 8; M3 "Characterisation specs (M0) still pass".

---

## 06-08 Close-out: React Compiler rules to error, policy report, G3 screenshot set, evidence (03-06 carry-over, roadmap evidence; R-30) · S · Wave 11 · after G2-D

### Files
`eslint.config.mjs`; `scripts/ci/react-compiler-waivers.json`, `tests/ci/react-compiler-waivers.spec.ts`;
`scripts/ci/ui-policy-baseline.json`; `tests/e2e/design/screens/screenshot-set.spec.ts`,
`scripts/design/screenshot-index.mjs`; `.github/workflows/nightly.yml` (design lane on the nightly matrix);
`scripts/ci/assert-vitest-report.mjs` (REQUIRED_FILES + FLOOR); evidence files.

### Steps
1. **React Compiler rules (R-30):** `react-hooks/set-state-in-effect`, `purity`, `immutability` back to `error`. Sites in
   code V2-06 replaced are gone; each remaining site is fixed or listed in `react-compiler-waivers.json` (`file`, `rule`,
   `reason`, `owner` phase, `expires` ≤ 90 days), applied as a per-file `warn` override; the spec fails on an expired,
   stale (no longer matching) or over-90-day entry.
2. **Policy report:** `node scripts/ci/ui-policy.mjs --json` final counts → `evidence/06-08/ui-policy.json`; the
   baseline file updated to these counts (the ratchet V2-11 M5 enforces).
3. **G3 screenshot set:** `screenshot-set.spec.ts` (design projects) captures every `/dev/ui` section, the shell routes
   of 06-04b for owner and receptionist, `/offline`, the install sheet, the update toast, the error/not-found/loading
   states, at 360/820/1180/1280, PNG, into `evidence/06-08/screens/<width>/`; `screenshot-index.mjs` writes
   `evidence/06-08/screens/README.md` (a table per width linking each PNG, the G2-D reference screen for each, and the
   axe result). Synthetic data only (the repository is public).
4. **Report gate:** REQUIRED_FILES gains every Vitest spec added in V2-06; FLOOR raised with the arithmetic in the same
   commit.

### Tests that fail without the change
- `react-compiler-waivers.spec.ts`: lint of a fixture with a `set-state-in-effect` violation fails at `error`; an expired
  or stale waiver fails the spec.
- `npx eslint .` 0 errors with the rules at `error`.
- The screenshot set exists for every listed screen at four widths (the index generator fails on a missing file).

### Acceptance mapping
"screenshots at 360/820/1180/1280 … approved by the PO" (06-P6 evidence); roadmap evidence "the screenshot set";
03-06 carry-over closed.

---

## Acceptance mapping (roadmap V2-06, binding)

| # | Acceptance item | Plan(s) | Proof (tool output) | Needs G2-D? | Status at the gate |
|---|---|---|---|---|---|
| 1 | axe shows 0 serious or critical issues on the gallery | 06-02a/b/c, 06-03a/b, 06-04b, 06-08 | `gallery-axe.spec.ts` at 360/820/1180/1280 in the CI PR lane (desktop-chrome) + the axe column of `evidence/06-08/screens/README.md` | yes | Done in CI |
| 2 | screenshots at 360/820/1180/1280 (the V2-DX widths) match the G2-D direction and are approved by the PO | 06-01b, 06-08 (+ every UI plan's captures) | `evidence/06-08/screens/**` + index; isolated design reviewer's notes (`reviews/v206-review-design.md`) | yes | **PO approval (06-P6)** |
| 3 | the grep guards, including the AI-02 "AI" copy grep, are in report mode | 06-01a (UI policy report mode + jsx-a11y warn), 06-01b (AI chips in the L1 allowlist), 06-04a/06-05 (two rules enforced) | CI `static` step summary; `evidence/06-08/ui-policy.json`; `npm run ci:ai-l1` | no | Done; the L1 AI grep stays **blocking** (stricter than report mode, R-13) |
| 4 | v1 screens still work (M0 e2e green) | every plan | `npm run e2e:pr` per plan; CI e2e job with 0 retried tests | no | Done in CI |
| 5 | Chrome reports the app installable | 06-05 (+06-01b icon) | `02-installable.spec.ts` (CDP `Page.getInstallabilityErrors` = `[]`) + `evidence/installability.json` | no | Done in CI |
| 6 | the cache-audit spec finds no authenticated response in Cache Storage | 06-05 | `05-cache-audit.spec.ts` browse part (pixel-7, desktop-chrome) | no | Done in CI |
| 7 | every sign-out path clears caches and storage | 06-05 (sign out, everywhere, switch, offline), 06-06 (expired, removed) | `05-cache-audit.spec.ts` exit-path legs | no | Done in CI for the paths that exist; idle sign-out is wired and added to the spec in V2-11 (AUTH-09, PWA §10) |

Roadmap tests: Playwright screenshot + axe on `/dev/ui` (06-02a…06-08); unit tests for primitives' keyboard and focus
behaviour — real-browser specs per primitive on `/dev/ui` plus Vitest unit tests of the pure mapping functions (R-14);
the M0 characterisation suite (every plan). Roadmap evidence: CI links (phase close), the screenshot set (06-08), the
bundle report (06-07 `route-js` artifact + `evidence/06-07/`), design review notes (phase close).
PWA_STRATEGY §10 V2-06 row: specs 1-6, 8, 10, 11 pass (06-05, 06-06, 06-02a, 06-04b); Chrome installable; cache audit;
sign-out purge per exit path; 0 `min-h-screen`/`h-screen` (06-04a, enforced); LHCI report published (06-07).

## Source coverage audit

| Source | Item | Covered by |
|---|---|---|
| GOAL | one enforced visual and interaction system implementing the G2-D direction | 06-01a (layers, codemod, policy), 06-01b (approved values), 06-02a…06-03b (components), 06-04b (shell) |
| GOAL | delivered as an installable PWA | 06-05, 06-06, 06-01b (icon) |
| REQ P1-28 M1 | tokens (§2.4), dead `:root` removed, codemod, fonts, `lang="en-IN"`, `color-scheme` | 06-01a, 06-01b, 06-05 (lang, color-scheme) |
| REQ P1-28 M1 | `lib/datetime` + UTC "today" sites | done in V2-03 (03-05); reused |
| REQ P1-28 M1 | `lib/money` | **V2-10** per roadmap §12.2 V2-10 "Expected changes" and FE-6 (R-15) |
| REQ P1-28 M1 | `lib/visit-status.ts` | 06-03a |
| REQ P1-28 M2 | 2a, 2b, 2c, 2d, 2e with gallery states, keyboard specs, focus trap/restore, axe | 06-02a, 06-02b, 06-02c, 06-03a, 06-03b; MoneyInput and InvoiceLines with `lib/money` in V2-10 (R-15) |
| REQ P1-28 M2 | 2a first-load JS delta < 15 kB gz for a route using only 2a primitives | 06-02a measures it with 06-07's `route-js.mjs` on `/forgot-password` before/after and records it in `evidence/06-02a/bundle-delta.json` |
| REQ P1-28 M3 | shell (Sidebar ≥ xl, Rail md-lg, BottomBar < md, TopBar), `navForRole`, palette, route states, toasts, PWA shell items | 06-04b, 06-04a, 06-05, 06-06 |
| REQ P1-28 M3 | redirect map v1 → v2 URLs and `ui_v2` flag | not used: no URL renames in V2-06 and no flags (PO-15); IA URLs with each workflow phase (R-8) |
| REQ P1-28 M3 | AI lazy-loading of the copilot drawer; shell without `@ai-sdk/react` in initial chunks | drawer removed by AI-01 (V2-01); no app file imports `@ai-sdk/*` today (grep); `ai-sdk-import` UI-policy rule reports any new one (06-01a) |
| REQ P2-02 | bundle budgets in CI | 06-07 (report-only; blocking at V2-15) |
| REQ PWA-01 | manifest, icons, viewport/themeColor, appleWebApp, `lang="en-IN"`, public assets bypass auth and entitlement | 06-05 (+06-01b approved icon) |
| REQ PWA-02 | hand-written SW (allowlist), `/offline`, `/sw.js` headers, `hardSignOut()` + grep guard, `no-store` | 06-05; CSP directives with P1-18 in V2-14 |
| REQ PWA-03 (shell) | safe areas, `dvh`, in-app Back, keyboard-aware bars, refetch on resume | 06-04a, 06-04b; tablet two-pane Today/Consult is PWA-03b in V2-08/V2-09b |
| REQ PWA-04 | Android prompt, iOS sheet, in-app-browser detection | 06-06 (user menu, Today card), 06-04b (More sheet); Profile entries in V2-11 (PWA §10) |
| REQ PWA-05 (client) | `/api/session-status`, update toast, `SUBSCRIPTION_LOCKED` handling, Realtime unsubscribe, skew | 06-06 (+06-05 cleanup registry); lock path end to end and spec 9 in V2-13b |
| REQ PWA-07 | input modes, autocomplete, 16 px inputs in primitives + guard test | 06-02a |
| REQ PWA-08b | specs 1-6, 8, 10, 11 | 06-05 (1, 2, 3, 4 part, 5, 11), 06-06 (5 legs, 6, 10), 06-02a (4 rest), 06-04b (8) |
| REQ PWA-09 | LHCI on 4 routes, report-only | 06-07 |
| REQ AI-02 | tokens, glyphs, copy rules, CI grep, Preview chip and note, Coming soon treatment | 06-01b (+06-02a gallery); the billing page placement is SUB-08 in V2-13b |
| REQ AI-16 | help search, vitals flags "if time permits" | deferred to V2-09b (R-10; roadmap allows "V2-06 / V2-09b") |
| CONTEXT (locked) | R5: no primitive before G2-D | Wave B precondition (06-01b onward), R-1 |
| CONTEXT (locked) | O7: Next 16 decision before 06-02 | satisfied (V2-03 03-06, Next 16.4.6) |
| CONTEXT (locked) | PO-19 ClinicQ, teal tile "Q"; PO-20 "₹1,499 + GST"; PO-21 no purchasable AI; PO-15 big bang | 06-05 icon, 06-01b chips (no price, L1-R6), R-8 |
| RESEARCH | rulings OQ1-OQ11, pitfalls 1-16, G2-D split, token architecture, patterns 1-8 | adopted as R-1…R-12 and the plans; deviations listed below |
| Carry-over (03-06) | React Compiler rules back to `error` | 06-08 (R-30) |
| Carry-over (V2-03 R-29) | client error capture | 06-04a (R-3) |
| Carry-over (03-12b) | user-menu dropdown focus management; `hardSignOut()` | 06-02b; 06-05 |
| Carry-over (05-10b) | PWA asset non-redirect cases for locked users; client `SUBSCRIPTION_LOCKED` navigation | 06-05 spec 1; 06-06 |
| Research finding | M0 report route-JS section broken on Turbopack | 06-07 |
| PO 2026-11-13 | Vercel Hobby (no Skew Protection), repository public | R-21 (in-app skew guard only), 06-07 cookie scrub, invariants (synthetic, no session material) |
| Deferred (research, not V2-06) | dark theme, Hindi UI, web push, persisted offline Today, Serwist, native apps, iOS splash images, LHCI blocking (V2-15), CSP `worker-src`/`manifest-src` (V2-14), spec 7 (V2-07/V2-08), spec 9 (V2-13b), tablet two-pane (V2-08/V2-09b), palette reset (M5, V2-11), 9-11 px text sizes (M5/V2-11, R-31) | not planned |

## PO actions for this phase

The orchestrator copies these into `.planning/PO-ACTIONS.md` under "V2-06 Design system & PWA shell", replacing D-1
(06-P1 + 06-P2 supersede it). No secret appears here. **Order:** 06-P1 → 06-P2 as soon as V2-DX's evidence is ready
(it gates Wave B only; Wave A never waits); 06-P4 any time after wave 2; 06-P5 after wave 7; at the gate 06-P6, 06-P7.
Only 06-P2 blocks work (Wave B); 06-P4/06-P5 block the merge; 06-P6/06-P7 are the gate.

- [ ] **06-P1 · G2-D step 1: walk through the V2-DX evidence**
  - *Do / where:* open `.planning/sketches/v2-dx-evidence/README.md` on the V2-DX PR (branch
    `v2/phase-dx-design-exploration`; Claude posts the PR link and the commit SHA here when DX-04 and the isolated design
    review are done). About 45-60 minutes: screens at 360/744/820/1180/1280, the contrast report, the walkthrough videos
    of the counted flows, the design reviewer's report.
  - *Values:* none.
  - *Why:* roadmap R5 and §16 G2-D: the direction is approved from rendered evidence before any primitive is built.
  - *Unblocks:* 06-P2.
  - *Verify (Claude):* none (06-P2 records the outcome).

- [ ] **06-P2 · G2-D step 2: answer the eight questions and sign off**
  - *Do / where:* reply in the chat with an answer per item of the README checklist: (1) "Clinic Paper" palette
    approve/change; (2) IBM Plex Sans 400/500/600, Devanagari only where Hindi renders; (3) icon, `theme_color #FFFFFF`,
    `background_color #F6F5F1` (or an alternate); (4) Today at 1180: two-pane or 3 lanes (820: two-pane proposed);
    (5) Consult layouts at 360/820/1180/1280; (6) AI Assist chip colour and sparkle, Smart Assist `Zap` or no label,
    "Preview" chip and note copy, "Coming soon" row; (7) "₹1,499 + GST" and "₹1,768.82 per month incl. 18% GST";
    (8) the low-fidelity surfaces are acceptable as the brief for V2-06, V2-13b and V2-13c. Then merge the V2-DX PR when
    you merge PRs (V2-06 reads the approved commit directly and does not wait for that merge).
  - *Values:* your answers (verbatim).
  - *Why:* G2-D gate (roadmap §16); D-1 in PO-ACTIONS.
  - *Unblocks:* Wave B (06-01b onward), `/gsd-ui-phase 06`.
  - *Verify (Claude):* writes the G2-D row in `docs/v2/VERIFICATION_LOG.md` with your verbatim answer, the approved
    commit SHA and `shasum -a 256` of `clinic-paper.css` and each font file (tool output), ticks D-1/06-P2.

- [ ] **06-P3 · Optional: show the prototypes to one or two clinic users (PO-13)**
  - *Do / where:* share the screenshots or the walkthrough videos (synthetic data only) and pass their remarks on.
  - *Why:* earlier real-user signal; not required for G2-D.
  - *Verify (Claude):* remarks recorded in the V2-DX walkthrough notes.

- [ ] **06-P4 · Confirm the Wave A pinned tool (E14-style)**
  - *Do / where:* read `.planning/phases/06-design-system-pwa-shell/evidence/package-legitimacy.json` section `06-07`
    and confirm `@lhci/cli@0.15.1` (devDependency, nightly only; pins `lighthouse` 12.6.1). If the record shows the
    fallback `0.16.0`, that version is flagged too-new by the research audit; confirm or ask for another pin.
  - *Why:* CLAUDE.md "no new dependency without stating why"; GSD legitimacy gate (T-06-SC).
  - *Unblocks:* the merge (not local work).
  - *Verify (Claude):* your confirmation recorded in VERIFICATION_LOG's V2-06 gate section.

- [ ] **06-P5 · Confirm the Wave B packages and font files (E14-style)**
  - *Do / where:* same file, sections `06-02a`, `06-02b`, `06-02c`: `radix-ui@1.8.1`, `cmdk@1.1.1`, `sonner@2.0.8`,
    `react-day-picker@10.0.2` (all research-audit OK, no install scripts); and the IBM Plex woff2 SHA-256 list from the
    G2-D row (SIL OFL 1.1).
  - *Why:* as 06-P4.
  - *Unblocks:* the merge.
  - *Verify (Claude):* confirmation recorded.

- [ ] **06-P6 · G3: approve the V2-06 screenshot set**
  - *Do / where:* open `.planning/phases/06-design-system-pwa-shell/evidence/06-08/screens/README.md` (each screen at
    360/820/1180/1280 next to its G2-D reference), the installability report (`evidence/installability.json`), the
    Lighthouse summary (`evidence/06-07/lhci-summary.json`) and the design reviewer's notes; approve or list changes.
  - *Why:* roadmap acceptance item 2 and G3 ("screenshots and axe; installability report").
  - *Unblocks:* the V2-06 merge and G3.
  - *Verify (Claude):* your verbatim approval in the V2-06 gate entry of VERIFICATION_LOG with the commit SHA of the set.

- [ ] **06-P7 · Confirm the V2-06 rulings and deviations** — the rulings table (R-1…R-36), in particular R-3 (client
  errors: dashboard boundaries only, class name and route pattern), R-8 (no URL renames, no flags), R-10 (AI-16 to
  V2-09b), R-13 (AI grep stays blocking), R-14 (keyboard tests in a real browser), R-15 (MoneyInput and InvoiceLines to
  V2-10), R-16 (lock reaction by poll and error checks; per-form handling with the V2-07/V2-08 command hook), R-21
  (Hobby: in-app skew guard only), R-23 (manifest link stays on token pages), R-31 (small text sizes left to M5), and
  the proposed CLAUDE.md Commands update. *Verify:* your confirmation recorded in VERIFICATION_LOG's gate section.

**No PO action needed for:** Vercel (manifest URLs are relative, `id: "/"`; no domain needed; Skew Protection is a
production-plan check at V2-15), font licences (OFL), real devices (PWA-10 real-device checklist is V2-15), staging
settings (no new env value is required on staging: Vercel supplies `VERCEL_DEPLOYMENT_ID`).

## Phase close

1. **Report gate:** `REQUIRED_FILES` in `scripts/ci/assert-vitest-report.mjs` gains `tests/design/{tokens,codemod,approved-tokens,contrast,input-kind,gallery,age}.spec.ts`,
   `tests/ci/{ui-policy,ui-policy-signout-guard,route-js,lhci-config,react-compiler-waivers}.spec.ts`,
   `tests/pwa/{purge,device-prefs,sw-allowlist,platform,dirty-guard,update}.spec.ts`,
   `tests/errors/client-error-kind.spec.ts`, `tests/observability/client-error-action-db.spec.ts`,
   `tests/api/session-status-db.spec.ts`, `tests/clinical/{visit-status,vitals}.spec.ts`, `tests/nav/nav-for-role.spec.ts`;
   FLOOR raised with the arithmetic in the same commit (06-08).
2. **Local evidence (tool-produced):** `npm run typecheck`, `npx eslint .`, `npm run inventory`, `npm run ci:ai-l1`,
   `npm run ci:ui-policy -- --json`, `npm run ci:audit`; `node scripts/phase-evidence.mjs
   .planning/phases/06-design-system-pwa-shell/evidence 2`; gitleaks output; `npm run e2e:build && npm run e2e:pr` JSON
   report; `npm run e2e:design` (screenshot set + index); `npm run perf:lhci` (scrubbed summary); `node
   scripts/ci/route-js.mjs --out evidence/06-07/route-js`; `evidence/06-01a/{codemod-report,neutral-diff}.json`;
   `evidence/06-01b/contrast.md`; `evidence/installability.json`; `evidence/package-legitimacy.json`.
3. **CI (orchestrator):** push; mark the PR ready; all five checks green with 0 retried tests; then `node
   scripts/phase-evidence.mjs .planning/phases/06-design-system-pwa-shell/evidence --ci-run <id>`. The nightly LHCI and
   design lanes run on `feature/v2` only (schedules run on the default branch); their first runs are recorded after the
   merge, and until then the local runs above stand.
4. **Reviews (CLAUDE.md DoD 6)** into `reviews/`: the Wave A reviews (above) re-checked for files changed since; an
   independent review of the full diff (`v206-review-independent.md`); the **isolated design reviewer** for G3
   (`v206-review-design.md`: screenshot set vs the G2-D evidence, contrast report, gallery axe, the
   DESIGN_SYSTEM §6-§8 rules); an adversarial review (D) of the Wave B parts touching data or auth: the palette search
   projection and guard entry, the shell's role resolution and nav, the scribe chip change (`…-shell-palette.md`); then
   `/gsd-secure-phase` over T-06-01…T-06-SC (`v206-secure-phase.md`). Triage in `06-09b-REVIEW-TRIAGE.md`; fixes in
   plan **06-09b** with regression tests; Highs re-verified by a fresh reviewer. Review reports are committed to a
   public repository: they describe fixed issues and accepted risks without exploit steps for anything left open.
5. **Documents:** `06-SUMMARY.md` (per plan, deviations, M0 locator adaptations, the codemod collapses, the client-error
   split, deferrals with owners: idle sign-out spec leg V2-11; spec 7 V2-07/V2-08; spec 9 and the billing-page Coming
   soon row V2-13b; tablet two-pane V2-08/V2-09b; MoneyInput, InvoiceLines and `lib/money` V2-10; AI-16 V2-09b; LHCI and
   budgets blocking, Skew Protection check V2-15; CSP directives V2-14; palette reset and small text M5/V2-11; Profile
   "Install app"/"Check for updates" V2-11); `06-VERIFICATION.md` (the acceptance table with CI run link + commit SHA +
   evidence file per row; 06-P6 pending until approved); the V2-06 gate entry in `docs/v2/VERIFICATION_LOG.md`; proposed
   doc errata for PO approval (not applied): FMP M3 redirect map and `ui_v2` flag superseded by R-8; FMP M2 MoneyInput
   and InvoiceLines moved to V2-10; IA §3.3 `/settings/plan` → `/settings/billing`; IA §3.7 Assist group removed (AI-01);
   DESIGN_SYSTEM §4.6 dark `themeColor` removed (light only); PWA §3.9 measurement method on Turbopack.
6. **Proposed CLAUDE.md Commands update (PO approves, 06-P7):** add `npm run e2e:design` (design lanes, screenshots),
   `npm run perf:lhci` (Lighthouse on the local e2e server, loopback only), `npm run ci:ui-policy`,
   `node scripts/ci/route-js.mjs` (after a build); note that `/dev/ui` is the component gallery (not in production).
7. **After merge (Claude, read-only HTTP to the staging app):** `curl -s -o /dev/null -w "%{http_code}"` with no cookies
   for `/manifest.webmanifest`, `/sw.js`, `/offline`, `/icon-192.png` → 200 each and no `location` header; `curl -sI
   …/sw.js` shows the three headers; the `/login` HTML carries `data-dpl-id`; recorded in `06-VERIFICATION.md`.

## Threat model (STRIDE register, phase-wide)

| Threat ID | Category | Component | Severity | Disposition | Mitigation |
|---|---|---|---|---|---|
| T-06-01 | Info disclosure | service worker caches authenticated HTML, RSC payloads or API responses (PHI on a shared device) | critical | mitigate | positive allowlist in `public/sw.js` (navigations never stored, RSC/API/auth/token paths never handled); `sw-allowlist.spec.ts` in a VM; cache-audit spec 5 in the PR lane; adversarial review (A) of every `sw.js` diff (06-05) |
| T-06-02 | Tampering / DoS | precache stores a login or billing redirect instead of `/offline` | high | mitigate | precache with `credentials: "omit"`, refuse `!ok`/`redirected` (install fails); public-asset prefixes; spec 1 as a locked user (06-05) |
| T-06-03 | Info disclosure | sign-out leaves PHI on the device (Cache Storage, storage, in-memory tree, bfcache, auth cookies) | critical | mitigate | one exit helper `hardSignOut()` for every path; purge outside the D-2/D-3 allowlists; `location.replace`; `Clear-Site-Data: "cache"` from the route; spec 5 per exit path incl. Back; offline fallback signs out locally (06-05, 06-06) |
| T-06-04 | Elevation | new public prefixes widen the default-deny proxy (`/offline/…`, look-alikes, encoded traversal) | high | mitigate | exact segment prefixes matched on raw and normalised paths (existing `pageNeedsSession`); spec cases for look-alikes and `/offline/..%2Fpatients`; stale-prefix check over `public/**` and `app/manifest.ts` (06-05) |
| T-06-05 | Tampering | a malicious or broken SW update persists on devices | high | mitigate | same-origin script with `script-src 'self'` and `no-store` headers, `updateViaCache: "none"`, update on resume and every 30 min; kill-switch body in the runbook, tested (06-05) |
| T-06-06 | Spoofing / misuse | client calls `auth.signOut` outside the helper and skips the purge | medium | mitigate | `signout-guard` UI-policy rule, enforced in CI `static`, fixtures for aliasing and element access (06-05) |
| T-06-07 | Info disclosure | `/api/session-status` leaks tenant, billing or membership details, or another tenant's state | high | mitigate | authenticated (`getUser()`), tenant from the session only, keys exactly `deploymentId`/`accessLevel`/`redirect`, `no-store`, guard-manifest route kind with no-session/no-membership/forged-param legs (06-06) |
| T-06-08 | Elevation | an open tablet keeps working after a lock, a revoked session or a removed membership | high | mitigate | data-layer enforcement (V2-05) is the control; client reacts within one 5-min poll, on resume, on `online` and on any boundary error; D-8 redirect keeps the session; spec 6 lock leg; spec 9 end to end in V2-13b (06-06) |
| T-06-09 | Info disclosure | client error reports carry PHI (message, stack, ids in the path, query string) | high | mitigate | only the class name (NAME_PATTERN, identifier-shaped refused) and the route pattern (params replaced; UUID/6+ digits/`@` segments refused); message and frames never sent; digest errors not re-sent; member-guarded action; flood cap; adversarial review (C) (06-04a) |
| T-06-10 | DoS / cost | the client-error action floods the 500 MB Free database | medium | mitigate | `admitToSink` per-key flood cap and the existing daily fingerprint cap (03-09b); one report per boundary render; member-only (06-04a) |
| T-06-11 | Info disclosure | `/dev/ui` reachable in production, or showing real data | medium | mitigate | `notFound()` in the production tier (unit-tested), default-deny session, synthetic fixtures only, no data access (06-02a) |
| T-06-12 | Info disclosure | the repository is public: committed screenshots, Lighthouse reports or artifacts expose a session cookie or real data | high | mitigate | synthetic data only; Lighthouse `extraHeaders` removed and cookie values redacted before upload/commit, asserted by the spec; config in git-ignored temp paths; storage states never committed (06-07, 06-08) |
| T-06-13 | Info disclosure | Lighthouse or the PWA specs send requests off the machine | medium | mitigate | `--host-resolver-rules` loopback-only; filesystem upload (never public storage); PWA fixture fails on any non-loopback request incl. SW-originated (06-05, 06-07) |
| T-06-14 | Tampering | supply chain: `radix-ui`, `cmdk`, `sonner`, `react-day-picker`, `@lhci/cli` (+ `lighthouse`), font files | high | mitigate | exact pins, legitimacy record, `npm audit signatures`, no install scripts, older LHCI pin; font SHA-256 from the G2-D-approved commit; PO confirmations 06-P4/06-P5 |
| T-06-15 | Repudiation / integrity | an automatic update reload discards typed clinical input | medium | mitigate | safe-point apply only with no dirty form and no command in flight; skew notice never reloads by itself; spec 6 (06-06) |
| T-06-16 | Elevation | the nav shows destinations a role cannot use (F-01 class) or derives role on the client | medium | mitigate | `navForRole` from the permission matrix in the server layout; unit + per-role e2e; server guards unchanged (06-04b) |
| T-06-17 | Info disclosure | palette patient search over-fetches or persists results | medium | mitigate | server action with `patients:view`, session tenant, four-field projection; no storage of queries/results; guard-manifest entry (06-04b) |
| T-06-18 | Spoofing | in-app-browser "Open in Chrome" link built from attacker-influenced input | low | mitigate | `intent://` built from `location.host` and `location.pathname` only, no query (06-06) |
| T-06-19 | Info disclosure | PHI in page titles, the manifest, the offline page or error pages (app switcher, D-7) | medium | mitigate | title template "%s · ClinicQ" with static titles; static manifest and `/offline`; error UIs show no message; spec 5 title check (06-04a, 06-05) |
| T-06-20 | DoS | Cache Storage growth across deploys (`?dpl=` changes static URLs) | low | mitigate | 200-entry cap with eviction; old caches deleted on `activate` (06-05) |
| T-06-SC | Tampering | npm installs and vendored binaries | high | mitigate | research legitimacy audit, exact pins, `[SUS]` `@lhci/cli` 0.16.x avoided (0.15.1), human confirmation 06-P4/06-P5 before merge |

## Risks

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| K-1 | G2-D slips (V2-DX not yet run) | M | M | Wave A and its reviews proceed without it; Wave B waits; 06-P1/06-P2 sized at about an hour of PO time |
| K-2 | The codemod mis-maps a semantic use (blue as "info", red as "danger" vs "error text") | M | M | property-aware table, per-file report, 0.5 % neutral diff with every collapse listed; approved values only in 06-01b |
| K-3 | `clinic-paper.css` names differ from DESIGN_SYSTEM §2.4 names | M | L | 06-01b maps values onto §2.4 names and records the mapping; stop and raise if a semantic is missing |
| K-4 | Research A4: Set-Cookie/Clear-Site-Data not applied to a `redirect: "manual"` fetch | L | H | spec 5 asserts the cookies are gone; if not, `hardSignOut` purges first and then submits the form POST as a navigation (documented fallback) |
| K-5 | Research A3: SW requests bypass `context.route` in Chromium | M | L | the SW fetches same-origin only by construction; PWA fixture fails on any non-loopback request it sees |
| K-6 | LHCI 0.15.1 cannot drive Playwright's current Chromium | M | L | fallback 0.16.0 recorded and confirmed by the PO (06-P4); report-only, never a gate |
| K-7 | React Compiler rules cannot all be fixed in v1 files by 06-08 | H | L | time-boxed per-file waivers with owner phase and expiry, checked by a spec (R-30) |
| K-8 | PR-lane time grows with PWA, gallery and shell specs | M | M | screenshot capture only in the design/nightly lanes; PWA specs on desktop-chrome and pixel-7 only; spec 10 in its own WebKit project |
| K-9 | The new shell moves elements M0 specs click | M | M | v1 accessible names kept (R-8); locator-only adaptations, listed; assertions never changed |
| K-10 | V2-05 merged names differ from 05-PLAN (`my_tenant_access`, `SUBSCRIPTION_LOCKED`, locked fixtures) | L | M | use the merged code, note it in 06-SUMMARY; stop if behaviour differs |
| K-11 | Hobby staging has no Skew Protection; long-open tablets hit removed Server Actions after a deploy | H | L | in-app skew guard and update toast (06-06), never reloading over input; production plan check at V2-15 |
| K-12 | IBM Plex Latin subset lacks ₹ (research A2) | M | L | fallback stack renders it; recorded from the V2-DX glyph check |
| K-13 | Older Android WebViews lack `dvh` | M | L | `min-h-app`/`h-app` emit the vh value first as a fallback |
| K-14 | Parallel wave-2 plans contend for the single e2e lane | H | L | e2e runs serialised; the orchestrator may run wave 2 sequentially |

## Rulings (agent acting as CTO under PO delegation; PO confirms at the gate, 06-P7)

| # | Decision | Rationale |
|---|---|---|
| R-1 | R5 applied literally: no primitive, clinical component, shell or approved value before the G2-D row exists; Wave A covers everything else | Research OQ1; changing R5 needs the PO |
| R-2 | Split 06-01 → 06-01a/06-01b, 06-02 → 06-02a/b/c, 06-03 → 06-03a/b, 06-04 → 06-04a/06-04b; add 06-08 close-out and review-fix plans 06-09a/06-09b | Research OQ2; one implementer session per plan; G2-D split |
| R-3 | Client error capture: dashboard and onboarding boundaries only, member-guarded action, `client.<Name>` + route pattern, `route_type = "render"`, no message/frames/request id, digest-bearing errors not re-sent; no migration | Research OQ3 refined: digest errors are already in the sink via `onRequestError`; the existing ingest contract accepts this shape; actions must authenticate |
| R-4 | Fonts: `next/font/local` with the V2-DX-vendored Plex files (Sans 400/500/600 Latin; Mono only if approved); Devanagari not loaded until Hindi renders | Research OQ4; network-guarded build; PWA §3.9 two-file budget |
| R-5 | Bundle budgets: PWA §3.9 numbers kept as V2-15 targets, report-only now, route-specific JS reported next to totals | Research OQ5; Turbopack framework floor 128.8 kB |
| R-6 | LHCI exact-pinned devDependency, nightly only, filesystem upload, host-resolver lockdown, inside the Playwright e2e run | Research OQ6; reuses the guarded server, seed and storage states |
| R-7 | Light theme only; `themeColor #FFFFFF` | Research OQ7; DESIGN_SYSTEM §2.4, PRD |
| R-8 | No URL renames and no `ui_v2` flags in V2-06; v1 URLs and accessible names inside the new shell; IA URLs arrive with each workflow phase | Research OQ8; PO-15 big bang; keeps M0 specs stable |
| R-9 | AI colour token chosen by the PO at G2-D from V2-DX's proposal with contrast proof | Research OQ9 |
| R-10 | AI-16 deferred to V2-09b | Research OQ10; roadmap "if time permits", backlog "V2-06 / V2-09b"; vitals flags belong to the consult rebuild |
| R-11 | `experimental.useOffline` stays off | Research OQ11; it replays held Server Actions before V2-07 idempotency |
| R-12 | Hand-written `public/sw.js`; Serwist rejected | PWA §5; auditable allowlist, no precache manifest |
| R-13 | The AI-06 L1 checks (incl. the AI-02 "AI" copy grep) stay blocking; the new DESIGN_SYSTEM §10 guards run in report mode; `brand-utility`, `screen-height` and `signout-guard` are enforced | Roadmap "in report mode" read as "at least reporting"; downgrading a blocking PO-21 control would weaken it (research Pitfall 7) |
| R-14 | "Unit tests for primitives' keyboard and focus behaviour" run in a real browser against isolated `/dev/ui` states (Playwright), with Vitest unit tests for the pure mapping functions; no jsdom or Testing Library | jsdom does not implement focus traps, layout or `inputMode` behaviour faithfully; avoids three devDependencies |
| R-15 | MoneyInput and InvoiceLines are built in V2-10 with `lib/money` | Roadmap §12.2 V2-10 "Expected changes" includes `lib/money`; FE-6/C25 conversion rules live there |
| R-16 | Client lock reaction = 5-min poll + resume + `online` + any boundary error → status check → D-8 redirect; `onAppErrorCode()` is adopted per form with the command hook in V2-07/V2-08; spec 9 in V2-13b | v1 has no central action-result path; the data layer already denies a locked tenant (V2-05) |
| R-17 | Cleanup registry for Realtime and in-flight work ships with no v1 subscriber | v1 uses no Realtime; Today (V2-08) is the first subscriber |
| R-18 | V2-06 exit paths: sign out, sign out everywhere, switch user, offline sign-out, expired/revoked, removed; idle sign-out is wired in V2-11 (AUTH-09) | PWA §10 V2-11 row |
| R-19 | Spec 11 reformulated for 03-12b: `signOut` allowed only in `lib/auth/hard-sign-out.ts`, `app/auth/signout/route.ts` and non-client `features/auth/**`; implemented as an enforced UI-policy rule | Research Pattern 6; server sign-outs already exist there |
| R-20 | The proxy sets `private, no-store` on every signed-in page and RSC response | D-4 without relying on a framework default (research A5) |
| R-21 | `deploymentId` = `NEXT_DEPLOYMENT_ID ?? VERCEL_DEPLOYMENT_ID`; on Vercel Hobby (staging until go-live) the in-app skew guard is the only skew control | PO 2026-11-13 (Hobby); PWA §3.7 makes the in-app guard mandatory anyway |
| R-22 | 06-01a acceptance: ≤ 0.5 % differing pixels (channel delta > 8/255) per screen at 360/820/1180/1280, every collapse listed; scope 48 hex values + `brand-*` + `text-gray-400`; raw palette classes stay (reported) until M5 | Research Pitfall 2; value-neutral proof by tool |
| R-23 | The manifest link stays on public token pages; install UI only inside the authenticated shell | Suppressing it needs a second root layout; PWA §3.1 rates it P3 and harmless |
| R-24 | Icons rendered from an outlined SVG master with Playwright's Chromium | No image library; deterministic, font-free |
| R-25 | One branch stacked on 05b, one PR, draft after wave 2; Wave A reviews at the end of Wave A; merge order V2-04 → 05a → 05b → V2-06 with merge commits | PO direction (stacking); V2-05 R-1 pattern; security review independent of G2-D timing |
| R-26 | `/dev/ui` is available in every tier except production and needs a session | DESIGN_SYSTEM §10 ("development and preview"); default deny |
| R-27 | Screenshot capture in the `design-*` projects (`npm run e2e:design`, nightly after merge); gallery axe and keyboard specs in the PR lane | PR-lane time (K-8) |
| R-28 | Update auto-apply only at the next route change with no dirty form and no registered command in flight | PWA §3.7 step 4; never reload over input |
| R-29 | The update toast ships as a minimal live region in 06-06 and moves onto `sonner` in 06-04b | No new dependency in Wave A |
| R-30 | React Compiler rules → `error` in 06-08 with time-boxed per-file waivers (owner phase, ≤ 90 days, stale check) | 03-06 handover; the AI-L1 allowlist pattern |
| R-31 | The 282 `text-[9-11px]` sites are not rewritten in V2-06; reported by `px-font`; removed as screens are rebuilt (V2-08…V2-11) and enforced at M5 | Not in FMP M1's codemod list; rewriting v1 screens that are rebuilt next is waste and risks layout breakage |
| R-32 | Spec 4 "write buttons disabled" is delivered by the Button primitive (06-02a) for v1 call sites using it; raw `<button>` sites follow their workflow rebuilds (PWA-06b) | One control point instead of 221 raw buttons |
| R-33 | No migration in V2-06 | R-3 fits the existing contract |
| R-34 | `/settings/billing`, not `/settings/plan` | Research Pitfall 15; SUB-08 and the existing route |
| R-35 | The command palette has no Assist/AI group | AI-01 removed the copilot; research Pitfall 16 |
| R-36 | The Today install card counts browser sessions in `clinicos.pref.signedInSessions` (a number, D-3 preference) | PWA §6.1 "from the user's second signed-in session"; no identifier stored |

## Deviations from the research and the roadmap

**Roadmap:** plans split and renumbered (R-2); AI-16 deferred to V2-09b (R-10); MoneyInput/InvoiceLines with
`lib/money` in V2-10 (R-15); "grep guards in report mode" kept with the L1 AI grep still blocking (R-13); keyboard and
focus "unit" tests in a real browser (R-14); FMP M3 redirect map and `ui_v2` flag not used (R-8); idle sign-out leg of
spec 5 in V2-11 (R-18); the 2a bundle-delta check measured with the new Turbopack method.
**Research:** order puts 06-01a first (its tokens style every Wave A screen and it owns the policy framework);
`lang="en-IN"` and `color-scheme` move from 06-01b to 06-05 (value-free, PWA-01); client error capture skips
digest-bearing errors and stores `client.<Name>` (R-3); `@lhci/cli` pinned at 0.15.1 instead of "≥ 7 days old" 0.16.x
(avoids the SUS flag); LHCI runs inside a Playwright spec instead of a standalone script (R-6); radii and fonts are
not redefined in 06-01a (they would change rendering); the palette search uses a server-side projection instead of
client-side mapping (T-06-17).
**PO 2026-11-13:** Hobby staging → in-app skew guard only (R-21); public repository → Lighthouse cookie scrub and the
"no session material in artifacts" invariant (T-06-12).

## Open for the PO (not blocking)
1. 06-P1 → 06-P2 (G2-D) as soon as V2-DX's evidence is posted; Wave A does not wait for it.
2. 06-P4 after wave 2 and 06-P5 after wave 7 (merge blockers only).
3. At the gate: 06-P6 (screenshot set) and 06-P7 (rulings, deviations, CLAUDE.md Commands update).

