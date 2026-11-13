/**
 * AUTH-00 re-check kit, command line (V2-03 03-12c; R-9). The kit itself is `auth00-recheck-lib.ts`.
 *
 *   npx tsx scripts/staging/auth00-recheck.ts --target local   [--out <file>] [--burst <n ≤ 40>]
 *   npx tsx scripts/staging/auth00-recheck.ts --target staging  --out <file>
 *
 * `--target local` runs against the CLI stack only: the lane's own loader (`.env.test` + `npx supabase status`, never
 * `.env`) and guard (loopback URLs, local-stack keys); catalogue reads go through `docker exec psql` in the local
 * Postgres container.
 *
 * `--target staging` runs ONLY inside `.github/workflows/staging.yml` job `auth00-recheck` (Environment `staging`,
 * the PO approves each run; agents never run or dispatch it, R-9). It refuses (exit 1, before any request) unless:
 *   - `GITHUB_ACTIONS=true` and `GITHUB_REF=refs/heads/feature/v2`, and `APP_ENV=staging`;
 *   - `STAGING_SUPABASE_URL` is `https://<SUPABASE_PROJECT_REF_STAGING>.supabase.co` and `STAGING_DB_URL` is that
 *     project's database (scripts/staging/target-guard.mjs);
 *   - `STAGING_SECRET_KEY` is an `sb_secret_…` key and `STAGING_PUBLISHABLE_KEY` an `sb_publishable_…` key;
 *   - the optional PO observations are well-formed: `PO_CAPTCHA_BROWSER_CHECK` (passed | failed | not-recorded) and
 *     `PO_AUTH_LOG_RETENTION` (short free text, e.g. "1 day").
 * Catalogue reads use `psql` with the connection split into `PG*` variables (no URL on a command line), inside a
 * read-only transaction.
 *
 * Prints item ids and statuses only; the report holds statuses, error codes and shapes, never a key, password, code
 * or token (the kit withholds a report that would). Exit 0 = report written and no synthetic user left behind;
 * 1 = refused, a run error or a leftover user; 2 = usage.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { MAX_BURST, runRecheck, type Observations, type RecheckConfig, type Target } from "./auth00-recheck-lib";
import { REF_VAR, stagingTargetProblems } from "./target-guard.mjs";

const TAG = "[auth00-recheck]";
const ROOT = path.resolve(__dirname, "../..");
const run = promisify(execFile);

type Env = Record<string, string | undefined>;

const BROWSER_CHECKS = ["passed", "failed", "not-recorded"] as const;
const RETENTION_TEXT = /^[A-Za-z0-9 .,:()_-]{1,60}$/;

/** Every reason `env` is not an approved staging re-check run. Empty = go. Never echoes a value. */
export function stagingRecheckProblems(env: Env): string[] {
  const problems: string[] = [];
  if (env.GITHUB_ACTIONS !== "true") problems.push("runs only in GitHub Actions (staging.yml job auth00-recheck)");
  if (env.GITHUB_REF !== "refs/heads/feature/v2") problems.push("GITHUB_REF must be refs/heads/feature/v2");
  if (env.APP_ENV !== "staging") problems.push('APP_ENV must be "staging"');
  for (const p of stagingTargetProblems({ url: env.STAGING_SUPABASE_URL, ref: env[REF_VAR], kind: "api" })) {
    problems.push(`STAGING_SUPABASE_URL: ${p}`);
  }
  for (const p of stagingTargetProblems({ url: env.STAGING_DB_URL, ref: env[REF_VAR], kind: "db" })) {
    problems.push(`STAGING_DB_URL: ${p}`);
  }
  if (!(env.STAGING_SECRET_KEY ?? "").startsWith("sb_secret_")) problems.push("STAGING_SECRET_KEY must be a hosted secret key (sb_secret_…)");
  if (!(env.STAGING_PUBLISHABLE_KEY ?? "").startsWith("sb_publishable_")) {
    problems.push("STAGING_PUBLISHABLE_KEY must be a hosted publishable key (sb_publishable_…)");
  }
  const browser = env.PO_CAPTCHA_BROWSER_CHECK;
  if (browser && !(BROWSER_CHECKS as readonly string[]).includes(browser)) {
    problems.push(`PO_CAPTCHA_BROWSER_CHECK must be one of ${BROWSER_CHECKS.join(" | ")}`);
  }
  const retention = env.PO_AUTH_LOG_RETENTION;
  if (retention && !RETENTION_TEXT.test(retention)) problems.push("PO_AUTH_LOG_RETENTION must be short plain text (e.g. 1 day)");
  return problems;
}

/** Every reason `env` is not the local CLI stack. Empty = go. */
export function localRecheckProblems(env: Env): string[] {
  const problems: string[] = [];
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  let host: string | null = null;
  try {
    host = url ? new URL(url).hostname : null;
  } catch {
    host = null;
  }
  if (!host || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    problems.push("NEXT_PUBLIC_SUPABASE_URL must be the local stack (loopback)");
  }
  if (!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || !env.SUPABASE_SECRET_KEY) problems.push("local stack keys are not loaded");
  if (env.APP_ENV === "staging" || env.APP_ENV === "production") problems.push("APP_ENV must not be staging or production");
  return problems;
}

