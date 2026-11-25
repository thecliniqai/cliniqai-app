---
phase: "09E"
roadmap_id: V2-09e
name: Caching and speed
revision: "2026-11-23, second revision: PO decisions 1 to 11 of 2026-11-23 applied (see 'Changes in this revision')"
gate: "G4 (light, per PR): one isolated reviewer (Sonnet) over the latency lane and its call and depth budgets, the observability path (Server-Timing, the request timing line, real-user monitoring), the client data layer and its clearing, the live convergence (versions, one signal per transaction, heartbeat, badge, dropped-signal recovery), the single read per screen, skeletons at 360/820/1280, saves by risk class, the stale-write refusals, the on-device search parity tables, the schedule data layer and the session bootstrap; one adversarial security reviewer (Opus) over migrations 000122 to 000130 (RUM ingest, clinic versions with their triggers and row versions, consult_screen, today_board, the stale-write commands, the reference catalogues and shard read, schedule_range, session_bootstrap), every new route (RUM, live state, Today board, reference manifest and shards, schedule range, bootstrap), everything held on the device (the IndexedDB catalogues; the in-memory query cache and its clearing at sign-out, clinic switch and lock), proof that fees, billing, payments, subscription, access level, entitlements, roles and permissions are never held, and the confinement of the latency preload to the e2e lane; one fix round (09E-14a, lean process, VERIFICATION_LOG 2026-11-15). The PO approves the gate; if the PO delegates again, approved by delegation with the CI run recorded."
requirements: ["PO directive 2026-11-23: every click and page must feel instant on staging (300-450 ms per Supabase call, Vercel bom1 to Supabase Sydney; staging stays there, production will be Mumbai + Mumbai); the speed must come from the code", "PO priorities 2026-11-23, equal weight: (1) speed, every click instant; (2) real-time shared data across devices and logins: no device silently shows stale critical data and the database decides every write; nothing depends on a browser cookie for correctness (a public booking API with API keys comes later)", "PO decisions 2026-11-23 (second set) 1-11: no server cache and a session bootstrap; real-time convergence by clinic versions with a heartbeat; signals coalesced per transaction; TanStack Query; optimistic by risk class; stale-write refusal; slots only in SQL; blocking call-count and depth budgets with ms report-only; staging region unchanged; observability without a vendor outside India; calendar views next phase", "PO-approved strategy 2026-11-23 items 1, 2, 4-7 (item 3 replaced by decision 1); PO answers Q-2, Q-3, Q-4", "PRD 1-2 s core actions on 3G/4G (PWA_STRATEGY §1.14, §3.9)", "FE-9 performance budgets (report-only until V2-15; this phase adds call and depth budgets that block)", "DESIGN_SYSTEM §6.9 (layout-matching loading.tsx per route group, optimistic UI with rollback, no full-screen spinner)", "TARGET_ARCHITECTURE §3.8, roadmap P1-25, PO-12, C39 (observability; India-resident sink; no vendor outside India)", "TARGET_ARCHITECTURE §9 and ADR-019 (request-scoped caching only; unchanged)", "PWA_STRATEGY §4 D-3, D-4, D-5 (no PHI on the device, no-store PHI responses, purge at sign-out)", "FRONTEND_MIGRATION_PLAN M criterion 6 (Today realtime update visible within 2 s)", "V2-09d hand-offs: per-request memo, signed clinic_ctx cookie, Kong round-trip counter, PR-lane call ceilings, the batched available_slots calls, the remaining page-data duplicates (09D-NOTES)"]
plans: ["09E-01", "09E-02", "09E-03", "09E-04", "09E-05", "09E-06", "09E-07", "09E-08", "09E-09", "09E-10", "09E-11", "09E-12", "09E-13", "09E-14a", "close"]
order: "09E-01 -> 09E-02 (measure) -> 09E-03 -> 09E-04 (data layer, convergence) -> 09E-05 -> 09E-06 (one read per screen) -> 09E-07 -> 09E-08 (saves) -> 09E-09 -> 09E-10 -> 09E-11 (catalogues) -> 09E-12 (schedule) -> 09E-13 (bootstrap) -> reviews -> 09E-14a -> close (sequential; one local stack; one executor at a time)"
preconditions: "V2-09d merged into feature/v2 (09E branches from that merge). Q-1 to Q-4 answered (2026-11-23). Q-5 answered: two PRs, split after 09E-08."
migrations: {"09E-14a": "000127_review_fixes_09e", "09E-02": "000122_rum_daily", "09E-04": "000123_clinic_versions", "09E-05": "000124_consult_screen", "09E-06": "000125_today_board", "09E-07": "000126_stale_write_refusal", "09E-09": "000128_reference_catalogues", "09E-12": "000129_schedule_range", "09E-13": "000130_session_bootstrap"}
migrations_note: "000120_rx_review_fixes is the newest migration; 000121 stays unused (it was reserved for V2-09d, which added none); 09E numbers start at 000122 and run consecutively. Run `ls supabase/migrations | tail -3` at the start of each plan: if a number is taken, take the next free one, shift the later ones and record the numbers in 09E-NOTES.md. Every migration commit also bumps app/api/ready/expected-migration.ts, the schema snapshot, types/database.ts (npm run db:types) and scripts/ci/assert-pgtap-report.mjs (REQUIRED_FILES and FLOOR with the arithmetic in its header). No other plan adds a migration; 09E-14a takes the next free number only if a fix needs SQL."
new_dependencies: {"@tanstack/react-query": "exact pin of the latest 5.x at install (5.108.4 on 2026-11-23); PO decision 4: one memory-only client data layer instead of four hand-built stores (R-14, 09E-03); legitimacy audit in 09E-RESEARCH-NOTES.md §3"}
base_commit: "the V2-09d merge commit on feature/v2 (not merged at planning time; v2/phase-09d-request-speed was at 3db8b816)"
branch: "v2/phase-09e-caching-speed -> PR into feature/v2 (two PRs if the PO answers Q-5 that way)"
source: "PO brief and decisions 2026-11-23 (strategy items 1-7; decisions 1-11; Q-2 to Q-4); docs/v2/V2_MASTER_ROADMAP.md §1.2 (PO-6, PO-12, PO-13, PO-15, PO-17, PO-23(h)), §6 observability row, §10 (FE-5, FE-9, P1-25, P1-41, PWA-09); docs/v2/TARGET_ARCHITECTURE.md §2.4, §3.8, §3.9, §6, §9; docs/v2/ARCHITECTURE_DECISIONS.md ADR-004, ADR-016, ADR-019; docs/adr/0005; docs/v2/PWA_STRATEGY.md §1.14, §3.2, §3.6, §3.7, §3.9, §4 (D-1 to D-5, D-8), §9.1 spec 5; docs/v2/DATA_HANDLING.md §2, §3, §5; docs/v2/DESIGN_SYSTEM.md §5 (Combobox), §6.9; docs/v2/FRONTEND_TECHNOLOGY_ASSESSMENT.md §4, §5, D4; docs/v2/FRONTEND_MIGRATION_PLAN.md M criteria; docs/v2/AI_STRATEGY.md §1 (CDCI licence), AIR-8; docs/v2/VERIFICATION_LOG.md rulings 2026-11-14, 2026-11-15, 2026-11-21; .planning/phases/09D-request-speed/09D-NOTES.md; .planning/debug/today-signals-flake.md; 09C-PLAN.md (R-2, R-3, R-6, R-7, R-16, R-17), 09B-PLAN.md (R-2, R-11), 08-PLAN.md (R-10 Today live, R-11 GET search routes)"
research: "09E-RESEARCH-NOTES.md (inventory at 3db8b816: the stale-write gap per command, the Today signal triggers, what V2-03/04/06 built for observability; design notes on version consistency, per-transaction coalescing, the staleness bound and Realtime capacity; the package audit; the previous-to-current plan map). Catalogue sizes measured at the first revision stand (93,911 brands, 10,305 generics, 3,283 substances, 1,550 diagnoses; CDCI compact JSON 7.06 MB raw, 1.53 MB gzip, 1.07 MB brotli; substances 36 kB gzip; diagnoses about 21 kB gzip; CDCI licence CC BY 4.0, redistribution within India)."
must_haves:
  truths:
    - "With 300 ms added to every Supabase call, a link click to any main screen spends at most one round trip of database calls after the session (two on a full reload), each save one call (sign and finish two), each on-device search keystroke none; CI blocks any rise in a row's calls or depth; milliseconds are measured in the same lane and reported, never blocking."
    - "Every write moves its clinic's domain version (schedule, queue, billing, settings) in the same transaction and sends at most one signal per clinic, domain and transaction, carrying that version; every live read returns the versions it reflects from the same statement; a device re-reads when it learns a newer version from a signal, a 12 s heartbeat on a visible live screen (also while subscribed), a rejoin, the tab becoming visible, the network returning or a wake; a dropped signal is recovered within 15 s, and the screen says Live, or Reconnecting with Updated N s ago."
    - "Queue and billing edit commands take the row version the screen showed and refuse with ROW_CHANGED, writing nothing, when it moved; reversible actions (queue moves, draft notes, Rx lines, diagnoses, vitals) show their result at once and roll back visibly; booking, payment, allergies and sign-and-finish show a pending state only and never success before the database confirms."
    - "Typing in the medicine, diagnosis and allergy fields answers each keystroke from the device with no database call, with the same rows in the same order as the SQL search (one shared case table per catalogue, TypeScript twin against SQL), and falls back to the server route whenever the on-device index is not ready."
    - "The schedule reads any range up to 42 days in one call whose free slots are computed in SQL by the same function as available_slots (one availability rule), has the adjacent day or week ready before it is asked for, shows a booking made in another browser within 2 s, and serves the week grid and month views that come next."
    - "A session bootstrap (profile, clinic name and zone, display role, doctor directory names, Rx print display settings) is loaded once, held in memory and refreshed on a newer settings version, resume and reconnect; fees, billing, payments, subscription, access level, entitlements, roles and permissions are never held; nothing is cached across requests on the server (ADR-019 unchanged) and nothing new is put in a cookie."
    - "No patient data is stored on the device: only the global drug, diagnosis and substance lists live in one IndexedDB database, deleted at sign-out; the query cache is memory only and cleared at sign-out, clinic switch and lock."
    - "A slow screen on staging can be diagnosed without a vendor: each request's database calls, depth and time in a log line (and Server-Timing on route handlers), real-user p50/p75/p95 per screen in an India-resident table with no PHI, and the top database queries."
  artifacts:
    - "supabase/migrations/000122_rum_daily.sql, 000123_clinic_versions.sql, 000124_consult_screen.sql, 000125_today_board.sql, 000126_stale_write_refusal.sql, 000128_reference_catalogues.sql, 000129_schedule_range.sql, 000130_session_bootstrap.sql; supabase/tests/database/{rum_daily,clinic_versions,consult_screen,today_board,stale_write_refusal,reference_catalogues,schedule_range,session_bootstrap}.test.sql"
    - "tests/e2e/support/{server-latency.cjs,latency.ts,perf-catalogue.ts}, tests/e2e/perf/{latency-budgets.ts,latency-pages.ts,page-latency.spec.ts}, playwright project perf-latency, npm run perf:latency, the CI budget step, the nightly latency report"
    - "lib/observability/{db-timing.ts,server-timing.ts,rum/catalog.ts,rum/collector.ts}, components/shell/{rum-reporter.tsx,data-ready.tsx}, app/api/rum/route.ts, scripts/perf/{db-top-queries.ts,top-queries.sql,staging-smoke.ts}"
    - "lib/query/{client.ts,provider.tsx,keys.ts,policy.ts,server.ts,mutations.ts}; lib/live/{live-core.ts,provider.tsx,use-live-screen.ts,use-changed-elsewhere.ts,domains.ts}; app/api/live/state/route.ts; components/shell/{live-badge.tsx,changed-elsewhere.tsx}"
    - "features/consultation/screen.ts, app/api/today/board/route.ts, components/shell/skeletons/*, app/api/schedule/range/route.ts, features/session/bootstrap.ts, app/api/session/bootstrap/route.ts, lib/session/use-bootstrap.ts"
    - "lib/reference/{idb.ts,sync.ts,store.ts,trigram.ts,search-substances.ts,search-diagnoses.ts,search-medicines.ts,medicine-index.ts,worker.ts}, features/reference/{catalogues.ts,service.ts}, app/api/reference/manifest/route.ts, app/api/reference/[catalogue]/[version]/[shard]/route.ts, scripts/perf/reference-size.ts"
    - "tests/reference/{substance-search-parity,trigram-parity,diagnosis-search-parity,medicine-search-parity}.spec.ts, tests/consultation/consult-screen-parity.spec.ts, tests/today/today-board-parity.spec.ts, tests/live/live-core.spec.ts, tests/e2e/live/{convergence,stale-write}.spec.ts"
  key_links:
    - "public.clinic_versions is written only by private.clinic_bump, called from statement-level triggers once per clinic, domain and transaction inside the writer's transaction; the same call sends the one signal {domain, version} on today:<tenant> (topic and policy unchanged)."
    - "today_board, schedule_range, session_bootstrap and clinic_live_state return versions from the same statement as their data; lib/live re-reads a query only when it learns a version above the query's basis (exact, or the lower bound recorded when the fetch started)."
    - "lib/live/live-core.ts runs the 12 s heartbeat on visible live screens even while the channel is SUBSCRIBED; it is what turns a dropped or refused signal into a re-read."
    - "lib/query/provider.tsx holds the only QueryClient in the browser; lib/pwa/cleanup.ts clears it at sign-out, clinic switch and lock; no persister or devtools package is importable."
    - "Queue and billing commands compare p_expected_version with visits.row_version or invoices.row_version after their row lock and before any write; the app always passes the version its query shows."
    - "public.consult_screen composes the existing INVOKER reads (consult_assist_context, patient_snapshot, rx_allergy_context, my_entitlements), so the rules of 09B and 09C stay in one place."
    - "public.schedule_range computes slots with private.available_slots_core, the function available_slots uses; no slot rule exists in TypeScript; the booking commands' slot_conflicts stay the authority."
    - "lib/reference/search-*.ts are twins of search_substances, search_diagnoses and search_medicines (ranks 1-4); one case table per catalogue runs against both; the SQL name tie-breaks use COLLATE \"C\" (000128)."
    - "public.ops_ingest_rum is the only writer of ops.rum_daily; the route and the function both enforce the closed lists, so no URL, id, text or tenant reaches it."
---

# V2-09e Caching and speed: plan

## Goal

Two priorities with equal weight (PO, 2026-11-23).

