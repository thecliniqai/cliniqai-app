# 06-01b record: approved CliniQ AI values, local Inter + Manrope, AI-02 labels, brand mark, icon set, manifest name

Plan: `06-PLAN.md` § 06-01b (Wave 4, first Wave B plan; UI: one independent review, no re-check round unless a High).
Branch `v2/phase-06-design-system-pwa-shell`, worktree execution after 06-05 (plan base `ef24000`). Approved design
input: V2-DX `v2/phase-dx-design-exploration` at `3a78a5d` (G2-D addendum of 2026-11-14 in
`docs/v2/VERIFICATION_LOG.md`, with the CTO rulings on theme colour, favicon, Inter licence and product-name scope).
Every number below comes from a tool output in `evidence/06-01b/` (file named per row) or from the command named in
the row.

## Preconditions (asserted before step 1)

| Check | Result |
|---|---|
| 1. G2-D record names `3a78a5d` (G2-D row, CliniQ AI ruling, addendum) | Met: `docs/v2/VERIFICATION_LOG.md` "G2-D addendum: approved state is the CliniQ AI brand theme at `3a78a5d` (2026-11-14)" |
| 2. `git cat-file -e 3a78a5d` | Met (object present; the V2-DX branch was never checked out or merged; files read with `git show`) |
| 3. Every path of the revision-note table hashes to its SHA-256 | Met, 11/11 (`evidence/06-01b/sha256.txt`, second block) |
| 4. `06-UI-SPEC.md` exists | **Not met** (no UI-SPEC in the phase folder). The orchestrator's brief stated the Wave B precondition as met; 06-01b's content comes from the approved files, so the plan was executed and this is raised for the orchestrator (wave note, Open item 1) |

## What changed

