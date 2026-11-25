/**
 * V2-09e 09E-09 (R-5, B-14): how big the reference catalogue shards are, from the real files only.
 *
 *   npx tsx scripts/perf/reference-size.ts [--out <file.json>]     (default .planning/phases/09E-caching-speed/evidence/reference-size.json)
 *
 * Reads supabase/seed-data/cdci/{SubstanceMaster,GenericMaster,BrandMaster}.txt and supabase/seed-data/terminology/diagnoses.json (no database, no
 * network, no environment), builds each shard's rows as `public.reference_shard` (000128) returns them, serializes the route's answer the way the route
 * does (`JSON.stringify` of `{ catalogue, version, shard, shards, rows }`, a 36-character version) and writes, per shard, the rows and the raw, gzip and
 * brotli bytes (node:zlib, default levels: what a CDN or the server would send is in that range). The medicine shards follow the seed's own mapping
 * (scripts/seed-cdci.ts: a brand's generic is BrandMaster column 5; `dose_form` is not loaded, so it is null). Diagnosis ids are uuids made at load
 * time: a placeholder uuid of the same length stands in for each.
 */
import fs from "node:fs";
import path from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { parseGenericSubstanceIds } from "../seed/cdci-parse";
import { MEDICINE_BRANDS_PER_SHARD } from "../../features/reference/catalogues";

const root = path.resolve(__dirname, "../..");
const outArg = process.argv.indexOf("--out");
const out = outArg > 0 ? process.argv[outArg + 1] : path.join(root, ".planning/phases/09E-caching-speed/evidence/reference-size.json");
const VERSION = "00000000-0000-4000-8000-000000000000";

/** Tab-separated rows after the header, fields trimmed, blank lines dropped (scripts/seed-cdci.ts's reading). */
function tsv(file: string): string[][] {
  const lines = fs.readFileSync(path.join(root, "supabase/seed-data/cdci", file), "utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
  return lines.slice(1).map((l) => l.split("\t").map((f) => f.trim()));
}

/** Code point order (the shards are ordered by id COLLATE "C"). */
const byId = <T extends readonly unknown[]>(a: T, b: T) => {
  const x = String(a[0]);
  const y = String(b[0]);
  return x < y ? -1 : x > y ? 1 : 0;
};

interface ShardSize {
  catalogue: string;
  shard: number;
  rows: number;
  raw: number;
  gzip: number;
  brotli: number;
}

function measure(catalogue: string, shards: unknown[][][]): ShardSize[] {
  return shards.map((rows, shard) => {
    const body = Buffer.from(JSON.stringify({ catalogue, version: VERSION, shard, shards: shards.length, rows }), "utf8");
    return { catalogue, shard, rows: rows.length, raw: body.length, gzip: gzipSync(body).length, brotli: brotliCompressSync(body).length };
  });
}

// substances: [id, name], one shard (the seed writes "Unknown Substance" for a blank name)
const substances = tsv("SubstanceMaster.txt")
  .filter((f) => f[0])
  .map((f) => [f[0], f[1] || "Unknown Substance"] as const)
  .sort(byId);

// diagnoses: [id, name, icd11, snomed, chronic, specialties, synonyms], one shard
const diagnosesFile = JSON.parse(fs.readFileSync(path.join(root, "supabase/seed-data/terminology/diagnoses.json"), "utf8")) as Array<Record<string, unknown>>;
const diagnoses = diagnosesFile.map((d, i) => [
  `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  String(d.name),
  (d.icd11_code as string | null) ?? null,
  (d.snomed_concept_id as string | null) ?? null,
  d.is_chronic === true,
  (d.specialties as string[] | undefined) ?? [],
  (d.synonyms as string[] | undefined) ?? [],
]);

// medicines: shard 0 generics [id, name, substance_ids]; shards 1..n brands [id, brand_name, generic_row, dose_form] by id, 12,000 per shard
const generics = tsv("GenericMaster.txt")
  .filter((f) => f[0])
  .map((f) => [f[0], f[1] || "Unknown Generic", parseGenericSubstanceIds(f[2])] as const)
  .sort(byId);
const genericPos = new Map(generics.map((g, i) => [g[0], i]));
const brands = tsv("BrandMaster.txt")
  .filter((f) => f[0] && f[1])
  .map((f) => [f[0], f[1], f[4] ? (genericPos.get(f[4]) ?? null) : null, null] as const)
  .sort(byId);
const brandShards: unknown[][][] = [];
for (let i = 0; i < brands.length; i += MEDICINE_BRANDS_PER_SHARD) brandShards.push(brands.slice(i, i + MEDICINE_BRANDS_PER_SHARD) as unknown as unknown[][]);

const shards = [
  ...measure("substances", [substances as unknown as unknown[][]]),
  ...measure("diagnoses", [diagnoses]),
  ...measure("medicines", [generics as unknown as unknown[][], ...brandShards]),
];
const totals = Object.fromEntries(
  ["substances", "diagnoses", "medicines"].map((c) => {
    const of = shards.filter((s) => s.catalogue === c);
    return [c, { shards: of.length, rows: of.reduce((n, s) => n + s.rows, 0), raw: of.reduce((n, s) => n + s.raw, 0), gzip: of.reduce((n, s) => n + s.gzip, 0), brotli: of.reduce((n, s) => n + s.brotli, 0) }];
  }),
);
const result = { source: "supabase/seed-data (read only; no database, no network)", brandsPerShard: MEDICINE_BRANDS_PER_SHARD, largestShardRaw: Math.max(...shards.map((s) => s.raw)), totals, shards };
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ totals, largestShardRaw: result.largestShardRaw }, null, 2));
