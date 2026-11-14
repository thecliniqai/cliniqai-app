# 06-02a record: form primitives, input kinds (PWA-07) and the `/dev/ui` gallery

Plan: `06-PLAN.md` § 06-02a (Wave 5, after G2-D). Under the speed ruling this is UI work: one independent review
afterwards, and Lows only if cheap. Branch `v2/phase-06-design-system-pwa-shell`, plan base `b9463be`. Design contract:
`06-UI-SPEC.md` (`508416d`; CTO defaults CD-01…CD-37 binding). Visual reference: V2-DX `3a78a5d`
(`006-components/`, `shared/sketch.css`, `v2-dx-evidence/screens/components/{360,1280}.png`). Every number below is
tool output: a file in `evidence/06-02a/` or the command named in the row. Builds and e2e ran in private detached
worktrees (cloned `node_modules`) under the shared e2e lane lock with an owner file. The local stack was not reset or
stopped.

## What changed

| Area | Change | Files |
|---|---|---|
| Dependency | `radix-ui` **1.8.1** exact (the plan's pin, published 2026-10-12), installed with `--before=2026-10-13 --ignore-scripts`. The lock was rewritten by `scripts/ci/lock-linux-check.sh --fix` (PASS). There are 73 new entries; no existing package changes version (the removed lock lines are re-hoisting, checked by a version diff). The legitimacy record `plans."06-02a"` reports 0 problems, and `npm audit signatures` verifies 985 signatures. | `package.json`, `package-lock.json`, `evidence/package-legitimacy.json` |
| `cn()` | `tailwind-merge` is taught the project's scales (`text`, `spacing`, `shadow`, `radius: pill`, `tracking`). Before, it read `text-body-sm`/`text-label`/`text-caption` as text colours and dropped them next to `text-fg` (the gallery's buttons rendered at the inherited 16 px). It also kept both of two conflicting `min-h-*` sizes. A test keeps the list equal to the tokens in `globals.css`. | `lib/utils.ts`, `tests/ui/cn.spec.ts` |
| Structure tokens | Two additions to `app/globals.css`. (1) The `touch` custom variant, `(pointer: coarse), (max-width: 1023px)` (CD-04), in block form: the one-line form split the media list at its comma and dropped the `max-width` half, as the built CSS showed. (2) The `focus-ring` / `focus-ring-inset` utilities (the UI-SPEC focus treatment: 2 px `ring` outline, 2 px offset, 2 px white halo). No value changed. | `app/globals.css` |
| Variant maps | Typed records, no CVA. Button, IconButton, Kbd, the text controls, choice rows, Switch, SegmentedControl and ChipGroup (chip / tile / option) all use semantic or component tokens. Hover applies only while interactive. Colour transitions are 120 ms and exclude `outline-color`, because `transition-colors` faded the ring in from white (the keyboard spec caught it). | `lib/ui/variants.ts`, `lib/ui/ids.ts` |
| Primitives | **Button**: 7 variants; sizes 28/36/44 on a fine pointer, 44 on touch; `loading` keeps width and name (`aria-busy`); `requiresNetwork` defaults on for `type="submit"`. Offline it is `aria-disabled`, still focusable, described by the offline reason, and does not act. v1 props are kept, and `outline` reads as `soft`. **IconButton** takes a required `label`. **Kbd** is hidden on touch. **Label** and **Field**: the field gives its control `id`, `aria-describedby` (hint, then error) and `aria-invalid` through context; the v1 `required` asterisk and the error id `<htmlFor>-error` are kept. **Input**: `kind`, icons, unit adornments (the whole box is the target), read-only (CD-27). **Textarea**: 3 to 12 rows via `field-sizing`, with a counter only when there is a limit. **NativeSelect**, with v1 `Select` as an adapter. **Checkbox**, **RadioGroup** and **Switch** use Radix, and the label row is the target. **SegmentedControl** uses Radix RadioGroup. **ChipGroup** uses Radix ToggleGroup: multiple gives `aria-pressed` in a named group; single gives `radiogroup`/`aria-checked` and cannot be cleared. | `components/ui/{button,icon-button,kbd,label,field,input,textarea,native-select,select,checkbox,radio-group,switch,segmented-control,chip-group}.tsx` |
| Input kinds (PWA-07) | The 10 kinds of PWA §3.5 map to `type`, `inputMode`, `autoComplete`, `enterKeyHint` and `autoCapitalize` (plus `maxLength` 6 for pincode); explicit props win. Numeric-like kinds are never `type="number"`. `otp` sets no length (the reset code has 8 digits). | `lib/ui/input-kind.ts` |
| Gallery (R-26) | `/dev/ui` sits outside every route group. It returns `notFound()` in production, or when the env fails its schema (fail closed). It needs a session (proxy default deny) and uses `Asia/Kolkata`. Every state of every primitive is shown: default, hover, pressed, focus, disabled, loading, error, read-only, empty, selected, indeterminate, offline. Also shown: the Brand row (mark at 16/24/32/36/56; title, price and token number in Manrope next to Inter body text) and an offline submit demo. Synthetic copy only. Later plans add a section file plus one line in `page.tsx`, using `kit.tsx`. | `app/dev/ui/{layout,page,kit}.tsx`, `app/dev/ui/sections/{forms,ai}.tsx`, `lib/dev/gallery.ts` |
| AI section | Renders the 06-01b chips (AI Assist + Preview, the note, Coming soon, Smart Assist) with no price copy. The file is in `LLM_FEATURE_FILES`; `npm run ci:ai-l1` PASS (without the entry its heading fails L1-R5). | `app/dev/ui/sections/ai.tsx`, `scripts/ci/ai-l1-greps.mjs` |
| Contrast | 20 new gated or informational pairs for the primitives (component tokens). The report was regenerated by the tool: **204 pairs, 0 fail**. | `lib/design/contrast-pairs.ts`, `evidence/06-01b/contrast.md` |
| Flake fix (orchestrator item) | Root cause and fix of the one-off `a11y/v2-01-screens` "change-password form at 1280px" contrast failure: see "Flaky-test root cause" below. | `tests/e2e/support/settle.ts`, `tests/e2e/a11y/{v2-01,turnstile,reset}-screens.spec.ts`, `tests/e2e/design/gallery-axe.spec.ts` |

