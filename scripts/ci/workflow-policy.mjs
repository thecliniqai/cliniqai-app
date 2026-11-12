#!/usr/bin/env node
/**
 * GitHub Actions workflow policy (V2-03 03-08; rulings R-9, R-19, R-21; threat T-03-09). Runs in the `static` job over
 * `.github/workflows/*.yml`.
 *
 * Rules (each failure names its rule id, the file and the line):
 *   uses-pinned                 every `uses:` is pinned to a full 40-hex commit SHA (`owner/repo[/path]@<sha>`), a
 *                               local action (`./…`) or a digest-pinned image (`docker://…@sha256:<64 hex>`);
 *   top-level-permissions       the workflow declares a top-level `permissions:` block (least-privilege token);
 *   no-pull-request-target      no workflow triggers on `pull_request_target` (repo rule RL-2);
 *   staging-no-pr-trigger       a staging workflow (file `staging.yml` / `drift.yml`, or any workflow that references a
 *                               staging secret or uses a `staging*` Environment) has no `pull_request`,
 *                               `pull_request_target` or `workflow_run` trigger: PR code never runs next to staging
 *                               credentials (R-19);
 *   staging-secret-needs-environment
 *                               a staging secret (`secrets.<NAME containing STAGING>`) is referenced only inside a job
 *                               that declares `environment:` (PO approval / branch policy, R-9, R-21), never at the
 *                               workflow level;
 *   no-secrets-dump             no `toJSON(secrets)` and no `secrets: inherit`.
 *
 * Documented limits (line-based, no YAML parser, deliberately): comments are stripped outside quotes; block scalars
 * (`run: |`) are scanned like any other line, so a shell line that looks like `uses: x@v1` fails closed; flow-style
 * mappings for `on`/`jobs`, YAML anchors and aliases are not resolved; job keys must be indented consistently (two
 * spaces under `jobs:` in this repo). A workflow written in a style this checker cannot read should be rewritten in
 * the repo style rather than allowlisted.
 *
 * Usage: node scripts/ci/workflow-policy.mjs [<file.yml> ...]   (default: .github/workflows/*.yml|yaml)
 * Exit 0 = pass, 1 = a rule failed, 2 = usage / unreadable file.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STAGING_FILES = new Set(["staging.yml", "staging.yaml", "drift.yml", "drift.yaml"]);
const PR_TRIGGERS = ["pull_request", "pull_request_target", "workflow_run"];
const PINNED_ACTION = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_./-]+)?@[0-9a-f]{40}$/;
const PINNED_DOCKER = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/;
const STAGING_SECRET = /secrets\.([A-Za-z0-9_]*STAGING[A-Za-z0-9_]*)|secrets\[\s*['"]([A-Za-z0-9_]*STAGING[A-Za-z0-9_]*)['"]\s*\]/i;

/** The line without its comment (a `#` that starts the line or follows whitespace, outside quotes). */
export function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).trimEnd();
  }
  return line.trimEnd();
}