**Speed.** Every click feels instant on staging. When this plan was written each Supabase call cost 300 to 450 ms (Vercel
bom1 to Supabase Sydney); the PO moved staging to Mumbai on 2026-11-23 (`MUMBAI-MOVE`), so staging now matches
production (Mumbai + Mumbai). The 300 ms latency lane stays as a deliberate worst case (slow mobile networks). The speed comes from the code: fewer calls, never more
than one round trip of them per screen, and no database call at all for the most frequent interactions (drug, diagnosis
and allergy search on the device; the doctor's own lists with the consult; a session bootstrap held in memory). Reversible
saves show their result at once.

**Shared truth.** Several people book, queue and bill on one clinic at the same time. The database decides every write
(stale writes are refused) and no device silently shows stale critical data: every write moves its clinic's domain version
in the same transaction, the one signal per transaction carries that version, a heartbeat catches a dropped signal within
15 s, and the screen says how fresh it is. Nothing depends on a browser cookie for correctness, so the public booking API
(API keys, no browser) can later use the same commands.

A latency lane (300 ms per Supabase call) and an observability path with no outside vendor measure all of it. CI blocks any
rise in database calls or round-trip depth; milliseconds are reported. Patient data never touches device storage.

Tracer: 09E-01 first proves the measurement path end to end on one row (a link click to Patients with 300 ms injected,
timed in the page, counted at Kong, depth from the call intervals) before adding every row. Each later plan starts with its
own thinnest end-to-end slice and lowers its rows to their targets when they pass.

## Changes in this revision (2026-11-23, second)

- **No server cache; ADR-019 unchanged** (decision 1). The device-held settings design with cookie fields and a
  `tenants.settings_version` column is withdrawn. 09E-13 builds a session bootstrap in client memory, refreshed by the
  `settings` domain version. Live data (availability, blocks, slots, bookings, queue, fees, billing, payments, subscription,
  access level, entitlements, roles, permissions) is never held. The reference routes no longer use `unstable_cache`.
- **Real-time convergence** (decisions 2, 3) is a new plan, 09E-04, before any screen work: `clinic_versions`, one signal
  per clinic, domain and transaction carrying the version, a 12 s heartbeat even while subscribed, a live badge, a
  dropped-signal test that fails without the heartbeat.
- **TanStack Query adopted** (decision 4), 09E-03: one memory-only data layer; the four hand-built stores are not built.
- **Saves by risk class** (decision 5) and **stale-write refusal** (decision 6): 09E-08 and the new 09E-07.
- **Slots only in SQL** (decision 7): the TypeScript slot twin is dropped; `schedule_range` returns the slots.
- **Budgets** (decision 8): calls and depth block in CI; milliseconds are report-only.
- **Observability** (decision 10): a new plan, 09E-02, right after the latency baseline.
- Plans renumbered; migrations renumbered 000122 to 000130. The map from the previous numbers is in
  09E-RESEARCH-NOTES.md §4.

## Current state (inventory 2026-11-23; tree at 3db8b816 on v2/phase-09d-request-speed)

| Area | Today | Gap | Plan |
|---|---|---|---|
| Measurement | `npm run perf:roundtrips` (Kong access-log counter `tests/e2e/support/kong-calls.ts`), PR-lane ceilings (in-app Patients ≤ 3 and Today ≤ 6 calls, Today full load ≤ 12; `tests/e2e/shell/request-budget.spec.ts`), `scripts/perf/command-latency.ts` (database p95), LHCI nightly (report-only, PWA-09) | No latency injection, no depth, no time per screen | 09E-01 |
| Observability | `lib/log` (JSON lines, no pino, V2-03 R-6), `ops.error_events` through `public.ops_ingest_error` (India-resident, C39), `x-request-id` from `proxy.ts`, `ops.cleanup()` retention (research §1.3) | No real-user timings, no `Server-Timing`, no per-request database count or time, no top-query report | 09E-02 |
| Client data | No client cache; Today refreshes with `router.refresh()` (the whole page); the consult re-reads per interaction | One data layer | 09E-03 |
| Live | Row-level triggers send one signal per row (`{kind, visit_id}` on `today:<tenant>`); the board polls only while not SUBSCRIBED; a quota-refused or rebalanced channel stays SUBSCRIBED and silent (`.planning/debug/today-signals-flake.md`) | Versions, coalescing, heartbeat, badge | 09E-04 |
| Session and context | V2-09d: claims verified without a network call, a per-request memo, the signed 5-minute `clinic_ctx` cookie (an optimisation; RLS and the commands decide); a hosted project still on the legacy HS256 secret falls back to one `getUser` per request (09D PO action P2) | Unchanged; 09E adds nothing to the cookie | n/a |
| Consult page | `app/(dashboard)/consultation/[id]/page.tsx:44-240`: up to 16 reads awaited one after another (14 for a draft): 4 to 6 s at staging cost | One read | 09E-05 |
| Consult interactions | An Rx change is a command, a read-back and an allergy-context read: three round trips in a row; the Templates sheet reads on opening and after a save | Per-doctor data per interaction | 09E-05, 09E-08 |
| Today and other screens | Today reads visits, then invoices, then payments (`features/today/queries.ts`); most segments show the generic `RouteSkeleton`; `patient.view` is awaited before render; the Patients list's links prefetch one patient read per row in view (09D) | One round trip, layout skeletons | 09E-06 |
| Saves | Hot actions call `revalidatePath`; Check in renders twice (09D); no queue or billing command takes a row version (research §1.1) | One call, no re-render, stale writes refused | 09E-07, 09E-08 |
| Typeahead | Three GET routes, `private, no-store`, one database call per debounced keystroke (`search_medicines` 000117, `search_diagnoses` 000114, `search_substances` 000118); 300 to 650 ms per keystroke on staging | On the device | 09E-09 to 09E-11 |
| Catalogue sizes | As measured at the first revision (frontmatter `research`); the local stack's CDCI tables hold only test fixtures (`seed:cdci` targets the hosted project and is never run) | Real-size data for local measurement | 09E-09, 09E-11 |
| Schedule | `available_slots(doctor, date)` per pair, sent together since 09D; no range read; no live updates on `/schedule`; booking sheets ask slots, slot assist and blocks through server actions | Range read with SQL slots, prefetch, live | 09E-12 |
| Clinic config | Read per screen (settings service, doctor directory `features/staff/actions.ts:258-270`, the PDF payload); Today and Schedule read `tenants` twice (09D) | Session bootstrap | 09E-13 |
| Server caching | None: 0 hits for `unstable_cache`, `"use cache"`, `revalidateTag`; Next 16.4.6 without `cacheComponents` | Stays none (PO) | n/a |

Gate scripts today: pgTAP FLOOR 9025 (`scripts/ci/assert-pgtap-report.mjs:158`), Vitest FLOOR 6455 (`assert-vitest-report.mjs:143`,
re-measured once at the close), `EXPECTED_MIGRATION = "000120"` (000130 at the end of the phase), the consult route's first-load
JS against the 200 kB report-only budget (`npm run ci:route-js`), e2e job timeout 95 minutes with the PR lane at about 85.

## Decisions recorded (formerly "Conflicts for the PO")

Each item meets an approved document; the PO decided it; the document amendment it needs is in "Doc amendments needed".

| # | Item | Approved document | Resolution |
|---|---|---|---|
| C-1 | Strategy 3: a server cache of clinic settings | ADR-019; TARGET §9 | **Resolved (PO 2026-11-23, decision 1):** no server cache; ADR-019 unchanged. A session bootstrap in client memory (R-13, 09E-13). No document amendment for ADR-019 |
| C-2 | Strategy 1: the catalogues in IndexedDB | PWA §4 cache audit ("`indexedDB.databases()` is empty") | **Resolved (Q-2 yes):** one allowed database `cliniq-reference`, global catalogue rows only, deleted at sign-out (A-4) |
| C-3 | A search result within 100 ms of the keystroke | DESIGN_SYSTEM §5 Combobox ("typeahead debounce 200 ms") | **Resolved (Q-3 yes):** the debounce applies to server-backed search only (A-5) |
| C-4 | TanStack Query adopted | TARGET §3.9, FRONTEND_TECHNOLOGY §5 and D4, roadmap FE-5 ("TanStack Query deferred") | **Resolved (decision 4):** adopted, memory only (A-1) |
| C-5 | A version heartbeat even while subscribed; a 15 s staleness bound; new badge labels | TARGET §3.9 and PWA §3.2 (polling only as a fallback); 06-UI-SPEC §8 "Live data" | **Resolved (decision 2)** (A-2, A-7) |
| C-6 | Optimistic only for reversible actions | DESIGN_SYSTEM §6.9 | **Resolved (decision 5)** (A-6) |
| C-7 | Calls and depth block; milliseconds report-only | PWA §3.9, FE-9, P1-41 | **Resolved (decision 8)** (A-10) |

Not conflicts, recorded: reference shards are served `Cache-Control: private, max-age=31536000, immutable` under versioned
URLs (browser only, never shared or CDN; D-4 governs HTML and RSC; the sign-out's `Clear-Site-Data: "cache"` empties the HTTP
cache). ADR-019 allows tag caching of global reference data; it is not used (PO: no server cache).

## Measured baseline to collect (09E-01, before any product change)

All numbers come from tool output in `.planning/phases/09E-caching-speed/evidence/baseline/` (`perf-roundtrips/summary.{json,md}`,
`perf-latency-0ms/summary.{json,md}`, `perf-latency-300ms/summary.{json,md}`). Nothing is typed by hand. Each row: Supabase
calls by path from Kong (server and browser), round-trip depth from the call intervals at 300 ms, and median and max of 5
samples after one warm-up.

| Group | Rows (receptionist R, doctor D, owner O) | Start and end of the measurement |
|---|---|---|
| Pages, in-app | R: Today, Schedule day, Schedule week, Patients, a patient, Visits, Billing reports. D: Today (doctor mode), a consult in draft, a sealed consult, a patient. O: Settings clinic, Staff | Click on the nav or row link (real `next/link`) → skeleton visible → the page's first data element visible (a lane count, the first row, the Rx entry row or the signed lines, the first grid slot) |
| Pages, full load | The same pages | `page.goto` → first data element visible; plus Navigation Timing `responseEnd` |
| Typeahead | D: medicine (Rx field), diagnosis, allergy substance. R: patient search (Today and registration) | Keydown of the last character → the listbox's first option shows the expected text (timed in the page with `performance.now()` and a MutationObserver installed before the key) |
| Saves | R: check in, register and book, book from Schedule, reschedule, cancel, collect payment. D: start consult, draft autosave, add diagnosis, add an Rx line by keyboard, edit an Rx line, record allergies, sign and finish | Click or Enter → optimistic or pending state visible → server-confirmed state visible; RSC page requests the action caused |
| Live | R: a check-in made in a second browser | Commit in context B → the row moves in context A; calls per refresh |
| Reference | Catalogue row counts on the local stack; the real files' counts | Re-measured with the serializer in 09E-09 and 09E-11 (`scripts/perf/reference-size.ts`) |

09E-01 ends by listing in the notes the rows furthest from their targets. The plan order follows the PO's order; the PO may
reorder the screen and catalogue plans after seeing it.

## Budgets (300 ms added to every Supabase call; desktop-chrome)

Calls and depth block on every PR (deterministic). Milliseconds are medians of 5, reported in the step summary and nightly,
never blocking (decision 8: wall clock on shared runners would flake, and a retried test is a defect). "Functional" rows are
blocking assertions about order (the state appears while the injected calls are still pending), not timings.

| # | Measure | Calls (blocking) | Depth (blocking) | Target, report-only | Owner |
|---|---|---|---|---|---|
| B-1 | Link click to Today, Schedule day and week, Patients, a patient, a consult (draft, sealed), Visits, Billing reports, Settings, Staff: first data element visible | per-row ceiling: the baseline in 09E-01, then the plan's measured count | 1 after the session | ≤ 1,000 ms (max ≤ 1,300) | 05, 06, 12 |
| B-2 | The same click: layout skeleton visible | 0 before it (functional) | 0 | ≤ 150 ms | 06 |
| B-3 | Full reload of the same screens: content visible | per-row ceiling | 2 (layout, page) | ≤ 1,500 ms | 05, 06 |
| B-4 | Medicine, diagnosis, substance typeahead: keystroke → results | 0 while typing (medicine rank-5 tail: 1 per settled query) | 0 | ≤ 100 ms at 4× CPU (max ≤ 150) | 09, 10, 11 |
| B-5 | Patient search (PHI, server only): last keystroke → results | 1 per settled query | 1 | ≤ 700 ms (200 ms debounce included) | measured, not changed |
| B-6 | Reversible save (queue move, draft, Rx line, diagnosis, vitals): result visible | 0 before it (functional: visible while the call is held) | 0 | ≤ 100 ms | 08 |
| B-7 | Save confirmed (both classes: check in, start, book, reschedule, cancel, no-show, collect, draft, Rx add/edit/remove, diagnosis, allergies) | 1, and no RSC page request | 1 | ≤ 500 ms | 08 |
| B-8 | Sign and finish → success screen | ≤ 2 | ≤ 2 | ≤ 1,000 ms | 08 |
| B-9 | Schedule: adjacent day or week (prefetched) shown | 0 | 0 | ≤ 100 ms | 12 |
| B-10 | Schedule: any other range up to 42 days shown | 1 | 1 | ≤ 600 ms | 12 |
| B-11 | A change made in another browser, signal delivered: visible on Today or Schedule | 1 re-read per signal | 1 | ≤ 2,000 ms (M criterion 6; e2e assertion at 0 ms) | 04, 06, 12 |
| B-12 | The same change with the signal dropped: visible | 1 state read + 1 re-read | 2 | ≤ 15,000 ms (heartbeat 12 s; asserted with the page clock, functional) | 04 |
| B-13 | Heartbeat cost | 1 call per 12 s while a live screen is visible; 0 while hidden | 1 | n/a | 04 |
| B-14 | CDCI reference download | 0 during use; transferred ≤ 1.6 MB gzip per version (bytes, blocking) | n/a | IndexedDB ≤ 10 MB; worker index build ≤ 1,500 ms at 4× CPU; worker heap ≤ 40 MB | 11 |
| B-15 | First-load JS of `/today` and `/consultation/[id]` | n/a | n/a | growth over the 09E-01 measurement reported (TanStack Query about 13 kB gz expected; worker and index load after first paint); report-only per FE-9 | 03, 09 to 11 |

The lane runs at 300 ms, the low end of the staging cost; a screen with depth 1 meets its target at 450 ms too.
Ceilings may be lowered within a plan; raising one is a PO question.

## Rulings

CTO rulings under the lean process, numbered as in the first revision so earlier references still resolve; rewritten ones are
marked. The PO may overturn any of them at the gate.

| # | Ruling | Why / how |
|---|---|---|
| R-1 | **Scope** (rewritten). PO decisions 1 to 11 and strategy items 1, 2, 4 to 7 as planned below; item 3 as the session bootstrap. Out: the calendar views (week time grid, month; the data layer serves them), V2-10 billing (it builds on the `billing` version and `invoices.row_version`), a region move, any server cache (Redis, CDN, `unstable_cache`, `use cache`), offline writes, PHI on the device, caching in the service worker, on-device patient search, an outside monitoring vendor, a platform-admin RUM screen (V2-13c; a SQL report now), Lighthouse and k6 blocking (V2-15) | PO decisions 2026-11-23; ADR-019; PWA §4 |
| R-2 | **Measure first, by tool** (rewritten). Every budget is a row in `tests/e2e/perf/latency-budgets.ts` (`id`, `kind`, `maxCalls`, `maxDepth`, `targetMs`, `maxMs`, `owner`, `budget` tag). 09E-01 enforces `maxCalls` and `maxDepth` for every row at its measured baseline, so nothing gets worse from the first commit; each plan lowers its rows in the commit that meets the target. `targetMs` and `maxMs` are printed, never enforced. The 09D ceilings move into this table and `request-budget.spec.ts` reads them from it. Numbers in notes, summaries and the verification come from the lane's JSON only | CLAUDE.md DoD 5 |
| R-3 | **Latency injection and depth** (rewritten; no new dependency). Server: a preload `tests/e2e/support/server-latency.cjs` loaded through the e2e app env's `NODE_OPTIONS` beside the network guard and the auth-fault hook (the `server-auth-faults.cjs` precedent): while the rule file `playwright/.auth/latency.json` = `{ "ms": N, "record": "<path>" }` exists, every `fetch` to the local Supabase origin (loopback, port 54321) waits N ms before it is sent and appends `{t0, t1, method, path}` (path without ids or query) to the record file; anything else is untouched; the file is read with an mtime check, so no restart. Browser: `context.route` on the Supabase origin waits N ms, records the same, then continues (HTTP only; the Realtime socket is not delayed and the report says so). Global setup deletes a stale rule file. **Depth** of a measured window = the largest set of calls whose intervals do not overlap, i.e. the longest chain of calls that waited for one another; with 300 ms injected, a parallel batch overlaps and a dependent call starts after its predecessor ends, so the number is deterministic. **Calls** = Kong's count (server and browser). Calibration row (always enforced): every recorded interval lasts ≥ N ms and the recorded count equals Kong's. Rejected: Docker `tc netem` (needs `NET_ADMIN`, delays Kong's upstream hops and every lane sharing the stack), a delaying proxy port (the Supabase URL is inlined at build time) | Deterministic, per call, reversible without a rebuild |
| R-4 | **Budgets in CI** (rewritten; decision 8). Blocking: calls and depth per row, the functional assertions (skeleton before data, reversible result before the response, no success before the response, a dropped signal recovered by the clock-advanced heartbeat), catalogue bytes. Report-only: milliseconds. On every PR: the `@budget` subset at 300 ms after the PR lane (calibration; B-1 for Today, Patients, consult draft, Schedule day; B-4 one per catalogue once built; B-7 for check in and Rx add), with the ms table in the step summary (about 4 minutes). Nightly: the full lane, its ms report in the summary and as an artifact. Background requests (session status, heartbeat, RUM beacons) are held during a measured window (the 09D-01a method of `request-budget.spec.ts`) and counted in their own rows. Desktop-chrome; typeahead and index rows add 4× CPU throttling (CDP `Emulation.setCPUThrottlingRate`) for their ms; the real low-end phone is the device checklist (PO-13). A failing row is root-caused like a flaky test, never re-run to green | CI time (95-minute job); flaky-test policy |
| R-5 | **Reference catalogues on the device** (rewritten: no server cache). Catalogues: `substances` (`cdci_substances`), `diagnoses` (`opd_diagnoses`), `medicines` (`cdci_medicines_search` brands with their generic and its `substance_ids`). Version: `public.reference_catalogues(catalogue, version uuid, changed_at)` bumped by statement triggers on every catalogue table (insert, update, delete, truncate), so any reload changes it without app code. Shards: `public.reference_shard(p_tenant_id, p_catalogue, p_shard)` (INVOKER, member with the catalogue's permission) returns compact rows of one shard (`substances` and `diagnoses` 1 shard; `medicines` brands in shards of 12,000 by id plus one generics shard), each ≤ 1 MB raw (Vercel's 4.5 MB response limit). Routes: `GET /api/reference/manifest` (`private, no-cache`, ETag; versions and shard counts of the catalogues the caller may read; one call) and `GET /api/reference/{catalogue}/{version}/{shard}` (`private, max-age=31536000, immutable`; a version that is not current is 409 with `no-store`; one call). No server cache of either (PO 2026-11-23); the browser's HTTP cache and IndexedDB are the cache. Device: IndexedDB `cliniq-reference` (platform API, a small promise wrapper, no dependency) with stores `meta` and `rows`; a sync step fetches the manifest at app start, on resume and before the first search, downloads only missing shards after first paint (`requestIdleCallback`), checks that every shard carries the manifest's version, stores them, then deletes older versions. IndexedDB unavailable or over quota: memory only for the tab. Until a catalogue is ready its search uses the existing route; the UI never waits for the download. The catalogue index keeps its own worker and store, outside the query layer (decision 4) | Strategy 1; Q-2; ADR-019; Vercel limits |
| R-6 | **Search parity.** For each catalogue a pure TypeScript twin of the SQL search (`lib/reference/search-*.ts`) and one case table run against both (the 09C allergy-rule pattern, `tests/prescriptions/allergy-match.spec.ts`): same ids, same order, same limit. A pg_trgm `similarity()` twin (`lib/reference/trigram.ts`: lower-case, words of alphanumerics, two leading spaces and one trailing, distinct trigrams, \|A∩B\| ÷ \|A∪B\|) with its own table against SQL. Name ties sort by `lower(name) COLLATE "C"` in the three SQL functions (000128 replaces their bodies, the tie-break only), so the device and every database agree whatever their default collation. Non-ASCII names are in every table, so a `lower()` difference shows as a failure | One rule, two implementations, one table |
| R-7 | **Medicines on the device.** A columnar index in a Web Worker (one lower-cased string of brand names with an offsets array, generic index per brand, one string of generic names, substance ids per generic): ranks 1 to 4 of `search_medicines` (brand prefix, a word of the brand, generic prefix or word, inside) are computed locally with exact parity; rank 5 (trigram ≥ 0.3 on 93,911 brands) is not: when the local ranks give fewer rows than the limit (15), the route is asked once and its answer replaces the list when it arrives (the database is the authority for the tail). The doctor's own custom medicines (from the consult's query, R-8) come first by `use_count` with the trigram twin, and a CDCI row with the same name as a custom one is dropped, as in SQL. A CDCI row never carries a dose (09C R-4). If B-14 fails on the measured index, the fallback ships generics and substances on the device and keeps brands on the server (recorded, PO informed) | B-4 without a 15 MB trigram index on a phone |
| R-8 | **Per-doctor data in the consult's query** (rewritten). `consult_screen` returns the caller's own custom medicines (up to 500 by `use_count`), custom diagnoses (up to 500), protocol templates (up to 100), macros, favourites and usual doses (the 09C `consult_assist_context` keys) and the learned order (`my_lists`). They live in the consult's query (memory only) for its lifetime, are updated with `setQueryData` from each save's result (a custom medicine's `use_count + 1` and stored dose exactly as `change_prescription` does, 09C R-2; a custom diagnosis likewise; a saved template or macro), and no sheet or keystroke reads them again | Strategy 2; PWA D-3 |
| R-9 | **One round trip per screen; PHI stays off the device** (rewritten). A page awaits its independent reads together; a read that needs another's result, or slow data the first paint does not need (the next-up snapshot on Today, the print view of a sealed consult, a patient's history and documents), streams under `Suspense` with its own skeleton. Today, Schedule and the consult read through one SQL function each (`today_board`, `schedule_range`, `consult_screen`); other screens through one `Promise.all`. A page passes its read into the screen's query (`HydrationBoundary`) where the screen has one, so a navigation always shows what the database just answered and first-load content stays server-rendered (small client JS on low-end phones). PHI responses stay `private, no-store`. No PHI route is prefetched beyond its loading boundary; `/patients/[id]` never (opening it writes `patient.view`), and the Patients list renders with no patient read for its links. Screens with no live domain (a patient, Visits, Billing reports, Settings, Staff) show "Changed on another device · Refresh" when a domain they display moves (R-18); they never re-render by themselves (a re-render of a patient would write another `patient.view`). Next's `staleTimes` stays at its default | DATA_HANDLING §3; PWA D-3, D-4; priority 2 |
| R-10 | **Schedule data layer** (rewritten; decisions 7, 11). `public.schedule_range(p_tenant_id, p_from date, p_to date, p_include_slots boolean DEFAULT true)` (INVOKER, `appointments:view`, at most 42 days) returns the clinic zone, the server time, the clinicians (id, display name, slot minutes, effective weekly schedule), the schedule blocks, the visits of the range with the fields the cards and booking sheets use today plus `row_version`, the free slots of each clinician and clinic-local date computed by `private.available_slots_core` (the function `available_slots` uses; start minutes from local midnight), and the `schedule` and `queue` versions from the same statement. **No slot rule in TypeScript:** the only client step is hiding slots whose start has passed by the device clock offset to the server time (display only; the commands refuse a past or taken slot through `slot_conflicts`). One query per range; the visible range hydrated from the page; changing the day or week updates the URL with `history.pushState` and reads the query; the adjacent range is prefetched after the visible one settles; live by R-18. A 42-day range in one call and `p_include_slots false` (a month grid needs counts, not slots) are tested now, so the week grid and month views plug in later | Decisions 7, 11; strategy 4; 08 R-10 |
| R-11 | **Saves by risk class** (rewritten; decision 5). **Reversible** (queue moves on Today: check in, start consult, complete, moves between lanes; consult draft autosave; Rx line add, edit, remove; diagnosis add, remove, note; vitals): the result shows at once with a pending marker, one command, and on failure (including `ROW_CHANGED`) the previous state comes back with the fixed error and Retry. **Confirm class** (register and book, book, reschedule, promote from the waitlist, walk-in, cancel, no-show, collect payment, record payment, complete and bill, allergies, settings saves, sign and finish): a pending state only (button spinner, "Saving…"), success only after the database confirmed; on failure the user's input stays. Both: one command per save; the command's result applied with `setQueryData` (no read-back); no `revalidatePath` on a hot path; other devices converge through R-18; a retry reuses the request id (PWA-06); "Saved" is never shown before the server confirmed | Decision 5; DESIGN §6.9; ADR-004 |
| R-12 | **Instant feel** (strategy 6). Every main route has a `loading.tsx` with a skeleton that matches its layout (DESIGN §6.9: static `sunken` blocks, the real page title at once); navigation keeps `next/link` with the default prefetch; the `patient.view` audit insert moves after the response (`after()` from `next/server`; still written once per opening, failures logged by tag) | DESIGN §6.9 |
| R-13 | **Session bootstrap; live data never held** (rewritten; decision 1, C-1). Held in client memory for the session: profile (own user id, display name), clinic (id, name, IANA zone; `Asia/Kolkata` when unset; the zone stays per clinic), role (display and navigation only), doctor directory (ids and display names), Rx print and letterhead display settings. Read by `public.session_bootstrap` with the `settings` version from the same statement; loaded once at app start (hydrated on a full load); refreshed on a newer `settings` version (signal or heartbeat), on resume and on reconnect; cleared at sign-out, clinic switch and lock. **Never held** by the bootstrap or any long-lived copy: availability, schedule blocks, slots, bookings, queue, fees (read with the bill), billing, payments, subscription, access level, entitlements, roles and permissions. They are live data read from the database (the schedule and queue screens under R-18), and every permission is decided by the server and the database on each request. No cookie fields; no server cache; ADR-019 unchanged | Decision 1; ADR-019; priority 2 |
| R-14 | **One client data layer: TanStack Query** (rewritten; decision 4; replaces "no client-cache library"). Why the dependency: four surfaces need client caching with their own invalidation (the Today board, schedule ranges, the consult's lists and lines, the bootstrap) plus optimistic mutations with rollback, prefetch, and refetch on focus and reconnect; one maintained library (MIT, TanStack) gives dedupe, invalidation, mutations and server hydration instead of four hand-built stores, and FRONTEND_TECHNOLOGY §5's gate (three or more surfaces) is met. Constraints: `@tanstack/react-query` only, exact pin; **memory only**: no persister, no storage, no devtools (imports banned by lint); one `QueryClient` per tab, created in the dashboard shell; keys built only by `lib/query/keys.ts`, tenant id first, ids and modes only (no names or text); `queryClient.clear()` registered with `lib/pwa/cleanup.ts` (sign-out, clinic switch, lock D-8); reads retry once, mutations never auto-retry (the command helper retries with the same request id); refetch on focus and reconnect for active queries. The catalogue index stays outside it (R-5) | Decision 4; FE-TECH §5 |
| R-15 | **Platform rules** (rewritten). No service-role client (ADR-0005): reads under the caller's JWT, INVOKER, tenant from the session; routes authenticate, check the permission and derive the tenant from the session; every command is correct without any cookie (API callers use the same commands). No PHI in IndexedDB, localStorage, sessionStorage, Cache Storage or the HTTP cache. Dates through `lib/datetime` (ADR-016); slots in the clinic zone. No per-flow flags (PO-15). One new dependency (R-14); Web Vitals through Next's built-in `useReportWebVitals` (no `web-vitals` package); IndexedDB, Web Workers, compression and timing use platform APIs | CLAUDE.md non-negotiables |
| R-16 | **Evidence and latency.** `node scripts/phase-evidence.mjs .planning/phases/09E-caching-speed/evidence 1`, then `--ci-run <id>`; the baseline and final `perf-latency` and `perf-roundtrips` summaries; `reference-size.json`; `db-top-queries.{json,md}`; `scripts/perf/command-latency.ts` gains `consult_screen` (300 signed visits for one doctor, p95 < 50 ms), `today_board` (3 doctors, 120 visits, < 50 ms), `schedule_range` (42 days, 3 doctors, 600 visits, with slots, < 100 ms), `reference_shard` (12,000 brands, < 200 ms) and `clinic_live_state` (< 10 ms) | CLAUDE.md DoD 5 |
| R-17 | **Migrations.** New files only; a replaced function starts from its latest body (`grep -n "FUNCTION <name>" supabase/migrations/*.sql`) and changes only what the plan names; a command that gains a parameter is dropped and created again with the parameter last and `DEFAULT NULL` (no overload left; named calls from the running app still resolve during a deploy, because the database migrates first), grants and comment restored; no grant widening beyond EXECUTE on the new reads and SELECT on the new tables for `authenticated` | CLAUDE.md |
| R-18 | **Live convergence** (new; decisions 2, 3). **Domains** `schedule`, `queue`, `billing`, `settings`. **Versions:** `public.clinic_versions(tenant_id, domain, version, changed_at, last_xact)`, written only by `private.clinic_bump`, called by statement-level triggers in the writer's transaction; it raises a clinic's domain version once per transaction (the first statement bumps; later ones see their own transaction id) and sends one signal `{domain, version}` on `today:<tenant>` (topic and policy unchanged; the old `{kind, visit_id}` payload goes; no id in a signal). **Reads:** a live read (`today_board`, `schedule_range`, `session_bootstrap`, `clinic_live_state`) returns the versions of its domains from the same statement as its data (exact basis); any other read's basis is the highest version the device had seen when the fetch started (a lower bound: at most one extra re-read, never a missed one; research §2.1). **Device:** one channel per clinic, opened by the shell while the tab is visible (closed 60 s after it is hidden); a heartbeat `GET /api/live/state` every 12 s while a live screen (Today, Schedule) is visible, **also while SUBSCRIBED**; an immediate check on SUBSCRIBED (first join and every rejoin), tab visible, `online` and resume. A version above a query's basis, from any source, re-reads the active dependents (coalesced 400 ms) and removes the inactive ones (never shown once behind). Access level from the live state ≠ `full` → the existing D-8 path. **Badge:** "Live" while SUBSCRIBED and a signal or check confirmed the versions within 24 s; otherwise "Reconnecting" with "Updated N s ago". Worst case when Realtime fails: about 14 s at staging cost (research §2.3); PO accepted ~15 s | Decisions 2, 3; debug doc; priority 2 |
| R-19 | **Stale-write refusal** (new; decision 6). `visits.row_version` and `invoices.row_version` (000123) rise by 1 on an update of a listed column only (a background write to `metadata` or a reminder column moves nothing). The queue and billing edit commands (000126; research §1.1) take `p_expected_version` and, after their existing row lock and request-id replay, raise `ROW_CHANGED` (P0001) before any write when it differs; their results carry the new `row_version`. The app always sends the version its query shows (the TypeScript input requires it); the screen answers "This changed on another device. The latest is shown." and re-reads. Commands that create (walk-in, invoice creation) have nothing to compare. The consult draft keeps its own `draft_version` (09B R-2). Invoice-item writes are direct table writes today; V2-10 replaces them with commands that use `invoices.row_version` (hand-off) | Decision 6; priority 2 |
| R-20 | **Observability without a vendor** (new; decision 10; PO-12, C39, P1-25). Server: a per-request accumulator counts Supabase calls, sums their time and keeps their intervals (depth); one `request.timing` log line per request through `lib/log` (`route` pattern, kind page/action/route, `db_calls`, `db_ms`, `db_depth`, `total_ms`, `request_id`; no URL, query, id, name or text); route handlers also send `Server-Timing` (pages cannot set headers once streaming starts). Database: `pg_stat_statements` top queries, a local script and a read-only SQL file the PO runs on staging (agents never connect to staging). Real users: Next's `useReportWebVitals` (LCP, INP, CLS, TTFB, FCP) and our own timings (navigation to data ready, search keystroke to results by source, save to confirmed by class, live re-read time, dropped signals caught by the heartbeat, reconnects), sampled per session, sent to `POST /api/rum`, aggregated in `ops.rum_daily` (day, environment, release, screen, metric, device, network class, bucket, count: no tenant, user, URL, id or text; 90 days), with `ops.rum_report(p_days)` giving p50/p75/p95 per screen. Testing: the per-PR call and depth budgets, the nightly latency report, LHCI unchanged (report-only nightly, PWA-09; blocking at V2-15), a staging smoke timing script the PO runs | Decision 10; PO-12; PO-23(h) unchanged (no processing outside India added) |

## Shared rules for every plan

- Read functions: INVOKER, STABLE, `search_path = ''`, every name schema-qualified, `p_tenant_id` from the session and checked in the body
  with `public.has_permission` (a forged id returns nothing), EXECUTE for `authenticated` only, the narrowest output; each gets a pgTAP file
  (grants, refusal for another clinic and for roles without the permission, output shape) and a `command-latency.ts` entry. Live reads return
  their versions from the same statement (R-18).
- Routes: session auth, permission, tenant from the session, fixed error bodies (the 09C route conventions: 401, 403, 403 `SUBSCRIPTION_LOCKED`,
  503, 500), `private, no-store` for anything tenant-scoped, `Server-Timing` (R-20), and registered in `tests/security/guard-manifest.ts`.
- Registries a migration or route touches: `tests/security/guard-manifest.ts` and `npm run inventory` for every added or removed action or
  route, the pgTAP grantee sets (`grants.test.sql`), the schema snapshot (`node scripts/drift/schema-snapshot.mjs --local --write`, then
  `--check`; `npm run db:drift:local`), `npm run db:types`, `app/api/ready/expected-migration.ts`, `scripts/ci/assert-pgtap-report.mjs`
  (REQUIRED_FILES and FLOOR = the measured total with the arithmetic) and `scripts/ci/assert-vitest-report.mjs` REQUIRED_FILES, all in the
  migration's commit.
- Affected-test discovery: before editing, grep for what the plan changes and list the hits in the notes, for example
  `grep -rln "consultation/\[id\]\|getVisitPrescription\|getRxAllergyContextAction\|getDoctorProtocolTemplates\|fetchMedicines\|fetchDiagnosisHits\|fetchSubstances\|search_medicines\|search_diagnoses\|search_substances\|available_slots\|getAvailableSlots\|getActiveClinicDoctors\|useTodayLive\|today_signal\|router.refresh\|revalidatePath\|RouteSkeleton\|LiveStatus\|indexedDB\|purge\|registerCleanup" tests scripts`,
  narrowed per plan. The grep, not any list in this plan, is authoritative.
- Each e2e test owns its data (`tests/e2e/support/own-doctor.ts`, its own patients); synthetic catalogue rows are global fixtures with
  fixed ids (`test-ref-*` for parity, `perf-*` for the perf catalogue) upserted by the test that needs them; the perf catalogue is removed by
  the lane's teardown. No test reads `.env*`; synthetic data only.
- Tests assert real outcomes (rows, ids, order, bytes, versions, signals in `realtime.messages`, Kong counts, call intervals, IndexedDB
  contents, DOM state, timings from the page for reports), never source text or "renders". One "fails without" proof per High control (listed
  under Execution). No mutant runs. E2E on desktop-chrome, pixel-7 and iphone-15 with 0 retries where the behaviour depends on the device
  (IndexedDB, the worker, the socket, skeletons, touch); lane rows on desktop-chrome only. Clock-dependent cases use Playwright's `page.clock`,
  never sleeps. Axe 0 serious or critical at 360, 820 and 1280 for every new skeleton, badge, notice and state.
- UI work: V2-06 parts, no hex or raw palette class, `dvh` not `vh`, 44 px touch targets below 1024, no new React Compiler waiver,
  `npm run ci:ui-policy` and `npm run ci:ai-l1` clean.
- Plan record: each executor appends a section to `.planning/phases/09E-caching-speed/09E-NOTES.md` (what changed, deviations, grep hits,
  test names, the exact commands with counts, the lane rows it lowered with their calls, depth and medians copied from the JSON). Evidence
  is never typed.
- Run order inside a plan: migration first (`npx supabase db reset --local`, `npm run db:types`), then service, then UI, then specs; then the
  affected Vitest and pgTAP files, `npm run typecheck`, `npx eslint .`, `npm run inventory`, `npm run e2e:build` (always rebuild first), the
  plan's e2e files, and `npm run perf:latency`. `npm run stack:recycle` before an evidence or lane run and between executors, never mid-run.
  Delete `.planning/dev-messages.txt` if a run recreates it.
- Never run `seed:cdci*`, `seed:diagnoses`, `msg91:*`, `perf:staging-smoke` (PO only; it targets staging) or anything with `--env-file=.env`;
  never read `.env*`; local stack only. Reading `supabase/seed-data/**` files from a script that touches no database is allowed (09E-09,
  09E-11 size measurement).

## Plans

### 09E-01 Latency lane, call and depth budgets, baseline · M · no migration, no product code

Goal: R-2 to R-4. Every main screen, typeahead and save is measured with 300 ms added to every Supabase call; calls and depth
block CI from this plan at their baseline values; milliseconds are reported; the baseline is recorded.

Files: new `tests/e2e/support/server-latency.cjs`; `tests/e2e/support/app-env.ts` (third preload in `NODE_OPTIONS`); `tests/setup/test-env.ts`
and `tests/setup/e2e-app-env.spec.ts` where they pin the preload list; new `tests/e2e/support/latency.ts` (`setSupabaseLatency(context, ms)`,
`clearSupabaseLatency()`, `callIntervals(window)`, `depthOf(intervals)`, in-page timers `timeToVisible(page, trigger, locator)` and
`timeToOption(page, key, expected)`); `tests/e2e/global-setup.ts` (stale rule file removed); new `tests/e2e/perf/latency-budgets.ts`;
`tests/e2e/shell/request-budget.spec.ts` (ceilings read from the table); new `tests/e2e/perf/latency-pages.ts` (the rows: URL, role, link to
click, first data element, using `today-page.ts`, `schedule-page.ts`, `rx-entry.ts`); new `tests/e2e/perf/page-latency.spec.ts`;
`playwright.config.ts` (project `perf-latency`, desktop-chrome, retries 0, one worker); `package.json` (`perf:latency`; the spec reads
`PERF_LATENCY_MS`, default 300, and 0 gives the reference run); `.github/workflows/ci.yml` (step "Latency budgets" after the PR lane:
`npx playwright test --project=perf-latency --grep @budget`, the ms table appended to the step summary); `.github/workflows/nightly.yml`
(the full lane, its summary and an artifact); new `tests/perf/{server-latency,depth}.spec.ts`.

1. Tracer (committed first). `server-latency.cjs` and `latency.ts`, then one row: the receptionist on Today clicks the Patients nav link;
   the page timer records click → skeleton → first row; Kong counts the window; the intervals give its depth; the report writes one line.
   Calibration row: every recorded interval of its window lasts ≥ 300 ms and the recorded count equals Kong's. Acceptance: calibration
   green; the row reports calls, depth 1 or more, and a time.
2. `depthOf` (R-3): the largest set of pairwise non-overlapping intervals (greedy by end time; an end equal to a start counts as
   sequential). Unit table `tests/perf/depth.spec.ts`: empty 0; one parallel batch 1; two sequential 2; a batch then one 2; two interleaved
   chains (the longer wins); browser and server calls mixed.
3. Rows: every row of the baseline table, with `@budget` on the CI subset (R-4). Saves need their own data each sample (`seedBookedToday`,
   own doctor, fresh visits); typeahead rows type the query less one character, settle, then time the last key in the page. Background
   requests held per R-4. Report `test-results/perf-latency/summary.{json,md}`: per row the calls by path (server, browser), depth, median
   and max ms, the RSC requests the step caused (`page.on("request")`), the target and the verdict. The spec fails when any sample's calls
   exceed `maxCalls` or its depth exceeds `maxDepth`; milliseconds never fail it.
4. Unit: `tests/perf/server-latency.spec.ts` loads the preload with a fake inner `fetch`: delayed and recorded only for the loopback
   Supabase origin and only while the rule file exists; other origins and calls after the file is removed untouched; the delay equals the
   file's value.
5. Baseline (R-2), on the tree as branched: `npm run e2e:build`, `npm run perf:roundtrips`, `npm run perf:latency` at 0 ms and at 300 ms;
   the three summaries copied to `evidence/baseline/`; each row's `maxCalls` and `maxDepth` set to its measured baseline (the notes cite the
   JSON entry of each); the notes list the rows furthest from their targets.

