#!/usr/bin/env node
/**
 * V2-DX evidence capture (throw-away sandbox; never part of app/).
 *
 *   node .planning/sketches/v2-dx-capture.mjs
 *
 * Uses only already-installed packages (@playwright/test, @axe-core/playwright, @tailwindcss/postcss, postcss).
 * Loads the prototypes from file:// and ABORTS every non-file request (the count is reported; target 0).
 * Writes everything into .planning/sketches/v2-dx-evidence/ — every number in the README is produced here.
 */
import { chromium, webkit, devices } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const OUT = path.join(HERE, "v2-dx-evidence");
const M0_COUNTS = path.join(REPO, ".planning/phases/02-ci-e2e-foundations/evidence/m0-baseline/counts.json");
const WIDTHS = [360, 744, 820, 1180, 1280];
const HEIGHT = { 360: 780, 390: 844, 744: 1133, 820: 1180, 1180: 820, 1280: 800 };
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/* surface id → [file, query, widths, fullPage] */
const SURFACES = [
  ["palette", "001-palette-type/index.html", "", WIDTHS, true],
  ["icon", "002-icon/index.html", "", WIDTHS, true],
  ["today", "003-today/index.html", "", WIDTHS, false],
  ["today-lanes-variant", "003-today/index.html", "?layout=lanes", [820, 1180], false],
  ["today-doctor", "003-today/index.html", "?mode=doctor", [360, 820, 1280], false],
  ["consult", "004-consult/index.html", "", WIDTHS, false],
  ["consult-rx", "004-consult/index.html", "?demo=rx&tab=rx", WIDTHS, false],
  ["install", "005-surfaces/install.html", "", WIDTHS, true],
  ["offline", "005-surfaces/offline.html", "", WIDTHS, false],
  ["signup-trial", "005-surfaces/signup-trial.html", "", WIDTHS, true],
  ["settings-billing", "005-surfaces/settings-billing.html", "", WIDTHS, true],
  ["locked", "005-surfaces/locked.html", "", WIDTHS, true],
  ["locked-staff", "005-surfaces/locked-staff.html", "", WIDTHS, false],
  ["platform", "005-surfaces/platform.html", "", WIDTHS, true],
  ["ai-labels", "005-surfaces/ai-labels.html", "", WIDTHS, true],
  ["price", "005-surfaces/price.html", "", WIDTHS, true],
];

let blocked = 0;
const blockedUrls = new Set();
const pageErrors = [];
function url(file, q) {
  return pathToFileURL(path.join(HERE, file)).href + (q || "");
}
async function guard(page) {
  await page.route(/^(?!file:)/, (route) => {
    blocked += 1;
    blockedUrls.add(route.request().url());
    return route.abort();
  });
  page.on("pageerror", (e) => pageErrors.push(e.message));
}
function mkdir(p) {
  fs.mkdirSync(p, { recursive: true });
}
function write(rel, data) {
  const f = path.join(OUT, rel);
  mkdir(path.dirname(f));
  fs.writeFileSync(f, data);
}

