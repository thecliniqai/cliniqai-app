#!/usr/bin/env node
/**
 * V2-09e 09E-01 (baseline, "Reference" row): how big the reference catalogues are, from tools only.
 *
 *   node scripts/perf/reference-counts.mjs [--out <file.json>]
 *
 * - the real files' counts: lines of supabase/seed-data/cdci/*.txt (the first line is the header) and the length of
 *   supabase/seed-data/terminology/diagnoses.json (read only; no database is touched for these);
 * - the LOCAL stack's row counts of the catalogue tables (docker exec into the local database container named by supabase/config.toml;
 *   never a linked or hosted project).
 * 09E-09 and 09E-11 re-measure with the serializer (scripts/perf/reference-size.ts).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const outArg = process.argv.indexOf("--out");
const out = outArg > 0 ? process.argv[outArg + 1] : null;

const projectId = /^\s*project_id\s*=\s*"([A-Za-z0-9_.-]+)"/m.exec(fs.readFileSync(path.join(root, "supabase/config.toml"), "utf8"))?.[1];
if (!projectId) throw new Error("reference-counts: no project_id in supabase/config.toml");

const files = {};
const cdciDir = path.join(root, "supabase/seed-data/cdci");
for (const name of fs.readdirSync(cdciDir).filter((n) => n.endsWith("Master.txt")).sort()) {
  const text = fs.readFileSync(path.join(cdciDir, name), "utf8");
  files[`cdci/${name}`] = { rows: Math.max(0, text.split("\n").filter((l) => l.trim() !== "").length - 1), bytes: Buffer.byteLength(text) };
}
const diagnosesPath = path.join(root, "supabase/seed-data/terminology/diagnoses.json");
const diagnoses = JSON.parse(fs.readFileSync(diagnosesPath, "utf8"));
const list = Array.isArray(diagnoses) ? diagnoses : (diagnoses.diagnoses ?? diagnoses.rows ?? Object.values(diagnoses));
files["terminology/diagnoses.json"] = { rows: Array.isArray(list) ? list.length : null, bytes: fs.statSync(diagnosesPath).size };

const TABLES = ["cdci_substances", "cdci_generics", "cdci_brands", "cdci_products", "cdci_medicines_search", "opd_diagnoses"];
const local = {};
for (const table of TABLES) {
  const r = spawnSync("docker", ["exec", `supabase_db_${projectId}`, "psql", "-U", "postgres", "-tA", "-c", `select count(*) from public.${table}`], { encoding: "utf8" });
  local[table] = r.status === 0 ? Number(r.stdout.trim()) : null;
}

const result = { files, localStackRows: local };
const text = `${JSON.stringify(result, null, 2)}\n`;
if (out) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, text);
}
console.log(text);
