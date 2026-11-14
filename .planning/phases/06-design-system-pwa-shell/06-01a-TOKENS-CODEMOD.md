# 06-01a record: semantic tokens (v1-equivalent), colour codemod, UI policy (report mode), design lanes

Plan: `06-PLAN.md` § 06-01a (Wave 1, no G2-D). Branch `v2/phase-06-design-system-pwa-shell`, worktree execution.
Plan base `745a6b7`. Every number below comes from a tool output in `evidence/06-01a/` (file named per row).

## What changed

| Area | Change | Files |
|---|---|---|
| Token layers | `app/globals.css` is the only token source. **Raw** `@theme`: one `--color-v1-*` per v1 colour the codemod maps (exact v1 hex, or the exact Tailwind `oklch()` for `gray-300/400` and the v1 badge colours), the v1 `--font-sans`, the v1 radii, the existing `--shadow-theme-*`. **Semantic** `@theme inline`: every DESIGN_SYSTEM §2.3 name in its §2.4 CSS spelling (canvas … scrim: 52 names, plus `fg-secondary`, `accent-tint`, `accent-border` from the G2-D token file = 55), each `var(--color-v1-*)` only. **Structural** `@theme`: type scale `--text-caption…--text-token`, `--shadow-popover/overlay`, `--ease-out`, `--duration-*`, `--spacing-{bar,bottom-bar,rail,sidebar,control}` (no site used any of these names). `:root` block and `--color-brand-*` deleted; `body` uses `var(--color-canvas)` / `var(--color-fg)`. | `app/globals.css` |
| Mirror | `lib/design/tokens.ts`: `themeColor` (`--color-surface`), `backgroundColor` (`--color-canvas`), `iconTile` (`--color-accent`), `iconGlyph` (`--color-fg-on-accent`), each naming its CSS variable; the test resolves the CSS and compares. | `lib/design/tokens.ts` |
| Codemod | `scripts/design/codemod-colors.mjs` + `color-map.json`: property-aware table (bg / text / border / ring groups) keyed by lowercase hex, optional per-state entries (focus ring → `ring`, selection ring → `accent`; hover/active shades), brand steps resolved through the deleted scale, `text-gray-400` → `fg-subtle` / `fg-placeholder` (placeholder) / `fg-disabled` (disabled), one per-file override (`components/ui/alert.tsx` info → `info-*`). Variants, opacity and `!` kept; every string literal and template text read with the TypeScript parser; idempotent; report written to `evidence/06-01a/codemod-report.json`. | `scripts/design/*`, 86 `.tsx` files under `app/`, `components/`, `features/` |
| UI policy | `scripts/ci/ui-policy.mjs` auto-discovers `scripts/ci/ui-policy/rules/*.mjs`; per-rule counts and delta vs `scripts/ci/ui-policy-baseline.json`; `--json`, `--summary` (CI job summary), `--write-baseline`; exit 1 only on an enforced finding. `npm run ci:ui-policy`; `ci.yml` `static` step "UI policy (DESIGN_SYSTEM §10; report mode, enforced rules fail)". | `scripts/ci/ui-policy*`, `package.json`, `.github/workflows/ci.yml` |
| jsx-a11y | `eslint-plugin-jsx-a11y` `recommended` rules at `warn` (options kept), read from the plugin object eslint-config-next registers (no new import). | `eslint.config.mjs` |
| Design lanes | Projects `design-360/820/1180/1280` (Chromium) from `tests/e2e/design/support/widths.ts`; PR and nightly lanes ignore `tests/e2e/design/{neutral,screens}/**`; `npm run e2e:design`. Neutral capture `tests/e2e/design/neutral/capture.spec.ts` (19 M0 routes + 4 M0 flow screens, M0 clock freeze); `scripts/design/neutral-diff.mjs capture|compare`; pixel counting `scripts/design/png-diff.mjs` in headless Chromium (`data:` only). `FLOW_SCREENS` moved from the M0 screenshot spec to `baseline-routes.ts` (shared; no assertion changed). | `playwright.config.ts`, `tests/e2e/design/**`, `scripts/design/*`, `tests/e2e/m0/baseline/*` |

## Collapsed v1 colours (every semantic fed by more than one v1 colour)

