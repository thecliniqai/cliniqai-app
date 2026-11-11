# clinicOS v2.0 — Frontend Technology Assessment (Workstream B2)

| | |
|---|---|
| Date | 2026-11-10 · discovery only. **Nothing was installed or changed.** |
| Decision requested | Approve the component foundation, framework stance and supporting libraries below before any implementation (prompt §B2, §15). |
| Related | `UX_AUDIT.md` (evidence), `DESIGN_SYSTEM.md` (what we build), `FRONTEND_MIGRATION_PLAN.md` (how) |

Labels: **Fact**, **Problem**, **Risk**, **Assumption (validate)**, **Recommendation** · P0–P3 · Sizes S/M/L/XL (relative; no day estimates).

---

## 1. Current frontend foundation (facts)

| Area | v1 state | Evidence |
|---|---|---|
| Framework | Next.js App Router, `next@15.5.27` installed (`^15.2.1` declared), React 19.3, TypeScript 5.8 | `package.json`, `node_modules/next/package.json` |
| Styling | Tailwind CSS v4.3 (`@tailwindcss/postcss`), a single `globals.css` with `@theme` brand scale + unused `:root` variables | `app/globals.css` |
| Components | 12 hand-rolled primitives in `components/ui`, visually derived from the TailAdmin free template. No headless library. | `components/ui/*`, `docs/temp/free-nextjs-admin-dashboard-main` |
| Utilities | `clsx`, `tailwind-merge`, `lucide-react` | `package.json` |
| Forms | Manual `useState` + `onSubmit` + imperative server-action calls. zod 3 on the server only. | 37 `onSubmit`, 0 `useActionState` (UX_AUDIT §2) |
| Data fetching | Server Components query Supabase directly in pages. Mutations via server actions + `revalidatePath` (94 calls) + `router.refresh()` (14). No client cache. | `features/*/actions.ts` |
| Realtime | None (0 `.channel(` uses). Notifications poll every 30 s. | `components/notifications/use-notifications.ts:14` |
| Dates | `toLocale*` with mixed locales. 29 UTC "today" computations. No date library. | UX_AUDIT §2 |
| Tables | Hand-rolled `<table>`, no sorting or pagination, full-tenant fetch on `/patients` | `app/(dashboard)/patients/page.tsx:32-35` |
| Charts | None in app code. TailAdmin's ApexCharts was not carried over. | |
| PDF | `@react-pdf/renderer` used **server-side only** (route handlers and `features/*/pdf`). 0 client imports. | `grep @react-pdf components app` → none |
| AI UI | `@ai-sdk/react` `useChat`, statically imported into the global header | `components/layout/app-header.tsx:9`, `components/ai/operations-copilot-drawer.tsx:4` |
| Tests for UI | No component-render tests. No e2e specs (`tests/e2e` absent). Playwright configured for Desktop Chrome + Pixel 5. | `playwright.config.ts` |

> Verification (2026-11-10): PARTIALLY_CONFIRMED — FTA-perf: confirmed; one static-markup render test exists; component sizes exact (1,681 and 1,029 lines). Characterisation e2e P1, lazy-load P2. See VERIFICATION_LOG.md

### 1.1 Why the current foundation is insufficient

1. **Accessibility cannot be reached by patching.** Focus trapping, roving focus, `aria-activedescendant` comboboxes, menu semantics, dismissable layers and scroll-lock stacking are hard to get right. v1 has none of them (0 focus-management code, 23 bespoke overlays, 0 tab or combobox semantics). Re-implementing them by hand across about 20 interactive patterns is the most expensive and riskiest path.
2. **No component contract, so no consistency.** Primitives are thin class wrappers that call sites routinely override: 254 raw `<button>` vs 153 `<Button>`, 28 raw `<select>` vs 2 `<Select>`. There are no variants API, no composition model (`asChild`) and no tokens wired into components. The result is 937 arbitrary hex values.
3. **Missing primitives for the product's core interactions.** There is no Combobox (drug, ICD and patient search), Command palette, Date picker, Popover, Tooltip, Toast, Tabs, Sheet or bottom Drawer. Each was rebuilt ad hoc, sometimes several times.
4. **Template lineage.** TailAdmin is a marketing-grade admin skin: metric tiles, uppercase micro-labels, card-in-card. It is not a product system. Its newer versions also moved to Next 16 and `next-intl` (`docs/temp/free-nextjs-admin-dashboard-main/package.json`), so "staying close to the template" has no ongoing value.

