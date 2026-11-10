# clinicOS v2.0 — Frontend Migration Plan

| | |
|---|---|
| Date | 2026-11-10 · plan only. Execution requires approval of `FRONTEND_TECHNOLOGY_ASSESSMENT.md` §9 (D1–D10). |
| Strategy | Incremental **strangler**: tokens → primitives → shell → workflows (by daily frequency) → cleanup. v1 and v2 screens coexist behind flags. No big-bang rewrite. |
| Related | `UX_AUDIT.md`, `INFORMATION_ARCHITECTURE.md`, `DESIGN_SYSTEM.md` |

Labels: **Fact**, **Problem**, **Risk**, **Assumption (validate)**, **Recommendation** · P0–P3 · S/M/L/XL relative sizes.

---

## 1. Principles

1. **Port behaviour, not markup.** v1 contains working business logic: scheduling rules, overbook and soft-block overrides, waitlist promotion, amendment flow, AI insertion collisions, dedup, WhatsApp share. Each rebuild starts by listing the v1 behaviours (characterisation tests), then re-implements the UI on v2 components.
2. **Every step ships and can be rolled back independently.** One PR per component group or workflow. Workflows are flag-gated per route.
3. **Backend first for composite writes.** A workflow whose v1 implementation chains several server actions from the browser (walk-in, booking + new patient, checkout) is rebuilt only after its atomic RPC or action exists (Workstream C). Until then the v2 UI calls an adapter with the same signature.
4. **Measure before and after:** a11y violations, route JS, click or keystroke counts, task time with synthetic data.
5. **No dark theme, no i18n, no new features beyond B6** unless approved. Redesign is not scope creep.

---

## 2. Prerequisites (owned outside Workstream B)

| ID | Prerequisite | Owner | Why the frontend needs it | Blocks |
|---|---|---|---|---|
| PR-1 | Local, ephemeral Supabase + synthetic seed (no hosted DB in tests) | Workstream E | Characterisation e2e, screenshots, axe runs (UX_AUDIT OI-UX-1/2) | M0 |
| PR-2 | Next.js patched-major upgrade + `npm audit` remediation | Workstreams D/F | Avoid building v2 UI twice | M1 |
| PR-3 | zod 3 → 4 | Workstream C | Shared form schemas | M2 forms |
| PR-4 | Receptionist permission decision (UX_AUDIT F-01) | Product owner + Workstream D | Today/registration behaviour | M4.1 |
| PR-5 | Atomic RPCs: `enqueue_walk_in`, `register_and_book`, `collect_payment`; staff `reschedule`; `no_show`; cancel reason | Workstream C | F-03, F-04, F-06 | M4.1, M4.3, M4.5 |
| PR-6 | Search endpoint (minimal projection, ranking, pg_trgm) | Workstream C | Palette, PatientPicker | M3, M4.2 |
| PR-7 | Available-slots query | Workstream C | Booking sheet | M4.3 |
| PR-8 | Realtime publication + RLS validation for `visits`, `queue_tokens` | Workstreams C/D | Live Today | M4.1 |
| PR-9 | Tenant time zone setting (default `Asia/Kolkata`); money columns confirmed in paise | Workstream C | `lib/datetime`, `lib/money` | M1 |
| PR-10 | Consult draft versioning (optimistic concurrency) | Workstream C | Consult save model | M4.4 |

---

## 3. Phases

```
M0 Baseline & safety nets ─► M1 Tokens & foundations ─► M2 Primitives & clinical components ─► M3 Shell & IA
                                                                                                    │
     M5 Cleanup & enforcement ◄── M4.7 … M4.1 Workflows (priority order, each flag-gated) ◄─────────┘
```

### M0 — Baseline and safety nets · Size **M** · P1

