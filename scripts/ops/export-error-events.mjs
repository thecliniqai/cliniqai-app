#!/usr/bin/env node
/**
 * Local error-sink export (V2-03 03-09b; evidence "an `ops.error_events` row export with scrubbed fields").
 *
 *   node scripts/ops/export-error-events.mjs --request-id <uuid> [--request-id <uuid> ...] --out <file.json>
 *
 * Writes the allowed (scrubbed) columns of the `ops.error_events` rows carrying the given request ids as a JSON array,
 * then runs `check-error-export.mjs`'s check on what it wrote (exit 1 if the check fails or nothing matched).
 *
 * Local stack only, by construction: it runs `psql` with `docker exec` in the local stack's Postgres container
 * (`supabase_db_<project_id>` from supabase/config.toml); it takes no URL and reads no `.env*`. The staging export is
 * the SQL in docs/runbooks/error-sink.md, run by the PO (action E9).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ALLOWED_COLUMNS, checkErrorExport } from "./check-error-export.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function container() {
  const toml = readFileSync(join(ROOT, "supabase/config.toml"), "utf8");
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  if (!projectId) throw new Error("project_id not found in supabase/config.toml");
  return `supabase_db_${projectId}`;
}

/** The export SQL for the given (validated) request ids: the same column list as the runbook's staging query. */
export function exportSql(requestIds) {
  for (const id of requestIds) if (!UUID.test(id)) throw new Error("--request-id must be a UUID");
  const ids = requestIds.map((id) => `'${id.toLowerCase()}'`).join(", ");
  return (
    `select coalesce(json_agg(r order by r.last_seen), '[]'::json) from (select ${ALLOWED_COLUMNS.join(", ")} ` +
    `from ops.error_events where request_id in (${ids})) r`
  );
}

export function parseArgs(argv) {
  const requestIds = [];
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--request-id") requestIds.push(argv[++i] ?? "");
    else if (argv[i] === "--out") out = argv[++i] ?? null;
    else throw new Error(`unknown argument ${JSON.stringify(argv[i])}`);
  }
  if (requestIds.length === 0 || !out) throw new Error("usage: --request-id <uuid> [...] --out <file.json>");
  return { requestIds, out };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`export-error-events: ${e.message}`);
    return 2;
  }
  const stdout = execFileSync(
    "docker",
    ["exec", container(), "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", exportSql(args.requestIds)],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const rows = JSON.parse(stdout.trim() || "[]");
  const file = resolve(args.out);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`);
  const problems = checkErrorExport(rows);
  if (problems.length > 0) {
    console.error(`export-error-events: wrote ${rows.length} row(s) to ${args.out}; check FAILED`);
    for (const p of problems) console.error(`  - ${p}`);
    return 1;
  }
  console.log(`export-error-events: wrote ${rows.length} row(s) to ${args.out}; check OK`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