**What is worth keeping:** Next.js App Router, React 19, Tailwind v4, lucide, `clsx`/`tailwind-merge`, the server-action mutation model, server-side PDF, and specific domain components' *logic* (`PhoneInput` normalisation, `AgeDobInput`, scheduling utilities, AI cards' behaviour).

---

## 2. Component foundation options

### 2.1 Options evaluated

| ID | Option | Summary |
|---|---|---|
| A | **Status quo**: hand-rolled Tailwind primitives | Keep `components/ui`, extend it by hand |
| B | **shadcn/ui (open code) on Radix primitives + Tailwind v4** | CLI copies component source into the repo. Radix provides behaviour and a11y. Styling is ours. |
| C | **shadcn/ui pattern on Base UI primitives** | Same open-code model. Primitives from Base UI (by the original Radix/MUI authors). |
| D | **React Aria Components (Adobe) + Tailwind** | Headless, best-in-class a11y and i18n, including date/time fields |
| E | **Material UI (MUI)** | Full styled library, Material Design |
| F | **Ant Design** | Full enterprise styled library |
| G | **Mantine** | Full styled library with hooks, dates and forms |

### 2.2 Scoring against the 10 B2 criteria

Score 1–5 (5 = best for clinicOS). For criterion 10, 5 means the least migration effort and the best fit with the current Tailwind/Next stack.

| Criterion | A Hand-rolled | B shadcn + Radix | C shadcn + Base UI | D React Aria | E MUI | F AntD | G Mantine |
|---|---|---|---|---|---|---|---|
| 1 Design flexibility | 4 | **5** | 5 | 5 | 2 | 1 | 3 |
| 2 Accessibility | 1 | 4 | 4 | **5** | 4 | 3 | 4 |
| 3 Component quality / coverage | 2 | 4 | 4 | 4 | **5** | 5 | 5 |
| 4 Responsive capabilities | 3 | 4 | 4 | 4 | 4 | 3 | 4 |
| 5 Developer experience | 2 | **5** | 4 | 3 | 4 | 4 | 5 |
| 6 Maintainability (we own the code / API stability) | 2 | **4** | 4 | 4 | 4 | 4 | 4 |
| 7 Performance / bundle | 4 | 4 | 4 | 4 | 2 | 2 | 3 |
| 8 Ecosystem maturity | 1 | **5** | 3 | 4 | 5 | 5 | 4 |
| 9 Long-term sustainability | 2 | 4 | 4 | **5** | 5 | 4 | 4 |
| 10 Migration effort / stack compatibility | **5** | 4 | 4 | 3 | 2 | 2 | 2 |
| **Total (/50)** | 26 | **43** | 40 | 41 | 37 | 33 | 38 |

**Rationale by criterion**

- **Design flexibility.** B, C and D are unstyled, so our "Clinic Paper" system is fully expressible. MUI and AntD impose a visual language (Material, Ant enterprise) that conflicts with B3 "avoid generic dashboards". Overriding it costs more than building it. Mantine is themeable but CSS-Modules-based, so it runs parallel to Tailwind.
- **Accessibility.** React Aria leads: interactions, i18n-aware date and number fields, virtual focus, extensive screen-reader testing. Radix and Base UI are strong for dialog, menu, popover, tabs and select. Combobox and date fields need extra libraries (cmdk, react-day-picker). AntD has known gaps in some complex widgets.
- **Ecosystem.** shadcn/ui on Radix has the largest Tailwind-native ecosystem: blocks, community components, docs, and LLM-assistant familiarity, which matters for a small team using AI-assisted development. Base UI is newer.
- **Performance.** Headless + Tailwind adds roughly a few kB per primitive and no runtime CSS-in-JS. MUI (Emotion) and AntD (CSS-in-JS tokens) add runtime styling cost, which hurts on low-end Android.
- **Sustainability.**
  - **Risk:** Radix's pace of development slowed after its acquisition, and several Radix authors moved to Base UI. **Assumption (validate at spike):** check current Radix release cadence and whether the shadcn CLI offers Base UI as an alternative primitive set.
  - This risk is **mitigated by the open-code model**: we own every component file, so the primitive under a single component can be swapped (Radix → Base UI or React Aria) without touching call sites.