| Work | Detail |
|---|---|
| Characterisation e2e (v1) | Playwright specs against the local stack (PR-1) for the 6 critical flows. These assert **outcomes** (DB state, visible results), not v1 selectors, so they survive the redesign. Flows: register patient · walk-in to token · book appointment (incl. overbook path) · cancel · consult → Rx → finish · checkout/collect. |
| Baseline metrics | axe report per route on the `PWA_STRATEGY.md` §9.1 PR-lane projects (Desktop Chrome 1280, Pixel 7, iPhone 15) (erratum 2026-11-10, PWA §12). Route JS from `next build`. Screenshots at 360/768/1280. Click/keystroke counts for the 6 flows (record in a table in this doc's appendix when run). |
| `/dev/ui` gallery route scaffold | Dev or preview only (`notFound()` in production). |
| CI checks (report-only mode) | grep guards from `DESIGN_SYSTEM.md` §10. `eslint-plugin-jsx-a11y`. Bundle budget report. |

**Acceptance criteria**

- 6 characterisation specs pass on v1 (or failures are documented as known v1 bugs, e.g. F-01 and F-04).
- The baseline report is committed under `docs/v2/` (the frontend plan appendix).
- No production code changed.

**Rollback:** n/a. Additive tests and tooling only.

### M1 — Tokens and foundations · Size **S** · P1

| Work | Detail |
|---|---|
| Tokens | Replace `app/globals.css` with the `DESIGN_SYSTEM.md` §2.4 `@theme` (palette reset **commented out**). Delete the dead `:root` block. |
| Codemod v1 colours to tokens | Mechanical replace of the most common arbitrary values: `[#1769E0]` → `accent`, `[#EAF2FF]` → `accent-subtle`, `[#B42318]` → `danger-600`, `[#F7F6F3]` → `canvas`, `text-gray-400` → `text-fg-subtle`, and so on (mapping table in the PR). Old screens immediately adopt the new teal, contrast-safe text and canvas. |
| Fonts | `next/font` IBM Plex Sans (+ Mono) in `app/layout.tsx`; **IBM Plex Sans Devanagari is loaded only where Hindi content renders (public patient pages / print), not in the root layout** (erratum 2026-11-10, PWA §12). `lang="en-IN"`. `color-scheme: light`. |
| Libraries | `lib/datetime.ts` (clinic TZ, `todayInClinicTz`, `formatDate`, `formatTime`, `formatAge`, relative), `lib/money.ts` (`formatINR`, `parseINR`, paise), `lib/visit-status.ts` (single status map). Unit tests for each. |
| Replace UTC "today" | 29 sites → `todayInClinicTz()` (UX_AUDIT §2). |

**Acceptance criteria**

- `tsc` and the existing unit tests pass.
- Screenshot diff reviewed: expected colour and font shifts only, no layout breakage at 360/768/1280.
- axe: contrast violations drop to 0 on routes where the codemod applied.
- Unit tests cover IST midnight edge cases (00:00–05:30 IST) and en-IN money grouping (`₹1,25,000`).

**Rollback:** revert the single PR. Tokens are CSS-only, and the codemod is mechanical.

**Risk:** a colour codemod mis-maps a semantic use (e.g. blue used as "info"). Mitigation: per-file review and screenshot diff.

### M2 — Primitives and clinical components · Size **L** · P1

Build in `components/ui` (primitives) and `components/clinical` (patterns), each with gallery states and tests.

| Batch | Components | Notes |
|---|---|---|
| 2a | Button, IconButton, Kbd, Input, Textarea, Field, Label, NativeSelect, Checkbox, RadioGroup, Switch, SegmentedControl, ChipGroup | Keep **v1-compatible props** on Button/Input/Select (`variant`, `startIcon`, `invalid`) via thin adapters, so existing call sites upgrade automatically |
| 2b | Dialog, AlertDialog, Sheet, Drawer, ResponsiveSheet, Popover, Tooltip, DropdownMenu, Tabs, Toast (`sonner`), Command | `Modal` becomes a wrapper over Dialog with the v1 `isOpen/onClose` API. This immediately fixes focus trapping on the 11 `<Modal>` users. |
| 2c | DataTable, DataList, Pagination, SearchField, FilterChip, Skeleton, EmptyState, Alert, Banner | |
| 2d | DateField, Calendar, DayStrip, SlotPicker, PhoneInput (restyle, keep logic), MoneyInput, AgeOrDobInput | |
| 2e (clinical) | PatientIdentityHeader, AllergyBanner, StatusChip, TokenChip, QueueRow, VitalsForm, VitalsSummary, RxLineItem, RxEntryRow, InvoiceLines, ShareButton, SaveStatus, PatientPicker, QuickRegisterForm | PatientPicker and QuickRegister call the existing actions via adapters until PR-5 and PR-6 land |

**Acceptance criteria (each batch)**

- Every component renders in `/dev/ui` with all states: default, hover, focus, disabled, loading, error, empty.
- Playwright screenshots at 360 and 1280 are approved as baselines.
- axe: 0 violations in the gallery.
- Keyboard spec per interactive component: Tab order, Esc, arrows, Enter.
- Focus trap and restore verified for Dialog, Sheet and Drawer.
- Bundle: the first-load JS delta for a route that uses only 2a primitives is under 15 kB gz (measure).

**Rollback:** components are additive. The adapter swap (`Modal`, `Button`, `Input`) is one commit per primitive and can be reverted individually.

### M3 — Shell, IA and command palette · Size **M** · P1

| Work | Detail |
|---|---|
| New `(app)` layout | Sidebar (≥ xl), Rail (md–lg), BottomBar (< md), TopBar. `navForRole()` derived from the permission matrix (`INFORMATION_ARCHITECTURE.md` §3.2). |
| Command palette | ⌘K/Ctrl+K. Patients via a GET search endpoint (PR-6; interim: wraps `searchPatients` with a reduced projection mapped client-side). Actions. Navigate. "Ask Copilot" entry. |
| AI lazy-loading | Copilot drawer behind `next/dynamic` |
| Route skeletons and errors | `loading.tsx`, `error.tsx`, `not-found.tsx` for every route group |
| Redirect map | v1 → v2 URLs (`INFORMATION_ARCHITECTURE.md` §3.4) as permanent `redirects()`. New routes initially render the **existing** v1 page components inside the new shell. |
| Feature flag | `ui_v2` per tenant (DB or env allow-list) plus a per-user cookie override for internal testing |
| PWA shell items | Manifest, icons, viewport and appleWebApp metadata, SW registration, offline page, online banner, update toast, install entry (`PWA_STRATEGY.md` §8); M3 grows from M to M+ (about 1 extra S) (erratum 2026-11-10, PWA §12) |

**Acceptance criteria**

- All v1 pages reachable through the new nav for each role (e2e per role).
- No nav item leads to a page the role cannot use (fixes the F-01 class of mismatch).
- Palette: open → type 10-digit phone → Enter opens the correct patient in ≤ 3 keystrokes after typing.
- Mobile: bottom bar visible at 360 px, all targets ≥ 44 px, no horizontal scroll on any shell route.
- Route JS: the shell no longer includes `@ai-sdk/react` in initial chunks.
- Characterisation specs (M0) still pass.

**Rollback:** turn off the flag. The old `(dashboard)` layout stays in the tree until M5. Redirects are only enabled with the flag (middleware or proxy check), or kept compatible.

### M4 — Workflows, in priority order

Order reflects daily frequency × severity (UX_AUDIT §4, §6). Each workflow is behind `ui_v2.<workflow>` and ships when its acceptance criteria pass.

| Step | Workflow | Size | Backend prerequisites | Replaces |
|---|---|---|---|---|
| **M4.1** | **Today** (front desk, nurse, doctor modes) + walk-in + check-in + vitals + live updates | L | PR-4, PR-5 (`enqueue_walk_in`, `no_show`), PR-8 | `/`, `/queue`, `/cabin`, `queue-*`, `walk-in-drawer`, `triage-vitals-modal`, `my-queue-card`, `doctor-cabin-view` |
| **M4.2** | **Patient search + registration** (PatientPicker, QuickRegister with dedup everywhere) | M | PR-6, dedup endpoint | `patients/new` page, 5 search UIs, 5 create UIs |
| **M4.3** | **Booking, reschedule, cancel, no-show; Schedule views** (agenda on phone, day grid, week) | L | PR-5 (`register_and_book`, reschedule, cancel reason), PR-7 | `calendar-view`, `booking-drawer`, `doctor-timeline`, `overbook-dialog`, `soft-block-override-dialog`, `waitlist-drawer`, `block-time-modal` |
| **M4.4** | **Consultation workspace + prescription** | XL | PR-10, real document upload (reuse labs S3), optional drug–allergy mapping | `consultation-workspace` (1,681), `prescription-builder` (926), sections, `sign-and-bill-modal` (finish/hand-off part) |
| **M4.5** | **Collect payment + Collections page** | M | PR-5 (`collect_payment`), receptionist collections permission | `checkout-drawer` (1,029), `sign-and-bill-modal` (billing part), `receipt-modal`, `collection-reports-view` |
| **M4.6** | **Patient profile & history** (identity header, sub-routes, filterable timeline, documents, consent) | M | History pagination and filters | `patient-detail-view`, `patient-visit-history`, `patient-lab-documents`, `consent-section`, `edit-patient-modal` |
| **M4.7** | **Registers, reports, settings, auth/onboarding, public pages** | M | Server pagination | `visits-register-view`, `referrals-register`, staff, settings, developer, login/verify/join, `/r`, `/reschedule` |

**Per-workflow acceptance criteria (template; every M4 step must meet all)**

1. **Functional parity:** every v1 behaviour in the characterisation inventory works, or its removal was approved. Example: the dead consult dropzone is replaced with real upload or removed.
2. **Target interaction counts met** (from `UX_AUDIT.md` §5), measured by an e2e "golden path" spec:
   - check-in: 1 action;
   - walk-in, existing patient: ≤ 3 keystrokes after typing;
   - booking with context: ≤ 3 actions;
   - reschedule: ≤ 4;
   - add Rx line by keyboard only;
   - collect: ≤ 3.
3. **Accessibility:** axe 0 serious or critical. Keyboard-only e2e of the golden path. Focus is visible and never obscured. TalkBack smoke test on Pixel viewport (manual, per release).
4. **Responsive:** golden path passes on the `PWA_STRATEGY.md` §9.1 device matrix (Desktop Chrome 1280, Pixel 7, iPhone 15 in the PR lane; tablets nightly), replacing the Pixel 5 lane (erratum 2026-11-10, PWA §12). Screenshots at 360/768/1280 approved.
5. **Resilience:** network-failure test (Playwright route abort) shows a recoverable error, not a lost form. Double-submit produces one record (idempotency).
6. **Performance:** route first-load JS within budget (≤ 200 kB gz for Today and consult; validate the budget in M0). Today realtime update visible ≤ 2 s after a change made in another browser context (two-context Playwright test).
7. **Data integrity:** no client-side multi-action chains remain for the workflow (grep check). Composite writes go through one action or RPC.
8. **Observability:** client errors from the workflow reach the error-reporting tool (Workstream F).

**Workflow-specific additions**

| Step | Extra criteria and tests |
|---|---|
| M4.1 | Two-tenant realtime isolation test (events from tenant B never reach A). Role matrix e2e: receptionist cannot start a consult. Doctor sees only their queue by default. Live-region announcements throttled. |
| M4.2 | Dedup banner shown in all entry points. Shared family phone: results show age and sex. Search returns the minimal projection only (assert no address or allergy fields in the response). |
| M4.3 | Overbook path creates exactly one patient (regression for F-04). Slot times correct with the device TZ set to UTC (Playwright `timezoneId`). Waitlist promotion notice preserved. |
| M4.4 | Draft persistence: kill the tab mid-note, reopen, and the content is restored **up to the last server autosave (≤ 5 s)** (erratum 2026-11-10, PWA §12). Concurrent edit in two tabs shows a conflict prompt, not a silent overwrite. Amendment flow parity. AI suggestions marked until accepted. Allergy banner always visible. |
| M4.5 | Amounts formatted en-IN. Paise round-trip exact. Collect is atomic (inject failure after invoice creation: no partial state). Receipt share parity. |
| M4.6 | Tab sub-routes deep-linkable. Timeline filters in the URL. DPDP export/consent parity (Workstream D). |
| M4.7 | Every register paginated server-side. Filters in the URL. Public patient pages pass axe and work at 320 px. |

**Rollback (all M4):** disable `ui_v2.<workflow>` for the tenant, which falls back to the v1 route and components. They stay in the tree until M5. Backend RPCs are backward compatible: v1 chains keep working until removal.

### M5 — Cleanup and enforcement · Size **S** · P1

| Work | Detail |
|---|---|
| Remove v1 | Delete v1 components replaced in M4, `components/dashboard/nav.tsx`, `(dashboard)` layout, unused primitives, dead `animate-in` classes |
| Enforce | Uncomment `--color-*: initial` (palette reset). CI guards switch from report-only to **blocking**. Bundle budgets blocking. |
| Docs | Update `DESIGN_SYSTEM.md` with as-built deltas. Gallery is the reference. |
| Template | Remove `docs/temp/free-nextjs-admin-dashboard-main` from the repo (reference only) |

**Acceptance criteria**

- 0 arbitrary hex classes.
- 0 sub-12 px text.
- 0 `alert(`/`confirm(`.
- 0 UTC "today".
- 0 `<Link><Button>`.
- axe 0 serious or critical across all routes.
- All flags removed, or defaulted on and then removed.

**Rollback:** revert the deletion PR. Flags were already defaulted on for 2+ weeks with no incidents before deletion.

---

## 4. Coexistence strategy

| Concern | Approach |
|---|---|
| Styling | One Tailwind build. v2 tokens are added alongside the default palette (M1). v1 screens get mapped colours via the codemod. Both render consistently enough during transition. Palette reset only in M5. |
| Components | v2 primitives keep v1 prop names via adapters for `Button`, `Input`, `Select`, `Modal`, `Badge`, so untouched v1 screens inherit a11y fixes without rewrites. |
| Routing | New IA routes render v1 page components until the workflow is rebuilt. Redirects map old URLs. Flags choose v1 or v2 per workflow. |
| Data | Same server actions. New RPCs are additive. Adapters in `features/<domain>/client.ts` hide whether the UI calls the chain (v1) or the RPC (v2). |
| State | No global client store introduced. Each workflow owns its state. Realtime is scoped to Today. |
| Testing | M0 characterisation specs run against both v1 and v2 for the duration of coexistence (outcome-based assertions). |
| Release | Internal tenant → 2–3 friendly clinics (synthetic data rehearsal first) → all tenants. Flag defaulted on per workflow after 2 weeks with no P1 issues. |

---

## 5. Test strategy (frontend)

| Layer | Tool | Scope | Gate |
|---|---|---|---|
| Unit | Vitest (existing) | `lib/datetime`, `lib/money`, `lib/visit-status`, form schemas, nav model | Blocking from M1 |
| Component behaviour | Vitest + jsdom + Testing Library (**Assumption**: approve adding; today there are 0 render tests) or Playwright component tests | Combobox keyboard, MoneyInput parsing, SlotPicker selection, Sheet dirty guard | Blocking from M2 |
| Visual regression | Playwright `toHaveScreenshot` on `/dev/ui` and key routes at 360/768/1280 with deterministic synthetic data and a frozen clock (`page.clock`) | All primitives and workflows | Blocking from M2. Approved baselines in the repo. |
| Accessibility | `@axe-core/playwright` on every route and gallery page. Keyboard-only golden paths. | WCAG 2.2 AA (tags `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`) | Blocking from M2 (gallery), M3 (routes) |
| E2E | Playwright on the `PWA_STRATEGY.md` §9.1 device matrix (replaces Desktop Chrome + Pixel 5) (erratum 2026-11-10, PWA §12) against the local Supabase | 6 golden paths + role matrix + realtime two-context | Blocking from M3 |
| Performance | `next build` route sizes + Lighthouse CI (mobile, throttled) on Today, Patients, Consult | Budgets | Report-only from M2 (nightly), blocking at V2-15 (roadmap P1-41) (erratum 2026-11-10, PWA §12) |
| Manual | TalkBack (Android Chrome), NVDA (Windows Chrome), 200% zoom, real low-end Android device | Per release | Checklist |

**Hard rule.** No frontend test may use `.env` or the hosted Supabase. All runs use PR-1's local stack (shared brief).

---

## 6. Sequencing summary and sizing

| Phase | Size | Can start when | Parallelisable with |
|---|---|---|---|
| M0 | M | PR-1 | Backend RPC work |
| M1 | S | PR-2, PR-9 (TZ default can be hard-coded IST initially) | M0 tail |
| M2 | L | M1, D1 approved | PR-5 to PR-8 backend work |
| M3 | M | M2a/b | M2c/d/e |
| M4.1 | L | M3, PR-4, PR-5 (walk-in), PR-8 | M4.2 design |
| M4.2 | M | M3, PR-6 | M4.1 |
| M4.3 | L | M4.2, PR-5, PR-7 | M4.4 design |
| M4.4 | XL | M2e, PR-10 | M4.5 |
| M4.5 | M | PR-5 (`collect_payment`) | M4.4 |
| M4.6 | M | M4.2 | M4.7 |
| M4.7 | M | M3 | M4.6 |
| M5 | S | All M4 flags defaulted on ≥ 2 weeks | — |

**Overall frontend programme:** **XL**. **Assumptions:**

- 1–2 frontend engineers with design support.
- Backend prerequisites delivered in step.
- No new feature scope.
- Approval of D1–D10 before M1.

---

## 7. Risks and rollback summary

| Risk | Mitigation | Rollback |
|---|---|---|
| Characterisation tests can't run (no local DB) | Make PR-1 a hard gate for M2+ workflow work | Pause M4 |
| Business-logic regression in consult or checkout | Outcome-based e2e. Port logic modules first (pure functions extracted with unit tests). Pair review with Workstream A for behaviour inventory. | Workflow flag off |
| Realtime instability on clinic networks | Polling fallback. Connection banner. Manual refresh. | Flag `today.realtime` off → polling only |
| Staff relearning cost | Keep v1 labels where reasonable in the first release. In-app "What's new" sheet. Shortcuts optional (all actions visible). | Per-tenant flag off |
| Scope creep (new features during the redesign) | B6 scope only. Product-owner sign-off for additions. | n/a |
| Visual inconsistency while old and new mix | M1 codemod and M2 adapters bring v1 screens close to v2 early | n/a |

---

## Appendix — Baseline measurements (to fill in M0)

| Flow | v1 actions / keystrokes | v1 time (synthetic) | v2 target | v2 measured |
|---|---|---|---|---|
| Check in booked patient | | | 1 action | |
| Walk-in, existing patient | | | ≤ 3 keystrokes after typing | |
| Walk-in, new patient | | | 2 actions + typing | |
| Book appointment (from profile) | ~6 (code estimate) | | ≤ 3 | |
| Reschedule | not possible for staff | | ≤ 4 | |
| Add 3 Rx lines | ~12 actions (code estimate) | | keyboard only, 0 mouse | |
| Collect payment | ~4 | | ≤ 3 | |