/* ------------------------------------------------------------------ contrast */
function parseTokens(css) {
  const map = {};
  const body = css.slice(css.indexOf(":root"));
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) map[m[1]] = m[2].trim();
  return map;
}
function resolve(map, name, seen = new Set()) {
  if (seen.has(name)) throw new Error("cycle at " + name);
  seen.add(name);
  const v = map[name];
  if (v === undefined) throw new Error("unknown token " + name);
  const ref = /^var\((--[a-z0-9-]+)\)$/i.exec(v);
  return ref ? resolve(map, ref[1], seen) : v;
}
function hexToRgb(h) {
  const x = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
}
function lum(hex) {
  const c = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function contrastReport() {
  const css = fs.readFileSync(path.join(HERE, "themes/clinic-paper.css"), "utf8");
  const map = parseTokens(css);
  const names = Object.keys(map);
  const hex = (n) => resolve(map, "--color-" + n);
  const pairs = [];
  const add = (fg, bg, min, kind, note = "") => pairs.push({ fg, bg, min, kind, note });
  // 1. Every semantic *-fg / *-bg family pair (status, feedback, safety, preview, ai)
  for (const n of names) {
    const m = /^--color-(.+)-bg$/.exec(n);
    if (m && map["--color-" + m[1] + "-fg"]) add(m[1] + "-fg", m[1] + "-bg", 4.5, "text");
    if (m && map["--color-" + m[1] + "-border"]) add(m[1] + "-border", m[1] + "-bg", 3, "non-text", "chip/alert outline");
  }
  // 2. Core text tokens on every working background
  add("fg-placeholder", "surface", 4.5, "text", "placeholders only appear inside inputs (input-bg = surface)");
  const texts = ["fg", "fg-body-tint", "fg-muted", "fg-subtle", "accent", "accent-fg", "danger-fg", "warning-fg", "success-fg", "info-fg", "smart-fg"];
  for (const t of texts) for (const b of ["canvas", "surface", "sunken", "selected"]) add(t, b, 4.5, "text");
  // 3. Text on solid fills
  for (const b of ["accent", "accent-hover", "accent-pressed", "danger-solid", "alert-allergy-bg"]) add("fg-on-accent", b, 4.5, "text", "button / banner label");
  add("surface", "fg", 4.5, "text", "toast (inverted)");
  // 4. Non-text: control borders, token-chip status borders, wait time
  for (const b of ["surface", "canvas", "sunken"]) add("border-control", b, 3, "non-text", "input/checkbox boundary");
  for (const s of ["booked", "waiting", "with-doctor", "to-bill", "done", "no-show", "cancelled"]) add("status-" + s + "-border", "surface", 3, "non-text", "token chip border");
  add("accent", "accent-subtle", 3, "non-text", "selected-row 3 px indicator");
  // 5. Focus: the ring is drawn on a surface halo, so ring-vs-halo is the binding pair; others informational
  add("ring", "ring-halo", 3, "non-text", "BINDING: ring on its halo (any fill)");
  for (const b of ["canvas", "surface", "sunken", "selected"]) add("ring", b, 3, "non-text", "ring next to page background");
  for (const b of ["accent", "danger-solid"]) add("ring", b, 0, "info", "ring vs solid fill: not relied on (halo separates them)");
  add("ring-halo", "accent", 0, "info", "halo vs teal fill: separation only");
  // 6. AI option B (not active) and raw families, for the record
  add("plum-700", "plum-50", 4.5, "text", "DX-7 option B");
  add("plum-500", "plum-50", 3, "non-text", "DX-7 option B");
  // 7. Exempt (WCAG 1.4.3 exempts disabled), reported only
  add("fg-disabled", "surface", 0, "exempt", "disabled text");
  add("ink-700", "primary-200", 0, "exempt", "disabled primary button");
  const rows = pairs.map((p) => {
    const a = hex(p.fg);
    const b = hex(p.bg);
    const r = ratio(a, b);
    const pass = p.min === 0 ? null : r >= p.min;
    return { ...p, fgHex: a, bgHex: b, ratio: Math.round(r * 100) / 100, pass };
  });
  const gated = rows.filter((r) => r.pass !== null);
  const failed = gated.filter((r) => !r.pass);
  let md = "# Contrast report (tool-generated by v2-dx-capture.mjs)\n\n";
  md += `Source: \`themes/clinic-paper.css\` (var() chains resolved). WCAG 2.x relative luminance. Text ≥ 4.5:1; non-text ≥ 3:1.\n\n`;
  md += `**Gated pairs: ${gated.length} · pass: ${gated.length - failed.length} · fail: ${failed.length}** · informational/exempt: ${rows.length - gated.length}\n\n`;
  md += "| Foreground token | Background token | FG | BG | Ratio | Needs | Result | Note |\n|---|---|---|---|---|---|---|---|\n";
  for (const r of rows)
    md += `| ${r.fg} | ${r.bg} | \`${r.fgHex}\` | \`${r.bgHex}\` | ${r.ratio.toFixed(2)} | ${r.min || "—"} | ${r.pass === null ? r.kind : r.pass ? "pass" : "**FAIL**"} | ${r.note} |\n`;
  write("contrast.md", md);
  write("contrast.json", JSON.stringify(rows, null, 2));
  return { gated: gated.length, failed: failed.length, rows };
}

/* ------------------------------------------------------------------ tailwind consumption proof */
async function tailwindProof() {
  const css = fs.readFileSync(path.join(HERE, "themes/clinic-paper.css"), "utf8");
  const map = parseTokens(css);
  const ns = /^--(color|text|radius|shadow|spacing|font|ease|font-weight)-/;
  const reg = Object.keys(map).filter((n) => ns.test(n) && !n.startsWith("--color-plum"));
  const theme =
    "/* GENERATED by v2-dx-capture.mjs from clinic-paper.css. Do not edit.\n   Registers token names with Tailwind v4 without emitting them; values come from clinic-paper.css at runtime. */\n@theme reference {\n" +
    reg.map((n) => `  ${n}: ${resolve(map, n)};`).join("\n") +
    "\n}\n";
  fs.writeFileSync(path.join(HERE, "themes/clinic-paper.theme.css"), theme);
  const probe = ["bg-canvas", "bg-surface", "text-fg-muted", "border-border-control", "bg-status-waiting-bg", "text-status-waiting-fg", "h-control", "w-sidebar", "rounded-lg", "shadow-popover", "text-title-1", "text-token", "bg-accent", "text-fg-on-accent", "bg-ai-bg", "font-sans", "ease-out"];
  const { default: postcss } = await import("postcss");
  const { default: tw } = await import("@tailwindcss/postcss");
  const tmp = path.join(HERE, "themes");
  const input = `@import "tailwindcss" source(none);\n@import "./clinic-paper.css";\n@import "./clinic-paper.theme.css";\n@source inline("${probe.join(" ")}");\n`;
  const res = await postcss([tw({ base: tmp })]).process(input, { from: path.join(tmp, "__probe.css") });
  const lines = [];
  let ok = 0;
  for (const cls of probe) {
    const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp("\\." + esc + "\\s*\\{([^}]*)\\}").exec(res.css);
    const body = m ? m[1].replace(/\s+/g, " ").trim() : "(not generated)";
    const good = !!m && /var\(--/.test(body);
    if (good) ok += 1;
    lines.push(`${good ? "OK  " : "FAIL"} .${cls} { ${body} }`);
  }
  const rootHasToken = /--color-canvas:\s*var\(--color-paper\)/.test(res.css);
  const header = `Tailwind ${JSON.parse(fs.readFileSync(path.join(REPO, "node_modules/tailwindcss/package.json"), "utf8")).version} via @tailwindcss/postcss\nInput: @import clinic-paper.css (unchanged) + generated clinic-paper.theme.css (@theme reference, ${reg.length} names)\nUtilities resolving to var(--token): ${ok}/${probe.length}\nRuntime values emitted from clinic-paper.css: ${rootHasToken ? "yes" : "NO"}\n\n`;
  write("tailwind-consumption.txt", header + lines.join("\n") + "\n");
  return { ok, total: probe.length, names: reg.length, rootHasToken };
}

/* ------------------------------------------------------------------ icons */
async function icons(browser) {
  const page = await browser.newPage();
  await guard(page);
  const out = [];
  for (const [name, file, size] of [
    ["icon-192", "icon.svg", 192],
    ["icon-512", "icon.svg", 512],
    ["icon-maskable-512", "icon-maskable.svg", 512],
    ["apple-icon-180", "icon.svg", 180],
    ["favicon-32", "icon.svg", 32],
    ["alt-b-paper-192", "icon-alt-b-paper.svg", 192],
    ["alt-c-ink-192", "icon-alt-c-ink.svg", 192],
  ]) {
    await page.setViewportSize({ width: size, height: size });
    await page.goto(url("002-icon/" + file));
    const f = path.join(OUT, "icons", name + ".png");
    mkdir(path.dirname(f));
    await page.screenshot({ path: f, omitBackground: true });
    out.push(name);
  }
  await page.close();
  // maskable safe zone: farthest painted point of the glyph vs the 80 % circle (radius 204.8 on 512)
  const svg = fs.readFileSync(path.join(HERE, "002-icon/icon-maskable.svg"), "utf8");
  const c = /<circle cx="(\d+)" cy="(\d+)" r="(\d+)"[^>]*stroke-width="(\d+)"/.exec(svg).slice(1).map(Number);
  const p = /<path d="M(\d+) (\d+) (\d+) (\d+)"[^>]*stroke-width="(\d+)"/.exec(svg).slice(1).map(Number);
  const d = (x, y) => Math.hypot(x - 256, y - 256);
  const ring = d(c[0], c[1]) + c[2] + c[3] / 2;
  const tail = Math.max(d(p[0], p[1]), d(p[2], p[3])) + p[4] / 2;
  const far = Math.max(ring, tail);
  write("icons/safe-zone.txt", `Maskable safe zone (W3C: circle of radius 40% = 204.8 px on 512)\nRing outer extent from centre: ${ring.toFixed(1)} px\nTail outer extent from centre: ${tail.toFixed(1)} px\nFarthest painted glyph point: ${far.toFixed(1)} px → ${far <= 204.8 ? "INSIDE" : "OUTSIDE"} the safe zone\n`);
  return { pngs: out.length, far, inside: far <= 204.8 };
}

/* ------------------------------------------------------------------ screens + axe */
async function screensAndAxe(browser) {
  const summary = [];
  for (const [id, file, q, widths, full] of SURFACES) {
    for (const w of widths) {
      const ctx = await browser.newContext({ viewport: { width: w, height: HEIGHT[w] }, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      await guard(page);
      await page.goto(url(file, q));
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(900);
      const f = path.join(OUT, "screens", id, w + ".png");
      mkdir(path.dirname(f));
      await page.screenshot({ path: f, fullPage: full });
      const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      const v = axe.violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.length, targets: x.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
      write(`axe/${id}-${w}.json`, JSON.stringify({ surface: id, width: w, url: file + q, violations: v, passes: axe.passes.length }, null, 2));
      summary.push({ id, w, v, passes: axe.passes.length });
      await ctx.close();
    }
  }
  return summary;
}

/* sheets open (axe + screenshot): the dialogs are where focus traps and labels matter */
async function sheetStates(browser) {
  const out = [];
  const states = [
    ["today-walkin-sheet", "003-today/index.html", async (p) => { await p.keyboard.press("w"); await p.keyboard.type("9000000031"); }],
    ["today-book-sheet", "003-today/index.html", async (p) => { await p.keyboard.press("b"); await p.keyboard.type("9000000032"); await p.keyboard.press("Enter"); }],
    ["today-collect-sheet", "003-today/index.html?lane=to-bill", async (p) => { await p.getByRole("button", { name: "Collect ₹700" }).first().click(); }],
    ["today-row-menu", "003-today/index.html?lane=booked", async (p) => { await p.getByRole("button", { name: "More actions for Aditya Rane" }).first().click(); }],
    ["consult-finish-sheet", "004-consult/index.html?demo=rx", async (p) => { await p.getByRole("button", { name: "Finish visit" }).first().click(); }],
  ];
  for (const [id, file, act] of states) {
    for (const w of [360, 1280]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: HEIGHT[w] }, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      await guard(page);
      const [f, q] = file.split("?");
      await page.goto(url(f, q ? "?" + q : ""));
      await page.waitForTimeout(400);
      if (id === "today-row-menu" && w === 1280) {
        await page.getByRole("button", { name: "More actions for Aditya Rane" }).first().click();
      } else if (id === "today-row-menu") {
        await page.getByRole("button", { name: "Aditya Rane" }).first().click();
      } else {
        await act(page);
      }
      await page.waitForTimeout(400);
      const shot = path.join(OUT, "screens", "states", `${id}-${w}.png`);
      mkdir(path.dirname(shot));
      await page.screenshot({ path: shot });
      const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      const v = axe.violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.length, targets: x.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
      write(`axe/state-${id}-${w}.json`, JSON.stringify({ state: id, width: w, violations: v }, null, 2));
      out.push({ id: "state:" + id, w, v, passes: axe.passes.length });
      await ctx.close();
    }
  }
  return out;
}

/* WebKit iPhone 15 (390) for Today and Consult */
async function webkitShots() {
  const b = await webkit.launch();
  const out = [];
  for (const [id, file] of [["today", "003-today/index.html"], ["consult", "004-consult/index.html?demo=rx"]]) {
    const ctx = await b.newContext({ ...devices["iPhone 15"] });
    const page = await ctx.newPage();
    await guard(page);
    const [f, q] = file.split("?");
    await page.goto(url(f, q ? "?" + q : ""));
    await page.waitForTimeout(900);
    const shot = path.join(OUT, "screens", id, "webkit-iphone15-390.png");
    await page.screenshot({ path: shot });
    out.push(id);
    await ctx.close();
  }
  await b.close();
  return out;
}

/* ------------------------------------------------------------------ interaction counts */
class Counter {
  constructor(page) {
    this.page = page;
    this.steps = [];
  }
  async click(locator, label) {
    await locator.click();
    this.steps.push({ kind: "click", target: label, keystrokes: 0 });
  }
  async press(key, label) {
    await this.page.keyboard.press(key);
    this.steps.push({ kind: "press", target: label || key, keystrokes: 1 });
  }
  async type(text, label) {
    await this.page.keyboard.type(text);
    this.steps.push({ kind: "type", target: label, keystrokes: text.length });
  }
  totals() {
    const clicks = this.steps.filter((s) => s.kind === "click").length;
    const presses = this.steps.filter((s) => s.kind === "press").length;
    const types = this.steps.filter((s) => s.kind === "type").length;
    return {
      actionsM0Rules: clicks + presses + types,
      actionsExcludingTyping: clicks + presses,
      keystrokes: this.steps.reduce((a, s) => a + s.keystrokes, 0),
      mouse: clicks,
      clicks,
      presses,
      fills: types,
    };
  }
}
const FLOWS = [
  {
    id: "check-in",
    label: "Check in a booked patient (filter → Enter)",
    target: "1 action + typing once the filter has focus (UX_AUDIT §4.1)",
    targetMax: 2,
    m0: null,
    file: "003-today/index.html",
    run: async (c, p) => {
      await c.press("/", "focus Today filter");
      await c.type("Pawar", "filter");
      await c.press("Enter", "Enter = Check in");
      await p.getByRole("region", { name: /Waiting/ }).getByText("Meena Pawar").waitFor();
      return (await p.locator('.lane[data-lane="waiting"] .row', { hasText: "Meena Pawar" }).locator(".token").innerText()).replace(/\D/g, "") === "20";
    },
  },
  {
    id: "check-in-next",
    label: "Check in the next booked patient (filter keeps focus)",
    target: "1 action + typing",
    targetMax: 1,
    m0: null,
    file: "003-today/index.html",
    setup: async (p) => {
      await p.keyboard.press("/");
      await p.keyboard.type("Pawar");
      await p.keyboard.press("Enter");
    },
    run: async (c, p) => {
      await c.type("Rane", "filter");
      await c.press("Enter", "Enter = Check in");
      return p.locator('.lane[data-lane="waiting"] .row', { hasText: "Aditya Rane" }).isVisible();
    },
  },
  {
    id: "walk-in-token",
    label: "Walk-in, existing patient → token",
    target: "W → phone → Enter → Enter (3 keystrokes besides typing)",
    targetMax: 3,
    m0: "walk-in-token",
    file: "003-today/index.html",
    run: async (c, p) => {
      await c.press("w", "W = walk-in");
      await c.type("9000000031", "mobile number");
      await c.press("Enter", "select top match");
      await c.press("Enter", "Add to queue");
      return p.locator('.lane[data-lane="waiting"] .row', { hasText: "Deepak Wagh" }).isVisible();
    },
  },
  {
    id: "book-next-free",
    label: "Book, existing patient, suggested next free slot",
    target: "3 actions with context, 4 without (UX_AUDIT §5.2)",
    targetMax: 3,
    m0: "book-appointment",
    file: "003-today/index.html",
    run: async (c, p) => {
      await c.press("b", "B = book");
      await c.type("9000000032", "mobile number");
      await c.press("Enter", "select patient");
      await c.press("Enter", "Book 11:30 am");
      await p.locator(".toast", { hasText: "Booked" }).waitFor();
      return p.locator('.lane[data-lane="booked"] .row', { hasText: "Sunita Lokhande" }).isVisible();
    },
  },
  {
    id: "book-chosen-slot",
    label: "Book, existing patient, a slot of the caller's choice",
    target: "4 actions without context",
    targetMax: 4,
    m0: "book-appointment",
    file: "003-today/index.html",
    run: async (c, p) => {
      await c.press("b", "B = book");
      await c.type("9000000033", "mobile number");
      await c.press("Enter", "select patient");
      await c.click(p.getByRole("radio", { name: "4:30 pm" }), "slot 4:30 pm");
      await c.click(p.getByRole("button", { name: "Book 4:30 pm today" }), "Book");
      return p.locator('.lane[data-lane="booked"] .row', { hasText: "Sachin Wagh" }).isVisible();
    },
  },
  {
    id: "reschedule",
    label: "Reschedule a booked appointment",
    target: "⋯ → Reschedule → slot → Confirm = 4 (UX_AUDIT §5.3)",
    targetMax: 4,
    m0: null,
    file: "003-today/index.html",
    run: async (c, p) => {
      await c.click(p.getByRole("button", { name: "More actions for Aditya Rane" }).first(), "⋯");
      await c.click(p.getByRole("menuitem", { name: "Reschedule" }), "Reschedule");
      await c.click(p.getByRole("radio", { name: "12:45 pm" }), "slot 12:45 pm");
      await c.click(p.getByRole("button", { name: "Confirm 12:45 pm" }), "Confirm");
      return p.locator('.lane[data-lane="booked"] .row', { hasText: "Aditya Rane" }).locator(".token").innerText().then((t) => /12:45/.test(t));
    },
  },
  {
    id: "collect",
    label: "Collect payment for a visit in To bill",
    target: "≤ 3 (brief); UX_AUDIT §5.9 keeps 4 incl. share",
    targetMax: 3,
    m0: "checkout-collect",
    file: "003-today/index.html",
    run: async (c, p) => {
      await c.click(p.getByRole("button", { name: "Collect ₹700" }).first(), "Collect ₹700 (row)");
      await c.click(p.getByRole("dialog").getByRole("button", { name: "Collect ₹700" }), "Collect ₹700 (sheet)");
      await p.getByText("₹700 received (Cash)").waitFor();
      await c.click(p.getByRole("dialog").getByRole("button", { name: "Done" }), "Done");
      return p.locator('.lane[data-lane="done"] .row', { hasText: "Arjun Mehta" }).count().then((n) => n === 1);
    },
  },
  {
    id: "consult-rx-finish",
    label: "Consult: note, diagnosis, 2 medicines by keyboard, sign",
    target: "0 mouse actions per medicine (UX_AUDIT §4.2)",
    targetMax: null,
    m0: "consult-rx-finish",
    file: "004-consult/index.html",
    run: async (c, p) => {
      await c.click(p.getByLabel("Notes"), "Notes");
      await c.type("Headache 3 days, worse mornings", "notes");
      await c.press("Alt+3", "Alt+3 diagnosis");
      await c.type("htn", "diagnosis");
      await c.press("Enter", "pick Essential hypertension");
      await c.press("Alt+4", "Alt+4 prescription");
      await c.type("telmi", "medicine");
      await c.press("Enter", "pick Telmisartan");
      await c.press("2", "preset 2 = 1-0-0");
      await c.type("30d", "duration");
      await c.press("Enter", "add line");
      await c.type("amlo", "medicine");
      await c.press("Enter", "pick Amlodipine");
      await c.press("3", "preset 3 = 0-0-1");
      await c.type("30d", "duration");
      await c.press("Enter", "add line");
      await c.click(p.getByRole("button", { name: "Finish visit" }).first(), "Finish visit");
      await c.click(p.getByRole("button", { name: "Sign and finish" }), "Sign and finish");
      await p.getByText("Visit finished · Rx v1 signed").waitFor();
      const lines = await p.locator(".rx-line").count();
      const txt = await p.locator("#rx-lines").innerText();
      return lines === 2 && /1-0-0/.test(txt) && /0-0-1/.test(txt) && /30 days/.test(txt);
    },
  },
  {
    id: "repeat-last-rx",
    label: "Consult: repeat last prescription",
    target: "1 action (UX_AUDIT §4.2)",
    targetMax: 1,
    m0: null,
    file: "004-consult/index.html",
    run: async (c, p) => {
      await c.click(p.getByRole("button", { name: "Repeat last Rx (2)" }), "Repeat last Rx");
      return p.locator(".rx-line").count().then((n) => n === 2);
    },
  },
];
async function counts(browser) {
  const m0 = JSON.parse(fs.readFileSync(M0_COUNTS, "utf8"));
  const m0By = Object.fromEntries(m0.flows.map((f) => [f.id, f]));
  const results = [];
  const vidDir = path.join(OUT, "walkthrough");
  mkdir(vidDir);
  for (const flow of FLOWS) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: vidDir, size: { width: 1280, height: 800 } } });
    const page = await ctx.newPage();
    await guard(page);
    await page.goto(url(flow.file));
    await page.waitForTimeout(500);
    if (flow.setup) await flow.setup(page);
    const c = new Counter(page);
    const t0 = Date.now();
    let outcome = false;
    let error = null;
    try {
      outcome = await flow.run(c, page);
    } catch (e) {
      error = String(e.message || e).split("\n")[0];
    }
    const ms = Date.now() - t0;
    await page.waitForTimeout(600);
    const video = page.video();
    await ctx.close();
    const vp = await video.path();
    const dest = path.join(vidDir, flow.id + ".webm");
    fs.renameSync(vp, dest);
    const t = c.totals();
    const ref = flow.m0 ? m0By[flow.m0] : null;
    results.push({
      id: flow.id,
      label: flow.label,
      target: flow.target,
      targetMax: flow.targetMax,
      meetsTarget: flow.targetMax === null ? (flow.id === "consult-rx-finish" ? c.steps.filter((s) => s.kind === "click").length <= 3 : null) : t.actionsExcludingTyping <= flow.targetMax,
      outcomeAsserted: outcome === true,
      error,
      ...t,
      durationMs: ms,
      m0: ref ? { id: ref.id, actions: ref.actions, keystrokes: ref.keystrokes, clicks: ref.clicks } : null,
      steps: c.steps,
      video: "walkthrough/" + flow.id + ".webm",
    });
  }
  write("counts.json", JSON.stringify({ m0Commit: m0.commit, rules: "click, key press and each typed field = 1 action (M0 rules); 'excluding typing' = clicks + key presses (UX_AUDIT §5: typing is not counted); keystrokes = every key incl. typed characters", flows: results }, null, 2));
  let md = "# Interaction counts vs M0 and the UX_AUDIT §4/§5 targets (tool-generated)\n\n";
  md += "Desktop Chromium 1280×800 on the file:// prototypes. Each flow asserts its visible outcome; a video of every flow is in `walkthrough/`.\n";
  md += "Counting: click, key press and each typed field = 1 action (the M0 rules in `tests/e2e/support/ux-counter.ts`); *excluding typing* = clicks + key presses (UX_AUDIT §5 counts \"a click, tap or Enter; typing is not counted\").\n\n";
  md += "| Flow | Outcome | Actions (M0 rules) | Actions excl. typing | Keystrokes | Mouse clicks | Target | Meets | M0 v1 actions / keystrokes |\n|---|---|---|---|---|---|---|---|---|\n";
  for (const r of results)
    md += `| ${r.label} | ${r.outcomeAsserted ? "asserted" : "**FAILED** " + (r.error || "")} | ${r.actionsM0Rules} | ${r.actionsExcludingTyping} | ${r.keystrokes} | ${r.mouse} | ${r.target} | ${r.meetsTarget === null ? "—" : r.meetsTarget ? "yes" : "**no**"} | ${r.m0 ? r.m0.actions + " / " + r.m0.keystrokes + " (" + r.m0.id + ")" : "not measured in M0"} |\n`;
  md += "\nNotes: M0 `checkout-collect` collected two payments (cash then UPI); the prototype flow collects one full cash payment, so that row is indicative only. M0 `consult-rx-finish` typed more free text (105 keystrokes); compare actions, not keystrokes.\n\n## Steps\n\n";
  for (const r of results) md += `**${r.label}**: ` + r.steps.map((s) => `${s.kind} ${s.target}${s.keystrokes > 1 ? " (" + s.keystrokes + ")" : ""}`).join(" → ") + "\n\n";
  write("counts.md", md);
  return results;
}

