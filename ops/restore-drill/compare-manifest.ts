/**
 * Restore-drill manifest comparison (V2-04 04-05a, FT-02, ruling R-29).
 *
 * Compares what a restore loaded into the drill stack with the manifest written inside the encrypted archive:
 *   - every table's restored row count equals the manifest (the manifest counts the dump's COPY rows);
 *   - every archived object file has the size and SHA-256 the manifest recorded;
 *   - every restored `storage.objects` row (outside the excluded buckets) has an archived file of the same size.
 * Objects are verified, not re-uploaded: a local stack is not a Storage restore target (R-29).
 *
 * Problems name a table or a bucket, never an object name or row data (object names can carry ids).
 *
 * CLI (run by ops/restore-drill/run.sh):
 *   npx tsx ops/restore-drill/compare-manifest.ts --manifest <manifest.json> --restored-counts <tsv>
 *     --restored-objects <tsv> --storage-dir <dir> [--out <result.json>]
 * Exit 0 = match, 1 = mismatch, 2 = usage / unreadable input.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface ManifestObject {
  name: string;
  size: number;
  sha256: string;
}

export interface Manifest {
  format_version: 1;
  environment: string;
  dump_started_at: string;
  dump_finished_at: string;
  cli_version: string;
  server_version: string;
  database_bytes: number;
  policies: number;
  functions: number;
  rls_tables: number;
  auth_users: number;
  tables: Record<string, number>;
  buckets: Record<string, { objects: ManifestObject[] }>;
  excluded_buckets: string[];
}

export interface ArchiveFile {
  size: number;
  sha256: string;
}

export interface RestoredObject {
  bucket: string;
  name: string;
  /** `metadata->>'size'` of the restored row; null when the row carries no size. */
  size: number | null;
}

export interface CompareResult {
  ok: boolean;
  problems: string[];
  tables: number;
  rows: number;
  buckets: number;
  objects_verified: number;
  object_bytes: number;
  /** Restored rows in buckets the backup deliberately skipped (the local stand-in's own target bucket). */
  objects_excluded: number;
  /** Archived files without a restored row (uploaded after the data dump): reported, not a failure. */
  files_without_row: number;
}

const key = (bucket: string, name: string) => `${bucket}\u0000${name}`;

export function compareManifest(
  manifest: Manifest,
  restoredCounts: Record<string, number>,
  restoredObjects: RestoredObject[],
  files: Map<string, ArchiveFile>,
): CompareResult {
  const problems: string[] = [];

  const tables = Object.keys(manifest.tables).sort();
  for (const table of tables) {
    const want = manifest.tables[table];
    const got = restoredCounts[table];
    if (got === undefined) problems.push(`table ${table}: missing after restore (manifest ${want} rows)`);
    else if (got !== want) problems.push(`table ${table}: restored ${got} rows, manifest ${want}`);
  }

  let verified = 0;
  let bytes = 0;
  const manifestObjects = new Map<string, ManifestObject>();
  for (const bucket of Object.keys(manifest.buckets).sort()) {
    let mismatched = 0;
    for (const obj of manifest.buckets[bucket].objects) {
      manifestObjects.set(key(bucket, obj.name), obj);
      const file = files.get(key(bucket, obj.name));
      if (!file || file.size !== obj.size || file.sha256 !== obj.sha256) mismatched++;
      else {
        verified++;
        bytes += obj.size;
      }
    }
    if (mismatched > 0) problems.push(`bucket ${bucket}: ${mismatched} archived object(s) with a missing file or a size/SHA-256 mismatch`);
  }

  const excluded = new Set(manifest.excluded_buckets);
  let excludedRows = 0;
  const rowsWithoutFile = new Map<string, number>();
  const restoredKeys = new Set<string>();
  for (const row of restoredObjects) {
    if (excluded.has(row.bucket)) {
      excludedRows++;
      continue;
    }
    restoredKeys.add(key(row.bucket, row.name));
    const obj = manifestObjects.get(key(row.bucket, row.name));
    if (!obj || (row.size !== null && row.size !== obj.size)) {
      rowsWithoutFile.set(row.bucket, (rowsWithoutFile.get(row.bucket) ?? 0) + 1);
    }
  }
  for (const [bucket, n] of [...rowsWithoutFile].sort(([a], [b]) => (a < b ? -1 : 1))) {
    problems.push(`bucket ${bucket}: ${n} restored storage.objects row(s) without an archived file of the same size`);
  }
  let filesWithoutRow = 0;
  for (const k of manifestObjects.keys()) if (!restoredKeys.has(k)) filesWithoutRow++;

  return {
    ok: problems.length === 0,
    problems,
    tables: tables.length,
    rows: tables.reduce((s, t) => s + (manifest.tables[t] ?? 0), 0),
    buckets: Object.keys(manifest.buckets).length,
    objects_verified: verified,
    object_bytes: bytes,
    objects_excluded: excludedRows,
    files_without_row: filesWithoutRow,
  };
}

