#!/usr/bin/env node
/**
 * v1 colour codemod (V2-06 plan 06-01a step 4; DESIGN_SYSTEM §2.3, §10; FRONTEND_MIGRATION_PLAN M1).
 *
 * Rewrites Tailwind colour classes in `.tsx` files under app/, components/ and features/ to semantic utilities, using
 * the property-aware table in scripts/design/color-map.json:
 *   hex     `<variants>:<prop>-[#hex](/<opacity>)`  -> `<variants>:<prop>-<semantic>(/<opacity>)` (case-insensitive)
 *   brand   `<prop>-brand-<step>`                    -> resolved through the deleted v1 brand scale, then like a hex
 *   gray    `text-gray-400`, `placeholder:text-gray-400`, `placeholder-gray-400` -> fg-subtle / fg-placeholder / …
 * Variants (`hover:`, `focus-visible:`, `md:` …), opacity modifiers and the `!` important marker (prefix or suffix)
 * are kept. A table entry may depend on the class's state variant (e.g. a focus ring maps to `ring`, a selection ring
 * to `accent`).
 *
 * Scope: every string literal and template-literal text of the file, read with the TypeScript parser (class lists
 * live in className attributes, cn()/clsx() arguments and variant maps); a token is rewritten only when the whole
 * whitespace-delimited token is one of the class shapes above. Out of scope (reported with the reason): the react-pdf
 * documents (no Tailwind classes) and inline hex literals (e.g. the dental odontogram's SVG colours). Unmapped
 * (property, hex) pairs are left untouched and listed. Idempotent: a second run changes nothing.
 *
 * Usage: node scripts/design/codemod-colors.mjs [--root <dir>] [--map <file>] [--report <file>] [--dry-run]
 *   default root: the repository (files from `git ls-files`); --root walks a directory (test fixtures).
 * Exit 0 = done (or nothing to do), 1 = --dry-run found changes to make, 2 = usage error.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const IN_SCOPE = /^(app|components|features)\/.*\.tsx$/;
/** State variants that select a table entry, in priority order (group-/peer- forms included). */
const STATES = [
  ["placeholder", /^placeholder$/],
  ["disabled", /^(group-|peer-)?disabled$/],
  ["active", /^(group-|peer-)?active$/],
  ["focus", /^(group-|peer-)?focus(-visible|-within)?$/],
  ["hover", /^(group-|peer-)?hover$/],
];
const INLINE_HEX = /["'`]#[0-9a-fA-F]{3,8}["'`]/g;

/**
 * One class token: variants, optional important prefix, property, colour (hex | brand step | gray-400), optional
 * opacity, optional important suffix.
 */
const TOKEN_RE =
  /^((?:[^\s:[\]]+:)*)(!?)(bg|text|border(?:-[xytrblse])?|outline|ring-offset|ring|divide|from|via|to|fill|stroke|decoration|caret|placeholder)-(?:\[(#[0-9a-fA-F]{3,8})\]|brand-(\d+)|(gray-400))(\/(?:\d+|\[[^\]\s]+\]))?(!?)$/;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) {
    console.error(`codemod-colors: ${name} needs a value`);
    process.exit(2);
  }
  return v;
}

function listFiles(root, useGit) {
  if (useGit) {
    return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean);
  }
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(root, full).split(sep).join("/"));
    }
  };
  walk(root);
  return out.sort();
}

/** The state variant that selects a table entry: the first of STATES present in the variant chain. */
function stateOf(variants) {
  const parts = variants.split(":").filter(Boolean);
  for (const [state, re] of STATES) if (parts.some((p) => re.test(p))) return state;
  return "default";
}

function pick(entry, state) {
  if (entry === undefined) return undefined;
  if (typeof entry === "string") return entry;
  return entry[state] ?? entry.default;
}