/* ------------------------------------------------------------------ copy check + glyphs */
async function copyCheck(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await guard(page);
  const lines = [];
  let violations = 0;
  for (const [id, file, q] of SURFACES) {
    await page.goto(url(file, q));
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const allowed = ".chip-ai, .assist, .ai-draft, .soon, [data-ai-copy], [data-assist], [data-assist-m]";
      const out = { outside: [], near: [], sparkleOutside: 0, total: 0 };
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        if (/\bAI\b/.test(n.nodeValue)) {
          out.total += 1;
          if (!n.parentElement.closest(allowed)) out.outside.push(n.nodeValue.trim().slice(0, 80));
        }
      }
      const text = document.body.innerText.replace(/\s+/g, " ");
      for (const m of text.matchAll(/\bAI\b/g)) {
        const win = text.slice(Math.max(0, m.index - 80), m.index + 82);
        if (/₹|\bprice\b|\bbuy\b|\bupgrade\b/i.test(win)) out.near.push(win);
      }
      document.querySelectorAll("svg path").forEach((p) => {
        if ((p.getAttribute("d") || "").startsWith("M9.94 15.5") && !p.closest(allowed)) out.sparkleOutside += 1;
      });
      return out;
    });
    const bad = r.outside.length + r.near.length + r.sparkleOutside;
    violations += bad;
    lines.push(`${bad ? "FAIL" : "ok  "} ${id}: ${r.total} "AI" text nodes; outside AI-labelled elements: ${r.outside.length}; within 80 chars of ₹/price/buy/upgrade: ${r.near.length}; sparkle glyph outside AI elements: ${r.sparkleOutside}`);
    for (const o of r.outside) lines.push("     outside: " + o);
    for (const o of r.near) lines.push("     near price: " + o);
  }
  await page.close();
  write("copy-check.txt", `AI-02 copy check (mirrors L1-R5/R6) over every surface\nViolations: ${violations}\n\n` + lines.join("\n") + "\n");
  return violations;
}
async function glyphs(browser) {
  const page = await browser.newPage();
  await guard(page);
  await page.goto(url("001-palette-type/index.html"));
  const r = await page.evaluate(async () => {
    await document.fonts.load('16px "IBM Plex Sans"', "₹");
    await document.fonts.load('16px "IBM Plex Sans Devanagari"', "क");
    await document.fonts.ready;
    function w(font, txt) {
      const s = document.createElement("span");
      s.style.cssText = "position:absolute;font-size:64px;white-space:nowrap;font-family:" + font;
      s.textContent = txt;
      document.body.appendChild(s);
      const v = s.getBoundingClientRect().width;
      s.remove();
      return v;
    }
    const probe = (fam, txt, fbA, fbB) => {
      const a = w('"' + fam + '", ' + fbA, txt);
      const b = w('"' + fam + '", ' + fbB, txt);
      return { a: a, b: b, fbA: fbA, fbB: fbB, inFont: Math.abs(a - b) < 0.01 };
    };
    const sys = w("serif", "पेरासिटामोल");
    const deva = w('"IBM Plex Sans Devanagari", serif', "पेरासिटामोल");
    return {
      rupeeGlyphOnly: probe("IBM Plex Sans", "₹", "monospace", "serif"),
      rupeeInPlexSans: probe("IBM Plex Sans", "₹1,49,900", "monospace", "serif"),
      devanagariInPlexSans: probe("IBM Plex Sans", "पेरासिटामोल", '"IBM Plex Sans Devanagari"', "serif"),
      devanagariInPlexDeva: Object.assign(probe("IBM Plex Sans Devanagari", "पेरासिटामोल", "monospace", "serif"), { differsFromSystem: Math.abs(sys - deva) > 0.5 }),
      fontsLoaded: Array.from(document.fonts).filter((f) => f.status === "loaded").map((f) => f.family + " " + f.weight),
    };
  });
  await page.close();
  const fmt = (k) => `${k}: ${r[k].inFont ? "rendered by the face" : "NOT in the face (fallback draws it)"} (width with fallback ${r[k].fbA} ${r[k].a.toFixed(2)} px vs ${r[k].fbB} ${r[k].b.toFixed(2)} px)${r[k].differsFromSystem !== undefined ? "; differs from the system Devanagari face: " + r[k].differsFromSystem : ""}`;
  write(
    "glyphs.txt",
    "Glyph check (width probe: equal widths under two different fallbacks ⇒ the named face draws the glyphs)\n" +
      ["rupeeGlyphOnly", "rupeeInPlexSans", "devanagariInPlexSans", "devanagariInPlexDeva"].map(fmt).join("\n") +
      "\nFaces loaded: " +
      [...new Set(r.fontsLoaded)].join(", ") +
      "\n"
  );
  return r;
}