## Commits

| Commit | What |
|---|---|
| `08a81cd` | `radix-ui` 1.8.1 exact pin, Linux lock, legitimacy record |
| `2746fb1` | `cn()` knows the theme scales (+ `tests/ui/cn.spec.ts`) |
| `22b29bf` | Tracer (step 1): `/dev/ui` + Button + `touch` variant + focus-ring utilities, `gallery-axe.spec`, `keyboard/forms.spec` (Button) |
| `aa57a58` | Flake root cause: axe scans wait for running transitions (`settle.ts`) |
| `e5ba15f` | Steps 2-5: every other primitive, input kinds, the forms and AI gallery sections, keyboard and input-mode specs, contrast pairs |
| `20b5e94` | PWA spec 4 complete: offline write buttons on the walk-in drawer and the patient form |
| (this commit) | Record, evidence, wave notes |

## Acceptance (plan § 06-02a "Tests that fail without the change", "UI checks", "Acceptance mapping")

| Criterion | Result | Proof |
|---|---|---|
| `keyboard/forms.spec.ts` (desktop-chrome, real browser, R-14): per primitive, Tab order, Enter/Space, arrow keys with wrap in RadioGroup/SegmentedControl/ChipGroup, Space toggles Checkbox/Switch with `aria-checked`, disabled skipped, ring visible (outline ≥ 2 px in the `ring` token, positive offset) | Met: 9 tests (Button, IconButton, Input + Field, Textarea + NativeSelect, Checkbox, RadioGroup, Switch, SegmentedControl, ChipGroup chip/tile/option). The ring colour is resolved from `globals.css`, not typed, and the white halo is asserted too. The adorned input's ring is on its box. Field wiring is asserted: label names the control, `aria-describedby` reads the hint/error text, `aria-invalid` clears once the value is fixed. Before the change: no `/dev/ui`, and v1 Button set `outline: none` and drew a box-shadow ring, so the outline assertions fail. | PR lane result below; `evidence/06-02a/e2e-pr.txt` |
| `input-modes.spec.ts` (PWA-07): every numeric-like kind has `inputMode` and `enterKeyHint`; every input ≥ 16 px and ≥ 44 px under touch | Met. Under the touch condition (pixel-7, design-360, design-820), every input is ≥ 16 px / ≥ 44 px, and every forms-section control is ≥ 44 px (choice rows, option pills and icon buttons ≥ 44 wide too). On a fine pointer at ≥ 1024 px (desktop-chrome, design-1180, design-1280), inputs are exactly 36 px / 14 px (approved), the default button 36 px, and nothing is below 24 px (WCAG 2.5.8). | PR lane (desktop-chrome, pixel-7) and design lane: 4/4 widths green (`evidence/06-02a/design-lane.txt`) |
| `gallery-axe.spec.ts`: axe 0 serious/critical on `/dev/ui` at 360/820/1180/1280 | Met: 0 serious/critical at all four widths, no horizontal scroll. Signed out, `/dev/ui` redirects to `/login`. | `evidence/06-02a/gallery-axe.json` (the spec's own output) |
| `input-kind.spec.ts` (unit): the kind → attributes table; `gallery.spec.ts`: `galleryEnabled` false only for `production` | Met: 7 + 2 tests. `<Input kind>` is rendered with react-dom/server, and an explicit prop wins over the kind. An unknown tier enables nothing. | Vitest |
| `04-offline.spec.ts` (spec 4 complete): offline, the submit buttons of the walk-in drawer and the patient form are disabled with the offline reason; online again, enabled | Met on desktop-chrome and pixel-7: `aria-disabled="true"`, still focusable, accessible description = the reason. Enter, Space, a click and an implicit submission (Enter in a field) submit nothing (a submit-event counter stays 0). Online again: enabled, no description. Before: the buttons stayed enabled and submitted. | PR lane |
| M0 e2e green with the adapters (v1 call sites unchanged; typecheck proves the props) | Met: no v1 call site was edited; `npm run typecheck` clean; the M0 specs are green in the PR lane. | PR lane |
| FMP M2 bundle check: `/forgot-password` first-load JS delta < 15 kB gz | Met: **+10,776 B gz (10.52 kB)**, `b9463be` → `20b5e94`. No route newly over budget except the new dev-only `/dev/ui` (route-JS is report-only). | `evidence/06-02a/bundle-delta.json` |
| UI checks: gallery at 360/820/1180/1280, axe | Met: full-page captures and axe JSON per width in `design-captures/06-02a/` (git-ignored; PNGs are not committed except the 06-08 G3 set). Checked by eye at 360 and 1280 against `v2-dx-evidence/screens/components/{360,1280}.png`. | `design-captures/06-02a/gallery-{360,820,1180,1280}.png` |
| Acceptance mapping: "axe 0 serious/critical on the gallery" (2a part); "unit tests for primitives' keyboard and focus behaviour" (R-14); PWA-07; spec 4 complete | Met (rows above) | |

## Flaky-test root cause (orchestrator item, 2026-11-14)

`a11y/v2-01-screens.spec.ts` "change-password form at 1280px" failed once in 06-09a's first PR run (axe
`color-contrast` on `.text-body-sm`) and passed in the next run with no retry.

