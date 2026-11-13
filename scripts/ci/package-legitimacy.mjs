#!/usr/bin/env node
/**
 * Package legitimacy record (V2-03 R-23, T-03-SC; PO action E14). No dependency beyond Node and npm.
 *
 * Compares `package-lock.json` with the lockfile at a base git ref and, for every package entry the change adds or
 * re-versions, records registry metadata from `npm view <name>@<version> repository.url dist.integrity scripts time
 * deprecated`, the lockfile integrity line and whether it equals the registry's, the install-time lifecycle scripts the
 * package declares (`preinstall` / `install` / `postinstall`; `prepare` runs only for git or local installs), the
 * publish date and its age, and whether the version is deprecated. Then it runs `npm audit signatures --json` on the
 * installed tree. The result is merged into the output file under `plans.<plan>`, so later plans (03-12c) add their
 * part without touching earlier ones.
 *
 * Usage: node scripts/ci/package-legitimacy.mjs --base <git ref> --plan <id> --out <file> [--flagged name@ver,...]
 * Exit 0 = written and clean; 1 = written, but an integrity mismatch, an install script, a deprecated version, or an
 * invalid/missing signature was found; 2 = usage or tool error. Prints package names and versions only.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const base = arg("--base");
const plan = arg("--plan");
const out = arg("--out");
const flagged = (arg("--flagged") ?? "").split(",").filter(Boolean);
if (!base || !plan || !out) {
  console.error("usage: package-legitimacy.mjs --base <git ref> --plan <id> --out <file> [--flagged name@ver,...]");
  process.exit(2);
}

const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall"];
const lockText = readFileSync(resolve("package-lock.json"), "utf8");
const current = JSON.parse(lockText).packages;
let previous;
try {
  previous = JSON.parse(execFileSync("git", ["show", `${base}:package-lock.json`], { maxBuffer: 1 << 28 })).packages;
} catch {
  console.error(`package-legitimacy: cannot read package-lock.json at ${base}`);
  process.exit(2);
}

const nameOf = (key) => key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
const changed = Object.keys(current)
  .filter((key) => key.startsWith("node_modules/") || key.includes("/node_modules/"))
  .filter((key) => !previous[key] || previous[key].version !== current[key].version)
  .filter((key) => !current[key].link)
  .sort();

function npmView(spec) {
  const r = spawnSync("npm", ["view", spec, "repository.url", "dist.integrity", "scripts", "time", "deprecated", "--json"], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  if (r.status !== 0) throw new Error(`npm view failed for ${spec}`);
  return JSON.parse(r.stdout);
}

const now = new Date();
const packages = [];
const problems = [];
for (const key of changed) {
  const entry = current[key];
  const name = nameOf(key);
  const spec = `${name}@${entry.version}`;
  const view = npmView(spec);
  const published = view.time?.[entry.version] ?? null;
  const scripts = view.scripts ?? {};
  const installScripts = INSTALL_SCRIPTS.filter((s) => s in scripts);
  const record = {
    lock_path: key,
    name,
    version: entry.version,
    previous_version: previous[key]?.version ?? null,
    dev: entry.dev === true,
    optional: entry.optional === true,
    repository_url: view["repository.url"] ?? null,
    registry_integrity: view["dist.integrity"] ?? null,
    lock_integrity: entry.integrity ?? null,
    integrity_matches: Boolean(entry.integrity) && entry.integrity === view["dist.integrity"],
    lock_has_install_script: entry.hasInstallScript === true,
    install_scripts: installScripts,
    declared_scripts: Object.keys(scripts).sort(),
    published,
    age_days: published ? Math.floor((now.getTime() - Date.parse(published)) / 86_400_000) : null,
    deprecated: view.deprecated ?? null,
    flagged_for_po: flagged.includes(spec),
  };
  if (!record.integrity_matches) problems.push(`${spec}: lockfile integrity differs from the registry`);
  if (installScripts.length > 0 || record.lock_has_install_script) problems.push(`${spec}: declares an install script`);
  if (record.deprecated) problems.push(`${spec}: deprecated`);
  packages.push(record);
}

const sig = spawnSync("npm", ["audit", "signatures", "--json"], { encoding: "utf8", maxBuffer: 1 << 26 });
let signatures;
try {
  const parsed = JSON.parse(sig.stdout);
  signatures = {
    exit_code: sig.status,
    invalid: (parsed.invalid ?? []).map((p) => `${p.name}@${p.version}`),
    missing: (parsed.missing ?? []).map((p) => `${p.name}@${p.version}`),
  };
} catch {
  console.error("package-legitimacy: npm audit signatures did not return JSON");
  process.exit(2);
}
if (signatures.exit_code !== 0 || signatures.invalid.length > 0 || signatures.missing.length > 0) {
  problems.push("npm audit signatures reported invalid or missing signatures");
}
const summary = spawnSync("npm", ["audit", "signatures"], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean);

const record = {
  generated_by: "node scripts/ci/package-legitimacy.mjs",
  generated_at: now.toISOString(),
  base_ref: base,
  base_commit: execFileSync("git", ["rev-parse", base], { encoding: "utf8" }).trim(),
  lockfile_sha256: createHash("sha256").update(lockText).digest("hex"),
  node: process.version,
  npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
  flagged_for_po: flagged,
  packages,
  audit_signatures: { ...signatures, summary },
  problems,
};

const file = resolve(out);
const doc = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { purpose: "", plans: {} };
doc.purpose =
  "V2-03 R-23 / E14: registry metadata, lockfile integrity, install scripts and npm audit signatures for every package entry a plan added; tool output only.";
doc.plans = { ...(doc.plans ?? {}), [plan]: record };
writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);

console.log(`package-legitimacy: ${packages.length} package entries for ${plan}; ${problems.length} problem(s)`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(problems.length > 0 ? 1 : 0);
