# Phase 06 (V2-06): Design system, frontend foundation & PWA shell — Research

**Researched:** 2026-11-13 (branch `v2/phase-04-jobs-reliability` @ `118b3ae`, read-only; V2-04 being implemented in the same tree)
**Domain:** Tailwind v4 token system, accessible primitives (Radix/shadcn), Next.js 16.4.6 (Turbopack) PWA shell, hand-written service worker, bundle/Lighthouse reporting, plus the missing V2-DX design exploration that gates it (G2-D)
**Confidence:** HIGH for the current-state evidence and Next 16 behaviour (version-matched docs in `node_modules/next/dist/docs`); MEDIUM for library compatibility and LHCI wiring; LOW only where tagged `[ASSUMED]`

> **Superseded facts (2026-11-14).** This research is the 2026-11-13 snapshot and its body is left as written. These
> statements are no longer true. `06-PLAN.md` (revision note of 2026-11-14) is binding:
> - *V2-DX has run.* "V2-DX has not run" (§Summary, §G2-D split): V2-DX ran and G2-D was signed off on 2026-11-13.
>   On 2026-11-14 the PO replaced the palette with the CliniQ AI brand theme (VERIFICATION_LOG "PO ruling: CliniQ AI
>   is a fixed brand name"). The approved input is `v2/phase-dx-design-exploration` at `3a78a5d`.
> - *Approved CSS.* "`clinic-paper.css` … is copied into 06-01b": the approved values are `clinic-paper.css`
>   overridden by `cliniq-ai.css` (CliniQ Blue `#246BCE`, Midnight `#0B1A42`, per-status hues, With-doctor border
>   `#11998D`, radii 6/10/14/20).
> - *Fonts.* "IBM Plex Sans (local) / Plex woff2 … download once from the IBM/plex GitHub release" (§G2-D split,
>   Environment Availability, OQ4, A2): the typeface is **Inter** for body/UI (rsms/inter via `@fontsource-variable/inter` 5.2.5)
>   and **Manrope** for display (google/fonts, subset with fontTools). Both are vendored by V2-DX at `3a78a5d`; no
>   download is needed.
> - *₹ glyph.* A2 "Plex Latin subset includes ₹ — unconfirmed" is moot. Inter's latin file lacks U+20B9, its
>   latin-ext file has it, and Manrope's latin file has it (fontconfig `fc-query`, 2026-11-14).
> - *Icon.* "Teal `#0E716B` tile with a 'Q'" (§G2-D split, DX-01): the icon is the CliniQ AI mark (blue-to-teal ring
>   with a stethoscope) on a white tile; masters in `002-icon/{icon,icon-maskable}.svg` at `3a78a5d`.
> - *Manifest and metadata examples.* The `name`/`short_name`/titles "ClinicQ" and `background_color: "#F6F5F1"` (Patterns 3-4):
>   the approved values are "CliniQ AI" and `#FFFFFF` (`theme_color` stays `#FFFFFF`). The Patterns 3-4 code is
>   illustrative.

---

<user_constraints>
## User Constraints

No `06-CONTEXT.md` exists (`init.phase-op 06` → `has_context: false`). The binding constraints are the approved
roadmap text and CLAUDE.md. They are copied here verbatim so the planner treats them as locked.

### Locked decisions (roadmap §12.2 V2-06, verbatim)
- *Objective:* one enforced visual and interaction system, implementing the direction approved at G2-D, delivered as an installable PWA.
- *Scope:* P1-28 (M1–M3), P2-02 (bundle budgets), **PWA-01, PWA-02, PWA-03 (shell), PWA-04, PWA-05 (update/skew/lock client side), PWA-07, PWA-08b (specs 1–6, 8, 10, 11), PWA-09 (report-only)**, AI-02 (labelling), AI-16 (help search, if time permits).
- *Dependencies:* **G2-D**; V2-02 (M0); the Next 16 decision (V2-03 plan 03-06) before plan 06-02.
- *Plans:* 06-01 tokens + fonts + codemod + AI/Smart Assist labels; 06-02 primitives (Radix/shadcn) with input modes + `/dev/ui`; 06-03 clinical components; 06-04 shell (safe areas, `dvh`), IA, palette, route states, toasts; 06-05 manifest, icons, service worker, offline page, `hardSignOut()`; 06-06 install UX, update/skew/lock handling; 06-07 bundle budgets + Lighthouse CI (report-only).
- *Acceptance:* axe shows 0 serious or critical issues on the gallery; screenshots at 360/820/1180/1280 (the V2-DX widths) match the G2-D direction and are approved by the PO; the grep guards, including the AI-02 "AI" copy grep, are in report mode; v1 screens still work (M0 e2e green); Chrome reports the app installable; the cache-audit spec finds no authenticated response in Cache Storage; every sign-out path clears caches and storage.
- *Tests:* Playwright screenshot + axe on `/dev/ui`; unit tests for primitives' keyboard and focus behaviour; the M0 characterisation suite.
- *Evidence:* CI links, the screenshot set, the bundle report, design review notes.

### Locked decisions (V2-DX, roadmap §12.2, verbatim)
- *Objective:* approve the visual and interaction direction from rendered evidence before any primitive is built.
- *Scope:* the prompt B3 design-skill exploration; a rendered "Clinic Paper" token palette (colour, type, spacing, en-IN numerals); high-fidelity mock-ups or interactive prototypes of **Today** and **Consult** at 360, **820, 1180** and 1280 px (PWA-03a); the app icon and theme colour (PO-19); low-fidelity mock-ups of the install sheet, offline page, signup → "Start trial" mandate step, `/settings/billing`, the locked pages and the `/platform` tenant list; "AI Assist" vs "Smart Assist" labels (AI-02), the AI "Preview" chip and the "Coming soon" row (PO-21), the "₹1,499 + GST" price display (PO-20); contrast checks.
- *Expected changes:* design artefacts and a throw-away prototype sandbox that is never merged into `app/`. No production code.
- *Plans:* DX-01 design-skill exploration, palette and icon; DX-02 Today prototype (phone, tablet, desktop); DX-03 Consult prototype; DX-04 billing, onboarding, admin, install and offline mock-ups; DX-05 PO walkthrough (plus clinic users if PO-13 arranges them).
- *Acceptance:* the PO signs off the palette, icon, both prototypes and the billing/admin/install mock-ups; token contrast meets WCAG AA; the interaction targets in §4 are walkable in the prototypes.
- *Tests:* an axe run and a contrast check on the prototypes; a recorded walkthrough of the §4 interaction counts.
- *Evidence:* screenshots at 360, 820, 1180 and 1280 px, the contrast report, PO sign-off, walkthrough notes.

### Gate G2-D (roadmap §16, verbatim)
| **G2-D** | Design direction approved, before plan 06-02 | PO | Isolated Claude design reviewer | V2-DX outputs at 360, 820, 1180 and 1280 px incl. billing, admin and install surfaces; contrast report; brand and icon (PO-19) |

### Ruling R5 (VERIFICATION_LOG:280, verbatim)
"Design approval after design implementation | **Accepted.** New phase **V2-DX** (prompt Phase 2) and sub-gate **G2-D** before plan 06-02; V2-06 and V2-08 depend on G2-D (V2-08 through V2-06). Prototype work removed from V2-06."

### PO decisions that bind design (roadmap §1.2)
- PO-19 ✅ "working name "ClinicQ", a teal tile with a "Q" glyph". PO-20 ✅ price shown everywhere as **"₹1,499 + GST"**, ₹1,768.82 debit stated at checkout. PO-21 ✅ no purchasable AI; "Coming soon" with no price or buy button; scribe "Preview" chip during trial. PO-15 ✅ big-bang go-live, no per-workflow rollout flags. PO-10 ✅ isolated Claude reviewers; PO approves every gate.

### Claude's discretion
Everything the roadmap leaves open: plan sub-splits, the token layering, measurement tooling, sandbox mechanics, and the
CTO rulings in "Open Questions" (the PO delegated technical calls, memory "CTO mode").

### Deferred (out of scope)
Dark theme; i18n/Hindi UI (P3); web push (PWA-13, v2.1); persisted offline Today (v2.1); Serwist; native apps; per-device iOS splash images (D5); LHCI blocking (V2-15); CSP `worker-src`/`manifest-src` (P1-18, V2-14); lock path end-to-end and spec 9 (V2-13b); spec 7 (V2-07); tablet two-pane Today/Consult implementation (V2-08/V2-09b, PWA-03b); `lib/money` (V2-10); palette reset `--color-*: initial` (M5, V2-11).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description (REQUIREMENTS.md) | Research support |
|----|-------------------------------|------------------|
| P1-28 | Design system + frontend foundation: tokens, fonts, shadcn/Radix primitives, clinical components, shell, IA, command palette, route loading/error states, toasts | §Current state (counts), §Token architecture, §G2-D split, Patterns 1–3, Pitfalls 1–4 |
| P2-02 | Bundle budgets in CI (budgets merge with PWA-09) | §Bundle sizes (Next 16 removed the build column; manifest method proven), Pattern 7, Pitfall 6 |
| AI-02 | "AI Assist"/"Smart Assist" tokens and glyphs; copy rules; CI grep; "Preview" chip; "Coming soon" | §AI-02 (L1 grep already blocking), Pitfall 7, V2-DX brief §5 |
| PWA-01 | Manifest, icons, viewport/themeColor, appleWebApp, `lang="en-IN"`; public PWA assets bypass auth | Pattern 4, Pitfall 5 (default-deny proxy redirects them today) |
| PWA-02 | Hand-written SW (allowlist), `/offline`, `/sw.js` headers, `hardSignOut()` wrapping `POST /auth/signout` + grep guard, `no-store` | Patterns 5–6, Pitfalls 8–10 |
| PWA-03 (shell part) | Safe areas, `dvh`, in-app Back, keyboard-aware bars, refetch on resume | 20 `min-h-screen`/`h-screen` sites; Pattern 3 |
| PWA-04 | Install UX: Android prompt, iOS sheet, in-app-browser detection | PWA_STRATEGY §6 (unchanged); Pitfall 11 |
| PWA-05 (client) | `/api/session-status`, update toast, `SUBSCRIPTION_LOCKED`, Realtime unsubscribe, skew | Next 16 `deploymentId` behaviour (Pattern 8); V2-05 supplies `SUBSCRIPTION_LOCKED` |
| PWA-07 | Input modes, autocomplete, 16 px inputs in primitives + guard test | 4 `inputMode`/`enterKeyHint` sites today |
| PWA-08b | Specs 1–6, 8, 10, 11 | Pitfall 12 (`serviceWorkers: "block"` + network fixture) |
| PWA-09 | Lighthouse CI on 4 routes, report-only | Pattern 7, Package audit (LHCI flagged too-new), Pitfall 13 |
| AI-16 | Help search, vitals flags (if time permits) | Recommend defer to V2-09b (see Open Questions) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Next.js 15→**16.4.6** App Router, React 19, TS strict, Tailwind v4, Supabase via `@supabase/ssr`, zod, Vitest, Playwright. Code in `app/`, `features/<domain>/`, `lib/`, `components/`, `tests/`.
- Branch `v2/phase-06-design-system-pwa-shell` off `feature/v2`; PR into `feature/v2`; never touch `main`; no force-push. **Other agents work in this tree: V2-DX must use a separate `git worktree`, never a branch switch here.**
- Every server action/route authenticates, checks permission, derives tenant from the session (applies to `/api/session-status` and any client-error route).
- No PHI/secrets in logs, fixtures, prompts, commits, docs; synthetic data only (prototype copy uses obviously synthetic names).
- Never read `.env*`; never target hosted Supabase; tests/builds loopback-only (`vitest.config.ts`, e2e socket guard, `serve.ts` port 3100).
- No new dependency without stating why in the plan (applies to `radix-ui`, `cmdk`, `sonner`, `react-day-picker`, `@lhci/cli`, optionally `class-variance-authority`).
- DoD: real-outcome tests (no "renders"/source-grep tests), typecheck + lint + tests local, CI green with **0 retried tests**, UI checked at 360 px/tablet/desktop + axe clean, tool-produced evidence (`scripts/phase-evidence.mjs`), isolated Claude reviewer; adversarial second review for auth/middleware/PHI changes (`hardSignOut`, proxy public paths, SW cache policy, `/api/session-status` qualify).
- Commands: `npm run typecheck`, `npx eslint .`, `npm run inventory`, `npm run test:db`, `npm run e2e:build` then `npm run e2e:pr`, `npm run e2e:baseline`.

---

## Summary

The UI today is v1 on Next 16.4.6/Turbopack with **no working design system and no PWA surface at all**: `app/globals.css` declares Inter (never loaded) and a v1 blue `brand-*` scale; the 30-variable `:root` block has **0 references**; components carry **775 hex arbitrary classes in 70 files (48 distinct values; `#1769e0` alone 396)**, 183 `brand-*` classes, 3,344 raw Tailwind palette classes, 247 `text-gray-400`, 282 `text-[9–11px]` sizes; there are **0 `loading.tsx`/`error.tsx`/`not-found.tsx`**, no `public/`, no manifest, no icons, no service worker, `lang="en"`. M0 axe found `color-contrast` on 17 of 19 authenticated routes (233 nodes desktop), plus critical `label` (67 nodes), `select-name`, `button-name`. Everything in DESIGN_SYSTEM.md is still to build, but its §2.4 already specifies a semantic `@theme inline` layer, which makes a value-swap architecture cheap.

Three Next 16 facts reshape the plans: (1) `next build` no longer prints per-route First Load JS (the 15.5.28 table existed; the 16.4.6 output has none) and Turbopack emits no `app-build-manifest.json`, so P2-02 and the M0 report's route-JS section need a new method — a dependency-free manifest reader (proven here on the existing build: framework root **128.8 kB gz**, Today `/` 158.3, Consult 213.1, Login 234.2); (2) V2-03's default-deny proxy (`lib/auth/public-paths.ts`) **will redirect `/manifest.webmanifest`, `/sw.js` and `/offline` to `/login`** for signed-out requests unless 06-05 adds them; (3) `deploymentId` (16.x) gives skew detection a built-in `data-dpl-id`/`x-nextjs-deployment-id` signal that `/api/session-status` should reuse. A hand-written `public/sw.js` has no Turbopack interaction at all (public files are copied verbatim); Serwist's Turbopack path (`@serwist/turbopack` 9.5.13, peer `next >=14`) works through a nested route handler plus `esbuild` and a precache manifest — it adds dependencies, a proxy-exposed route, and precaching the strategy rejects. Keep the hand-written worker.

V2-DX has not run (PO-ACTIONS D-1). It is a docs-only M track that can run **now**, in a separate worktree, while V2-04/V2-05 execute, so G2-D is in hand before V2-06 starts. If G2-D slips, 06-05, 06-06, 06-07 and a value-neutral 06-01a (token architecture + codemod with v1-equivalent provisional values, proven by screenshot diff) can merge without it; 06-01b (values, fonts, AI chips), 06-02, 06-03 and 06-04b must wait — 06-02 explicitly by R5.

**Primary recommendation:** start V2-DX immediately using `/gsd-sketch` in `.planning/sketches/` with one shared semantic-token file that becomes the literal input of 06-01; plan V2-06 as Wave A (G2-D-independent: 06-07, 06-05, 06-06, 06-01a, 06-04a) and Wave B (after G2-D: 06-01b, 06-02, 06-03, 06-04b, 06-08 close-out).

## Architectural Responsibility Map

| Capability | Primary tier | Secondary tier | Rationale |
|---|---|---|---|
| Design tokens (raw → semantic) | CDN/Static (compiled CSS, `app/globals.css`) | Browser (CSS vars) | Build-time Tailwind v4 `@theme`; no runtime theming (light only) |
| Fonts | CDN/Static (`next/font/local` self-hosted woff2) | — | Must not fetch Google at build (network-guarded e2e build) |
| Primitives / clinical components | Browser (client components on Radix) | Frontend server (RSC composition) | Interaction, focus, keyboard live in the client |
| Shell, nav model `navForRole()` | Frontend server (RSC layout resolves role) | Browser (bars, palette) | RBAC must not be client-derived (IA §3.5) |
| Route states (`loading`/`error`/`not-found`) | Frontend server (file conventions) | Browser (`error.tsx` is client) | `error.tsx` recognises offline/skew errors |
| Manifest, icons, `/offline` | CDN/Static (prerendered, public, PHI-free) | Frontend server (proxy public-path rule) | Must bypass auth/entitlement (PWA §3.1) |
| Service worker | Browser (SW) | CDN/Static (`/sw.js` headers via `next.config` `headers()`) | Positive allowlist only; never HTML/RSC/API |
| `hardSignOut()` | Browser (purge, `location.replace`) | API (`POST /auth/signout`, Clear-Site-Data) | Server revokes; client purges what headers cannot |
| `/api/session-status` | API/Backend (authenticated, `no-store`) | Database (`billing_internal.tenant_access_level`) | Lock state derives from DB, never client |
| Bundle budgets, LHCI | CI (nightly, report-only) | — | Measurement only |

---

## Current State (evidence)

All commands read-only; counts over `app components features lib` `.ts/.tsx` unless stated (script `scratchpad/counts.sh`).

### Tokens, colours, fonts
| Item | Value | Evidence |
|---|---|---|
| Font | `--font-sans: Inter, ui-sans-serif, system-ui, …` declared; no `next/font` anywhere → system font renders | `[VERIFIED: app/globals.css:4]` |
| Brand scale | `--color-brand-500: #1769e0;` (v1 blue), 12 steps `brand-25…950` | `[VERIFIED: app/globals.css:6-17]` |
| Dead `:root` block | 30 vars (`--brand-primary: #1769E0;` … `--radius-xl: 16px;`), **0** `var(--…)` references | `[VERIFIED: app/globals.css:25-60]` + grep = 0 |
| Body | `min-height: 100vh;` | `[VERIFIED: app/globals.css:67]` |
| Root layout | `title: "ClinicQ"`; `<html lang="en" suppressHydrationWarning>`; no `viewport`, no `appleWebApp` | `[VERIFIED: app/layout.tsx:4-7,15]` |
| Hex arbitrary classes | **775** in **70** files, **48** distinct; top: `#1769e0` 396, `#eaf2ff` 51, `#111827` 30, `#155cc0` 28, `#b42318` 26, `#f7f6f3` 21, `#4b5563` 19, `#e5e7eb` 17, `#6b7280` 15, `#9a5b00` 14 | grep (`app` 189, `components` 586) |
| `brand-*` classes | 183 | grep |
| Raw palette classes | 3,344 (`text-gray-400` 247) | grep |
| Arbitrary values total | 1,264; `text-[Npx]` 282 — **all** 9/10/11 px | grep |
| Inline hex in TSX | 206: 184 in four react-pdf documents (`features/{referrals,dpdp,billing,prescriptions}/pdf/*`) + 22 dental odontogram | grep; PDFs are out of V2-06 codemod scope |
| Other debt | `uppercase` 152; `backdrop-blur` 27; dead `animate-in` 19; `alert(`/`confirm(` 27; `fixed inset-0` overlays 33; `role="dialog"` 16; raw `<button` 221; `aria-describedby` 5; `inputMode`/`enterKeyHint` 4; 11 rounded and 12 shadow variants; `min-h-screen`/`h-screen` 20 | grep |
| UI code size | 118 TSX files; `components/ui/` 12 hand-rolled primitives (910 lines: alert, badge, button, card, dropdown, empty-state, field, input, modal, phone-input, select, table); `<Modal>` used by 10 files | `wc`, grep |
| shadcn/Radix | **none installed** (`package.json` deps: no `radix-ui`, `cmdk`, `sonner`, `react-day-picker`) | `[VERIFIED: package.json]` |
| Installed UI deps | tailwindcss 4.3.3, @tailwindcss/postcss 4.3.3, lucide-react 1.52.0 (has `Zap`, `Sparkles`, `IndianRupee`, `WifiOff`, `CalendarSync`, `Stethoscope`, `Hourglass`, `UserX`), clsx 2.1.1, tailwind-merge 3.7.0, react 19.3.0 | node_modules |

DESIGN_SYSTEM §0 counts (937 hex, 330 small text, 267 gray-400) are older; the codemod target today is **775 hex + 183 brand** (V2-01 removed the copilot surfaces).

### Accessibility debt (M0 baseline, axe-core 4.14.0, wcag2a/aa/21aa/22aa, Next 15.5.28 @ `ade531f`)
`[VERIFIED: .planning/phases/02-ci-e2e-foundations/evidence/m0-baseline/README.md §4]`
| Rule | Impact | Desktop routes / nodes | Pixel 7 routes / nodes |
|---|---|---|---|
| color-contrast | serious | 17 / 233 | 17 / 165 |
| label | critical | 4 / 67 | 4 / 67 |
| select-name | critical | 6 / 9 | 7 / 10 |
| button-name | critical | 1 / 2 | 2 / 3 |
| target-size | serious | 1 / 14 | 1 / 1 |
`/login` and `/forgot-password` were clean. 03-12b later fixed the user-menu axe findings (`4093ff8`). The colour codemod plus approved values should remove `color-contrast`; `label`/`select-name`/`button-name` need the `Field`/`NativeSelect` primitives (06-02).

### Route states
`find app -name loading.tsx -o -name error.tsx -o -name not-found.tsx -o -name global-error.tsx` → **0**. 24 pages, 2 layouts (`app/layout.tsx`, `app/(dashboard)/layout.tsx`); no `(auth)`/`(public)` layout. Next generates `/_not-found` and `/_global-error` defaults.

### PWA surface
`ls public` → no such directory; no `app/manifest.*`, no `icon*`/`apple-icon*`; no SW. `next.config.ts` has only `serverExternalPackages: ["@react-pdf/renderer"]` `[VERIFIED: next.config.ts:9-11]`. `vercel.json` `"regions": ["bom1"]`.

### Auth/proxy facts the PWA must respect
- `PUBLIC_PAGE_PREFIXES = ["/login", "/forgot-password", "/join", "/r", "/reports/view", "/reschedule", "/auth"]` `[VERIFIED: lib/auth/public-paths.ts:12-23]` — everything else is default-deny (307 → `/login?next=`).
- Proxy matcher excludes `_next/static`, `_next/image`, `favicon.ico`, and single-segment image files only: `"/((?!_next/static|_next/image|favicon.ico|[^/]+\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"` `[VERIFIED: proxy.ts:164]`. So `/manifest.webmanifest`, `/sw.js`, `/offline` reach `pageNeedsSession()` and are protected today.
- `POST /auth/signout` answers `303`, `location: "/login"`, `"clear-site-data": '"cache"'`, `"cache-control": "no-store"`; POST only; same-origin check; `scope` `local`|`global` `[VERIFIED: app/auth/signout/route.ts:26,63-101]`. The user menu submits it as a plain `<form method="post" action="/auth/signout">` `[VERIFIED: components/layout/user-dropdown.tsx:36]`. There is **no client `signOut()`** left in UI code; server-side `signOut` calls exist in `app/auth/signout/route.ts:80`, `features/auth/service.ts:122,136`, `features/auth/password-flows.ts:221`.
- `tests/auth/public-paths.spec.ts:98-100` fails on any public prefix that matches no `page.tsx`/`route.ts` ("stale public prefix") — it does not know metadata files or `public/`.

### E2E harness facts
- `use.serviceWorkers: "block"` with the comment "V2-06 PWA specs opt out explicitly; nothing else may register a service worker." `[VERIFIED: playwright.config.ts:103-104]`
- PR lane: `desktop-chrome`, `pixel-7`, `iphone-15` (@golden); nightly: `iphone-se-3`, `galaxy-tab-s4`, `galaxy-tab-s4-landscape`, `android-tablet-800`, `ipad-gen7`, `ipad-gen7-landscape`, `ipad-mini-744`; baseline lane `vp-360/768/1280` + `m0-axe-*` `[VERIFIED: playwright.config.ts:39-83; package.json scripts]`. Workers 1, retries 2 in CI.
- `tests/e2e/fixtures.ts` aborts every non-loopback request per context and fails the test; Turnstile script is stubbed.
- `npm run e2e:build` runs `next build` with an allowlisted env and `NODE_OPTIONS=--require server-net-guard.cjs` `[VERIFIED: tests/e2e/support/app-env.ts:39,113]`.
- `scripts/m0-baseline-report.mjs:127` reads `.next/app-build-manifest.json` — **absent on the Turbopack build** (`ls .next/app-build-manifest.json` → no such file), so the route-JS section of `e2e:baseline` is broken on Next 16.

### Bundle sizes now
- Next 15.5.28 (`03-06/before/e2e-build.txt`): shared 103 kB; `/` 108 kB; `/consultation/[id]` 175 kB; `/login` 204 kB (Next's own column).
- Next 16.4.6 (`03-06/after/build-ci-env.txt`): route list only — **no Size/First Load JS columns** (Vercel PR #83815 removed them).
- Measured here from the existing Turbopack build (`.next`, BUILD_ID `tGSaIIIhOILCwLgmSTVro`, built 2026-11-13 04:44Z) with `scratchpad/route-js.mjs` (union of `build-manifest.json` `rootMainFiles` + every `entryJSFiles` list in `page_client-reference-manifest.js`, gzip -9):

| Route | First-load JS gz | Budget (PWA §3.9) |
|---|---|---|
| framework root (`rootMainFiles`) | 128.8 kB | — |
| `/forgot-password`, `/login`, `/join` | 234.5 / 234.2 / 226.9 | 150 (shell-only) |
| `/consultation/[id]` | 213.1 | 200 |
| `/patients/[id]`, `/queue`, `/calendar` | 195.5 / 188.7 / 186.2 | 150–200 |
| `/` (Today), `/settings/billing` | 158.3 | 200 / 150 |
| `/r/[token]`, `/reports/view` | 133.4 | 150 |
| `/_not-found` | 132.3 | — |
Implication: the framework floor (128.8 kB) leaves ~21 kB for a 150 kB shell-only route. Report-only in V2-06 is fine; recalibration is an Open Question for V2-15.

---

## G2-D Split: what can merge without the approved direction

R5 says no primitive is built before G2-D; PO-ACTIONS D-1 says G2-D "blocks plans 06-01…06-04 being final". The split below honours both literally.

| Plan | Needs G2-D? | Why | What ships without it |
|---|---|---|---|
| **06-07** bundle report + LHCI report-only | **No** | Measurement only | Route-JS script on Turbopack manifests, nightly LHCI on 4 routes, M0 report fix |
| **06-05** manifest, icons, SW, `/offline`, `hardSignOut()`, `no-store`, public-asset rule | **No** (icon provisional) | Behaviour and security; the icon is PO-19's accepted default (teal `#0E716B` tile, "Q"); nobody installs before G6 (PO-15), so a later icon swap costs one commit | Everything; icon PNG/SVG regenerated if G2-D changes it |
| **06-06** install UX, update toast, skew guard, `/api/session-status`, `SUBSCRIPTION_LOCKED` client handling | **No** (sheet visuals provisional) | Logic + copy are fixed by PWA_STRATEGY §3.7/§6; the install sheet is only low-fi in V2-DX | Everything, styled with semantic tokens |
| **06-01a** token architecture + value-neutral codemod | **No** | Semantic layer with **v1-equivalent provisional values**; the codemod is proven mechanically by a near-zero screenshot diff | `@theme` raw + semantic layers, codemod of 775 hex + 183 brand sites, guard scripts in report mode |
| **06-04a** route states, `dvh`/safe-area utilities, client error capture (R-29) | **No** | No design values; token-only styling; visual approval happens at G3 | `loading/error/not-found` per group, 20 `min-h-screen` → `min-h-dvh`, `pb-safe` utilities |
| **06-01b** approved values, IBM Plex (local), `lang="en-IN"`, AI/Smart Assist tokens + chips | **Yes** | These *are* the direction | — |
| **06-02** primitives | **Yes (R5, literal)** | "before any primitive is built" | Nothing (see Open Question 1) |
| **06-03** clinical components | **Yes** | Token chip, status chips, identity header are designed in V2-DX | — |
| **06-04b** shell (sidebar/rail/bottom bar), IA nav, palette, toasts | **Yes** | Shell look and the md/lg Today layout are V2-DX decisions (PWA §3.4) | — |
| **06-08** close-out: React Compiler rules back to `error`, guards, screenshot set, G3 evidence | after 06-02…04 | Warnings live in v1 components the primitives replace | — |

### Token architecture (so G2-D only swaps values)

Three layers, all in `app/globals.css` (DESIGN_SYSTEM §10: tokens live only there):

1. **Raw palette** (`@theme`): `--color-paper`, `--color-ink-*`, `--color-primary-50…900`, `--color-{success,warning,danger,info,violet,slate}-{50,500,600,700}`, `--color-focus`, plus new families from G2-D (`--color-ai-*`). Components must never use these (guard: no `primary-`/`ink-` utilities outside `components/ui/**` token stories — report mode).
2. **Semantic** (`@theme inline`, DESIGN_SYSTEM §2.3/§2.4 names unchanged): `canvas, surface, sunken, selected, fg, fg-muted, fg-subtle, fg-placeholder, fg-disabled, fg-on-accent, border, border-subtle, border-control, accent, accent-hover, accent-pressed, accent-subtle, accent-fg, ring, success-*, warning-*, danger-*, info-*, status-{booked,waiting,with-doctor,to-bill,done,no-show,cancelled}-{bg,fg}, alert-allergy-{bg,fg}, scrim`, plus AI-02 additions `ai-{bg,fg,border}`, `smart-fg`, `preview-{bg,fg}`. **Components and the codemod use only these.**
3. **Structural** (`@theme`): `--text-caption…--text-token`, `--radius-{sm,md,lg,xl}`, `--shadow-{popover,overlay}`, `--ease-out`, `--duration-*`, plus shell sizes (`--spacing-bar: 3.5rem`, `--spacing-bottom-bar: 4rem`, `--spacing-rail: 4rem`, `--spacing-sidebar: 14.5rem`) and `--spacing-control: 2.75rem` (44 px, an a11y floor, not a taste choice).

**06-01a provisional values** map semantics to today's rendering (accent → `#1769e0`, accent-subtle → `#eaf2ff`, canvas → `#f7f6f3`, fg → `#111827`, fg-muted → `#4b5563`, border → `#e5e7eb`, danger → `#b42318`, warning → `#9a5b00`, success → `#18794e`; full table from the 48 distinct hexes, `[VERIFIED: grep top list above]`). Where two v1 hexes collapse into one semantic (`#155cc0` and `#0f5ab8` both "hover"), the screenshot diff will show it; accept ≤ the per-screen threshold the plan sets and list each collapse. **06-01b** then edits only the raw palette and the semantic mapping lines; the diff is one file plus the font wiring.

A TS mirror `lib/design/tokens.ts` holds the handful of values non-CSS consumers need (manifest `theme_color`/`background_color`, icon generation), with a unit test that parses `globals.css` and asserts equality — the CSS stays the single source.

---

## V2-DX Proposal Brief

### Sandbox: where and how
- **Worktree, not branch switch:** `git worktree add ../clinicOS-v2-dx -b v2/phase-dx-design-exploration feature/v2` (other agents use this tree).
- **Location:** `.planning/sketches/` (the `/gsd-sketch` convention; `themes/` holds shared CSS variables). Never under `app/`, `components/`, `features/`, `lib/`. Not type-checked (no `.ts` files: `tsconfig.json` includes `**/*.ts`), not covered by `ai-l1-greps` (scans `app|features|lib|components` only), linted by `eslint .` only for the one `.mjs` capture script (keep it clean).
- **Files:**
  - `.planning/sketches/themes/clinic-paper.css` — exactly the semantic token names of §Token architecture with DESIGN_SYSTEM §2.1 values; this file is copied into 06-01b, so prototype and product cannot drift.
  - `.planning/sketches/themes/fonts/IBMPlex*.woff2` — the same vendored OFL files 06-01b will use (+ `OFL.txt`).
  - `001-palette-type/` (DX-01: swatches, contrast table, type scale, en-IN numerals `₹1,25,000`, `₹1,499 + GST`, `₹1,768.82 per month incl. 18% GST`, `9:30 am`, `12 Nov 2026`, `42 y · M`, tabular tokens, `I l 1 O 0` disambiguation, ₹ glyph check, Devanagari sample).
  - `002-icon/` (DX-01: SVG master of the teal tile + "Q", 512/192/maskable 80% safe-zone/apple 180/favicon previews on paper, white and a dark wallpaper, plus 1–2 alternates).
  - `003-today/` (DX-02: front desk at 360/820/1180/1280 (+744), doctor mode at 360 and 1280; at 1180 two variants per PWA §3.4 — "two-pane list + detail" vs "3 lanes + lane switcher" — for the PO to choose).
  - `004-consult/` (DX-03: two-pane at 1180/1280, context drawer at 820, single column + sticky Finish bar at 360; AI Assist entry with "Preview" chip; Smart Assist chips (Repeat last Rx, favourites) with the neutral `Zap` glyph; allergy banner; SaveStatus states).
  - `005-surfaces/` (DX-04, low-fi): install sheet (Android card, iOS 3-step sheet incl. "Open as Web App", in-app-browser "Open in Chrome/Safari"), `/offline` ("You're offline. Patient data isn't stored on this device. Reconnect to continue." + Retry), signup → email code → clinic → "Start trial" mandate (Razorpay modal placeholder, ₹5 refunded token-charge note, "Confirming your AutoPay…" state), `/settings/billing` (plan "₹1,499 + GST", next debit ₹1,768.82, one muted "AI features: Coming soon" row, no price/button), `/billing/locked` and `/billing/locked/staff`, `/platform` tenant list (no clinical data, aal2 badge), update toast, offline banner.
  - `v2-dx-capture.mjs` — uses existing `@playwright/test` + `@axe-core/playwright` (no new dependency) on `file://` URLs with all non-`file:` requests aborted.
- **Interactivity:** vanilla JS only where §4 interaction targets must be walkable: Today filter (type token → Enter = check-in, 1 action), `W` → phone → Enter → Enter (walk-in ≤ 3 keystrokes after typing), `B` booking ≤ 3, reschedule ≤ 4, collect ≤ 3; Consult Rx entry (type → ↓/Enter → digit preset → `5d` → Enter) and `Alt+1…7`.

### Evidence the capture script produces (`.planning/sketches/v2-dx-evidence/`)
| Artefact | Content |
|---|---|
| `screens/<surface>/<width>.png` | Chromium at 360, 744, 820, 1180, 1280; WebKit (iPhone 15 descriptor) for Today/Consult at 390 |
| `axe/<surface>.json` + summary | Same tags as M0 (wcag2a, wcag2aa, wcag21aa, wcag22aa); target **0 serious/critical** |
| `contrast.md` | WCAG relative-luminance ratio for every text/background and non-text pair in `clinic-paper.css` (script, no hand-typed numbers) incl. focus ring vs adjacent colours |
| `counts.json` / `counts.md` | Keystrokes/actions per walkable flow vs the §4 targets and the M0 v1 counts (walk-in 4 actions/28 keystrokes; booking 6/32; collect 9/22; consult 12/105) |
| `walkthrough/*.webm` | Playwright video of each counted flow (Playwright's bundled ffmpeg is present) |
| `copy-check.txt` | "AI" only inside AI-labelled elements; no "AI" within 80 chars of ₹/price/buy (mirrors L1-R5/R6) |
| `glyphs.txt` | ₹ (U+20B9) and Devanagari rendered by Plex vs fallback (`document.fonts.check` + width probe) |
| `README.md` | Index + the G2-D decision checklist |

Recomputed here (`scratchpad/contrast.mjs`) for the DESIGN_SYSTEM values: white on `primary-600` 5.84, `primary-700` on `primary-50` 6.66, `ink-450` placeholder on white 4.66, `ink-500` on `sunken` 4.75, `line-strong` on paper 3.33, focus on white 5.81 — all pass; **focus `#1F5FD1` on `primary-600` is 1.01:1**, so the ring must always sit outside the control with a ≥ 2 px offset over canvas/surface (no inset rings on teal), which the contrast report should state.

### G2-D decision checklist (what the PO answers)
1. Palette "Clinic Paper" (teal accent, warm neutrals) — approve / change.
2. Type: IBM Plex Sans 400/500/600, Devanagari only where Hindi renders — approve.
3. Icon + `theme_color #FFFFFF` + `background_color #F6F5F1` — approve (or alternate).
4. Today at 1180: two-pane vs 3 lanes; at 820: two-pane (proposed).
5. Consult layouts at 360/820/1180/1280.
6. AI Assist chip colour + sparkle; Smart Assist `Zap` glyph or no label; "Preview" chip + note copy; "Coming soon" row.
7. Price display "₹1,499 + GST" / checkout "₹1,768.82 per month incl. 18% GST".
8. Low-fi surfaces acceptable as the brief for V2-06/V2-13b/V2-13c.

### DX plan order and sizes
DX-01 (S) palette/type/icon → DX-02 (S–M) Today and DX-03 (S–M) Consult in parallel → DX-04 (S) low-fi surfaces → isolated Claude design reviewer (fresh context, reads only the evidence folder) → DX-05 PO walkthrough (~45–60 min) → G2-D row in `docs/v2/VERIFICATION_LOG.md` with the PO's verbatim answer → PR of `.planning/sketches/**` + evidence into `feature/v2` (nothing under `app/`). After G2-D, run `/gsd-ui-phase 06` to turn the approved sandbox into `06-UI-SPEC.md` for the planner.

---

## Standard Stack

### Core (existing, keep)
| Library | Version | Purpose | Why |
|---|---|---|---|
| next | 16.4.6 (exact) | App Router, `app/manifest.ts`, metadata icons, `viewport`, `deploymentId` | Decided in V2-03 03-06 `[VERIFIED: package.json]` |
| tailwindcss / @tailwindcss/postcss | 4.3.3 | `@theme` / `@theme inline` tokens | DESIGN_SYSTEM §2.4 |
| lucide-react | 1.52.0 | Icons incl. `Sparkles` (AI only), `Zap` (Smart Assist) | Already used; L1-R4 enforces sparkle placement |
| @playwright/test / @axe-core/playwright | 1.63.0 / 4.14.0 | Gallery screenshots, axe, PWA specs, V2-DX capture | Already the e2e stack |
| clsx + tailwind-merge | 2.1.1 / 3.7.0 | `cn()` for primitives | Already present |

### New (state the reason in the plan, per CLAUDE.md)
| Library | Version (registry) | Purpose | Plan |
|---|---|---|---|
| `radix-ui` | 1.8.1 | Dialog, AlertDialog, Popover, DropdownMenu, Tooltip, Tabs, RadioGroup, Checkbox, Switch primitives (shadcn's current unified import) `[CITED: FRONTEND_TECHNOLOGY_ASSESSMENT / roadmap FE-2]` | 06-02 |
| `cmdk` | 1.1.1 | Command palette, Combobox list | 06-02/06-04b |
| `sonner` | 2.0.8 | Toasts (`role="status"`/`alert`) | 06-02/06-04b |
| `react-day-picker` | 10.0.2 | Calendar popover for DateField | 06-02 (2d) — or defer to V2-08 with SlotPicker |
| `@lhci/cli` | pin a release ≥ 7 days old at install time (0.16.1 published 2026-11-11; 0.16.0 2026-11-02) | Lighthouse CI report-only nightly | 06-07 |
| `class-variance-authority` (optional) | 0.7.1 | Variant maps in shadcn code | Prefer plain typed maps; avoid the dependency |

No shadcn CLI run (it fetches the registry over the network); copy the open code by hand from the shadcn source into `components/ui/**` and adapt to the semantic tokens.

### Alternatives considered
| Instead of | Could use | Tradeoff |
|---|---|---|
| Hand-written `public/sw.js` | `@serwist/turbopack` 9.5.13 (+ `serwist`, `esbuild`) | Works with Turbopack via `app/serwist/[path]/route.ts`; adds 3 deps, a nested route the proxy default-denies, and a precache manifest that contradicts PWA §3.9. Rejected (PWA §5). |
| `next/font/google` | `next/font/local` with vendored OFL woff2 | Google variant downloads at build time; the e2e build is network-guarded (Node socket guard) and Turbopack's fetch is outside it `[ASSUMED]` → nondeterministic/outbound. Use local. |
| `next analyze export` (16.4+, experimental) | Manifest reader script | Experimental CLI; the manifest method is dependency-free and already proven here |
| LHCI | Playwright + CDP web-vitals | Zero-dependency but not "Lighthouse"; roadmap names LHCI |

**Version verification:** `npm view` run 2026-11-13 for every package above (values in the table).

## Package Legitimacy Audit

Seam: `gsd-tools query package-legitimacy check --ecosystem npm …` (2026-11-13). No postinstall script on any (`npm view <pkg> scripts.postinstall` empty).

| Package | Registry | Latest publish | Weekly downloads | Source repo | Verdict | Disposition |
|---|---|---|---|---|---|---|
| radix-ui | npm | 2026-10-12 | 27.5 M | github.com/radix-ui/primitives | OK | Approved |
| cmdk | npm | 2025-03-14 | 46.7 M | github.com/pacocoursey/cmdk | OK | Approved |
| sonner | npm | 2026-08-09 | 57.4 M | github.com/emilkowalski/sonner | OK | Approved |
| react-day-picker | npm | 2026-09-30 | 47.6 M | github.com/gpbl/react-day-picker | OK | Approved |
| class-variance-authority | npm | 2024-11-26 | 81.1 M | — (seam OK) | OK | Optional; prefer not to add |
| @lhci/cli | npm | 2026-11-11 | 2.48 M | github.com/GoogleChrome/lighthouse-ci | **SUS (too-new)** | Flagged — pin an older release; planner adds `checkpoint:human-verify` |
| lighthouse (transitive of LHCI) | npm | 2026-10-27 | 7.30 M | github.com/GoogleChrome/lighthouse | **SUS (too-new)** | Flagged with LHCI |
| @serwist/turbopack | npm | 2026-10-04 | 226 k | github.com/serwist/serwist | OK | Not recommended (see Alternatives) |

**Packages removed due to [SLOP]:** none. **Flagged [SUS]:** `@lhci/cli`, `lighthouse` — legitimate Google projects flagged only for release age; run `scripts/ci/package-legitimacy.mjs --base feature/v2 --plan 06-07` and `npm audit signatures` before merging. Package names come from the approved docs (FTA/roadmap FE-2, PWA §9.3); the registry confirms them, but Context7 was not consulted, so treat names as `[CITED]` from project docs, not `[VERIFIED]`.

---

## Architecture Patterns

### System architecture (data flow)

```
                      ┌────────────────────── build time ───────────────────────┐
 app/globals.css ─raw→semantic→ Tailwind v4 ─→ CSS        public/sw.js (copied verbatim)
 vendored woff2 ─→ next/font/local ─→ self-hosted fonts   app/manifest.ts ─→ /manifest.webmanifest
                      └──────────────────────────────────────────────────────────┘
 Browser request ─→ proxy.ts (getClaims refresh; default deny)
     │   public?  /login … /auth  + NEW /manifest.webmanifest /sw.js /offline ──→ 200 (no auth)
     │   protected & signed-out ──→ 307 /login?next=
     ▼
 (dashboard) layout (RSC): membership → role → navForRole → [V2-05: locked → /billing/locked(/staff)]
     ▼
 Shell (client): TopBar / Sidebar|Rail|BottomBar, palette, toasts, offline banner
     │                 ▲ visibilitychange/online/5 min
     │                 └── GET /api/session-status {deploymentId, accessLevel} (no-store, authenticated)
     │                        ├ deploymentId ≠ html[data-dpl-id] → "A new version is ready · Reload" (safe point)
     │                        └ accessLevel ≠ full → unsubscribe Realtime → location.replace(locked page)
     ▼
 Service worker (fetch): navigation → network (preload) → on failure /offline
                         /_next/static/** → cache-first (cap ~200)
                         everything else → no respondWith (API, RSC, actions, cross-origin)
 Sign-out paths ─→ hardSignOut(reason) → unsubscribe + abort → POST /auth/signout (fetch, redirect: manual)
                   → [offline fallback: browser signOut({scope:'local'})] → purge caches/storage → location.replace('/login')
```

### Recommended structure
```
app/globals.css                  # 3 token layers (only token source)
app/fonts/                       # vendored IBM Plex woff2 + OFL.txt (06-01b)
app/manifest.ts                  # PWA-01
app/icon.svg, app/apple-icon.png # metadata file conventions (single-segment, matcher-excluded)
app/offline/page.tsx             # static, PHI-free
app/api/session-status/route.ts  # PWA-05
app/(dashboard)/**/loading.tsx|error.tsx, app/not-found.tsx, app/global-error.tsx
public/sw.js, public/icon-192.png, public/icon-512.png, public/icon-maskable-512.png
components/ui/**                 # primitives (06-02)
components/clinical/**           # clinical patterns + AI/Smart Assist chips (06-01b/06-03)
components/shell/**              # TopBar, Sidebar, Rail, BottomBar, InstallEntry, UpdateToast (06-04b/06-06)
lib/pwa/{register-sw,install,standalone,session-status}.ts
lib/auth/hard-sign-out.ts        # the only client file allowed to call auth.signOut (offline fallback)
lib/design/tokens.ts             # TS mirror for manifest/icons, test-enforced
app/dev/ui/page.tsx              # gallery; notFound() in production
scripts/ci/route-js.mjs          # Turbopack first-load JS report (06-07)
```

### Pattern 1 — semantic tokens in Tailwind v4 (06-01a/b)
```css
/* Source: DESIGN_SYSTEM.md §2.4 (structure); values provisional in 06-01a, approved in 06-01b */
@import "tailwindcss";
@theme {
  --color-v1-blue-500: #1769e0;     /* 06-01a raw (v1-equivalent); replaced by --color-primary-* in 06-01b */
  --color-v1-blue-50:  #eaf2ff;
  --color-v1-canvas:   #f7f6f3;
}
@theme inline {
  --color-accent: var(--color-v1-blue-500);
  --color-accent-subtle: var(--color-v1-blue-50);
  --color-canvas: var(--color-v1-canvas);
}
```
Codemod: `bg-[#1769E0]` → `bg-accent`, `text-[#1769e0]` → `text-accent`, `brand-500` → `accent`, etc., one mapping table, case-insensitive hex, per-file report. Verify with the M0 screenshot lane (`npm run e2e:baseline`) before/after: per-screen pixel diff ≤ threshold, each collapse listed.

### Pattern 2 — primitives own the input contract (06-02, PWA-07)
`Input` takes a `kind` (`tel | otp | email | password-current | password-new | pincode | numeric | decimal | search | name`) that sets `type/inputMode/autoComplete/enterKeyHint/autoCapitalize` per PWA §3.5; 16 px text; 44 px height; `Field` wires `id`, `aria-describedby` (hint + error), `aria-invalid`. Guard test: every rendered numeric `kind` has `inputMode` (behavioural, in `/dev/ui` e2e — not a source grep).

### Pattern 3 — viewport, safe areas, `dvh` (06-01b/06-04a)
```ts
// app/layout.tsx  Source: PWA_STRATEGY §3.1; Next viewport API
export const viewport = { themeColor: "#FFFFFF", viewportFit: "cover", width: "device-width", initialScale: 1 };
// never maximumScale / userScalable=false
export const metadata = { title: "ClinicQ", appleWebApp: { capable: true, title: "ClinicQ", statusBarStyle: "default" } };
// <html lang="en-IN"> plus <meta name="color-scheme" content="light">
```
`@utility pb-safe { padding-bottom: max(0.5rem, env(safe-area-inset-bottom)); }` (and `px-safe`, `pt-safe`) in `globals.css`; replace the 20 `min-h-screen`/`h-screen` with `min-h-dvh`/`h-dvh`.

### Pattern 4 — manifest and public-asset rule (06-05, PWA-01)
```ts
// app/manifest.ts  Source: node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md; PWA_STRATEGY §3.1
import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/", name: "ClinicQ", short_name: "ClinicQ", start_url: "/?source=pwa", scope: "/",
    display: "standalone", background_color: "#F6F5F1", theme_color: "#FFFFFF",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
```
Add `"/manifest.webmanifest"`, `"/sw.js"`, `"/offline"` to `PUBLIC_PAGE_PREFIXES` and extend `tests/auth/public-paths.spec.ts` so its "stale prefix" check also resolves `app/manifest.ts`, `public/**` and `app/offline/page.tsx`. Keep icons as static single-segment files (matcher-excluded); do **not** use `app/icon.tsx` (`/icon` has no extension → proxy default-deny) or `generateImageMetadata` (nested `/icon/<id>`).

### Pattern 5 — `public/sw.js` + headers (06-05, PWA-02)
```js
// public/sw.js  plain JS, no imports. Source: PWA_STRATEGY §5, Next PWA guide §8
const STATIC = "static-v1", SHELL = "shell-v1", MAX = 200;
const PRECACHE = ["/offline", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"];
self.addEventListener("install", (e) => e.waitUntil((async () => {
  const c = await caches.open(SHELL);
  for (const url of PRECACHE) {
    const r = await fetch(url, { credentials: "omit", cache: "no-store" });
    if (!r.ok || r.redirected) throw new Error("precache refused " + url); // never cache a login redirect
    await c.put(url, r);
  }
})()));
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== STATIC && k !== SHELL) await caches.delete(k);
  if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
  await self.clients.claim();
})()));
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (url.origin !== self.location.origin || req.method !== "GET") return;          // D-1
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try { return (await e.preloadResponse) || (await fetch(req)); }
      catch { return (await caches.match("/offline")) || Response.error(); }
    })());
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) e.respondWith(cacheFirst(req));      // D-2 (keyed incl. ?dpl=)
});
```
`next.config.ts` `headers()` for `/sw.js`: `Content-Type: application/javascript; charset=utf-8`, `Cache-Control: no-cache, no-store, must-revalidate`, `Content-Security-Policy: default-src 'self'; script-src 'self'` `[CITED: node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md:636-666]`. Register with `navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })` only inside the authenticated shell.

### Pattern 6 — `hardSignOut()` on top of 03-12b (06-05, PWA-02 / D-5)
```ts
// lib/auth/hard-sign-out.ts (client). Adapts PWA D-5 to the server route V2-03 shipped.
export async function hardSignOut(reason: "user" | "switch" | "idle" | "expired" | "removed" | "everywhere") {
  runSignOutCleanups();                       // registry: Realtime unsubscribe, abort in-flight, clear query state
  const body = new URLSearchParams({ scope: reason === "everywhere" ? "global" : "local" });
  let serverOk = false;
  try {
    const r = await fetch("/auth/signout", { method: "POST", body, redirect: "manual", credentials: "same-origin",
                                             signal: AbortSignal.timeout(5000) });
    serverOk = r.type === "opaqueredirect" || r.status === 303;
  } catch { /* offline */ }
  if (!serverOk) await createBrowserClient().auth.signOut({ scope: "local" }); // only client signOut allowed
  await purgeDeviceState();                   // caches outside D-2, sessionStorage.clear(), localStorage minus D-3 allowlist
  location.replace("/login");
}
```
Spec 11 is reformulated for the post-03-12b code: `auth.signOut` may appear only in `lib/auth/hard-sign-out.ts`, `app/auth/signout/route.ts` and `features/auth/**` (server); no other `"use client"` module may call it. The user-menu `<form>` stays as a no-JS fallback but its `onSubmit` calls `hardSignOut` with `preventDefault()`.

### Pattern 7 — bundle report and LHCI (06-07)
- `scripts/ci/route-js.mjs`: the `scratchpad/route-js.mjs` method (rootMainFiles + `entryJSFiles` of each `page_client-reference-manifest.js`, gzip -9), JSON + markdown, compared to PWA §3.9 budgets, report-only; reused by `scripts/m0-baseline-report.mjs` (replace its `app-build-manifest.json` reader).
- LHCI nightly: `collect.url` = Login, Today, Patients, Consult on `serve.ts` (port 3100); `settings.extraHeaders` carries the Cookie from the existing `playwright/.auth/*.json` storage state (no Puppeteer); `chromeFlags: --host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"` so nothing leaves the machine; `upload.target: "filesystem"` (never `temporary-public-storage`); `CHROME_PATH` = Playwright's Chromium; assertions at `warn`.

### Pattern 8 — skew and version (06-06, PWA-05)
Set `deploymentId: process.env.NEXT_DEPLOYMENT_ID` (Vercel supplies its own; the e2e build env adds a value). Next then adds `?dpl=` to static assets, `x-deployment-id`/`x-nextjs-deployment-id` headers and `data-dpl-id` on `<html>`, and hard-navigates on mismatch `[CITED: node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/deploymentId.md]`. `/api/session-status` returns the server's id and `accessLevel` from V2-05's `billing_internal.tenant_access_level`; the client compares with `document.documentElement.dataset.dplId`.

### Anti-patterns
- Using raw palette utilities (`bg-primary-600`, `text-ink-500`) in components — breaks the value-swap.
- `next/font/google` in a network-guarded build.
- Precaching JS chunks or caching navigations/RSC (`?_rsc=`, `RSC: 1`) or `/api/**`.
- A dynamic `app/icon.tsx`/`opengraph-image` route for PWA icons (protected path).
- Enabling `experimental.useOffline` before V2-07 idempotency (it replays held Server Actions on reconnect `[CITED: node_modules/next/dist/docs/01-app/02-guides/offline-support.md]`).
- Keeping `serviceWorkers: "block"` off globally; only `tests/e2e/pwa/**` opt in.

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---|---|---|---|
| Focus trap, scroll lock, roving focus, dismiss layers | Another `fixed inset-0` overlay (33 today) | `radix-ui` Dialog/AlertDialog/Popover/DropdownMenu | 21+ v1 overlays lack focus traps (F-10) |
| Combobox/listbox semantics | Custom keyboard lists | `cmdk` (Command) | `aria-activedescendant`, typeahead |
| Toast queue + live regions | Custom toasts | `sonner` | `role="status"`/`alert`, stacking |
| Calendar grid | Custom date grid | `react-day-picker` | Locale/keyboard grid |
| Manifest/icon links | Hand `<link>` tags | `app/manifest.ts`, `app/icon.svg`, `app/apple-icon.png`, `viewport` export | Next emits tags |
| Skew detection | Hand build-number file | Next `deploymentId` | Built-in header + `data-dpl-id` |
| Contrast numbers | Hand-typed ratios | Script over `globals.css` / `clinic-paper.css` | CLAUDE.md: evidence by tools |

The one place hand-rolling is *correct*: the ~100-line service worker (auditable allowlist, PWA §5).

## Common Pitfalls

1. **Value-swap defeated by raw utilities.** If 06-02 primitives use `primary-600`, G2-D changes ripple through components. *Avoid:* semantic-only rule + report-mode guard; gallery screenshot diff after 06-01b shows only colour change.
2. **Non-neutral codemod.** Collapsing near-identical v1 hexes changes pixels. *Avoid:* mapping table with per-hex counts; M0 screenshot diff; review each collapse.
3. **Fonts fetched at build.** `next/font/google` makes `npm run e2e:build` depend on Google. *Avoid:* `next/font/local`, `adjustFontFallback`, Devanagari not in root layout (PWA §3.9). Check ₹ in the Latin subset (unconfirmed, DESIGN_SYSTEM §3.1).
4. **React Compiler lint rules.** `react-hooks/set-state-in-effect` (30), `purity` (4), `immutability` (1) were set to `warn` with V2-06 as owner (03-06; 03-SUMMARY:108). New primitives must satisfy them; 06-08 raises them to `error` after v1 call sites are replaced or individually waived.
5. **PWA assets redirected to login.** Default deny (03-12b) protects `/manifest.webmanifest`, `/sw.js`, `/offline`. Spec 1 fetches them with no cookies and as a locked-tenant user (V2-05 05-10b handover). *Avoid:* public prefixes + spec extension (Pattern 4).
6. **Bundle numbers from the wrong source.** Next 16 build output has no size column; `app-build-manifest.json` does not exist under Turbopack; `e2e:baseline`'s route-JS section silently reports "not found". *Avoid:* Pattern 7 script; keep gzip -9 to compare with M0 (method differs: M0 page+layouts on webpack; record both).
7. **AI copy grep already blocking.** `ai-l1-greps.mjs` L1-R4/R5/R6 run in the `static` job now; R5 fails on the word "AI" outside `LLM_FEATURE_FILES` (`components/consultation/ai-scribe-modal.tsx`, `components/consultation/returning-patient-catchup.tsx`) `[VERIFIED: scripts/ci/ai-l1-greps.mjs:38-41]`; R6 (`const WINDOW = 80;`, no exceptions) joins a file's copy segments, so "AI features: Coming soon" in the same file as "₹1,499 + GST" fails. *Avoid:* put the AI Assist chip, Preview chip/note and "Coming soon" row in dedicated `components/clinical/ai-*.tsx` files added to the allowed set; never render them in a file that contains price copy. The roadmap's "report mode" wording refers to the new DESIGN_SYSTEM §10 guards, not L1 (keep L1 blocking).
8. **Precache under cookies.** SW `fetch("/offline")` with cookies runs the proxy refresh and can cache a redirect. *Avoid:* `credentials: "omit"`, refuse `redirected`.
9. **`?dpl=` and cache growth.** With `deploymentId`, every deploy changes static URLs. *Avoid:* LRU cap (~200) and cache-name cleanup on `activate`.
10. **Clear-Site-Data alone.** Only `"cache"` is sent; storage purge is client-side (D-7). The `hardSignOut` fetch must use `redirect: "manual"` so the 303 does not render `/login` inside fetch; then `location.replace`.
11. **iPadOS UA.** Playwright iPad descriptors send `iPad`, real iPadOS sends `Macintosh` (PWA E16) → spec 10 needs a custom UA + `maxTouchPoints`.
12. **SW vs the network fixture.** With `serviceWorkers: "allow"`, requests made by the SW may bypass `context.route` in Chromium `[ASSUMED]`. *Avoid:* the SW fetches same-origin only; PWA specs assert every SW-handled URL is loopback (listen to `context.on("request")` / CDP) and keep the per-test blocked-host assertion.
13. **LHCI leaks.** Default upload is Google public storage; Chrome under LHCI is outside the Playwright fixture. *Avoid:* filesystem upload + `--host-resolver-rules`; Turnstile on `/login` will fail to load (score it as such, or measure `/login` with the test site key served from loopback).
14. **Next default not-found/global-error.** Adding `app/global-error.tsx` replaces the generated one; it must not show error messages (PHI) — show the digest only.
15. **`/settings/plan` vs `/settings/billing`.** IA tree says `/settings/plan`; IA update, SUB-08 and the existing route say `/settings/billing`. Use `/settings/billing`.
16. **Palette "Assist" group.** IA §3.7 still lists "Ask Copilot" (removed by AI-01). The palette has no AI entry in V2-06.

## Runtime State Inventory
Not a rename/migration phase. One runtime-state concern only: once 06-05 ships, **browsers keep a registered SW and Cache Storage** across deploys. Mitigation is in-code (cache-name cleanup, `updateViaCache: "none"`, and a kill switch: a `sw.js` that unregisters itself must be ready as a rollback commit). No stored data, OS registrations, secrets or build artefacts carry design strings.

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|---|---|---|---|---|
| Node | all | ✓ | v24.13.0 | — |
| Playwright + browsers | specs, V2-DX capture | ✓ | 1.63.0; chromium-1248, webkit-2359, ffmpeg-1013 cached | — |
| @axe-core/playwright | gallery/V2-DX axe | ✓ | 4.14.0 | — |
| Docker / local Supabase | e2e, `/api/session-status` tests | ✓ | Docker 29.7.2 | — |
| Existing `.next` build | bundle measurement here | ✓ (built 04:44Z by another agent) | Next 16.4.6 Turbopack | re-run `npm run e2e:build` in the phase |
| IBM Plex woff2 files | 06-01b, V2-DX | ✗ (not in repo) | — | Download once from the IBM/plex GitHub release (OFL), record SHA-256 |
| Lighthouse/LHCI | 06-07 | ✗ | — | Add pinned devDependency |

## Validation Architecture

### Test framework
| Property | Value |
|---|---|
| Framework | Vitest 3 (unit/DB), Playwright 1.63.0 (e2e), axe-core 4.14.0 |
| Config | `vitest.config.ts`, `playwright.config.ts` |
| Quick run | `npx vitest run tests/design tests/pwa` (new dirs) |
| Full suite | `npm run test:db` then `npm run e2e:build && npm run e2e:pr` |

### Requirements → tests
| Req | Behaviour | Type | Command | Exists? |
|---|---|---|---|---|
| P1-28 tokens | `globals.css` semantic names resolve; TS mirror equals CSS | unit | `npx vitest run tests/design/tokens.spec.ts` | ❌ Wave 0 |
| P1-28 codemod | v1 screens unchanged beyond threshold (06-01a); M0 flows green | e2e | `npm run e2e:baseline` (diff) + `npm run e2e:pr` | ✅ M0 |
| P1-28 primitives | keyboard/focus (Tab, Esc, arrows, trap/restore) per primitive | e2e on `/dev/ui` + unit | `npx playwright test tests/e2e/design --project=desktop-chrome` | ❌ |
| P1-28 gallery | 0 serious/critical axe; screenshots 360/820/1180/1280 | e2e | `tests/e2e/design/gallery.spec.ts` | ❌ |
| PWA-07 | numeric kinds carry `inputMode`; inputs ≥ 16 px | e2e (computed style) | `tests/e2e/design/input-modes.spec.ts` | ❌ |
| PWA-01 | spec 1 (manifest valid, assets 200 no redirect, no cookies, locked tenant) | e2e | `tests/e2e/pwa/01-manifest.spec.ts` | ❌ |
| PWA-01 | spec 2 (`Page.getInstallabilityErrors` empty) | e2e (Chromium) | `tests/e2e/pwa/02-installable.spec.ts` | ❌ |
| PWA-02 | specs 3, 4, 5 (SW headers, offline, cache audit + purge per exit path) | e2e (pixel-7) | `tests/e2e/pwa/0{3,4,5}-*.spec.ts` | ❌ |
| PWA-02 | spec 11 (signOut only in allowed files) | static policy script (like `ai-l1-greps`) | `node scripts/ci/signout-guard.mjs` | ❌ |
| PWA-02 | public prefixes include PWA assets | unit | `npx vitest run tests/auth/public-paths.spec.ts` | ✅ (extend) |
| PWA-05 | spec 6 (deployment id change → toast; dirty form blocks reload); `/api/session-status` auth + no-store | e2e + unit | `tests/e2e/pwa/06-update.spec.ts`, `tests/api/session-status.spec.ts` | ❌ |
| PWA-03 | spec 8 (no h-scroll 360/375/744/800/820/1180; bottom bar < 768; targets ≥ 44) | e2e | `tests/e2e/pwa/08-layout.spec.ts` | ❌ |
| PWA-04 | spec 10 (iPadOS UA → iOS sheet) | e2e (WebKit) | `tests/e2e/pwa/10-ipados.spec.ts` | ❌ |
| AI-02 | L1-R4/R5/R6 pass with new chip files | static | `npm run ci:ai-l1` | ✅ |
| P2-02/PWA-09 | route-JS report; LHCI report | CI nightly | `node scripts/ci/route-js.mjs`; `lhci autorun` | ❌ |

### Sampling rate
Per task commit: typecheck + touched unit specs. Per wave: `npm run test:db`, `npm run e2e:build && npm run e2e:pr`. Phase gate: two full runs via `node scripts/phase-evidence.mjs .planning/phases/06-design-system-pwa-shell/evidence 2` + CI run id, 0 retried.

### Wave 0 gaps
`tests/design/`, `tests/e2e/design/`, `tests/e2e/pwa/` dirs; a `pwa` fixture that opts into `serviceWorkers: "allow"` and keeps the blocked-host check; `NEXT_DEPLOYMENT_ID` in the e2e build env allowlist (`tests/e2e/support/app-env.ts`); `scripts/ci/route-js.mjs`; screenshot-diff helper for 06-01a.

## Security Domain

| ASVS | Applies | Control |
|---|---|---|
| V2 Authentication | yes | `hardSignOut()` over `POST /auth/signout` (same-origin, POST-only, Clear-Site-Data) |
| V3 Session management | yes | every exit path purges; idle sign-out hook (wired in V2-11); `no-store` on authenticated responses |
| V4 Access control | yes | `/api/session-status` authenticates and derives tenant from the session; nav from `navForRole`; public paths explicit and minimal |
| V5 Input validation | yes | zod on any new route; no user input to SW |
| V8 Data protection | yes | PWA §4 D-1…D-8: no PHI in Cache Storage/IDB/localStorage; `<title>` without patient names on shared screens |
| V14 Configuration | yes | `/sw.js` headers; SW scope `/`; CSP directives deferred to V2-14 |

| Threat | STRIDE | Mitigation |
|---|---|---|
| SW caches PHI (HTML/RSC/API) | Information disclosure | positive allowlist; cache-audit spec 5 in PR lane; adversarial review of any `sw.js` diff |
| Precache stores a login/billing redirect | Tampering/DoS | `credentials:"omit"`, refuse `redirected`/`!ok` |
| Stale tablet keeps working after lock | Elevation | DB enforcement (V2-05) + poll + `SUBSCRIPTION_LOCKED` handler |
| Sign-out leaves state on shared device | Info disclosure | purge + `location.replace`; spec 5 per exit path; offline fallback local signOut |
| Public PWA paths widen default-deny | Elevation | exact-path prefixes, both raw and normalised checks already in `pageNeedsSession` |
| Malicious SW update | Tampering | same-origin, `script-src 'self'`, `no-store` |

---

## PO Actions
1. **G2-D sign-off (D-1).** Read `.planning/sketches/v2-dx-evidence/README.md` (~45–60 min), answer the 8-item checklist above, approve or request changes; Claude records the verbatim answer in the G2-D row of `docs/v2/VERIFICATION_LOG.md` and updates `.planning/PO-ACTIONS.md`.
2. **Optional:** arrange 1–2 clinic users to view the prototypes (PO-13) — not required for G2-D.
3. **G3 (later):** approve the V2-06 screenshot set at 360/820/1180/1280.
Nothing else external: no domain (manifest uses relative URLs; `id: "/"`), no font licence (OFL), no Vercel step (Skew Protection is checked at V2-15), no device purchase (PWA-10 runs after V2-08).

## Open Questions (with recommended CTO rulings)
1. **Build primitives' behaviour before G2-D?** R5 is literal ("before any primitive is built"). *Ruling:* respect R5; start V2-DX now (parallel with V2-04/05, docs only) so G2-D lands before V2-06 begins; Wave A covers any slip. Changing R5 would need the PO.
2. **Split 06-01 and 06-04.** *Ruling:* adopt 06-01a/06-01b and 06-04a/06-04b as above; add **06-08** close-out (React Compiler rules → error, guards, G3 evidence, carry-overs: dropdown focus management (03-12b) is closed by Radix DropdownMenu; client error capture R-29).
3. **Client error capture (R-29).** *Ruling:* in 06-04a, `error.tsx` reports via a server action that records only `errorTag` + digest + route template (no message text) to the existing sink; adversarial review.
4. **Fonts.** *Ruling:* `next/font/local` with vendored Plex (Sans 400/500/600 Latin; Devanagari only on public/print routes); V2-DX's glyph check decides whether ₹ needs a fallback face.
5. **Bundle budgets vs Turbopack floor (128.8 kB).** *Ruling:* keep PWA §3.9 numbers as V2-15 targets, report-only now, report "route-specific JS beyond the framework root" alongside totals; revisit budgets at V2-15 with evidence (needs PO only if a budget changes).
6. **LHCI dependency.** *Ruling:* add `@lhci/cli` as an exact-pinned devDependency (release ≥ 7 days old), nightly only, filesystem upload, host-resolver lockdown; human-verify checkpoint per the SUS verdict.
7. **themeColor in light and dark** (DESIGN_SYSTEM §4.6) vs light-only (§2.4, PRD). *Ruling:* light only, `#FFFFFF`.
8. **URL renames (`/today`, `/schedule`, …) and `ui_v2` flags (FMP M3).** *Ruling:* no flags (PO-15); V2-06 keeps v1 URLs inside the new shell; IA URLs and redirects arrive with each workflow phase (Today in V2-08), keeping M0 specs stable.
9. **AI colour token.** DESIGN_SYSTEM reserves violet for billing state and blue for info/focus. *Ruling:* V2-DX proposes a dedicated `ai-*` family (or a neutral chip with the sparkle as the only marker) with contrast proof; the PO picks at G2-D.
10. **AI-16 help search/vitals flags.** *Ruling:* defer to V2-09b (roadmap allows "V2-06 / V2-09b"; vitals flags belong to the consult rebuild).
11. **`experimental.useOffline`.** *Ruling:* off in V2-06; re-evaluate after V2-07 idempotency.

## Order, Sizes, Risks

**Now (parallel with V2-04/V2-05, separate worktree):** V2-DX (M): DX-01 S → DX-02 S–M ∥ DX-03 S–M → DX-04 S → design review → DX-05 → G2-D.

**V2-06 (L, ~9 plans):**
| Wave | Plan | Size | Depends on |
|---|---|---|---|
| A | 06-07 route-JS report + M0 report fix + LHCI nightly | S | — |
| A | 06-05 manifest, icons (provisional OK), public paths, SW, `/offline`, `hardSignOut`, specs 1–5, 11 | M | V2-05 locked pages (spec 1 locked-user case) |
| A | 06-06 install UX, update toast, skew guard, `/api/session-status`, `SUBSCRIPTION_LOCKED` client, specs 6, 10 | S–M | 06-05; V2-05 `tenant_access_level` |
| A | 06-01a token architecture + value-neutral codemod + report-mode guards | S–M | — |
| A | 06-04a route states, `dvh`/safe-area utilities, R-29 | S | 06-01a |
| B | 06-01b approved values, Plex local fonts, `en-IN`, AI/Smart Assist chips | S | **G2-D** |
| B | 06-02 primitives (2a–2d) + PWA-07 + `/dev/ui` | L | G2-D, 06-01b |
| B | 06-03 clinical components (2e) | M | 06-02 |
| B | 06-04b shell, `navForRole`, palette, toasts, spec 8 | M | 06-02, 06-03 |
| B | 06-08 close-out (lint rules → error, guards report, screenshot set, G3) | S | all |

**Risks:** G2-D slips (mitigated by Wave A); codemod mis-maps semantics (screenshot diff + per-file review); SW caches PHI (allowlist + spec 5 + adversarial review); budget numbers misread across bundlers (record method); LHCI flakiness in nightly (report-only, not a gate); React Compiler rules block 06-08 (per-file waivers with owner/expiry, like the AI-L1 allowlist); one-person capacity (Wave A and B are sequential inside the phase per PO-18).

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | Turbopack's `next/font/google` fetch bypasses the Node socket guard (outbound from the e2e build) | Stack, Pitfall 3 | Low: the recommendation (local fonts) holds either way |
| A2 | IBM Plex Sans Latin subset includes ₹ (U+20B9) — unconfirmed | Pitfall 3, V2-DX glyph check | Fallback face needed for money |
| A3 | With `serviceWorkers: "allow"`, Chromium SW requests may bypass `context.route` | Pitfall 12 | Network-block guarantee weaker for PWA specs |
| A4 | `Clear-Site-Data: "cache"` and Set-Cookie deletions apply when `/auth/signout` is called via `fetch(..., {redirect:"manual"})` | Pattern 6 | If not, fall back to the form POST navigation + client purge before submit |
| A5 | Next sets `private, no-cache, no-store` on dynamically rendered pages by default (D-4) | Security | Add explicit headers in proxy for authenticated HTML/RSC |
| A6 | `@theme inline` keeps `var()` references so semantic utilities track raw-palette edits | Pattern 1 | Value swap needs a rebuild only (no runtime theming is required anyway) |
| A7 | Supabase browser auth cookies are JS-readable, so the offline fallback `signOut({scope:"local"})` clears them | Pattern 6 | Offline sign-out leaves cookies until next online request |

## Sources

### Primary (HIGH)
- Repo files read this session: `app/globals.css`, `app/layout.tsx`, `app/(dashboard)/layout.tsx`, `app/auth/signout/route.ts`, `components/layout/user-dropdown.tsx`, `lib/auth/public-paths.ts`, `proxy.ts`, `next.config.ts`, `package.json`, `playwright.config.ts`, `tests/e2e/fixtures.ts`, `tests/e2e/support/{build,app-env}.ts`, `scripts/m0-baseline-report.mjs`, `scripts/ci/ai-l1-greps.mjs` + allowlist, `.next/build-manifest.json` + client-reference manifests, M0 baseline README, `03-06-NEXT16.md` + evidence, `03-12b-SIGNOUT-OA5.md`, `05-PLAN.md` (05-10b), roadmap §1.2/§4/§5/§12.2/§16, DESIGN_SYSTEM, PWA_STRATEGY, FRONTEND_MIGRATION_PLAN, INFORMATION_ARCHITECTURE, UX_AUDIT §5, AI_STRATEGY §5.3, VERIFICATION_LOG (R5, O7), PO-ACTIONS D-1.
- Version-matched Next 16.4.6 docs: `node_modules/next/dist/docs/01-app/02-guides/{progressive-web-apps,offline-support,package-bundling}.md`, `.../next-config-js/deploymentId.md`.
- npm registry (`npm view`, 2026-11-13) and the GSD package-legitimacy seam.

### Secondary (MEDIUM)
- [Serwist: Next.js + Turbopack](https://serwist.pages.dev/docs/next/turbo) — `@serwist/turbopack`, route-handler build, `esbuild`, precache entries; no Next 16 statement.
- [Vercel commit "Remove JS size reporting from next build" (#83815)](https://app.semanticdiff.com/gh/vercel/next.js/commit/18e7c84af25c69c7807026a9044819ace1780abb); [Catchmetrics: lost bundle-size visibility](https://www.catchmetrics.io/blog/nextjs-developers-lost-bundle-size-visibility).
- [Next.js 16.1 blog (analyzer)](https://nextjs.org/blog/next-16-1).

### Tertiary (LOW)
- [IBM Plex (Wikipedia)](https://www.wikipedia.org/wiki/IBM_Plex), [Fontsource IBM Plex Sans](https://fontsource.org/fonts/ibm-plex-sans/about) — no ₹ confirmation found.

## Metadata
- Standard stack: HIGH (registry + repo); LHCI MEDIUM (flagged too-new).
- Architecture: HIGH (built on read code and version-matched docs).
- Pitfalls: HIGH for 4–8, 14–16 (read code); MEDIUM for 12–13.
- Research date: 2026-11-13. Valid until: 2026-12-13 (Next 16.x and LHCI move fast; re-check versions at plan time).
