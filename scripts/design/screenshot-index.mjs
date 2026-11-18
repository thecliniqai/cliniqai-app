#!/usr/bin/env node
/**
 * G3 screenshot-set index (V2-06 06-08 step 3; PO action 06-P6). Reads the catalogue
 * `tests/e2e/design/screens/g3-screens.json` and the captures that `screenshot-set.spec.ts` wrote to
 * `.planning/phases/06-design-system-pwa-shell/evidence/06-08/screens/<width>/<id>.{png,json}`, and writes
 * `screens/README.md`: one table per width linking each PNG, its G2-D reference (the brand-theme captures at the
 * catalogue's `referenceCommit`, linked by commit and path, never copied) and the axe result.
 *
 * Fails (exit 1, nothing written) when a listed screen has no PNG or JSON at one of its widths, a file in the set is not
 * in the catalogue, a reference image does not exist at the reference commit, or a capture recorded a gated
 * serious/critical axe violation or horizontal scroll. Exit 2: usage or unreadable input.
 *
 * Usage: node scripts/design/screenshot-index.mjs [--screens <dir>] [--catalogue <file>] [--check]
 *   --check  verify only, do not write README.md
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const SCREENS_DIR = path.resolve(ROOT, arg("--screens", ".planning/phases/06-design-system-pwa-shell/evidence/06-08/screens"));
const CATALOGUE = path.resolve(ROOT, arg("--catalogue", "tests/e2e/design/screens/g3-screens.json"));
const CHECK_ONLY = process.argv.includes("--check");

let catalogue;
try {
  catalogue = JSON.parse(readFileSync(CATALOGUE, "utf8"));
} catch {
  console.error(`screenshot-index: cannot read the catalogue at ${path.relative(ROOT, CATALOGUE)}`);
  process.exit(2);
}
const { referenceCommit, referenceRoot, widths, screens } = catalogue;
if (!/^[0-9a-f]{7,40}$/.test(referenceCommit ?? "") || !Array.isArray(widths) || !Array.isArray(screens)) {
  console.error("screenshot-index: the catalogue needs referenceCommit, widths and screens");
  process.exit(2);
}

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const refExists = (p) => {
  try {
    git("cat-file", "-e", `${referenceCommit}:${p}`);
    return true;
  } catch {
    return false;
  }
};
/** `https://github.com/<owner>/<repo>` of origin, or null (then references are shown as `commit:path`). */
const repoUrl = (() => {
  try {
    const url = git("remote", "get-url", "origin");
    const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
    return m ? `https://github.com/${m[1]}/${m[2]}` : null;
  } catch {
    return null;
  }
})();

const problems = [];
const widthsOf = (s) => s.widths ?? widths;

/** The reference image for a screen at a width: the exact width if the reference has it, else the nearest (ties: the larger). */
function referenceFor(screen, width) {
  if (!screen.reference) return null;
  const { dir, widths: have } = screen.reference;
  const best = [...have].sort((a, b) => Math.abs(a - width) - Math.abs(b - width) || b - a)[0];
  const rel = `${referenceRoot}/${dir}/${best}.png`;
  if (!refExists(rel)) problems.push(`reference missing at ${referenceCommit}: ${rel} (${screen.id})`);
  return { rel, width: best, exact: best === width };
}

function referenceCell(ref) {
  if (!ref) return "none (see Compare)";
  const label = `${path.posix.basename(path.posix.dirname(ref.rel))}/${ref.width}.png${ref.exact ? "" : ` (nearest width)`}`;
  return repoUrl ? `[${label}](${repoUrl}/blob/${referenceCommit}/${ref.rel})` : `\`${referenceCommit}:${ref.rel}\``;
}

const count = (vs, impacts) => vs.filter((v) => impacts.includes(v.impact)).reduce((n, v) => n + v.nodes, 0);
function axeCell(summary) {
  const vs = summary.axe.violations;
  const blocking = count(vs, ["serious", "critical"]);
  const minor = count(vs, ["moderate", "minor"]);
  let cell = `${blocking} serious/critical${minor ? `, ${minor} moderate/minor` : ""} (\`${summary.axe.scope}\`)`;
  if (summary.wholePageForReference) {
    const whole = count(summary.wholePageForReference, ["serious", "critical"]);
    cell += `; whole page ${whole} serious/critical${whole ? " (v1 content in `<main>`)" : ""}`;
  }
  return cell;
}

