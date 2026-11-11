# clinicOS v2.0 — PWA Strategy (installable web app on phones and tablets)

| | |
|---|---|
| Date | 2026-11-10 · planning only, no code changed |
| Requirement | PO new requirement #5 (2026-11-10): no native apps at launch. The web app must work as an installable PWA ("Add to Home Screen") seamlessly on all phones and tablets, Android and iOS/iPadOS. |
| Settled context | v1 is not live. Production is a new Supabase project. Go-live happens only after all of v2 is finished (PO-15), so no v1/v2 coexistence or per-clinic PWA flag is needed. Team = PO + Claude; Claude makes reversible technical calls and runs independent reviews through isolated reviewer agents (PO-10 to PO-18). Stack = Next.js App Router + Supabase + Vercel, Tailwind v4. shadcn/Radix primitives are *proposed* in `FRONTEND_TECHNOLOGY_ASSESSMENT.md` (not yet approved at G2). |
| Related | `AUTH_REDESIGN.md` §3.2–§3.6, `SUBSCRIPTIONS_AND_PLANS.md` §5–§7, `AI_STRATEGY.md` §0 / A6, `DESIGN_SYSTEM.md` §4.2, `INFORMATION_ARCHITECTURE.md` §3.3, `UX_AUDIT.md` §5.0 / F-12, `FRONTEND_MIGRATION_PLAN.md` M1–M5, `TEST_STRATEGY.md`, `SECURITY_ASSESSMENT.md` SEC-13, `DATA_HANDLING.md`, `V2_MASTER_ROADMAP.md` §12 |

Labels: **Fact**, **Problem**, **Risk**, **Assumption (validate)**, **Recommendation**, **Open question**. Priorities P0–P3. Sizes S/M/L/XL are relative. External facts were accessed on 2026-11-10; anything not confirmed from a primary source is marked *(unconfirmed)*.

---

## 0. Summary

- **Fact:** today the app has no PWA support at all: no manifest, no icons, no `public/` directory, no service worker, no `viewport` or `themeColor` export, and no Apple web-app metadata (§1).
- **Recommendation (P1):** build a deliberately small PWA:
  - Next.js built-in `app/manifest.ts` plus file-convention icons.
  - A hand-written service worker of about 100 lines, rather than Serwist or next-pwa. It caches only hashed static assets and one offline page.
  - Safe-area-aware, standalone-aware shell, with tablet two-pane layouts.
  - Install prompts: a native prompt on Android and an instructions sheet on iOS.
  - An update prompt that also handles version skew.
  - Idempotent, retryable write commands so flaky networks are safe.
  - Performance budgets checked in CI.
- **Data policy (P1, §4):** v2.0 never stores PHI on the device, whether in the service worker, Cache Storage, IndexedDB, localStorage or sessionStorage. There is no persisted exception. The only allowance is keeping already-rendered data **in memory**, behind a "stale since hh:mm" banner. Every sign-out path clears caches and storage, keeping only non-identifying device preferences (D-5).
- **Sign-out and subscription lock (§4 D-5, D-8):** every exit path goes through one `hardSignOut()` helper. A subscription lock is *not* a sign-out: it hard-navigates owner/admin to `/billing/locked` and other roles to `/billing/locked/staff` (SUB §7.2, roadmap §4). Enforcement is in the database (`tenant_access_level()` / `has_entitlement()`, SUBSCRIPTIONS_AND_PLANS §7), and the client reacts to it (§6.6).
- **Push notifications:** deferred to v2.1, and then PHI-free and staff-only (§7).
- **Effort:** 11 v2.0 backlog items (7 S + 4 M) plus PWA-13 deferred to v2.1 (§14). Most land in V2-06 (frontend foundation). PWA-06 depends on V2-07 (atomic commands), as does spec 7 inside PWA-08. Verification lands in V2-15.

---

## 1. Current state (evidence)

| # | Finding | Evidence | Label |
|---|---|---|---|
| 1.1 | No web app manifest. `app/manifest.*` does not exist, and no `.webmanifest` exists anywhere outside vendored docs. | `ls app` (2026-11-10) | **Fact / Problem P1** |
| 1.2 | No `public/` directory, so there is no favicon, no `apple-touch-icon` and no 192/512 or maskable icons. | `ls public` → "No such file or directory" | **Fact / Problem P1** |
| 1.3 | Root layout exports only `title` and `description`. There is no `viewport` export (`themeColor`, `viewportFit`), no `appleWebApp`, and `lang="en"` rather than `en-IN`. | `app/layout.tsx:4-7`, `:15` | **Fact / Problem P1** |
| 1.4 | No service worker and no `navigator.serviceWorker` usage. There are no offline or online handlers (no `navigator.onLine` anywhere). | grep across `app components features lib` | **Fact** |
| 1.5 | `next.config.ts` has only `serverExternalPackages`. It sets no headers, so `/sw.js` would have no `Cache-Control` or CSP, and SEC-13 (no security headers) is still open. | `next.config.ts:3-5`, `SECURITY_ASSESSMENT.md:204-211` | **Fact** |
| 1.6 | Viewport-height layouts use `min-h-screen` (100vh). The repo has 19 occurrences. On mobile browsers, 100vh ignores the dynamic toolbar and the on-screen keyboard. | e.g. `app/(auth)/login/page.tsx:158,163`, `app/r/[token]/page.tsx:25` | **Fact / Problem P2** |
| 1.7 | The shell is a TailAdmin-style off-canvas sidebar. It switches at `lg` only and has no bottom navigation. | `components/layout/app-sidebar.tsx:148-153`, `app-layout-shell.tsx:38`; `UX_AUDIT.md` F-12 (`:60`) | **Fact / Problem P1** (already in the plan as M3) |
| 1.8 | Inputs are 14 px (`text-sm`), which triggers iOS zoom-on-focus. Only 3 `inputMode`/`enterKeyHint` uses exist in the TSX tree. | `components/ui/input.tsx:23`; grep count | **Fact / Problem P1** |
| 1.9 | **The AI copilot persists chat messages, which can contain patient names and clinical context, in `sessionStorage`.** | `components/ai/operations-copilot-drawer.tsx:63-83` | **Problem P1** (device-storage PHI; conflicts with §4). Resolved by removal: `AI_STRATEGY.md` §0 item 3 / A6 retires the ops copilot from v2.0. |
| 1.10 | Logout is client-only (`supabase.auth.signOut()` then `router.push("/login")`). Nothing clears caches, storage or the bfcache. | `components/layout/user-dropdown.tsx:19-30` | **Problem P1** (once a SW exists) |
| 1.11 | Login, invite and verify use email OTP **codes** (`verifyOtp`). The resend path also passes `emailRedirectTo`, which creates a magic link, and `app/auth/callback/route.ts:15` exchanges codes from links. | `app/(auth)/login/page.tsx:106`, `app/(auth)/verify/page.tsx:63-67` | **Risk P1** for iOS standalone (§6.4); superseded in v2 by password login (`AUTH_REDESIGN.md` §3) |
| 1.12 | Five places open signed document URLs with `window.open(..., "_blank")`. | `components/patients/patient-lab-documents.tsx:180`, `components/consultation/consultation-workspace.tsx:513`, `components/consultation/pdf-preview-modal.tsx:96`, `components/referrals/referrals-register.tsx:67`, `components/patients/patient-detail-view.tsx:277` | **Risk P2**: the behaviour differs in standalone mode (§6.5) |
| 1.13 | Playwright has only two projects, Desktop Chrome and Pixel 5, and **`tests/e2e/` does not exist**. There is no WebKit coverage. | `playwright.config.ts`; `ls tests/e2e` | **Fact / Problem P1** |
| 1.14 | The PRD requires a mobile-first product "run the entire clinic from a phone", 1–2 s responses on 3G/4G, and offline tolerance "where feasible". | `docs/clinic-management-prd.md:47`, `:170-171`, `:194` | **Fact** (requirements) |
| 1.15 | The v2 design system already specifies 44 px touch targets, 16 px inputs, `inputMode`/`enterKeyHint`, a bottom bar below 768 px, a rail at 768–1279 px and a two-pane consult at ≥1024 px. | `DESIGN_SYSTEM.md:329-342`, `:410`, `:438`, `:600`, `:694` | **Fact**: a good base, extended here |
| 1.16 | Earlier v2 docs plan **local IndexedDB drafts** for consult notes. This conflicts with §4. | `DESIGN_SYSTEM.md:527`, `:549`; `UX_AUDIT.md:730`; `FRONTEND_TECHNOLOGY_ASSESSMENT.md:172`; `FRONTEND_MIGRATION_PLAN.md:169` | **Problem P1** (doc conflict, §12) |

---

## 2. External facts (accessed 2026-11-10)

