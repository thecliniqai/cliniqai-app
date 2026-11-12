#!/usr/bin/env node
/**
 * Doc-grep test gate (V2-02 plan 02-04, `static` job; TEST_STRATEGY §9.6 / E-5 / T-12).
 *
 * A test that reads a markdown file under `docs/` and asserts on its wording proves nothing about the product, yet
 * counts as passing coverage. This gate fails when any file under `tests/` both
 *   - calls a filesystem read API (readFileSync, readFile, existsSync, createReadStream, readdirSync, statSync,
 *     openSync, accessSync), and
 *   - contains a string literal that is a path into the repository's `docs/` tree: one that starts with `docs/`
 *     (optionally after `./` or `../` segments), the bare segment `"docs"` (as in `path.join(ROOT, "docs", ...)`),
 *     or a template literal with `}/docs/` (as in `${ROOT}/docs/...`).
 * Imports such as `@/app/api/v1/docs/route` and prose that mentions a doc ("see docs/v2/X.md") do not match.
 *
 * Allowlist: empty by design. A genuine need (none known) must be added here with a reason and PO approval.
 * Usage: node scripts/ci/assert-no-doc-grep-tests.mjs [--root <dir>]   (scans <root>/tests)
 * Exit 0 = pass, 1 = doc-grep test found.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/** Repo-relative test files allowed to read docs/, each with a reason. Empty by design. */
const ALLOWLIST = new Map();

const i = process.argv.indexOf("--root");
const root = resolve(i > -1 ? process.argv[i + 1] : ".");
const testsDir = join(root, "tests");

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const FS_READ = /\b(?:readFileSync|readFile|existsSync|createReadStream|readdirSync|statSync|openSync|accessSync)\s*\(/;
const LITERAL = /'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|"([^"\\\n]*(?:\\.[^"\\\n]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`/g;

/** True when a string literal's content is a path into docs/. */
function isDocsPath(text, isTemplate) {
  if (text === "docs") return true;
  if (/^(?:\.{1,2}\/)*docs\//.test(text)) return true;
  if (isTemplate && /\}\/docs(?:\/|$)/.test(text)) return true;
  return false;
}

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (SOURCE.test(entry.name)) files.push(full);
  }
};
if (existsSync(testsDir)) walk(testsDir);

const problems = [];
for (const file of files) {
  const rel = relative(root, file).split(sep).join("/");
  if (ALLOWLIST.has(rel)) continue;
  const source = readFileSync(file, "utf8");
  if (!FS_READ.test(source)) continue;
  for (const m of source.matchAll(LITERAL)) {
    const isTemplate = m[3] !== undefined;
    const text = m[1] ?? m[2] ?? m[3] ?? "";
    if (isDocsPath(text, isTemplate)) {
      const line = source.slice(0, m.index).split("\n").length;
      problems.push(`${rel}:${line} reads a path under docs/ (${JSON.stringify(text.slice(0, 80))})`);
    }
  }
}

if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error("Tests must assert product behaviour, not documentation wording (TEST_STRATEGY §9.6).");
  process.exit(1);
}
console.log(`doc-grep: PASS (${files.length} test files scanned; none reads docs/)`);