| Area | Change | Files |
|---|---|---|
| Tokens (step 2, K-3) | The v1 raw layer is replaced by the approved raw palette under the approved names (`white`, `mineral-*` slate, `primary-*` CliniQ Blue, `teal-*` Care Teal incl. `teal-550` `#11998D`, `brass-*`, `success\|warning\|danger\|info-50/600`, `focus`, `focus-halo`). Every semantic points at it (Booked violets and the scrim stay literal, as in the brand file), including AI-02 (`ai-bg/fg/border/glyph`, `smart-fg`, `preview-*`), per-status hues and borders, and the extra approved names. `success-solid`, `warning-solid`, `info-solid` are kept for the codemodded sites (06-01a wave note; not in the approved files; 600 steps). Structure: Inter and Manrope stacks with the generated fallback faces, round-3 type scale, display weights on `title-1/2`, `display`, `token` (the prototype `.title-1`… rules as type-scale entries), weights, tracking, radii 6/10/14/20 + pill, Midnight-tinted shadows, motion, sizes. Component tokens and PWA colours in `@theme static`. Light only (`html { color-scheme: light }`); `font-feature-settings: "cv11", "ss01"` on `body`. v1 `shadow-theme-*` kept (used by 90 v1 sites). | `app/globals.css` |
| Approved-values test | Parses the two verbatim evidence copies in cascade order, resolves `var()` chains, and compares each of the **244** approved custom properties with the same name in `globals.css` by resolved value (font stacks ignore the generated "… Fallback" faces). Also: both copies hash to the revision note; the token mirror equals the approved PWA colours. `evidence/06-01b/token-comparison.json`: 0 missing, 0 differing, 12 app-only names. | `tests/design/approved-tokens.spec.ts`, `scripts/design/contrast.mjs` (parser), `evidence/06-01b/{clinic-paper,cliniq-ai}.approved.css` |
| 06-01a token spec | Narrowed for the approved layers: semantics reference the raw layer or an approved literal colour; `@theme static` is the component layer; no `--color-v1-*` and no `--color-brand-*` left; the v1-radii case is replaced (the approved radii are compared by the approved-values test). | `tests/design/tokens.spec.ts` |
| Token mirror | `themeColor`, `backgroundColor`, `iconTile` read `--pwa-theme-color`, `--pwa-background-color`, `--pwa-icon-tile` (all `#ffffff`); `iconGlyph` removed (the masters carry the brand colours). | `lib/design/tokens.ts` |
| Fonts (step 3, R-4, R-43) | The four woff2 subsets and `Manrope-OFL.txt` copied from `3a78a5d` with `git show` (SHA-256 checked); `Inter-OFL.txt` is rsms/inter's own `LICENSE.txt` at tag `v4.1` (CTO ruling). `fonts.ts`: one `localFont()` per subset, fixed `font-family` ("Inter"/"Manrope") so the two subsets form one family, the approved `unicode-range` verbatim, weights `100 900` / `200 800`, `display: swap`, `adjustFontFallback: "Arial"`, Latin preloaded, Latin Extended on demand. The four `variable` classes are on `<html>`. Built CSS (`763673f`): four faces named Inter/Manrope with the approved ranges, fallback faces "Inter Fallback"/"Manrope Fallback", two `<link rel="preload">`. | `app/fonts/*`, `app/fonts/fonts.ts`, `app/fonts/PROVENANCE.md`, `app/layout.tsx` |
| Brand name, manifest, titles (step 4, R-41) | `PRODUCT_NAME = "CliniQ AI"` (exact case, the string the L1 checker masks). Manifest `name`/`short_name` from it, colours from the mirror (`#ffffff`). Root metadata: title `{ default: "CliniQ AI", template: "%s · CliniQ AI" }`, `appleWebApp.title`, `viewport.themeColor` `#ffffff`. `/offline`: 56 px decorative brand mark, "CliniQ AI" in `font-display`, tab "Offline · CliniQ AI". Product-name strings outside V2-06's surfaces untouched (owner phases per the addendum). | `lib/design/brand.ts`, `app/manifest.ts`, `app/layout.tsx`, `app/offline/page.tsx` |
| Brand mark (step 5) | Inline SVG, geometry of `shared/proto.js` `mark()` at `3a78a5d` as data (`MARK_GEOMETRY.full/small`); small mark below 32 px; `role="img"` + `aria-label="CliniQ AI"` or `aria-hidden` when `decorative`; gradient id from `useId()`; brand colours literal in this one file (no UI-policy rule reports them). Server- and client-safe. | `components/brand/brand-mark.tsx` |
| Icon set (step 5, R-24, R-42) | Masters verbatim from `3a78a5d`: `scripts/design/brand/icon.svg` (white tile) and `scripts/design/brand/icon-maskable.svg`. `app/icon.svg` (the SVG favicon) is the brand kit's small-mark `03-favicon/favicon.svg`, verbatim (CTO ruling "small mark below 32 px"; see Deviation 1). `render-icons.mjs`: 192/512 "any" (transparent rounded corners) and Apple 180 (corners filled with `iconTile`, opaque) from the white-tile master, maskable 512 from the maskable master; a PNG decoder checks the four corner pixels of each output; approved SHA-256 of both masters and the favicon are constants; `public/icons.json` records masters, favicon (with sources) and outputs. | `scripts/design/render-icons.mjs`, `scripts/design/brand/*.svg`, `app/icon.svg`, `app/apple-icon.png`, `public/icon-*.png`, `public/icons.json` |
| AI-02 labels (step 6) | `AiAssistChip` (Sparkles + "AI Assist" on the AI tokens), `AiPreviewChip` + `AiPreviewNote` ("AI features are in preview and not yet offered as a paid product."), `AiComingSoonRow` ("AI features: Coming soon", muted, no price, no button), `SmartAssistLabel` (Zap + "Smart Assist", `smart-fg`). Each file has no price copy and is in `LLM_FEATURE_FILES`. The scribe modal header uses the AI Assist and Preview chips and the note instead of its hand-made sparkle tile; when the scribe renders is unchanged. | `components/clinical/*.tsx`, `components/consultation/ai-scribe-modal.tsx`, `scripts/ci/ai-l1-greps.mjs` |
| Contrast (step 7) | `contrast.mjs` measures WCAG 2.2 ratios from `globals.css` for the pairs in `contrast-pairs.ts` and writes the report: the 169 gated V2-DX pairs at `3a78a5d` (each at its approved ratio) plus text on canvas/surface/sunken/selected, status borders on canvas, white on every solid fill, Midnight on the slate surfaces, the focus ring on canvas/surfaces/halo, control borders, chips, banners, alerts. **184 pairs, 184 pass.** | `scripts/design/contrast.mjs`, `lib/design/contrast-pairs.ts`, `evidence/06-01b/contrast.md` |

