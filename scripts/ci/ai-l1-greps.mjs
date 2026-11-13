#!/usr/bin/env node
/**
 * AI-06 L1 policy checks (V2-02 plan 02-01 step 5; AI_STRATEGY §5.3 and AI-P0; roadmap §15.8). These are CI policy
 * checks like ESLint rules (ruling RL-11), not tests: they read tracked source and fail the `static` job.
 *
 * Rules (paths are repo-relative):
 *   L1-R1 routes          no file under app/api/ai/**; no route/page file under app/ whose path contains "copilot".
 *   L1-R2 removed AI      no MockAiProvider, CopilotDrawer, operations-copilot, clinical-copilot,
 *                         parseShorthandLocally in app/ features/ lib/ components/.
 *   L1-R3 test branches   no VITEST, test-api-key, AI_EVAL_LIVE in app/ components/ features/ lib/ or proxy.ts
 *                         (widened from lib/ai + features/ai in V2-03 03-10 once the two lib/webhooks branches were gone;
 *                         P2-03, RL-12). Tests, scripts and config files are out of scope.
 *   L1-R4 AI glyph        a Sparkles icon in JSX or the ✦ glyph in UI copy only in LLM-feature files.
 *   L1-R5 "AI" in copy    the word AI (case-sensitive, word boundary) in JSX text or string literals of .tsx files under
 *                         app/ components/ features/ only in LLM-feature files and features/ai/**.
 *   L1-R6 AI + price      AI within 80 characters of ₹, Rs, INR, /month, per month, Buy, Upgrade, Subscribe, Add to plan
 *                         in UI copy anywhere under app/ components/ features/ lib/ (PO-21). NO exceptions: the
 *                         allowlist cannot waive it.
 * "UI copy" = JSX text, string literals and template-literal text, read with the TypeScript parser (comments, import
 * paths and identifiers are not copy).
 *
 * Time-boxed exceptions live in scripts/ci/ai-l1-allowlist.json: { file, rule, reason, owner, expires }. An entry
 * waives every finding of that rule in that file. Expired entries, entries dated more than 90 days ahead and entries
 * that no longer match anything (stale) fail the check.
 *
 * Usage: node scripts/ci/ai-l1-greps.mjs [--root <dir>] [--allowlist <file>] [--today YYYY-MM-DD]
 *   default: the files `git ls-files` lists in the current directory; --root scans a directory tree instead
 *   (fixtures under lint-fixtures/ai-l1/, used by tests/ci/ai-l1-greps.spec.ts).
 * Exit 0 = pass, 1 = violation, 2 = usage error.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";

/** LLM features: the only places the AI label and the sparkle glyph may appear (AI_STRATEGY §5.3). */
const LLM_FEATURE_FILES = new Set([
  "components/consultation/ai-scribe-modal.tsx",
  "components/consultation/returning-patient-catchup.tsx",
]);
const MAX_WAIVER_DAYS = 90;
const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const APP_CODE = /^(app|features|lib|components)\/|^proxy\.ts$/;
const SPARKLE_NAME = /^(Sparkles?|Sparkles?Icon|LucideSparkles?)$/;
const PURCHASE_CASED = /₹|\bRs\b|\bINR\b/;
const PURCHASE_ANYCASE = /\/\s?month|\bper month\b|\bbuy\b|\bupgrade\b|\bsubscribe\b|\badd to plan\b/i;
const AI_WORD = /\bAI\b/g;
const WINDOW = 80;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
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

