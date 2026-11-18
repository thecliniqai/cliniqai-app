#!/usr/bin/env node
/**
 * Token parsing and WCAG 2.2 contrast from the CSS the app ships (V2-06 plan 06-01b steps 1, 2 and 7).
 *
 * Library (used by tests/design/{approved-tokens,contrast}.spec.ts):
 *   - `approvedTokens(baseCss, brandCss)`: the merged approved set of V2-DX `3a78a5d`. Custom properties of the `:root`
 *     blocks of `clinic-paper.css`, then `cliniq-ai.css` on top (the cascade the sketches render).
 *   - `appTokens(globalsCss)`: the custom properties of every `@theme` block of app/globals.css (`@theme`,
 *     `@theme inline`, `@theme static`).
 *   - `resolve(map, name)`: the value with every `var(--x)` replaced by x's resolved value (chains of any depth;
 *     a cycle or an undefined name throws). `normalise()` makes two spellings of one value compare equal.
 *   - `contrastRatio(a, b)`: WCAG 2.2 relative-luminance ratio of two colours (`#rgb[a]`, `#rrggbb[aa]`, `rgb()`).
 *
 * CLI: `node scripts/design/contrast.mjs [--out <file.md>]` computes every pair of lib/design/contrast-pairs.ts from
 * app/globals.css, prints a table and writes it (default: the 06-01b evidence folder). Exit 1 when a pair is under its
 * minimum, 2 when a token in a pair does not resolve to a colour.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..");

export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function declarationsOf(body) {
  const out = new Map();
  for (const m of body.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim().replace(/\s+/g, " "));
  return out;
}

/** Custom properties of the blocks whose prelude matches `prelude` (blocks without nested braces). */
export function blockProperties(css, prelude) {
  const out = new Map();
  const re = /([^{}]*)\{([^{}]*)\}/g;
  for (const m of stripComments(css).matchAll(re)) {
    // The prelude is the text since the previous block; an earlier statement (`@import "tailwindcss";`) ends at ";".
    if (!prelude.test(m[1].split(";").pop().trim())) continue;
    for (const [k, v] of declarationsOf(m[2])) out.set(k, v);
  }
  return out;
}

const ROOT_BLOCK = /^:root$/;
const THEME_BLOCK = /^@theme(\s+(inline|static))*$/;

/** The merged approved set: base `:root` properties, then the brand file's on top. */
export function approvedTokens(baseCss, brandCss) {
  const merged = new Map(blockProperties(baseCss, ROOT_BLOCK));
  for (const [k, v] of blockProperties(brandCss, ROOT_BLOCK)) merged.set(k, v);
  return merged;
}

/** Every custom property of app/globals.css's `@theme` blocks (a later block wins, as in Tailwind). */
export function appTokens(globalsCss) {
  return blockProperties(globalsCss, THEME_BLOCK);
}

/** The value of `name` with every var() resolved. Throws on an undefined name or a cycle. */
export function resolve(map, name, seen = []) {
  if (seen.includes(name)) throw new Error(`var() cycle: ${[...seen, name].join(" -> ")}`);
  const value = map.get(name);
  if (value === undefined) throw new Error(`${[...seen, name].join(" -> ")} is not defined`);
  return value.replace(/var\((--[a-zA-Z0-9-]+)\)/g, (_m, ref) => resolve(map, ref, [...seen, name]));
}

/**
 * One spelling per value: lowercase hex, single spaces, double quotes, no space after commas. In a font stack, the
 * `next/font` metric-matched fallback faces ("Inter Fallback", "Manrope Fallback") are dropped: they are inserted by
 * 06-01b step 3 and are not part of the approved stack.
 */
