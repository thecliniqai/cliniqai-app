/**
 * Restore-drill manifest guard (V2-04 04-07e, adversarial re-check N-2b).
 *
 * `manifest.json` comes out of the decrypted archive, so it is archive-controlled text. The drill used three of its
 * values as psql variables interpolated raw into SQL (`:expected_policies::int`; psql re-lexes an interpolated value, so
 * a backslash in it starts a meta-command) and built a counts query from its table names. This guard validates every
 * field the drill reads against a strict shape before any of it is used, and writes a validated copy holding only
 * those fields; run.sh reads nothing else from the archive's manifest.
 *
 *   - counts (`policies`, `functions`, `rls_tables`, `auth_users`): integers 0..999 999 999; `database_bytes` and
 *     every table count / object size: non-negative safe integers;
 *   - table keys: `<schema>.<table>`, each part `^[a-z_][a-z0-9_]{0,62}$`, schema in {@link ALLOWED_SCHEMAS} (the
 *     schemas a Supabase data dump carries); counts.sql then counts only tables that exist in the restored catalog;
 *   - digests: 64 lower-case hex; bucket ids `^[A-Za-z0-9._-]{1,100}$` (not `.`/`..`), as backup.sh enforces; object
 *     names relative paths without `..`, control characters or a leading `/`;
 *   - `format_version` 1, `environment` local | staging | production, ISO-8601 UTC timestamps, version strings;
 *   - no other top-level field (fail closed: a manifest this guard does not know is refused, not skimmed).
 *
 * Problems name the field (and a table or bucket key only when it passed its own pattern), never a refused value.
 *
 * CLI (run by ops/restore-drill/run.sh right after decrypting):
 *   npx tsx ops/restore-drill/manifest-guard.ts --in <manifest.json> --out <validated.json>
 * Exit 0 = valid (copy written), 1 = refused (problems printed, nothing written), 2 = usage / unreadable input.
 */
import fs from "node:fs";
import path from "node:path";
import type { Manifest, ManifestObject } from "./compare-manifest";

export const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
export const TABLE_KEY = /^[a-z_][a-z0-9_]{0,62}\.[a-z_][a-z0-9_]{0,62}$/;
export const SHA256_HEX = /^[0-9a-f]{64}$/;
const BUCKET_ID = /^[A-Za-z0-9._-]{1,100}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const CLI_VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const SERVER_VERSION = /^\d{1,3}(?:\.\d{1,3}){0,2}(?: \([A-Za-z0-9 .:+~_-]{1,100}\))?$/;
const ENVIRONMENTS = new Set(["local", "staging", "production"]);
/** Schemas whose tables a Supabase data dump (backup.sh `db dump --data-only`) can carry. */
export const ALLOWED_SCHEMAS = new Set([
  "public",
  "private",
  "ops",
  "auth",
  "storage",
  "realtime",
  "vault",
  "supabase_functions",
  "supabase_migrations",
  "extensions",
  "graphql",
  "pgsodium",
]);
const MAX_COUNT = 999_999_999;
const MAX_TABLES = 10_000;
const MAX_OBJECTS = 1_000_000;
const KNOWN_FIELDS = new Set([
  "format_version",
  "environment",
  "dump_started_at",
  "dump_finished_at",
  "cli_version",
  "server_version",
  "database_bytes",
  "policies",
  "functions",
  "rls_tables",
  "auth_users",
  "tables",
  "buckets",
  "excluded_buckets",
]);

export type ManifestCheck = { ok: true; manifest: Manifest } | { ok: false; problems: string[] };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const isCount = (v: unknown, max = MAX_COUNT): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
const isBucketId = (v: unknown): v is string => typeof v === "string" && BUCKET_ID.test(v) && v !== "." && v !== "..";
function isObjectName(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0 || v.length > 1024 || v.startsWith("/")) return false;
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return false;
  return v.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/** Validates a parsed manifest; on success returns a copy holding only the validated fields. */
