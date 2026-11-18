#!/usr/bin/env node
/**
 * Integrity diagnostics, LOCAL STACK ONLY (V2-05 plan 05-03; BACKEND_MIGRATION_PLAN §3 D0-D10; R-15; T-05-22).
 *
 * Runs scripts/db/diagnostics.sql inside the local stack's Postgres container (`docker exec … psql`, exactly like
 * tests/helpers/sql.ts: the container named after supabase/config.toml's project_id, never a URL), in a
 * `READ ONLY` transaction that is rolled back, and writes the COUNTS ONLY (never a row) to
 *   <out-dir>/<label>.json      (default out-dir: the V2-05 phase evidence, evidence/05a/diagnostics)
 *
 * Refusals (exit 1, before any query or docker call):
 * - `--db-url <url>` whose host is not loopback (127.0.0.1 / localhost / ::1), or whose port is not the local
 *   stack's db port from supabase/config.toml. A loopback `--db-url` is only an assertion: the tool always reads the
 *   local container, which IS that database.
 * - `--linked`, `--project-ref`, `--workdir`, any other unknown flag, any positional argument, a bare connection string.
 * - `DOCKER_HOST` naming a non-loopback daemon (the "local container" would then live on another machine).
 * - A label that is not `[a-z0-9][a-z0-9-]*` (it becomes a file name).
 *
 * Usage: npm run db:diagnostics -- --label <label> [--out-dir <dir>] [--db-url <loopback url>]
 * Exit: 0 written; 1 refused or failed. The counts are also printed (no row data).
 */
import { spawnSync as nodeSpawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SQL_FILE = path.join(ROOT, "scripts/db/diagnostics.sql");
export const DEFAULT_OUT_DIR = ".planning/phases/05-db-authorisation-entitlements/evidence/05a/diagnostics";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const LABEL = /^[a-z0-9][a-z0-9-]{0,62}$/;

function readConfig(root) {
  const toml = fs.readFileSync(path.join(root, "supabase/config.toml"), "utf8");
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  // The [db] section's `port = …` (the first `port` after the `[db]` header).
  const dbSection = /^\[db\]\s*$([\s\S]*?)(?=^\[)/m.exec(toml)?.[1] ?? "";
  const dbPort = /^port\s*=\s*(\d+)/m.exec(dbSection)?.[1];
  if (!projectId || !dbPort) throw new Error("project_id or [db] port not found in supabase/config.toml");
  return { container: `supabase_db_${projectId}`, dbPort: Number(dbPort) };
}

/**
 * @param {string} url
 * @param {number} dbPort
 * @returns {string | null} a refusal reason, or null when the URL names the local stack's database
 */
export function refuseDbUrl(url, dbPort) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "refusing --db-url: not a URL";
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) return "refusing --db-url: not a postgres:// URL";
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    return "refusing --db-url: the host is not loopback; diagnostics run against the local stack only (R-15)";
  }
  if (Number(parsed.port || 5432) !== dbPort) {
    return `refusing --db-url: port ${parsed.port || 5432} is not the local stack's db port (${dbPort})`;
  }
  return null;
}

/** @returns {string | null} a refusal reason when DOCKER_HOST points at another machine */
export function refuseDockerHost(dockerHost) {
  if (!dockerHost) return null;
  if (dockerHost.startsWith("unix://") || dockerHost.startsWith("npipe://")) return null;
  try {
    const host = new URL(dockerHost).hostname;
    if (LOOPBACK_HOSTS.has(host)) return null;
  } catch {
    /* fall through */
  }
  return "refusing: DOCKER_HOST names a non-loopback docker daemon; diagnostics run against the local stack only";
}

/**
 * @param {string[]} argv
 * @param {number} dbPort
 * @returns {{ ok: true, label: string, outDir: string } | { ok: false, error: string }}
 */
export function parseArgs(argv, dbPort) {
  let label = null;
  let outDir = DEFAULT_OUT_DIR;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.startsWith("--") && arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const value = () => (inline !== undefined ? inline : argv[++i]);
    if (flag === "--label") label = value() ?? "";
    else if (flag === "--out-dir") outDir = value() ?? "";
    else if (flag === "--db-url") {
      const reason = refuseDbUrl(value() ?? "", dbPort);
      if (reason) return { ok: false, error: reason };
    } else if (/^--?(linked|project-ref|workdir)\b/.test(flag)) {
      return { ok: false, error: `refusing \`${flag}\`: diagnostics run against the local stack only (R-15)` };
    } else if (/postgres(ql)?:\/\//i.test(arg)) {
      return { ok: false, error: "refusing a connection string argument: use --db-url with a loopback URL, or nothing" };
    } else {
      return { ok: false, error: `refusing \`${arg}\` (usage: npm run db:diagnostics -- --label <label> [--out-dir <dir>])` };
    }
  }
  if (!label || !LABEL.test(label)) return { ok: false, error: "a --label matching [a-z0-9][a-z0-9-]* is required" };
  if (!outDir) return { ok: false, error: "--out-dir needs a value" };
  return { ok: true, label, outDir };
}

