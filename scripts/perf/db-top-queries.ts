/**
 * V2-09e 09E-02 (R-20, step 3): the database's heaviest statements on the LOCAL stack.
 *
 *   npm run perf:db-top -- [--reset] [--out-dir <dir>]
 *
 * Runs `scripts/perf/top-queries.sql` (the same read-only SELECT the PO runs on staging) inside the local database container (`docker exec
 * ... psql`, the container named after supabase/config.toml's project_id, as `scripts/db/diagnostics.mjs` does: never a connection string),
 * and writes `db-top-queries.json` and `db-top-queries.md` (top 25 by total and by mean time: calls, rows, mean and max ms, the normalised
 * statement) to the out dir (default `.planning/phases/09E-caching-speed/evidence`).
 * `--reset` clears the counters first (`pg_stat_statements_reset()`), for a measured run: reset, run the lane, then report.
 *
 * Refuses, before any docker call: `--db-url`, `--linked`, `--project-ref`, any other flag, any positional argument, and a `DOCKER_HOST`
 * that names a non-loopback daemon (the "local" container would then live on another machine).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const SQL_FILE = path.join(ROOT, "scripts/perf/top-queries.sql");
export const DEFAULT_OUT_DIR = ".planning/phases/09E-caching-speed/evidence";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export interface TopQueryRow {
  rank_total: number;
  rank_mean: number;
  query: string;
  calls: number;
  rows: number;
  mean_ms: number;
  max_ms: number;
  total_ms: number;
}

export function parseArgs(argv: string[]): { ok: true; reset: boolean; outDir: string } | { ok: false; error: string } {
  let reset = false;
  let outDir = DEFAULT_OUT_DIR;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--reset") reset = true;
    else if (arg === "--out-dir") {
      const value = argv[++i];
      if (!value || value.startsWith("-")) return { ok: false, error: "--out-dir needs a directory" };
      outDir = value;
    } else if (/^--?(db-url|linked|project-ref|workdir)\b/.test(arg)) {
      return { ok: false, error: `refusing ${arg}: db-top-queries reads the local stack's container only` };
    } else {
      return { ok: false, error: `refusing ${arg}: usage: npm run perf:db-top -- [--reset] [--out-dir <dir>]` };
    }
  }
  return { ok: true, reset, outDir };
}

export function dockerHostRefusal(env: NodeJS.ProcessEnv): string | null {
  const host = env.DOCKER_HOST;
  if (!host) return null;
  if (host.startsWith("unix://")) return null;
  try {
    return LOOPBACK.has(new URL(host).hostname) ? null : "refusing: DOCKER_HOST names a non-loopback daemon; this tool reads the local stack only";
  } catch {
    return "refusing: DOCKER_HOST is not a URL this tool can check";
  }
}

function container(): string {
  const toml = fs.readFileSync(path.join(ROOT, "supabase/config.toml"), "utf8");
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  if (!projectId) throw new Error("db-top-queries: no project_id in supabase/config.toml");
  return `supabase_db_${projectId}`;
}

function psql(name: string, sql: string): string {
  const r = spawnSync("docker", ["exec", "-i", name, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-tA"], { input: sql, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`psql failed (${r.status}): ${(r.stderr || "").split("\n")[0]}`);
  return r.stdout;
}

export function renderMarkdown(rows: TopQueryRow[], generatedAt: string, reset: boolean): string {
  const table = (title: string, list: TopQueryRow[]) =>
    [
      `## ${title}`,
      "",
      "| # | calls | rows | mean ms | max ms | total ms | statement |",
      "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
      ...list.map((r, i) => `| ${i + 1} | ${r.calls} | ${r.rows} | ${r.mean_ms} | ${r.max_ms} | ${r.total_ms} | \`${r.query.replace(/\|/g, "\\|").replace(/`/g, "'")}\` |`),
      "",
    ].join("\n");
  const byTotal = rows.filter((r) => r.rank_total <= 25).sort((a, b) => a.rank_total - b.rank_total);
  const byMean = rows.filter((r) => r.rank_mean <= 25).sort((a, b) => a.rank_mean - b.rank_mean);
  return [
    "# Database top queries (local stack)",
    "",
    `Generated ${generatedAt} by \`npm run perf:db-top\` from \`scripts/perf/top-queries.sql\`${reset ? " (counters were reset before this run)" : ""}. Statement text is normalised by Postgres; synthetic local data only.`,
    "",
    table("Top 25 by total time", byTotal),
    table("Top 25 by mean time", byMean),
  ].join("\n");
}

function main(): number {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`db-top-queries: ${parsed.error}`);
    return 1;
  }
  const refusal = dockerHostRefusal(process.env);
  if (refusal) {
    console.error(`db-top-queries: ${refusal}`);
    return 1;
  }
  const name = container();
  if (parsed.reset) {
    psql(name, "select extensions.pg_stat_statements_reset();");
    console.log("db-top-queries: counters reset");
    return 0;
  }
  const select = fs.readFileSync(SQL_FILE, "utf8").trim().replace(/;\s*$/, "");
  const out = psql(name, `select coalesce(json_agg(t), '[]'::json) from (${select}) t;`).trim();
  const rows = JSON.parse(out) as TopQueryRow[];
  const outDir = path.resolve(ROOT, parsed.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(outDir, "db-top-queries.json"), `${JSON.stringify({ generatedAt, rows }, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, "db-top-queries.md"), `${renderMarkdown(rows, generatedAt, false)}\n`);
  console.log(`db-top-queries: ${rows.length} statements, wrote ${path.relative(ROOT, outDir)}/db-top-queries.{json,md}`);
  return 0;
}

if (require.main === module) process.exitCode = main();