/* ------------------------------------------------------------------ main */
fs.rmSync(OUT, { recursive: true, force: true });
mkdir(OUT);
const contrast = contrastReport();
const twp = await tailwindProof();
const browser = await chromium.launch();
const ic = await icons(browser);
const axeRuns = (await screensAndAxe(browser)).concat(await sheetStates(browser));
const wk = await webkitShots();
const cnt = await counts(browser);
const copyViolations = await copyCheck(browser);
const gl = await glyphs(browser);
await browser.close();

const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
for (const r of axeRuns) for (const v of r.v) byImpact[v.impact] = (byImpact[v.impact] || 0) + v.nodes;
let axeMd = `# axe summary (tool-generated)\n\naxe-core via @axe-core/playwright, tags ${AXE_TAGS.join(", ")}. ${axeRuns.length} runs (surfaces × widths, plus open sheets/menus at 360 and 1280).\n\n`;
axeMd += `**Violation nodes by impact: critical ${byImpact.critical}, serious ${byImpact.serious}, moderate ${byImpact.moderate}, minor ${byImpact.minor}**\n\n| Surface | Width | Violations (rule: impact × nodes) | Passed rules |\n|---|---|---|---|\n`;
for (const r of axeRuns) axeMd += `| ${r.id} | ${r.w} | ${r.v.length ? r.v.map((v) => `${v.id}: ${v.impact} × ${v.nodes}`).join("; ") : "none"} | ${r.passes} |\n`;
write("axe/SUMMARY.md", axeMd);

