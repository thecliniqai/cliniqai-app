---
phase: "09E"
roadmap_id: V2-09e
name: Caching and speed
gate: "G4 (light, per PR): one isolated reviewer (Sonnet) over the latency lane and its budgets, the parity tables, the single reads per screen, skeletons and prefetch at 360/820/1280, the optimistic and rollback states of every save, the schedule store and its live updates; one adversarial security reviewer (Opus) over migrations 000122 to 000124 (consult_screen, the reference catalogue versions and shard read, schedule_range and the extra Realtime kinds), the reference routes, everything the device stores (IndexedDB, HTTP cache, memory) and its purge, migration 000125 (settings_version), the settings held on the device and the cookie fields, and proof that billing, fees, access and roles are never held, and the confinement of the latency preload to the e2e lane; one fix round (09E-10a, lean process, VERIFICATION_LOG 2026-11-15). The PO approves the gate (the 2026-11-21 delegation covered V2-07 to V2-11 for one night); if the PO delegates again, approved by delegation with the CI run recorded."
requirements: ["PO directive 2026-11-23: every click and page must feel instant on staging (300-450 ms per Supabase call, Vercel bom1 to Supabase Sydney); the fix is our call count and caching, not the region", "PO-approved strategy 2026-11-23 items 1-7 (reference data on the device, per-doctor data in memory, per-clinic config cache, schedule data layer, PHI screens in one query, instant feel, latency lane and budgets)", "PRD 1-2 s core actions on 3G/4G (PWA_STRATEGY §1.14, §3.9)", "FE-9 performance budgets (report-only until V2-15; this phase adds latency budgets that block)", "DESIGN_SYSTEM §6.9 (layout-matching loading.tsx per route group, optimistic UI with rollback, no full-screen spinner)", "FRONTEND_TECHNOLOGY_ASSESSMENT D4 and §5 (GET routes for search, Realtime for live views, TanStack Query decision gate)", "TARGET_ARCHITECTURE §9 and ADR-019 (request-scoped caching; tag caching for global reference data only)", "PWA_STRATEGY §4 D-3, D-4, D-5 (no PHI on the device, no-store PHI responses, purge at sign-out)", "FRONTEND_MIGRATION_PLAN M criterion 6 (Today realtime update visible within 2 s)", "V2-09d hand-offs: per-request memo, signed clinic_ctx cookie, Kong round-trip counter, PR-lane call ceilings, the batched available_slots calls"]
plans: ["09E-01", "09E-02", "09E-03", "09E-04", "09E-05", "09E-06", "09E-07", "09E-08", "09E-09", "09E-10a", "close"]
order: "09E-01 -> 09E-02 -> 09E-03 -> 09E-04 -> 09E-05 -> 09E-06 -> 09E-07 -> 09E-08 -> 09E-09 -> reviews -> 09E-10a -> close (sequential; one local stack; one executor at a time)"
preconditions: "V2-09d merged into feature/v2 (09E branches from that merge); C-2 answered before 09E-05 starts; C-1 answered before 09E-09 starts"
migrations: {"09E-02": "000122_consult_screen", "09E-05": "000123_reference_catalogues", "09E-08": "000124_schedule_range"}
migrations_note: "000120_rx_review_fixes is the newest migration at planning time; the brief reserved 000121 for V2-09d, whose notes say it adds none. Run `ls supabase/migrations | tail -3` at the start of each plan: if 000121 is still free when 09E-02 starts, take the next free number and shift the later ones; record the numbers in 09E-NOTES.md. Every migration commit also bumps app/api/ready/expected-migration.ts, the schema snapshot, types/database.ts (npm run db:types) and scripts/ci/assert-pgtap-report.mjs (REQUIRED_FILES and FLOOR with the arithmetic in its header). No other plan adds a migration; 09E-10a takes the next free number only if a fix needs SQL."
base_commit: "the V2-09d merge commit on feature/v2 (not merged at planning time; v2/phase-09d-request-speed was at 66478f5d)"
branch: "v2/phase-09e-caching-speed -> PR into feature/v2"
source: "PO brief 2026-11-23 (strategy items 1-7, budgets, Sydney kept); docs/v2/V2_MASTER_ROADMAP.md §1.2 (PO-6, PO-12, PO-13, PO-15, PO-17), §10 (FE-9, P1-41, P2-08); docs/v2/TARGET_ARCHITECTURE.md §2.4, §3.9, §9; docs/v2/ARCHITECTURE_DECISIONS.md ADR-004, ADR-016, ADR-019; docs/adr/0005; docs/v2/PWA_STRATEGY.md §1.14, §3.6, §3.9, §4 (D-1 to D-5), §9.1 spec 5; docs/v2/DATA_HANDLING.md §2, §3; docs/v2/DESIGN_SYSTEM.md §5 (Combobox), §6.9; docs/v2/FRONTEND_TECHNOLOGY_ASSESSMENT.md §4, §5, D4; docs/v2/FRONTEND_MIGRATION_PLAN.md M criteria; docs/v2/AI_STRATEGY.md §1 (CDCI licence), AIR-8; docs/v2/VERIFICATION_LOG.md rulings 2026-11-14, 2026-11-15, 2026-11-21; .planning/phases/09D-request-speed/09D-NOTES.md; 09C-PLAN.md (R-2, R-3, R-6, R-7, R-16, R-17), 09B-PLAN.md (R-2, R-11), 08-PLAN.md (R-10 Today live, R-11 GET search routes)"
research: "No separate research file; the inventory below is the research. Facts checked in the tree at 66478f5d: the consult page awaits up to 16 reads one after another (14 for a draft consult); an Rx line add is three server actions in a row (command, read-back, allergy context); hot actions call revalidatePath; Today's live refresh re-renders the whole page; the three typeahead routes hit the database on every debounced keystroke with no-store; no unstable_cache, use cache or revalidateTag anywhere; Next 16.4.6 without cacheComponents (unstable_cache with tags, updateTag in actions); the purge at sign-out deletes every IndexedDB database (lib/pwa/purge.ts:90-109) and the cache audit expects none; the patient page awaits a patient.view audit insert before rendering. Catalogue sizes measured from supabase/seed-data with awk, gzip -9 and brotli -q 11 in a scratch directory (planning measurement, re-measured by 09E-05 and 09E-07 with the real serializer): 93,911 brands, 10,305 generics, 3,283 substances, 1,550 diagnoses; CDCI as compact JSON 7.06 MB raw, 1.53 MB gzip, 1.07 MB brotli; substances 88 kB raw, 36 kB gzip; diagnoses 374 kB raw, about 21 kB gzip. CDCI licence: CC BY 4.0, redistribution and derivatives within India (supabase/seed-data/cdci/License.txt)."
must_haves:
  truths:
    - "With 300 ms added to every Supabase call, a link click to a main screen shows its skeleton within 150 ms and its content within 1 s, a full reload within 1.5 s, and each main screen spends at most one round trip of database calls after the session; the latency lane fails the build when an enforced row is over budget."
    - "Typing in the medicine, diagnosis and allergy fields answers each keystroke from the device within 100 ms with no database call, with the same rows in the same order as the SQL search (one shared case table per catalogue, TypeScript twin against SQL), and falls back to the server route whenever the on-device index is not ready."
    - "The doctor's own custom medicines and diagnoses, favourites, usual doses, templates and macros arrive once with the consult, live in memory only, are merged into local search and are updated locally when a save changes them; no keystroke and no sheet opening reads them again."
    - "Every main save shows its result at once, is confirmed within 500 ms by exactly one database call, rolls back visibly when it fails, and never re-renders the whole page."
    - "The schedule loads its visible range in one call, has the adjacent day or week ready before it is asked for, computes free slots from the loaded data by the same rule as SQL, and shows a booking made in another browser within 2 s through the clinic's private live channel; the data layer serves any range up to 42 days, so the week grid and month views can plug in later."
    - "No patient data is stored on the device: only the global drug, diagnosis and substance lists live in one IndexedDB database, deleted at sign-out; patient and visit data stay in memory and are dropped at sign-out and clinic switch; no tenant data is cached across requests on the server unless the PO amends ADR-019 (C-1), and then never across clinics."
  artifacts:
    - "supabase/migrations/000122_consult_screen.sql, 000123_reference_catalogues.sql, 000124_schedule_range.sql; supabase/tests/database/{consult_screen,reference_catalogues,schedule_range}.test.sql"
    - "tests/e2e/support/{server-latency.cjs,latency.ts,perf-catalogue.ts}, tests/e2e/perf/{latency-budgets.ts,page-latency.spec.ts}, playwright project perf-latency, npm run perf:latency, the CI budget step"
    - "features/consultation/screen.ts, components/consultation/workspace/doctor-lists.ts, app/api/today/board/route.ts, components/shell/skeletons/*"
    - "lib/reference/{idb.ts,sync.ts,store.ts,trigram.ts,search-substances.ts,search-diagnoses.ts,search-medicines.ts,medicine-index.ts,worker.ts}, features/reference/{catalogues.ts,service.ts}, app/api/reference/manifest/route.ts, app/api/reference/[catalogue]/[version]/[shard]/route.ts, scripts/perf/reference-size.ts"
    - "lib/schedule/{slots.ts,range-store.ts}, lib/live/clinic-channel.ts, app/api/schedule/range/route.ts"
    - "tests/reference/{substance-search-parity,trigram-parity,diagnosis-search-parity,medicine-search-parity}.spec.ts, tests/schedule/slots-parity.spec.ts, tests/consultation/consult-screen-parity.spec.ts"
    - "the settings version store, migration 000125 and its specs (09E-09)"
  key_links:
    - "public.consult_screen (000122) is the consult page's only database read on its critical path; it calls the existing INVOKER reads (consult_assist_context, patient_snapshot, rx_allergy_context, my_entitlements) so the rules of 09B and 09C stay in one place."
    - "public.reference_catalogues versions change by statement triggers on every catalogue table, so any reload (seed, SQL console) gives the device a new version without app code; the shard read and the manifest carry that version and the device never mixes two versions."
    - "lib/reference/search-*.ts are twins of search_substances, search_diagnoses and search_medicines (ranks 1-4); one case table per catalogue runs against both; the three SQL functions break name ties with COLLATE \"C\" (000123) so the device and every database sort identically."
    - "lib/schedule/slots.ts is the twin of private.available_slots_core; one case table runs against both; the booking commands (slot_conflicts) stay the authority."
    - "lib/live/clinic-channel.ts is the one subscription to today:<tenant>; the Today board and the schedule store listen on it; payloads stay {kind, visit_id} with no PHI."
    - "Every in-memory store registers with lib/pwa/cleanup.ts, so hardSignOut and the clinic switch drop it; the purge keeps deleting every IndexedDB database at sign-out."
---

# V2-09e Caching and speed: plan

## Goal