const rows = new Map(widths.map((w) => [w, []]));
const totals = new Map(widths.map((w) => [w, { screens: 0, blocking: 0, wholePageBlocking: 0 }]));
for (const screen of screens) {
  for (const width of widthsOf(screen)) {
    if (!rows.has(width)) {
      problems.push(`${screen.id}: width ${width} is not one of ${widths.join("/")}`);
      continue;
    }
    const png = path.join(SCREENS_DIR, String(width), `${screen.id}.png`);
    const json = path.join(SCREENS_DIR, String(width), `${screen.id}.json`);
    if (!existsSync(png)) problems.push(`missing capture: ${path.relative(ROOT, png)}`);
    if (!existsSync(json)) {
      problems.push(`missing axe summary: ${path.relative(ROOT, json)}`);
      continue;
    }
    const summary = JSON.parse(readFileSync(json, "utf8"));
    if (summary.axe.gate && summary.axe.seriousOrCritical > 0) {
      problems.push(`${screen.id} at ${width}px: ${summary.axe.seriousOrCritical} serious/critical axe violation(s) in ${summary.axe.scope}`);
    }
    if (summary.horizontalScroll) problems.push(`${screen.id} at ${width}px: horizontal scroll`);
    const t = totals.get(width);
    t.screens += 1;
    t.blocking += count(summary.axe.violations, ["serious", "critical"]);
    if (summary.wholePageForReference) t.wholePageBlocking += count(summary.wholePageForReference, ["serious", "critical"]);
    const ref = referenceFor(screen, width);
    rows.get(width).push(
      `| ${screen.group} | [${screen.title}](${width}/${screen.id}.png) | ${referenceCell(ref)} | ${screen.compare} | ${axeCell(summary)} | ${summary.horizontalScroll ? "yes" : "no"} |`,
    );
  }
}

// Every file in the set belongs to a listed screen and width (a renamed or removed screen leaves no orphan behind).
const expected = new Set(screens.flatMap((s) => widthsOf(s).flatMap((w) => [`${w}/${s.id}.png`, `${w}/${s.id}.json`])));
if (existsSync(SCREENS_DIR)) {
  for (const entry of readdirSync(SCREENS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const file of readdirSync(path.join(SCREENS_DIR, entry.name))) {
      if (!expected.has(`${entry.name}/${file}`)) problems.push(`not in the catalogue: ${entry.name}/${file}`);
    }
  }
}

if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error(`screenshot-index: ${problems.length} problem(s); README.md not written`);
  process.exit(1);
}

const total = [...totals.values()].reduce((n, t) => n + t.screens, 0);
const lines = [
  "# V2-06 G3 screenshot set (tool-generated; do not edit by hand)",
  "",
  `Generated by \`node scripts/design/screenshot-index.mjs\` from the captures of \`tests/e2e/design/screens/screenshot-set.spec.ts\``,
  "(`npm run e2e:g3`: the design-360/820/1180/1280 projects against the guarded e2e build, the run's synthetic seed).",
  `Catalogue: \`tests/e2e/design/screens/g3-screens.json\`. G2-D references: the CliniQ AI brand-theme captures at`,
  `\`${referenceCommit}\` (\`${referenceRoot}/\`), linked, not copied. The set's own commit is the commit that adds this file.`,
  "",
  "How to read it: open a capture and its reference side by side. The `Compare` column says what the reference governs.",
  "Most v1 screens have only their shell chrome (navigation, top bar, title, tokens and fonts) from V2-06; their page",
  "content is v1 restyled through the tokens until the owner phase rebuilds it. axe uses the M0 tags (wcag2a, wcag2aa,",
  "wcag21aa, wcag22aa) in the screen's scope; the capture fails on a serious or critical violation there or on horizontal",
  "scroll. Where the scope leaves out `<main>`, the whole-page count is recorded for reference (v1 content debt).",
  "",
  "| Width | Screens | Serious/critical in scope | Whole page serious/critical (reference only) |",
  "|---|---|---|---|",
  ...widths.map((w) => {
    const t = totals.get(w);
    return `| ${w} | ${t.screens} | ${t.blocking} | ${t.wholePageBlocking} |`;
  }),
  `| all | ${total} | ${[...totals.values()].reduce((n, t) => n + t.blocking, 0)} | ${[...totals.values()].reduce((n, t) => n + t.wholePageBlocking, 0)} |`,
  "",
];
for (const width of widths) {
  lines.push(`## ${width} px`, "", "| Group | Capture | G2-D reference | Compare | axe | Horizontal scroll |", "|---|---|---|---|---|---|");
  lines.push(...rows.get(width), "");
}
const readme = `${lines.join("\n").trimEnd()}\n`;
if (!CHECK_ONLY) writeFileSync(path.join(SCREENS_DIR, "README.md"), readme);
console.log(`screenshot-index: ${total} capture(s) at ${widths.join("/")} px, 0 problems${CHECK_ONLY ? " (check only)" : `; wrote ${path.relative(ROOT, path.join(SCREENS_DIR, "README.md"))}`}`);