Tests: `npx vitest run tests/perf tests/setup/e2e-app-env.spec.ts`; `npm run perf:latency`; `tests/e2e/shell/request-budget.spec.ts` on the
three PR projects (same ceilings, now read from the table). The PR lane is otherwise unaffected (no product change).
Done: calibration green locally and in CI; every budget row present with its owner plan; the CI step blocks a rise in calls or depth;
baseline files committed.

### 09E-02 Observability without a vendor: server timing, database report, real-user monitoring · M · migration 000122_rum_daily · split point after step 3

Goal: R-20. A slow screen on staging can be diagnosed from what we own: each request's database calls, depth and time (log line;
`Server-Timing` on route handlers), the top database queries, and real-user p50/p75/p95 per screen stored in India with no PHI.

Files: new `lib/observability/db-timing.ts` (per-request accumulator on the 09D request memo; a fetch wrapper around `transport.fetch`
that counts calls, sums time and keeps intervals; it registers one `after()` per request that writes the line); `lib/supabase/server.ts`;
`proxy.ts` (adds the request's route pattern, built by `routePattern()`, as a request header beside `x-request-id`); `lib/log/fields.ts`
(fields `db_calls`, `db_ms`, `db_depth`, `total_ms`, `timing_kind`); new `lib/observability/server-timing.ts` (`withServerTiming(response)`);
the GET route handlers under `app/api/` that read data (later routes use it from birth); new `scripts/perf/db-top-queries.ts` and
`package.json` `perf:db-top`; new `scripts/perf/top-queries.sql`; new `scripts/perf/staging-smoke.ts` and `package.json`
`perf:staging-smoke`; `supabase/migrations/000122_rum_daily.sql`; new `supabase/tests/database/rum_daily.test.sql`; new
`lib/observability/rum/{catalog.ts,collector.ts}`; new `components/shell/{rum-reporter.tsx,data-ready.tsx}` (the reporter in the dashboard
shell; `DataReady` is the first-data marker each main screen renders); new `app/api/rum/route.ts`; `lib/env.ts`, `.env.example`,
`tests/e2e/support/app-env.ts` (`NEXT_PUBLIC_RUM_SAMPLE_RATE`, default 1); registries; tests.

1. Tracer (server). The diagnosis search route answers with `Server-Timing: db;dur=<ms>;desc="calls=<n> depth=<d>", app;dur=<ms>` and
   writes one `request.timing` line; an e2e reads the header through `PerformanceResourceTiming.serverTiming` and finds the line in the e2e
   server log (`tests/e2e/support/server-log.ts`) with `db_calls` equal to Kong's count for that request.
2. Every request: pages, server actions (with the action's name) and route handlers write the line; route handlers send `Server-Timing`.
   The accumulator belongs to one request and is never shared. No URL, query, id, name or error text in either.
3. Database and staging tools. `db-top-queries.ts` reads `extensions.pg_stat_statements` on the local stack (refuses a non-loopback
   database URL): the top 25 by total and by mean time with calls, rows, mean and max ms and the normalised query text; `--reset` (local
   only) before a measured run; writes `evidence/db-top-queries.{json,md}`. If the local stack lacks the extension, 000122 adds
   `CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions` (on by default in hosted projects). `top-queries.sql`: the
   same SELECT with no reset, for the PO to run on staging in the SQL editor. `staging-smoke.ts` (Playwright library, headed): the PO signs
   in by hand, then it walks Today, Schedule day and week, Patients, one patient, one consult and one medicine and one diagnosis search (no
   writes) and writes `staging-smoke-<date>.{json,md}` with each step's navigation-to-data-ready time (the app's own marks), the
   `Server-Timing` of the data routes and the Web Vitals. A `--local` mode (loopback only, local synthetic login) is how the executor checks
   it; agents never run it against staging.
   Split point.
4. Migration 000122. (a) `ops.rum_daily (day date, environment text, release text, screen text, metric text, device text, net text,
   bucket smallint, count bigint, PRIMARY KEY (day, environment, release, screen, metric, device, net, bucket))` and `ops.rum_overflow
   (day, dropped)`; RLS on; no API grant (schema `ops` stays unserved). (b) `public.ops_ingest_rum(p_environment text, p_release text,
   p_samples jsonb)` (SECURITY DEFINER, `search_path = ''`, EXECUTE for `authenticated` only): refuses an unknown key, a value outside the
   closed lists of `screen`, `metric`, `device` and `net`, a non-numeric or out-of-range value and more than 60 samples; maps each value to
   its bucket (fixed log-spaced bounds in ms; a separate set for CLS; count metrics use bucket 0) and adds 1; a daily total cap sends the
   rest to the overflow counter. (c) `ops.rum_report(p_days integer DEFAULT 7)` → p50, p75, p95 (bucket upper bounds) and count per screen,
   metric and device; postgres only (the PO runs it in the SQL editor). (d) `ops.cleanup()` replaced from its latest body (000040) to also
   delete `rum_daily` and `rum_overflow` rows older than 90 days; its comment lists them.
5. Client. `rum-reporter.tsx` uses Next's `useReportWebVitals` (LCP, INP, CLS, TTFB, FCP) and `collector.ts` (`rum.record(metric, value)`)
   for our timings: `nav_data_ready` (link click → the screen's `DataReady`), `load_data_ready` (navigation start → `DataReady`),
   `search_server` and `search_device` (keydown → first option), `save_reversible`, `save_confirmed`, `finish_confirmed` (click → confirmed
   state), `live_reread` (newer version seen → screen updated), `live_dropped` (the heartbeat found a version no signal brought),
   `live_reconnect`. This plan instruments navigation and server search; 09E-04, 09E-08 and 09E-09 to 09E-11 add the live, save and device
   search points as they build them. `screen` is the route pattern mapped to a closed list (`today`, `schedule`, `patients`, `patient`,
   `consult`, `visits`, `billing`, `settings`, `staff`, `other`); `device` `phone|tablet|desktop` from the viewport width; `net` from
   `navigator.connection.effectiveType` or `unknown`. One sampling decision per session (`NEXT_PUBLIC_RUM_SAMPLE_RATE`); batched;
   `navigator.sendBeacon` on `visibilitychange` to hidden and every 60 s; never a URL, id, text or time of day.
6. Route `POST /api/rum`: session required (any active member); body ≤ 8 kB; zod strict with the same closed lists; ≤ 60 samples; an
   in-process limit per user (10 batches a minute); environment and release from the server's deployment info, never from the browser;
   one call to `ops_ingest_rum`; `private, no-store`; 204. Tenant and user are not stored.
7. Specs (below).

Tests: Vitest `tests/observability/{db-timing,server-timing,rum-collector,rum-route}.spec.ts`: one accumulator per request, never shared;
depth from intervals; header format; the line holds only allow-listed fields and a route pattern (an id-bearing path is refused); collector
buckets and closed lists; route 401, 400 for an unknown key or a value holding a uuid or a `/`, 413, 429. pgTAP `rum_daily.test.sql`: no API
role reads `ops`; every malformed sample shape is refused with no row written; counts add up; the cap sends the rest to overflow;
`rum_report` percentiles on a synthetic histogram; `ops.cleanup()` deletes rows older than 90 days only. e2e
`tests/e2e/observability/rum.spec.ts` (desktop-chrome, pixel-7): open Today and a consult, run a search; every captured beacon body holds
only closed-list keys and numbers; `ops.rum_daily` gains those screens and metrics (read as postgres on loopback inside the test); the
`request.timing` lines match Kong's counts. Fails-without (High: nothing identifying reaches `ops`): with the SQL closed-list check on
`screen` removed, a sample whose screen is a uuid writes a row; recorded, restored.
Done: line and header on every data route (listed in the notes); `perf:db-top` report in evidence; RUM rows from the e2e run;
`staging-smoke.ts --local` passes.

### 09E-03 Client data layer: TanStack Query, with Today on it · M · no migration · new dependency `@tanstack/react-query`

Goal: R-14. One memory-only client data layer, cleared at sign-out, clinic switch and lock. Today's live refresh re-reads only the board into
its query; no `router.refresh()`.

Files: `package.json`, `package-lock.json` (`@tanstack/react-query`, exact; nothing else); new `lib/query/{client.ts,provider.tsx,keys.ts,
policy.ts,server.ts}` (`server.ts`: a per-request `QueryClient` and `dehydrate` for pages); `app/(dashboard)/layout.tsx` (the provider inside
the shell); `lib/pwa/cleanup.ts` (registers `clear()`); the client side of the clinic switch and `lib/pwa/lock.ts` (clear before the D-8
navigation); `eslint.config.mjs` (`no-restricted-imports`: any `@tanstack/*persist*` package, `@tanstack/react-query-devtools`); new
`app/api/today/board/route.ts` (`appointments:view`, `private, no-store`, `Server-Timing`, the existing `getTodayBoard`);
`app/(dashboard)/today/page.tsx` (`HydrationBoundary`); `components/today/{today-board.tsx,use-today-live.ts}`;
`components/shell/app-shell.tsx` (resume invalidates the live queries instead of `router.refresh()`); `tests/security/guard-manifest.ts`;
tests.

1. Tracer. The provider and the Today board query: the page awaits the board as now and hydrates `keys.today(tenantId, mode)`; a signal
   invalidates it; the re-read is one `GET /api/today/board` into the same key, with no RSC request. Row `live.today.refresh` at the
   current service's calls and depth (visits, then invoices, then payments, until 09E-06).
2. `policy.ts` and `keys.ts` (R-14): defaults, key builders, the `meta.domains` slot used from 09E-04, no persister.
3. Clearing: sign-out, clinic switch and lock clear the client before anything else renders.
4. Today: `use-today-live.ts` keeps its 400 ms coalescing and its fallback poll until 09E-04 replaces them; its refresh invalidates the
   query; so does the shell's resume.

Tests: Vitest `tests/query/{keys,cleanup}.spec.ts` (keys start with the tenant and hold ids and modes only; after the cleanup runs the client
is empty and a new query never sees old data); `tests/today/live.spec.ts` adjusted; `tests/api/today-board-route.spec.ts` (401, 403,
`SUBSCRIPTION_LOCKED`, `no-store`, exact keys). e2e: `tests/e2e/today/today-live.spec.ts` (a check-in in context B appears in A; the refresh
is one board GET and no RSC request); new `tests/e2e/shell/query-clear.spec.ts` (clinic switch: a MutationObserver installed before the
click records every row text, and no row of clinic A appears after the switch; sign-out, then another user on the same context: no row of
the first clinic ever renders); `tests/e2e/pwa/05-cache-audit.spec.ts` still finds nothing from the query layer in any storage.
Fails-without (High: data crossing clinics): with the `clear()` registration removed, the clinic-switch case sees a clinic A row; recorded,
restored. `npm run ci:route-js` before and after (B-15, in the notes).
Done: one data layer, cleared on every exit; Today refreshes without a page re-render; the full PR lane green once with 0 retries.

### 09E-04 Live convergence: clinic versions, one signal per transaction, heartbeat, live badge · M-L · migration 000123_clinic_versions · split point after step 2

Goal: R-18, and R-19's row versions. Every device converges on the database: within one signal (about 1 to 2 s) normally, within 15 s when
Realtime drops or refuses the signal, and the screen says which.

Files: `supabase/migrations/000123_clinic_versions.sql`; new `supabase/tests/database/clinic_versions.test.sql`; `tests/realtime/today-signals.spec.ts`;
new `lib/live/{live-core.ts,provider.tsx,use-live-screen.ts,use-changed-elsewhere.ts,domains.ts}`; new `app/api/live/state/route.ts`;
`lib/query/keys.ts` (domains per key); `components/today/{use-today-live.ts,live-status.tsx,today-head.tsx,today-board.tsx}` (Today registers
as a live screen; `LiveStatus` gives way to the badge); new `components/shell/live-badge.tsx`; `components/shell/app-shell.tsx` (the provider;
resume and `online` hooks); `lib/pwa/lock.ts` (access level from the live state); new `tests/live/live-core.spec.ts` (replaces
`tests/today/live.spec.ts`); new `tests/e2e/live/convergence.spec.ts`; `tests/e2e/today/today-live.spec.ts`; registries.

1. Tracer: one domain end to end: the table, the bump, the `queue` trigger on `queue_tokens`, the signal `{domain, version}`, the live state
   route, `live-core` with its heartbeat, and the Today query re-read on a newer `queue` version. Acceptance: a check-in in B updates A; with
   A's broadcast frames dropped, advancing A's clock past 12 s updates A.
2. Migration 000123.
   (a) `public.clinic_versions (tenant_id uuid REFERENCES public.tenants ON DELETE CASCADE, domain text CHECK (domain IN ('schedule','queue',
   'billing','settings')), version bigint NOT NULL DEFAULT 0, changed_at timestamptz NOT NULL DEFAULT now(), last_xact xid8, PRIMARY KEY
   (tenant_id, domain))`; RLS on; SELECT for active members of the clinic; no write grant; four rows per existing clinic, and a trigger on
   `tenants` insert creates them.
   (b) `private.clinic_bump(p_tenant_ids uuid[], p_domain text)` (definer, no API grant): the once-per-transaction upsert (research §2.2) and,
   for each clinic it raised, `private.today_signal_send` with `{domain, version}` inside the existing error-swallowing block (a Realtime fault
   never rolls back a write).
   (c) Statement-level `AFTER` triggers with transition tables (one per table and event; the UPDATE functions compare the listed columns of
   the old and new rows themselves) replace every row-level `*_today_signal*` trigger, and `private.today_signal()` is dropped: `visits`
   insert → schedule, queue; update of `status` → queue, schedule; update of `scheduled_at`, `doctor_id`, `estimated_duration_minutes`,
   `is_overbooked`, `origin_type` → schedule; `queue_tokens` insert, update → queue; `clinical_notes` update of `vitals` → queue; `invoices`
   insert, update of `total_amount`, `status` → billing; `invoice_items` insert, update, delete → billing; `payments` insert, update → billing;
   `schedule_blocks` and `waitlist_entries` insert, update, delete → schedule; `memberships` insert, delete, update of `availability_schedule`,
   `default_slot_duration_minutes`, `role`, `status` or the display-name columns → schedule, settings; `tenants` update of name, zone and the
   settings columns the bootstrap shows → settings; `profiles` update of the display-name columns → settings of each clinic where the user is
   an active member. `private.today_signal_send` replaced: payload `{domain, version}`; topic and policy unchanged. The executor lists every
   column of these tables from `types/database.ts` and marks each listed or not (notes).
   (d) `visits.row_version` and `invoices.row_version` (`bigint NOT NULL DEFAULT 0`), raised by 1 in a `BEFORE UPDATE` trigger only when a
   listed column changes (visits: `status`, `scheduled_at`, `doctor_id`, `estimated_duration_minutes`, `is_overbooked`, `origin_type`,
   `patient_id`, `signed_at`; invoices: `status`, `total_amount`, the discount, tax and paid-total columns). Used by 09E-07.
   (e) `public.clinic_live_state(p_tenant_id uuid) RETURNS jsonb` (STABLE INVOKER; active member; NULL otherwise): `{versions: {schedule, queue,
   billing, settings}, access}` from one statement.
   Split point.
3. Client (`lib/live`, R-18). `live-core.ts` is pure with injected dependencies (the `createTodayLive` pattern, fake clock): one channel per
   clinic opened by the shell while the tab is visible (closed 60 s after it is hidden; the Supabase client chunk still loads after first
   paint); `seen` per domain; heartbeat every 12 s while a live screen is registered and visible, also while SUBSCRIBED; an immediate check
   on SUBSCRIBED (first join and every rejoin), tab visible, `online` and resume; a version above a query's basis from any source re-reads
   the active dependents (coalesced 400 ms) and removes the inactive ones; access ≠ `full` → the D-8 path. `GET /api/live/state` (one call,
   any active member, `private, no-store`, `Server-Timing`). `use-live-screen.ts` registers a live screen and its domains;
   `use-changed-elsewhere.ts` gives the other screens their flag (placed in 09E-06). Today drops its 20 s full-board poll (the heartbeat
   replaces it: a version read every 12 s, a board read only when a version moved). RUM `live_reread`, `live_dropped`, `live_reconnect`.
4. Badge (`live-badge.tsx`; in Today's head now, in Schedule's in 09E-12): "Live" while SUBSCRIBED and a signal or check confirmed the
   versions within 24 s; otherwise "Reconnecting" with "Updated N s ago" (time since the last confirmed read, ticking every 5 s); a dot and
   words, never colour alone; not a live region (the board's polite region announces changes, as today).
5. Specs (below).

Tests: pgTAP `clinic_versions.test.sql`: grants and RLS (a member reads only their clinic; nobody writes); one transaction inserting 20 visits
for clinic A and 3 for clinic B raises each clinic's `schedule` and `queue` by exactly 1 and writes exactly one `realtime.messages` row per
clinic and domain, with payload keys `domain` and `version` only; two transactions raise by 2; a rolled-back transaction leaves versions and
messages unchanged; every table and event maps to its domains as listed and an unlisted column moves nothing; a send failure does not roll
back the write; `row_version` moves only on listed columns; `clinic_live_state` is NULL for another clinic and for a non-member.
Fails-without (High: a bulk change exhausting the Realtime quota): the 20-visit case against the old row-level trigger (restored inside a
scratch transaction) writes 20 messages; recorded. Vitest `tests/live/live-core.spec.ts` (fake clock): heartbeat every 12 s while visible
and registered, also while SUBSCRIBED; none while hidden or with no live screen; a check on SUBSCRIBED, rejoin, visible, online and resume; a
newer version re-reads once (coalesced), an equal or older one does nothing; inactive dependents removed; the basis rule never misses a
version; badge transitions. Vitest realtime `today-signals.spec.ts`: payload keys of every domain; a 50-row insert in one transaction delivers
one signal; a member of another clinic receives nothing; the 09C quota wait kept. e2e `tests/e2e/live/convergence.spec.ts` (desktop-chrome,
pixel-7, iphone-15; 0 retries): **delivered:** B checks in, A shows it within 2 s with one board read (B-11). **Dropped:** `page.routeWebSocket`
drops the broadcast frames to A (the channel stays joined, the badge says "Live"), the page clock is installed before load, B checks in; A is
unchanged until its clock passes 12 s, then shows the row after one state read and one board read (B-12). Fails-without (High: silent
staleness): with the heartbeat's interval removed, the row never appears within 60 s of clock time; recorded, restored. **Refused socket:**
the badge says "Reconnecting · Updated N s ago", the heartbeat keeps A current, on reconnect the badge returns to "Live" and one check runs.
**Hidden tab:** no state call while the clock advances 60 s (B-13). Axe clean for the badge's states at 360, 820 and 1280.
Done: B-11 to B-13 enforced; one signal per clinic, domain and transaction proven; the full PR lane green once.

### 09E-05 The consult in one read; the doctor's lists in its query · M-L · migration 000124_consult_screen

Goal: R-8, R-9 for the consult. One database call on the consult's critical path; the doctor's own lists arrive with it, live in the
consult's query, and no sheet or keystroke reads them again.

Files: `supabase/migrations/000124_consult_screen.sql`; new `supabase/tests/database/consult_screen.test.sql`; new `features/consultation/screen.ts`
(zod view model from the read; the record-state rules stay in TypeScript, `recordState`); `app/(dashboard)/consultation/[id]/page.tsx` (one
call, `HydrationBoundary`); `components/consultation/workspace/{consult-workspace.tsx,rx-templates-sheet.tsx}` and the sections that take
favourites, usual doses and macros (they read the consult's query); `lib/query/keys.ts` (`keys.consult(tenantId, visitId)`); new
`tests/consultation/consult-screen-parity.spec.ts`; `scripts/perf/command-latency.ts`; `tests/e2e/perf/latency-budgets.ts`; the fixture fallout;
registries.

1. Tracer. `consult_screen` returning only the visit with its patient and notes, the diagnoses and the Rx lines; the page renders a draft
   consult from it; row `nav.consult.draft` measured. Acceptance: one Supabase call in the window for those parts, the Rx entry row visible,
   the old path still in place for the rest.
2. Migration 000124: `public.consult_screen(p_tenant_id uuid, p_visit_id uuid) RETURNS jsonb`, STABLE INVOKER, `consultations:view` (NULL when
   the visit is not readable; the page then answers 404 as today). Keys and their gates, exactly as the page gates them today: `visit`,
   `patient`, `notes` (with `draft_version`), `token_number`, `follow_up`, `diagnoses`, `prescription` (`items`, `latest_version`),
   `amendment` (reason and opened at, from the latest revision), `history` (the shape `getPatientConsultationHistory` returns, the current visit
   excluded), `entitlements` (the `assist.*` map from `public.my_entitlements`), `assist_context` (`public.consult_assist_context`, when
   `consultations:edit` and `assist.terminology` or `assist.frequent_rx`), `snapshot` (`public.patient_snapshot`, when `assist.snapshot`),
   `macros` (the caller's, when `consultations:edit` and `assist.shorthand`), `upcoming` (when `assist.followup`), `documents` (when
   `labs:view`), `allergy_context` (`public.rx_allergy_context`), `my_lists` (`custom_medicines`, `custom_diagnoses`, `templates`: the caller's
   own rows only, `doctor_id = auth.uid()`, capped per R-8; when `prescriptions:edit` or `consultations:edit`). The print payload of a sealed
   record stays a separate read, streamed under `Suspense` (R-9). Header comment: "a new INVOKER read composed of existing reads; no table,
   policy or grant change beyond EXECUTE".
3. Page and query. The page makes one call, maps it through `screen.ts`, applies `recordState` (macros, upcoming and assist only for an
   editable record) and hydrates the consult's query; favourites, usual doses, macros and the Templates sheet read it; saving a template or a
   macro updates it with `setQueryData` from the action's result; nothing re-reads them. The 14 sequential reads are deleted from the page
   (their services stay where other callers use them). The consult renders `DataReady` (RUM).
4. Specs (below).

Tests: `consult-screen-parity.spec.ts` (run before the old path is deleted): for a draft, an amending, a sealed, an unsigned completed and a
cancelled visit, and for owner, the visit's doctor, another doctor, nurse and receptionist, the view model from `consult_screen` deep-equals
the one built from the old reads; the committed spec then compares against stored expectations. pgTAP `consult_screen.test.sql`: grants;
another clinic's visit and a forged tenant return NULL; the role × part matrix (nurse no `my_lists`, receptionist NULL, labs part only with
`labs:view`); another doctor's custom medicines, diagnoses, templates and macros never returned (fails-without, High: with the
`doctor_id = auth.uid()` filter removed they appear; recorded, restored); entitlement off → part absent. e2e: opening Templates makes 0
Supabase calls (Kong window); the existing consult specs pass unchanged in intent. Rows `nav.consult.draft`, `nav.consult.sealed`,
`full.consult` lowered to their measured calls, depth 1 (full load 2); `command-latency.ts` `consult_screen` p95 < 50 ms.
Run: Vitest `tests/consultation tests/prescriptions tests/terminology`; pgTAP `consult_screen` and the 09B and 09C read files; e2e
`tests/e2e/consult`.
Done: B-1 and B-3 rows of the consult enforced at their targets; parity green before the old path is deleted.

### 09E-06 Today and the other main screens in one round trip; skeletons; the changed-elsewhere notice · M-L · migration 000125_today_board · split point after step 3

Goal: R-9, R-12. Today reads its board in one SQL call that also returns the versions it reflects; Patients, a patient, Visits, Billing
reports, Settings and Staff each spend one round trip; every main route shows a layout-matching skeleton; a screen with no live domain says
when what it shows changed elsewhere.

Files: `supabase/migrations/000125_today_board.sql`; new `supabase/tests/database/today_board.test.sql`; `features/today/queries.ts`
(`getTodayBoard` becomes the read, after parity); `app/api/today/board/route.ts`; `app/(dashboard)/{today,patients/(list),patients/[id],visits,
billing/reports,settings/clinic,settings/billing,settings/developer,staff,profile,referrals}/page.tsx` and their `loading.tsx`; new
`components/shell/skeletons/{today-skeleton,list-skeleton,patient-skeleton,schedule-skeleton,settings-skeleton}.tsx`; new
`components/shell/changed-elsewhere.tsx`; `features/patients/service.ts` (`after()` for the view audit); the Patients list's row links (no
patient read when the list renders); `components/schedule/day-grid.tsx` (`prefetch` per R-9); `tests/e2e/shell/{request-budget,loading-states}.spec.ts`
(with `support/slow-navigation.ts`); `tests/e2e/today/today-live.spec.ts`; new `tests/today/today-board-parity.spec.ts`; new
`tests/e2e/shell/changed-elsewhere.spec.ts`; `scripts/perf/command-latency.ts`; `tests/e2e/perf/latency-budgets.ts`.

1. Tracer. `public.today_board(p_tenant_id uuid, p_mode text, p_doctor_id uuid DEFAULT NULL) RETURNS jsonb` (STABLE INVOKER,
   `appointments:view`; NULL otherwise) returns the board model `getTodayBoard` builds today (the clinic-local day's visits with the fields the
   rows show, tokens, invoice and payment state, vitals flags, and each visit's and invoice's `row_version`) and `versions` (schedule, queue,
   billing) from one statement; the page and the board route use it (one call); the layout-matching Today skeleton. Rows `nav.today` and
   `live.today.refresh` lowered to 1 call and depth 1. Parity first (below).
2. The other pages, one by one: independent reads in one `Promise.all`; dependent or slow parts streamed (a patient's history and documents;
   billing report aggregates; staff invitations); each a skeleton matching its layout (DESIGN §6.9: static `sunken` blocks, the page title
   real at once); `/billing/register` is a redirect and needs none. Each renders `DataReady`.
3. `patient.view` moves to `after()` (still written once per opening; failures logged by tag); the Patients list's links make no patient read
   when the list renders (09D found one per row in view).
   Split point.
4. Changed-elsewhere notice (R-9, R-18): a patient (schedule, billing), Visits (schedule, queue), Billing reports (billing), Settings and Staff
   (settings) show "Changed on another device · Refresh" as an inline `Banner` (not a toast); Refresh is a `router.refresh()`; nothing
   re-renders by itself.
5. Specs (below).

Tests: `today-board-parity.spec.ts`: front-desk and doctor mode; owner, doctor, receptionist and nurse; a day with booked, waiting, in
consultation, completed and billed, cancelled and no-show visits: the view model from `today_board` deep-equals the one from the old service
(before the old path is deleted; then stored expectations). pgTAP `today_board.test.sql`: grants; another clinic and a forged tenant → NULL; a
role without `appointments:view` → NULL; the returned versions equal `clinic_versions` in the same transaction; only the fields the rows show.
Rows B-1 and B-3 for every page of this plan lowered to their measured calls with depth 1 (full load 2); `request-budget.spec.ts` reads them.
`loading-states.spec.ts`: with 300 ms injected, each page's skeleton is visible while its calls are pending (B-2, functional), at 360, 820 and
1280, axe clean. `today-live.spec.ts`: a check-in in B shows in A within 2 s with exactly one Supabase call per refresh. A patient opening
writes one `patient.view` row; rendering, hovering and focusing its link write none. `changed-elsewhere.spec.ts`: a booking for the open
patient made in B shows the notice in A, with no re-render and no new `patient.view` row until Refresh. `command-latency.ts` `today_board`
p95 < 50 ms.
Run: Vitest `tests/today tests/patients tests/auth`; pgTAP `today_board`; e2e `tests/e2e/today tests/e2e/shell
tests/e2e/journeys/journey-03-register-patient.spec.ts`, then the full PR lane once.
Done: every B-1 to B-3 row of this plan enforced at its target; parity green before the old path is deleted; the PR lane green with 0 retries.

### 09E-07 Stale-write refusal for queue and billing commands · M · migration 000126_stale_write_refusal

Goal: R-19. A queue or billing edit made from a screen that is behind the database is refused with "This changed on another device", nothing
is written, and the screen shows the latest.

Files: `supabase/migrations/000126_stale_write_refusal.sql`; new `supabase/tests/database/stale_write_refusal.test.sql`;
`features/queue/{actions,service}.ts`, `features/visits/{scheduling,service}.ts`, `features/billing/{actions,service}.ts` (the input requires
`expectedVersion`); `lib/errors/*` (the `ROW_CHANGED` code and its fixed message); `components/today/use-row-commands.ts`,
`components/front-desk/{booking-sheet,reschedule-sheet,cancel-dialog,no-show-dialog}.tsx` and the payment sheet (they pass the version the
screen shows); `tests/security/guard-manifest.ts` where signatures are pinned; new `tests/e2e/live/stale-write.spec.ts`; affected specs.

1. Tracer. `cancel_visit` with `p_expected_version`: a cancel from a screen that shows version v of a visit since moved to v + 1 is refused
   with `ROW_CHANGED` and writes nothing; the dialog shows the message and the row re-reads.
2. Migration 000126 (R-17: each command dropped and created again with the parameter last, `DEFAULT NULL`, grants and comment restored),
   from their latest bodies: on `visits.row_version`: `check_in_visit`, `start_consultation`, `complete_visit`, `mark_no_show`, `cancel_visit`,
   `reschedule_visit`, `confirm_appointment`, `complete_and_bill`; on `invoices.row_version`: `collect_payment` (`p_expected_invoice_version`,
   compared when the visit already has a live invoice; a version given when there is none is refused too) and `record_payment`. Order inside
   each: actor and permission checks, the request-id replay (a replay answers its stored result whatever the version), the existing row
   lock, then `ROW_CHANGED` (P0001) when the version differs, then the unchanged body. Each result gains the new `row_version`. Not changed:
   `create_invoice` and `enqueue_walk_in` (they create), `promote_waitlist_entry` (its slot check decides; waitlist rows carry no version),
   the invoice-item table writes (V2-10).
3. App: the services require `expectedVersion` (TypeScript input); the screens pass the `row_version` from their query (the Today board now;
   the schedule's booking sheets pass the version of the visit they loaded until 09E-12 gives them the range's); `ROW_CHANGED` shows the
   fixed message and tells the live layer the domain moved (re-read now).
4. Specs (below).

Tests: pgTAP `stale_write_refusal.test.sql`: each command refuses a stale version with no row, audit or outbox change; it accepts the current
version and NULL; a replay with a stale version returns the stored result; the result carries the new `row_version`; grants unchanged
(EXECUTE `authenticated` only); a named call without the new parameter still resolves (the running app during a deploy). Fails-without
(High: lost update): with the check removed from `reschedule_visit`, the stale reschedule moves the visit; recorded, restored. Vitest: the
services send the version (a call without one fails the typecheck, `@ts-expect-error` case); the error mapping. e2e `stale-write.spec.ts`
(desktop-chrome): two contexts on Today; A's broadcast frames dropped and its clock held, so A is behind; B reschedules a visit; A cancels it
→ "This changed on another device", the visit is not cancelled (database checked), and A's row shows the new time after the re-read; the same
for a payment against an invoice to which B added an item.
Run: Vitest `tests/queue tests/visits tests/billing`; pgTAP `stale_write_refusal` and the V2-07/V2-08 command files; e2e `tests/e2e/today
tests/e2e/schedule tests/e2e/live`.
Done: every listed command refuses a stale version; the app always sends one; `app/api/v1` unchanged (it may pass versions later).

### 09E-08 Saves by risk class · M · no migration

Goal: R-11. Reversible saves show their result at once and roll back visibly; booking, payment, allergies and sign-and-finish show a pending
state until the database confirms; every save is one call, applied from its result, with no page re-render.

Files: new `lib/query/mutations.ts` (`useReversibleCommand` and `useConfirmedCommand` on `useMutation`, using the existing command helper's
request id and retry); `components/consultation/workspace/{use-rx-lines.ts,consult-workspace.tsx}`,
`components/consultation/workspace/sections/diagnosis-section.tsx`, `features/prescriptions/allergy.ts` (used, not changed),
`features/terminology/actions.ts`, `features/queue/actions.ts`, `features/visits/{actions.ts,scheduling.ts}`, `features/billing/actions.ts`,
`features/consultation/actions.ts`, `features/settings/actions.ts`, `components/today/{use-row-commands.ts,today-row.tsx}`,
`components/front-desk/*-sheet.tsx`, `components/clinical/allergy-editor.tsx`; `tests/e2e/perf/latency-budgets.ts`; affected specs.

1. Tracer. An Rx line added by keyboard shows at once with a pending marker; one `changePrescriptionAction`; the line is built from what was
   sent plus the returned id (the catalogue name, generic and form for a CDCI line, as 000120 stores them); allergy matches recomputed with the
   TypeScript twin from the consult's allergy context (no `getRxAllergyContextAction`; the context is re-read only after the allergy editor
   saves); the custom medicine updated in the consult's query as 09C R-2 does in SQL. Row `save.rx_add`: 1 call, depth 1, no RSC request; the
   line visible while the call is held (B-6).