export function normalise(value) {
  let v = value.trim().replace(/\s+/g, " ").replace(/'/g, '"').replace(/\s*,\s*/g, ",");
  v = v.replace(/#[0-9a-fA-F]{3,8}\b/g, (h) => h.toLowerCase());
  v = v
    .split(",")
    .filter((part) => !/^"[^"]+ Fallback"$/.test(part))
    .join(",");
  return v;
}

/** sRGB colour from `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb(r g b [/ a])` or `rgb(r, g, b)`. */
export function parseColor(value) {
  const v = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (m) {
    let hex = m[1];
    if (hex.length <= 4) hex = [...hex].map((c) => c + c).join("");
    const n = (i) => parseInt(hex.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[/,]\s*([\d.]+%?))?\s*\)$/.exec(v);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  return null;
}

function channel(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance({ r, g, b }) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.2 contrast ratio. Both colours must be opaque (a translucent colour has no ratio on its own). */
export function contrastRatio(a, b) {
  const ca = typeof a === "string" ? parseColor(a) : a;
  const cb = typeof b === "string" ? parseColor(b) : b;
  if (!ca || !cb) throw new Error(`not a colour: ${!ca ? a : b}`);
  if (ca.a !== 1 || cb.a !== 1) throw new Error(`translucent colour in a contrast pair: ${ca.a !== 1 ? a : b}`);
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every pair of `pairs` measured against the app's tokens. */
export function measurePairs(tokens, pairs) {
  return pairs.map((p) => {
    const fg = resolve(tokens, p.fg);
    const bg = resolve(tokens, p.bg);
    const ratio = contrastRatio(fg, bg);
    return { ...p, fgValue: fg, bgValue: bg, ratio, pass: ratio + 1e-9 >= p.min };
  });
}

async function main() {
  const outArg = process.argv.indexOf("--out");
  const out = outArg > -1 ? resolvePath(process.argv[outArg + 1]) : join(REPO, ".planning/phases/06-design-system-pwa-shell/evidence/06-01b/contrast.md");
  const { CONTRAST_PAIRS } = await import(pathToFileURL(join(REPO, "lib/design/contrast-pairs.ts")).href);
  const tokens = appTokens(readFileSync(join(REPO, "app/globals.css"), "utf8"));
  let results;
  try {
    results = measurePairs(tokens, CONTRAST_PAIRS);
  } catch (e) {
    console.error(`contrast: ${e.message}`);
    return 2;
  }
  const failed = results.filter((r) => !r.pass);
  const rows = results.map(
    (r) =>
      `| ${r.group} | \`${r.fg.replace(/^--color-/, "")}\` ${r.fgValue} | \`${r.bg.replace(/^--color-/, "")}\` ${r.bgValue} | ${r.ratio.toFixed(2)}:1 | ${r.min}:1 | ${r.pass ? "pass" : "**FAIL**"} |${r.note ? ` ${r.note}` : ""}`,
  );
  const md = [
    "# 06-01b contrast report (tool output)",
    "",
    `Generated by \`node scripts/design/contrast.mjs\` from \`app/globals.css\` and \`lib/design/contrast-pairs.ts\`.`,
    "WCAG 2.2 relative luminance; minimum 4.5:1 for text, 3:1 for large text and non-text (borders, focus ring).",
    "",
    `**${results.length} pairs, ${results.length - failed.length} pass, ${failed.length} fail.**`,
    "",
    "The focus ring (`ring`) is drawn outside the control on the 2 px white `ring-halo`: it is measured against canvas,",
    "surface and the halo, never against the accent fill it surrounds (`ring` on `accent` is listed for the record only).",
    "",
    "| Group | Foreground | Background | Ratio | Minimum | Result | Note |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
  writeFileSync(out, md);
  for (const f of failed) console.error(`contrast: FAIL ${f.fg} on ${f.bg} ${f.ratio.toFixed(2)}:1 < ${f.min}:1`);
  console.log(`contrast: ${results.length} pairs, ${failed.length} fail; wrote ${relative(REPO, out)}`);
  return failed.length ? 1 : 0;
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