## Commits

| Commit | What |
|---|---|
| `273d5f9` | Tracer: evidence copies (SHA-256 checked), parser, `accent` → CliniQ Blue, `approved-tokens.spec` on `--color-accent` (before: `#1769e0`) |
| `4c5c8e6` | Brand mark, icon masters, kit favicon, renderer with corner checks, `lib/design/brand.ts`, mirror `iconTile` |
| `feaa56d` | All approved token values; mirror `#ffffff` ×3; `approved-tokens.spec` over all 244 names; `tokens.spec` narrowed |
| `c37f0d0` | Local Inter + Manrope (`next/font/local`), provenance, root layout fonts and titles, `fonts.spec.ts` |
| `ea65dec` | Manifest name and colours, branded `/offline`, `01-manifest.spec` extended, `offline-brand-axe.spec.ts` |
| `577d717` | AI-02 labels, scribe header, L1 file list, fixtures and spec cases, `ai-labels.spec.ts` |
| `763673f` | Contrast pairs, spec and tool report |
| (this commit) | Record, evidence, wave notes |

## Acceptance (plan § 06-01b "Tests that fail without the change", "UI checks", "Acceptance mapping")

| Criterion | Result | Proof |
|---|---|---|
| `approved-tokens.spec`: every custom property of the merged approved set exists in `globals.css` with the same resolved value; both evidence copies hash to the revision note; the mirror is `#FFFFFF` ×3 | Met: 244/244 names equal, 0 missing; 12 app-only names (3 `*-solid`, 5 display-weight entries, 4 v1 `shadow-theme-*`). Before (plan base `ef24000`, same comparison): 158 names missing, 77 different, 9 equal; the tracer's `--color-accent` was `#1769e0` | `tests/design/approved-tokens.spec.ts`; `evidence/06-01b/token-comparison.json`; `evidence/06-01b/sha256.txt` |
| `contrast.spec`: listed text pairs ≥ 4.5:1, non-text ≥ 3:1; focus ring ≥ 3:1 on canvas and surface (3.99:1), 1.29:1 on CliniQ Blue so it sits on the white halo; v1 `fg-subtle` failed on white | Met: 184 pairs, 184 pass; every one of the 169 gated V2-DX pairs present at its approved ratio (±0.05); With-doctor border 3.29:1 on its wash | `tests/design/contrast.spec.ts`; `evidence/06-01b/contrast.md` (tool output) |
| `brand-mark.spec` (react-dom/server, no jsdom): 24 px small geometry (no earpieces), 36 px full; distinct gradient ids per instance, each ring names its own; name "CliniQ AI" or `aria-hidden` when decorative; full geometry equals the approved master | Met (5 cases). Before: no component | `tests/design/brand-mark.spec.ts` |
| `render-icons.mjs --check`: sizes 192, 512, 512 maskable, 180; master hashes equal `public/icons.json` and the revision note; Apple icon corners opaque | Met (`check PASS`); corners checked on all four PNGs (any: transparent; maskable and Apple: opaque `#ffffff`). Before (the 06-05 icons): 9 problems, incl. Apple and maskable corners `#1769e0` | `evidence/06-01b/render-icons-check.txt`; `tests/pwa/icons.spec.ts` (also: favicon = small mark, element for element) |
| `01-manifest.spec` (spec 1): name and short name "CliniQ AI", theme and background `#FFFFFF`; signed-out `/offline` shows "CliniQ AI", `<title>` "Offline · CliniQ AI"; root title and Apple title | Met on desktop-chrome and pixel-7 (4/4 each). Before: "ClinicQ", background `#f7f6f3` | `tests/e2e/pwa/01-manifest.spec.ts`; `evidence/06-01b/e2e-pr.json` |
| `fonts.spec` (desktop-chrome): Inter loaded and first in the body's computed family on `/login`; ≤ 2 font files, all `/_next/static/media/` on loopback, no Plex or Devanagari; ₹ loads the Inter face covering U+20B9; `/offline` name in Manrope from a loaded face | Met (4/4). Also asserted: the four served faces carry exactly the approved `unicode-range` values. Before: no `@font-face`, system font | `tests/e2e/design/fonts.spec.ts`; `evidence/06-01b/e2e-pr.json` |
| `ai-l1-greps.spec`: chip files pass L1-R4/R5; Coming soon row + "₹1,499 + GST" fails L1-R6; "AI Assist" outside the allowed files fails L1-R5 | Met. The chip-file cases copy the real files into a scan root: at their own paths they pass; moved to `components/other/` they fail L1-R4 and L1-R5 (the allowance is the file list). Repository: `ai-l1: PASS` | `tests/ci/ai-l1-greps.spec.ts`; `lint-fixtures/ai-l1/{r6-coming-soon-price,r5-ai-assist-elsewhere}/`; `evidence/06-01b/ai-l1.txt` |
| e2e: the doctor opening the seeded consult and the scribe sees "AI Assist", "Preview" and the note | **Deviation 3**: the shipped consult screen has no control that opens the scribe (`setIsAiScribeOpen(true)` is never called since 05.3-03), and the plan keeps "when the scribe renders" unchanged; the open scribe is rendered in Vitest instead | `tests/design/ai-labels.spec.ts` (header shows "Clinical Scribe — Shorthand", AI Assist, Preview and the note; no price) |
| `e2e:baseline` axe: `color-contrast` nodes on the M0 routes drop from 233 (desktop); 0 remaining nodes on a semantic-token class | Met: desktop `color-contrast` nodes 233 (M0) → 182 (plan base) → **6**; all 6 on raw Tailwind classes (`text-slate-400` ×2 on `/billing/register` and `/billing/reports`: V2-10; `text-gray-500` on `bg-gray-100` ×2 on `/staff`, `text-emerald-600`/`text-amber-600` on `/visits`: V2-11); 0 on a semantic class. Serious/critical nodes 259 → 83 (the rest are v1 `label` 67, `select-name` 9, `target-size` 1, unchanged). Run: the M0 axe spec (`m0-axe-desktop-chrome`) on the plan-base and tip builds, with a private node-detail probe (not committed) | `evidence/06-01b/axe-color-contrast.json` |
| UI checks: M0 routes at 360/820/1180/1280 with `neutral-diff.mjs compare` (report mode; change expected); `/offline` with the brand mark at the four widths; axe on `/offline` | Met: 96 screens compared, all changed as intended (Login 6.3 %/8.5 %, Today 44.6 %/35.0 %, Patients 51.2 %/59.0 %, Consult 32.0 %/30.0 % of pixels at 1280/360); `/offline` at 360/820/1180/1280: 0 axe violations, no horizontal scroll, 56 px full mark. Before/after captures of Login, Today, Patients and Consult at the four widths plus 360/1280 contact sheets in git-ignored `design-captures/06-01b/` (no PNG committed: the G3 set is 06-08's) | `evidence/06-01b/neutral-diff-report.json`; `evidence/06-01b/axe-offline.json` |
| Acceptance mapping: P1-28 M1 tokens and fonts with the approved values; AI-02 tokens, glyphs, Preview chip and note, Coming soon, CI grep; PO-19 as superseded: name "CliniQ AI", mark, icon set, theme and background `#FFFFFF` | Met by the rows above | — |

## Suite results (local)

Builds and runs used private detached worktrees with their own `.next` (never the shared worktree's), e2e only under
the lane lock. "Tip" = `a79297c` (the 06-01b commits plus the 06-09a fixes committed meanwhile).

| Lane | Result |
|---|---|
| `npm run typecheck` | pass (tip, clean worktree). In the shared worktree it fails only on an untracked reviewer probe `playwright/adv-probe/adv.spec.ts`, not 06-01b's |
| `npx eslint .` | 0 errors (no warning in a 06-01b file) |
| `npm run inventory` | exit 0, 0 flagged |
| `npm run ci:ui-policy` | PASS; enforced rules 0; `raw-palette` 3530 → 3525 (the scribe header's hand-made classes left), every other count at its baseline (`evidence/06-01b/ui-policy.txt`) |
| `npm run ci:ai-l1` | PASS, incl. the four chip files (`evidence/06-01b/ai-l1.txt`) |
| `node scripts/design/render-icons.mjs --check` | PASS (`evidence/06-01b/render-icons-check.txt`) |
| `node scripts/design/contrast.mjs` | 184 pairs, 0 fail (`evidence/06-01b/contrast.md`) |
| 06-01b Vitest specs | `tests/design/*` (6 files incl. 244 approved-token and 184 contrast cases), `tests/pwa/icons.spec.ts`, `tests/ci/ai-l1-greps.spec.ts`: 9 files, 499 tests pass |
| Full Vitest lane (`npx vitest run`, `763673f`, shared stack) | 267 files, 5462 / 5466 tests pass. The 4 failures fail identically on the plan base `ef24000` on the same stack (`hosted-dump-diff` ×2, `drill-lib-db` authz matrix, `invoice-totals-db` M-INVOICE: the stack carries V2-05 migrations ahead of this branch; recorded, not changed, as in 06-05). Two files first failed with "age is not installed" (the private worktree lacked the git-ignored `.cache/ops-bin/age`); with it copied they pass. The run's teardown printed "checking tenant ages failed: URI too long" (shared stack, many tenants; no 06-01b code involved). `evidence/06-01b/vitest.txt` |
| `npm run e2e:build && npm run e2e:pr` (tip) | 304 passed, 46 skipped, **7 failed**, 0 flaky, 0 retried. Every 06-01b test passed (24 rows, `evidence/06-01b/e2e-pr.json`). The 7 are not 06-01b's: 2 desktop route-state loading specs (the intermittent 06-04a flake the debugger is on; 25/25 pass when re-run, with and without 06-01b) and 5 iPhone-15 sign-out specs of 06-09a (`1777942`) that land on `/login` under the PWA fixture and record the Turnstile redirect URLs on WebKit; with the 06-01b commits reverted on the same tip 4 of them fail identically, the fifth (IND L-6) fails the same assertion with 06-01b (timing exposure of the same cause). `evidence/06-01b/e2e-attribution.txt` |
| M0 axe (`m0-axe-desktop-chrome`, plan base and tip) | `color-contrast` 182 → 6 nodes, all on raw palette classes (`evidence/06-01b/axe-color-contrast.json`) |
| Design captures (`neutral-diff.mjs capture`, plan base and tip, 4 widths) | 101 + 101 passed; compare: 96 screens changed (report mode, `evidence/06-01b/neutral-diff-report.json`) |
| gitleaks (docker `zricethezav/gitleaks:v8.30.1`, whole history, main `.git` mounted read-only for the worktree) | no leaks found |

## Deviations

1. **Favicon (CTO ruling over plan step 5 and R-42).** The plan copies the white-tile `icon.svg` to `app/icon.svg` as
   both SVG favicon and PNG master. The G2-D addendum's ruling is "the small mark below 32 px; the white-tile icon for
   app icons", which is the plan's Open item 3 alternative ("the kit favicon; one vendored file with its provenance").
   So: `app/icon.svg` = the brand kit's `03-favicon/favicon.svg`, verbatim (SHA-256 `83acd5ae…`, recorded in
   `public/icons.json` and `evidence/06-01b/sha256.txt`; its paths equal `MARK_GEOMETRY.small`, asserted in
   `icons.spec.ts`), and the white-tile master moves next to the maskable one in `scripts/design/brand/icon.svg`
   (verbatim). This is the only file taken from the kit. Known limit (plan Open item 3): transparent, Midnight strokes
   are weak on dark browser tabs.
2. **Inter licence (CTO ruling over plan step 3 and Open item 5).** `app/fonts/Inter-OFL.txt` is rsms/inter's own
   `LICENSE.txt` (tag `v4.1`, fetched once on 2026-11-14 with `curl`; the same bytes as `master` that day; SHA-256
   `262481e8…`), not the `@fontsource` copy at `3a78a5d`. It differs from that copy in the first line (the Inter
   Project Authors copyright instead of "Google Inc."), one blank line and the heading "PERMISSION AND CONDITIONS". This
   is a licence text, not a font or image; nothing else was downloaded.
3. **Scribe e2e replaced by a render test.** See the acceptance table: there is no way to open the scribe in the
   shipped consult screen, and wiring an opener would change when it renders (entitlement gating is V2-12). The /dev/ui
   gallery (06-02a) shows the chips in a browser.
4. **Precondition 4 (`06-UI-SPEC.md`) not met** (see Preconditions). Executed on the orchestrator's instruction; the
   UI-SPEC is needed before 06-02a.
5. **Fallback-face names depend on the export identifiers.** Turbopack (Next 16.4.6) names the `adjustFontFallback`
   face after the exported constant, not the `font-family` declaration, so the exports are named `Inter`,
   `InterLatinExt`, `Manrope`, `ManropeLatinExt` and the stacks list "Inter Fallback" / "Manrope Fallback" (checked on
   the built CSS). The `@font-face` family stays the fixed declaration, as the plan intends.
6. **Display weights as type-scale entries.** The plan names "`--text-title-1--font-weight` and similar entries";
   added: `title-1`, `display`, `token` 800, `title-2` 700, `token` letter-spacing −0.02em. They are the 5 app-only
   type entries in `token-comparison.json`.
7. **Kept beyond the approved set:** `success-solid`, `warning-solid`, `info-solid` (06-01a sites) and the v1
   `shadow-theme-*` (90 v1 sites) — both retire when the screens are rebuilt.
8. **Added beyond the plan's test list:** `tests/design/ai-labels.spec.ts`, `tests/e2e/design/offline-brand-axe.spec.ts`
   (the `/offline` UI check as a test), the plan-base comparison in `token-comparison.json`.

## Open (owner)

1. `06-UI-SPEC.md` (`/gsd-ui-phase 06`) before 06-02a: **orchestrator**.
2. `raw-palette` UI-policy rule: extend `RAW_V1` to the approved raw names: **06-08** or backlog (wave note).
3. Product-name strings outside V2-06 surfaces (emails, WhatsApp templates, PDFs, OpenAPI title, webhook headers, v1
   login panel, token page footer): owner phases per the G2-D addendum; unchanged here.
4. Favicon on dark browser tabs (transparent kit favicon): accepted by the CTO ruling; PO can switch back to the
   white-tile icon with one file (R-42).
5. 06-P5 (PO confirms the fonts, the icon masters, the kit favicon and the rsms licence file): **PO**, after wave 7.
6. Independent review of 06-01b (UI: one reviewer, plus the G3 design reviewer): **orchestrator**.