export function createCodemod(map) {
  const groupOf = new Map();
  for (const [group, props] of Object.entries(map.groups)) for (const p of props) groupOf.set(p, group);

  /**
   * Rewrites one class token. Returns { out, rule, sourceHex, semantic } when it changes, { unmapped } when the
   * token is a v1 colour class without a table entry, or null when the token is not a codemod target.
   */
  function rewriteToken(token, file) {
    const m = TOKEN_RE.exec(token);
    if (!m) return null;
    const [, variants, bang1, prop, hexRaw, brandStep, gray, opacity = "", bang2] = m;
    const state = stateOf(variants);
    const wrap = (utility) => `${variants}${bang1}${utility}${opacity}${bang2}`;

    if (gray) {
      const named = map.named[`${prop}-gray-400`];
      if (!named) return null; // border-gray-400 & co.: raw palette, reported by the UI policy, not codemodded
      const utility = pick(named, state);
      return { out: wrap(utility), rule: "gray400", sourceHex: "tw-gray-400", semantic: utility.replace(/^[a-z]+-/, "") };
    }

    const hex = hexRaw ? hexRaw.toLowerCase() : map.brandScale[brandStep];
    if (!hex) return { unmapped: { token, reason: `brand-${brandStep} is not a v1 brand step` } };
    const group = groupOf.get(prop);
    const override = map.fileOverrides[file]?.[`${group}:${hex}`];
    const semantic = override ?? pick(map.map[group]?.[hex], state);
    if (!semantic) {
      const reason = map.unmappedOnPurpose[`${group}:${hex}`] ?? "no table entry";
      return { unmapped: { token, prop, hex, reason } };
    }
    return { out: wrap(`${prop}-${semantic}`), rule: hexRaw ? "hex" : "brand", sourceHex: hex, semantic };
  }

  /** Rewrites one file's text; returns the new text plus what changed and what was left. */
  function rewriteSource(file, text) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const edits = [];
    const changes = [];
    const unmapped = [];
    const visitText = (start, end) => {
      const slice = text.slice(start, end);
      let changed = false;
      const next = slice.replace(/\S+/g, (token, offset) => {
        const r = rewriteToken(token, file);
        if (!r) return token;
        const line = sf.getLineAndCharacterOfPosition(start + offset).line + 1;
        if (r.unmapped) {
          unmapped.push({ file, line, ...r.unmapped });
          return token;
        }
        changed = true;
        changes.push({ file, line, from: token, to: r.out, rule: r.rule, sourceHex: r.sourceHex, semantic: r.semantic });
        return r.out;
      });
      if (changed) edits.push({ start, end, next });
    };
    const visit = (node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        visitText(node.getStart(sf) + 1, node.end - 1);
      } else if (ts.isTemplateHead(node)) {
        visitText(node.getStart(sf) + 1, node.end - 2);
      } else if (ts.isTemplateMiddle(node)) {
        visitText(node.getStart(sf) + 1, node.end - 2);
      } else if (ts.isTemplateTail(node)) {
        visitText(node.getStart(sf) + 1, node.end - 1);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    let out = text;
    for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.next + out.slice(e.end);
    return { text: out, changes, unmapped };
  }

  return { rewriteToken, rewriteSource };
}

function main() {
  const rootArg = arg("--root");
  const root = rootArg ? resolve(rootArg) : REPO;
  const map = JSON.parse(readFileSync(arg("--map", join(REPO, "scripts/design/color-map.json")), "utf8"));
  const reportFile = arg("--report");
  const dryRun = process.argv.includes("--dry-run");
  const { rewriteSource } = createCodemod(map);

  const files = listFiles(root, !rootArg).filter((f) => IN_SCOPE.test(f) && existsSync(join(root, f)));
  const outOfScope = map.outOfScope ?? [];
  const perFile = {};
  const allChanges = [];
  const allUnmapped = [];
  const skipped = [];
  const inlineHex = [];

  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    const skip = outOfScope.find((o) => file.startsWith(o.prefix));
    const inline = (text.match(INLINE_HEX) ?? []).length;
    if (skip) {
      skipped.push({ file, reason: skip.reason, inlineHexLiterals: inline });
      continue;
    }
    if (inline) {
      inlineHex.push({ file, inlineHexLiterals: inline, reason: map.inlineHexReported?.[file] ?? "inline hex literal (not a class)" });
    }
    const r = rewriteSource(file, text);
    allUnmapped.push(...r.unmapped);
    if (r.changes.length === 0) continue;
    allChanges.push(...r.changes);
    perFile[file] = r.changes.reduce((acc, c) => ({ ...acc, [c.rule]: (acc[c.rule] ?? 0) + 1 }), {});
    if (!dryRun) writeFileSync(join(root, file), r.text);
  }

  // Collapses: every semantic fed by more than one v1 colour, with the colours and counts.
  const bySemantic = new Map();
  for (const c of allChanges) {
    const key = c.semantic;
    const entry = bySemantic.get(key) ?? {};
    entry[c.sourceHex] = (entry[c.sourceHex] ?? 0) + 1;
    bySemantic.set(key, entry);
  }
  const collapses = [...bySemantic.entries()]
    .filter(([, hexes]) => Object.keys(hexes).length > 1)
    .map(([semantic, hexes]) => ({ semantic, sources: hexes }))
    .sort((a, b) => a.semantic.localeCompare(b.semantic));
  const byRule = allChanges.reduce((acc, c) => ({ ...acc, [c.rule]: (acc[c.rule] ?? 0) + 1 }), {});

  const report = {
    generatedBy: "scripts/design/codemod-colors.mjs",
    mode: dryRun ? "dry-run" : "write",
    totals: { filesChanged: Object.keys(perFile).length, replacements: allChanges.length, byRule },
    files: perFile,
    unmapped: allUnmapped,
    collapses,
    semanticUse: Object.fromEntries(
      [...bySemantic.entries()]
        .map(([s, hexes]) => [s, Object.values(hexes).reduce((a, b) => a + b, 0)])
        .sort((a, b) => a[0].localeCompare(b[0])),
    ),
    outOfScope: skipped,
    inlineHexReported: inlineHex,
  };
  if (reportFile) {
    mkdirSync(dirname(resolve(reportFile)), { recursive: true });
    writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  }
  for (const u of allUnmapped) console.log(`unmapped ${u.file}:${u.line} ${u.token} (${u.reason})`);
  for (const s of skipped) console.log(`out of scope ${s.file} (${s.reason})`);
  console.log(
    `codemod-colors: ${allChanges.length} replacement(s) in ${Object.keys(perFile).length} file(s)${dryRun ? " (dry run, nothing written)" : ""}; ${allUnmapped.length} unmapped`,
  );
  return dryRun && allChanges.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