/** `postgres://user:password@host:port/db` → `PG*` variables (so no URL or password sits on a command line). */
export function pgEnvFromUrl(dbUrl: string): Record<string, string> {
  const u = new URL(dbUrl);
  return {
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres",
    PGSSLMODE: "require",
    PGCONNECT_TIMEOUT: "15",
  };
}

/** A read-only catalogue query: one session, `begin read only` … `rollback`; rows are `|`-separated. */
function readOnlyArgs(sql: string): string[] {
  return ["-v", "ON_ERROR_STOP=1", "-qAt", "-c", "begin read only", "-c", sql, "-c", "rollback"];
}

function localCatalogue(): RecheckConfig["catalogue"] {
  const toml = fs.readFileSync(path.join(ROOT, "supabase/config.toml"), "utf8");
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  if (!projectId) throw new Error("project_id not found in supabase/config.toml");
  return async (sql) => {
    const { stdout } = await run("docker", ["exec", `supabase_db_${projectId}`, "psql", "-U", "postgres", ...readOnlyArgs(sql)]);
    return stdout.trim().split("\n").filter(Boolean);
  };
}

function stagingCatalogue(dbUrl: string): RecheckConfig["catalogue"] {
  // Only PATH and the PG* variables reach psql (no other secret of the job's environment).
  const childEnv: Record<string, string> = { PATH: process.env.PATH ?? "", ...pgEnvFromUrl(dbUrl) };
  return async (sql) => {
    const { stdout } = await run("psql", readOnlyArgs(sql), { env: childEnv as unknown as NodeJS.ProcessEnv });
    return stdout.trim().split("\n").filter(Boolean);
  };
}

export function ssrVersion(root: string = ROOT): RecheckConfig["ssrVersion"] {
  const read = (file: string) => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const pkg = read(path.join(root, "package.json")) as { dependencies?: Record<string, string> } | null;
  const installed = read(path.join(root, "node_modules/@supabase/ssr/package.json")) as { version?: string } | null;
  return { pinned: pkg?.dependencies?.["@supabase/ssr"] ?? null, installed: installed?.version ?? null };
}

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : undefined;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const target = arg(args, "--target") as Target | undefined;
  const out = arg(args, "--out") ?? path.join(process.cwd(), `auth00-recheck-${target ?? "unknown"}.json`);
  const burst = arg(args, "--burst");
  if (target !== "local" && target !== "staging") {
    console.error(`${TAG} usage: --target local|staging [--out <file>] [--burst <n <= ${MAX_BURST}>]`);
    return 2;
  }
  if (burst !== undefined && !(/^\d+$/.test(burst) && Number(burst) >= 1 && Number(burst) <= MAX_BURST)) {
    console.error(`${TAG} --burst must be 1..${MAX_BURST}`);
    return 2;
  }

  let cfg: RecheckConfig;
  if (target === "staging") {
    const env = process.env as Env;
    const problems = stagingRecheckProblems(env);
    if (problems.length) {
      console.error(`${TAG} REFUSED: this is not an approved staging re-check run.`);
      for (const p of problems) console.error(`  - ${p}`);
      return 1;
    }
    const observations: Observations = {
      captchaBrowserCheck: (env.PO_CAPTCHA_BROWSER_CHECK as Observations["captchaBrowserCheck"]) || "not-recorded",
      authLogRetention: env.PO_AUTH_LOG_RETENTION || undefined,
    };
    cfg = {
      target,
      apiUrl: env.STAGING_SUPABASE_URL!,
      publishableKey: env.STAGING_PUBLISHABLE_KEY!,
      secretKey: env.STAGING_SECRET_KEY!,
      catalogue: stagingCatalogue(env.STAGING_DB_URL!),
      ssrVersion: ssrVersion(),
      observations,
    };
  } else {
    // The test lane's loader and guard: `.env.test` + `npx supabase status`, never `.env` (imported lazily so the
    // staging path never touches the local helpers).
    const { assertLocalTestEnv, loadLocalStackKeys, loadTestEnv } = await import("../../tests/setup/test-env");
    loadTestEnv(ROOT);
    loadLocalStackKeys(ROOT);
    assertLocalTestEnv();
    const env = process.env as Env;
    const problems = localRecheckProblems(env);
    if (problems.length) {
      console.error(`${TAG} REFUSED: the local target must be the CLI stack.`);
      for (const p of problems) console.error(`  - ${p}`);
      return 1;
    }
    cfg = {
      target,
      apiUrl: env.NEXT_PUBLIC_SUPABASE_URL!,
      publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      secretKey: env.SUPABASE_SECRET_KEY!,
      catalogue: localCatalogue(),
      ssrVersion: ssrVersion(),
    };
  }
  if (burst !== undefined) cfg.burst = Number(burst);
  cfg.log = (line) => console.log(`${TAG} ${line}`);

  const report = await runRecheck(cfg);
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  for (const item of report.items) console.log(`${TAG} item ${item.id} ${item.status}: ${item.name}`);
  console.log(
    `${TAG} cleanup: ${report.cleanup.users_deleted}/${report.cleanup.users_created} synthetic users deleted, ` +
      `${report.cleanup.leftover_user_ids.length} left; report ${path.relative(process.cwd(), out)}`,
  );
  return report.cleanup.leftover_user_ids.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`${TAG} ${error instanceof Error ? error.message.split("\n")[0] : "failed"}`);
      process.exit(1);
    },
  );
}