export function validateManifest(input: unknown): ManifestCheck {
  const problems: string[] = [];
  if (!isPlainObject(input)) return { ok: false, problems: ["manifest is not a JSON object"] };
  const m = input;
  for (const k of Object.keys(m)) {
    if (!KNOWN_FIELDS.has(k)) problems.push(IDENTIFIER.test(k) ? `unknown field ${k}` : "unknown field (name refused)");
  }
  if (m.format_version !== 1) problems.push("format_version: must be 1");
  if (typeof m.environment !== "string" || !ENVIRONMENTS.has(m.environment))
    problems.push("environment: must be local, staging or production");
  for (const f of ["dump_started_at", "dump_finished_at"] as const) {
    const v = m[f];
    if (typeof v !== "string" || !ISO_UTC.test(v) || !Number.isFinite(Date.parse(v)))
      problems.push(`${f}: must be an ISO-8601 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ)`);
  }
  if (typeof m.cli_version !== "string" || !CLI_VERSION.test(m.cli_version)) problems.push("cli_version: must be N.N.N");
  if (typeof m.server_version !== "string" || !SERVER_VERSION.test(m.server_version))
    problems.push("server_version: not a PostgreSQL version string");
  if (!isCount(m.database_bytes, Number.MAX_SAFE_INTEGER)) problems.push("database_bytes: must be a non-negative integer");
  for (const f of ["policies", "functions", "rls_tables", "auth_users"] as const) {
    if (!isCount(m[f])) problems.push(`${f}: must be an integer from 0 to ${MAX_COUNT}`);
  }

  const tables: Record<string, number> = {};
  if (!isPlainObject(m.tables)) problems.push("tables: must be an object");
  else {
    const keys = Object.keys(m.tables);
    if (keys.length > MAX_TABLES) problems.push(`tables: more than ${MAX_TABLES} entries`);
    let badKeys = 0;
    for (const k of keys) {
      if (!TABLE_KEY.test(k)) {
        badKeys++;
        continue;
      }
      const schema = k.slice(0, k.indexOf("."));
      if (!ALLOWED_SCHEMAS.has(schema)) {
        problems.push(`tables: ${k} is outside the dumped schemas`);
        continue;
      }
      const n = m.tables[k];
      if (!isCount(n, Number.MAX_SAFE_INTEGER)) problems.push(`tables: ${k} count must be a non-negative integer`);
      else tables[k] = n;
    }
    if (badKeys > 0) problems.push(`tables: ${badKeys} key(s) not of the form schema.table (lower-case identifiers)`);
  }

  const buckets: Record<string, { objects: ManifestObject[] }> = {};
  if (!isPlainObject(m.buckets)) problems.push("buckets: must be an object");
  else {
    let total = 0;
    let badIds = 0;
    for (const id of Object.keys(m.buckets)) {
      if (!isBucketId(id)) {
        badIds++;
        continue;
      }
      const b = m.buckets[id];
      if (!isPlainObject(b) || !Array.isArray(b.objects) || Object.keys(b).length !== 1) {
        problems.push(`buckets: ${id} must be { objects: [...] }`);
        continue;
      }
      const objects: ManifestObject[] = [];
      let bad = 0;
      for (const o of b.objects as unknown[]) {
        total++;
        if (
          isPlainObject(o) &&
          Object.keys(o).length === 3 &&
          isObjectName(o.name) &&
          isCount(o.size, Number.MAX_SAFE_INTEGER) &&
          typeof o.sha256 === "string" &&
          SHA256_HEX.test(o.sha256)
        ) {
          objects.push({ name: o.name, size: o.size, sha256: o.sha256 });
        } else bad++;
      }
      if (bad > 0) problems.push(`buckets: ${id} has ${bad} object(s) without a valid name, size and SHA-256`);
      buckets[id] = { objects };
    }
    if (badIds > 0) problems.push(`buckets: ${badIds} bucket id(s) refused`);
    if (total > MAX_OBJECTS) problems.push(`buckets: more than ${MAX_OBJECTS} objects`);
  }

  if (!Array.isArray(m.excluded_buckets) || !m.excluded_buckets.every(isBucketId))
    problems.push("excluded_buckets: must be a list of bucket ids");

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    manifest: {
      format_version: 1,
      environment: m.environment as string,
      dump_started_at: m.dump_started_at as string,
      dump_finished_at: m.dump_finished_at as string,
      cli_version: m.cli_version as string,
      server_version: m.server_version as string,
      database_bytes: m.database_bytes as number,
      policies: m.policies as number,
      functions: m.functions as number,
      rls_tables: m.rls_tables as number,
      auth_users: m.auth_users as number,
      tables,
      buckets,
      excluded_buckets: [...(m.excluded_buckets as string[])],
    },
  };
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : undefined;
}

function main(argv: string[]): number {
  const inPath = arg(argv, "--in");
  const outPath = arg(argv, "--out");
  if (!inPath || !outPath) {
    process.stderr.write("usage: manifest-guard.ts --in <manifest.json> --out <validated.json>\n");
    return 2;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(inPath, "utf8"));
  } catch {
    process.stderr.write("manifest-guard: manifest.json is unreadable or not JSON\n");
    return 2;
  }
  const r = validateManifest(parsed);
  if (!r.ok) {
    process.stdout.write(`manifest-guard: REFUSED (${r.problems.length} problem(s))\n`);
    for (const p of r.problems) process.stdout.write(`  - ${p}\n`);
    return 1;
  }
  fs.writeFileSync(outPath, JSON.stringify(r.manifest, null, 2) + "\n");
  process.stdout.write(`manifest-guard: PASS tables=${Object.keys(r.manifest.tables).length} buckets=${Object.keys(r.manifest.buckets).length}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = main(process.argv.slice(2));
}
