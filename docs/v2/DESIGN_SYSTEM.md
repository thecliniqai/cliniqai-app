# clinicOS v2.0 — Design System ("Clinic Paper")

| | |
|---|---|
| Date | 2026-11-10 · specification only, nothing implemented |
| Scope | Workstream B5: tokens, foundations, components, healthcare patterns, accessibility conventions |
| Target stack | Tailwind CSS v4 `@theme` tokens + open-code component layer on accessible headless primitives (see `FRONTEND_TECHNOLOGY_ASSESSMENT.md`) |
| Related | `UX_AUDIT.md` (evidence), `INFORMATION_ARCHITECTURE.md`, `FRONTEND_MIGRATION_PLAN.md` |

Labels: **Fact**, **Problem**, **Risk**, **Assumption (validate)**, **Recommendation** · P0–P3.

---

## 0. Why a new system (evidence)

**Fact.** v1 has no working system:

- the 30 CSS variables in `app/globals.css:25-61` are referenced **0** times;
- colour is expressed as 937 arbitrary hex classes, 193 `brand-*` classes and 3,488 raw Tailwind palette classes;
- there are 10 radius and 12 shadow variants;
- 330 text sizes are 9–11 px;
- Inter is declared but never loaded.

Full counts are in `UX_AUDIT.md` §2.

**Recommendation (P1).** Adopt the system below. **Enforce** it in code, not in a document:

1. Tokens live only in `app/globals.css` (`@theme`).
2. Tailwind's default palette is reset (`--color-*: initial`) at the end of migration, so `text-gray-400` and `bg-[#…]` stop compiling to anything useful.
3. A CI grep fails the build on new `\[#[0-9a-f]` or `text-\[\d+px\]` classes.
4. Components are consumed only from `components/ui` and `components/clinical`.
5. Every primitive has a visual-regression snapshot (see migration plan).

---

## 1. Design principles (clinicOS-specific)

1. **The day is the interface.** Screens are organised around today's patients, not around modules.
2. **Paper, not dashboard.** Flat white working surfaces on a warm paper canvas, separated by hairlines. Cards appear only where an object is movable or independent (queue token, sheet). No metric-tile walls, no gradients, no glass blur.
3. **One accent, many meanings? No.** Teal is the only brand colour, used for primary actions and "with doctor" state. Every other colour is semantic (status or safety) and always paired with an icon or text.
4. **Safety information is never subtle.** Allergies and clinical alerts use the strongest treatment in the system. "Unknown" and "none" are visually distinct.
5. **Numbers are first-class.** Tokens, times, money and vitals use tabular numerals, Indian digit grouping and IST.
6. **Thumb-first, keyboard-fast.** Every primary action is reachable by thumb on a 360 px phone *and* by keyboard on a desktop.
7. **Calm under load.** Peak-hour use means no animation for its own sake, no layout shift, explicit save and sync status, and optimistic feedback.

---

## 2. Colour

### 2.1 Palette (raw tokens)

**Brand: Clinic Teal.** Chosen to read as clinical and trustworthy without looking like a generic SaaS blue (v1 `#1769E0`), and to stay distinct from the blue focus ring and info tone.

| Token | Hex | Use |
|---|---|---|
| `primary-50` | `#E8F4F2` | Selected or hover tint, "with doctor" chip bg |
| `primary-100` | `#CDE8E4` | Subtle borders on tinted areas |
| `primary-200` | `#9FD2CB` | Disabled primary bg (with ink-500 text) |
| `primary-300` | `#6BB8AF` | Illustrative only |
| `primary-400` | `#3A9C93` | Charts |
| `primary-500` | `#16847C` | Charts, large icons |
| `primary-600` | `#0E716B` | **Primary action bg**, links, active nav |
| `primary-700` | `#0B5F5A` | Hover, primary text on tint |
| `primary-800` | `#0A4D49` | Pressed |
| `primary-900` | `#083D3A` | Rare (headings on tint) |

**Neutrals: Ink and Paper** (warm grey, matched to the paper canvas)

| Token | Hex | Use |
|---|---|---|
| `paper` | `#F6F5F1` | App canvas |
| `white` | `#FFFFFF` | Working surfaces, inputs |
| `sunken` | `#EFEDE7` | Table header, read-only fields, lane headers |
| `line-subtle` | `#E7E4DD` | Row dividers |
| `line` | `#D9D6CE` | Panel borders (decorative, not for controls) |
| `line-strong` | `#8A867C` | **Form control borders** (needs ≥3:1) |
| `ink-400` | `#A19D93` | Disabled text only (WCAG-exempt) |
| `ink-450` | `#78746B` | Placeholder |
| `ink-500` | `#6B6860` | Muted or meta text |
| `ink-600` | `#57544D` | Secondary text, icons |
| `ink-700` | `#3D3B36` | Body text on tint |
| `ink-900` | `#1C1B18` | Primary text |

**Semantic hues**

| Family | 50 (bg) | 500 (icon/border) | 600 (solid bg) | 700 (text) |
|---|---|---|---|---|
| success | `#E7F5EC` | `#2F9A62` | `#18794E` | `#166B43` |
| warning | `#FDF3E1` | `#B7791F` | `#9A5B00` | `#8A4B00` |
| danger | `#FDEDEB` | `#D9452F` | `#B42318` | `#B42318` |
| info | `#EAF1FC` | `#3B76D6` | `#1D56B0` | `#1D56B0` |
| violet (billing state only) | `#F1EDFA` | `#7A5CC7` | `#5B3FA8` | `#5B3FA8` |
| slate (booked state only) | `#EEF1F4` | `#6B7785` | `#44505C` | `#44505C` |

**Focus:** `focus` `#1F5FD1`. This is deliberately not teal, so the ring stays visible on teal buttons.

### 2.2 Contrast verification (WCAG 2.2 AA)

Computed with the WCAG relative-luminance formula. The script is in the session scratchpad. Re-verify after any token change.