2. Reversible class (R-11): Rx edit and remove; diagnosis add, remove and note (no `revalidatePath`; custom diagnoses updated in the query);
   draft autosave (re-renders nothing); vitals; Today's queue moves (check in, start consult, complete): the row changes lane at once and comes
   back, with the fixed error and Retry, on a refusal (including `ROW_CHANGED`).
3. Confirm class (R-11): register and book, book, reschedule, promote, walk-in, cancel, no-show, collect payment, record payment, complete and
   bill, allergies, settings saves: a pending state only; the command's result applied to the Today and schedule queries with `setQueryData`;
   success text only after the response.
4. Sign and finish: measured; anything beyond two calls on its path moves after the response or is reported in the notes with its cost.
   `revalidatePath` removed from every hot save (listed in the notes by action name); Check in no longer renders twice (09D).
5. Specs (below).

Tests: per save: its lane row (B-6 for reversible saves, B-7, B-8) enforced; no RSC page request caused by the action; a lost response
(`tests/e2e/support/commit-then-abort.ts`) is retried with the same id and stores one row; a refused or aborted reversible save rolls back
visibly with the fixed error and Retry; for each confirm-class save, the action's POST is held with `page.route` and the test asserts no
success text and no moved row until it is released (functional, blocking; fails-without, High: an optimistic success added to booking makes it
red; recorded, restored); after a reload the database holds exactly what the screen showed. `tests/e2e/consult/rx-allergy.spec.ts` keeps
passing with no context re-read: a line that matches an allergy is still flagged before it is added. RUM `save_reversible`, `save_confirmed`,
`finish_confirmed` recorded.
Run: Vitest `tests/prescriptions tests/terminology tests/queue tests/visits tests/billing`; e2e `tests/e2e/consult tests/e2e/today
tests/e2e/schedule tests/e2e/journeys/journey-04-book-appointment.spec.ts tests/e2e/journeys/journey-05-walk-in.spec.ts`, then the full PR
lane once.
Done: every B-6 to B-8 row enforced; each save in its class as listed; no `revalidatePath` left on a hot save.