/** `schema.table<TAB>count` lines → record. */
export function parseCounts(tsv: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of tsv.split("\n")) {
    if (!line.trim()) continue;
    const [table, n] = line.split("\t");
    out[table] = Number(n);
  }
  return out;
}

/** `bucket<TAB>name<TAB>size` lines (size may be empty) → rows. */
export function parseObjects(tsv: string): RestoredObject[] {
  const out: RestoredObject[] = [];
  for (const line of tsv.split("\n")) {
    if (!line.trim()) continue;
    const [bucket, name, size] = line.split("\t");
    out.push({ bucket, name, size: size === undefined || size === "" ? null : Number(size) });
  }
  return out;
}

/** Size and SHA-256 of every file under `<storageDir>/<bucket>/…`, keyed by bucket and object name. */
export function hashStorageDir(storageDir: string): Map<string, ArchiveFile> {
  const files = new Map<string, ArchiveFile>();
  if (!fs.existsSync(storageDir)) return files;
  for (const bucket of fs.readdirSync(storageDir, { withFileTypes: true })) {
    if (!bucket.isDirectory()) continue;
    const root = path.join(storageDir, bucket.name);
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile()) {
          const body = fs.readFileSync(full);
          const name = path.relative(root, full).split(path.sep).join("/");
          files.set(key(bucket.name, name), { size: body.length, sha256: createHash("sha256").update(body).digest("hex") });
        }
      }
    };
    walk(root);
  }
  return files;
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : undefined;
}

function main(argv: string[]): number {
  const manifestPath = arg(argv, "--manifest");
  const countsPath = arg(argv, "--restored-counts");
  const objectsPath = arg(argv, "--restored-objects");
  const storageDir = arg(argv, "--storage-dir");
  const out = arg(argv, "--out");
  if (!manifestPath || !countsPath || !objectsPath || !storageDir) {
    process.stderr.write("usage: compare-manifest.ts --manifest <f> --restored-counts <f> --restored-objects <f> --storage-dir <d> [--out <f>]\n");
    return 2;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
  if (manifest.format_version !== 1) {
    process.stderr.write("compare-manifest: unsupported manifest format_version\n");
    return 2;
  }
  const result = compareManifest(
    manifest,
    parseCounts(fs.readFileSync(countsPath, "utf8")),
    parseObjects(fs.readFileSync(objectsPath, "utf8")),
    hashStorageDir(storageDir),
  );
  if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(
    `compare-manifest: ${result.ok ? "PASS" : "FAIL"} tables=${result.tables} rows=${result.rows} buckets=${result.buckets} ` +
      `objects_verified=${result.objects_verified} objects_excluded=${result.objects_excluded} files_without_row=${result.files_without_row}\n`,
  );
  for (const p of result.problems) process.stdout.write(`  - ${p}\n`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = main(process.argv.slice(2));
}