const indentOf = (line) => line.length - line.trimStart().length;
const unquote = (s) => s.trim().replace(/^(['"])(.*)\1$/, "$2");

/** Top-level key → [start, end) line ranges (indices into `lines`). */
function topLevelBlocks(lines) {
  const blocks = new Map();
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(["']?)([A-Za-z_][A-Za-z0-9_-]*)\1:(.*)$/.exec(lines[i]);
    if (m && indentOf(lines[i]) === 0) {
      if (current) current.end = i;
      current = { key: m[2], start: i, end: lines.length, rest: m[3].trim() };
      blocks.set(m[2], current);
    }
  }
  return blocks;
}

/** Trigger names from the `on:` block (`on: push`, `on: [push, pull_request]` or a block of keys / list items). */
function triggersOf(lines, block) {
  if (!block) return [];
  if (block.rest) {
    const inline = block.rest.replace(/^\[|\]$/g, "");
    return inline.split(",").map(unquote).filter(Boolean);
  }
  const names = [];
  let childIndent = null;
  for (let i = block.start + 1; i < block.end; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = indentOf(line);
    if (childIndent === null) childIndent = indent;
    if (indent !== childIndent) continue;
    const item = /^\s*-\s*(.+)$/.exec(line);
    if (item) names.push(unquote(item[1]));
    const key = /^\s*(["']?)([A-Za-z_][A-Za-z0-9_-]*)\1:/.exec(line);
    if (key) names.push(key[2]);
  }
  return names;
}

/** Jobs under `jobs:`: id, line range, whether a job-level `environment:` is declared. */
function jobsOf(lines, block) {
  if (!block) return [];
  const jobs = [];
  let jobIndent = null;
  for (let i = block.start + 1; i < block.end; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = indentOf(line);
    if (jobIndent === null) jobIndent = indent;
    const m = /^\s*(["']?)([A-Za-z_][A-Za-z0-9_-]*)\1:\s*$/.exec(line);
    if (indent === jobIndent && m) {
      if (jobs.length) jobs.at(-1).end = i;
      jobs.push({ id: m[2], start: i, end: block.end, environment: null });
    }
  }
  for (const job of jobs) {
    let keyIndent = null;
    for (let i = job.start + 1; i < job.end; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      if (keyIndent === null) keyIndent = indentOf(line);
      if (indentOf(line) !== keyIndent) continue;
      const env = /^\s*environment:\s*(.*)$/.exec(line);
      if (env) {
        let name = unquote(env[1]);
        if (!name) {
          const next = lines.slice(i + 1, job.end).find((l) => /^\s*name:/.test(l));
          name = next ? unquote(next.replace(/^\s*name:/, "")) : "";
        }
        job.environment = name || "(unnamed)";
      }
    }
  }
  return jobs;
}

/**
 * Checks one workflow's text. `file` is used for messages and the staging-file rule.
 * @returns {{ file: string, line: number, rule: string, message: string }[]}
 */
export function checkWorkflow(file, text) {
  const base = path.basename(file);
  const lines = text.split(/\r?\n/).map(stripComment);
  const blocks = topLevelBlocks(lines);
  const failures = [];
  const fail = (line, rule, message) => failures.push({ file, line: line + 1, rule, message });

  lines.forEach((line, i) => {
    const m = /^\s*(?:-\s+)?uses:\s*(.+)$/.exec(line);
    if (!m) return;
    const ref = unquote(m[1]);
    if (ref.startsWith("./")) return;
    if (ref.startsWith("docker://") ? !PINNED_DOCKER.test(ref) : !PINNED_ACTION.test(ref)) {
      fail(i, "uses-pinned", `\`uses: ${ref}\` is not pinned to a full commit SHA (or a sha256 image digest)`);
    }
  });

  if (!blocks.has("permissions")) fail(0, "top-level-permissions", "no top-level `permissions:` block (declare the least privilege the token needs)");

  const onBlock = blocks.get("on") ?? blocks.get("true");
  const triggers = triggersOf(lines, onBlock);
  const onLine = onBlock ? onBlock.start : 0;
  if (triggers.includes("pull_request_target")) {
    fail(onLine, "no-pull-request-target", "`pull_request_target` runs PR code with the base repository's secrets");
  }

  const jobs = jobsOf(lines, blocks.get("jobs"));
  const stagingRefs = [];
  lines.forEach((line, i) => {
    const m = STAGING_SECRET.exec(line);
    if (m) stagingRefs.push({ line: i, name: m[1] ?? m[2] });
  });
  const usesStagingEnvironment = jobs.some((j) => j.environment && /staging/i.test(j.environment));
  const isStaging = STAGING_FILES.has(base) || stagingRefs.length > 0 || usesStagingEnvironment;
  if (isStaging) {
    for (const t of triggers.filter((t) => PR_TRIGGERS.includes(t))) {
      fail(onLine, "staging-no-pr-trigger", `staging workflow triggers on \`${t}\`; staging runs only from feature/v2 (push, schedule, dispatch)`);
    }
  }

  for (const ref of stagingRefs) {
    const job = jobs.find((j) => ref.line > j.start && ref.line < j.end);
    if (!job) {
      fail(ref.line, "staging-secret-needs-environment", `secrets.${ref.name} is referenced outside a job (workflow-level); scope it to a step of a job with \`environment:\``);
    } else if (!job.environment) {
      fail(ref.line, "staging-secret-needs-environment", `job \`${job.id}\` uses secrets.${ref.name} without declaring \`environment:\``);
    }
  }

  lines.forEach((line, i) => {
    if (/toJSON\(\s*secrets\s*\)/i.test(line)) fail(i, "no-secrets-dump", "`toJSON(secrets)` exposes every secret");
    if (/^\s*secrets:\s*inherit\s*$/.test(line)) fail(i, "no-secrets-dump", "`secrets: inherit` passes every secret to a called workflow");
  });

  return failures.sort((a, b) => a.line - b.line);
}

function defaultFiles() {
  const dir = path.join(REPO_ROOT, ".github/workflows");
  return fs
    .readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

function main(argv) {
  if (argv.some((a) => a.startsWith("-"))) {
    console.error("usage: node scripts/ci/workflow-policy.mjs [<file.yml> ...]");
    return 2;
  }
  const files = argv.length ? argv.map((f) => path.resolve(f)) : defaultFiles();
  const failures = [];
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      console.error(`workflow-policy: cannot read ${file}`);
      return 2;
    }
    failures.push(...checkWorkflow(path.relative(REPO_ROOT, file), text));
  }
  if (failures.length) {
    for (const f of failures) console.error(`workflow-policy: FAIL ${f.file}:${f.line} [${f.rule}] ${f.message}`);
    console.error(`workflow-policy: ${failures.length} problem(s) in ${files.length} workflow(s)`);
    return 1;
  }
  console.log(`workflow-policy: PASS (${files.length} workflow(s))`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main(process.argv.slice(2)));
}