**Cause.** The cause is 06-02a's Button (`22b29bf`), not the `cn()` change. The form renders its submit button
`disabled={!hydrated}`. Hydration starts the Button's 120 ms colour fade from the disabled look to CliniQ Blue, but the
spec's settle guard waited only for `opacity === "1"`, which matched v1's opacity fade. A loaded worker could therefore
scan a frame mid-fade.

**Proof.** With animations slowed 50× through CDP, the instrumented probe shows the button enabled while its
`background-color` and `color` transitions still run. Scanned mid-fade, axe reports the same failure:
`color-contrast` on `.text-body-sm`, 3.68:1 (`#edeef1` on `#3b7ad3`). With the new guard, the probe is clean. Serially
the race did not reproduce (20/20 before the fix).

**Fix (`aa57a58`).** `settleAnimations(page)` waits until no finite animation or transition runs (spinners and pulses
are ignored). It runs before every axe scan in `v2-01-screens`, `turnstile-screens`, `reset-screens` and
`gallery-axe`. The product keeps the approved fade.

**Repeats.** After the fix, `--repeat-each=30 --retries=0` on desktop-chrome with parallel workers: **30/30 green**
(35 passed incl. setup, 0 failed, 0 flaky). Full account: `evidence/06-02a/flake-change-password.md` and
`flake-change-password-runs.txt`.

## Suite results (local)