- **Migration.** B, C and D all keep Tailwind v4 and our tokens, so they coexist with v1 screens during a strangler migration. E, F and G introduce a second styling system, theme provider and global CSS reset. That means a big-bang or long dual-system period.

### 2.3 Recommendation (P1)

**Adopt option B: shadcn/ui open-code components on Radix primitives, styled with the v2 Tailwind tokens.** Use targeted best-of-breed headless libraries where Radix has no primitive:

| Need | Choice | Why |
|---|---|---|
| Dialog, AlertDialog, Popover, DropdownMenu, Tabs, Tooltip, Checkbox, RadioGroup, Switch, Select (desktop custom) | Radix via shadcn/ui | Mature a11y. Open code. |
| Command palette, Combobox | `cmdk` (shadcn `Command`) | De-facto standard. Used for patient, drug and ICD search. |
| Date picker / calendar | `react-day-picker` (shadcn `Calendar`) + our segmented `DateField` | Lightweight. date-fns based. `en-IN` week and labels. |
| Toasts | `sonner` (shadcn `Sonner`) | Accessible, small, supports actions (Undo). |
| Bottom drawer (phone) | Radix Dialog styled as a bottom sheet (no extra dependency). Drag-to-dismiss optional. | **Risk:** `vaul` (shadcn's default Drawer) has had maintenance-status concerns. Avoid a hard dependency. |
| Data table | `@tanstack/react-table` (headless) | Sorting, pagination and column state for registers. Server-side pagination. |
| Animations | `tw-animate-css` (Tailwind v4 replacement for `tailwindcss-animate`) or plain CSS transitions | Also makes the 16 currently dead `animate-in` classes meaningful, or they are deleted. |
| Icons | `lucide-react` (keep) | Already used. Tree-shaken. |

**Fallback.** If the M2 spike finds Radix gaps or a stalled release cadence, build the same shadcn-pattern components on **Base UI** (option C). For the date/time and number fields specifically, **React Aria** hooks are an accepted per-component exception. The `components/ui` API stays identical.

**Not recommended:**

- **A (status quo):** cheapest today, most expensive over the product's life. It does not meet B4/B5 accessibility and consistency goals.
- **E, F, G (styled suites):** fight the bespoke healthcare visual language, add a parallel styling runtime and force a big-bang migration.

---

## 3. Framework: does Next.js App Router stay?

| Criterion | **Next.js App Router (stay, upgrade)** | Vite SPA + React Router 7 | React Router 7 framework mode (Remix) | TanStack Start |
|---|---|---|---|---|
| 1 Design flexibility | 5 | 5 | 5 | 5 |
| 2 Accessibility | 4 (route announcer, focus on nav) | 3 | 4 | 3 |
| 3 Component/rendering quality | 5 (RSC, streaming, Suspense) | 3 | 4 | 4 |
| 4 Responsive / perceived perf on mobile | 4 (server render, small client JS if disciplined) | 2 (large initial JS, waterfalls on 4G) | 4 | 4 |
| 5 DX | 4 | 4 | 4 | 3 |
| 6 Maintainability | 4 | 3 | 4 | 3 |
| 7 Performance / bundle | 4 | 3 | 4 | 4 |
| 8 Ecosystem maturity | 5 | 5 | 4 | 2 |
| 9 Long-term sustainability | 4 | 4 | 4 | 3 |
| 10 Migration effort | **5** (in place) | 1 (rewrite data layer: about 110 server-action functions become an HTTP API, auth cookie flow changes) | 2 (rewrite routing + data) | 1 |
| **Total** | **44** | 33 | 39 | 32 |

**Facts supporting staying:**

- About 110 exported async functions across 24 `"use server"` modules in `features/` already form the mutation layer, with permission guards (`lib/permissions/guards.ts`).
- Supabase SSR cookies via `@supabase/ssr` and `middleware.ts`.
- Server-only PDF and S3 work in route handlers.
- A public REST API under `app/api/v1` for integrations.

An SPA would need all of that rebuilt as a client-callable API and would ship more JS to low-end devices.

**Recommendation (P1).** **Keep the Next.js App Router.** The problems are in UI architecture, not the framework. Upgrade to the current patched Next major before or alongside M1, coordinated with Workstreams D and F, because `npm audit` reports a critical or high issue on `next` (shared brief). Doing both together avoids migrating the UI twice.

- **Assumption (validate):** Next 16 is the current stable line. The vendored TailAdmin already targets `next@^16.3.4` and uses `src/proxy.ts`, which suggests the `middleware` → `proxy` rename. Our `middleware.ts` would need that change, so check the official upgrade guide at upgrade time.

**Server-action caveats** (design around them, do not abandon them):

1. Server actions are executed **sequentially per client** and are POST-only. They are a poor fit for **typeahead search**. Use a cacheable `GET` route handler with `AbortController` for search and slot lookups.
2. Server actions are public HTTP endpoints. Every one must authorize. This is already the pattern via `requirePermission`, and Workstream D verifies it.
3. Composite business operations (walk-in, collect payment) should be **one action calling one DB transaction or RPC**, not several actions chained from the browser (UX_AUDIT F-03).

---

## 4. Forms

| Option | Pros | Cons | Fit |
|---|---|---|---|
| Native `<form action>` + `useActionState` + zod on the server | Progressive enhancement, zero client lib, idiomatic React 19 | Weak for dynamic field arrays (Rx lines, invoice lines), dirty tracking, inline async validation, complex conditional UI. Errors are only shown after a round-trip. | Good for simple settings forms |
| **react-hook-form + zod (`@hookform/resolvers`) submitting to server actions** | Mature, performant (uncontrolled), field arrays, `formState.isDirty` (unsaved guard, autosave), per-field async validation (dedup check), shadcn `Form` integration wires `aria-describedby` and `aria-invalid` | One more client dependency (~10 kB gz). Two-way error mapping from the server result. | **Best for clinicOS** (booking, registration, vitals, consult, collect) |
| Conform | Server-action-first, progressive enhancement, zod | Smaller ecosystem. Less familiar. | Viable alternative |
| TanStack Form | Type-safe, modern | Younger. Less shadcn integration. | Not now |

**Recommendation (P1).** Use **one pattern everywhere: react-hook-form + zod**. Schemas live in `features/<domain>/schema.ts` (already the convention) and are imported by both the client form and the server action. Server actions return a typed `{ ok: true, data } | { ok: false, formError?, fieldErrors? }`, mapped with `setError`. Native `useActionState` is allowed only for trivial single-field forms, such as login OTP.

- **Dependency:** coordinate the **zod 3 → 4** upgrade (audit finding in the shared brief) *before* writing shared schemas. Then forms are written once on zod 4. `@hookform/resolvers` supports zod 4 in current versions. **Assumption:** verify at install.

---

## 5. Data fetching, caching and realtime

| Need | Recommendation | Why not more |
|---|---|---|
| Page reads | **React Server Components** (as today), with `Suspense` + `loading.tsx` and parallel fetches (`Promise.all`) instead of sequential awaits | Already works. Least JS. |
| Mutations | Server actions → `revalidatePath`/`revalidateTag` + **optimistic UI** (`useOptimistic`) for queue transitions and chips | React 19 built-in |
| Typeahead (patients, drugs, ICD) | `GET` route handlers + a small `useSearch` hook (debounce 200 ms, `AbortController`, stale-result guard) | Avoids server-action serialisation |
| **Live Today board** | **Supabase Realtime** (`postgres_changes` on `visits` and `queue_tokens`, tenant + date filter). On event, patch local state from the payload, or refetch the board slice from a route handler. Fallback: poll every 15 s. Show the connection state. | Requirement F-02. **Risk:** Realtime + RLS behaviour must be validated by Workstreams C and D (tenant isolation of change events). |
| Client cache library (TanStack Query) | **Not adopted initially. Decision gate at M4** | RSC + actions cover most reads. Adopt TanStack Query only if, after the Today and Search spikes, 3 or more surfaces need client-side caching, background refetch or offline persistence (e.g. PRD §5.2 offline-tolerant queue). |
| Offline drafts (consult) | ~~IndexedDB via `idb-keyval`~~ **Rejected for v2.0** (`PWA_STRATEGY.md` §4: no PHI on the device). Consult drafts use server autosave (≤ 5 s) plus an in-memory buffer (erratum 2026-11-10, PWA §12) | Clinical data on shared devices is the reason for rejection. |

---

## 6. Tables, dates, charts, PDF, misc

| Area | Recommendation | Notes |
|---|---|---|
| Tables | `@tanstack/react-table` (headless) for DataTable on ≥ lg. Same column defs render DataList on mobile. **Server-side** pagination, sorting and filters (URL state). | Patients, visits, referrals, collections registers |
| Dates | **`Intl.DateTimeFormat` for formatting** (zero-cost, `en-IN`) + **`date-fns` v4 + `@date-fns/tz`** for arithmetic in the clinic time zone. One `lib/datetime.ts` module. | Fixes 29 UTC "today" sites. `react-day-picker` already depends on date-fns. Temporal is not yet broadly available in browsers, and the polyfill is heavy. |
| Money | `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`, integer paise | `lib/money.ts` |
| Charts | **None at first.** Reports use tables + inline SVG sparklines. If needed later, shadcn Charts (Recharts) **lazy-loaded on `/reports` only**. | Avoid shipping ~100 kB chart libraries to the front desk |
| PDF | **Keep `@react-pdf/renderer` server-side** for WhatsApp/PDF delivery. Add an **`@media print` stylesheet** for in-clinic printing (faster, no PDF round-trip). | Existing route handlers `app/api/visits/[id]/prescription-pdf`, `app/api/invoices/[id]/receipt-pdf` |
| AI UI | **Lazy-load** the Copilot drawer and AI scribe (`next/dynamic`, `ssr:false`) on first open | Removes `@ai-sdk/react` from every page's initial JS (`components/layout/app-header.tsx:9`) |
| Fonts | `next/font/google` (self-hosted at build): IBM Plex Sans / Devanagari / Mono | Inter is declared but never loaded today |
| Icons | `lucide-react` (keep) | |
| i18n | Not now. Keep strings in `messages/en.ts`. `next-intl` if Hindi is approved (P3). | |
| Component gallery | Internal `/dev/ui` route (dev/preview only) rather than Storybook | Less tooling. Playwright screenshots it. Revisit Storybook if the team grows. |
| React Compiler | Optional P3 experiment after M5 | Not needed to fix UX issues |

---

## 7. Dependencies (proposed; **install only after approval**)

| Add | Purpose | Approx. weight (gz, indicative) |
|---|---|---|
| `radix-ui` (or per-package `@radix-ui/react-*`) | Primitives | Per-component, ~3–10 kB each |
| `class-variance-authority` | Variant API used by shadcn components | ~1 kB |
| `cmdk` | Command palette, combobox | ~5 kB |
| `sonner` | Toasts | ~4 kB |
| `react-day-picker`, `date-fns`, `@date-fns/tz` | Calendar, date arithmetic | Tree-shaken |
| `react-hook-form`, `@hookform/resolvers` | Forms | ~10 kB |
| `@tanstack/react-table` | Tables | ~15 kB (registers only) |
| `tw-animate-css` | Enter/exit transitions | CSS only |
| dev: `@axe-core/playwright` | Automated a11y in e2e | dev only |
| dev: `eslint-plugin-jsx-a11y` (if not fully covered by `eslint-config-next`) | Static a11y lint | dev only |

Keep: `next`, `react`, `tailwindcss`, `lucide-react`, `clsx`, `tailwind-merge`, `zod` (upgrade), `@react-pdf/renderer`, `ai`/`@ai-sdk/*`.

Remove after migration: nothing third-party. Delete dead `components/dashboard/nav.tsx`. The TailAdmin source in `docs/temp/` can be removed from the repo once v2 visuals ship (not a runtime dependency).

**Assumption (validate).** The sizes above are indicative from public package data, not measured here. Measure real route bundles after M2 with `next build` output and `@next/bundle-analyzer` (UX_AUDIT OI-UX-3). **Budget:** the Today and consult routes should stay ≤ 200 kB gz first-load JS on a mid-range Android device. Validate the budget against an M0 baseline.

---

## 8. Migration complexity, risks, effort

| Item | Complexity | Size | Notes |
|---|---|---|---|
| Next.js upgrade to patched major (with Workstreams D/F) | Medium (middleware → proxy rename, caching defaults, async APIs already used) | M | Do first. Separate PR. |
| zod 3 → 4 | Low–medium (API changes in error formatting) | S–M | Before shared form schemas |
| Tokens + fonts + `lib/datetime` / `lib/money` | Low | S | M1 |
| shadcn/Radix primitives + clinical components | Medium | L | M2. Adapter props keep v1 call sites working during migration. |
| Shell + IA + palette + redirects | Medium | M | M3 |
| Workflow rebuilds (Today, register, booking, consult, collect, profile) | High (business logic preserved; backend RPCs needed) | XL total | M4, in priority order |
| Cleanup + palette reset + lint gates | Low | S | M5 |

**Risks**

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| R1 Radix maintenance slows | Medium | Medium | Open-code components. Per-component swap to Base UI or React Aria behind the same API. |
| R2 Visual regressions while old and new coexist | High | Medium | Feature-flagged routes, screenshot tests per route, token-mapped v1 colours in M1 so old screens shift toward v2 colours early |
| R3 Behaviour regressions in complex flows (consult 1,681 lines, checkout 1,029 lines) | High | High | Characterisation e2e tests on v1 flows **before** rebuilding (needs a local Supabase from Workstream E). Port logic, not markup. |
| R4 Backend RPCs not ready (atomic walk-in or collect) | Medium | High | Sequence workflow rebuilds after the related RPCs. The UI can ship with the existing action chain behind the same interface, but the F-03 fix still waits for the backend. |
| R5 Realtime + RLS tenant leakage | Low–medium | Critical | Workstream D sign-off. Use private channels or RLS-respecting `postgres_changes` filters. Test with two tenants. |
| R6 Team unfamiliar with RHF/Radix | Low | Low | shadcn conventions are widely documented. Pair on the first 3 components. |
| R7 Bundle growth | Medium | Medium | Budgets in CI. Lazy AI and reports. Measure per route. |

---

## 9. Decision summary (for product-owner approval)

| # | Decision | Recommendation | Priority |
|---|---|---|---|
| D1 | Component foundation | **shadcn/ui open-code on Radix + Tailwind v4 tokens.** Base UI or React Aria per component as fallback. | P1 |
| D2 | Framework | **Keep Next.js App Router.** Upgrade to the patched current major first. | P1 |
| D3 | Forms | **react-hook-form + zod (v4), shared schemas**, server actions as the submit target | P1 |
| D4 | Data | RSC reads + server actions + optimistic UI. **GET route handlers for search.** **Supabase Realtime** for Today. TanStack Query deferred behind a decision gate. | P1 |
| D5 | Tables | TanStack Table (headless), server pagination | P2 |
| D6 | Dates / money | Intl + date-fns/tz, `lib/datetime`, `lib/money` (paise) | P1 |
| D7 | Charts | None initially. Lazy Recharts if needed. | P3 |
| D8 | PDF / print | Keep server react-pdf. Add print CSS. | P2 |
| D9 | Component gallery | `/dev/ui` route + Playwright, not Storybook | P2 |
| D10 | Visual identity | "Clinic Paper": teal, warm neutrals, IBM Plex (see `DESIGN_SYSTEM.md`) | P1 |

> Verification (2026-11-10): PARTIALLY_CONFIRMED — FTA-D2: the vulnerabilities are fixed by a non-breaking 15.5.x patch (P0); Next 16 is optional modernisation (P2); zod 4 is tied to the AI SDK major (P1). See VERIFICATION_LOG.md