### 09E-09 Reference catalogues on the device: versions, shards and substances (tracer) · M-L · migration 000128_reference_catalogues

Goal: R-5, R-6 end to end on the smallest catalogue; the allergy editor answers from the device. (C-2 answered yes on 2026-11-23.)

Files: `supabase/migrations/000128_reference_catalogues.sql`; new `supabase/tests/database/reference_catalogues.test.sql`; new
`features/reference/{catalogues.ts,service.ts}`; new `app/api/reference/manifest/route.ts`, `app/api/reference/[catalogue]/[version]/[shard]/route.ts`;
new `lib/reference/{idb.ts,sync.ts,store.ts,search-substances.ts}`; `components/clinical/allergy-editor.tsx`;
`tests/e2e/pwa/{05-cache-audit.spec.ts,fixtures.ts}` and `tests/e2e/support/storage-dump.ts` (the allowed database); new
`scripts/perf/reference-size.ts`; new `tests/reference/substance-search-parity.spec.ts`; new
`tests/e2e/reference/{reference-routes,substances-local}.spec.ts`; `tests/terminology/*` and `tests/prescriptions/medicine-search-route.spec.ts`
where the tie-break changes an order; `scripts/perf/command-latency.ts`; registries.

1. Tracer: the allergy editor's search served from IndexedDB: migration, shard read, both routes, sync, store, twin, editor; one e2e that types
   a substance with 300 ms injected and gets the expected first option with 0 Supabase calls while typing.