/**
 * Parses psql's unaligned, tuples-only output of diagnostics.sql into counts. Row values are never kept: `rows`
 * checks become a row count, `pairs` checks a { label: count } object, `count` checks a number.
 * @param {string} stdout
 * @returns {Record<string, number | Record<string, number>>}
 */
export function parseDiagnostics(stdout) {
  /** @type {Record<string, number | Record<string, number>>} */
  const checks = {};
  let current = null;
  for (const line of stdout.split("\n")) {
    const marker = /^@@ (\S+) (count|pairs|rows)$/.exec(line);
    if (marker) {
      current = { id: marker[1], kind: marker[2] };
      checks[current.id] = current.kind === "pairs" ? {} : 0;
      continue;
    }
    if (!current || line === "") continue;
    if (current.kind === "rows") {
      checks[current.id] = /** @type {number} */ (checks[current.id]) + 1;
    } else if (current.kind === "count") {
      if (!/^\d+$/.test(line)) throw new Error(`${current.id}: expected a count, got a non-numeric line`);
      checks[current.id] = Number(line);
    } else {
      const [key, count] = line.split("|");
      if (!/^\d+$/.test(count ?? "")) throw new Error(`${current.id}: expected "<label>|<count>"`);
      /** @type {Record<string, number>} */ (checks[current.id])[key] = Number(count);
    }
  }
  return checks;
}

/** The checks that must be 0 before VALIDATE (plan 05-03 step 5) and that BACKEND §3 treats as a possible incident. */
export function blockingNonZero(checks) {
  const out = [];
  for (const id of ["D1", "D1x", "D2", "D5x"]) {
    for (const [k, v] of Object.entries(/** @type {Record<string, number>} */ (checks[id] ?? {}))) if (v > 0) out.push(`${id} ${k}=${v}`);
  }
  for (const id of ["D3", "D4a", "D4b", "D5"]) if (Number(checks[id] ?? 0) > 0) out.push(`${id}=${checks[id]}`);
  return out;
}

/**
 * @param {string[]} argv
 * @param {{ spawnSync?: typeof nodeSpawnSync, env?: NodeJS.ProcessEnv, root?: string, now?: () => Date,
 *   writeFile?: (file: string, data: string) => void, stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream }} [deps]
 * @returns {number}
 */
export function runDiagnostics(argv, deps = {}) {
  const {
    spawnSync = nodeSpawnSync,
    env = process.env,
    root = ROOT,
    now = () => new Date(),
    writeFile = (file, data) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, data);
    },
    stdout = process.stdout,
    stderr = process.stderr,
  } = deps;

  let config;
  try {
    config = readConfig(root);
  } catch (e) {
    stderr.write(`[db:diagnostics] ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  const parsed = parseArgs(argv, config.dbPort);
  if (!parsed.ok) {
    stderr.write(`[db:diagnostics] ${parsed.error}\n`);
    return 1;
  }
  const dockerRefusal = refuseDockerHost(env.DOCKER_HOST);
  if (dockerRefusal) {
    stderr.write(`[db:diagnostics] ${dockerRefusal}\n`);
    return 1;
  }

  const sql = fs.readFileSync(SQL_FILE, "utf8");
  const run = spawnSync(
    "docker",
    ["exec", "-i", config.container, "psql", "-U", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
      "-c", "begin transaction isolation level repeatable read read only", "-f", "-", "-c", "rollback"],
    { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env },
  );
  if (run.error || run.status !== 0) {
    // psql's stderr names the failing statement; it carries no row data (the queries return counts or are counted).
    stderr.write(`[db:diagnostics] psql failed (exit ${run.status ?? "none"}): ${run.error?.message ?? run.stderr}\n`);
    return 1;
  }
  let checks;
  try {
    checks = parseDiagnostics(run.stdout);
  } catch (e) {
    stderr.write(`[db:diagnostics] ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  const report = {
    label: parsed.label,
    generated_at: now().toISOString(),
    target: "local stack (docker container, loopback)",
    note: "counts only; D0/D4/D7d are row counts; see scripts/db/diagnostics.sql",
    blocking_nonzero: blockingNonZero(checks),
    checks,
  };
  const file = path.resolve(root, parsed.outDir, `${parsed.label}.json`);
  writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  stdout.write(`${JSON.stringify(report, null, 2)}\n[db:diagnostics] wrote ${path.relative(root, file)}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = runDiagnostics(process.argv.slice(2));
}