| # | Fact | Source |
|---|---|---|
| E1 | Next.js App Router has built-in manifest support (`app/manifest.ts` → `MetadataRoute.Manifest`). The official PWA guide (last updated 2026-07-30) adds web push and a hand-registered `sw.js` with `Cache-Control: no-cache, no-store, must-revalidate` and a strict CSP on `/sw.js`. For full offline caching it points to **Serwist** (with Turbopack and webpack examples). It advises **against** relying on a custom `beforeinstallprompt` button because it is not cross-browser (no iOS Safari support). | [Next.js: PWAs guide](https://nextjs.org/docs/app/guides/progressive-web-apps) |
| E2 | Next.js 16.x has an **experimental** `useOffline` hook, enabled by the `experimental.useOffline` flag, which retries blocked navigations, prefetches and Server Actions when connectivity returns. It is not available on 15.x. The docs list it as introduced in "v16.x.0". | [Next.js: useOffline](https://nextjs.org/docs/app/api-reference/functions/use-offline) |
| E3 | `next-pwa` (shadowwalker) is unmaintained. Its community fork's successor package `@ducanh2912/next-sw` is marked deprecated in favour of Serwist. Serwist 9.4+ changed its Next.js integration, adding a Turbopack path (`@serwist/turbopack`). *(Serwist's exact compatibility with the Next 15.5/16 version we pin is unconfirmed; it is not needed under this plan.)* | [Serwist docs: Turbopack](https://serwist.pages.dev/docs/next/turbo); [npm: @ducanh2912/next-sw](https://npmjs.com/package/@ducanh2912/next-sw) |
| E4 | Chrome's install criteria: HTTPS; a manifest with `name` or `short_name`, **192 px and 512 px icons**, `start_url`, and `display` set to `standalone`, `fullscreen`, `minimal-ui` or `window-controls-overlay`; `prefer_related_applications` absent or false; and user engagement (one tap plus about 30 s). Chrome fires `beforeinstallprompt` when the criteria are met. | [web.dev: install criteria](https://web.dev/articles/install-criteria) |
| E5 | Since Chrome 108 (mobile) and 112 (desktop), a service worker is **not** required to install from the browser menu. The automatic install prompt still requires a `fetch` handler. Lighthouse's **PWA category was removed** because it was tied to those criteria. Installability checks remain in DevTools. | [Chrome: Revisiting installability criteria](https://developer.chrome.com/blog/update-install-criteria) |
| E6 | PageSpeed Insights moved to Lighthouse 12.0 on 2024-05-10, with the **PWA category removed**. | [PSI release notes](https://developers.google.cn/speed/docs/insights/release_notes?hl=en) |
| E7 | Web Push works on **iOS/iPadOS 16.4+ only for Home Screen web apps**, as well as Safari 16 on macOS 13+, Chromium and Firefox. | E1 (Next.js guide) |
| E8 | **iOS/iPadOS 26:** every site added to the Home Screen opens **as a web app by default**. An "Open as Web App" toggle in the Add to Home Screen sheet can turn this off, and existing web-app features are unchanged. | [WebKit: News from WWDC25](https://webkit.org/?p=16993); [heise](https://heise.de/-10749652) |
| E9 | WebKit storage (Safari 17+/iOS 17+): a standalone Home Screen web app has the same origin and overall quotas as in the browser. The 7-day cap on script-writable storage counts days of use, and Home Screen apps have their own counter. `navigator.storage.persist()` is granted heuristically, for example when the site is opened as a Home Screen web app. *(Current 2026 numbers are unconfirmed.)* | [WebKit: Updates to Storage Policy](https://webkit.org/?p=14403); [MDN: storage quotas](https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) |
| E10 | An iOS Home Screen web app has **storage and cookies separate from Safari**. Logging in in Safari does not log you into the installed app, and the reverse is also true. *(No official Apple document was found; this is consistent across WebKit bug 181849 and practitioner reports.)* | [WebKit bug 181849](https://bugs.webkit.org/show_bug.cgi?id=181849); [Netguru](https://www.netguru.com/blog/how-to-share-session-cookie-or-state-between-pwa-in-standalone-mode-and-safari-on-ios) |
| E11 | iOS/iPadOS Safari has **no `beforeinstallprompt`**, so installing is manual through Share → Add to Home Screen. | E1; [web.dev install criteria](https://web.dev/articles/install-criteria) |
| E12 | `Clear-Site-Data` is Baseline (2023-09). The `"cache"` directive is supported in Safari 17+. The `"storage"` directive clears **all** localStorage, sessionStorage and IndexedDB for the origin **and unregisters every service worker**. It cannot spare an allowlist. *(Firefox has published an intent to unship cache clearing through this header; unconfirmed in this pass.)* So the header is defence in depth and the client-side purge is the real control (D-5). | [MDN: Clear-Site-Data](https://developer.mozilla.org/docs/Web/HTTP/Headers/Clear-Site-Data); [caniuse: cache](https://caniuse.com/mdn-http_headers_clear-site-data_cache); [Mozilla dev-platform thread](https://groups.google.com/a/mozilla.org/g/dev-platform/c/I939w1yrTp4) |
| E13 | Since iOS/iPadOS 16.4, third-party browsers (Chrome, Edge, Firefox) can offer Add to Home Screen. The install sheet should still name Safari as the primary path, because the Share-menu placement differs per browser. | [WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) |
| E14 | **Vercel Skew Protection** is available on **Pro and Enterprise** only. Projects created after 2024-11-19 on a supported framework (Next.js ≥ 14.1.4 built on Vercel) have it on by default. The default maximum age is **12 h on Pro** and one day on Enterprise, measured from deployment creation. It can be raised up to the project's deployment-retention limit. It does **not** pin full-page document navigations, and in Next.js it pins only framework-managed requests (assets, RSC, Server Actions), not custom `fetch()` calls. | [Vercel: Skew Protection](https://vercel.com/docs/skew-protection) (last updated 2026-09-16); [Vercel changelog: GA](https://vercel.com/changelog/skew-protection-is-now-generally-available) |
| E15 | *(Round 3: the Vercel plan is handled by the PO personally; roadmap PO-24 closed, C45. No plan reference is kept here.)* | [Vercel: plans](https://vercel.com/docs/plans/hobby) |
| E16 | Playwright 1.63.0 descriptors (repo `node_modules`): `Galaxy Tab S4` = 712×1138 (below `md`), `Galaxy Tab S4 landscape` = 1138×712, `iPad Mini` = **768×1024** (not 744), `iPad (gen 7)` = 810×1080, `iPhone SE (3rd gen)` = 375×667. The iPad descriptors send an `iPad` UA, not the iPadOS `Macintosh` UA. | `node_modules/playwright-core/lib/coreBundle.js:27231`, `:27242`, `:27559`, `:27603`, `:27801` |

---

## 3. Target capabilities for v2.0

### 3.1 Installability and manifest (P1)

**Recommendation:** use `app/manifest.ts` (Next built-in, E1). Concrete values:

| Field | Value | Reason |
|---|---|---|
| `id` | `"/"` | A stable app identity, even if `start_url` changes later |
| `name` / `short_name` | Product name per **Decision D1** (placeholder "ClinicQ"); `short_name` ≤ 12 characters | Home-screen label truncation |
| `start_url` | `"/?source=pwa"` | `/` already routes by role (a doctor goes to the cabin/Today view; `INFORMATION_ARCHITECTURE.md:19`). The query string tags installed-app launches for privacy-safe usage counts. |
| `scope` | `"/"` | |
| `display` | `"standalone"` | Required for install (E4). Don't use `fullscreen`, because staff need the status bar (clock, battery). |
| `orientation` | **omitted** (any) | Tablets are used in both orientations; phones mostly portrait. Never lock. |
| `background_color` | `#F6F5F1` (`paper`) | Splash colour equals the app canvas (`DESIGN_SYSTEM.md:71`) |
| `theme_color` | `#FFFFFF` (top-bar `surface`) | The browser and status-bar tint matches the 56 px top bar. Also set through the `viewport` export (`themeColor`). |
| `icons` | 192 and 512 `purpose:"any"`; 512 `purpose:"maskable"` (glyph inside the 80% safe zone, `primary-600` `#0E716B` tile); `apple-icon.png` 180×180 (file convention); `icon.svg` favicon | E4; Android adaptive icons; iOS uses `apple-touch-icon` |
| `shortcuts` | Today, Walk-in, Book (P3) | Long-press on Android; ignored on iOS. URLs still pass auth. |
| `prefer_related_applications` | omitted | E4 |

**Root layout additions (`app/layout.tsx`):**
- `export const viewport = { themeColor: "#FFFFFF", viewportFit: "cover", width: "device-width", initialScale: 1 }`.
- Do **not** set `maximumScale` or `userScalable=false`, because pinch-zoom is an accessibility requirement. The iOS focus-zoom is fixed with 16 px inputs (F-12).
- `metadata.appleWebApp = { capable: true, title: <short_name>, statusBarStyle: "default" }`. Use `default` rather than `black-translucent`, so iOS reserves the status-bar area and only the bottom and side safe areas need handling.
- `lang="en-IN"` is already planned in M1 (`FRONTEND_MIGRATION_PLAN.md` M1).

**iOS splash images:** **Recommendation:** skip per-device `apple-touch-startup-image` assets in v2.0. They need around 20 sizes and break with each new device. iOS shows a plain launch screen. This is P3 polish if the PO wants it.

**Public token pages** (`/r/[token]`, `/reschedule/[token]`, `/reports/view`) would inherit the manifest link from the root layout. **Risk P3:** a patient could "install" a share-link page. This is harmless, because the start URL leads to the login screen. **Recommendation (P3, cheap):** emit no manifest link on these routes (they get their own layout without `manifest`). The custom install UI (§6) appears **only inside the authenticated shell**.

**Public PWA assets (P1, rule):** `/manifest.webmanifest`, `/sw.js`, `/offline`, and the icon files (`/icon*`, `/apple-icon*`, `/favicon*`) are **public, static and PHI-free**. They must **bypass the auth, membership and entitlement checks** in the v2 middleware and layouts. Reason: browsers fetch the manifest without credentials by default, and the SW `install` step would otherwise precache a login or billing redirect instead of the offline page. Verified by spec 1 (§9.1).

### 3.2 Standalone display behaviour (P1)

In standalone mode there is **no browser chrome**: no URL bar, no back or reload buttons on iOS, and no "open in new tab". Required behaviour:

1. **Visible in-app Back** in the top bar on every non-root screen below `xl`. iOS has no system back gesture for web apps. Android has one, and it works with the history stack.
2. **Refresh affordance** on live views (Today, Schedule): a button, plus automatic refetch on `visibilitychange` → visible and on `online`. Pull-to-refresh cannot be relied on.
3. **No dead ends:** every sheet or dialog can be closed with an on-screen control, not only with Esc.
4. **External content:**
   - `wa.me` links hand off to WhatsApp.
   - Signed-URL documents open in the system viewer (§6.5).
   - Links to other origins open outside the app.
5. CSS hook `@media (display-mode: standalone)` for small adjustments, such as hiding "Install app" entries.

### 3.3 Safe areas, viewport units, keyboard (P1)

- `viewport-fit=cover` plus `env(safe-area-inset-*)`:
  - bottom bar: `padding-bottom: max(8px, env(safe-area-inset-bottom))`. `UX_AUDIT.md:341` already says "safe-area aware".
  - sticky sheet action bars and toasts;
  - left and right insets on landscape iPhones;
  - the top inset on the full-screen palette.
- Add Tailwind v4 utilities in the token file (`pb-safe`, `px-safe`) so call sites don't use arbitrary values.
- Replace `min-h-screen` and `h-screen` (19 sites, §1.6) with `min-h-dvh` and `h-dvh`. Use `svh` for full-height sheets that must not jump.
- **Keyboard:**
  - Hide the bottom bar while a text field has focus on phones, using `visualViewport` resize.
  - Keep sticky primary actions above the keyboard.
  - Add `interactive-widget=resizes-content` to the viewport meta for Chrome Android. *(Unconfirmed: Safari ignores it, so the `visualViewport` fallback is required.)*
  - `scrollIntoView({block:"center"})` on focus inside long forms (registration, vitals).
- `overscroll-behavior-y: contain` on scroll containers inside sheets, so pulls don't chain to the page.

### 3.4 Responsive and tablet layouts (P1)

The breakpoints from `DESIGN_SYSTEM.md` §4.2 stand. This strategy adds the following:

| Width | Device examples (CSS px, portrait/landscape) | Front desk (Today) | Consult |
|---|---|---|---|
| < 768 | Phones 360–430; **iPad mini portrait 744**; iPad Split View | Single list with a lane switcher (`SegmentedControl`, `DESIGN_SYSTEM.md:443`); tapping opens a detail bottom sheet | Single column; tabs for Notes / Rx / History; sticky Finish bar |
| 768–1023 (`md`) | iPad 10th gen portrait 820; Galaxy Tab A/S portrait ~800 | **Two-pane:** queue list (≈ 40%) + selected-visit detail; rail nav | Two-pane with the context pane as a drawer |
| 1024–1279 (`lg`) | iPad landscape 1180; Galaxy Tab landscape ~1280 | **Two-pane** list + detail, or 3 lanes with a lane switcher (decided in V2-DX prototypes) | Two-pane, context pane collapsible (already specified) |
| ≥ 1280 (`xl`) | Front-desk desktop; large tablets in landscape | 5 lanes (already specified) | Three-pane |

- **Problem P2:** `DESIGN_SYSTEM.md` §4.2 specifies "Today shows 5 lanes" only at `xl` and gives no md/lg Today layout. **Required change:** add the md and lg rows above to the V2-DX prototypes, at 820 and 1180 px, in addition to the existing 360 and 1280 px.
- **Fact:** iPad mini portrait (744) falls **below** `md`, so it gets the phone shell with a bottom bar. **Recommendation:** accept this, because it is layout by width, not by device. Add 744 to the QA widths.
- iPad Split View, Slide Over and Stage Manager produce arbitrary widths. Because everything is width-driven, no special handling is needed beyond testing 375 and 507 px.
- Touch targets ≥ 44 px, nothing hover-only, row actions always visible (`DESIGN_SYSTEM.md:497`, `:694`). Hardware keyboards on tablets get the same shortcuts as desktop.

### 3.5 Input modes and mobile keyboards (P1)

Encode these settings in the primitives (M2) so call sites can't forget them:

| Field | Attributes |
|---|---|
| Mobile number | `type="tel" inputMode="numeric" autoComplete="tel-national" enterKeyHint="next"` (the PhoneInput component) |
| OTP (signup verify, forgot password) | `inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}"`, single field |
| Password (requirement #3) | `autoComplete="current-password"` / `"new-password"`, show/hide toggle, `enterKeyHint="go"`, so iOS Keychain and Google Password Manager work in standalone |
| Email | `type="email" autoComplete="email" autoCapitalize="none"` |
| Pincode | `inputMode="numeric" maxLength=6 autoComplete="postal-code"` |
| Age, days, quantity | `inputMode="numeric"` |
| Money, vitals (kg, °F, SpO₂) | `type="text" inputMode="decimal"` (`DESIGN_SYSTEM.md:600`, `:662`) |
| Search | `type="search" enterKeyHint="search"` (`DESIGN_SYSTEM.md:505`) |
| Names | `autoCapitalize="words" autoComplete="off"` on patient fields, so staff autofill doesn't fill patient data |

**Recommendation:** add a unit or e2e guard asserting that every `Input` rendered with a numeric `kind` has an `inputMode` (P2).

### 3.6 Offline app shell and friendly offline page (P1)

Scope is deliberately minimal (see §4 and §5):
- **Offline page** (`/offline`, static, no data): "You're offline. Patient data isn't stored on this device. Reconnect to continue." It has a Retry button and the clinic-neutral brand. It is precached.
- **Online/offline banner** (`DESIGN_SYSTEM.md:517`, `:549`): write actions are disabled with a reason while offline. Data already on screen stays visible, held **in memory**, with a "Stale since 10:42" label.
- **No offline reads or writes** of clinical or billing data in v2.0.

### 3.7 Update and new-version prompt (P1)

Two problems need handling:
- **Problem:** a long-running standalone session on a front-desk tablet can stay open all day, which means the service worker is stale.
- **Problem:** after a deploy, an old client calling a removed Server Action ID gets "Failed to find Server Action". This is version skew.

Design:
1. Register the SW with `updateViaCache: "none"` and serve `/sw.js` with `Cache-Control: no-cache, no-store, must-revalidate` (E1). Call `registration.update()` on `visibilitychange` → visible and every 30 min.
2. A **version and access poll**: `GET /api/session-status` returns `{ deploymentId, accessLevel }`. The deployment ID comes from the Next.js `deploymentId` / `VERCEL_DEPLOYMENT_ID` that Vercel sets, so there is no hand-maintained build number. `accessLevel` is `tenant_access_level()` for the active tenant (SUBSCRIPTIONS_AND_PLANS §6.2). The client calls it on resume (`visibilitychange` → visible), on `online` and every 5 min while visible. A changed deployment ID triggers step 3. A non-`full` access level triggers D-8 (§6.6). The endpoint is authenticated, `no-store`, and returns no PHI. (A bare build-ID check alone would not justify a custom endpoint; the access level does.)
3. When a new SW is waiting or the build ID changed, show a non-blocking toast: "A new version is ready · **Reload**".
4. **Safe-point auto-apply:** on the next route navigation, when no form is dirty and no command is in flight, `skipWaiting` and reload. The app never reloads over unsaved input.
5. **Skew guard:**
   - A global handler for Server Action or RSC fetch errors caused by a stale deployment shows "This app was updated. Reload to continue". The user's typed input stays in memory until they choose to reload.
   - **Fact (E14):** Vercel Skew Protection is on by default for new Next.js projects where it is available. **Recommendation:** if available (hosting is handled by the PO, roadmap C45), confirm it is enabled on the production project and set the maximum age to at least 24 h (within the retention limit); PWA-05's update toast and stale-action handler cover skew in any case.
   - **Fact:** the window is measured from deployment creation (12 h default on Pro), and full-page navigations are not pinned (E14). A front-desk tablet open longer than the window, or a custom `fetch()`, can still hit skew. **The app's own skew guard above is therefore mandatory**, not a fallback.

### 3.8 Network-resilient forms (P1)

India tier-2 and tier-3 networks drop packets and stall, which can lead to double submits and lost confirmations.

- **Idempotency keys on every write command (backend dependency, V2-07):**
  - Each atomic RPC (`enqueue_walk_in`, `register_and_book`, `collect_payment`, finish consult, and so on) accepts `p_client_request_id uuid`.
  - It stores the result under `unique (tenant_id, client_request_id)` and returns the original result on a replay.
  - The client generates the UUID when the form opens and reuses it on every retry of that submission.
  - This makes retry safe for tokens, payments and invoices, where a duplicate is a P0-class business error.
- **Client behaviour:**
  - A 15 s timeout on commands.
  - On a network error or timeout, keep form state and show "Couldn't save · **Retry**" (`DESIGN_SYSTEM.md:527`).
  - **Auto-retry once** only for commands that carry an idempotency key, then hand control back to the user.
  - The submit button is disabled while a command is in flight.
- **Not in v2.0:** Background Sync, or queueing writes offline. That would require persisting PHI on the device (§4), and Background Sync isn't available on iOS.
- **Consult drafts** (V2-09b): server autosave on blur and after 5 s idle (`UX_AUDIT.md:730`), an in-memory unsent buffer, and a `beforeunload`/`pagehide` guard while a save is pending. Worst-case loss is the last ≤ 5 s of typing if the app is killed mid-edit (**Decision D3**).
- **Realtime on resume:** iOS suspends WebSockets in background apps. On `visibilitychange` → visible, refetch Today and resubscribe. The existing plan already has a polling fallback (`FRONTEND_MIGRATION_PLAN.md` risks table).
- If V2-03 adopts Next 16, evaluate `experimental.useOffline` (E2) for the banner and navigation retry. Do not depend on it, because it is experimental.

### 3.9 Low-bandwidth performance budgets (P1)

The PRD target is 1–2 s for core actions on 3G/4G (`docs/clinic-management-prd.md:170`). Budgets are measured with Lighthouse mobile default throttling (simulated slow 4G, 4× CPU) against a production build with synthetic data on the local stack:

| Metric | Budget | Applies to |
|---|---|---|
| First-load JS (gz) | ≤ 150 kB shell-only routes; ≤ 200 kB Today and Consult (keeps `FRONTEND_MIGRATION_PLAN.md:158`) | `next build` output |
| LCP | ≤ 2.5 s | Login, Today, Patients, Consult |
| INP (lab proxy: TBT) | TBT ≤ 300 ms | Same |
| CLS | ≤ 0.1 | Same |
| Web fonts | ≤ 2 files on first load, Latin subset, `display: swap`; **IBM Plex Devanagari not loaded globally**: only where Hindi content renders (public patient pages, print). This conflicts with `FRONTEND_MIGRATION_PLAN.md:71`, which loads it in `app/layout.tsx` (§12 item 4) | `next/font` |
| Authenticated navigation payload (HTML/RSC) | ≤ 60 kB gz *(validate in M0)* | Today, patient page |
| Images | `next/image`; no image > 100 kB on first load; patient documents never preloaded | All |
| SW precache size | ≤ 150 kB (offline page + icons only; no JS chunk precache) | `sw.js` |

**Recommendation:** do not precache JS chunks, which is the Serwist/Workbox default. On a slow 4G link, the first visit would download every route's chunks. Hashed `/_next/static/*` assets are cached lazily, at runtime, cache-first. Repeat visits are fast and the first visit stays light.

---

## 4. Data policy: no PHI on the device (P1, normative)

**Rationale:**
- Clinic devices are often shared between a receptionist and a doctor, or are personal phones.
- Phones get lost.
- Browser storage is not encrypted per user.
- Cached PHI would survive logout and bypass RLS.
- **Legal context (design principle, not a legal mandate for this specific rule):** the DPDP Act 2023 s.8(5) requires a data fiduciary to take reasonable security safeguards against personal-data breach. DPDP Rules 2025, Rule 6 sets out those safeguards. The Rules were notified on 13–14 Nov 2025, and Rule 6 takes effect 18 months later, around May 2027. Source: [PIB explainer](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf), accessed 2026-11-10. *Exact dates unconfirmed against the Gazette.* Keeping PHI off devices is our chosen way of meeting that duty for client devices. See `DATA_HANDLING.md` for the data-handling baseline.

Rules:

| # | Rule |
|---|---|
| D-1 | The service worker **never** caches: navigation/HTML responses; RSC payloads (`?_rsc=`, `RSC: 1` header); Server Action POSTs; anything under `/api/**`, `/auth/**`, `/r/**`, `/reschedule/**`, `/reports/**`; any cross-origin request (Supabase REST/Realtime/Storage, S3 signed URLs, MSG91, AI providers). These pass straight to the network. The SW does not call `respondWith` for them, except the navigation fallback to `/offline` on network failure. |
| D-2 | The SW **may** cache only an allowlist: `/_next/static/**` (content-hashed, PHI-free), `/offline`, icons, the manifest and fonts. The allowlist is a positive match, so everything else is denied by default. |
| D-3 | No PHI in IndexedDB, localStorage or sessionStorage. localStorage may hold only non-identifying per-device preferences: install-banner dismissal, last selected lane, density. **§1.9 is resolved by removal:** `AI_STRATEGY.md` retires the ops copilot from v2.0. Any v2.1 chat feature must keep turns on the server (`AI_STRATEGY.md` §4.3) and nothing in browser storage. |
| D-4 | Authenticated HTML and RSC responses carry `Cache-Control: private, no-store` (SEC-13 / remediation P1-7). This also keeps PHI pages out of the HTTP cache and generally out of the back-forward cache. *(Chrome is relaxing bfcache eligibility for `no-store` pages when cookies are unchanged; unconfirmed. The `location.replace` plus the cookie change on sign-out still evicts them, and R9 is the real check.)* |
| D-5 | **One exit helper, `hardSignOut(reason)`, for every exit path:** sign out, "Switch user" (menu), idle local sign-out on clinical screens (AUTH §3.6), session expiry or refresh failure, staff removal (`revoke_user_sessions`, AUTH §3.6) and "Sign out everywhere". Order: (1) `supabase.auth.signOut({ scope: 'local' })` (or `'global'` for "everywhere"), then `POST /auth/signout`, a server route that clears the auth cookies and responds with `Clear-Site-Data: "cache"` only; (2) client purge: delete every Cache Storage entry outside the D-2 static allowlist, clear `sessionStorage`, delete localStorage keys outside the D-3 preference allowlist, clear in-memory query state, unsubscribe Realtime channels; (3) `location.replace("/login")`, a hard navigation, so no React tree with PHI survives. **Why only `"cache"`:** the `"storage"` directive would wipe the D-3 preferences and unregister the SW on every sign-out (E12). The client purge is the real control; the header is defence in depth. **Guard:** no other module may call `supabase.auth.signOut`; a CI grep allows it only in the helper's file. A subscription lock is **not** a sign-out (D-8). |
| D-6 | Patient documents (lab PDFs, Rx PDFs, uploads) are never stored by the app. Opening one hands a short-lived signed URL to the system viewer. Any download is an explicit user action. |
| D-7 | No PHI in notification payloads, the manifest, shortcuts, page `<title>` on shared screens (titles appear in the app switcher; use "Patient · ClinicQ", not the patient's name), or in error pages. |
| D-8 | **Subscription lock** (`tenant_access_level` ≠ `full`, i.e. `expired`/`archived`, SUBSCRIPTIONS_AND_PLANS §6.2): owner and admin get a hard navigation to `/billing/locked` (renew, export and invoices stay reachable). Other roles go to `/billing/locked/staff` ("Clinic access paused. Contact your clinic owner"; SUB §7.2). Both use `location.replace`, so in-memory PHI is discarded, and Realtime channels are unsubscribed first. **The session is kept**, so the owner can pay or export without signing in again. |

**Narrow exception considered: rejected for v2.0.** The PRD's "offline-tolerant queue" (`clinic-management-prd.md:171`, roadmap FE-10/P3-01) could be met by persisting the Today board. Instead, **v2.0 keeps the already-loaded board in memory** with a stale banner, which covers short outages, and persists nothing. If v2.1 wants persisted offline Today, the minimum bar would be:
- tokens and first names only;
- a TTL of the clinic day;
- wiped on logout and at midnight IST;
- per-user keyed;
- explicit opt-in per device.

That needs a fresh DPDP review (owner: the security/DPDP track).

**Verification (automated):** a Playwright spec logs in, browses Today, a patient, a consult and an invoice, then enumerates `caches` and asserts that every cached URL matches the D-2 allowlist. It also asserts that `indexedDB.databases()` is empty and that `sessionStorage` and `localStorage` keys are on the allowlist. After logout it asserts that the caches hold only the static allowlist, that `sessionStorage` is empty, and that Back does not render PHI.

---

## 5. Service-worker approach: decision

| Option | For | Against | Verdict |
|---|---|---|---|
| **A. Hand-written `public/sw.js` (≈ 100 lines) + manual registration** | Fully auditable allowlist (§4); no build plugin; works with webpack and Turbopack; matches the official Next guide (E1) | Must write the update and lifecycle code ourselves (small) | **Recommended** |
| B. Serwist (`@serwist/next` / `@serwist/turbopack`) | Workbox-grade strategies; precache manifest | Its default precaching contradicts §3.9; the integration changed in 9.4 (E3); an extra build dependency for a feature we deliberately keep small | Revisit only if v2.1 expands offline scope |
| C. `next-pwa` | — | Unmaintained (E3) | Reject |
| D. No SW at all (manifest only) | Installable from the menu on Chrome ≥ 108 (E5); simplest | No automatic Android install prompt (needs a `fetch` handler, E5); no offline page; no update prompt | Reject |

The SW must be written in plain JS with no imports. Its CSP (`/sw.js` headers) is `default-src 'self'; script-src 'self'`. The app CSP (SEC-13, P1-7) must add `worker-src 'self'` and `manifest-src 'self'`.

Strategies inside the SW:
- `install`: precache `/offline`, icons and the manifest (all public per §3.1; the install fails rather than caching a redirect: check `response.ok && !response.redirected`).
- `activate`: delete old cache versions; enable `registration.navigationPreload` (so network-only navigations do not wait for SW start-up on low-end Android); `clients.claim()`.
- `fetch`:
  - navigation → network-only (using the preload response), falling back to `/offline` on failure;
  - `/_next/static/**` → cache-first, with a cap of about 200 entries;
  - everything else → no `respondWith`.

---

## 6. Install UX

### 6.1 Android (Chrome, Edge, Samsung Internet)
- Capture `beforeinstallprompt` and suppress the mini-infobar.
- Show an **"Install app"** entry in the user menu and More sheet at all times when installable.
- Show a **one-time, dismissible card on Today** from the user's second signed-in session onward. It never appears on login, onboarding, consult or checkout. Dismissal is remembered for 30 days in localStorage (allowed by D-3).
- Listen for `appinstalled`, then hide the entries.

### 6.2 iOS and iPadOS (Safari; other iOS browsers per E13)
- Detection:
  - iOS: `/iPhone|iPod/` in the UA;
  - iPadOS reports a Mac UA, so use `navigator.maxTouchPoints > 1` together with `Macintosh`;
  - installed: `navigator.standalone === true` or `matchMedia('(display-mode: standalone)')`.
  - Playwright's iPad descriptors send an `iPad` UA (E16), so the `Macintosh && maxTouchPoints > 1` branch needs a dedicated spec with a custom `userAgent` (§9.1 spec 10).
- An **instructions sheet**, opened from the same "Install app" entry, with three illustrated steps:
  1. Tap **Share**.
  2. Choose **Add to Home Screen**.
  3. Keep **"Open as Web App"** on (iOS 26, E8). Tap **Add**.
- Show the "You'll need to sign in once inside the app" note (E10).

### 6.3 In-app browsers (P1 for India)
- **Assumption (validate):** staff invites and links are often opened from WhatsApp or Gmail, which use in-app webviews that cannot install a PWA.
- Detect common in-app UAs (`FBAN|FBAV|Instagram|WhatsApp|GSA|; wv\)`) and show "Open in Chrome" (Android `intent://` link) or "Open in Safari" guidance instead of the install entry.

### 6.4 Authentication interplay (cross-track with AUTH, requirement #3)
- **Risk P1:** iOS Home Screen apps have a **separate cookie jar** (E10). An emailed **magic link** opens in Safari, not in the installed app, so the session lands in the wrong place.
- **Recommendation:** signup email verification and forgot-password must use **6-digit codes typed in the app**, not links (consistent with `AUTH_REDESIGN.md` §0, §3.1).
  - Remove `emailRedirectTo` from OTP sends (§1.11).
  - **Invites use the app-token link per `AUTH_REDESIGN.md` §3.2** (`/join?token`; AUTH-D1 supersedes the earlier "invite lands on a page that asks for the code") (erratum 2026-11-10, AUTH §10). The link holds no session and the `GET` only renders (scanner-safe), so opening it in Safari or a WhatsApp/Gmail webview is harmless. After setting a password there, the user signs in once inside the installed app.
- Password login (requirement #3) also removes the per-login email OTP. That makes the in-app first sign-in cheap, and makes switching users quick on shared tablets.
- **Idle sign-out (AUTH §3.6, AUTH §13 #4):** there is no lock overlay and no password unlock. After 10 min without input on clinical screens, the client runs an **idle local sign-out via `hardSignOut()`** (which calls `POST /auth/signout`), then `/login` with the email prefilled. Before sign-out, and on `visibilitychange` → hidden, PHI is covered so the iOS and Android app-switcher snapshot shows no patient data (R14).
- **Risk P2: password managers on shared devices** (see §11). "Switch user" never auto-submits a saved credential.

### 6.5 Documents, printing, sharing, camera
- **Signed-URL documents** (§1.12): in iOS standalone mode, `window.open` shows the document in an overlay browser *(behaviour to verify on a device)*. Keep using it and verify print and share from there.
- **Print:** prescription and invoice printing is mainly a desktop flow. On tablets, use the PDF → system share sheet → print path. Add it to the real-device checklist.
- **Web Share** (`navigator.share({ files })`): offer it for the Rx/invoice PDF where supported, as a user-initiated share to WhatsApp (P2). It is fine under D-6 because the user explicitly chooses to share.
- **Lab document upload** (PO-5: document upload stays in v2.0): `<input type="file" accept="image/*,application/pdf">` with a **"Take photo"** option (`capture="environment"`) on phones and tablets. Downscale images on the client to ≤ 2 MB JPEG before upload (low bandwidth). Nothing is retained locally after upload.

### 6.6 Subscription and AutoPay in standalone (cross-track with BILLING, requirement #2)
- **Risk P1:** mandate setup (UPI AutoPay or card) may redirect to a bank, PSP or UPI app. In iOS standalone mode, a redirect that leaves the app's scope can open in an overlay or in Safari, and come back **without the session** (E10).
- **Fact (settled by the billing track):** `SUBSCRIPTIONS_AND_PLANS.md` §5.1 chooses the **Razorpay hosted Checkout modal** (same-document overlay), with **UPI Intent on mobile and QR on desktop**. UPI Collect is deprecated for new AutoPay registrations from 28 Feb 2026. Authorisation includes a ₹5 auto-refunded token charge. An unauthorised attempt leaves the tenant `incomplete`, and a job cancels provider subscriptions left in `created` for more than 60 min.
- **Recommendation:**
  - Make the return path **stateless**: the server confirms the mandate by signature check and webhook, and the app polls status, so the flow completes even if the return lands elsewhere.
  - **PWA edge case (P1):** UPI Intent switches to the UPI app. On iOS a backgrounded standalone PWA may be reloaded, so the Checkout success handler never runs. On resume (and on every load of the billing page), call `GET` subscription status from the server and show "Confirming your AutoPay…" until the webhook or poll resolves. **Never show the "Start trial" step again while a provider subscription in `created` exists** for the tenant; offer "Try again" only after the 60-min expiry job has cancelled it.
  - Add "set up AutoPay from the installed iOS app" and "…from the installed Android app" to the real-device checklist (R12).
- **Enforcement of "stop working as soon as the plan expires" (requirement #2):** server checks on navigation are **not enough**, because an all-day front-desk tablet may never navigate and keeps receiving Realtime events. Enforcement is at the **data layer**: `tenant_access_level()` / `has_entitlement()` in RLS and in every RPC (SUBSCRIPTIONS_AND_PLANS §7), so a locked tenant gets no data whatever the client does. The client reacts:
  - a typed `SUBSCRIPTION_LOCKED` error from any Server Action or RPC triggers D-8;
  - the §3.7 poll returns `accessLevel`, and every resume checks it (so a lock is noticed within one poll interval, 5 min, even with no user action);
  - Realtime channels are unsubscribed on a lock;
  - the offline page and SW never cache entitlement state.
  - Verified by §9.1 spec 9.

---

## 7. Push notifications: recommendation

**Recommendation: defer web push to v2.1. Do not build it in v2.0.**
1. Settled scope (PO-8) is **appointment reminders to patients**. Those go through WhatsApp/SMS (MSG91), not push, because patients do not install the clinic's staff app.
2. Staff-facing events, such as "patient checked in" or "with doctor", matter while the app is open. Realtime plus in-app toasts cover them.
3. On iOS, push works only for installed apps and needs a permission prompt (E7). Lock-screen notifications on shared devices are a PHI leak risk (D-7).
4. Push adds VAPID keys, a subscriptions table with RLS, a sender job, unsubscribe and cleanup on logout. That is real surface for a two-person team.

v2.1 candidate (PWA-13):
- staff-only, opt-in per device;
- **PHI-free payloads** ("2 patients waiting · open app");
- subscriptions deleted on logout;
- delivered through the existing jobs/outbox (V2-04).

**Assumption (validate in v2.1):** vaccine reminders (v2.1, paediatrics) go to guardians by WhatsApp/SMS like appointment reminders, not by push. The PO said only "in v2.1 we will also send for vaccines especially for Pediatrics"; the channel is decided with the PO-8 v2.1 scope.

---

## 8. Shell and IA check (`FRONTEND_MIGRATION_PLAN.md` M3, `INFORMATION_ARCHITECTURE.md` §3.3, `UX_AUDIT.md` §5.0)

| Planned element | Supports PWA? | Required change |
|---|---|---|
| Bottom bar < 768 with 4 destinations + centre "+" (`UX_AUDIT.md:306-342`) | Yes | Add safe-area padding (already noted), hide when the keyboard is open, and use the `dvh` layout. Add an **in-app Back button** in the top bar on non-root routes (standalone). |
| Rail md–lg, sidebar ≥ xl (`DESIGN_SYSTEM.md:335-337`) | Yes | Specify **md and lg layouts for Today** (two-pane), §3.4. Add 744 / 820 / 1180 to QA widths (`DESIGN_SYSTEM.md:342` lists 360, 390, 768, 1024, 1280, 1440). |
| Command palette full-screen on phone | Yes | Top safe-area inset; `enterKeyHint="search"`; close button. |
| "More" sheet on phone (`INFORMATION_ARCHITECTURE.md:101-118`) | Yes | Add **"Install app"** (§6) and **"Check for updates"** (shows version, triggers §3.7). |
| User menu Sign out (`components/layout/user-dropdown.tsx:24`) | **No** | Route through `hardSignOut()` (D-5). |
| Copilot drawer (`components/ai/operations-copilot-drawer.tsx:63-83`) | n/a | **Removed in v2.0 (AI track, `AI_STRATEGY.md` A6).** If it returns in v2.1, it must follow D-3. |
| `loading.tsx` / `error.tsx` per route group (M3) | Yes | `error.tsx` must recognise offline and version-skew errors and offer Retry or Reload (§3.7). |
| M3 scope overall | Partial | **Add** to M3: manifest, icons, viewport and appleWebApp metadata, SW registration, offline page, online banner, update toast, install entry. Size grows from M to M+ (about 1 extra S). |
| Per-route `ui_v2` flags and coexistence (`FRONTEND_MIGRATION_PLAN.md` header, M3, M5) | n/a | PO-15 settles a single go-live, so the PWA work needs **no flags**. (Whether flags stay for the strangler work is for the frontend track to revise.) |

---

## 9. Testing

### 9.1 Playwright device matrix (emulation)

| Project | Engine | Purpose | Lane |
|---|---|---|---|
| Desktop Chrome 1280 | Chromium | Baseline | PR |
| **Pixel 7** | Chromium | Phone, Android; SW, offline and cache audit run here (Chromium exposes SW and CDP) | PR |
| **iPhone 15** | WebKit | Phone, iOS layout, 16 px inputs, safe-area CSS presence | PR (golden path only) |
| **iPhone SE (3rd gen)** | WebKit | Smallest supported phone (375×667). Optional: drop it if nightly time is tight; the 360 px Pixel layout check (spec 8) covers narrow width. | Nightly |
| **Galaxy Tab S4** (descriptor 712×1138, E16) | Chromium | Android tablet, **portrait below `md` (phone shell with bottom bar)** | Nightly |
| **Galaxy Tab S4 landscape** (1138×712) | Chromium | Android tablet, rail layout at `lg` | Nightly |
| **Android tablet 800** (custom project: Chromium, Pixel-style mobile UA, `isMobile`, `hasTouch`, viewport 800×1280) | Chromium | Covers "Galaxy Tab A/S portrait ~800" from §3.4: `md` two-pane with the rail | Nightly |
| **iPad (gen 7)** portrait 810 and landscape 1080 | WebKit | Tablet two-pane Today and Consult | Nightly |
| **iPad mini 744** (custom project: WebKit, iPad descriptor with viewport **744×1133**; the built-in `iPad Mini` is 768×1024, E16) | WebKit | Phone-shell-on-tablet edge case | Nightly |

This **replaces** the Pixel 5-only mobile lane (`TEST_STRATEGY.md:247`, `playwright.config.ts`). The PR lane stays small (3 projects), and the full matrix runs nightly (`TEST_STRATEGY.md:269`).

**PWA-specific specs (`tests/e2e/pwa/*.spec.ts`):**
1. `/manifest.webmanifest` is valid: required fields per E4, 192 and 512 icons plus maskable, every icon URL returns 200, and the correct `content-type`. Fetch `/manifest.webmanifest`, `/sw.js`, `/offline` and every icon **with no cookies**, and also as a user of a locked tenant: each returns 200 with **no redirect** (§3.1 public assets rule).
2. Chromium only: the CDP `Page.getInstallabilityErrors` returns an empty list. *(It is an experimental CDP method; if it is removed, fall back to spec 1.)*
3. The SW registers and activates; `/sw.js` has `no-store` headers.
4. Offline: after `context.setOffline(true)`, navigation shows `/offline`, the banner appears, write buttons are disabled, and on-screen data remains with a stale label.
5. **Cache-content audit and sign-out purge** (§4 verification), run for each `hardSignOut` path (sign out, switch user, idle local sign-out, session expiry). D-3 preference keys survive; everything else is gone.
6. Update flow: change the deployment ID returned by `/api/session-status` (mocked with `page.route`), and the toast appears. A dirty form blocks the auto-reload.
7. Idempotent retry after commit: intercept the Server Action POST (match on the `Next-Action` request header, because Server Actions POST to the page URL), call `route.fetch()` so the server commits, then `route.abort()` the response to the client. The UI shows "Couldn't save · Retry"; the retry must produce **exactly one payment and one invoice row** (DB assertion). Repeat for walk-in and booking (needs V2-07).
8. Layout: no horizontal scroll at 360/375/744/800/820/1180; bottom bar visible below 768 and absent at or above 768; targets ≥ 44 px (bounding-box check on interactive elements in the shell).
9. **Subscription lock while open:** open Today, then move the tenant to `expired` with a test-only transition RPC on the local stack (time hooks per SUBSCRIPTIONS_AND_PLANS §10.3). The next action, or the next resume or poll, redirects within one poll interval (owner → `/billing/locked`; receptionist → `/billing/locked/staff`), no new data renders, Realtime is unsubscribed, and the session cookie is still present (D-8). Uses `page.clock` to advance the poll.
10. iPadOS detection: a WebKit context with a custom `Macintosh` UA and `maxTouchPoints > 1` shows the iOS instructions sheet, not the Android prompt (§6.2).
11. Grep guard (static, PR lane): `supabase.auth.signOut` appears only in the `hardSignOut` helper's file (D-5).

**Limits of emulation:**
- WebKit in Playwright is not iOS Safari.
- Installation, standalone mode, safe areas, the keyboard, the share sheet and the separate cookie jar cannot be emulated.
- These are covered by §9.2.

### 9.2 Real-device checklist (each release candidate; the only PO hands-on step)

**Why a human step remains despite "no human needed" (PO-10 to PO-18):** installation, standalone mode, the separate iOS cookie jar, safe areas, the on-screen keyboard, the share sheet, UPI app switching and the app-switcher snapshot cannot be emulated (§9.1 limits). This is the **only** step the PO performs by hand, about 45 min per run, and only **two runs**: an early run after V2-08 and the final run at V2-15. Claude prepares the checklist as a fillable markdown file, writes the device-specific steps, and scores the results.

**Alternative considered:** a paid real-device cloud service (driven by Claude through its API). It needs budget and a non-Claude-Code tool. **Not recommended** for v2.0.

**Reconciliation with `TEST_STRATEGY.md:270`** ("release checklist sign-off by a reviewer other than the implementer"): in this team that reviewer is an **isolated Claude reviewer agent** that did not implement the change, plus the PO's device run for the R items.

Devices:
- one **low-end Android phone** (2–3 GB RAM, Android 12+, Chrome);
- one recent iPhone (iOS 26);
- one iPad;
- one Android tablet (Samsung, also check Samsung Internet).

See **Decision D4**.

| # | Check |
|---|---|
| R1 | Install from Chrome Android via the in-app prompt; the icon is not cropped (maskable); the splash colour is paper; it launches standalone into the right role home. Sign in inside the installed app, close it fully and reopen it: still signed in (`AUTH_REDESIGN.md` §7 real-device row) (erratum 2026-11-10, AUTH §10). |
| R2 | Install on iPhone and iPad via the instructions sheet; "Open as Web App" is on; you must sign in inside the app once. The session survives app restarts within the `AUTH_REDESIGN.md` §3.6 limits: re-login is required after more than 12 h idle and after the 14 d time-box. Idle local sign-out happens after 10 min on clinical screens. |
| R3 | Status bar and home indicator don't overlap the top bar, bottom bar, sheet actions or toasts, in portrait and landscape. |
| R4 | The keyboard doesn't cover the focused field or the primary action in registration, vitals, OTP, password and money fields. The right keypad appears per §3.5. No zoom-on-focus. |
| R5 | Back works on every non-root screen (iOS has no gesture); there are no dead-end sheets. |
| R6 | Airplane mode → offline banner and page; restore → the app recovers without a reload; Today refetches on resume after 10 min in the background. |
| R7 | Walk-in, booking and payment under a throttled or flaky network (toggle mobile data mid-submit) → no duplicates; Retry works. |
| R8 | Open a lab PDF and an Rx PDF; print or share via WhatsApp; take a photo for a lab document upload. |
| R9 | Sign out (and Switch user) → reopen the app → Back shows no patient data; (Android) DevTools remote → Application → Cache Storage holds only the allowlist. |
| R10 | Update: deploy a new build while the app is open → the toast appears → reload at a safe point; no "Failed to find Server Action" visible to the user. |
| R11 | Signup email code and forgot-password code complete **inside** the installed iOS app; an invite link (`/join`) opened from the Gmail and WhatsApp in-app browsers, on Android and iOS, completes set-password, then sign-in inside the app works (§6.4) (erratum 2026-11-10, AUTH §10). |
| R12 | Subscription AutoPay mandate setup and return completes from the installed iOS and Android apps (§6.6). Includes the UPI Intent round trip: if iOS reloads the app on return, the billing page shows "Confirming your AutoPay…" and never the "Start trial" step again. |
| R13 | TalkBack (Android) and VoiceOver (iOS) smoke test of the shell and Today (`FRONTEND_MIGRATION_PLAN.md:155`, extended to VoiceOver). |
| R14 | Idle local sign-out (10 min on clinical screens) works inside the installed iOS and Android apps and lands on `/login` with the email prefilled; the app-switcher snapshot shows no PHI before or after sign-out. |
| R15 | As owner on a locked (`expired`) tenant, download the data-export ZIP inside the installed iOS and Android apps (SUBSCRIPTIONS_AND_PLANS allows export when locked). Standalone download handling differs per OS. |

Optional: use Chrome remote debugging on Android for R9.

### 9.3 Lighthouse and performance in CI
- The PWA category no longer exists (E5, E6). Installability is covered by §9.1 specs 1–2.
- **Lighthouse CI** (mobile preset, simulated throttling) runs on Login, Today, Patients and Consult against `next build && next start` on the local Supabase stack with synthetic seed (V2-01a), using a scripted login.
  - Assertions per §3.9.
  - **Report-only in V2-06; blocking in V2-15.** **Conflict:** `FRONTEND_MIGRATION_PLAN.md:222` makes it blocking at M5 (V2-11), while roadmap P1-41 says V2-15. **Decision (Claude, reversible):** blocking at V2-15, matching the roadmap; FMP is updated (§12 item 4).
  - Run it **nightly only** (not in the PR lane) until V2-15, to keep PR time low for a one-person team. From V2-15 it runs on release candidates and nightly.
- Bundle budgets come from `next build` output (P2-02, already planned).

---

## 10. Phased plan and acceptance criteria

> Update (2026-11-10, PO decisions): Roadmap reconciliation (C36): the body now uses **V2-13b** (SaaS subscriptions & billing) directly (final review). The lock path end to end (PWA-05) and spec 9 (PWA-08) are delivered there. §6.4 already follows AUTH-D1: invites use a session-less link that sets a password, not a code. Add an "install → sign in → close → reopen still signed in" row to the §9.2 checklist alongside R9 and R11. D1 becomes roadmap PO-19, and the D4 device purchase is part of PO-17.

| Phase (roadmap) | PWA work | Acceptance criteria |
|---|---|---|
| **V2-02** CI & e2e | PWA-08a: device projects in `playwright.config.ts` (PR lane: Desktop, Pixel 7, iPhone 15; nightly: full matrix) | Projects run green on a smoke spec in CI |
| **V2-DX** design exploration | PWA-03a: Today and Consult prototypes at **820 and 1180** in addition to 360 and 1280; Install sheet and offline page mock-ups | PO approves at G2-D |
| **V2-06** FE foundation (M1–M3) | PWA-01 manifest, icons, metadata, public-asset bypass · PWA-02 SW, offline page, cache policy, `hardSignOut()` purge · PWA-03 shell (safe areas, dvh, Back, keyboard) · PWA-04 install UX · PWA-05 update, skew and lock handling (client side) · PWA-07 input modes in primitives · PWA-09 LHCI report-only (nightly) | Specs 1–6, 8, 10 and 11 of §9.1 pass. Chrome DevTools reports the app installable. Cache audit passes. Sign-out purge passes for every exit path. 0 `min-h-screen`/`h-screen` in the new shell. LHCI report published. |
| **V2-07** atomic commands | PWA-06a: `client_request_id` on all write RPCs + replay test | DB tests: the same request ID twice returns the same result and makes one row |
| **V2-08 / V2-09b / V2-10** workflows | PWA-06b: client retry, SaveStatus, timeout handling per workflow · PWA-03b tablet two-pane Today and Consult · PWA-12 camera upload, Web Share | Spec 7 passes for walk-in, booking and payment. Tablet layouts match the approved prototypes at 744/820/1180. |
| **V2-13b** SaaS subscriptions & billing (SUB-03/SUB-08; SUB-02 already in V2-05) | PWA-05 lock path end-to-end · §6.6 resume confirmation on the billing page | Spec 9 passes (owner and receptionist). R12 scripted for the device run. |
| **V2-11** profile, settings, public pages | "Install app" and "Check for updates" in More and Profile · idle local sign-out via `hardSignOut()` with the app-switcher snapshot covered before sign-out (with AUTH-09) | e2e: entries visible only when applicable |
| **V2-15** readiness | PWA-10 real-device checklist R1–R15 (final PO run) · LHCI and bundle budgets **blocking** | All R items pass on 4 devices, scored by a Claude reviewer agent. Budgets in §3.9 met on all 4 routes. 0 open P1 PWA defects. |

**Milestone exit (adds to `V2_MASTER_ROADMAP.md` §15):**
- installable on Android Chrome and iOS/iPadOS Safari;
- standalone launch to the role home;
- §4 cache audit passing in CI;
- the R1–R15 checklist run by the PO and scored by an isolated Claude reviewer agent;
- spec 9 (subscription lock while open) passing;
- performance budgets blocking and green.

---

## 11. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| iOS separate cookie jar breaks link-based flows (auth, AutoPay return) | Users stuck or logged out | Code-based OTP for signup and forgot password; invites use the session-less app-token link, then sign-in inside the app (AUTH §3.2, §6.4); stateless payment return with resume confirmation (§6.6); R11–R12 |
| **P1:** a locked clinic keeps working on an always-open tablet | Breaks requirement #2 ("forcefully stop") | Data-layer enforcement in RLS and RPCs; `SUBSCRIPTION_LOCKED` handling, resume/poll access check and Realtime unsubscribe (§6.6, D-8); spec 9 |
| **P2:** saved staff passwords on a shared front-desk tablet let anyone sign in as another user, breaking audit attribution | Wrong person attributed in the audit log | "Switch user" never auto-submits; onboarding help advises against saving passwords on shared devices; optional per-device "shared device" toggle that sets `autocomplete="off"` on the login password (*browsers may ignore it; unconfirmed*); idle local sign-out on clinical screens (`AUTH_REDESIGN.md` §3.6) |
| A stale SW or old client after deploy on all-day tablets | Errors, broken actions | §3.7 update and skew handling; spec 6; R10 |
| A SW bug caches PHI | Privacy incident | Positive allowlist; cache-audit spec in the PR lane; reviewer-agent checklist item for any `sw.js` diff |
| Low-end Android performance | Slow front desk | Budgets blocking at V2-15; no precache; Devanagari font not global; real low-end device |
| WebKit emulation passes but real iOS differs | Late surprises | R-checklist at the end of V2-08 (early run) as well as V2-15 |
| iOS storage eviction or quota | Only preferences lost (no PHI stored) | By design nothing important is stored locally |
| Clinics use in-app browsers (WhatsApp) | Can't install | In-app browser detection (§6.3) |

---

## 12. Required changes to other v2 documents (for their owners; this file does not edit them)

1. `DESIGN_SYSTEM.md:527` and `:549`:
   - change "Offline · saved on this device" to "Offline · not saved. Reconnect to save" (or "Unsaved changes");
   - change "Consult drafts saved locally" to "in-memory only; server autosave ≤ 5 s".
   - Add md/lg Today layouts and QA widths 744/820/1180 to §4.2.
   - Add safe-area utilities.
2. `UX_AUDIT.md:730`: replace the IndexedDB local-draft save model with server autosave plus an in-memory buffer (§3.8).
3. `FRONTEND_TECHNOLOGY_ASSESSMENT.md:172`: change the `idb-keyval` offline-drafts row to "Rejected for v2.0 (PWA_STRATEGY §4)".
4. `FRONTEND_MIGRATION_PLAN.md`:
   - `:169` (M4.4 acceptance): change "kill the tab mid-note, reopen, content restored" to "content restored up to the last server autosave (≤ 5 s)".
   - Add the PWA items to the M3 scope (§8). Change the Pixel 5 lane to the §9.1 matrix.
   - `:71` (Fonts): change to "Devanagari loaded only where Hindi content renders (public patient pages / print), not in the root layout".
   - `:222` (Performance row): change "blocking in M5" to "report-only from M2 (nightly), blocking at V2-15", matching roadmap P1-41.
5. `TEST_STRATEGY.md`:
   - `:247`, `:269`: add the device matrix and PWA specs.
   - §7 journey 1 (`:249`), "Staff login with OTP": becomes **password login** per requirement #3 / `AUTH_REDESIGN.md` J-A3.
   - `:270` pre-release sign-off "by a reviewer other than the implementer": an isolated Claude reviewer agent plus the PO's device run (§9.2).
6. `V2_MASTER_ROADMAP.md`:
   - FE-10 / P3-01: offline Today becomes "in-memory stale view in v2.0; persisted offline Today needs DPDP review in v2.1".
   - Add the §13 items.
   - Add the PWA exit criteria to §15.
7. `SECURITY_REMEDIATION_PLAN.md` P1-7 (CSP): add `worker-src 'self'`, `manifest-src 'self'`, and the `/sw.js` header set.
8. `AUTH_REDESIGN.md` (requirement #3):
   - code-only OTP for signup and forgot password, no magic links (§6.4); invites stay as the app-token link (already so in §3.2);
   - §3.6: route every sign-out (local, switch user, idle local sign-out, session expiry, staff removal, sign out everywhere) through the D-5 `hardSignOut()` helper;
   - §3.6 idle local sign-out: cover the app-switcher snapshot before sign-out (R14);
   - J-A9 (installed-PWA Android emulation smoke test): cross-reference §9.1 specs 1–5.
9. `SUBSCRIPTIONS_AND_PLANS.md` (requirement #2):
   - §5.1: add the iOS standalone resume-confirmation edge case (§6.6): "Confirming your AutoPay…", never re-show "Start trial" while a provider subscription in `created` exists;
   - §7: add the client lock handling (typed `SUBSCRIPTION_LOCKED` error, access level in the resume poll, Realtime unsubscribe, D-8 navigation that keeps the session);
   - SUB-02 layout redirects must exclude the §3.1 public PWA assets.

---

## 13. Decisions for the PO (only genuinely open items)

The PO delegated reviews and technical calls to Claude (PO-10 to PO-18: "Claude can review everything, no human needed"; PO-8/9: "I would let you decide"). Only brand and spend remain with the PO.

| # | Decision | Recommended default |
|---|---|---|
| D1 | Product name and `short_name` on the home screen (brand; part of the still-open naming) | "ClinicQ" as the working name; the icon is a teal tile with a "Q" glyph. Changing it later costs only the manifest and icons, but installed icons update only on the browser's next manifest check. |
| D4 | Real-device test kit (spend) | Use the PO's own phone plus borrowed devices. **Buy one low-end Android phone** (2–3 GB RAM) as the reference device. Paid cloud device labs are not recommended for v2.0 (§9.2). |

**Decided by Claude (reversible), recorded for transparency:**

| # | Decision | Rationale |
|---|---|---|
| D2 | **No web push in v2.0**; v2.1 candidate as PHI-free, staff-only, opt-in push (§7, PWA-13) | Settled reminders (PO-8) go to patients by WhatsApp/SMS; push is iOS-install-only, risks PHI on lock screens, and adds surface for a two-person team. |
| D3 | **Accept losing up to about 5 s of consult typing** if the app is killed mid-edit, instead of storing drafts on the device | Keeps the §4 no-PHI-on-device rule; server autosave on blur and after 5 s idle bounds the loss. |
| D5 | **No iOS per-device splash images** in v2.0 (P3) | About 20 sizes that break with each new device; iOS shows a plain launch screen. |
| D6 | **Lighthouse CI blocking at V2-15** (not M5) | Matches roadmap P1-41; keeps early phases fast. |
| D7 | **Clear-Site-Data sends `"cache"` only**, with an explicit client purge (D-5) | `"storage"` would wipe allowed preferences and unregister the SW on every sign-out (E12). |

**Round 3:** the Vercel plan and its cost are handled by the PO personally (roadmap PO-24 closed, C45); this strategy does not depend on a specific plan. Skew Protection (E14) is used if available.

> Update (2026-11-10, PO round 3; roadmap C45, C46): Vercel is handled by the PO personally (PO-24 closed). Supabase Free applies only to the real-world UAT stage (V2-16). Wherever an environment has no Skew Protection, PWA-05's update toast and stale-action handler are the skew defence; the PWA-05 Skew Protection check runs on production at V2-15 only if the PO's plan offers it. The PWA-10 final real-device run is a UAT-start (G6) item; UAT clinics' device feedback is triaged in V2-16.

---

## 14. Roadmap impact: new backlog items

| ID | Item | Priority | Size | Depends on | Phase |
|---|---|---|---|---|---|
| PWA-01 | `app/manifest.ts`, icon set (192/512/maskable/apple 180/SVG favicon), `viewport` export (`themeColor`, `viewportFit`), `appleWebApp` metadata, `lang="en-IN"`; public PWA assets bypass auth/membership/entitlement checks (§3.1); no manifest link on public token pages (P3) | P1 | S | D1, brand mark (V2-DX) | V2-06 (M1) |
| PWA-02 | Hand-written `public/sw.js` with a positive allowlist and navigation preload; `/offline` page; registration; `/sw.js` headers; `hardSignOut()` helper (local sign-out, `POST /auth/signout` with `Clear-Site-Data: "cache"`, client purge, `location.replace`) plus the grep guard; `Cache-Control: private, no-store` on authenticated responses. PWA-02 ships only the `/sw.js` headers; the CSP `worker-src 'self'`/`manifest-src 'self'` directives ship with roadmap P1-18 in V2-14 | P1 | M | AUTH-04b (`POST /auth/signout`, V2-03) | V2-06 (M3) |
| PWA-03 | Standalone-ready shell: safe-area utilities, `dvh` (replace 19 `min-h-screen`/`h-screen`), in-app Back, keyboard-aware bottom bar and sticky actions, refetch on resume, online/offline banner. (a) prototypes at 820/1180 in V2-DX; (b) tablet two-pane Today and Consult in workflows. | P1 | M (+ S in V2-DX) | M3 shell, V2-DX | V2-DX, V2-06, V2-08, V2-09b |
| PWA-04 | Install UX: Android `beforeinstallprompt` entry and card, iOS/iPadOS instructions sheet, in-app-browser detection, `appinstalled` | P1 | S | PWA-01, PWA-02 | V2-06 (M3) |
| PWA-05 | Update, skew and lock handling: `/api/session-status` (deployment ID + access level), waiting-SW toast, safe-point reload, stale-action error handler; `SUBSCRIPTION_LOCKED` handling, D-8 navigation and Realtime unsubscribe; confirm Vercel Skew Protection on, max age ≥ 24 h | P1 | S | PWA-02; SUB-01/SUB-02 for the lock path | V2-06 (M3); lock path end-to-end in V2-13b |
| PWA-06 | Network-resilient commands: (a) `client_request_id` idempotency on all write RPCs (backend); (b) client timeout, auto-retry-once and SaveStatus per workflow | P1 | M (a) + S per workflow (b) | V2-07 | V2-07, V2-08, V2-09b, V2-10 |
| PWA-07 | Input-mode and autocomplete conformity built into primitives (§3.5) plus a guard test; 16 px inputs | P1 | S | M2 primitives | V2-06 (M2) |
| PWA-08 | Playwright device matrix including custom 744 iPad mini and 800 Android tablet projects (a, V2-02) and PWA specs 1–11 including the cache-content audit and the lock spec (b, V2-06 onward) | P1 | M | V2-01a local stack, V2-02; V2-07 for spec 7; SUB-02 for spec 9 | V2-02, V2-06, V2-13b |
| PWA-09 | Lighthouse CI on 4 routes with §3.9 budgets: report-only nightly, then blocking at V2-15 | P1 | S | V2-01a, PWA-08 | V2-06 → V2-15 |
| PWA-10 | Real-device checklist R1–R15 as a release template (the only PO hands-on step); an early run after V2-08, the final run at V2-15; scored by a Claude reviewer agent | P1 | S | D4 | V2-08, V2-15 |
| ~~PWA-11~~ | **Satisfied by removal of the ops copilot (`AI_STRATEGY.md` A6).** If it returns in v2.1, it must comply with D-3: server-side turns only, nothing in sessionStorage. Not counted. | — | — | — | — |
| PWA-12 | Camera capture with client downscale for lab document upload; Web Share of Rx/invoice PDFs; manifest `shortcuts` | P2 | S | PWA-01 | V2-09c, V2-10 |
| PWA-13 | (v2.1) Staff web push, PHI-free and opt-in; optional persisted offline Today after DPDP review; Serwist re-evaluation if offline scope grows | P3 | M | V2-04 jobs, DPDP review | after v2.0 |

**Net effect:** 11 v2.0 items, **7 S + 4 M** (PWA-01 to PWA-10 and PWA-12), inside existing phases, plus PWA-13 (M) deferred to v2.1. No new phase is needed. The largest cross-track dependencies are:
- idempotency keys in V2-07 (PWA-06, spec 7);
- code-only OTP for signup and forgot password, and sign-out routed through `hardSignOut()` (AUTH track: AUTH-04, AUTH-07, AUTH-09);
- data-layer lock enforcement and the Razorpay checkout resume handling (subscriptions track: SUB-02, SUB-03).

---

## 15. Review disposition (independent review, 2026-11-10)

All facts in the review were re-checked before applying. Accepted items are applied in place; partial corrections are noted.

| # | Disposition |
|---|---|
| 1 | Accepted. §1.9, D-3, §8, §14 PWA-11 (struck, not counted). |
| 2 | Accepted. §6.4, §11 row 1, §12 item 8 (verified `AUTH_REDESIGN.md` §3.2). |
| 3 | Accepted. Subscription lock removed from D-5; new D-8 (verified SUBSCRIPTIONS_AND_PLANS §6.2 states). |
| 4 | Accepted. §6.6 data-layer enforcement and client handling; §3.7 poll returns access level; spec 9. |
| 5 | Accepted with a correction: Vercel docs (last updated 2026-09-16) give a default max age of 12 h on Pro and **one day** on Enterprise, configurable up to the deployment-retention limit; the review's "Enterprise can extend it to 7 days" is not what the current page says. Hobby plan terms were confirmed at the time (E15; superseded in round 3: the plan is handled by the PO). Recorded as E14/E15. |
| 6 | Accepted option (a). MDN confirms `"storage"` unregisters service workers. The Firefox unship intent is kept as *unconfirmed* (not re-verified). |
| 7 | Accepted. D-5 `hardSignOut()` covers all exit paths; grep guard is spec 11. |
| 8 | Accepted. R2 rewritten; R14 added. |
| 9 | Accepted. §6.6 references SUBSCRIPTIONS_AND_PLANS §5.1; resume edge case; R12. |
| 10 | Accepted. §3.1 public-assets rule; spec 1; SW install refuses redirected responses. |
| 11 | Accepted. §13 split into PO decisions (D1, D4) and Claude decisions (D2, D3, D5, plus D6, D7); header shadcn/Radix marked as proposed. |
| 12 | Accepted. §9.2 rationale, two runs, cloud-lab alternative, TEST_STRATEGY reconciliation. |
| 13 | Accepted (verified `coreBundle.js:27231`, Playwright 1.63.0). Both a landscape entry and a custom 800 px project added. |
| 14 | Accepted (verified `coreBundle.js:27603`). Custom 744×1133 project; spec 10 for the `Macintosh` UA branch. |
| 15 | Accepted. Spec 7 rewritten with `Next-Action` match, `route.fetch()` then abort. |
| 16 | Accepted (verified `FRONTEND_MIGRATION_PLAN.md:71`). §3.9 and §12 item 4. |
| 17 | Accepted (verified FMP `:222` "blocking in M5" vs roadmap P1-41 V2-15). Chose V2-15 (D6). |
| 18 | Accepted. §4 rationale cites s.8(5) and Rule 6, labelled a design principle; dates marked unconfirmed against the Gazette. |
| 19 | Accepted. §7 relabelled as an Assumption. |
| 20 | Accepted. §0 and §14 now say 11 items (7 S + 4 M). |
| 21 | Accepted. §12 items 5, 8, 9. |
| 22 | Accepted. §11 P2 risk row; §6.4 note. |
| Opt. E13 | Applied (WebKit 16.4 post confirms third-party browsers can Add to Home Screen). |
| Opt. `deploymentId` | Partly applied: the deployment ID now comes from Vercel's `deploymentId`; the endpoint is kept only because it also returns the access level (fix 4). |
| Opt. navigation preload | Applied (§5). |
| Opt. no manifest on token pages | Applied as a P3 recommendation in §3.1 and PWA-01. |
| Opt. LHCI nightly only; iPhone SE | Applied (§9.3); iPhone SE marked droppable. |
| Opt. bfcache `no-store` note | Applied to D-4, marked unconfirmed. |
| Opt. R15 export download | Applied. |
| Opt. Next.js citations | Applied to E2 (PWA guide date already in E1). |