| Check | Result |
|---|---|
| `npm run typecheck` | Clean (app + tests) |
| `npx eslint .` | 0 errors. 06-02a's files add no warning; the warnings in `components/ui/{card,dropdown}.tsx` are pre-existing v1 code (06-02b rebuilds the dropdown) |
| `npm run inventory` | 0 flagged (`/dev/ui` is a page with no server action) |
| `node scripts/ci/ui-policy.mjs` | PASS. Enforced rules: 0 findings. Report-mode findings only fall: `arbitrary-color` 4 → 2, `raw-palette` 3530 → 3504 |
| `npm run ci:ai-l1` | PASS |
| `node scripts/design/contrast.mjs` | 204 pairs, 0 fail (`evidence/06-01b/contrast.md`, regenerated) |
| Vitest, targeted (`tests/design tests/ui tests/components tests/ci/ai-l1-greps.spec.ts`) | All pass (input-kind 7, gallery 2, cn 4, contrast 209, approved-tokens 248 …) |
| Vitest, full lane (`npx vitest run`, build `20b5e94`, shared stack) | **5621 passed, 6 failed** of 5627 (273 files). The same 6 fail on the plan base `b9463be` (`evidence/06-02a/vitest.txt`): `guard-routes` and `guard-canary` (`app/sw.js/route.ts#GET` has no guard-manifest entry, from 06-09a), `invoice-totals-db` and `drill-lib-db` (stack ahead of the branch), `hosted-dump-diff` ×2 (known, 06-05 record). None is in an 06-02a file or touches one |
| `npm run e2e:pr -- --retries=0` (build `20b5e94`, private worktree, lane lock) | **333 passed, 0 failed, 0 flaky, 64 skipped, 0 retried**: desktop-chrome 216, pixel-7 95 (+64 skipped by design), iphone-15 17, setup 5 (`evidence/06-02a/e2e-pr.txt`, from the JSON reporter). Includes M0, every 06-02a spec, and the flake spec file at all widths |
| Design lane `input-modes.spec` at 360/820/1180/1280 | 4/4 passed (`evidence/06-02a/design-lane.txt`) |
| Flake spec, `--repeat-each=30 --retries=0` | 30/30 passed after the fix (`evidence/06-02a/flake-change-password-runs.txt`) |
| Bundle | `/forgot-password` +10.52 kB gz (< 15 kB) (`evidence/06-02a/bundle-delta.json`) |
| Lockfile | `scripts/ci/lock-linux-check.sh --fix`: PASS. Legitimacy record: 0 problems. `npm audit signatures`: 985 verified |
| gitleaks | See `evidence/06-02a/gitleaks.txt` |

## Deviations

1. **Files outside 06-02a's order-table row**, each one required by the UI-SPEC, a bug, or the orchestrator:
   - `app/globals.css`: the `touch` variant (UI-SPEC CD-04 names 06-02a) and the focus-ring utilities. Structure
     only; `approved-tokens.spec` stays 244/244.
   - `lib/utils.ts`: the `cn()` fix (Rule 1 bug).
   - `scripts/ci/ai-l1-greps.mjs`: one `LLM_FEATURE_FILES` entry (plan step 5).
   - `lib/design/contrast-pairs.ts` and the 06-01b contrast report (UI-SPEC: "any new token pair is added … in the
     same commit"; the report is tool output).
   - The three a11y specs and `tests/e2e/support/settle.ts` (the flake item).
2. **Two approved looks adjusted for contrast** (tokens unchanged, tool-measured):
   - The soft button's hover text: accent-fg on accent-border is 3.39:1, so it darkens to `accent-hover` (4.54:1).
   - The white 14 % fill behind a Kbd on a primary button is not drawn. With it, the 11 px Kbd text measured about
     4:1 (axe `color-contrast`, serious, at 1180 and 1280); white on the blue alone is 5.16:1. The white 35 % border
     stays.
3. **Choice rows are 24 px on a fine pointer** (Checkbox, Radio, Switch). The approved rows were 20 px, under WCAG
   2.5.8's 24 px. Touch keeps 44 px.
4. **Danger hover** uses `danger-solid` at 90 % (no hover token exists for it; v1 used two hex values, now gone:
   `arbitrary-color` findings 4 → 2).
5. **Offline Button uses `aria-disabled`, not `disabled`**, so it stays focusable and reachable with its reason
   (UI-SPEC "Dis … stays focusable when a reason … exists"). Playwright's `toBeDisabled()` honours it.
6. **The tracer's `<main tabIndex={-1}>` was removed**: clicking inside it moved focus to `main`. The skip link and its
   target belong to 06-04b's shell.
7. **Arrow keys in the keyboard spec are held for 50 ms.** Radix moves roving focus in a `setTimeout`, and its
   RadioGroup selects on that focus only while the arrow key is down. A 0 ms synthetic press releases first; a person's
   press lasts tens of ms. Documented in the spec (`rove()`).

## Open (owner)

- **`app/sw.js/route.ts#GET` has no `tests/security/guard-manifest.ts` entry** (06-09a's build-stamped `/sw.js`,
  `5cde926`): `guard-routes.spec` and `guard-canary.spec` fail on the plan base and on 06-02a's head alike. Owner:
  orchestrator / 06-09a fixer (`guard-manifest.ts` is a hot file of 06-04a/06-06/06-04b).
- Vitest cases that fail on the plan base too (stack ahead of the branch; recorded, nothing changed):
  `billing/invoice-totals-db` (charge add refused), `ops/drill-lib-db` `drill_authz_matrix` (`patients` insert
  denied for admin/doctor of A), and `ci/hosted-dump-diff` ×2 (as in the 06-05 record). Re-run after the 05b
  merge-in.
- Tooltip on IconButton (label + shortcut) arrives with 06-02b's Tooltip.
- `scripts/ci/ui-policy-baseline.json` is not refreshed (06-08 owns it). `arbitrary-color` 4 → 2 and `raw-palette`
  3530 → 3504: only decreases.