From `codemod-report.json` `collapses` (site counts; brand classes counted under their scale hex; `tw-gray-400` is
Tailwind's `gray-400`). The first colour listed in **bold** is the token's value; the others now render as it.

| Semantic | Sources (sites) | Visible effect |
|---|---|---|
| `accent` | **#1769e0** (391), #0f5ab8 (4: `bg-brand-600` selected segments, prescription builder) | selected segment one step lighter |
| `accent-border` | **#b3d4ff** (13), #b2ccff (11), #d5e6ff (6), #80baff (5), #bfd8ff (3) | tinted-panel borders unified |
| `accent-fg` | **#0f5ab8** (29), #0b4c9c (11), #0d3f7f (6), #0a2245 (1) | darker blue text on tints one or two steps lighter |
| `accent-hover` | **#155cc0** (28), #0f5ab8 (8), #0b4c9c (1, `hover:text`), #1253b3 (1), #1255b8 (1), #1455b3 (1) | hover only |
| `accent-pressed` | **#0b4c9c** (2), #0d4496 (1) | active only |
| `accent-tint` | **#f4f8ff** (2), #f9fbff (1) | none visible (Δ ≤ 5) |
| `border` | **#e5e7eb** (17), #e4e5e7 (7), #e5e4e0 (1) | none visible (Δ ≤ 4, 11) |
| `danger-border` | **#f8b4b4** (3), #ffdad6 (3) | light red borders |
| `danger-fg` | **#b42318** (11), #ba1a1a (11), #dc2626 (1) | Δ ≤ 9 / icon on `/r/[token]` |
| `danger-solid` | **#b42318** (15), #ba1a1a (1, focus ring) | none visible |
| `fg` | **#1a1a1a** (body text, 2), #111827 (30) | near-black text unified |
| `fg-secondary` | **#4b5563** (19), #52565b (4), #555 (2) | none visible / v1 nav (unused screen) |
| `fg-subtle` | **Tailwind gray-400** (226), #9ca3af (8) | none visible (Δ ≤ 3) |
| `selected` | **#d5e6ff** (1, `hover:bg-brand-100`), #d6e5ff (2) | hover only (Δ 1) |
| `success-fg` | **#18794e** (8), #16a34a (3) | public `/r`, `/reschedule` pages only |
| `sunken` | **#f8fafc** (11), #f9fafb (4), #f6f7f9 (3), #f1f2f4 (2), #f3f4f6 (1), #f0efea (1) | none visible except `#f0efea` (v1 nav badge, unused) |

Left as hex on purpose (no semantic slot for hover/pressed shades; listed in `codemod-report.json` `unmapped` with
owner): `components/ui/button.tsx:45` `hover:bg-[#912018]`, `active:bg-[#7A271A]`;
`app/(dashboard)/patients/[id]/consent-section.tsx:156` `hover:bg-[#146340]`;
`components/patients/patient-visit-history.tsx:232` `hover:bg-[#ffeacc]`. Out of scope with reasons in the report:
the four react-pdf documents (184 inline hex literals) and the dental odontogram's 22 inline SVG hexes (its classes
were migrated).

Semantic tokens with no v1 class site (provisional value = the nearest v1 screen's colour, list with sources in
`color-map.json` `provisional_without_v1_site`): `surface`, `fg-on-accent`, `border-control` (Tailwind gray-300, the v1
input border), `info-*`, `status-*` (v1 queue-card badges), `alert-allergy-*` (v1 danger solid / white), `scrim`
(v1 `bg-black/40`).

## Evidence (tool output)

| Check | Result | File |
|---|---|---|
| Codemod | 1201 replacements in 86 files: hex 771, brand 180, gray-400 250; 4 unmapped (above); second run 0 changes | `codemod-report.json`; `tests/design/codemod.spec.ts` (idempotence) |
| UI policy before (plan base tree) | arbitrary-color 775 in 70 files, brand-utility 183 in 17, `text-gray-400` 247, px-font 282, raw-palette 3780, screen-height 20, window-dialog 27, link-wraps-button 31, ai-sdk-import 0 | `ui-policy-before.json` |
| UI policy after | arbitrary-color **4** in 3 files, brand-utility **0**, `text-gray-400` **0**, raw-palette 3530, others unchanged; PASS | `ui-policy.json` (raw-palette summarised per file), baseline `scripts/ci/ui-policy-baseline.json` |
| Neutral diff | 92 screens (23 × 4 widths), **0 over 0.5 %**, max **0.171 %** (360 `/staff`); 52 screens pixel-identical, 13 per width | `neutral-diff.json` |
| Same-build noise floor | two captures of the plan-base build: max 0.029 %, 12 screens > 0 (server-rendered visit times and id suffixes) | `neutral-noise-same-build.json` |
| M0 axe (serious/critical report) | desktop-chrome 19 routes 256 nodes → 256, pixel-7 208 → 208, iphone-15 207 → 207; identical per rule | `axe-before/`, `axe-after/` (the `commit` field is HEAD when the report was compiled; `before` = plan-base app build, `after` = 06-01a build) |
| jsx-a11y | 67 warnings (label-has-associated-control 36, click-events-have-key-events 11, no-static-element-interactions 10, no-autofocus 8, heading-has-content 1, interactive-supports-focus 1); 0 errors | `eslint-jsx-a11y.json` |
| tokens.spec without the change | 7/7 fail on the plan-base `app/globals.css` | `tokens-spec-on-plan-base.txt` |

