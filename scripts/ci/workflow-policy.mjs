#!/usr/bin/env node
/**
 * GitHub Actions workflow policy (V2-03 03-08, hardened in 03-13b M-POLICY; rulings R-9, R-19, R-21; threat T-03-09).
 * Runs in the `static` job over `.github/workflows/*.yml`.
 *
 * Rules (each failure names its rule id, the file and the line):
 *   parseable-yaml              the workflow is block-style YAML this checker reads completely (see "Reader" below);
 *                               anything else fails closed instead of being skipped;
 *   uses-pinned                 every `uses:` is pinned to a full 40-hex commit SHA (`owner/repo[/path]@<sha>`), a
 *                               local action (`./…`) or a digest-pinned image (`docker://…@sha256:<64 hex>`);
 *   top-level-permissions       the workflow declares a top-level `permissions:` block (least-privilege token);
 *   no-write-all                no `permissions: write-all`, at the top or in any job;
 *   no-pull-request-target      no workflow triggers on `pull_request_target` (repo rule RL-2);
 *   staging-no-pr-trigger       a staging workflow (file `staging.yml` / `drift.yml`, or any workflow that references a
 *                               staging secret or uses a `staging*` Environment) triggers only on `push`, `schedule` or
 *                               `workflow_dispatch`, in any YAML form (so never `pull_request*`, `workflow_run`,
 *                               `issue_comment`, ...): PR code never runs next to staging credentials (R-19);
 *   staging-read-only-token     a staging workflow grants no `write` scope (top level or job level) and no `write-all`;
 *   staging-secret-needs-environment
 *                               a staging secret (`secrets.<NAME containing STAGING>`) is referenced only inside a job
 *                               that declares `environment:` (PO approval / branch policy, R-9, R-21), never at the
 *                               workflow level;
 *   staging-secret-step-scope   inside a job, a staging secret appears only in a step's `env:` (never job-level `env`,
 *                               `with:`, `if:` or a `run:` script), so it reaches exactly the one step that needs it;
 *   privileged-no-cache         a privileged job (one with an `environment`, or any job of a staging workflow) restores
 *                               no cache: no `actions/cache*` step and no `cache:` input (e.g. setup-node's npm cache);
 *   privileged-ignore-scripts   in a privileged job every `npm ci` / `npm install` / `pnpm install` runs with
 *                               `--ignore-scripts` (no install script runs next to a staging secret);
 *   privileged-checkout-no-persist
 *                               in a privileged job every `actions/checkout` sets `persist-credentials: false`;
 *   run-no-untrusted-expression no `${{ … }}` in a `run:` script that reads attacker-controllable or secret data
 *                               (`github.head_ref`, `github.event.*`, `inputs.*`, `steps.*.outputs.*`, `secrets.*`);
 *                               in a staging workflow no `${{ … }}` at all in `run:` (values reach the shell through
 *                               `env:` only);
 *   no-secrets-dump             no `toJSON(secrets)` and no `secrets: inherit`;
 *   staging-plan-before-migrate (V2-04 04-00, review A L-5) in `staging.yml`, the `migrate` job `needs: plan`, and the
 *                               `plan` job exists and runs in Environment `staging-readonly` (no reviewer, read-only
 *                               role), so the PO sees the pending migrations before approving `staging`;
 *   staging-db-url-no-password  (04-00, review A L-7) in a staging workflow, every `run:` command that uses the target
 *                               guard's `--print-db-url` also passes `--no-password`: the CLI gets the password as
 *                               `PGPASSWORD` (`--print-pgpassword`), never in argv.
 *
 * Reader (no YAML dependency, deliberately small and fail-closed): block mappings and sequences, plain, single- and
 * double-quoted one-line scalars, `|`/`>` block scalars, `[a, b]` flow sequences of plain scalars and the empty `{}`.
 * Refused with `parseable-yaml`: non-empty flow mappings (`on: { pull_request: … }`), nested flow collections,
 * anchors, aliases, merge keys, tags, multi-document streams, directives, tabs in indentation, duplicate keys and
 * keys that are not plain words. A workflow written in a style the reader refuses is rewritten in the repo style,
 * never allowlisted. `uses:`, staging-secret and secrets-dump scans also run over every line (block scalars
 * included, YAML comments excluded), so a `uses:` look-alike inside a script fails closed.
 *
 * Usage: node scripts/ci/workflow-policy.mjs [<file.yml> ...]   (default: .github/workflows/*.yml|yaml)
 * Exit 0 = pass, 1 = a rule failed, 2 = usage / unreadable file.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STAGING_FILES = new Set(["staging.yml", "staging.yaml", "drift.yml", "drift.yaml"]);
/** The only triggers a staging workflow may have (R-19): never anything a PR, a comment or another run can start. */
const STAGING_TRIGGERS = new Set(["push", "schedule", "workflow_dispatch"]);
const PINNED_ACTION = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_./-]+)?@[0-9a-f]{40}$/;
const PINNED_DOCKER = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/;
const STAGING_SECRET = /secrets\.([A-Za-z0-9_]*STAGING[A-Za-z0-9_]*)|secrets\[\s*['"]([A-Za-z0-9_]*STAGING[A-Za-z0-9_]*)['"]\s*\]/gi;
/** Contexts an attacker can influence, or secrets, that must never be interpolated into a shell script. */
const UNTRUSTED_IN_RUN = /\bgithub\.head_ref\b|\bgithub\.event\b|\bgithub\.event\.|\binputs\.|\bsteps\.[^.\s]+\.outputs\b|\bsecrets\b|\bgithub\.token\b/;
const EXPRESSION = /\$\{\{([\s\S]*?)\}\}/g;
const INSTALL_COMMAND = /\b(npm\s+(?:ci|install|i|add)|pnpm\s+(?:install|i|add)|yarn\s+install)\b/;
/** 04-00 (L-5): the staging deploy workflow whose `migrate` job must wait for the read-only `plan` job. */
const STAGING_DEPLOY_FILES = new Set(["staging.yml", "staging.yaml"]);
const PLAN_JOB = "plan";
const MIGRATE_JOB = "migrate";
const PLAN_ENVIRONMENT = "staging-readonly";

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

// ---------------------------------------------------------------------------------------------------------------------
// Reader: block YAML → { kind: "map", entries: [{ key, line, end, value }] } | { kind: "seq", items: [{ line, end,
// value }] } | { kind: "scalar", value } | null. `line`/`end` are 0-based line indices ([line, end)).
// ---------------------------------------------------------------------------------------------------------------------

class YamlStyleError extends Error {
  constructor(line, message) {
    super(message);
    this.line = line;
  }
}

const KEY_LINE = /^("[A-Za-z0-9_.\/ -]*"|'[A-Za-z0-9_.\/ -]*'|[A-Za-z0-9_][A-Za-z0-9_.\/-]*)\s*:(?:\s+(.*))?$/;
const BLOCK_SCALAR_HEADER = /^[|>](?:[+-]?[1-9]?|[1-9][+-])$/;

function readYaml(text) {
  const raw = text.split(/\r?\n/);
  const lines = raw.map(stripComment);
  const blockScalarLines = new Set();
  const blank = (i) => lines[i].trim() === "";
  const nextContent = (i) => {
    while (i < lines.length && blank(i)) i++;
    return i;
  };

  raw.forEach((line, i) => {
    if (/^\s*\t/.test(line) || /^[ ]*\t/.test(line)) throw new YamlStyleError(i, "tab in indentation");
    if (/^(---|\.\.\.)(\s|$)/.test(lines[i]) || /^%/.test(lines[i])) {
      throw new YamlStyleError(i, "document markers and directives are not supported");
    }
  });

  /** A scalar or collection written on the same line as its key / dash. */
  function inlineValue(rest, i) {
    if (/^[&*!]/.test(rest)) throw new YamlStyleError(i, "anchors, aliases and tags are not supported");
    if (/^[%@`]/.test(rest)) throw new YamlStyleError(i, `a plain scalar cannot start with ${rest[0]}`);
    if (rest.startsWith("{")) {
      if (/^\{\s*\}$/.test(rest)) return { kind: "map", entries: [] };
      throw new YamlStyleError(i, "flow mappings ({ … }) are not supported; write the mapping in block style");
    }
    if (rest.startsWith("[")) {
      const m = /^\[([^\[\]{}]*)\]$/.exec(rest);
      if (!m) throw new YamlStyleError(i, "only flow sequences of plain scalars ([a, b]) are supported");
      const items = m[1].split(",").map((s) => s.trim()).filter(Boolean);
      for (const item of items) if (/^[&*!{[]/.test(item)) throw new YamlStyleError(i, "only plain scalars in flow sequences");
      return { kind: "seq", items: items.map((item) => ({ line: i, end: i + 1, value: { kind: "scalar", value: unquote(item) } })) };
    }
    if (rest.startsWith('"') || rest.startsWith("'")) {
      const q = rest[0];
      let j = 1;
      for (; j < rest.length; j++) {
        if (q === '"' && rest[j] === "\\") j++;
        else if (rest[j] === q) {
          if (q === "'" && rest[j + 1] === "'") j++;
          else break;
        }
      }
      if (j >= rest.length || rest.slice(j + 1).trim() !== "") throw new YamlStyleError(i, "a quoted scalar must open and close on one line");
      return { kind: "scalar", value: rest.slice(1, j) };
    }
    return { kind: "scalar", value: rest };
  }

  /** The value after `key:` or `-` on line i (`rest` = the text after the indicator). Returns { value, next }. */
  function value(rest, i, parentIndent, allowCompactSeq) {
    if (rest === "") {
      const j = nextContent(i + 1);
      if (j < lines.length && indentOf(lines[j]) > parentIndent) return parseNode(j, indentOf(lines[j]));
      if (allowCompactSeq && j < lines.length && indentOf(lines[j]) === parentIndent && /^-(\s|$)/.test(lines[j].trimStart())) {
        return parseSeq(j, parentIndent);
      }
      return { value: null, next: i + 1 };
    }
    if (/^[|>]/.test(rest)) {
      if (!BLOCK_SCALAR_HEADER.test(rest)) throw new YamlStyleError(i, "malformed block scalar header");
      let j = i + 1;
      const body = [];
      while (j < raw.length && (raw[j].trim() === "" || indentOf(raw[j]) > parentIndent)) {
        body.push(raw[j]);
        blockScalarLines.add(j);
        j++;
      }
      while (body.length && body.at(-1).trim() === "") body.pop();
      return { value: { kind: "scalar", value: body.map((l) => l.trim()).join("\n"), block: true }, next: i + 1 + body.length };
    }
    const node = inlineValue(rest, i);
    let j = i + 1;
    if (node.kind === "scalar" && !/^['"]/.test(rest)) {
      // Plain multi-line scalar: more-indented lines continue it.
      const parts = [node.value];
      for (let k = nextContent(j); k < lines.length && indentOf(lines[k]) > parentIndent; k = nextContent(k + 1)) {
        parts.push(lines[k].trim());
        j = k + 1;
      }
      node.value = parts.join(" ");
    } else {
      const k = nextContent(j);
      if (k < lines.length && indentOf(lines[k]) > parentIndent) throw new YamlStyleError(k, "unexpected indentation");
    }
    return { value: node, next: j };
  }

  function parseMap(i, indent) {
    const entries = [];
    const seen = new Set();
    for (i = nextContent(i); i < lines.length; i = nextContent(i)) {
      const ind = indentOf(lines[i]);
      if (ind < indent) break;
      if (ind > indent) throw new YamlStyleError(i, "unexpected indentation");
      const text = lines[i].trimStart();
      if (/^-(\s|$)/.test(text)) break;
      const m = KEY_LINE.exec(text);
      if (!m) throw new YamlStyleError(i, "not a plain `key: value` line (complex keys, merge keys and flow keys are not supported)");
      const key = unquote(m[1]);
      if (seen.has(key)) throw new YamlStyleError(i, `duplicate key \`${key}\``);
      seen.add(key);
      const { value: v, next } = value((m[2] ?? "").trim(), i, indent, true);
      entries.push({ key, line: i, end: next, value: v });
      i = next;
    }
    return { value: { kind: "map", entries }, next: i };
  }

  function parseSeq(i, indent) {
    const items = [];
    for (i = nextContent(i); i < lines.length; i = nextContent(i)) {
      const ind = indentOf(lines[i]);
      if (ind < indent) break;
      if (ind > indent) throw new YamlStyleError(i, "unexpected indentation");
      const text = lines[i].trimStart();
      const m = /^-(?:\s+(.*))?$/.exec(text);
      if (!m) break;
      const content = (m[1] ?? "").trim();
      if (content !== "" && KEY_LINE.test(content)) {
        // `- key: value`: a mapping whose first key sits after the dash; re-indent the line and read the mapping.
        const contentIndent = ind + text.indexOf(content);
        lines[i] = " ".repeat(contentIndent) + content;
        const { value: v, next } = parseMap(i, contentIndent);
        items.push({ line: i, end: next, value: v });
        i = next;
      } else {
        const { value: v, next } = value(content, i, ind, false);
        items.push({ line: i, end: next, value: v });
        i = next;
      }
    }
    return { value: { kind: "seq", items }, next: i };
  }

  function parseNode(i, indent) {
    return /^-(\s|$)/.test(lines[i].trimStart()) ? parseSeq(i, indent) : parseMap(i, indent);
  }

  const start = nextContent(0);
  if (start >= lines.length) return { doc: { kind: "map", entries: [] }, blockScalarLines };
  if (indentOf(lines[start]) !== 0) throw new YamlStyleError(start, "the document must start at column 0");
  const { value: doc, next } = parseNode(start, 0);
  const rest = nextContent(next);
  if (rest < lines.length) throw new YamlStyleError(rest, "content the reader could not attach to the document");
  if (!doc || doc.kind !== "map") throw new YamlStyleError(start, "a workflow must be a mapping");
  return { doc, blockScalarLines };
}

const entryOf = (map, ...keys) => (map && map.kind === "map" ? map.entries.find((e) => keys.includes(e.key)) : undefined);
const scalarOf = (node) => (node && node.kind === "scalar" ? node.value : undefined);

/** Every `secrets.<STAGING…>` reference on `text` (one line). */
function stagingSecretsIn(text) {
  return [...text.matchAll(STAGING_SECRET)].map((m) => m[1] ?? m[2]);
}

/** Trigger names: `on: push`, `on: [push, …]`, a sequence or a mapping of triggers. */
function triggersOf(node) {
  if (!node) return [];
  if (node.kind === "scalar") return [node.value];
  if (node.kind === "seq") return node.items.map((it) => scalarOf(it.value) ?? "(non-scalar trigger)");
  return node.entries.map((e) => e.key);
}

/** `permissions:` problems at one level (top or a job). */
function permissionProblems(node, where, staging, line, fail) {
  if (!node) return;
  const v = scalarOf(node);
  if (v !== undefined) {
    if (v === "write-all") fail(line, "no-write-all", `${where} grants \`write-all\`; declare only the scopes the job needs`);
    return;
  }
  if (node.kind !== "map" || !staging) return;
  for (const e of node.entries) {
    if (scalarOf(e.value) === "write") {
      fail(e.line, "staging-read-only-token", `${where} grants \`${e.key}: write\` in a staging workflow; staging jobs get a read-only token`);
    }
  }
}

/**
 * Checks one workflow's text. `file` is used for messages and the staging-file rule.
 * @returns {{ file: string, line: number, rule: string, message: string }[]}
 */
export function checkWorkflow(file, text) {
  const base = path.basename(file);
  const raw = text.split(/\r?\n/);
  const stripped = raw.map(stripComment);
  const failures = [];
  const fail = (line, rule, message) => failures.push({ file, line: line + 1, rule, message });

  let parsed = null;
  try {
    parsed = readYaml(text);
  } catch (e) {
    if (!(e instanceof YamlStyleError)) throw e;
    fail(e.line, "parseable-yaml", `${e.message}; this checker reads block-style YAML only (fail closed)`);
  }
  // Line scans: YAML comments excluded, block scalars (scripts) scanned raw, since `${{ }}` in a shell comment still
  // interpolates.
  const scan = raw.map((line, i) => (parsed?.blockScalarLines.has(i) ? line : stripped[i]));

  scan.forEach((line, i) => {
    const m = /^\s*(?:-\s+)?uses:\s*(.+)$/.exec(line);
    if (!m) return;
    const ref = unquote(m[1]);
    if (ref.startsWith("./")) return;
    if (ref.startsWith("docker://") ? !PINNED_DOCKER.test(ref) : !PINNED_ACTION.test(ref)) {
      fail(i, "uses-pinned", `\`uses: ${ref}\` is not pinned to a full commit SHA (or a sha256 image digest)`);
    }
  });
  scan.forEach((line, i) => {
    if (/toJSON\(\s*secrets\s*\)/i.test(line)) fail(i, "no-secrets-dump", "`toJSON(secrets)` exposes every secret");
    if (/^\s*secrets:\s*inherit\s*$/.test(line)) fail(i, "no-secrets-dump", "`secrets: inherit` passes every secret to a called workflow");
  });
  const stagingRefs = [];
  scan.forEach((line, i) => {
    for (const name of stagingSecretsIn(line)) stagingRefs.push({ line: i, name });
  });

  if (!parsed) return failures.sort((a, b) => a.line - b.line);
  const { doc } = parsed;

  const permissions = entryOf(doc, "permissions");
  if (!permissions) fail(0, "top-level-permissions", "no top-level `permissions:` block (declare the least privilege the token needs)");

  const onEntry = entryOf(doc, "on", "true");
  const triggers = triggersOf(onEntry?.value);
  const onLine = onEntry ? onEntry.line : 0;
  if (triggers.includes("pull_request_target")) {
    fail(onLine, "no-pull-request-target", "`pull_request_target` runs PR code with the base repository's secrets");
  }

  const jobsNode = entryOf(doc, "jobs")?.value;
  const jobs = (jobsNode?.kind === "map" ? jobsNode.entries : []).map((e) => {
    const envNode = entryOf(e.value, "environment")?.value;
    const environment = envNode ? (scalarOf(envNode) ?? scalarOf(entryOf(envNode, "name")?.value) ?? "(unnamed)") : null;
    return { id: e.key, start: e.line, end: e.end, node: e.value, environment };
  });
  const usesStagingEnvironment = jobs.some((j) => j.environment && /staging/i.test(j.environment));
  const isStaging = STAGING_FILES.has(base) || stagingRefs.length > 0 || usesStagingEnvironment;

  if (isStaging) {
    for (const t of triggers.filter((t) => !STAGING_TRIGGERS.has(t))) {
      fail(onLine, "staging-no-pr-trigger", `staging workflow triggers on \`${t}\`; staging runs only from feature/v2 (push, schedule, dispatch)`);
    }
  }
  permissionProblems(permissions?.value, "the workflow", isStaging, permissions?.line ?? 0, fail);

  for (const ref of stagingRefs) {
    const job = jobs.find((j) => ref.line >= j.start && ref.line < j.end);
    if (!job) {
      fail(ref.line, "staging-secret-needs-environment", `secrets.${ref.name} is referenced outside a job (workflow-level); scope it to a step of a job with \`environment:\``);
    } else if (!job.environment) {
      fail(ref.line, "staging-secret-needs-environment", `job \`${job.id}\` uses secrets.${ref.name} without declaring \`environment:\``);
    }
  }

  // 04-00 (L-5): in staging.yml the approval of `migrate` is preceded by the read-only plan.
  if (STAGING_DEPLOY_FILES.has(base)) {
    const migrate = jobs.find((j) => j.id === MIGRATE_JOB);
    const plan = jobs.find((j) => j.id === PLAN_JOB);
    if (migrate) {
      const needsNode = entryOf(migrate.node, "needs")?.value;
      const needs = needsNode ? (needsNode.kind === "seq" ? needsNode.items.map((it) => scalarOf(it.value)) : [scalarOf(needsNode)]) : [];
      if (!needs.includes(PLAN_JOB)) {
        fail(migrate.start, "staging-plan-before-migrate", `job \`${MIGRATE_JOB}\` must declare \`needs: ${PLAN_JOB}\` (the PO sees the pending migrations before approving)`);
      }
      if (!plan) {
        fail(migrate.start, "staging-plan-before-migrate", `no \`${PLAN_JOB}\` job: \`${MIGRATE_JOB}\` must be preceded by the read-only plan in \`${PLAN_ENVIRONMENT}\``);
      }
    }
    if (plan && plan.environment !== PLAN_ENVIRONMENT) {
      fail(plan.start, "staging-plan-before-migrate", `job \`${PLAN_JOB}\` must run in Environment \`${PLAN_ENVIRONMENT}\` (read-only, no reviewer), not \`${plan.environment ?? "none"}\``);
    }
  }

  for (const job of jobs) {
    const permEntry = entryOf(job.node, "permissions");
    if (permEntry) permissionProblems(permEntry.value, `job \`${job.id}\``, isStaging, permEntry.line, fail);
    const stepsNode = entryOf(job.node, "steps")?.value;
    const steps = stepsNode?.kind === "seq" ? stepsNode.items : [];

    // Staging secrets only in a step's `env:`.
    const stepEnvRanges = steps
      .map((s) => entryOf(s.value, "env"))
      .filter(Boolean)
      .map((e) => [e.line, e.end]);
    for (const ref of stagingRefs.filter((r) => r.line >= job.start && r.line < job.end)) {
      if (!stepEnvRanges.some(([a, b]) => ref.line >= a && ref.line < b)) {
        fail(ref.line, "staging-secret-step-scope", `job \`${job.id}\` references secrets.${ref.name} outside a step's \`env:\`; give it only to the step that needs it`);
      }
    }

    const privileged = Boolean(job.environment) || isStaging;
    for (const step of steps) {
      const uses = scalarOf(entryOf(step.value, "uses")?.value);
      const withNode = entryOf(step.value, "with")?.value;
      const run = entryOf(step.value, "run");
      const runText = scalarOf(run?.value) ?? "";

      for (const m of runText.matchAll(EXPRESSION)) {
        const expr = m[1].trim();
        if (UNTRUSTED_IN_RUN.test(expr)) {
          fail(run.line, "run-no-untrusted-expression", `\`run:\` in job \`${job.id}\` interpolates \`\${{ ${expr} }}\`; pass it through \`env:\` and quote the variable`);
        } else if (isStaging) {
          fail(run.line, "run-no-untrusted-expression", `\`run:\` in staging job \`${job.id}\` interpolates \`\${{ ${expr} }}\`; staging scripts read values from \`env:\` only`);
        }
      }

      // 04-00 (L-7): a database URL printed for a CLI carries no password in a staging workflow.
      if (isStaging) {
        runText.split("\n").forEach((cmd) => {
          if (/--print-db-url\b/.test(cmd) && !/--no-password\b/.test(cmd)) {
            fail(run.line, "staging-db-url-no-password", `\`run:\` in staging job \`${job.id}\` uses \`--print-db-url\` without \`--no-password\`; pass the password as PGPASSWORD (\`--print-pgpassword\`), never in argv`);
          }
        });
      }

      if (!privileged) continue;
      if (uses && /^actions\/cache(\/|@)/.test(uses)) {
        fail(step.line, "privileged-no-cache", `privileged job \`${job.id}\` restores a cache (\`${uses.split("@")[0]}\`); no restored file may run next to a staging secret`);
      }
      const cacheInput = entryOf(withNode, "cache");
      if (cacheInput && (scalarOf(cacheInput.value) ?? "") !== "") {
        fail(cacheInput.line, "privileged-no-cache", `privileged job \`${job.id}\` sets \`cache:\` on \`${uses ?? "a step"}\`; no restored cache in a privileged job`);
      }
      if (uses && /^actions\/checkout@/.test(uses) && scalarOf(entryOf(withNode, "persist-credentials")?.value) !== "false") {
        fail(step.line, "privileged-checkout-no-persist", `privileged job \`${job.id}\` checks out without \`persist-credentials: false\``);
      }
      runText.split("\n").forEach((cmd) => {
        if (INSTALL_COMMAND.test(cmd) && !/--ignore-scripts\b/.test(cmd)) {
          fail(run.line, "privileged-ignore-scripts", `privileged job \`${job.id}\` runs \`${INSTALL_COMMAND.exec(cmd)[1]}\` without \`--ignore-scripts\``);
        }
      });
    }
  }

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