| Pair | Ratio | Requirement | Result |
|---|---|---|---|
| `ink-900` on `white` | 17.22 | 4.5 | Pass (AAA) |
| `ink-900` on `paper` | 15.79 | 4.5 | Pass (AAA) |
| `ink-600` on `white` | 7.55 | 4.5 | Pass (AAA) |
| `ink-600` on `paper` | 6.92 | 4.5 | Pass |
| `ink-500` on `white` | 5.56 | 4.5 | Pass |
| `ink-500` on `paper` | 5.10 | 4.5 | Pass |
| `ink-500` on `sunken` | 4.75 | 4.5 | Pass |
| `ink-450` (placeholder) on `white` | 4.66 | 4.5 | Pass |
| `white` on `primary-600` (primary button) | 5.84 | 4.5 | Pass |
| `white` on `primary-700` (hover) | 7.50 | 4.5 | Pass (AAA) |
| `primary-600` link on `white` | 5.84 | 4.5 | Pass |
| `primary-600` on `paper` | 5.36 | 4.5 | Pass |
| `primary-700` on `primary-50` (chip) | 6.66 | 4.5 | Pass |
| `success-700` on `success-50` | 5.80 | 4.5 | Pass |
| `warning-700` on `warning-50` | 6.18 | 4.5 | Pass |
| `danger-700` on `danger-50` | 5.79 | 4.5 | Pass |
| `white` on `danger-600` (allergy banner, destructive button) | 6.57 | 4.5 | Pass |
| `info-700` on `info-50` | 6.14 | 4.5 | Pass |
| `violet-700` on `violet-50` | 6.70 | 4.5 | Pass |
| `slate-700` on `slate-50` | 7.27 | 4.5 | Pass |
| `line-strong` (input border) on `white` | 3.63 | 3.0 non-text | Pass |
| `line-strong` on `paper` | 3.33 | 3.0 | Pass |
| `focus` ring on `white` | 5.81 | 3.0 | Pass |
| `focus` ring on `paper` | 5.32 | 3.0 | Pass |
| `warning-500` border on `warning-50` | 3.31 | 3.0 | Pass |
| *v1 reference:* `text-gray-400` (#99A1AF) on white | 2.60 | 4.5 | **Fail** (267 uses) |
| *v1 reference:* `--text-muted` #73777D on #F7F6F3 | 4.17 | 4.5 | **Fail** |
| *v1 reference:* emerald-600 text on white | 3.65 | 4.5 | **Fail** |

Rules:

- `primary-50` vs `white` is 1.13:1. A selected or active row therefore **must** also carry a 3 px `primary-600` left indicator or a check icon (WCAG 1.4.11).
- Status is never conveyed by colour alone. Every chip has a text label, and safety and status chips also have an icon.

### 2.3 Semantic tokens (what components use)

| Semantic token | Maps to | Purpose |
|---|---|---|
| `bg-canvas` | `paper` | App background |
| `bg-surface` | `white` | Panels, rows, inputs |
| `bg-sunken` | `sunken` | Headers, read-only |
| `bg-selected` | `primary-50` | Selected row (+ indicator) |
| `fg-default` | `ink-900` | Primary text |
| `fg-muted` | `ink-600` | Secondary text |
| `fg-subtle` | `ink-500` | Meta text (min 12 px) |
| `fg-placeholder` | `ink-450` | Placeholders |
| `fg-disabled` | `ink-400` | Disabled |
| `fg-on-accent` | `white` | Text on primary or danger solid |
| `border-default` | `line` | Decorative panel borders |
| `border-subtle` | `line-subtle` | Dividers |
| `border-control` | `line-strong` | Inputs, checkboxes, radios |
| `accent` / `accent-hover` / `accent-pressed` | `primary-600/700/800` | Primary action |
| `accent-subtle` / `accent-fg` | `primary-50` / `primary-700` | Tints |
| `ring` | `focus` | Focus indicator |
| `success-*`, `warning-*`, `danger-*`, `info-*` | families above | Feedback |
| `status-booked`, `status-waiting`, `status-with-doctor`, `status-to-bill`, `status-done`, `status-no-show`, `status-cancelled` | §7.5 | Visit state |
| `alert-allergy-bg` / `-fg` | `danger-600` / `white` | Known allergies |
| `scrim` | `rgb(28 27 24 / 0.40)` | Dialog backdrop (no blur) |

### 2.4 Tailwind v4 implementation (target `app/globals.css`)

```css
@import "tailwindcss";

/* Phase M1 keeps Tailwind's default palette for coexistence.
   Phase M5 uncomments the reset so raw palette classes stop working. */
@theme {
  /* --color-*: initial; */

  /* Raw palette */
  --color-white: #ffffff;
  --color-paper: #f6f5f1;
  --color-sunken: #efede7;
  --color-line-subtle: #e7e4dd;
  --color-line: #d9d6ce;
  --color-line-strong: #8a867c;
  --color-ink-400: #a19d93;
  --color-ink-450: #78746b;
  --color-ink-500: #6b6860;
  --color-ink-600: #57544d;
  --color-ink-700: #3d3b36;
  --color-ink-900: #1c1b18;

  --color-primary-50: #e8f4f2;  --color-primary-100: #cde8e4;
  --color-primary-200: #9fd2cb; --color-primary-300: #6bb8af;
  --color-primary-400: #3a9c93; --color-primary-500: #16847c;
  --color-primary-600: #0e716b; --color-primary-700: #0b5f5a;
  --color-primary-800: #0a4d49; --color-primary-900: #083d3a;

  --color-success-50: #e7f5ec; --color-success-500: #2f9a62; --color-success-600: #18794e; --color-success-700: #166b43;
  --color-warning-50: #fdf3e1; --color-warning-500: #b7791f; --color-warning-600: #9a5b00; --color-warning-700: #8a4b00;
  --color-danger-50:  #fdedeb; --color-danger-500:  #d9452f; --color-danger-600:  #b42318; --color-danger-700:  #b42318;
  --color-info-50:    #eaf1fc; --color-info-500:    #3b76d6; --color-info-600:    #1d56b0; --color-info-700:    #1d56b0;
  --color-violet-50:  #f1edfa; --color-violet-500:  #7a5cc7; --color-violet-700:  #5b3fa8;
  --color-slate-50:   #eef1f4; --color-slate-500:   #6b7785; --color-slate-700:   #44505c;
  --color-focus: #1f5fd1;

  /* Typography */
  --font-sans: var(--font-plex-sans), var(--font-plex-deva), "Noto Sans", "Noto Sans Devanagari",
               ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
  --font-mono: var(--font-plex-mono), ui-monospace, "SFMono-Regular", Menlo, monospace;

  --text-caption: 0.75rem;   --text-caption--line-height: 1rem;      /* 12/16 */
  --text-label: 0.8125rem;   --text-label--line-height: 1.125rem;    /* 13/18 */
  --text-body-sm: 0.875rem;  --text-body-sm--line-height: 1.25rem;   /* 14/20 */
  --text-body: 1rem;         --text-body--line-height: 1.5rem;       /* 16/24 */
  --text-title-3: 1.125rem;  --text-title-3--line-height: 1.625rem;  /* 18/26 */
  --text-title-2: 1.25rem;   --text-title-2--line-height: 1.75rem;   /* 20/28 */
  --text-title-1: 1.5rem;    --text-title-1--line-height: 2rem;      /* 24/32 */
  --text-display: 1.875rem;  --text-display--line-height: 2.375rem;  /* 30/38 */
  --text-token: 1.75rem;     --text-token--line-height: 2rem;        /* 28/32 */

  /* Radius */
  --radius-sm: 4px; --radius-md: 6px; --radius-lg: 10px; --radius-xl: 14px;

  /* Elevation */
  --shadow-popover: 0 1px 2px rgb(28 27 24 / 0.06), 0 4px 12px rgb(28 27 24 / 0.08);
  --shadow-overlay: 0 16px 40px rgb(28 27 24 / 0.16), 0 2px 6px rgb(28 27 24 / 0.06);

  /* Motion */
  --ease-out: cubic-bezier(0.2, 0, 0, 1);
  --duration-fast: 120ms; --duration-base: 200ms; --duration-sheet: 240ms;

  /* Breakpoints (Tailwind defaults made explicit) */
  --breakpoint-sm: 40rem; --breakpoint-md: 48rem; --breakpoint-lg: 64rem;
  --breakpoint-xl: 80rem; --breakpoint-2xl: 96rem;
}

/* Semantic aliases: components use ONLY these */
@theme inline {
  --color-canvas: var(--color-paper);
  --color-surface: var(--color-white);
  --color-fg: var(--color-ink-900);
  --color-fg-muted: var(--color-ink-600);
  --color-fg-subtle: var(--color-ink-500);
  --color-fg-placeholder: var(--color-ink-450);
  --color-fg-disabled: var(--color-ink-400);
  --color-border: var(--color-line);
  --color-border-subtle: var(--color-line-subtle);
  --color-border-control: var(--color-line-strong);
  --color-accent: var(--color-primary-600);
  --color-accent-hover: var(--color-primary-700);
  --color-accent-pressed: var(--color-primary-800);
  --color-accent-subtle: var(--color-primary-50);
  --color-accent-fg: var(--color-primary-700);
  --color-ring: var(--color-focus);
}

@layer base {
  html { color-scheme: light; -webkit-text-size-adjust: 100%; }
  body { @apply bg-canvas text-fg font-sans text-body antialiased; }
  :focus-visible { outline: 2px solid var(--color-ring); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; }
  }
}
```

**Light-theme only.** Set `color-scheme: light`. Do not define dark tokens, as instructed in PRD §3.7. **Risk:** some Android browsers apply "force dark" to web content. `color-scheme: light` together with an explicit `<meta name="color-scheme" content="light">` reduces this.

---

## 3. Typography

### 3.1 Family

**Recommendation.** Use **IBM Plex Sans** for UI, **IBM Plex Sans Devanagari** as a fallback for Devanagari, and **IBM Plex Mono** only for API keys and IDs in Integrations. All three are SIL OFL and available through Google Fonts, and should be self-hosted with `next/font/google`.

Why Plex:

- **Disambiguates characters that matter in clinics.** `I l 1` and `O 0` are distinct. This helps patient IDs, receipts and dosages such as "1-0-1" and "10 mg".
- **A designed Devanagari companion** with harmonised metrics, ready for Hindi UI or Hindi patient names (P3) without a mismatched fallback.
- **Tabular figures** for tokens, times, money and vitals.
- **A slightly humanist, non-generic voice**, so the product does not look like every Inter-based dashboard. It still reads as clinical and corporate-trustworthy.
- **Wide range of weights.** We use only 400, 500 and 600.

**Loading.** Use `next/font/google`:

- `IBM_Plex_Sans({ weight: ['400','500','600'], subsets: ['latin','latin-ext'], display: 'swap', variable: '--font-plex-sans' })`.
- `IBM_Plex_Sans_Devanagari({ weight: ['400','500','600'], subsets: ['devanagari'], display: 'swap', variable: '--font-plex-deva', preload: false })`.

The Devanagari face downloads only when Devanagari glyphs render, because of the generated `unicode-range`.

**Assumption (validate).** Confirm that the Latin subset includes **₹ (U+20B9)**. If it does not, the `Noto Sans` fallback in the stack renders it. Verify in the M1 visual check.

**Alternative considered.** Inter + Noto Sans Devanagari: excellent UI legibility, but Inter is the default "AI dashboard" voice and its Devanagari pairing is not metric-harmonised. Noto Sans + Noto Sans Devanagari is the safest coverage but bland. Either is acceptable if Plex fails validation.

### 3.2 Type scale

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `display` | 30/38 | 600 | Auth or onboarding hero only |
| `title-1` | 24/32 | 600 | Page title (one per page) |
| `title-2` | 20/28 | 600 | Sheet or dialog title, patient name in identity header |
| `title-3` | 18/26 | 600 | Section headings, lane titles |
| `body` | 16/24 | 400 | **Default** text, **all form inputs** (prevents iOS zoom) |
| `body-sm` | 14/20 | 400/500 | Dense tables (≥ lg only), secondary lines |
| `label` | 13/18 | 500 | Field labels, chip text, table headers (sentence case) |
| `caption` | 12/16 | 400/500 | Timestamps, meta. **Minimum size in the product.** |
| `token` | 28/32 | 600, tabular | Queue token numerals |

Rules:

- Sentence case everywhere. **No uppercase micro-labels** (v1 has 139).
- Tabular numerals (`tabular-nums`) for tokens, times, money, vitals and counts.
- Never truncate a patient name below 24 characters. Wrap to 2 lines instead.
- No 9/10/11 px text (v1 has 330 instances).
- Line length for reading (notes, letters) is at most 72ch.

---

## 4. Spacing, layout, grid, breakpoints

### 4.1 Spacing

4 px base, using Tailwind's default `--spacing: 0.25rem`. Allowed steps: 0, 1 (4), 2 (8), 3 (12), 4 (16), 5 (20), 6 (24), 8 (32), 10 (40), 12 (48), 16 (64).

| Context | Value |
|---|---|
| Inline gap (icon to text) | 8 |
| Control internal padding | 12 horizontal, 10 vertical (44 px tall) |
| Stack between fields | 16 |
| Between sections | 24 (mobile) / 32 (desktop) |
| Page gutter | 16 (< md) · 24 (md–lg) · 32 (≥ xl) |
| List row vertical padding | 12 (comfortable) · 8 (compact, desktop) |

### 4.2 Breakpoints and layout behaviour

| Name | Min width | Device reference | Shell | Content |
|---|---|---|---|---|
| base | 0 | 360–414 px Android/iPhone | Top bar 56 + bottom bar 64 | 4-col, single column, sheets = bottom drawers |
| `sm` | 640 | Large phones, landscape | Same | 4-col |
| `md` | 768 | Tablet portrait (common doctor tablet) | 64 px icon rail, no bottom bar | 8-col, sheets = right side 480 |
| `lg` | 1024 | Tablet landscape, small laptop | Rail | 12-col, two-pane consult (context collapsible) |
| `xl` | 1280 | Front-desk desktop | 232 px sidebar | 12-col, Today shows 5 lanes |
| `2xl` | 1536 | Large monitor | Sidebar | Max content 1440, centred |

Grid: 4/8/12 columns, gutter 16/24/24, margins per §4.1.

QA widths: **360, 390, 768, 1024, 1280, 1440** (Playwright viewports).

### 4.3 Radius

| Token | px | Use |
|---|---|---|
| `radius-sm` | 4 | Checkbox, inner chips, table row selection |
| `radius-md` | 6 | Buttons, inputs, token chip, menu items |
| `radius-lg` | 10 | Panels, popovers, side sheets |
| `radius-xl` | 14 | Dialogs, bottom-drawer top corners |
| `full` | 9999 | Status chips, avatars, segmented control |

This cuts v1's 10 radius variants to 5.

### 4.4 Elevation

| Level | Token | Use |
|---|---|---|
| 0 | none + 1 px `border` | Everything on the page (panels, rows, lanes) |
| 1 | `shadow-popover` | Menus, popovers, combobox lists, tooltips |
| 2 | `shadow-overlay` + `scrim` | Dialogs, sheets, drawers, command palette |

No shadow on cards in page flow. No `backdrop-blur`: v1 uses it 29 times, and it is expensive on low-end Android GPUs.

### 4.5 Motion

| Interaction | Duration | Easing |
|---|---|---|
| Hover, press | 120 ms | `ease-out` |
| Popover, menu | 200 ms fade + 4 px translate | `ease-out` |
| Sheet or drawer | 240 ms slide | `ease-out` |
| Queue row state change | 600 ms background flash `accent-subtle` → `surface` | linear |

Honour `prefers-reduced-motion`. No skeleton shimmer: use a static `sunken` skeleton.

### 4.6 Iconography

> Update (2026-11-10, PO decisions): Two additions:
> - **PWA icon and theme (PWA_STRATEGY §3.1, PWA-01).** The app icon is a teal tile with the brand glyph (working name "ClinicQ", a "Q" glyph, PO-19), using `--accent` teal. Sizes: 192, 512, maskable 512 with a safe zone, Apple 180 and an SVG favicon. `themeColor` follows the surface token in light and dark. Splash images are not produced (PWA D5). Add safe-area utilities (`env(safe-area-inset-*)`) and `dvh`-based shell heights, and QA widths 744/820/1180 to §4.2.
> - **AI vs Smart Assist labelling (AI_STRATEGY §5.3, AI-02).** Only LLM features may use the word "AI" or the sparkle glyph, as an "AI Assist" chip with its own token. Deterministic helpers (terminology search, Rx favourites, shorthand, patient snapshot, slot suggestions, duplicate detection, allergy check) use a neutral "Smart Assist" glyph or no label, and never the sparkle. A CI copy grep enforces this. LLM output shows as a draft with per-section Accept and source highlighting.

> Update (2026-11-10, PO round 2; roadmap PO-20, PO-21, PO-25):
> - **No AI is sold in v2.0.** There is no "Available with AI Assist" lock or upsell. Plan, billing and pricing surfaces show one **"AI features: Coming soon"** row (muted, no price, no button). During the trial the scribe carries a small **"Preview"** chip next to the AI Assist chip, with the one-line note **"AI features are in preview and not yet offered as a paid product."** No quota meter is shown; only a clear message if the 1,500-draft trial quota runs out. After the trial (PO-25 default) the scribe entry point is not rendered.
> - **Prices are GST-exclusive.** Every price label reads **"₹1,499 + GST"** (en-IN numerals); checkout and debit notices state the total, e.g. "₹1,768.82 per month incl. 18% GST". Never show a bare "₹1,499/month".

- `lucide-react` (keep). 20 px default, 16 px in dense rows, stroke 1.75. Icons inherit `currentColor`.
- **No emoji in UI.** v1 `PhoneInput` uses 🇮🇳 (`components/ui/phone-input.tsx:86`), which renders as "IN" letters on Windows. Use the text "+91" instead.

---

## 5. Content conventions (India)

| Item | Format | Implementation |
|---|---|---|
| Date (display) | `12 Nov 2026`; with weekday `Thu, 12 Nov` | `Intl.DateTimeFormat('en-IN', { day:'numeric', month:'short', year:'numeric', timeZone })` |
| Date (entry) | `dd/mm/yyyy` with calendar popover. Never `mm/dd`. | Custom DateField (segments) + popover |
| Date (URL / API) | `2026-11-12` (ISO date in **clinic** time zone) | `lib/datetime` `todayInClinicTz()`. Replaces 29 UTC `toISOString().split('T')[0]` sites (UX_AUDIT §2). |
| Time | `9:30 am` (12-hour, lowercase, no leading zero) | `en-IN` with `hour:'numeric', minute:'2-digit', hour12:true` |
| Time zone | Clinic setting, default `Asia/Kolkata`. Never the browser's zone for scheduling. | Tenant setting (Workstream C) |
| Relative (queue wait) | `6 min`, `1 h 05 min` | Live-updating every 30 s |
| Age | `42 y`, `8 m` (< 2 y), `12 d` (< 1 m) + sex `M/F/O` → `42 y · M` | `formatAge(dob \| age)` |
| Money (display) | `₹1,25,000`; paise only if non-zero: `₹499.50` | `Intl.NumberFormat('en-IN', { style:'currency', currency:'INR', maximumFractionDigits:2, minimumFractionDigits:0 })` |
| Money (storage) | Integer **paise** | Workstream C to confirm current column types |
| Phone (display) | `+91 98765 43210`; masked `+91 ••••• •3210` on shared screens | `formatPhone`, `maskPhone` |
| Receipt / FY | `CQ/26-27/00123` (FY Apr–Mar) | **Assumption (validate)** against current numbering |
| Temperature | °F default (Indian OPD practice), toggle to °C per clinic | Clinic setting |
| Weights | kg, height cm, BMI auto (1 decimal) | |
| Blood sugar | mg/dL (GRBS / FBS / PPBS) | |
| Rx frequency | `1-0-1` with accessible text "morning 1, afternoon 0, night 1" | `aria-label` |
| Names | No forced capitalisation. Single names allowed. "Baby of …" supported. Search on any token. | |
| Copy voice | Indian English, plain, verb-first buttons ("Add to queue", "Collect ₹700") | `messages/en.ts` |

---

## 6. Component specifications

Each component lists anatomy, variants, sizes, states, behaviour and a11y. Size naming: `sm` = 32 px (desktop-dense only, never touch), `md` = 40 px desktop / **44 px touch** (default), `lg` = 48 px (primary mobile CTA).

### 6.1 Buttons

| Variant | Visual | Use |
|---|---|---|
| `primary` | `accent` bg, white text | One per view region (sheet footer, page header) |
| `secondary` | white bg, `border-control`, `fg` text | Secondary actions |
| `ghost` | transparent, `fg-muted` text, `sunken` hover | Toolbars, row actions |
| `danger` | `danger-600` bg, white text | Destructive confirm in AlertDialog only |
| `danger-ghost` | `danger-700` text | Destructive entries in menus |
| `link` | `accent` text, underline on hover | Inline navigation |

- **States:** default, hover (`accent-hover`), pressed (`accent-pressed`), focus-visible (2 px ring + 2 px offset), disabled (`primary-200` bg + `ink-500` text, `aria-disabled`, not removed from tab order when there is a tooltip reason), loading (spinner replaces the start icon; label stays visible, e.g. "Collecting…"; `aria-busy`).
- **IconButton:** 44 × 44 hit area (visual 36 allowed with padding) and **required `aria-label`**. A tooltip on desktop shows the same text plus the shortcut.
- **Rule:** never nest a `<Button>` inside `<Link>`. Use `asChild` or `buttonVariants()` on the link (fixes 26 v1 instances).
- **Keyboard shortcut hint:** a `<Kbd>` inside the button on ≥ lg only.

### 6.2 Inputs and form components

**Field** (wrapper; required on every control):

- Anatomy: label (`label` token, above the control, always visible), optional "Optional" tag (we mark optional fields, not required ones), control, hint (`caption`, `fg-subtle`), error (`caption`, `danger-700`, icon).
- Wiring: `id`, `aria-describedby` = hint id + error id, `aria-invalid`.
- On submit with errors, focus the first invalid field and show an error summary at the top of long forms.

| Component | Spec |
|---|---|
| `Input` | 44 px, 16 px text, `border-control`, radius-md, padding 12. Focus ring. Invalid → `danger-600` border + error. Optional start or end adornment (icon, unit like "kg", "mmHg"). Set `autoComplete`, `inputMode`, `enterKeyHint` per field. |
| `Textarea` | Auto-grow min 3 rows, max 12, then scroll. Character counter only when a limit exists. |
| `Select` (native) | **Use the styled native `<select>`** for short, non-searchable lists (≤ 15 options: sex, doctor, payment mode). It is best on mobile (OS picker) and accessible by default. |
| `Combobox` | Searchable lists (patient, medicine, ICD, city). `role="combobox"`, listbox with `aria-activedescendant`, ↑/↓/Enter/Esc, typeahead debounce 200 ms, async loading row, "No results — create '…'" row when creation is allowed. Built on Command (cmdk) or Popover. |
| `Checkbox`, `Radio`, `Switch` | 20 px control, 44 px row hit area. Switch only for immediate-effect settings. |
| `SegmentedControl` | `role="radiogroup"`. Payment method, follow-up interval, lane switch on phone. Equal-width segments, 44 px. |
| `ChipGroup` (multi-select) | Toggle chips with `aria-pressed`. Complaints, advice, investigations quick picks. |
| `DateField` | Segmented `dd / mm / yyyy` typing + calendar popover (react-day-picker). Min and max dates. "Today" and "Tomorrow" quick chips in scheduling contexts. |
| `SlotPicker` | Chips grouped Morning / Afternoon / Evening, 44 px, `role="radiogroup"`. Unavailable slots hidden unless "Show full slots". Overbooked selection shows a warning with reason. |
| `PhoneInput` | Keep the v1 behaviour (`components/ui/phone-input.tsx`: 10-digit clean, paste normalisation, E.164 out). Replace the flag emoji with "+91". 16 px text. `autoComplete="tel-national"`. |
| `MoneyInput` | See §7.7 |
| `AgeOrDobInput` | Keep the v1 concept (`components/patients/age-dob-input.tsx`). Age (years, months for infants) **or** DOB, with derived display of the other. |
| `FileDrop` | Real upload only (v1 consult dropzone is a no-op). Progress per file, type and size validation, retry. Camera capture on mobile (`accept="image/*" capture`). |

**Form behaviour**

- Validate on blur, then on change once a field has errored.
- The server is authoritative: zod schemas are shared between client and server action.
- Primary submit is disabled only while submitting. Never disable it because of validation; show the errors instead.
- Unsaved-changes guard on sheets and the consult.
- Idempotency key per submit.

### 6.3 Selects and dropdowns

- `DropdownMenu`: action menus (row `⋯`, user menu). Proper `role="menu"`, roving focus, typeahead, Esc closes and returns focus. Destructive items are last, separated, `danger-700`.
- `Popover`: non-modal anchored content (filters, quick vitals view).
- Max height 320 with scroll. Never wider than viewport − 32.

### 6.4 Dialogs, sheets and drawers

| Component | When | Spec |
|---|---|---|
| `Dialog` | Short focused task (≤ 5 fields), confirmation with content | Centre, width 480 (md) / 640 (lg), radius-xl, `shadow-overlay`, `scrim`. Title required (`aria-labelledby`, unique id). Focus trap, focus restore, Esc closes. |
| `AlertDialog` | Destructive or irreversible confirm | Cannot be dismissed by outside click. Default focus on the **safe** action. Replaces 27 `alert()`/`confirm()`. |
| `Sheet` (side) | Data-entry flows at ≥ md (Book, Walk-in, Collect, Vitals) | Right side, 480 / 640, header (title + context line), scrollable body, **sticky footer** with primary action. Outside click does **not** close when dirty; it prompts "Discard changes?". |
| `Drawer` (bottom) | The same flows at < md | Bottom sheet, full-width, max 92vh, drag handle, snap points 50% / 92%, sticky footer above the safe area. Built from the same content component as the Sheet (responsive `ResponsiveSheet`). |
| `CommandPalette` | Global find and actions | §7.9 |

- **Stacking:** at most 2 layers (sheet + alert dialog). Opening a third replaces content within the sheet (step view).
- **Scroll lock** is reference-counted, unlike v1's `overflow = "unset"`.

### 6.5 Navigation

| Component | Spec |
|---|---|
| `Sidebar` (≥ xl) | 232 px, `surface` bg, right border. Clinic switcher block (name + logo initial), primary items (icon 20 + label), divider, secondary items, "+ New" button, user block at the bottom. Active item: `accent-subtle` bg + 3 px `accent` left bar + `accent-fg` text + `aria-current="page"`. Not collapsible (the rail covers md–lg). |
| `Rail` (md–lg) | 64 px icons, label in a tooltip and as `aria-label`. Same active treatment. |
| `BottomBar` (< md) | 64 px + safe area. 4 destinations + centre "+" (56 px circle, `accent`). Labels always visible (12 px caption, 500). Hidden inside the consult workspace and when the keyboard is open. |
| `TopBar` | 56 px. Page title (phone) or breadcrumb (settings, records), search field (≥ md) or search icon (phone), notifications bell with count badge, avatar menu. Sticky, white, bottom border. |
| `Tabs` (route tabs) | `role="tablist"` when local. **Links with `aria-current`** when route-based (patient sub-pages). Underline 2 px `accent` active. Horizontally scrollable on phone with a fade edge. |
| `Breadcrumb` | Settings and Records only |

### 6.6 Tables and data lists

- **DataTable (≥ lg).**
  - Row height 48 (comfortable default) or 40 (compact toggle).
  - Header: `sunken`, `label` text, sentence case, sticky.
  - Numeric columns right-aligned with tabular numerals.
  - Sort indicator with `aria-sort`.
  - Row actions: one inline primary action plus a `⋯` menu, always visible. Not hover-only, because touch laptops and tablets exist.
  - Whole-row link via the primary cell `<a>`, not `tr onClick`.
  - Server pagination (25/50) with "Showing 1–25 of 1,240". Page and filters in the URL.
- **DataList (< lg).** Each row is a two-line list item: line 1 is name plus status chip, line 2 is meta. Primary action button at right, `⋯` menu. "Load more" button rather than infinite scroll (predictable on slow networks).
- **States:** loading (5 skeleton rows), empty (EmptyState in table body), error (inline Alert with retry), partial (stale banner "Showing data from 10:42 · Retry").

### 6.7 Search and filtering

- `SearchField`: 44 px, search icon, clear button (`aria-label="Clear search"`), Esc clears, 200 ms debounce. `type="search"`, `enterKeyHint="search"`.
- Filters are `FilterChip`s showing the value ("Doctor: Dr Rao ✕") plus "+ Filter" popover. Counts on chips where cheap. "Clear all".
- Every filter and the search query are synced to the URL (`?q=&doctor=`).
- Search requests use `GET` + `AbortController` (route handler), **not** server actions (serialised; see technology assessment).

### 6.8 Notifications and alerts

| Type | Component | Behaviour |
|---|---|---|
| Transient success | `Toast` | Bottom-centre (phone) or bottom-right (desktop). 4 s. Optional **Undo** action (8 s). `role="status"`. |
| Transient error | `Toast` (danger) | Persists until dismissed. Includes a Retry action when possible. `role="alert"`. |
| Contextual | `Alert` (info/success/warning/danger) | Inline in a page or sheet. Title + text + optional action. No drop shadow. |
| Page-level | `Banner` | Full-width under the top bar: offline, reconnecting live updates, subscription expiring, read-only mode |
| Activity | Notification centre (sheet from bell) | Grouped by Today / Earlier. Mark read. Deep links. |
| Live region | `aria-live="polite"` region in Today | Throttled announcements: "Token 14, Ramesh Kumar, checked in" |

### 6.9 Loading and skeleton states

> Update (2026-11-10, PO decisions): v2.0 stores no patient data on the device (PWA_STRATEGY §4). Wherever this document says "saved on this device" or "drafts saved locally", read instead: "Offline · not saved. Reconnect to save", with consult drafts held in memory only and autosaved to the server within 5 s.

- Route `loading.tsx` per route group renders the **shell plus a layout-matching skeleton**. v1 has none.
- Skeleton blocks use static `sunken`, radius matched to the final element, and real header text where it is known (the page title is shown immediately).
- Buttons show inline spinners. **Never** a full-screen spinner after first paint.
- Optimistic UI for queue transitions, chips and Rx line add, with rollback plus an error toast.
- Save status indicator: "Saving…" / "Saved · 10:42" / "Offline · saved on this device" / "Couldn't save · Retry".

### 6.10 Empty states

Anatomy: 24 px lucide icon in `ink-500` (no illustration), title (`title-3`), one sentence (`fg-muted`), one primary action, optional secondary link. Copy is specific to the context:

| Context | Title | Action |
|---|---|---|
| Today, no patients | "No patients yet today" | Add walk-in · Book appointment |
| Search, no results | "No patient matches '9876'" | Register as new patient |
| Patient timeline empty | "No visits yet" | Add to queue |
| Filtered table empty | "Nothing matches these filters" | Clear filters |

### 6.11 Error states

| Level | Pattern |
|---|---|
| Field | Inline below the control, `aria-describedby`, starting with what to do ("Enter a 10-digit mobile number") |
| Form or action | `Alert` at the top of the sheet: what happened + why (if known) + action ("This slot was just booked by someone else. **Pick another slot** or **Book anyway (overbook)**") |
| Permission | "You don't have access to register patients. Ask your clinic admin to update your role." Never a raw thrown string. |
| Route | `error.tsx`: title, short text, **Try again**, **Go to Today**, support reference (request id) |
| Not found | `not-found.tsx`: "This patient record isn't available" (wrong clinic or deleted, without revealing which) |
| Offline | Banner + disabled write actions with tooltip reason. Consult drafts saved locally. |

---

## 7. Healthcare-specific patterns

### 7.1 Patient identity header

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ (RK)  Ramesh Kumar                       ┃14┃ Waiting · 18 min     [Primary][⋯] │
│       42 y · M · ID CQ-0042 · +91 98765 43210 · ABHA ✓                        │
│ ⛔ Allergies: Penicillin, Sulfa     Chronic: T2DM, HTN     ⚑ Pregnant (P3)     │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Placement:** top of the patient profile, consult and bill.
- **Variants:** `full` (profile), `compact` (consult top bar, one line + allergy line), `inline` (list rows, pickers: name · age/sex · masked phone).
- **Content order** (fixed, for scanning): name → age/sex → ID → phone → ABHA → visit context (token, state, wait) → safety line.
- The avatar uses initials on `sunken`, not colour-coded, to avoid implying meaning.
- `title-2` name, never truncated below 24 characters. Long names wrap.
- The header is a `<header>` landmark with an `<h1>` on profile pages.

### 7.2 Allergy and clinical alert banner

| State | Treatment | Copy |
|---|---|---|
| Known allergies | **Solid `danger-600` banner, white text, ⛔ icon**, always visible in consult and Rx. Not dismissible. | "Allergies: Penicillin, Sulfa" |
| No known allergies (recorded) | Neutral chip `sunken` + ✓ | "No known allergies" (with recorded date on hover or tap) |
| Not recorded | `warning-50` bg, `warning-700` text, ⚠ + action | "Allergies not recorded" · **Record now** |
| Drug-level match (Rx) | Inline on the Rx line: danger chip "Matches allergy: Penicillin" + confirm override with reason | Requires backend salt mapping (UX_AUDIT §5.7) |

Other clinical alerts (chronic conditions, pregnancy, high-risk) use `warning` chips with icons. They never use `danger` unless they are safety-critical, to avoid alert fatigue.

### 7.3 Vitals entry and summary

```
┌ Vitals · Ramesh Kumar ┃14┃ ─────────────────────────────── ✕ ┐
│ Blood pressure    [ 150 ] / [ 95 ] mmHg   ⚠ High              │
│ Pulse             [ 88  ] bpm                                 │
│ Temperature       [ 98.6] °F  (°F|°C)                         │
│ SpO₂              [ 98  ] %                                   │
│ Resp. rate        [ 16  ] /min                                │
│ Weight [ 78 ] kg   Height [ 170 ] cm   BMI 27.0               │
│ Blood sugar       [     ] mg/dL  (Random|Fasting|PP)          │
│ Last recorded 12 Oct: BP 142/90 · Wt 79 kg                    │
├───────────────────────────────────────────────────────────────┤
│                                   [ Save vitals ]             │
└───────────────────────────────────────────────────────────────┘
```

- Numeric `inputMode="decimal"`, 16 px, 44 px. Enter moves to the next field. BP uses two inputs with "/" between them.
- Range flags use text plus icon (⚠ High / ⚠ Low), `warning`. Critical values use `danger` (e.g. SpO₂ < 90). Thresholds come from a clinic-configurable table (**Assumption**: default adult ranges, with paediatric ranges by age).
- Implausible values (BP 1500) are hard errors.
- **Summary chip** (queue row, consult context): `♥ BP 150/95 · P 88 · 98.6°F`, at most 3 items, with the full list in a popover. "Vitals pending" is a `warning` outline chip with text, not colour alone.
- One `VitalsForm` and one `VitalsSummary` replace 6 v1 implementations.

### 7.4 Queue token card / token chip

```
Row (desktop lane)                          Display variant (P3 TV caller)
┌──────────────────────────────────┐        ┌────────────────────┐
│ ┃14┃ Ramesh Kumar          18 min│        │   NOW CALLING      │
│      42 y · M · Dr Rao · Walk-in │        │       14           │
│      ♥ BP 150/95  ⛔ Penicillin   │        │   Dr A Rao · Rm 1  │
│      [ Vitals ]            [ ⋯ ] │        └────────────────────┘
└──────────────────────────────────┘
```

- **TokenChip:** min 44 × 36, `token` type (28/32, 600, tabular), `ink-900` on `white`, 2 px border in the status tone, radius-md. Screen reader text "Token 14". Zero-padding is optional (clinic preference).
- **Wait time:** live and relative. `fg-subtle` under 30 min, `warning-700` with clock icon at 30–60 min, `danger-700` above 60 min. Thresholds are a clinic setting.
- **Origin:** "Walk-in" or an appointment time ("Appt 10:15"), as text, not a coloured tag.
- **Row primary action** depends on role and state (`INFORMATION_ARCHITECTURE.md` §3.6).
- The **"Next" row** in doctor mode is pinned with a `accent-subtle` background, a 3 px `accent` bar and the label "Next".
- **Priority marker (P3):** ⚑ "Priority" chip (elderly, emergency) with a reason.

### 7.5 Appointment / visit status chips

One map (`lib/visit-status.ts`) drives every chip, lane and filter. Rounded-full, `label` text, 24 px tall, with an icon.

| Status (DB) | Label | Tone (bg / fg) | Icon (lucide) |
|---|---|---|---|
| `booked` | Booked | slate-50 / slate-700 | `CalendarClock` |
| `confirmed` | Confirmed | slate-50 / slate-700 | `CalendarCheck` |
| `waiting` | Waiting | warning-50 / warning-700 | `Hourglass` |
| `in_consultation` | With doctor | primary-50 / primary-700 | `Stethoscope` |
| derived: completed + balance > 0 | To bill | violet-50 / violet-700 | `IndianRupee` |
| `completed` (paid or no charge) | Done | success-50 / success-700 | `CheckCircle2` |
| `no_show` | No-show | sunken / ink-600 | `UserX` |
| `cancelled` | Cancelled | danger-50 / danger-700 | `XCircle` |
| rescheduled (event) | Rescheduled | info-50 / info-700 | `CalendarSync` |

This replaces 8+ divergent v1 mappings (e.g. `components/ui/badge.tsx:66-84` vs `components/queue/queue-card.tsx:41-75`).

### 7.6 Prescription (Rx) line item

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ 1  Telmisartan 40 mg  Tablet                    1-0-0   After food   30 days  ⋯ │
│    Telmisartan · Brand: Telma 40                ⛔ —    "Take at same time daily" │
└────────────────────────────────────────────────────────────────────────────────┘
```

- **Columns:** index, drug (brand or generic in `body` 500 with strength and form in `body-sm`), generic or salt on line 2 (`fg-muted`), frequency (`1-0-1`, monospace-like tabular, with `aria-label` "morning 1, afternoon 0, night 1"), timing (Before or After food / Empty stomach / SOS), duration ("5 days", "1 week", "Continue"), instructions (line 2), `⋯` (Edit, Duplicate, Remove).
- **Entry row** (keyboard-first): Medicine combobox → Enter → frequency field (digits `1`–`9` pick presets; typing `1-0-1` works) → Tab → timing (segmented) → duration (`5d`, `2w`, `1m` parsed) → Enter adds and refocuses the search.
- **Allergy match** shows a danger chip on the line and requires an explicit "Prescribe anyway" with a reason.
- **Mobile:** each line is a two-line list item. Editing opens a bottom drawer with large chips.
- **Templates and Repeat:** "⚡ Templates" menu, "Repeat last Rx" (from the context pane). Both insert lines that are visibly marked until reviewed.
- **Print:** the same order and wording as on screen. Hindi instruction text is a P3 option.

### 7.7 Money input (₹, en-IN)

- **Anatomy:** a "₹" prefix adornment (not part of the value) and a right-aligned tabular value.
- `type="text"`, `inputMode="decimal"`. Accepts digits and one decimal point with up to 2 decimals. Strips grouping on focus and **formats with en-IN grouping on blur** (`1,25,000`).
- No `type="number"`, which avoids the wheel-scroll and `e` issues of 4 v1 inputs.
- The value is emitted as **integer paise** (`125000.00` → `12500000`). A bounds check (≥ 0, ≤ configurable maximum) runs before submit.
- Totals rows: `title-3` tabular. Negative values (discounts) shown as `−₹50` with a true minus sign (U+2212).
- **Helpers:** `formatINR(paise)`, `parseINR(text) → paise`. These are the only money helpers allowed (replacing 56 literal `₹` concatenations).

### 7.8 Date and time for India

See §5. Components: `DateField`, `TimeText`, `RelativeTime`, `DayStrip` (Today / Tomorrow / weekday chips with dates, horizontally scrollable). All take the clinic time zone from a context provider. **No component may call `new Date().toISOString().split('T')[0]`.** A lint rule enforces this.

### 7.9 Command palette

- **Trigger:** ⌘K / Ctrl+K, the top-bar search field, or the search icon on phone (full-screen).
- **Groups:** Patients, Today's queue, Actions, Navigate, Assist (`INFORMATION_ARCHITECTURE.md` §3.7).
- **Patient row:** `inline` identity (name · age/sex · masked phone · last visit). Enter does the primary action for context (Add to queue on Today, Open elsewhere). `→` reveals secondary actions.
- **Empty query:** shows recent patients (per user, last 10, stored server-side or in `localStorage` as IDs only, **no PII in storage**).
- **Accessibility:** combobox + listbox semantics, `aria-activedescendant`, result count announced.

### 7.10 Print layouts (Rx, receipt)

- An `@media print` stylesheet with A4 and A5 options, clinic letterhead from settings, margins configurable for pre-printed letterhead, and QR to `/r/[token]` (P2).
- Receipt: A5/A4. 80 mm thermal is P3.
- Server PDF (`@react-pdf/renderer`, existing) stays for WhatsApp delivery.

---

## 8. Accessibility conventions (WCAG 2.2 AA baseline)

| Area | Convention |
|---|---|
| Contrast | Tokens in §2.2 only. Text ≥ 4.5:1, UI boundaries and icons ≥ 3:1. |
| Focus | `:focus-visible` 2 px `ring` + 2 px offset on every interactive element. Never `outline: none` without a replacement. Focus is not obscured by sticky bars (WCAG 2.4.11): add `scroll-padding` for the top and bottom bars. |
| Targets | 44 × 44 minimum on touch (exceeds WCAG 2.5.8's 24 px). Spacing between adjacent targets ≥ 8 px. |
| Keyboard | Every action is reachable by keyboard. Global map: `⌘K` palette, `W` walk-in, `B` book, `N` new patient, `C` collect (Today only, when focus is not in a field), `Alt+1…7` consult sections, `?` shows the shortcut sheet. |
| Overlays | Focus trap, restore, Esc, `aria-modal`, unique labelled titles. No auto-close on outside click when dirty. |
| Forms | Visible labels (no placeholder-as-label), `aria-describedby` hints and errors, error summary, `autoComplete` tokens, never time out a form without warning. |
| Semantics | Landmarks (`header`, `nav`, `main`, `aside`). One `h1` per page. Real `<a>` for navigation and `<button>` for actions. No `div onClick` (v1 has 10). |
| Live updates | Today board announces changes politely and throttled (at most 1 per 5 s, batched). Errors use `role="alert"`. |
| Colour independence | Status, safety and range flags always carry text and an icon. |
| Motion | `prefers-reduced-motion` honoured. No parallax or auto-playing animation. |
| Language | `<html lang="en-IN">`. Content in other scripts gets `lang` on the element (e.g. `lang="hi"` for Hindi instructions). |
| Zoom and reflow | Works at 200% zoom and 320 px width without horizontal scroll, except data tables, which switch to DataList. |
| Testing | axe-core in Playwright for every route (0 serious or critical violations), keyboard-only e2e for the 6 critical flows, manual screen-reader smoke tests (TalkBack on Android Chrome, NVDA on Windows) per release. |

---

## 9. Component inventory (target) and v1 mapping

| Layer | Component | Replaces (v1) |
|---|---|---|
| ui | Button, IconButton, Kbd | `components/ui/button.tsx` + 254 raw `<button>` |
| ui | Input, Textarea, Field, Label | `components/ui/input.tsx`, `field.tsx`, 62 raw inputs, 13 raw textareas |
| ui | NativeSelect, Combobox, Checkbox, RadioGroup, Switch, SegmentedControl, ChipGroup | `components/ui/select.tsx` + 28 raw selects, ad-hoc toggle buttons |
| ui | DateField, Calendar, DayStrip | 14 `type="date"`, 5 `type="time"` |
| ui | Dialog, AlertDialog, Sheet, Drawer, ResponsiveSheet, Popover, Tooltip, DropdownMenu, Command | `components/ui/modal.tsx`, `dropdown.tsx`, 23 bespoke overlays, 27 `alert`/`confirm` |
| ui | Tabs, Sidebar, Rail, BottomBar, TopBar, Breadcrumb | `components/layout/*`, `components/dashboard/nav.tsx` (dead) |
| ui | DataTable, DataList, Pagination, SearchField, FilterChip | `components/ui/table.tsx` + 7 raw tables |
| ui | Toast, Alert, Banner, Skeleton, EmptyState, Spinner | `components/ui/alert.tsx`, `empty-state.tsx` |
| clinical | PatientIdentityHeader, PatientPicker, QuickRegisterForm | 5 search UIs, 5 registration UIs |
| clinical | AllergyBanner, ClinicalAlertChip | Consult and Rx allergy banners |
| clinical | VitalsForm, VitalsSummary | 6 vitals implementations |
| clinical | TokenChip, QueueRow, Lane, StatusChip | `queue-card.tsx`, `my-queue-card.tsx`, 8+ status maps |
| clinical | SlotPicker, BookingSheet | `booking-drawer.tsx`, `doctor-timeline.tsx` slot cells |
| clinical | RxLineItem, RxEntryRow, RxTemplatesMenu | `prescription-builder.tsx` (926 lines) |
| clinical | MoneyInput, InvoiceLines, CollectPaymentSheet, ReceiptSuccess | `checkout-drawer.tsx` (1,029), `sign-and-bill-modal.tsx` (651), `receipt-modal.tsx` |
| clinical | ShareButton (WhatsApp / print) | 5 bespoke WhatsApp button implementations |
| clinical | SaveStatus | Consult autosave indicator |

---

## 10. Governance

- **Single source of truth:** `app/globals.css` tokens, `components/ui` primitives and `components/clinical` patterns.
- **Living reference:** an internal `/dev/ui` gallery route, enabled only in development and preview (not production), that renders every component state. Playwright screenshot and axe tests run against it. This avoids adding Storybook (see the technology assessment for that trade-off).
- **Change process:** token or component changes need a PR with gallery screenshots (desktop + 360 px) and an updated contrast table.
- **Lint and CI guards (P1):**
  - no arbitrary colour or px font classes;
  - no `alert(`/`confirm(`;
  - no `toISOString().split`;
  - no `<Link>` containing `<Button>`;
  - `eslint-plugin-jsx-a11y` recommended rules;
  - no imports of `@ai-sdk/*` outside lazily loaded modules.

**Assumption (validate).** These guards are cheap grep- or ESLint-based. Tailwind-class linting for v4 depends on plugin support at implementation time. A simple CI `grep` script is the fallback.