/** UI-copy segments of a source file: JSX text, string literals and template text, with their line numbers. */
function copySegments(file, text) {
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const segments = [];
  const sparkleLocals = new Set();
  const sparkleTags = [];
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
      const named = clause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          const imported = (el.propertyName ?? el.name).text;
          if (SPARKLE_NAME.test(imported)) sparkleLocals.add(el.name.text);
        }
      }
      return; // module specifiers are not copy
    }
    if (ts.isExternalModuleReference(node)) return;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") return;
    if (ts.isJsxText(node)) {
      if (node.text.trim()) segments.push({ text: node.text.replace(/\s+/g, " ").trim(), line: lineOf(node) });
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (node.text.trim()) segments.push({ text: node.text, line: lineOf(node) });
    } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      sparkleTags.push({ tag, line: lineOf(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const sparkles = sparkleTags.filter((t) => sparkleLocals.has(t.tag) || SPARKLE_NAME.test(t.tag.split(".").pop()));
  return { segments, sparkles };
}

const snippet = (s) => (s.length > 70 ? `${s.slice(0, 67)}...` : s);

function check(root, files) {
  const findings = [];
  const add = (rule, file, line, detail) => findings.push({ rule, file, line, detail });
  const read = (file) => readFileSync(join(root, file), "utf8");

  for (const file of files) {
    if (!APP_CODE.test(file)) continue;
    const full = join(root, file);
    if (!existsSync(full) || !statSync(full).isFile()) continue;

    // L1-R1 routes (path only)
    if (file.startsWith("app/api/ai/")) add("L1-R1", file, 0, "route under app/api/ai/");
    if (file.startsWith("app/") && /(^|\/)(route|page)\.[jt]sx?$/.test(file) && /copilot/i.test(file)) {
      add("L1-R1", file, 0, "copilot route/page");
    }
    if (!SOURCE_RE.test(file) && !/\.(json|css|md)$/.test(file)) continue;
    const text = read(file);
    const lines = text.split("\n");

    // L1-R2 removed AI surfaces, L1-R3 test branches in app code (raw text: identifiers and strings alike)
    const raw = (rule, re) =>
      lines.forEach((l, i) => {
        const m = re.exec(l);
        if (m) add(rule, file, i + 1, m[0]);
      });
    raw("L1-R2", /\b(MockAiProvider|CopilotDrawer|parseShorthandLocally)\b|operations-copilot|clinical-copilot/);
    raw("L1-R3", /\bVITEST\b|test-api-key|\bAI_EVAL_LIVE\b/);

    if (!SOURCE_RE.test(file)) continue;
    const { segments, sparkles } = copySegments(file, text);
    const llm = LLM_FEATURE_FILES.has(file);

    // L1-R4 AI glyph
    if (!llm) {
      for (const s of sparkles) add("L1-R4", file, s.line, `<${s.tag}>`);
      for (const seg of segments) if (seg.text.includes("✦")) add("L1-R4", file, seg.line, snippet(seg.text));
    }

    // L1-R5 "AI" in UI copy (.tsx under app/ components/ features/)
    if (file.endsWith(".tsx") && /^(app|components|features)\//.test(file) && !llm && !file.startsWith("features/ai/")) {
      for (const seg of segments) {
        AI_WORD.lastIndex = 0;
        if (AI_WORD.test(seg.text)) add("L1-R5", file, seg.line, snippet(seg.text));
      }
    }

    // L1-R6 AI next to a price or purchase action (adjacent copy segments joined, so <b>AI</b><i>₹99</i> counts)
    let joined = "";
    const starts = [];
    for (const seg of segments) {
      starts.push({ at: joined.length, line: seg.line });
      joined += `${seg.text} `;
    }
    const reported = new Set();
    for (const m of joined.matchAll(AI_WORD)) {
      const windowText = joined.slice(Math.max(0, m.index - WINDOW), m.index + 2 + WINDOW);
      if (!PURCHASE_CASED.test(windowText) && !PURCHASE_ANYCASE.test(windowText)) continue;
      const line = [...starts].reverse().find((s) => s.at <= m.index)?.line ?? 0;
      if (reported.has(line)) continue;
      reported.add(line);
      add("L1-R6", file, line, snippet(windowText.trim()));
    }
  }
  return findings;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

function applyAllowlist(findings, allowlist, today) {
  const problems = [];
  if (!Array.isArray(allowlist)) return { problems: ["allowlist must be a JSON array"], waived: [], open: findings };
  const todayMs = Date.parse(today);
  const usable = [];
  allowlist.forEach((e, i) => {
    const label = `allowlist[${i}] ${e?.rule ?? "?"} ${e?.file ?? "?"}`;
    const missing = ["file", "rule", "reason", "owner", "expires"].filter(
      (k) => typeof e?.[k] !== "string" || e[k].trim() === "",
    );
    if (missing.length) return problems.push(`${label}: missing field(s) ${missing.join(", ")}`);
    if (e.rule === "L1-R6") return problems.push(`${label}: L1-R6 (AI next to a price or purchase action) has no exceptions`);
    if (!/^L1-R[1-5]$/.test(e.rule)) return problems.push(`${label}: unknown rule`);
    if (!isDate(e.expires)) return problems.push(`${label}: expires must be YYYY-MM-DD`);
    const exp = Date.parse(e.expires);
    if (exp < todayMs) problems.push(`${label}: exception EXPIRED on ${e.expires} (owner ${e.owner})`);
    else if (exp - todayMs > MAX_WAIVER_DAYS * DAY_MS) problems.push(`${label}: expires more than ${MAX_WAIVER_DAYS} days ahead`);
    else usable.push(e);
    if (!findings.some((f) => f.file === e.file && f.rule === e.rule)) {
      problems.push(`${label}: STALE exception, matches nothing any more (remove it)`);
    }
  });
  const isWaived = (f) => usable.some((e) => e.file === f.file && e.rule === f.rule);
  return { problems, waived: findings.filter(isWaived), open: findings.filter((f) => !isWaived(f)) };
}

function main() {
  const rootArg = arg("--root");
  const root = resolve(rootArg ?? ".");
  const today = arg("--today") ?? new Date().toISOString().slice(0, 10);
  if (!isDate(today)) {
    console.error("ai-l1: --today must be YYYY-MM-DD");
    process.exit(2);
  }
  const allowlistFile = resolve(arg("--allowlist") ?? "scripts/ci/ai-l1-allowlist.json");
  let allowlist;
  try {
    allowlist = JSON.parse(readFileSync(allowlistFile, "utf8"));
  } catch {
    console.error(`ai-l1: cannot read allowlist ${allowlistFile}`);
    process.exit(2);
  }
  const files = listFiles(root, !rootArg);
  const findings = check(root, files);
  const { problems, waived, open } = applyAllowlist(findings, allowlist, today);

  console.log(`ai-l1: ${files.length} files, ${findings.length} finding(s), ${waived.length} waived (time-boxed)`);
  for (const f of waived) console.log(`  waived ${f.rule} ${f.file}:${f.line}`);
  for (const f of open) console.error(`FAIL ${f.rule} ${f.file}:${f.line} ${f.detail}`);
  for (const p of problems) console.error(`FAIL ${p}`);
  if (open.length || problems.length) process.exit(1);
  console.log("ai-l1: PASS");
}

main();