Every click feels instant on staging, where each Supabase call costs 300 to 450 ms (Vercel bom1 to Supabase Sydney; the PO keeps
Sydney). We get there by making fewer calls, never more than one round trip of them per screen, and by answering the most frequent
interactions without the database at all: drug, diagnosis and allergy search run on the device from a versioned copy of the global
catalogues; the doctor's own lists arrive once with the consult and live in memory; saves show their result at once and are confirmed
by one call; the schedule keeps its visible range and the next one in memory and stays current through the clinic's private live
channel. Patient data never touches device storage. A latency lane that adds 300 ms to every Supabase call measures all of it locally
and fails the build when a budget is missed, so speed cannot regress silently.

Tracer: 09E-01 first proves the measurement path end to end on one row (a link click to Patients with 300 ms injected on the server
and in the browser, timed in the page and counted at Kong), and only then adds every row and records the baseline. Each later plan
starts with its own thinnest end-to-end slice and flips its budget rows to enforced when they pass.

## Current state (inventory 2026-11-23; tree at 66478f5d on v2/phase-09d-request-speed)

| Area | Today | Gap | Plan |
|---|---|---|---|
| Session and clinic context | V2-09d: identity from the verified JWT claims (`getClaims`, JWKS, no Auth call), a per-request memo (`lib/auth/request-memo.ts`), the signed 5-minute `clinic_ctx` cookie (`lib/auth/context-cookie.ts`); an in-app navigation makes no identity or context call; PR-lane ceilings Patients ≤ 3 and Today ≤ 6 calls per in-app navigation, Today full load ≤ 12 (`tests/e2e/shell/request-budget.spec.ts`) | Counts only, no time; a hosted project still on the legacy HS256 JWT secret falls back to one `getUser` per request (09D PO action) | 09E-01 |
| Consult page | `app/(dashboard)/consultation/[id]/page.tsx:44-240`: up to 16 reads awaited one after another, 14 for a draft (visit with patient and notes, token, history, follow-up, diagnoses, prescription, latest header, revision when amending, entitlements, assist context, snapshot, print source when sealed, macros, upcoming visits, documents, allergy context): 4 to 6 s at 300 to 450 ms per call | One round trip | 09E-02 |
| Consult interactions | An Rx change is `changePrescriptionAction`, then a read-back `getVisitPrescription` (`components/consultation/workspace/use-rx-lines.ts:134-142`), then `getRxAllergyContextAction` on every change of the lines (`consult-workspace.tsx:333-347`); server actions run one at a time per client, so three round trips in a row. The Templates sheet reads on opening and after a save (`rx-templates-sheet.tsx:43`, `:99`) | Per-doctor data read per interaction | 09E-02, 09E-04 |
| Typeahead | Three GET routes, `private, no-store`, one database call per debounced keystroke: `app/api/prescriptions/medicines/route.ts` (`search_medicines`, 000117:69; 150 ms debounce, 09C R-5), `app/api/terminology/diagnoses/route.ts` (`search_diagnoses`, 000114:38; abbreviation expansion when `assist.terminology`), `app/api/terminology/substances/route.ts` (`search_substances`, 000118:469). Name ties sort by `lower(name)` in the database's collation | 300 to 650 ms per keystroke on staging | 09E-05 to 09E-07 |
| Catalogue sizes | `supabase/seed-data/cdci/` (CC BY 4.0, within India): 93,911 brands, 10,305 generics, 3,283 substances; `supabase/seed-data/terminology/diagnoses.json`: 1,550 diagnoses. Compact JSON measured at planning: CDCI 7.06 MB raw, 1.53 MB gzip, 1.07 MB brotli; substances 36 kB gzip; diagnoses about 21 kB gzip. The local stack's CDCI tables hold only test fixtures (`seed:cdci` targets the hosted project and is never run) | Real-size data for local measurement | 09E-05, 09E-07 |
| Today live | `components/today/use-today-live.ts:104`: each coalesced signal runs `router.refresh()`, re-rendering the whole Today page (all its reads); the shell's resume refresh does the same (`components/shell/app-shell.tsx:107`) | A refresh costs a page | 09E-03 |
| Saves | Hot actions call `revalidatePath` (`features/queue/actions.ts`, `features/consultation/actions.ts`, `features/terminology/actions.ts`, `features/visits/actions.ts`, `features/billing/actions.ts`), so the action's response re-renders the page's loaders on the critical path | One call per save | 09E-04 |
| Schedule | `features/schedule/queries.ts`: `available_slots(doctor, date)` once per (doctor, date), sent together since 09D (ebdb64e5); no range read; no client cache; no live updates on `/schedule`; the booking sheets ask `getAvailableSlots`, `getSlotAssist` and `getScheduleBlocksForDate` through server actions (`components/front-desk/slot-section.tsx`, `slot-adapter.ts`) | Range read, prefetch, live, slots on the client | 09E-08 |
| Loading and prefetch | `loading.tsx` on 12 segments; Today, Schedule, Patients, Settings, Staff and others show the generic `RouteSkeleton` (`components/shell/route-skeleton.tsx`), not a layout-matching skeleton (DESIGN §6.9); the consult has its own. Navigation uses `next/link` (default prefetch: down to the loading boundary); `components/schedule/day-grid.tsx:58` sets `prefetch={false}` | Layout-matching skeletons, streaming | 09E-03 |
| Patient page | `features/patients/service.ts:186-190` awaits a `patient.view` audit insert before rendering: a write on a read's critical path | Off the critical path | 09E-03 |
| Clinic config | Per request through the 09D memo (the layout reads memberships with the clinic name and zone once); other config reads per screen (settings service, fees, doctor directory `features/staff/actions.ts:258-270`, the PDF payload). No cross-request cache (ADR-019) | C-1 | 09E-03 (in each screen's read), 09E-09 |
| Server caching | None: 0 hits for `unstable_cache`, `"use cache"`, `revalidateTag`; Next 16.4.6 without `cacheComponents` | Global reference data only (ADR-019) | 09E-05 |
| Perf tooling | `npm run perf:roundtrips` (Kong access-log counter `tests/e2e/support/kong-calls.ts`, `tests/e2e/perf/page-roundtrips.spec.ts`), the PR-lane ceilings above, `scripts/perf/command-latency.ts` (database p95), LHCI nightly | No latency injection, no time budgets | 09E-01 |

Gate scripts today: pgTAP FLOOR 9025 (`scripts/ci/assert-pgtap-report.mjs:158`), Vitest FLOOR 6455 (`assert-vitest-report.mjs:143`, re-measured
once at the close), `EXPECTED_MIGRATION = "000120"`, the consult route's first-load JS against the 200 kB report-only budget (`npm run
ci:route-js`), e2e job timeout 95 minutes with the PR lane at about 85.

## Conflicts for the PO

Where the approved strategy meets an approved document, the document stands until the PO answers; the plan builds what does not
conflict and parks what does.

| # | Strategy item | Approved document | What the plan does until answered | Recommendation |
|---|---|---|---|---|
| C-1 | 3: a server cache per clinic for its settings, doctors, schedules, fees, letterhead and zone, invalidated by tag on every write, short time-to-live | ADR-019 "No cross-request caching of tenant data"; TARGET §9 "Tenant data is not cached across requests (PHI, correctness)" | No server cache of clinic data. The same speed comes another way: each screen's single read (09E-02, 09E-03, 09E-08) carries the clinic data it needs, the 09D memo makes it one read per request, and the browser keeps the doctor list and schedules in memory for the tab, refreshed by the live channel. 09E-09 is planned in full and built only if the PO amends ADR-019 | Keep ADR-019 for now. 09E-09's first step reports, from the lane, whether any clinic-config call is still on a critical path after 09E-08. If one is, amend ADR-019 for non-patient clinic settings only (key and tag carry the clinic, 60 s backstop) and build 09E-09 |
| C-2 | 1: the catalogues stored in IndexedDB | PWA §4 verification: the cache audit "asserts that `indexedDB.databases()` is empty"; D-5's purge deletes every IndexedDB database at sign-out. D-3 forbids PHI in IndexedDB, not reference data | Nothing until answered: 09E-05 starts only after C-2. If refused, the catalogues stay in memory for the tab and are downloaded again on each app start (HTTP-cached, so mostly not re-transferred) | Amend PWA §4: one allowed database, `cliniq-reference`, holding only the global drug, diagnosis and substance lists (no patient, clinic, user or visit data, no ids of any of them); the cache audit checks its stores and record shapes; the purge keeps deleting it at sign-out (one re-download, about 1.5 MB, after each sign-in) |
| C-3 | 1: a search result within 100 ms of the keystroke | DESIGN_SYSTEM §5 Combobox: "typeahead debounce 200 ms" (the 09C Rx field uses 150 ms) | Server-backed search keeps its debounce | Amend the Combobox rule: the debounce applies to server-backed search; on-device search answers each keystroke, coalesced to one search per animation frame |

Not conflicts, recorded: the reference shards are served `Cache-Control: private, max-age=31536000, immutable` under versioned URLs
(browser only, never shared or CDN; D-4 governs HTML and RSC, and the sign-out's `Clear-Site-Data: "cache"` empties the HTTP cache);
production must still be in Mumbai (PO-6, PO-12), where the budgets below hold with large headroom; FRONTEND_TECHNOLOGY §5's TanStack
Query decision gate is met (four surfaces now cache on the client) and is decided by R-14.

## Measured baseline to collect (09E-01, before any product change)

All numbers come from tool output written to `.planning/phases/09E-caching-speed/evidence/baseline/` (`perf-roundtrips/summary.{json,md}`,
`perf-latency-0ms/summary.{json,md}`, `perf-latency-300ms/summary.{json,md}`). Nothing is typed by hand. Each row: median and max of 5
samples after one warm-up, Supabase calls by path from Kong (server and browser), and, from the two latency runs, the critical-path
depth = (median at 300 ms − median at 0 ms) ÷ 300, rounded.

| Group | Rows (receptionist R, doctor D, owner O) | Start and end of the measurement |
|---|---|---|
| Pages, in-app | R: Today, Schedule day, Schedule week, Patients, a patient, Visits, Billing reports. D: Today (doctor mode), a consult in draft, a sealed consult, a patient. O: Settings clinic, Staff | Click on the nav or row link (real `next/link`, so prefetch is real) → the skeleton visible → the page's first data element visible (a lane count, the first row, the Rx entry row or the signed lines, the first grid slot) |
| Pages, full load | The same pages | `page.goto` → first data element visible; plus Navigation Timing `responseEnd` |
| Typeahead | D: medicine (Rx field), diagnosis, allergy substance. R: patient search (Today and registration) | Keydown of the last character → the listbox's first option shows the expected text (timed in the page with `performance.now()` and a MutationObserver installed before the key) |
| Saves | R: check in, register and book, book from Schedule, move, cancel, collect payment. D: start consult, draft autosave, add diagnosis, add an Rx line by keyboard, edit an Rx line, record allergies, finish (sign and finish) | Click or Enter → optimistic state visible (if any) → server-confirmed state visible; RSC page requests the action caused (re-renders) counted from the network log |
| Live | R: a check-in made in a second browser | Commit in context B → the row moves in context A; Supabase calls per refresh |
| Reference | Catalogue row counts on the local stack; the real files' counts above | Re-measured with the serializer in 09E-05 and 09E-07 (`scripts/perf/reference-size.ts`) |

09E-01 ends by listing in the notes the rows over budget, sorted by milliseconds over. The plan order below follows the expected
ranking (consult and Rx saves first); the PO may reorder after seeing it.

## Budgets (proposed; with 300 ms added to every Supabase call, desktop-chrome, medians of 5)

| # | Measure | Budget | Database calls on the critical path | Enforced by |
|---|---|---|---|---|
| B-1 | In-app navigation (link click) to Today, Patients, a patient, a consult, Schedule, Visits, Billing reports, Settings, Staff: content visible | ≤ 1,000 ms (max ≤ 1,300) | 1 round trip (calls in parallel), count ceiling per row from the baseline | 09E-02, 09E-03, 09E-08 |
| B-2 | The same click: skeleton visible | ≤ 150 ms | 0 | 09E-03 |
| B-3 | Full reload of the same screens: content visible | ≤ 1,500 ms | ≤ 2 round trips (layout, page) | 09E-02, 09E-03 |
| B-4 | Typeahead (medicine, diagnosis, substance): last keystroke → results, Chromium at 4× CPU slowdown | ≤ 100 ms (max ≤ 150) | 0 | 09E-05 to 09E-07 |
| B-5 | Patient search keystroke → results (PHI, server only) | ≤ 700 ms after the last keystroke (200 ms debounce + one call + render) | 1 per settled query | 09E-03 (measured), not changed |
| B-6 | Save → its result visible (optimistic) | ≤ 100 ms | 0 | 09E-04 |
| B-7 | Save → confirmed by the server (check in, book, move, cancel, collect, start consult, draft save, diagnosis add, Rx add, edit, remove, allergies) | ≤ 500 ms | 1, and no page re-render | 09E-04 |
| B-8 | Finish visit (sign and finish) → success screen | ≤ 1,000 ms | ≤ 2 | 09E-04 |
| B-9 | Schedule: adjacent day or week (prefetched) shown | ≤ 100 ms | 0 | 09E-08 |
| B-10 | Schedule: any other range shown | ≤ 600 ms | 1 | 09E-08 |
| B-11 | A change made in another browser visible on Today or Schedule | ≤ 2,000 ms | 1 per refresh | 09E-03, 09E-08 |
| B-12 | Reference data: CDCI index transferred | ≤ 1.6 MB (gzip as served) per version; ≤ 10 MB in IndexedDB; worker index build ≤ 1,500 ms at 4× CPU; worker JS heap ≤ 40 MB after the build | 0 during use | 09E-07 |
| B-13 | First-load JS of `/consultation/[id]` and `/today` | Grows by ≤ 10 kB gz over the 09E-01 measurement (worker and index load after first paint) | n/a | 09E-05 to 09E-07 |

The lane runs at 300 ms because it is the low end of the staging cost; a budget met there with headroom also holds at 450 ms for
1-round-trip rows. Budgets may be tightened (never loosened) after 09E-01 within a plan; loosening one is a PO question.

## Rulings

CTO rulings under the lean process. Where the documents are silent the default is recorded here and in PO questions; the PO may
overturn any of them at the gate.

| # | Ruling | Why / how |
|---|---|---|
| R-1 | **Scope.** Strategy items 1 to 7 as planned below, item 3 as the device-held settings design in 09E-09 (no server cache). Out: the calendar views (week time grid, month view), V2-10 billing, a region move, Redis or CDN caching, offline writes, PHI on the device, caching in the service worker, on-device patient search, Lighthouse and k6 blocking (V2-15) | PO brief; ADR-019; PWA §4 |
| R-2 | **Measure first, by tool.** Every budget is a row in `tests/e2e/perf/latency-budgets.ts` (`id`, `kind`, `budgetMs`, `maxMs`, `maxCalls`, `enforce`, `owner`). 09E-01 adds every row with `enforce: false` except the calibration row; each plan flips its rows to `enforce: true` in the commit that meets them. Numbers in notes, summaries and the verification come from the lane's JSON only | CLAUDE.md DoD 5 |
| R-3 | **Latency injection** (no new dependency). Server side: a preload `tests/e2e/support/server-latency.cjs` loaded through the e2e app env's `NODE_OPTIONS` beside the network guard and the auth-fault hook (the `server-auth-faults.cjs` precedent): while the rule file `playwright/.auth/latency.json` = `{ "ms": N }` exists, every `fetch` to the local Supabase origin (loopback, port 54321) waits N ms before it is sent; anything else is untouched; the file is read with an mtime check, so no restart. Browser side: `context.route` on the Supabase origin waits N ms then continues (HTTP only; the Realtime socket is not delayed and the report says so). The lane writes the file in `beforeAll`, removes it in `afterAll`, and global setup deletes a stale one. Calibration row (always enforced): a route whose Kong count is k takes at least k × N ms with the file and less than N ms without. Rejected: Docker `tc netem` on Docker Desktop (needs `NET_ADMIN`, an image pull with `tc`, delays Kong's upstream hops too and every lane sharing the stack) and a delaying proxy port (the Supabase URL is inlined at build time, so it would need a second build) | Deterministic, per-call, reversible without a rebuild |
| R-4 | **Budgets** as the table above. The lane runs on desktop-chrome; typeahead and index rows add Chromium's 4× CPU slowdown (CDP `Emulation.setCPUThrottlingRate`) as the stand-in for the low-end Android of PO-13; the real phone is the device checklist. In CI the `@budget` subset (calibration, the B-1 rows of Today, Patients, consult and Schedule, one B-4 row per catalogue, B-7 for check in and Rx add) runs after the PR lane on every PR; the full lane runs nightly and at the gate. A budget row that fails once is root-caused like a flaky test, never re-run to green | CI time (95-minute job); flaky-test policy |
| R-5 | **Reference catalogues on the device** (strategy 1). Catalogues: `substances` (`cdci_substances`), `diagnoses` (`opd_diagnoses`), `medicines` (`cdci_medicines_search` brands with their generic and its `substance_ids`). Version: `public.reference_catalogues(catalogue, version uuid, changed_at)` bumped by statement triggers on every catalogue table (insert, update, delete, truncate), so any reload changes it without app code. Shards: `public.reference_shard(p_tenant_id, p_catalogue, p_shard)` (INVOKER, member with the catalogue's permission) returns compact rows of one shard (`substances` and `diagnoses` 1 shard; `medicines` brands in shards of 12,000 by id plus one generics shard), each shard ≤ 1 MB raw (Vercel's 4.5 MB response limit and the data-cache entry size). Routes: `GET /api/reference/manifest` (`private, no-cache`, ETag; the versions and shard counts of the catalogues the caller may read) and `GET /api/reference/{catalogue}/{version}/{shard}` (`private, max-age=31536000, immutable`; a version that is not current is 409 with `no-store`). Server cache: `unstable_cache` for the versions (tag `reference`, 300 s) and for each shard keyed by catalogue, version and shard (global reference data only, ADR-019). Device: IndexedDB `cliniq-reference` (platform API, a small promise wrapper, no dependency) with stores `meta` and `rows`; a sync step fetches the manifest at app start, on resume and before the first search, downloads only missing shards after first paint (`requestIdleCallback`), verifies that every shard carries the manifest's version, stores them, then deletes older versions. IndexedDB unavailable or over quota: memory only for the tab. Until a catalogue is ready, its search uses the existing route; the UI never waits for the download | Strategy 1; ADR-019; Vercel limits |
| R-6 | **Search parity.** For each catalogue a pure TypeScript twin of the SQL search (`lib/reference/search-*.ts`) and one case table run against both (the 09C allergy-rule pattern, `tests/prescriptions/allergy-match.spec.ts`): same ids, same order, same limit. A pg_trgm `similarity()` twin (`lib/reference/trigram.ts`: lower-case, words of alphanumerics, two leading spaces and one trailing, distinct trigrams, \|A∩B\| ÷ \|A∪B\|) with its own table against SQL. Name ties sort by `lower(name) COLLATE "C"` in the three SQL functions (000123 replaces their bodies, the tie-break only), so the device and every database agree whatever their default collation. Non-ASCII names are in every table, so a `lower()` difference shows as a failure | One rule, two implementations, one table |
| R-7 | **Medicines on the device.** A columnar index in a Web Worker (one lower-cased string of brand names with an offsets array, generic index per brand, one string of generic names, substance ids per generic): ranks 1 to 4 of `search_medicines` (brand prefix, a word of the brand, generic prefix or word, inside) are computed locally with exact parity; rank 5 (trigram ≥ 0.3 on 93,911 brands) is not: when the local ranks give fewer rows than the limit (15), the route is asked once and its answer replaces the list when it arrives (the database is the authority for the tail). The doctor's own custom medicines (in memory, R-8) come first by `use_count` with the trigram twin, and a CDCI row with the same name as a custom one is dropped, as in SQL. A CDCI row never carries a dose (09C R-4). If B-12 fails on the measured index, the fallback ships generics and substances on the device and keeps brands on the server (recorded, PO informed) | B-4 without a 15 MB trigram index on a phone |
| R-8 | **Per-doctor data in memory** (strategy 2). `consult_screen` returns the caller's own custom medicines (up to 500 by `use_count`), custom diagnoses (up to 500), protocol templates (up to 100), macros, favourites and usual doses (the 09C `consult_assist_context` keys) and the learned order. They live in `components/consultation/workspace/doctor-lists.ts` for the consult's lifetime, are never written to any storage, are updated locally from each save's result (a custom medicine's `use_count + 1` and stored dose exactly as `change_prescription` does, 09C R-2; a custom diagnosis likewise; a saved template or macro), and register with `lib/pwa/cleanup.ts` | Strategy 2; PWA D-3 |
| R-9 | **One round trip per screen; PHI stays off the device** (strategy 5). A page awaits its independent reads together (`Promise.all`); a read that needs another's result, or slow data the first paint does not need (the next-up snapshot on Today, the print view of a sealed consult, a patient's history and documents), streams in a `Suspense` boundary with its own skeleton. The consult gets one read function (000122) because its reads are many and cross-region TLS makes parallel connections costly; other screens stay on their existing reads. PHI responses stay `private, no-store`. No PHI route is prefetched beyond its loading boundary (Next's default for dynamic routes); `/patients/[id]` never, because opening it records `patient.view`. Next's `staleTimes` stays at its default (dynamic pages are fetched again on navigation) | DATA_HANDLING §3; PWA D-3, D-4 |
| R-10 | **Schedule data layer** (strategy 4). `public.schedule_range(p_tenant_id, p_from date, p_to date)` (INVOKER, `appointments:view`, at most 42 days) returns the clinic zone, the clinicians (id, display name, slot minutes, effective weekly schedule), the schedule blocks and the visits of the range with the fields the cards show today. Slots are computed on the client by `lib/schedule/slots.ts`, the twin of `private.available_slots_core`, with a shared case table; the booking commands' `slot_conflicts` stays the authority and a refusal is shown as today. `lib/schedule/range-store.ts`: `useScheduleRange({ from, to, doctorIds })` → `{ zone, doctors, visits, blocks, slotsFor(doctorId, date), status }`, one call per range, adjacent range prefetched after the visible one settles, kept in memory per tab (at most 6 ranges), dropped by hardSignOut and the clinic switch. Live: `lib/live/clinic-channel.ts` subscribes once to `today:<tenant>`; 000124 adds kinds `block` (schedule_blocks insert, update, delete) and `hours` (memberships when the schedule, slot length, role or status changes) and widens the visit kind to duration, overbooking and origin changes; payload keys stay `kind` and `visit_id` (null for the new kinds); on a signal the store re-reads the visible range (coalesced 400 ms, the Today rule) and marks other cached ranges stale. Day and week views read the store; a 42-day range in one call is tested, so the week grid and the month view plug in later | Strategy 4; 08 R-10 |
| R-11 | **Saves** (strategy 5). Each hot save shows its result at once (a pending marker), calls one command, applies the command's result or what it sent (no read-back), and does not call `revalidatePath` on its hot path; Today and Schedule reconcile through the live channel, other screens on their next navigation. A failure removes the pending result, restores the previous state and shows the fixed error with Retry (`useCommand` semantics, the same request id); "Saved" is never shown before the server confirmed | DESIGN §6.9; ADR-004 |
| R-12 | **Instant feel** (strategy 6). Every main route has a `loading.tsx` with a skeleton that matches its layout (DESIGN §6.9: static `sunken` blocks, the real page title at once); navigation keeps `next/link` with the default prefetch; the `patient.view` audit insert moves after the response (`after()` from `next/server`; still written once per opening, failures logged by tag) | DESIGN §6.9 |
| R-13 | **Per-clinic config** (strategy 3). Device-held with a version check, critical settings always fresh; design in 09E-09 (PO 2026-11-23) | ADR-019 |
| R-14 | **No client-cache library.** The four client caches (reference catalogues, doctor lists, schedule ranges, the Today board) each have their own invalidation (version, save result, live signal); a small keyed store per surface (`useSyncExternalStore`, in-flight dedupe, `registerCleanup`) is less code than adopting and constraining TanStack Query to "memory only, purge on sign-out". This is the FRONTEND_TECHNOLOGY §5 decision gate's answer; the PO is informed | No new dependency |
| R-15 | **Platform rules.** No service-role client (ADR-0005): reads under the caller's JWT, INVOKER, tenant from the session; routes authenticate, check the permission and derive the tenant from the session. No PHI in IndexedDB, localStorage, sessionStorage, Cache Storage or the HTTP cache. Dates through `lib/datetime` (ADR-016); slots in the clinic zone. No per-flow flags (PO-15). No new dependency (IndexedDB, Web Workers, compression and timing use platform APIs) | CLAUDE.md non-negotiables |
| R-16 | **Evidence and latency.** `node scripts/phase-evidence.mjs .planning/phases/09E-caching-speed/evidence 1`, then `--ci-run <id>`; the baseline and final `perf-latency` and `perf-roundtrips` summaries; `reference-size.json`; `scripts/perf/command-latency.ts` gains `consult_screen` (300 signed visits for one doctor), `schedule_range` (42 days, 3 doctors, 600 visits) and `reference_shard` (12,000 brands) with p95 under 50 ms, 50 ms and 200 ms | CLAUDE.md DoD 5 |
| R-17 | **Migrations.** New files only; a replaced function starts from its latest body (`grep -n "FUNCTION <name>" supabase/migrations/*.sql`) and changes only what the plan names; additive (new reads, a table, triggers, replaced tie-breaks); no grant widening beyond EXECUTE on the new reads and SELECT on the new table for `authenticated` | CLAUDE.md |

## Shared rules for every plan

- Read functions: INVOKER, STABLE, `search_path = ''`, every name schema-qualified, `p_tenant_id` from the session and checked in the body
  with `public.has_permission` (a forged id returns nothing), EXECUTE for `authenticated` only, the narrowest output; each gets a pgTAP file
  (grants, refusal for another clinic and for roles without the permission, output shape) and a `command-latency.ts` entry.
- Registries a migration or route touches: `tests/security/guard-manifest.ts` and `npm run inventory` for every added or removed action or
  route, the pgTAP grantee sets (`grants.test.sql`), the schema snapshot (`node scripts/drift/schema-snapshot.mjs --local --write`, then
  `--check`; `npm run db:drift:local`), `npm run db:types`, `app/api/ready/expected-migration.ts`, `scripts/ci/assert-pgtap-report.mjs`
  (REQUIRED_FILES and FLOOR = the measured total with the arithmetic) and `scripts/ci/assert-vitest-report.mjs` REQUIRED_FILES, all in the
  migration's commit.
- Affected-test discovery: before editing, grep for what the plan changes and list the hits in the notes, for example
  `grep -rln "consultation/\[id\]\|getVisitPrescription\|getRxAllergyContextAction\|getDoctorProtocolTemplates\|fetchMedicines\|fetchDiagnosisHits\|fetchSubstances\|search_medicines\|search_diagnoses\|search_substances\|available_slots\|getAvailableSlots\|useTodayLive\|router.refresh\|revalidatePath\|RouteSkeleton\|indexedDB\|purge" tests scripts`,
  narrowed per plan. The grep, not any list in this plan, is authoritative.
- Each e2e test owns its data (`tests/e2e/support/own-doctor.ts`, its own patients); synthetic catalogue rows are global fixtures with
  fixed ids (`test-ref-*` for parity, `perf-*` for the perf catalogue) upserted by the test that needs them; the perf catalogue is removed by
  the lane's teardown. No test reads `.env*`; synthetic data only.
- Tests assert real outcomes (rows, ids, order, bytes, timings from the page, Kong counts, IndexedDB contents, DOM state), never source text
  or "renders". One "fails without" proof per High control. No mutant runs. E2E on desktop-chrome, pixel-7 and iphone-15 with 0 retries
  where the behaviour depends on the device (IndexedDB, the worker, skeletons, touch); timing rows on desktop-chrome only. Axe 0 serious
  or critical at 360, 820 and 1280 for every new skeleton and state.
- UI work: V2-06 parts, no hex or raw palette class, `dvh` not `vh`, 44 px touch targets below 1024, no new React Compiler waiver,
  `npm run ci:ui-policy` and `npm run ci:ai-l1` clean.
- Plan record: each executor appends a section to `.planning/phases/09E-caching-speed/09E-NOTES.md` (what changed, deviations, grep hits,
  test names, the exact commands with counts, the lane rows it flipped with their medians copied from the JSON). Evidence is never typed.
- Run order inside a plan: migration first (`npx supabase db reset --local`, `npm run db:types`), then service, then UI, then specs; then the
  affected Vitest and pgTAP files, `npm run typecheck`, `npx eslint .`, `npm run inventory`, `npm run e2e:build` (always rebuild first), the
  plan's e2e files, and `npm run perf:latency` (the plan's rows enforced). Delete `.planning/dev-messages.txt` if a run recreates it.
- Never run `seed:cdci*`, `seed:diagnoses`, `msg91:*` or anything with `--env-file=.env`; never read `.env*`; local stack only. Reading
  `supabase/seed-data/**` files from a script that touches no database is allowed (09E-05, 09E-07 size measurement).

## Plans

### 09E-01 Latency lane and baseline · M · no migration, no product code

Goal: R-2 to R-4. Every main page, typeahead and save is timed locally with 300 ms added to every Supabase call; the baseline is recorded;
the lane can fail the build.

Files: new `tests/e2e/support/server-latency.cjs`; `tests/e2e/support/app-env.ts` (third preload in `NODE_OPTIONS`); `tests/setup/test-env.ts`
and `tests/setup/e2e-app-env.spec.ts` where they pin the preload list; new `tests/e2e/support/latency.ts` (`setSupabaseLatency(context, ms)`,
`clearSupabaseLatency()`, in-page timers `timeToVisible(page, trigger, locator)` and `timeToOption(page, key, expected)`); `tests/e2e/global-setup.ts`
(stale rule file removed); new `tests/e2e/perf/latency-budgets.ts`; new `tests/e2e/perf/latency-pages.ts` (the rows: URL, role, link to click,
first data element, using `today-page.ts`, `schedule-page.ts`, `rx-entry.ts`); new `tests/e2e/perf/page-latency.spec.ts`; `playwright.config.ts`
(project `perf-latency`, desktop-chrome, retries 0); `package.json` (`perf:latency`; the spec reads `PERF_LATENCY_MS`, default 300, and `PERF_LATENCY_MS=0` gives the reference run); `.github/workflows/ci.yml` (step
"Latency budgets" after the PR lane: `npx playwright test --project=perf-latency --grep @budget`); new `tests/perf/server-latency.spec.ts`.

1. Tracer (committed first). `server-latency.cjs` and `latency.ts`, then one row: receptionist on Today clicks the Patients nav link; the
   page timer records click → skeleton → first row; Kong counts the window; the report writes one line. Calibration row: measure the Kong
   count k of `GET /api/ready` (or the cheapest route with k ≥ 1, recorded) and assert ≥ k × 300 ms with latency and < 300 ms without.
   Acceptance: calibration green; the row's time at 300 ms exceeds its time at 0 ms by at least 300 ms.
2. Rows: every row of the baseline table, with `@budget` on the CI subset (R-4). Saves need their own data each sample (`seedBookedToday`,
   own doctor, fresh visits); typeahead rows type the query less one character, settle, then time the last key in the page. The report:
   `test-results/perf-latency/summary.{json,md}` with per row median, max, budget, enforced, server and browser calls by path, and RSC
   requests counted from `page.on("request")` (a save that re-renders its page shows up here). The spec fails when an enforced row's
   median is over `budgetMs`, its max over `maxMs` or its server calls over `maxCalls`.
3. Unit: `tests/perf/server-latency.spec.ts` loads the preload with a fake inner `fetch`: delayed only for the loopback Supabase origin, only
   while the rule file exists, never for other origins or after the file is removed, the delay equals the file's value.
4. CI step (report only until a plan enforces a row; the calibration row is enforced from this plan).
5. Baseline (R-2): on the tree as branched, `npm run e2e:build`, `npm run perf:roundtrips`, `npm run perf:latency` at 0 ms and at 300 ms;
   copy the three summaries to `evidence/baseline/`; the notes list the rows over budget, sorted.

Tests: `npx vitest run tests/perf tests/setup/e2e-app-env.spec.ts`; `npm run perf:latency`; the PR lane is not affected (no product change).
Done: calibration green locally and in CI; baseline files committed; every budget row present in `latency-budgets.ts` with its owner plan.

### 09E-02 The consult opens in one round trip; the doctor's lists in memory · M-L · migration 000122_consult_screen

Goal: R-8, R-9 for the consult. The consult page makes one database call on its critical path; the doctor's own lists arrive with it and
the Templates sheet opens with no call.

Files: `supabase/migrations/000122_consult_screen.sql`; new `supabase/tests/database/consult_screen.test.sql`; new `features/consultation/screen.ts`
(zod view model from the read; the record-state rules stay in TypeScript, `recordState`); `app/(dashboard)/consultation/[id]/page.tsx`; new
`components/consultation/workspace/doctor-lists.ts`; `components/consultation/workspace/{consult-workspace.tsx,rx-templates-sheet.tsx}` and
the sections that take favourites, usual doses and macros; new `tests/consultation/consult-screen-parity.spec.ts`; `scripts/perf/command-latency.ts`;
`tests/e2e/perf/latency-budgets.ts`; the fixture fallout; registries.

1. Tracer. `consult_screen` returning only the visit with its patient and notes, the diagnoses and the Rx lines; the page renders a draft
   consult from it; the lane's `nav.consult.draft` row measured. Acceptance: one Supabase call in the window for the visit, the Rx entry row
   visible, the old path still in place for the other parts.
2. Migration 000122: `public.consult_screen(p_tenant_id uuid, p_visit_id uuid) RETURNS jsonb`, STABLE INVOKER, `consultations:view` (NULL when the
   visit is not readable, the page then answers 404 as today). Keys and their gates, exactly as the page gates them today: `visit`, `patient`,
   `notes` (with `draft_version`), `token_number`, `follow_up`, `diagnoses`, `prescription` (`items`, `latest_version`), `amendment` (reason and
   opened at, from the latest revision), `history` (the shape `getPatientConsultationHistory` returns, the current visit excluded),
   `entitlements` (the `assist.*` map from `public.my_entitlements`), `assist_context` (`public.consult_assist_context`, when
   `consultations:edit` and `assist.terminology` or `assist.frequent_rx`), `snapshot` (`public.patient_snapshot`, when `assist.snapshot`),
   `macros` (the caller's, when `consultations:edit` and `assist.shorthand`), `upcoming` (when `assist.followup`), `documents` (when
   `labs:view`), `allergy_context` (`public.rx_allergy_context`), `my_lists` (`custom_medicines`, `custom_diagnoses`, `templates`: the caller's
   own rows only, `doctor_id = auth.uid()`, capped per R-8; when `prescriptions:edit` or `consultations:edit`). The print payload of a sealed
   record stays a separate read, streamed under `Suspense` (R-9). Header comment: "a new INVOKER read composed of existing reads; no table,
   policy or grant change beyond EXECUTE".
3. Page and store. The page makes one call, maps it through `screen.ts`, applies `recordState` (macros, upcoming and assist only for an
   editable record), and seeds `doctor-lists.ts`; favourites, usual doses, macros and the Templates sheet read the store; saving a template
   or macro updates the store from the action's result; nothing re-reads them. The 14 sequential reads are deleted from the page (their
   services stay where other callers use them).
4. Specs. `consult-screen-parity.spec.ts` (before the old path is deleted): for a draft, an amending, a sealed, an unsigned completed and a
   cancelled visit, and for owner, the visit's doctor, another doctor, nurse and receptionist, the view model from `consult_screen` deep-equals
   the one built from the old reads; the committed spec then compares against stored expectations. pgTAP `consult_screen.test.sql`: grants;
   another clinic's visit and a forged tenant return NULL; the role × part matrix (nurse no `my_lists`, receptionist NULL, labs part only with
   `labs:view`); another doctor's custom medicines, diagnoses, templates and macros never returned; entitlement off → part absent. e2e: opening
   Templates makes 0 Supabase calls (Kong window); the existing consult specs pass unchanged in intent. Latency rows `nav.consult.draft`,
   `nav.consult.sealed`, `full.consult` enforced (B-1, B-3); `command-latency.ts` `consult_screen` p95 < 50 ms.

Tests: Vitest `tests/consultation tests/prescriptions tests/terminology`; pgTAP `consult_screen` and the 09B/09C read files; e2e `tests/e2e/consult`.
Done: B-1 and B-3 green for the consult; parity table green before the old path is deleted.

### 09E-03 Every other main screen in one round trip; skeletons, streaming, a light live refresh · M · no migration

Goal: R-9, R-12. Today, Patients, a patient, Visits, Billing reports, Settings and Staff meet B-1 to B-3; Today's live refresh reads only the
board.

Files: `app/(dashboard)/{today,patients/(list),patients/[id],visits,billing/reports,settings/clinic,settings/billing,settings/developer,staff,profile,referrals}/page.tsx`
and their `loading.tsx`; new `components/shell/skeletons/{today-skeleton,list-skeleton,patient-skeleton,schedule-skeleton,settings-skeleton}.tsx`;
`features/today/queries.ts`; new `app/api/today/board/route.ts`; `components/today/{use-today-live.ts,today-board.tsx}`; `components/shell/app-shell.tsx`
(the resume refresh of Today uses the board read); `features/patients/service.ts` (`after()` for the view audit); `components/schedule/day-grid.tsx`
(`prefetch` per R-9); `tests/e2e/shell/request-budget.spec.ts` (ceilings lowered to the new counts); `tests/e2e/shell/loading-states.spec.ts` (with its `support/slow-navigation.ts` helpers);
`tests/e2e/today/today-live.spec.ts`; `tests/e2e/perf/latency-budgets.ts`.

1. Tracer. Today (front-desk mode): the board, open amendments and entitlements awaited together, the next-up snapshot streamed in
   `Suspense`; the layout-matching Today skeleton; rows `nav.today` and `skeleton.today` enforced.
2. The other pages, one by one: independent reads in one `Promise.all`; dependent or slow parts streamed (the patient's history and
   documents; billing report aggregates; staff invitations). Each gets a skeleton matching its layout (DESIGN §6.9; the page title real at
   once). `/billing/register` is a redirect and needs none.
3. Today live: `GET /api/today/board?mode=` (`appointments:view`, `private, no-store`, the board model `getTodayBoard` already builds) and
   the board keeps it in client state; `use-today-live.ts` and the shell's resume refresh call it instead of `router.refresh()`; the board
   registers with `lib/pwa/cleanup.ts`.
4. `patient.view` moves to `after()`; the audit row is still written once per opening.
5. Specs. Latency rows B-1, B-2, B-3 enforced for every page in this plan. `request-budget.spec.ts` ceilings set to the measured counts
   (lower than 09D's). `today-live.spec.ts`: a check-in in context B appears in context A within 2 s and the refresh costs exactly one
   Supabase call (B-11). `loading-states.spec.ts` extended: with 300 ms injected, each page's skeleton is visible between the click and the content, at
   360, 820 and 1280, axe clean. A patient page opening writes one `patient.view` row; hovering and focusing its link writes none.

Tests: Vitest `tests/today tests/patients tests/auth`; e2e `tests/e2e/today tests/e2e/shell tests/e2e/journeys/journey-03-register-patient.spec.ts`, then the full PR lane once.
Done: every B-1 to B-3 row of this plan enforced and green; the PR lane green with 0 retries.

### 09E-04 Saves: shown at once, confirmed by one call · M · no migration

Goal: R-11. Every save in B-7 and B-8 meets its budget; Rx changes no longer read back or re-read the allergy context.

Files: `components/consultation/workspace/{use-rx-lines.ts,consult-workspace.tsx,doctor-lists.ts}`, `features/prescriptions/allergy.ts` (used, not
changed), `features/terminology/actions.ts`, `components/consultation/workspace/sections/diagnosis-section.tsx`, `features/queue/actions.ts`,
`features/visits/{actions.ts,scheduling.ts}`, `features/billing/actions.ts`, `features/consultation/actions.ts`, the Today row and sheet components
that call them, `components/front-desk/*-sheet.tsx`; `tests/e2e/perf/latency-budgets.ts`; affected specs.

1. Tracer: an Rx line added by keyboard shows at once with a pending marker; one `changePrescriptionAction`; the line is built from what was
   sent plus the returned id (the catalogue name, generic and form for a CDCI line, as 000120 stores them); allergy matches recomputed with
   the TypeScript twin from the consult's allergy context (no `getRxAllergyContextAction`; the context is re-read only after the allergy
   editor saves); the doctor's custom medicine updated in `doctor-lists.ts` as R-2 of 09C does in SQL. Row `save.rx_add` enforced.
2. Rx edit and remove; diagnosis add, remove and note (no `revalidatePath`; the custom diagnosis list updated); draft autosave (confirm it
   re-renders nothing); allergies recorded (the local allergy context updated from what was saved).
3. Front desk: check in, start consult, collect payment (the Today row moves at once; the live channel reconciles), register and book,
   book, move, cancel, no-show (the current screen updated from the command result; no `revalidatePath` on these paths).
4. Finish (sign and finish): measured; the success screen within B-8; anything beyond two calls on its path is moved after the response or
   reported in the notes with the measured cost.
5. Specs. For each save: the lane row (B-6, B-7) enforced; Kong ≤ 1 call between the action and the confirmed state; no RSC page request
   caused by the action; a lost response (`tests/e2e/support/commit-then-abort.ts`) is retried with the same id and stores one row; an aborted
   save rolls back visibly with the fixed error and Retry; the database holds exactly what the screen shows after a reload. A line that matches
   an allergy is still flagged before it is added (the 09C `rx-allergy.spec.ts` keeps passing with no context re-read).

Tests: Vitest `tests/prescriptions tests/terminology tests/queue tests/visits tests/billing`; e2e `tests/e2e/consult tests/e2e/today tests/e2e/schedule tests/e2e/journeys/journey-04-book-appointment.spec.ts tests/e2e/journeys/journey-05-walk-in.spec.ts`,
then the full PR lane once.
Done: every B-6 to B-8 row enforced and green; no `revalidatePath` left on a hot save (listed in the notes with the action names).

### 09E-05 Reference data on the device: versions, shards and substances (tracer) · M-L · migration 000123_reference_catalogues

Precondition: the PO has answered C-2. Goal: R-5, R-6 end to end on the smallest catalogue; the allergy editor answers from the device.

Files: `supabase/migrations/000123_reference_catalogues.sql`; new `supabase/tests/database/reference_catalogues.test.sql`; new
`features/reference/{catalogues.ts,service.ts}`; new `app/api/reference/manifest/route.ts`, `app/api/reference/[catalogue]/[version]/[shard]/route.ts`;
new `lib/reference/{idb.ts,sync.ts,store.ts,search-substances.ts}`; `components/clinical/allergy-editor.tsx`; `tests/e2e/pwa/{05-cache-audit.spec.ts,fixtures.ts}`
and `tests/e2e/support/storage-dump.ts` (the allowed database, per C-2); new `scripts/perf/reference-size.ts`; `lib/env.ts`, `.env.example` and `tests/e2e/support/app-env.ts` (`REFERENCE_VERSIONS_TTL_SECONDS`, default 300, the
e2e server 2); new `tests/reference/substance-search-parity.spec.ts`; new `tests/e2e/reference/{reference-routes,substances-local}.spec.ts`; `tests/terminology/*` and
`tests/prescriptions/medicine-search-route.spec.ts` where the tie-break changes an order; `scripts/perf/command-latency.ts`; registries.

1. Tracer: the allergy editor's search served from IndexedDB: migration, shard read, both routes, sync, store, twin, editor; one e2e that
   types a substance with 300 ms injected and gets the expected first option in ≤ 100 ms with 0 Supabase calls during typing.
2. Migration 000123. (a) `public.reference_catalogues` (`catalogue text PRIMARY KEY CHECK (catalogue IN ('cdci', 'diagnoses'))`, `version uuid NOT NULL`,
   `changed_at timestamptz NOT NULL`), RLS on, SELECT for `authenticated`, no write grant, both rows seeded. (b) `private.reference_catalogue_bump()`
   (definer, no API grant) and statement-level `AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE` triggers on `cdci_substances`, `cdci_generics`,
   `cdci_brands`, `cdci_medicines_search` (catalogue `cdci`) and `opd_diagnoses` (`diagnoses`): a new random version and `now()`. (c)
   `public.reference_shard(p_tenant_id uuid, p_catalogue text, p_shard integer) RETURNS jsonb` (STABLE INVOKER; `substances` and `diagnoses`
   need `consultations:view`, `medicines` needs `prescriptions:edit`; NULL otherwise): `{catalogue, version, shard, shards, rows}`; rows as arrays
   (substances `[id, name]`; diagnoses `[id, name, icd11, snomed, chronic, specialties, synonyms]`; medicine shard 0 = generics
   `[id, name, substance_ids]`, shards 1..n = brands `[id, brand_name, generic_row, dose_form]` by id, 12,000 per shard). (d) `search_substances`,
   `search_diagnoses` and `search_medicines` replaced from their latest bodies with the name tie-break `COLLATE "C"` only (R-6).
3. Server: `catalogues.ts` (names, permissions, shard sizes, the version uuid check); `service.ts` (`getReferenceVersions` and `getReferenceShard`
   through `unstable_cache` per R-5); the two routes with the 09C route conventions (401, 403, 403 `SUBSCRIPTION_LOCKED`, 503, 500, fixed bodies),
   409 for a version that is not current, 404 for a shard out of range.
4. Device: `idb.ts` (open, put, get all, delete by version, delete database; request and transaction promises; quota and unavailability errors
   mapped to "memory only"); `sync.ts` (R-5 order; never blocks first paint; one sync at a time per tab); `store.ts` (`useReferenceCatalogue(name)` →
   `{ status, search }`; registers with `lib/pwa/cleanup.ts`); `search-substances.ts` (twin of `search_substances`). The editor uses the store when
   ready, else `fetchSubstances`. The purge is unchanged (it deletes the database at sign-out). The cache audit (C-2 answer) allows exactly
   `cliniq-reference` with stores `meta` and `rows`, every record a catalogue row of a known shape, during a session; after sign-out nothing.
5. Size: `scripts/perf/reference-size.ts` reads the real files in `supabase/seed-data` (no database, no network), builds the shard rows with the
   same serializer, and writes `evidence/reference-size.json` (rows, raw, gzip and brotli bytes per shard).
6. Specs. `substance-search-parity.spec.ts`: at least 25 cases (exact, prefix, word prefix, inside, case and spaces, `%`, `_`, `\`, non-ASCII,
   ties, the limit) on synthetic `test-ref-sub-*` rows, the twin against `public.search_substances` through a JWT client: same ids in the same order.
   pgTAP: the table and its grants; each trigger bumps its catalogue's version on insert, update, delete and truncate and leaves the other's
   alone; `reference_shard` grants, NULL without the permission and for another clinic, the shard shapes; the three tie-breaks. `reference-routes.spec.ts`:
   status codes, exact keys, cache headers, a stale version 409, a version bump (a fixture write) changes the manifest within its TTL (the e2e
   server sets the TTL to 2 s through an allowlisted env value). `substances-local.spec.ts` (three projects): typing answers from the device
   with 0 calls (Kong); offline (`context.setOffline(true)`) still answers; with IndexedDB made unavailable (an init script that throws on
   `indexedDB.open`) the editor falls back to the route and still works; the stored records are catalogue rows only; sign-out leaves no database.
   Row `typeahead.substance` enforced (B-4); `command-latency.ts` `reference_shard` (substances) p95.

Tests: Vitest `tests/reference tests/terminology tests/prescriptions/medicine-search-route.spec.ts`; full pgTAP; e2e `tests/e2e/reference tests/e2e/pwa`.
Done: B-4 green for substances on three projects; the cache audit green with the allowed database; parity table green.

### 09E-06 Diagnoses on the device · M · no migration

Goal: R-6 for diagnoses. The consult's diagnosis search answers from the device with the doctor's custom diagnoses first and the
abbreviation expansion when entitled.

Files: new `lib/reference/{trigram.ts,search-diagnoses.ts}`; `lib/reference/store.ts`; `components/consultation/workspace/sections/diagnosis-section.tsx`;
`features/terminology/abbreviations.ts` (imported by the twin, not changed); new `tests/reference/{trigram-parity,diagnosis-search-parity}.spec.ts`;
new `tests/e2e/reference/diagnoses-local.spec.ts`; `tests/e2e/perf/latency-budgets.ts`.

1. Tracer: one prefix query answered locally inside the consult, custom diagnoses from `doctor-lists.ts` first; e2e row measured.
2. `trigram.ts` (R-6) and its table: at least 40 pairs against SQL `similarity()` (short words, digits, punctuation, repeated words, one-letter
   words, non-ASCII, empty).
3. `search-diagnoses.ts`, the twin of `search_diagnoses` (000114:38 with the 000123 tie-break): terms from `expandQuery` when the consult's
   `assist.terminology` is on (the same entitlement the route reads), at most 8 terms of 2 to 100 characters, the specialty filter, custom first
   by `use_count`, then ranks 1 to 6, the same-name merge, the limit 12.
4. The section uses the store when ready, else the route (`fetchDiagnosisHits`); no debounce for the local path (C-3; one search per animation
   frame); the learned order from the assist context applied as today.
5. Specs. `diagnosis-search-parity.spec.ts`: at least 30 cases (abbreviations on and off, synonyms, specialty, custom and catalogue with the same
   name, another doctor's custom never present, trigram-only matches, ties, limit) against `public.search_diagnoses` through a JWT client.
   `diagnoses-local.spec.ts` (three projects): answers with 0 calls; offline answers; fallback works. Row `typeahead.diagnosis` enforced.

Tests: Vitest `tests/reference tests/terminology`; e2e `tests/e2e/reference` and the consult specs that search a diagnosis (`tests/e2e/consult/smart-assist.spec.ts`, then the affected-test grep).
Done: B-4 green for diagnoses; both parity tables green.

### 09E-07 Medicines on the device · L (split point after step 3) · no migration

Goal: R-7. The Rx field answers from the device for the whole CDCI catalogue within B-4 and B-12, the doctor's custom medicines first,
the trigram tail from the server.

Files: new `lib/reference/{medicine-index.ts,search-medicines.ts,worker.ts}`; `lib/reference/{sync.ts,store.ts}`; `components/consultation/workspace/sections/prescription-section.tsx`
(the RxEntryRow `search` prop); new `tests/e2e/support/perf-catalogue.ts` (93,911 synthetic brands, 10,305 generics, 3,283 substances and 1,550
diagnoses with name lengths drawn from the measured distributions, ids `perf-*`, upserted in the lane's setup and deleted in its teardown);
new `tests/reference/medicine-search-parity.spec.ts`; new `tests/e2e/reference/medicines-local.spec.ts`; `scripts/perf/reference-size.ts`;
`tests/e2e/perf/latency-budgets.ts`.

1. Tracer: one brand shard (12,000 synthetic rows) loaded into the worker and searched from the Rx field; the custom list merged; e2e row measured.
2. `medicine-index.ts` (pure: build the columnar index from shards; `search(query, customList, limit)` → ranks 1 to 4 plus custom, and whether the
   tail is needed); `worker.ts` (`new Worker(new URL("./worker.ts", import.meta.url))`, built by Next; messages `load` and `search`; a request id
   per keystroke, stale answers dropped); main-thread fallback with the build chunked in idle callbacks if the worker cannot start (recorded).
3. Sync of the generics shard and the brand shards in the background, after first paint; the index built once per version.
4. `search-medicines.ts`: the route asked once when the local ranks give fewer rows than the limit; its answer replaces the list; custom medicines
   carry their stored dose; CDCI rows none; `substance_ids` from the generic for the allergy pre-check (09C R-7).
5. Measurements into the notes from tool output: `reference-size.json` for the real files and the synthetic set; the lane's B-12 rows
   (transferred bytes from the response sizes, IndexedDB bytes from `navigator.storage.estimate()`, build time and worker heap through CDP).
   If B-12 fails, R-7's fallback applies and the PO is told.
6. Specs. `medicine-search-parity.spec.ts`: at least 30 cases (brand prefix, word, generic prefix and word, inside, `%`, `_`, `\`, non-ASCII,
   custom first by `use_count`, a custom name equal to a brand, another doctor's custom never present, ties, limit, a query whose local ranks
   fill the limit: local list equals the SQL list; a query that needs the tail: local rows equal the SQL rows of ranks 1 to 4 and the final list
   equals SQL) against `public.search_medicines`. `medicines-local.spec.ts` (three projects): answers with 0 calls when the limit is filled
   locally and exactly 1 when the tail is needed; offline shows the local ranks; the 09C keyboard and allergy specs keep passing. Rows
   `typeahead.medicine` (B-4 at 4× CPU) and B-12 enforced; B-13 checked with `npm run ci:route-js`.

Tests: Vitest `tests/reference tests/prescriptions`; e2e `tests/e2e/reference tests/e2e/consult/rx-*`, then the full PR lane once.
Done: B-4 and B-12 green for medicines on the full-size synthetic catalogue, or the R-7 fallback recorded and the PO told.

### 09E-08 Schedule data layer: one range read, slots on the client, prefetch, live · L (split point after step 4) · migration 000124_schedule_range

Goal: R-10. The schedule's day and week views read a range store; free slots are computed from loaded data; adjacent ranges are ready;
changes made elsewhere appear within 2 s.

Files: `supabase/migrations/000124_schedule_range.sql`; new `supabase/tests/database/schedule_range.test.sql`; new `lib/schedule/{slots.ts,range-store.ts}`;
new `lib/live/clinic-channel.ts` (the Today hook moves onto it); new `app/api/schedule/range/route.ts`; `features/schedule/{queries.ts,schema.ts}`;
`app/(dashboard)/schedule/page.tsx`; `components/schedule/{schedule-view.tsx,day-grid.tsx,week-overview.tsx,schedule-head.tsx}`;
`components/front-desk/{slot-section.tsx,slot-adapter.ts}`; `components/today/use-today-live.ts`; new `tests/schedule/slots-parity.spec.ts`;
new `tests/e2e/schedule/schedule-live.spec.ts`; `tests/realtime/today-signals.spec.ts`; `scripts/perf/command-latency.ts`; `tests/e2e/perf/latency-budgets.ts`;
registries.

1. Tracer: the day view from `schedule_range` (one call) with the client's slots for one doctor; row `nav.schedule.day` enforced.
2. Migration 000124. (a) `public.schedule_range(p_tenant_id uuid, p_from date, p_to date) RETURNS jsonb` (STABLE INVOKER, `appointments:view`, NULL
   when the range is reversed or longer than 42 days): `zone`, `clinicians` (owners and doctors with `consultations:edit`, active: id, display name
   as `private.doctor_display_name` builds it, slot minutes floored at 5, `private.effective_schedule`), `blocks`, `visits` (the fields the cards
   and slot rules use today; nothing more). (b) `private.today_signal` replaced from its latest body (000102 or later) and new triggers: kind `block`
   on `schedule_blocks` insert, update, delete; kind `hours` on `memberships` update of `availability_schedule`, `default_slot_duration_minutes`,
   `role` or `status`; the visits update condition widened to `estimated_duration_minutes`, `is_overbooked` and `origin_type`; payload keys `kind` and
   `visit_id` only (null for the new kinds); the send stays inside its error-swallowing block. The topic policy is unchanged.
3. `slots.ts`, the twin of `private.available_slots_core` (000103:157): shifts of the clinic-local date in the clinic zone, back-to-back slots of the
   slot length, minus blocks of the doctor or the whole clinic, minus booked non-overbooked scheduled visits that are not cancelled or no-show (the
   moved visit excepted), none starting before now. `slots-parity.spec.ts`: at least 25 cases (default schedule, a disabled day, two shifts, a
   clinic-wide block, a doctor block, overbooked, cancelled, no-show, the excluded visit, slot length 5 and 45, a slot that started, a date whose
   UTC day differs from the clinic day, a zone with daylight saving) against `public.available_slots` for a member of a synthetic clinic.
4. `range-store.ts` and `clinic-channel.ts` (R-10); `GET /api/schedule/range?from=&to=` (`appointments:view`, `private, no-store`, ≤ 42 days); the page
   renders the first range on the server from the same service and hydrates the store; changing the day or week updates the URL with
   `history.pushState` and reads the store (no page navigation). The booking sheets take slots and clinicians from the store when the range is
   loaded, else the server actions (slot assist, AI-13, stays on the server).
5. Specs. pgTAP `schedule_range.test.sql` (grants, another clinic NULL, the 42-day limit, fields, the new triggers send `block` and `hours` with no
   ids beyond `visit_id`). `today-signals.spec.ts` extended (payload keys of every kind; a member of another clinic receives nothing; the 09C quota
   wait kept). `schedule-live.spec.ts`: a booking in context B appears in context A's day view within 2 s (B-11); the next day and the next week
   show in ≤ 100 ms with 0 calls (B-9); a date 3 weeks away shows in ≤ 600 ms with 1 call (B-10); a 42-day range loads in one call; a slot the
   client shows but another browser just booked is refused by the command with the existing message; sign-out and clinic switch drop every range
   (memory inspected through the store's test hook only in the e2e build). Rows B-1 (Schedule day and week), B-9, B-10 enforced; `command-latency.ts`
   `schedule_range` p95 < 50 ms.

Tests: Vitest `tests/schedule tests/realtime tests/visits`; full pgTAP; e2e `tests/e2e/schedule tests/e2e/today tests/e2e/journeys/journey-04-book-appointment.spec.ts`, then the full PR lane once.
Done: B-1, B-9, B-10, B-11 green for the schedule; slot parity green; the 09D `available_slots` batching no longer on the schedule's path.

### 09E-09 Clinic settings on the device, with a version check · S-M · one migration (000125) · PO-approved 2026-11-23

PO ruling (2026-11-23, replaces the server cache): no server-side cache; ADR-019 and TARGET §9 stay as they are. Settings that change rarely
are held by the browser with a version number and fetched again only when the version moves. Critical settings are never held: they are read
from the database on the path that uses them.

Never held on the device or in the cookie (always read fresh, inside the screen's or the command's own single read): fees and every billing,
payment, invoice and subscription value; the access level and entitlements; roles and permissions (09D rules unchanged); anything a sensitive
action (`lib/auth/sensitive-actions.ts`) reads.

1. Cookie (`clinic_ctx`, 09D): add the clinic's display name and IANA zone (default `Asia/Kolkata`; the clinic's own zone is still stored per
   clinic). The layout and date formatting read them from the cookie; no settings call on a page load while the cookie is valid. Size stays well
   under 4 KB (a name longer than 80 characters is truncated in the cookie only).
2. Migration 000125: `tenants.settings_version bigint not null default 1`, bumped by a trigger on every write to the held settings (clinic
   profile, Rx print settings, doctor directory: display names, slot minutes, availability and blocks). `/api/session-status` returns it.
3. Browser: one in-memory store per tab (no IndexedDB, no localStorage; PWA §4 unchanged for this) holding the doctor directory, Rx print and
   letterhead settings, keyed by clinic and version. Filled from the first screen read that carries them; on each status answer (load, resume,
   5-minute poll) a changed version drops the store and the cookie fields, and the next read refills them. A save on this device updates the
   store at once. Dropped at sign-out and clinic switch.
4. Specs: two devices (browser contexts), a settings change on one shows on the other after its next status check, never a stale value after it
   (fails without the version check: one proof run recorded); a change on the same device shows at once; fees changed on device A are used by
   device B's next bill with no status check in between (proves fees are never held); clinic switch and sign-out leave nothing; two clinics never
   share a store entry.

Done: page loads make no settings call while the cookie and version hold; critical settings proven fresh.

### Close (reviews, fix round, evidence, docs)

1. Reviews, fresh context, given the phase diff and this plan's rulings only. Isolated reviewer (Sonnet): the lane (calibration, in-page timing,
   no row measured on a stale server), every budget row and its proof, the parity tables (enough cases, real SQL on the other side), skeletons at 360,
   820 and 1280, optimistic and rollback states, the schedule store, R-14's stores and their cleanup, tests that assert outcomes. Adversarial reviewer
   (Opus): `consult_screen` (another clinic's visit, the role × part matrix, another doctor's lists, entitlement-off parts), `schedule_range` (another
   clinic, fields beyond the cards, range abuse), `reference_shard` and the routes (permission per catalogue, version and shard parameters, cache
   headers, a stale version), the trigger changes (payloads, the topic policy, a Realtime fault rolling back a write), what each device store
   holds and when it is dropped (IndexedDB, HTTP cache, memory; sign-out, clinic switch, another user on the same device), the server cache's key
   and invalidation if built, the latency preload's confinement (loaded only by the e2e app env, loopback only, a rule file only), the `after()`
   audit. One fix round (09E-10a): Highs and Mediums fixed with a test that fails without the fix (Opus for security fixes, Sonnet otherwise);
   Lows cheap and local or to the backlog with an owner; Highs re-checked once.
2. Evidence (R-16): `node scripts/phase-evidence.mjs .planning/phases/09E-caching-speed/evidence 1`; push once; CI green with 0 retried tests (the
   budget step included); then `--ci-run <id>`; copy the final `perf-latency` (300 ms, every row enforced), `perf-roundtrips`, `reference-size.json` and
   `command-latency.json`; a before/after table generated by a script from the baseline and final JSON (never typed).
3. Docs (Haiku): `09E-SUMMARY.md`, `09E-VERIFICATION.md` (numbers copied from the tool files), `.planning/ROADMAP.md`, the master roadmap status line
   (V2-09d and V2-09e inserted by the PO on 2026-11-23, before V2-10), the amendments the PO approved (PWA §4 for C-2, DESIGN §5 Combobox for C-3,
   ADR-019 and TARGET §9 for C-1 if approved, TARGET §9 "reference data on the device"), the VERIFICATION_LOG entry with the CI link and SHA, and
   PO-ACTIONS `09E-P1` to `09E-P5`.
4. Gate: the PO approves (or by delegation if renewed, with the CI run recorded).

## Acceptance mapping

| Criterion | Proof |
|---|---|
| Strategy 7: a latency lane that adds about 300 ms per Supabase call and fails over budget; a baseline first | 09E-01: calibration row, `perf-latency` project and CI step, `evidence/baseline/` |
| Page navigation < 1 s (B-1), skeleton (B-2), full load (B-3) | `perf-latency` rows per page, enforced by 09E-02, 09E-03, 09E-08; `request-budget.spec.ts` ceilings |
| Search keystroke < 100 ms (B-4) | `typeahead.substance`, `.diagnosis`, `.medicine` rows at 4× CPU; Kong 0 calls in the `*-local.spec.ts` files |
| Save < 500 ms (B-6, B-7, B-8) | `save.*` rows; Kong ≤ 1 call; no RSC request; rollback cases in 09E-04 |
| Strategy 1: reference data on the device, versioned, long-lived cache headers, IndexedDB, local search with SQL parity, server fallback, size budget | 09E-05 to 09E-07: pgTAP `reference_catalogues`, `reference-routes.spec.ts`, the three parity tables plus the trigram table, `*-local.spec.ts`, `reference-size.json`, B-12 |
| Strategy 2: per-doctor data once per consult, in memory, updated on save, custom medicines in local search | 09E-02 (`consult_screen` `my_lists`, Templates 0 calls), 09E-04 (store updates), 09E-07 (custom first in parity) |
| Strategy 3: per-clinic config cache, every writer, tenant isolation | C-1; 09E-09 (measurement first; if built: key and tag test, two-clinic e2e with its fails-without, one e2e per writer, TTL backstop) |
| Strategy 4: schedule range in one query, adjacent prefetch, client cache, live updates, slots from loaded data, foundation for calendar views | 09E-08: `schedule_range` pgTAP, slot parity table, `schedule-live.spec.ts` (B-9, B-10, B-11, 42-day range) |
| Strategy 5: PHI screens one query, link prefetch, optimistic saves; no PHI on the device | 09E-02, 09E-03, 09E-04; the cache audit (`05-cache-audit.spec.ts`) with only the allowed database; no PHI route prefetched beyond its loading boundary; `patient.view` not written by a prefetch |
| Strategy 6: loading.tsx skeletons on every main route, streaming | `loading-states.spec.ts` (extended) at three widths with axe; B-2 rows |
| Realtime update visible ≤ 2 s (M criterion 6) | `today-live.spec.ts`, `schedule-live.spec.ts` (B-11) |
| No regression of 09C safety | `rx-allergy.spec.ts`, `allergy-match.spec.ts`, `rx-keyboard.spec.ts` unchanged in intent and green |
| Route JS (B-13) | `npm run ci:route-js` numbers in the notes before and after |
| Read latency | `command-latency.json`: `consult_screen`, `schedule_range`, `reference_shard` p95 under their limits |

## Source audit

| Source | Items | Covered by |
|---|---|---|
| GOAL | every click instant on staging through fewer calls and caching | 09E-01 (measure), 09E-02 to 09E-04 (screens and saves), 09E-05 to 09E-07 (search), 09E-08 (schedule), 09E-09 (C-1) |
| REQ | PO strategy items 1 to 7 | Acceptance mapping, item by item |
| | PRD 1-2 s, FE-9, DESIGN §6.9, FE-tech D4 and §5, M criterion 6 | Budgets B-1 to B-13; R-12; R-14; B-11 |
| RESEARCH (docs and tree) | TARGET §9, ADR-019, PWA §4 (D-3 to D-5, cache audit), DATA_HANDLING §3 (view audit), CDCI licence, Next 16 caching APIs (`unstable_cache`, `updateTag`, `revalidateTag` with a profile), Vercel response limit | R-5, R-9, R-12, R-13, R-15; C-1, C-2; Risks |
| CONTEXT (rulings) | lean process, no service role (ADR-0005), no PHI on device, no new dependency, flaky-test policy, 09D hand-offs, 09C R-2/R-4/R-7, 08 R-10/R-11 | Shared rules, R-4, R-7, R-8, R-10, R-15 |

No item is unplanned. Strategy item 3 is planned in full and gated by C-1; nothing else waits on a decision except 09E-05 (C-2).

## Threat register (STRIDE; security_enforcement on)

| ID | Cat. | Component | Sev. | Disposition | Mitigation |
|---|---|---|---|---|---|
| T-09E-01 | I | `consult_screen` (one read returning a whole consult) | high | mitigate | INVOKER (RLS applies), `consultations:view` guard, each part behind the page's existing permission and entitlement, `my_lists` filtered by `doctor_id = auth.uid()`; pgTAP role × part matrix, another clinic and a forged tenant NULL, another doctor's lists absent; parity against the old reads |
| T-09E-02 | I | `schedule_range` and its route | high | mitigate | INVOKER, `appointments:view`, only the fields the schedule shows today, 42-day cap, tenant from the session; pgTAP cross-clinic and role cases |
| T-09E-03 | I | New Realtime kinds on `today:<tenant>` | medium | mitigate | Payload `kind` and `visit_id` only (null for `block` and `hours`); topic policy unchanged (active member, `appointments:view`, full access); `today-signals.spec.ts` checks every kind's keys and another clinic's silence; the send cannot roll back a write |
| T-09E-04 | I | Data on the device | high | mitigate | Only `cliniq-reference` (global catalogue rows) in IndexedDB; PHI routes `no-store`; patient and visit data in memory stores registered with `lib/pwa/cleanup.ts`; purge at sign-out unchanged; the cache audit asserts store names and record shapes and nothing after sign-out; clinic switch drops the stores |
| T-09E-05 | E / I | Reference routes | medium | mitigate | Session auth, permission per catalogue, `version` checked as a uuid and against the current one, `shard` an integer in range, fixed error bodies, `private` cache only; route specs with each refusal |
| T-09E-06 | T | A tampered local index (a user edits IndexedDB) | low | accept | The device only proposes; `change_prescription` checks the brand id and name against the catalogue and runs the allergy check (09C 000120 S-1, S-8); `record_patient_allergies` stores strings |
| T-09E-07 | Safety (T) | Local search differing from SQL (a missed or misordered drug or diagnosis) | medium | mitigate | One case table per catalogue against SQL, the trigram table, `COLLATE "C"` tie-breaks, the server tail for medicine rank 5, the route as fallback; any parity failure blocks the plan |
| T-09E-08 | Safety (T) | Optimistic saves showing a save that failed | medium | mitigate | Pending marker until confirmed; rollback with the fixed error and Retry; "Saved" only after the server; fault-injection cases per save |
| T-09E-09 | T | Client-computed slots differing from the server (double booking) | medium | mitigate | `slot_conflicts` in the commands stays the authority; slot parity table; a refused booking shown with the existing message |
| T-09E-10 | I / T | Per-clinic server cache (09E-09, if built) | high | mitigate | Clinic id in key and tag; only fields every member may see; read with the caller's JWT outside the cache scope; two-clinic e2e with its fails-without proof; `updateTag` in every writer; 60 s backstop |
| T-09E-11 | E / D | Latency preload outside the e2e lane | medium | mitigate | Loaded only through the e2e app env's `NODE_OPTIONS`; acts only for the loopback Supabase origin and only while its rule file exists; lives under `tests/`; global setup removes a stale file |
| T-09E-12 | R | `patient.view` written after the response | low | mitigate | Still written once per opening (spec); failures logged by tag; a prefetch writes nothing |
| T-09E-13 | D | Catalogue download on metered or slow networks; storage quota | low | accept | After first paint, idle, once per version, about 1.5 MB; quota errors fall back to memory; the route serves search meanwhile |
| T-09E-SC | T | npm installs | high | mitigate | No new package in this phase; any addition needs the package-legitimacy gate and a blocking human checkpoint |

## Risks

| Risk | Plan response |
|---|---|
| Hosted projects still sign JWTs with the legacy HS256 secret, so `getClaims` falls back to one `getUser` per request and staging misses B-1 by one call | 09D's PO action (switch to asymmetric JWT signing keys) stays a precondition for judging staging; the local lane uses ES256 like the local stack |
| Next 16 or Turbopack cannot bundle the Web Worker | Main-thread fallback with the index built in idle chunks (09E-07 step 2); measured against B-4 and recorded |
| The full medicine index is too big for a 2 to 3 GB Android phone | Columnar index, B-12 budgets at 4× CPU, the device checklist on the low-end phone; R-7 fallback (generics and substances on the device, brands on the server) |
| Database `lower()` or collation differs between the local stack and hosted projects | `COLLATE "C"` tie-breaks; non-ASCII cases in every table; PO action `09E-P4` compares `lc_collate` and `lc_ctype` read-only on staging |
| `unstable_cache` entries are per region and per deployment on Vercel, and large entries may not be stored | Shards ≤ 1 MB raw; versions have a 300 s TTL; the device's IndexedDB is the real cache, the server cache only saves database reads |
| The budget step makes CI slower or flaky | Only the `@budget` subset on PRs (about 4 minutes); medians of 5; budgets with headroom at 300 ms; a failing row is root-caused, never retried to green |
| Removing `revalidatePath` leaves another view stale | Today and Schedule refresh through the live channel; other dynamic pages are fetched again on navigation (Next's default); per-save e2e asserts what a reload shows |
| `consult_screen` is a large function and could drift from the page's rules | Parity against the old reads for five states and five roles before the old path is deleted; pgTAP role × part matrix |
| More Realtime events use up the local Realtime event quota (the 09C today-signals flake) | The 09C quota wait kept in the signal specs; coalescing; kinds only where a view needs them |
| The perf catalogue (94,000 synthetic rows) changes search results for other e2e specs | Ids `perf-*` with synthetic names unlike the `Qzx` fixtures; upserted and deleted by the lane only; the lane runs alone |
| The phase is large (nine plans) | Ordered by measured cost so that the biggest wins land first; split points named in 09E-07 and 09E-08; each plan leaves the tree green |

## PO questions (few and plain; the default applies if unanswered)

| # | Question | Default |
|---|---|---|
| Q-1 (C-1) | May the server keep each clinic's settings (not patient data) for up to a minute between requests? This changes ADR-019 | No for now; 09E-09 reports whether it would still save a call, then you decide |
| Q-2 (C-2) | May the app keep one database on the device holding only the public drug, diagnosis and allergy lists (nothing about patients, the clinic or users), deleted at sign-out? This changes the PWA privacy check | Needed before 09E-05; recommended yes |
| Q-3 (C-3) | May on-device search answer on every keystroke instead of waiting 200 ms? This changes one design-system rule | Yes |
| Q-4 | Do you accept the budgets (page under 1 s, full reload under 1.5 s, search under 0.1 s, save confirmed under 0.5 s and visible at once, finish under 1 s), measured with 300 ms per database call, and the budget check on every pull request (about 4 more minutes of CI)? | Yes |

**PO answers (2026-11-23, in chat):** Q-2 yes (amend PWA §4 as C-2 proposes); Q-3 yes (amend DESIGN_SYSTEM §5 Combobox
as C-3 proposes); Q-4 yes (budgets as listed, budget check on every PR). Q-1: no server cache; instead 09E-09 holds
rarely-changing settings on the device with a version check, and critical settings (billing, fees, access, roles) are always read from the
database. Almost all clinics are IST (no international launch yet); the zone stays per clinic, default `Asia/Kolkata`.

PO actions at the close: `09E-P1` gate; `09E-P2` a 10-minute walkthrough on staging after the staging migrate (open Today, a consult, search a
drug and a diagnosis, add three Rx lines, book from Schedule, on a phone and a desktop) and the device checklist (low-end Android: catalogue
download time, search speed, memory; iPad: the same); `09E-P3` staging migrate of 000122 to 000124 (not delegated); `09E-P4` read-only check of
staging's `lc_collate` and `lc_ctype` and the JWT signing algorithm; `09E-P5` acknowledgement of Q-1 to Q-4.

## Out of scope

The calendar views the PO wants next (week time grid, month view: the range store is built for them, the views are not); V2-10 billing; moving
Supabase out of Sydney (production must still be in Mumbai, PO-6, PO-12); Redis, CDN or service-worker caching of data; offline writes and any
PHI on the device; on-device patient search; Lighthouse and k6 blocking budgets (V2-15, P1-41); TanStack Query (R-14).

## Execution (lean process)

- Executors: Sonnet `gsd-executor`, one plan at a time in the order above, migration numbers per the note (renumber at start). Never set a mode
  when starting a subagent (CLAUDE.md). Each plan runs only its affected Vitest and pgTAP files (full pgTAP in 09E-05 and 09E-08) plus its e2e
  files and `npm run perf:latency`; 09E-03, 09E-04, 09E-07 and 09E-08 run the full PR lane once; CI runs everything after the push, once for the
  phase. The evidence run at the close is the only full Vitest run; the FLOOR is re-measured from it once.
- One "fails without" proof per High control only: 09E-02 (another doctor's lists absent from `consult_screen`), 09E-05 (the cache audit refuses
  a record of an unknown shape in the allowed database), 09E-08 (`schedule_range` for another clinic), 09E-09 (clinic id in the cache key). No
  mutant runs.
- Reviews: Sonnet for the isolated review; Opus for the adversarial review, security fixes and hard debugging; Haiku for docs and evidence. One
  review round, one fix round (09E-10a).
- Evidence: one run (`... evidence 1`) plus CI (R-16). Push once.
- Branch `v2/phase-09e-caching-speed` off `feature/v2` after the V2-09d merge; PR into `feature/v2`; never `main`; no force-push; local stack only,
  never hosted Supabase.
- New dependencies: none.
