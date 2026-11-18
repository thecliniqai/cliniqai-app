import localFont from "next/font/local";

/**
 * The app's typefaces, served from this folder (V2-06 06-01b step 3; rulings R-4, R-43; provenance in PROVENANCE.md).
 * Inter (body and UI) and Manrope (titles, display text, prices, token numbers), each as two variable subsets: Latin
 * and Latin Extended. The build needs no network.
 *
 * One `localFont()` call per subset file, because `next/font/local` applies `declarations` to every face of a call and
 * has no per-file `unicode-range`:
 * - `font-family` is fixed ("Inter", "Manrope"), so the two subsets of a family form one family, as in the approved
 *   `@font-face` rules; `--font-sans`/`--font-display` in app/globals.css name these families;
 * - `unicode-range` is copied verbatim from the approved rules (Inter: `clinic-paper.css`; Manrope: `cliniq-ai.css`,
 *   V2-DX `3a78a5d`), so the browser downloads a subset only when the page draws one of its characters;
 * - the Latin files are preloaded, the Latin Extended ones load on demand (₹ U+20B9 is in Inter's Latin Extended file
 *   and Manrope's Latin file, K-12);
 * - `adjustFontFallback` generates a metric-matched Arial face named after the export ("Inter Fallback",
 *   "Manrope Fallback"; the stacks in app/globals.css list them), so the swap barely shifts layout.
 * Each export's `variable` class is applied on `<html>` (app/layout.tsx) so the font CSS is always part of the page.
 */

// next/font compiles each call at build time and accepts only literal options, so the ranges are written out per call
// (tests/e2e/design/fonts.spec.ts checks the served faces against the approved @font-face rules).
export const Inter = localFont({
  src: "./Inter-latin-wght.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: true,
  adjustFontFallback: "Arial",
  variable: "--font-face-inter-latin",
  declarations: [
    { prop: "font-family", value: "'Inter'" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

export const InterLatinExt = localFont({
  src: "./Inter-latin-ext-wght.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: "Arial",
  variable: "--font-face-inter-latin-ext",
  declarations: [
    { prop: "font-family", value: "'Inter'" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
});

export const Manrope = localFont({
  src: "./Manrope-latin-wght.woff2",
  weight: "200 800",
  style: "normal",
  display: "swap",
  preload: true,
  adjustFontFallback: "Arial",
  variable: "--font-face-manrope-latin",
  declarations: [
    { prop: "font-family", value: "'Manrope'" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20B9, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

export const ManropeLatinExt = localFont({
  src: "./Manrope-latin-ext-wght.woff2",
  weight: "200 800",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: "Arial",
  variable: "--font-face-manrope-latin-ext",
  declarations: [
    { prop: "font-family", value: "'Manrope'" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
});

/** The four `variable` classes, for `<html className>`. */
export const fontClassNames = [Inter.variable, InterLatinExt.variable, Manrope.variable, ManropeLatinExt.variable].join(" ");