2. Migration 000128. (a) `public.reference_catalogues` (`catalogue text PRIMARY KEY CHECK (catalogue IN ('cdci', 'diagnoses'))`, `version uuid
   NOT NULL`, `changed_at timestamptz NOT NULL`), RLS on, SELECT for `authenticated`, no write grant, both rows seeded. (b)
   `private.reference_catalogue_bump()` (definer, no API grant) and statement-level `AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE` triggers on
   `cdci_substances`, `cdci_generics`, `cdci_brands`, `cdci_medicines_search` (catalogue `cdci`) and `opd_diagnoses` (`diagnoses`): a new random
   version and `now()`. (c) `public.reference_shard(p_tenant_id uuid, p_catalogue text, p_shard integer) RETURNS jsonb` (STABLE INVOKER;
   `substances` and `diagnoses` need `consultations:view`, `medicines` needs `prescriptions:edit`; NULL otherwise): `{catalogue, version, shard,
   shards, rows}`; rows as arrays (substances `[id, name]`; diagnoses `[id, name, icd11, snomed, chronic, specialties, synonyms]`; medicine shard
   0 = generics `[id, name, substance_ids]`, shards 1..n = brands `[id, brand_name, generic_row, dose_form]` by id, 12,000 per shard). (d)
   `search_substances`, `search_diagnoses` and `search_medicines` replaced from their latest bodies with the name tie-break `COLLATE "C"` only
   (R-6).
3. Server: `catalogues.ts` (names, permissions, shard sizes, the version uuid check); `service.ts` (`getReferenceVersions`, `getReferenceShard`:
   one call each, no server cache, R-5); the two routes with the 09C route conventions, 409 for a version that is not current, 404 for a shard
   out of range, `Server-Timing`.
4. Device: `idb.ts` (open, put, get all, delete by version, delete database; request and transaction promises; quota and unavailability errors
   mapped to "memory only"); `sync.ts` (R-5 order; never blocks first paint; one sync at a time per tab); `store.ts`
   (`useReferenceCatalogue(name)` → `{ status, search }`; registers with `lib/pwa/cleanup.ts`); `search-substances.ts` (twin of
   `search_substances`). The editor uses the store when ready, else `fetchSubstances`; no debounce on the device path (C-3; one search per
   animation frame); RUM `search_device`. The purge is unchanged (it deletes the database at sign-out). The cache audit (A-4) allows exactly
   `cliniq-reference` with stores `meta` and `rows`, every record a catalogue row of a known shape, during a session; after sign-out nothing.
5. Size: `reference-size.ts` reads the real files in `supabase/seed-data` (no database, no network), builds the shard rows with the same
   serializer and writes `evidence/reference-size.json` (rows, raw, gzip and brotli bytes per shard).
6. Specs (below).