Remaining differences, explained (diff images inspected): `/staff` and other screens with `border-brand-100` panels
(`#d5e6ff` → `#b3d4ff`, `accent-border` collapse); `/queue` "With doctor" label (`text-brand-700` → `accent-fg`
collapse); the rest equal the same-build noise (visit time and id suffix rendered by the server).

## Suite results (local, at `e3f2790`; logs kept in the session scratchpad, not committed)

| Lane | Result |
|---|---|
| `npm run typecheck` | pass |
| `npx eslint .` | 0 errors, 461 warnings (67 of them the new jsx-a11y report rules) |
| `npm run inventory` | exit 0, 0 flagged |
| `npm run ci:ui-policy` | PASS, enforced findings 0, deltas 0 against the baseline |
| `npm run ci:ai-l1`, `scripts/ci/workflow-policy.mjs` | PASS, PASS |
| 06-01a Vitest specs (`tests/design/*`, `tests/ci/ui-policy.spec.ts`, `tests/components/phone-input.spec.ts`) | 5 files, 47 tests pass |
| Full Vitest lane (`npx vitest run`, stack up) | 250 files, 4823 / 4824 tests pass. Two `tests/ops` files first failed only because the git-ignored `.cache/ops-bin/age` is absent in a fresh worktree (copied from the primary checkout's pinned, SHA-checked copy; both then pass, 57 tests). One failure is **pre-existing and outside 06-01a**: `tests/security/review2-fixes-db.spec.ts` "AR2-Info (I2) … database error on update" expects 500 and gets 403; it fails identically on the plan base `745a6b7` (checked in a temporary detached worktree). Cause: V2-05 made API keys refuse clinical content (403 `CLINICAL_ACCESS_DENIED`) before the DB write, and the spec still sends `investigations_advised` to provoke a DB error. Owner V2-05 (wave note). |
| `npm run e2e:build && npm run e2e:pr` | 220 passed, 9 skipped, 0 failed, 0 retried (desktop-chrome, Pixel 7, iPhone 15) |
| Design lane (`neutral-diff.mjs capture`, 4 × 23 screens) | 97 passed per capture (5 setup + 92), three captures, no retries |

## Deviations

1. **The v1 `:root` block was not entirely dead.** Its five `--radius-*` variables override Tailwind's, and every
   `rounded-*` utility reads them. The first after-capture showed it (every card corner changed; 6 screens over 0.5 %,
   max 0.868 %). Fix: the v1 radii (4/6/8/12/16 px) stay in the raw layer; `tokens.spec.ts` pins them. The research's
   "0 references" was a grep for `var(--…)` in app code. 06-01b replaces them with the approved radii.
2. **Three semantic names from the G2-D token file** (`fg-secondary`, `accent-tint`, `accent-border`) are added to the
   plan list so distinct v1 colours do not collapse (e.g. `#4b5563` → `fg-secondary`, `#6b7280` → `fg-muted`, matching
   the approved file's ordering; the plan's example mapped `#4b5563` to `fg-muted`). Names only; 06-01b sets values.
3. **4 arbitrary hex classes remain** (hover/pressed shades without a semantic slot); acceptance said 0. Mapping them
   would have removed the hover/pressed effect. Owners: 06-02a Button, 06-03a chips (wave note).
4. **Capture output in `design-captures/`** (git-ignored) instead of `test-results/design/…`: Playwright empties
   `test-results/` on every run (the `setup` project writes there), which deleted the label file and would delete the
   before set. Run data is normalised in the DOM before each screenshot (run tag, ids, emails, phone digits) instead of
   masked, so text colour changes stay visible to the diff.
5. `tests/e2e/design/support/png-diff.ts` became `scripts/design/png-diff.mjs` (the compare script is plain Node; the
   counting rule is unit-tested in `tests/design/png-diff.spec.ts`).
6. Three `focus-brand-500` tokens in `gp-systemic-review.tsx` were a v1 typo (not a Tailwind utility, rendered nothing):
   removed rather than mapped (value-neutral). The intended focus ring comes with the 06-02a field primitive.
7. `tests/components/phone-input.spec.ts` asserted the class `border-[#B42318]`; it now asserts `border-danger-solid`
   (same intent: the invalid style is applied).

## Open

- 06-01b must define `success-solid`, `warning-solid` (and `info-solid`), which the approved token files do not
  (wave note).
- The UI policy's rule set is the plan's; `raw-palette` also counts `white`/`black` (3530 findings after the codemod).