const flowsMet = cnt.filter((r) => r.meetsTarget === true).length;
const flowsTargeted = cnt.filter((r) => r.meetsTarget !== null).length;
const outcomes = cnt.filter((r) => r.outcomeAsserted).length;
const screens = fs.readdirSync(path.join(OUT, "screens"), { recursive: true }).filter((f) => String(f).endsWith(".png")).length;
const readme = `# V2-DX evidence (tool-generated by \`v2-dx-capture.mjs\`; do not edit by hand)

Generated: ${new Date().toISOString()} · Playwright ${JSON.parse(fs.readFileSync(path.join(REPO, "node_modules/@playwright/test/package.json"), "utf8")).version} · axe-core ${JSON.parse(fs.readFileSync(path.join(REPO, "node_modules/axe-core/package.json"), "utf8")).version}

| Check | Result |
|---|---|
| Network requests from the prototypes (all aborted) | ${blocked}${blocked ? " (" + [...blockedUrls].join(", ") + ")" : ""} |
| Page errors | ${pageErrors.length}${pageErrors.length ? ": " + [...new Set(pageErrors)].join("; ") : ""} |
| Screenshots | ${screens} PNG (Chromium 360/744/820/1180/1280; WebKit iPhone 15 390 for ${wk.join(", ")}) |
| axe runs | ${axeRuns.length}; violation nodes: critical ${byImpact.critical}, serious ${byImpact.serious}, moderate ${byImpact.moderate}, minor ${byImpact.minor} → [axe/SUMMARY.md](axe/SUMMARY.md) |
| Contrast (gated token pairs) | ${contrast.gated - contrast.failed}/${contrast.gated} pass, ${contrast.failed} fail → [contrast.md](contrast.md) |
| Interaction flows | ${outcomes}/${cnt.length} outcomes asserted; ${flowsMet}/${flowsTargeted} meet their §4/§5 target → [counts.md](counts.md), videos in \`walkthrough/\` |
| AI-02 copy check | ${copyViolations} violations → [copy-check.txt](copy-check.txt) |
| ₹ glyph in IBM Plex Sans | ${gl.rupeeGlyphOnly.inFont ? "rendered by Plex (no fallback face needed)" : "FALLBACK needed"} → [glyphs.txt](glyphs.txt) |
| Devanagari | Plex Sans Latin: ${gl.devanagariInPlexSans.inFont ? "has it" : "does not have it (expected)"}; Plex Sans Devanagari draws it: ${gl.devanagariInPlexDeva.inFont && gl.devanagariInPlexDeva.differsFromSystem ? "yes" : "NO"} |
| Icon maskable safe zone | farthest glyph point ${ic.far.toFixed(1)} px of 204.8 → ${ic.inside ? "inside" : "OUTSIDE"}; ${ic.pngs} PNGs in \`icons/\` |
| 06-01b consumption (Tailwind v4 compiles clinic-paper.css unchanged) | ${twp.ok}/${twp.total} probe utilities resolve to \`var(--token)\`; ${twp.names} names registered; runtime values emitted: ${twp.rootHasToken ? "yes" : "no"} → [tailwind-consumption.txt](tailwind-consumption.txt) |
`;
write("README.md", readme);