Tests: `substance-search-parity.spec.ts`: at least 25 cases (exact, prefix, word prefix, inside, case and spaces, `%`, `_`, `\`, non-ASCII,
ties, the limit) on synthetic `test-ref-sub-*` rows, the twin against `public.search_substances` through a JWT client: same ids in the same
order. pgTAP: the table and its grants; each trigger bumps its catalogue's version on insert, update, delete and truncate and leaves the other's
alone; `reference_shard` grants, NULL without the permission and for another clinic, the shard shapes; the three tie-breaks.
`reference-routes.spec.ts`: status codes, exact keys, cache headers, a stale version 409, a version bump (a fixture write) changes the manifest
at once. `substances-local.spec.ts` (three projects): typing answers from the device with 0 calls (Kong); offline
(`context.setOffline(true)`) still answers; with IndexedDB unavailable (an init script that throws on `indexedDB.open`) the editor falls back
to the route and still works; the stored records are catalogue rows only; sign-out leaves no database. Fails-without (High: only catalogue
rows on the device): the cache audit with a record of an unknown shape added to `cliniq-reference` fails; recorded. Row `typeahead.substance`
enforced (B-4: 0 calls); `command-latency.ts` `reference_shard` (substances) p95.
Run: Vitest `tests/reference tests/terminology tests/prescriptions/medicine-search-route.spec.ts`; full pgTAP; e2e `tests/e2e/reference
tests/e2e/pwa`.
Done: B-4 for substances on three projects; the cache audit green with the allowed database; the parity table green.

### 09E-10 Diagnoses on the device · M · no migration

Goal: R-6 for diagnoses. The consult's diagnosis search answers from the device, with the doctor's custom diagnoses first and the abbreviation
expansion when entitled.

Files: new `lib/reference/{trigram.ts,search-diagnoses.ts}`; `lib/reference/store.ts`;
`components/consultation/workspace/sections/diagnosis-section.tsx`; `features/terminology/abbreviations.ts` (imported by the twin, not
changed); new `tests/reference/{trigram-parity,diagnosis-search-parity}.spec.ts`; new `tests/e2e/reference/diagnoses-local.spec.ts`;
`tests/e2e/perf/latency-budgets.ts`.

1. Tracer: one prefix query answered locally inside the consult, the custom diagnoses from the consult's query (R-8) first; row measured.
2. `trigram.ts` (R-6) and its table: at least 40 pairs against SQL `similarity()` (short words, digits, punctuation, repeated words, one-letter
   words, non-ASCII, empty).
3. `search-diagnoses.ts`, the twin of `search_diagnoses` (000114:38 with the 000128 tie-break): terms from `expandQuery` when the consult's
   `assist.terminology` is on (the entitlement the route reads), at most 8 terms of 2 to 100 characters, the specialty filter, custom first by
   `use_count`, then ranks 1 to 6, the same-name merge, the limit 12.
4. The section uses the store when ready, else the route (`fetchDiagnosisHits`); no debounce on the device path (one search per animation
   frame); the learned order from the assist context applied as today; RUM `search_device`.
5. Specs (below).

Tests: `diagnosis-search-parity.spec.ts`: at least 30 cases (abbreviations on and off, synonyms, specialty, custom and catalogue with the same
name, another doctor's custom never present, trigram-only matches, ties, limit) against `public.search_diagnoses` through a JWT client.
`diagnoses-local.spec.ts` (three projects): answers with 0 calls; offline answers; the fallback works. Row `typeahead.diagnosis` enforced.
Run: Vitest `tests/reference tests/terminology`; e2e `tests/e2e/reference` and the consult specs that search a diagnosis
(`tests/e2e/consult/smart-assist.spec.ts`, then the affected-test grep).
Done: B-4 for diagnoses; both parity tables green.

### 09E-11 Medicines on the device · L · no migration · split point after step 3

Goal: R-7. The Rx field answers from the device for the whole CDCI catalogue within B-4 and B-14, the doctor's custom medicines first, the
trigram tail from the server.

Files: new `lib/reference/{medicine-index.ts,search-medicines.ts,worker.ts}`; `lib/reference/{sync.ts,store.ts}`;
`components/consultation/workspace/sections/prescription-section.tsx` (the RxEntryRow `search` prop); new `tests/e2e/support/perf-catalogue.ts`
(93,911 synthetic brands, 10,305 generics, 3,283 substances and 1,550 diagnoses with name lengths drawn from the measured distributions, ids
`perf-*`, upserted in the lane's setup and deleted in its teardown); new `tests/reference/medicine-search-parity.spec.ts`; new
`tests/e2e/reference/medicines-local.spec.ts`; `scripts/perf/reference-size.ts`; `tests/e2e/perf/latency-budgets.ts`.

1. Tracer: one brand shard (12,000 synthetic rows) loaded into the worker and searched from the Rx field; the custom list merged; row measured.
2. `medicine-index.ts` (pure: build the columnar index from shards; `search(query, customList, limit)` → ranks 1 to 4 plus custom, and whether
   the tail is needed); `worker.ts` (`new Worker(new URL("./worker.ts", import.meta.url))`, built by Next; messages `load` and `search`; a request
   id per keystroke, stale answers dropped); a main-thread fallback with the build chunked in idle callbacks if the worker cannot start
   (recorded).
3. Sync of the generics shard and the brand shards in the background, after first paint; the index built once per version.
   Split point.
4. `search-medicines.ts`: the route asked once when the local ranks give fewer rows than the limit; its answer replaces the list; custom
   medicines carry their stored dose; CDCI rows none; `substance_ids` from the generic for the allergy pre-check (09C R-7).
5. Measurements into the notes from tool output: `reference-size.json` for the real files and the synthetic set; the lane's B-14 rows
   (transferred bytes from the response sizes, blocking; IndexedDB bytes from `navigator.storage.estimate()`, build time and worker heap
   through CDP, reported). If the transferred bytes fail, R-7's fallback applies and the PO is told.
6. Specs (below).

Tests: `medicine-search-parity.spec.ts`: at least 30 cases (brand prefix, word, generic prefix and word, inside, `%`, `_`, `\`, non-ASCII,
custom first by `use_count`, a custom name equal to a brand, another doctor's custom never present, ties, limit; a query whose local ranks fill
the limit: the local list equals the SQL list; a query that needs the tail: the local rows equal the SQL rows of ranks 1 to 4 and the final
list equals SQL) against `public.search_medicines`. `medicines-local.spec.ts` (three projects): 0 calls when the limit is filled locally and
exactly 1 when the tail is needed; offline shows the local ranks; the 09C keyboard and allergy specs keep passing. Rows `typeahead.medicine`
(B-4) and B-14 enforced; B-15 from `npm run ci:route-js` in the notes.
Run: Vitest `tests/reference tests/prescriptions`; e2e `tests/e2e/reference tests/e2e/consult/rx-*`, then the full PR lane once.
Done: B-4 and B-14 met for medicines on the full-size synthetic catalogue, or R-7's fallback recorded and the PO told.

### 09E-12 Schedule data layer: one range read with SQL slots, prefetch, live · L · migration 000129_schedule_range · split point after step 3

Goal: R-10. The schedule's day and week views read a range query; free slots come from SQL; adjacent ranges are ready; changes made elsewhere
appear within 2 s, or within the heartbeat bound if the signal is dropped.

Files: `supabase/migrations/000129_schedule_range.sql`; new `supabase/tests/database/schedule_range.test.sql`; `features/schedule/{queries.ts,schema.ts}`;
new `app/api/schedule/range/route.ts`; `lib/query/keys.ts` (`keys.scheduleRange(tenantId, from, to, withSlots)`); `app/(dashboard)/schedule/page.tsx`;
`components/schedule/{schedule-view.tsx,day-grid.tsx,week-overview.tsx,schedule-head.tsx,agenda.tsx}`;
`components/front-desk/{slot-section.tsx,slot-adapter.ts,booking-sheet.tsx,reschedule-sheet.tsx}`; new `tests/e2e/schedule/schedule-live.spec.ts`;
`tests/e2e/shell/query-clear.spec.ts`; `scripts/perf/command-latency.ts`; `tests/e2e/perf/latency-budgets.ts`; registries.

1. Tracer: the day view from `schedule_range` (one call) with its slots for one doctor; row `nav.schedule.day` lowered to 1 call, depth 1.
2. Migration 000129: `public.schedule_range(p_tenant_id uuid, p_from date, p_to date, p_include_slots boolean DEFAULT true) RETURNS jsonb`
   (STABLE INVOKER, `appointments:view`; NULL when the range is reversed or longer than 42 days): `zone`, `server_now`, `clinicians` (owners and
   doctors with `consultations:edit`, active: id, display name as `private.doctor_display_name` builds it, slot minutes floored at 5,
   `private.effective_schedule`), `blocks`, `visits` (the fields the cards and booking sheets use today, plus `row_version`; nothing more),
   `slots` (per clinician and clinic-local date, start minutes from local midnight, from `private.available_slots_core`; absent when
   `p_include_slots` is false), and `versions` (schedule, queue) from the same statement.
3. Client (R-10): one query per range; the page hydrates the first; changing the day or week updates the URL with `history.pushState` and reads
   the query; the adjacent range prefetched after the visible one settles; the schedule registers as a live screen (schedule, queue) and shows
   the badge in its head; past slots hidden by the device clock offset to `server_now` (display only). The booking and reschedule sheets take
   clinicians, slots and `row_version` from the range query when it holds the date, else `getAvailableSlots` (SQL); slot assist (AI-13) stays a
   server action.
   Split point.
4. The 09D per-pair `available_slots` batching no longer runs on the schedule's path; the schedule renders `DataReady`.
5. Specs (below).

Tests: pgTAP `schedule_range.test.sql`: grants; another clinic → NULL (fails-without, High: with the tenant check removed another clinic's
visits come back; recorded, restored); the 42-day limit; the fields; the versions; **slots equal `public.available_slots` for each (doctor,
date) of a 25-case table** (default schedule, a disabled day, two shifts, a clinic-wide block, a doctor block, overbooked, cancelled, no-show,
slot length 5 and 45, a date whose UTC day differs from the clinic day, a zone with daylight saving): one rule, asserted; `p_include_slots
false` → no `slots` key. e2e `schedule-live.spec.ts`: a booking in B appears in A's day view within 2 s and its slot disappears (B-11); with
A's broadcast frames dropped it appears once A's clock passes 12 s; the next day and the next week show with 0 calls (B-9); a date 3 weeks away
1 call (B-10); a 42-day range in one call; a slot A shows that B has just booked is refused by the command with the existing message;
`query-clear.spec.ts` extended: sign-out and clinic switch leave no range. Rows B-1 (Schedule day and week), B-9, B-10 enforced;
`command-latency.ts` `schedule_range` p95 < 100 ms.
Run: Vitest `tests/schedule tests/realtime tests/visits`; full pgTAP; e2e `tests/e2e/schedule tests/e2e/today
tests/e2e/journeys/journey-04-book-appointment.spec.ts`, then the full PR lane once.
Done: B-1, B-9, B-10, B-11 met for the schedule; slots from SQL only; the range read serves 42 days.

### 09E-13 Session bootstrap · S-M · migration 000130_session_bootstrap

Goal: R-13. Profile, clinic name and zone, display role, doctor directory names and Rx print display settings load once and stay in memory for
the session; screens stop reading them per request; everything critical is still read fresh.

Files: `supabase/migrations/000130_session_bootstrap.sql`; new `supabase/tests/database/session_bootstrap.test.sql`; new
`features/session/bootstrap.ts` (zod strict view model: the allow-list of fields); new `app/api/session/bootstrap/route.ts`;
`app/(dashboard)/layout.tsx` (on a full load the bootstrap read runs beside the layout's existing read, depth unchanged, and hydrates
`keys.bootstrap(tenantId)`); `lib/query/keys.ts`; new `lib/session/use-bootstrap.ts`; consumers: the shell (clinic name, user menu),
`components/front-desk/use-doctors.ts` (doctor pickers from the bootstrap instead of `getActiveClinicDoctors`), the client's date formatting
zone, the Rx preview's display settings; `features/staff/actions.ts` (the directory read leaves the screens' paths); new
`tests/e2e/shell/bootstrap.spec.ts`; `tests/e2e/shell/query-clear.spec.ts`.

1. Tracer: `session_bootstrap` with the clinic name and zone; the shell reads it; a settings signal from another device refreshes it.
2. Migration 000130: `public.session_bootstrap(p_tenant_id uuid) RETURNS jsonb` (STABLE INVOKER; active member; NULL otherwise): `profile`
   (own user id, display name), `clinic` (id, name, zone, `Asia/Kolkata` when unset), `role` (display only), `doctors` (ids and display names
   of the active owners and doctors with `consultations:edit`), `rx_print` (the display fields of the print settings), `versions.settings` from
   the same statement. No fee, price, invoice, payment, subscription, access, entitlement or permission field.
3. Client: a query with `staleTime: Infinity` in the `settings` domain, re-read on a newer settings version (R-18), on resume and on
   reconnect; a settings save on this device applies its result at once; cleared with the rest (R-14). Consumers switched; the per-screen
   reads it replaces are removed (listed in the notes with Kong counts before and after).
4. Specs (below).

Tests: pgTAP `session_bootstrap.test.sql`: grants; another clinic and a non-member → NULL; the exact key set (fails if any key outside the
allow-list appears); `versions.settings` equals `clinic_versions`. Vitest: the zod strict schema refuses an extra key. e2e `bootstrap.spec.ts`
(two contexts): A renames a doctor and the clinic; B shows both within 2 s on the signal, within the heartbeat bound on Today with B's frames
dropped, and after a resume; fees changed in A are used by B's next bill with no refresh in between (fails-without, High: stale fees; with
fees put into the bootstrap B bills the old fee; recorded, restored); A changes B's role: B's next command is refused by the database at once
whatever the bootstrap says, and B's navigation follows on the settings signal; `query-clear.spec.ts`: sign-out and clinic switch leave no
bootstrap; two clinics never share an entry.
Run: Vitest `tests/session tests/settings tests/staff`; pgTAP `session_bootstrap`; e2e `tests/e2e/shell tests/e2e/settings tests/e2e/today`.
Done: no doctor-directory or settings read on an in-app navigation (Kong); fees, roles and access proven fresh.

### Close (reviews, fix round, evidence, docs)

1. Reviews, fresh context, given the phase diff and this plan's rulings only. Isolated reviewer (Sonnet): the lane (calibration, depth,
   held background requests, no row measured on a stale server), every budget row and its proof, the observability path, the query layer and
   its clearing, the convergence rules (basis, heartbeat, removal of inactive queries, badge), the parity tables (enough cases, real SQL on the
   other side), skeletons at 360, 820 and 1280, the risk classes, tests that assert outcomes. Adversarial reviewer (Opus): `ops_ingest_rum`
   and the RUM route (anything identifying, flooding), `clinic_versions` and the triggers (a writer that bumps nothing, payloads, the topic
   policy, a Realtime fault rolling back a write, lock contention), `consult_screen`, `today_board`, `schedule_range` and `session_bootstrap`
   (another clinic, roles, fields beyond the screens, another doctor's lists, range abuse), the stale-write commands (replay order, NULL
   version, old-shape calls), `reference_shard` and its routes, what each device store holds and when it is dropped (IndexedDB, HTTP cache,
   query cache; sign-out, clinic switch, lock, another user on the same device), proof that the never-held list is never held, the latency
   preload's confinement, the `after()` audit. One fix round (09E-14a): Highs and Mediums fixed with a test that fails without the fix (Opus
   for security fixes, Sonnet otherwise); Lows cheap and local or to the backlog with an owner; Highs re-checked once.
2. Evidence (R-16): `npm run stack:recycle`; `node scripts/phase-evidence.mjs .planning/phases/09E-caching-speed/evidence 1`; push once (per
   PR if Q-5 says two); CI green with 0 retried tests (the budget step included); then `--ci-run <id>`; copy the final `perf-latency` (300 ms),
   `perf-roundtrips`, `reference-size.json`, `db-top-queries` and `command-latency.json`; a before/after table of calls, depth and medians
   generated by a script from the baseline and final JSON (never typed).
3. Docs (Haiku): `09E-SUMMARY.md`, `09E-VERIFICATION.md` (numbers copied from the tool files), `.planning/ROADMAP.md`, the master roadmap
   status line (V2-09d and V2-09e inserted by the PO on 2026-11-23, before V2-10), the doc amendments below (the PO's decisions; applied here,
   confirmed by the PO at the gate), the VERIFICATION_LOG entry with the CI link and SHA, and PO-ACTIONS `09E-P1` to `09E-P5`.
4. Gate: the PO approves (or by delegation if renewed, with the CI run recorded).

## Traceability (decision → plan → proof)

| Source | Plans | Proof |
|---|---|---|
| Decision 1: no server cache; session bootstrap; live data never held; zone per clinic, default `Asia/Kolkata` | 09E-13 (R-13); 09E-09 (no server cache of reference data) | `session_bootstrap` pgTAP key allow-list; `bootstrap.spec.ts` (signal, heartbeat, resume; fees fresh with its fails-without; role refused by the database); 0 hits for `unstable_cache`, `"use cache"`, `revalidateTag` at the close |
| Decision 2: convergence by versions; heartbeat while subscribed; checks on rejoin, visible, online, wake; badge; dropped signal recovered within the bound | 09E-04 (R-18), then every live screen (09E-06, 09E-12, 09E-13) | `clinic_versions` pgTAP; `live-core.spec.ts`; `convergence.spec.ts` (delivered B-11, dropped B-12 with its fails-without, refused socket, hidden tab B-13) |
| Decision 3: one signal per clinic, domain and transaction | 09E-04 | pgTAP 20-row transaction → one message per clinic and domain (fails-without against the row trigger); `today-signals.spec.ts` 50-row case |
| Decision 4: TanStack Query, memory only, cleared at sign-out and clinic switch | 09E-03 (R-14), used by 04 to 13 | `query-clear.spec.ts` (fails-without), `keys`/`cleanup` specs, lint ban on persisters, cache audit |
| Decision 5: optimistic by risk class | 09E-08 (R-11) | per-save rows B-6 to B-8; held-POST cases for the confirm class (fails-without); rollback cases |
| Decision 6: stale-write refusal | 09E-04 (row versions), 09E-07 (R-19) | `stale_write_refusal` pgTAP (fails-without on reschedule); `stale-write.spec.ts` |
| Decision 7: slots only in SQL | 09E-12 (R-10) | `schedule_range` slots equal `available_slots` (25 cases); no slot rule in TypeScript (reviewer check) |
| Decision 8: calls and depth block; ms report-only | 09E-01 (R-2 to R-4) | the CI budget step; `depth.spec.ts`; calibration row |
| Decision 9: lane at 300 ms (staging has since moved to Mumbai; the lane stays as the worst case) | 09E-01 | the lane's rule file at 300; budgets met by call and depth cuts |
| Decision 10: observability with no vendor | 09E-02 (R-20) | `rum_daily` pgTAP (fails-without); `rum.spec.ts`; `request.timing` lines vs Kong; `db-top-queries` evidence; `staging-smoke.ts --local` |
| Decision 11: calendar views next; data layer ready | 09E-12 | a 42-day range in one call; `p_include_slots false` |
| Strategy 1: reference data on the device, versioned, long-lived cache headers, IndexedDB, local search with SQL parity, server fallback, size budget | 09E-09 to 09E-11 | pgTAP `reference_catalogues`, `reference-routes.spec.ts`, three parity tables plus the trigram table, `*-local.spec.ts`, `reference-size.json`, B-14 |
| Strategy 2: per-doctor data once per consult, in memory, updated on save, custom medicines in local search | 09E-05, 09E-08, 09E-11 | `consult_screen` `my_lists` and Templates 0 calls; query updates on save; custom first in medicine parity |
| Strategy 4: schedule range in one query, adjacent prefetch, client cache, live, foundation for calendar views | 09E-12 | `schedule-live.spec.ts` (B-9, B-10, B-11, 42 days) |
| Strategy 5: PHI screens one read, prefetch, saves; no PHI on the device | 09E-05, 09E-06, 09E-08 | B-1/B-3 rows; the cache audit; `patient.view` not written by a prefetch or a notice |
| Strategy 6: layout skeletons, streaming | 09E-06 | `loading-states.spec.ts` at three widths with axe (B-2) |
| Strategy 7: latency lane and baseline first | 09E-01 | calibration, `perf-latency` project, CI step, `evidence/baseline/` |
| M criterion 6: Realtime update visible ≤ 2 s | 09E-04, 09E-06, 09E-12 | `convergence.spec.ts`, `today-live.spec.ts`, `schedule-live.spec.ts` |
| No regression of 09C safety | 09E-08, 09E-11 | `rx-allergy.spec.ts`, `allergy-match.spec.ts`, `rx-keyboard.spec.ts` unchanged in intent and green |
| Read latency | 05, 06, 09, 12 | `command-latency.json` p95 for `consult_screen`, `today_board`, `schedule_range`, `reference_shard`, `clinic_live_state` |

## Source audit

| Source | Items | Covered by |
|---|---|---|
| GOAL | instant clicks on staging; shared real-time truth decided by the database | 09E-01, 09E-02 (measure); 09E-03, 09E-04 (data layer, convergence); 09E-05, 09E-06 (screens); 09E-07, 09E-08 (writes); 09E-09 to 09E-11 (search); 09E-12 (schedule); 09E-13 (bootstrap) |
| REQ | PO decisions 1 to 11; strategy items 1, 2, 4 to 7; Q-2 to Q-4 | Traceability, row by row |
| | PRD 1-2 s, FE-9, DESIGN §6.9, FE-TECH D4 and §5, M criterion 6, P1-25 | B-1 to B-15; R-11, R-12, R-14, R-20; B-11 |
| RESEARCH (docs, tree, research notes) | TARGET §3.8, §3.9, §9; ADR-019; PWA §3.2, §4 (D-3 to D-5, cache audit); DATA_HANDLING §3, §5; CDCI licence; the debug doc (quota, silent channels); the stale-write gap per command; Next's built-in Web Vitals; Vercel response limit | R-5, R-9, R-12, R-13, R-18 to R-20; C-1 to C-7; Doc amendments; Risks |
| CONTEXT (rulings) | lean process, no service role (ADR-0005), no PHI on the device, one named dependency, flaky-test policy, 09D hand-offs, 09C R-2/R-4/R-7, 08 R-10/R-11 | Shared rules, R-4, R-7, R-8, R-10, R-14, R-15 |

No item is unplanned. Nothing waits on a PO decision except the PR split (Q-5), which changes delivery, not scope.

## Threat register (STRIDE; security_enforcement on)

| ID | Cat. | Component | Sev. | Disposition | Mitigation |
|---|---|---|---|---|---|
| T-09E-01 | I | `consult_screen` (one read returning a whole consult) | high | mitigate | INVOKER (RLS applies), `consultations:view` guard, each part behind the page's existing permission and entitlement, `my_lists` filtered by `doctor_id = auth.uid()`; pgTAP role × part matrix, another clinic and a forged tenant NULL, another doctor's lists absent (fails-without); parity against the old reads |
| T-09E-02 | I | `schedule_range`, `today_board` and their routes | high | mitigate | INVOKER, `appointments:view`, only the fields the screens show, 42-day cap, tenant from the session; pgTAP cross-clinic (fails-without) and role cases |
| T-09E-03 | I | Signals on `today:<tenant>` | medium | mitigate | Payload `{domain, version}` only (no ids); topic policy unchanged (active member, `appointments:view`, access `full`); `today-signals.spec.ts` checks every domain's keys and another clinic's silence |
| T-09E-04 | I | Data on the device | high | mitigate | Only `cliniq-reference` (global catalogue rows) in IndexedDB; the query cache in memory only (persisters lint-banned), cleared at sign-out, clinic switch and lock (fails-without); PHI routes `no-store`; purge at sign-out unchanged; the cache audit asserts store names and record shapes and nothing after sign-out |
| T-09E-05 | E / I | Reference routes | medium | mitigate | Session auth, permission per catalogue, `version` checked as a uuid and against the current one, `shard` an integer in range, fixed error bodies, `private` cache only; route specs with each refusal |
| T-09E-06 | T | A tampered local index (a user edits IndexedDB) | low | accept | The device only proposes; `change_prescription` checks the brand id and name against the catalogue and runs the allergy check (09C 000120 S-1, S-8); `record_patient_allergies` stores strings |
| T-09E-07 | Safety (T) | Local search differing from SQL | medium | mitigate | One case table per catalogue against SQL, the trigram table, `COLLATE "C"` tie-breaks, the server tail for medicine rank 5, the route as fallback; any parity failure blocks the plan |
| T-09E-08 | Safety (T) | A save shown as done that failed | medium | mitigate | Risk classes (R-11): confirm-class saves never show success before the database (held-POST test, fails-without); reversible saves roll back with the fixed error and Retry; fault-injection cases per save |
| T-09E-09 | T | Lost update: a write based on a stale screen | high | mitigate | `row_version` on visits and invoices, `p_expected_version` checked after the row lock and before any write, `ROW_CHANGED`; the app always sends it; pgTAP per command (fails-without); `slot_conflicts` stays the slot authority |
| T-09E-10 | I / T | Session bootstrap | medium | mitigate | Allow-listed fields only (pgTAP key set, zod strict); role for display only, every permission decided by the server and the database; fees, billing, access and entitlements never held (fails-without on fees); cleared with the query cache |
| T-09E-11 | E / D | Latency preload outside the e2e lane | medium | mitigate | Loaded only through the e2e app env's `NODE_OPTIONS`; acts only for the loopback Supabase origin and only while its rule file exists; lives under `tests/`; global setup removes a stale file |
| T-09E-12 | R | `patient.view` written after the response | low | mitigate | Still written once per opening (spec); failures logged by tag; a prefetch or the changed-elsewhere notice writes nothing |
| T-09E-13 | D | Catalogue download on metered or slow networks; storage quota | low | accept | After first paint, idle, once per version per sign-in, about 1.5 MB; quota errors fall back to memory; the route serves search meanwhile |
| T-09E-14 | I | RUM ingest | high | mitigate | Closed lists in the route and again in `ops_ingest_rum`; no tenant, user, URL, id, text or time of day stored; environment and release from the server; `ops` not served by the API; 90-day retention; fails-without on the SQL check |
| T-09E-15 | D / T | RUM flooding or skewing | low | mitigate | Session required, per-user limit, ≤ 60 samples a batch, rows bounded by the closed dimensions, a daily cap with an overflow counter; skewed numbers affect only reports |
| T-09E-16 | D | Realtime refusal (quota) or deaf channels leaving screens stale | medium | mitigate | One signal per clinic, domain and transaction; the 12 s heartbeat while subscribed; the badge; the dropped-signal e2e (fails-without); RUM `live_dropped` counts them on staging |
| T-09E-17 | I | Timing logs and `Server-Timing` | low | mitigate | Counts, depth and milliseconds only, a route pattern, the request id; no URL, query, id, name or text; the header goes only to the requester |
| T-09E-18 | D | Version-row lock contention within one clinic | low | accept | Commands are short; bulk jobs stay short or chunk; measured in `command-latency.ts` runs (research §2.2) |
| T-09E-19 | I | `GET /api/live/state` | low | mitigate | Active member of the session's clinic only; versions and access level only; no ids |
| T-09E-SC | T | npm install of `@tanstack/react-query` | high | mitigate | One package, PO-approved, [VERIFIED] in the research notes' legitimacy audit (registry metadata, repository, licence); exact pin; lockfile diff reviewed; CI's security job audits it; no other package; any further addition needs the legitimacy gate and a blocking human checkpoint |

## Risks

| Risk | Plan response |
|---|---|
| Hosted projects still sign JWTs with the legacy HS256 secret, so `getClaims` falls back to one `getUser` per request and staging misses B-1 by one call | 09D's PO action P2 (switch to asymmetric signing keys) stays a precondition for judging staging; the local lane uses ES256 like the local stack |
| Realtime capacity in production: every signal costs 1 + open devices of the clinic against a project-wide quota, and each open tab holds a socket | Coalescing per transaction; channels closed 60 s after a tab is hidden; the heartbeat keeps refusals safe; RUM `live_dropped` measures them; V2-15 sizes the Supabase plan's Realtime limits (hand-off) |
| A writer the triggers miss leaves a domain version unchanged (then no heartbeat can see it) | The executor lists every column of every mapped table; pgTAP covers each table and event; the affected-test grep includes every writer; the adversarial review checks for unmapped writers |
| Statement triggers with transition tables are subtle (one event per trigger, no column list on UPDATE) | Research §2.2; pgTAP per table and event; the row-level trigger kept as the fails-without comparison |
| Version-row contention when one clinic writes in bursts | Short commands; lock waits visible in `command-latency.ts`; bulk jobs chunk |
| TanStack Query adds client JS (about 13 kB gz) to every dashboard route | B-15 reported; screens stay server-rendered (research §2.5); no devtools or persister |
| `page.clock` also moves other timers (the 5-minute session poll, gc) | The convergence specs advance in 12 to 13 s steps and assert only the heartbeat's effects |
| Next 16 or Turbopack cannot bundle the Web Worker | Main-thread fallback with the index built in idle chunks (09E-11 step 2); measured and recorded |
| The full medicine index is too big for a 2 to 3 GB Android phone | Columnar index, B-14, the device checklist on the low-end phone; R-7 fallback (generics and substances on the device, brands on the server) |
| Database `lower()` or collation differs between the local stack and hosted projects | `COLLATE "C"` tie-breaks; non-ASCII cases in every table; PO action `09E-P4` compares `lc_collate` and `lc_ctype` read-only on staging |
| The budget step makes CI slower | Only the `@budget` subset on PRs (about 4 minutes); calls and depth are deterministic; a failing row is root-caused, never retried |
| Removing `revalidatePath` leaves another view stale | Live screens converge through R-18; other screens show the changed-elsewhere notice; per-save e2e asserts what a reload shows |
| `consult_screen` or `today_board` drifts from the page's rules | Parity against the old reads for every state and role before the old path is deleted; pgTAP role matrices |
| The perf catalogue (94,000 synthetic rows) changes search results for other e2e specs | Ids `perf-*` with synthetic names unlike the `Qzx` fixtures; upserted and deleted by the lane only; the lane runs alone |
| RUM volume on staging is small, so percentiles are noisy | Reported with counts; the staging smoke script gives a repeatable walk; production sampling is set at V2-15 |
| The phase is large (13 plans and a fix round) | Measured order with the foundation first; split points named in 09E-02, 04, 06, 11 and 12; each plan leaves the tree green; Q-5 offers two PRs |

## Doc amendments needed (do not edit the docs in planning; applied at the close)

| # | Document | Amendment | Why |
|---|---|---|---|
| A-1 | TARGET_ARCHITECTURE §3.9; FRONTEND_TECHNOLOGY_ASSESSMENT §5 (client cache row) and D4; V2_MASTER_ROADMAP FE-5 | TanStack Query adopted (memory only; cleared at sign-out, clinic switch and lock; no persister); the §5 decision gate closed by the PO on 2026-11-23 | Decision 4 |
| A-2 | TARGET_ARCHITECTURE §3.9; PWA_STRATEGY §3.2 ("Realtime on resume"); FRONTEND_MIGRATION_PLAN risks (polling fallback) | Live screens use clinic versions: signals carry the version, one per clinic, domain and transaction; a 12 s version heartbeat while a live screen is visible, also when subscribed; a re-read only on a newer version; staleness ≤ about 15 s when Realtime fails (PO-accepted) | Decisions 2, 3 |
| A-3 | TARGET_ARCHITECTURE §9 | ADR-019 unchanged; no server cache of any kind, also none for reference data (the tag cache §9 recommends is not used); reference data on the device (IndexedDB `cliniq-reference`) and in the browser's HTTP cache under versioned URLs; a session bootstrap in client memory; the never-held list | Decision 1 |
| A-4 | PWA_STRATEGY §4 cache audit (and D-3 wording) | One allowed IndexedDB database, `cliniq-reference`, global catalogue rows only, deleted at sign-out | Q-2 |
| A-5 | DESIGN_SYSTEM §5 Combobox | The 200 ms debounce applies to server-backed search; on-device search answers each keystroke, one search per animation frame | Q-3 |
| A-6 | DESIGN_SYSTEM §6.9 | Optimistic UI only for reversible actions (queue moves, chips, draft notes, Rx lines, diagnoses, vitals); booking, payment, allergies and sign-and-finish show a pending state and never success before the database confirms; the "This changed on another device" refusal pattern | Decisions 5, 6 |
| A-7 | 06-UI-SPEC §8 "Live data" | Labels "Live" / "Reconnecting · Updated N s ago" replace "Connecting…" / "Live" / "Updating every 20 s" | Decision 2 |
| A-8 | TARGET_ARCHITECTURE §3.8; V2_MASTER_ROADMAP §6 observability row and P1-25 | First-party real-user monitoring (`ops.rum_daily`, aggregated, no personal data, 90 days), `Server-Timing` and the per-request timing line, the `pg_stat_statements` report; no vendor (PO-12, C39); §3.8's pino and Sentry recommendation is superseded by V2-03 R-6 and C39 (record it) | Decision 10 |
| A-9 | DATA_HANDLING §5 (retention) and §2 (data inventory) | `ops.rum_daily` and `ops.rum_overflow`: operational, no personal data, 90 days | Decision 10 |
| A-10 | PWA_STRATEGY §3.9; V2_MASTER_ROADMAP FE-9 and P1-41 | Per-PR blocking budgets on database calls and round-trip depth per screen and action; millisecond budgets report-only (the latency lane nightly; Lighthouse report-only until V2-15 as before) | Decision 8 |
| A-11 | TARGET_ARCHITECTURE §6 (standard error type and its codes) | The `ROW_CHANGED` command refusal; commands take an optional expected row version (API callers too) | Decision 6 |
| A-12 | V2_MASTER_ROADMAP environments row (§6) | Staging Supabase moved to Mumbai (`ap-south-1`) by the PO on 2026-11-23, after decision 9; production Supabase Mumbai with Vercel `bom1` | Decision 9 (superseded by the move) |
| A-13 | V2_MASTER_ROADMAP §12 and status line | V2-09d and V2-09e inserted by the PO on 2026-11-23, before V2-10, with this scope | PO brief |
| A-14 | VERIFICATION_LOG entry (records 08-PLAN R-10's change) | Today signals: row triggers replaced by per-transaction statement triggers; payload `{domain, version}` instead of `{kind, visit_id}`; topic and policy unchanged | Decision 3 |

## Hand-offs

- **V2-10 billing:** the `billing` domain version and `invoices.row_version` exist; new billing commands take `p_expected_version`; the
  invoice-item table writes become commands (P1-06).
- **V2-13c platform admin:** a RUM screen over `ops.rum_report` (SQL only until then).
- **V2-15 production:** Realtime quota, monthly messages and concurrent connections sized against clinics × devices × writes; the RUM sample
  rate for production; the log drain for `request.timing` lines (P1-25).
- **Calendar views (next phase):** `schedule_range` serves 42 days in one call and `p_include_slots false`; the views read the same query.

## PO questions (few and plain; the default applies if unanswered)

| # | Question | Answer or default |
|---|---|---|
| Q-1 (C-1) | May the server keep each clinic's settings between requests? | **Answered 2026-11-23: no server cache; ADR-019 unchanged.** A session bootstrap in the browser's memory instead; critical data always read fresh (R-13, 09E-13) |
| Q-2 (C-2) | May the app keep one database on the device holding only the public drug, diagnosis and allergy lists, deleted at sign-out? | **Answered: yes** (A-4) |
| Q-3 (C-3) | May on-device search answer on every keystroke instead of waiting 200 ms? | **Answered: yes** (A-5; server search keeps its debounce) |
| Q-4 | Do you accept the budgets and the budget check on every pull request? | **Answered: yes**, refined by decision 8: calls and depth block on every PR; milliseconds are reported, not blocking |
| Q-5 (new) | This phase now has 13 plans. Ship it as one pull request at the end, or as two: the first after 09E-08 (measurement, data layer, live convergence, screens, saves), the second with the catalogues, the schedule and the bootstrap? Two PRs put the speed and live fixes on staging sooner but cost one more review round and gate | **Answered 2026-11-23: two PRs.** PR 1 = 09E-01 to 09E-08 (with its own review, fix round and gate); PR 2 = 09E-09 to 09E-13 |
| Q-6 (new, 2026-11-23) | While an Rx line is saving, the entry field is read-only (09C-01), so a fast typist loses the first letters of the next medicine and Enter then picks the top match for the rest (found by the 09D debugger: "Para" typed during a 400 ms save was dropped, only "cet" kept). Keep the field open during the save? | **Default: yes, in 09E-08.** The line is added optimistically, so the field clears and stays editable at once; keys typed during the save are kept. Proof in 09E-08: e2e on desktop-chrome and iphone-15 with the add held 400 ms, the full name typed across the save reaches the field (fails on the 09C read-only field) |

PO actions at the close: `09E-P1` the gate; `09E-P2` a 10-minute walkthrough on staging after the staging migrate (open Today, a consult,
search a drug and a diagnosis, add three Rx lines, book from Schedule, on a phone and a desktop, with a second device open on Today), then run
`npm run perf:staging-smoke` (you sign in; it writes a timing report) and, after a day of use, paste the output of `ops.rum_report(7)` and of
`scripts/perf/top-queries.sql` from the staging SQL editor (both read-only); the device checklist (low-end Android: catalogue download time,
search speed, memory; iPad: the same); `09E-P3` staging migrate of 000122 to 000130 (not delegated); `09E-P4` read-only check on staging of
`lc_collate`, `lc_ctype`, the JWT signing algorithm and that `pg_stat_statements` is enabled; `09E-P5` answer Q-5 and confirm the doc
amendments A-1 to A-14.

## Out of scope

The calendar views the PO wants next (week time grid, month view: the range read is built for them, the views are not); V2-10 billing; any server cache (Redis, CDN, `unstable_cache`, `use cache`; decision 1);
service-worker caching of data; offline writes and any PHI on the device; on-device patient search; an outside monitoring vendor and a
platform-admin RUM screen (V2-13c); Lighthouse and k6 blocking budgets (V2-15, P1-41).

## Execution (lean process)

- Executors: Sonnet `gsd-executor`, one plan at a time in the order above, migration numbers per the note (renumber at start). Never set a mode
  when starting a subagent (CLAUDE.md). Each plan runs only its affected Vitest and pgTAP files (full pgTAP in 09E-09 and 09E-12) plus its e2e
  files and `npm run perf:latency`; 09E-03, 09E-04, 09E-06, 09E-08, 09E-11 and 09E-12 run the full PR lane once; CI runs everything after the
  push. `npm run stack:recycle` between executors. The evidence run at the close is the only full Vitest run; the FLOOR is re-measured from it
  once.
- One "fails without" proof per High control only: 09E-02 (nothing identifying into `ops`), 09E-03 (query cleared at clinic switch), 09E-04
  (one signal per transaction; the heartbeat recovers a dropped signal), 09E-05 (another doctor's lists absent from `consult_screen`), 09E-07
  (stale reschedule refused), 09E-08 (no success before confirm), 09E-09 (the cache audit refuses a record of an unknown shape), 09E-12
  (`schedule_range` for another clinic), 09E-13 (fees never held). No mutant runs.
- Reviews: Sonnet for the isolated review; Opus for the adversarial review, security fixes and hard debugging; Haiku for docs and evidence.
  One review round, one fix round (09E-14a).
- Evidence: one run (`... evidence 1`) plus CI (R-16). Push once (per PR if Q-5 says two).
- Branch `v2/phase-09e-caching-speed` off `feature/v2` after the V2-09d merge; PR into `feature/v2`; never `main`; no force-push; local stack
  only, never hosted Supabase.
- New dependencies: `@tanstack/react-query` only (R-14; why: one memory-only client data layer for live screens, the consult, the bootstrap and
  mutations instead of four hand-built stores). No `web-vitals` package (Next's `useReportWebVitals`).

## Staging finding to cover (PO, 2026-11-23)

First password-reset save on staging stalled ~30 s and showed "We couldn't reset your password"; the retry saved
(Supabase `PUT /user` 200 in 0.18 s at 16:07:28 UTC, Vercel `auth.password.changed`). Supabase calls were all fast; the
stall was inside our server function, and the runtime logs hold nothing for it because the slow path writes no line.
09E-02 must cover it: a timing line per Server Action and route (start, each external call, end, outcome), so a stall
shows where it is. The reset page must not report "failed" when the save's outcome is unknown (check the session or
show "checking" and retry once). Reproduce on staging after an idle period with the new timing lines before closing.
