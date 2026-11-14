#!/usr/bin/env node
/**
 * Value-neutral proof for the token layer and the colour codemod (V2-06 plan 06-01a steps 7-8).
 *
 *   node scripts/design/neutral-diff.mjs capture --label before|after [--project design-360 ...]
 *     writes test-results/design/neutral/label.json, then runs tests/e2e/design/neutral/capture.spec.ts on the
 *     design-* projects (default: all four) against the current e2e build (`npm run e2e:build` first).
 *   node scripts/design/neutral-diff.mjs compare --before before --after after --out <file> [--max-ratio 0.005]
 *       [--threshold 8] [--note <file.json>]
 *     compares every PNG pair (same project, same file name) in headless Chromium and writes per screen: width,
 *     route, differing-pixel ratio and pass/fail against --max-ratio. `--note` merges a JSON object of explanations
 *     ({ "<project>/<file>": "reason" }) into the report; it never changes pass/fail.
 *
 * Exit 0 = every screen at or under the ratio, 1 = a screen over it or a screen missing on one side, 2 = usage error.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { DEFAULT_CHANNEL_THRESHOLD, diffPngs, openDiffPage } from "./png-diff.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const NEUTRAL_DIR = join(ROOT, "test-results/design/neutral");
const PROJECTS = ["design-360", "design-820", "design-1180", "design-1280"];

function usage(message) {
  console.error(`neutral-diff: ${message}`);
  process.exit(2);
}

function opt(args, name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const value = args[i + 1];
  if (!value || value.startsWith("--")) usage(`${name} needs a value`);
  return value;
}

function opts(args, name) {
  const out = [];
  args.forEach((a, i) => {
    if (a === name) out.push(args[i + 1]);
  });
  return out;
}

const LABEL_RE = /^[a-z0-9-]+$/;

function capture(args) {
  const label = opt(args, "--label");
  if (!label || !LABEL_RE.test(label)) usage("capture needs --label <a-z0-9->");
  const projects = opts(args, "--project");
  for (const p of projects) if (!PROJECTS.includes(p)) usage(`unknown project ${p}`);
  mkdirSync(NEUTRAL_DIR, { recursive: true });
  writeFileSync(join(NEUTRAL_DIR, "label.json"), `${JSON.stringify({ label })}\n`);
  const cli = join(ROOT, "node_modules/@playwright/test/cli.js");
  const run = spawnSync(
    process.execPath,
    [cli, "test", "tests/e2e/design/neutral", ...(projects.length ? projects : PROJECTS).map((p) => `--project=${p}`)],
    { cwd: ROOT, stdio: "inherit" },
  );
  return run.status ?? 1;
}

function screensOf(dir) {
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const project of readdirSync(dir).filter((p) => PROJECTS.includes(p)).sort()) {
    for (const file of readdirSync(join(dir, project)).filter((f) => f.endsWith(".png")).sort()) {
      out.set(`${project}/${file}`, join(dir, project, file));
    }
  }
  return out;
}

async function compare(args) {
  const before = opt(args, "--before");
  const after = opt(args, "--after");
  const out = opt(args, "--out");
  if (!before || !after || !out || !LABEL_RE.test(before) || !LABEL_RE.test(after)) {
    usage("compare needs --before <label> --after <label> --out <file>");
  }
  const maxRatio = Number(opt(args, "--max-ratio", "0.005"));
  const threshold = Number(opt(args, "--threshold", String(DEFAULT_CHANNEL_THRESHOLD)));
  if (!(maxRatio >= 0 && maxRatio < 1) || !(threshold >= 0 && threshold < 256)) usage("bad --max-ratio/--threshold");
  const notesFile = opt(args, "--note");
  const notes = notesFile ? JSON.parse(readFileSync(notesFile, "utf8")) : {};

  const a = screensOf(join(NEUTRAL_DIR, before));
  const b = screensOf(join(NEUTRAL_DIR, after));
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
  if (keys.length === 0) usage(`no PNGs under test-results/design/neutral/${before} or /${after}`);

  const browser = await chromium.launch();
  const { page, close } = await openDiffPage(browser);
  const screens = [];
  try {
    for (const key of keys) {
      const [project, file] = key.split("/");
      const width = Number(project.replace("design-", ""));
      const route = file.replace(/^route-/, "").replace(/\.png$/, "");
      if (!a.has(key) || !b.has(key)) {
        screens.push({ project, width, route, missing: a.has(key) ? after : before, pass: false });
        continue;
      }
      const r = await diffPngs(page, a.get(key), b.get(key), threshold);
      screens.push({
        project,
        width,
        route,
        size: `${r.width}x${r.height}`,
        sizeMismatch: r.sizeMismatch,
        differingPixels: r.differing,
        ratio: Number(r.ratio.toFixed(6)),
        pass: r.ratio <= maxRatio,
        ...(notes[key] ? { note: notes[key] } : {}),
      });
    }
  } finally {
    await close();
    await browser.close();
  }

  const failing = screens.filter((s) => !s.pass);
  const report = {
    generatedBy: "scripts/design/neutral-diff.mjs compare",
    before,
    after,
    maxRatio,
    channelThreshold: threshold,
    screens: screens.length,
    failing: failing.length,
    maxObservedRatio: Math.max(...screens.map((s) => s.ratio ?? 1)),
    results: screens,
  };
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  for (const s of failing) {
    console.error(`FAIL ${s.project} ${s.route}: ${s.missing ? `missing in ${s.missing}` : `${(s.ratio * 100).toFixed(3)} %`}`);
  }
  console.log(
    `neutral-diff: ${screens.length} screens, ${failing.length} over ${(maxRatio * 100).toFixed(2)} %, max ${(report.maxObservedRatio * 100).toFixed(3)} % -> ${relative(ROOT, resolve(out))}`,
  );
  return failing.length ? 1 : 0;
}

const [command, ...rest] = process.argv.slice(2);
if (command === "capture") process.exit(capture(rest));
else if (command === "compare") process.exit(await compare(rest));
else usage("usage: neutral-diff.mjs capture --label <l> | compare --before <l> --after <l> --out <file>");
