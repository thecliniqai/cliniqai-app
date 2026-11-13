/**
 * AUTH-00 re-check kit command line (V2-03 03-12c; R-9, threat T-03-09): the staging target refuses before any
 * request unless it is the approved `staging.yml` run on feature/v2 against the staging project with hosted keys; the
 * local target refuses anything but the CLI stack; the database URL is split into `PG*` variables (never a command
 * line). No value is echoed. Nothing here reaches a hosted project (refusals happen before any request).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { localRecheckProblems, pgEnvFromUrl, stagingRecheckProblems } from "../../scripts/staging/auth00-recheck";

const ROOT = path.resolve(__dirname, "../..");
const TSX = path.join(ROOT, "node_modules/.bin/tsx");
const REF = "abcdefghijklmnopqrst";
const OTHER_REF = "zyxwvutsrqponmlkjihg";
const DB_PASSWORD = "Fixture-db-password-not-real";
/** A synthetic JWT-shaped value (no claims, no signature), assembled at runtime so no key-shaped literal is committed. */
const LOCAL_JWT_SHAPED = [Buffer.from('{"alg":"HS256"}').toString("base64url"), "e30", "fixture"].join(".");

const STAGING_ENV: Record<string, string | undefined> = {
  GITHUB_ACTIONS: "true",
  GITHUB_REF: "refs/heads/feature/v2",
  APP_ENV: "staging",
  SUPABASE_PROJECT_REF_STAGING: REF,
  STAGING_SUPABASE_URL: `https://${REF}.supabase.co`,
  STAGING_DB_URL: `postgresql://postgres.${REF}:${DB_PASSWORD}@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`,
  STAGING_SECRET_KEY: "sb_secret_FIXTURE-not-real",
  STAGING_PUBLISHABLE_KEY: "sb_publishable_FIXTURE-not-real",
};

function cli(args: string[], env: Record<string, string | undefined>) {
  const clean: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
  for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v;
  return spawnSync(TSX, ["scripts/staging/auth00-recheck.ts", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: clean as NodeJS.ProcessEnv,
    timeout: 60_000,
  });
}

describe("stagingRecheckProblems", () => {
  it("accepts the approved staging run", () => {
    expect(stagingRecheckProblems(STAGING_ENV)).toEqual([]);
    expect(stagingRecheckProblems({ ...STAGING_ENV, PO_CAPTCHA_BROWSER_CHECK: "passed", PO_AUTH_LOG_RETENTION: "1 day" })).toEqual([]);
  });

  it.each([
    ["outside GitHub Actions", { GITHUB_ACTIONS: undefined }, "runs only in GitHub Actions"],
    ["another branch", { GITHUB_REF: "refs/heads/v2/phase-03-platform-hygiene" }, "GITHUB_REF must be refs/heads/feature/v2"],
    ["APP_ENV unset", { APP_ENV: undefined }, 'APP_ENV must be "staging"'],
    ["the local API URL", { STAGING_SUPABASE_URL: "http://127.0.0.1:54321" }, "STAGING_SUPABASE_URL:"],
    ["another project's API", { STAGING_SUPABASE_URL: `https://${OTHER_REF}.supabase.co` }, "STAGING_SUPABASE_URL:"],
    ["the local database", { STAGING_DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" }, "STAGING_DB_URL:"],
    [
      "another project's database",
      { STAGING_DB_URL: `postgresql://postgres.${OTHER_REF}:x@aws-1-ap-south-1.pooler.supabase.com:5432/postgres` },
      "STAGING_DB_URL:",
    ],
    ["a local JWT secret key", { STAGING_SECRET_KEY: LOCAL_JWT_SHAPED }, "STAGING_SECRET_KEY must be a hosted secret key"],
    ["a missing publishable key", { STAGING_PUBLISHABLE_KEY: undefined }, "STAGING_PUBLISHABLE_KEY must be a hosted publishable key"],
    ["a bad browser-check value", { PO_CAPTCHA_BROWSER_CHECK: "yes" }, "PO_CAPTCHA_BROWSER_CHECK must be one of"],
    ["a shell-looking retention note", { PO_AUTH_LOG_RETENTION: "1 day; $(id)" }, "PO_AUTH_LOG_RETENTION must be short plain text"],
  ])("refuses %s", (_label, override, problem) => {
    const problems = stagingRecheckProblems({ ...STAGING_ENV, ...override });
    expect(problems.join("\n")).toContain(problem);
    expect(problems.join("\n")).not.toContain(DB_PASSWORD);
  });
});

describe("localRecheckProblems", () => {
  const LOCAL = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k", SUPABASE_SECRET_KEY: "s" };
  it("accepts the CLI stack and refuses anything else", () => {
    expect(localRecheckProblems(LOCAL)).toEqual([]);
    expect(localRecheckProblems({ ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co` })).toContain(
      "NEXT_PUBLIC_SUPABASE_URL must be the local stack (loopback)",
    );
    expect(localRecheckProblems({ ...LOCAL, SUPABASE_SECRET_KEY: undefined })).toContain("local stack keys are not loaded");
    expect(localRecheckProblems({ ...LOCAL, APP_ENV: "staging" })).toContain("APP_ENV must not be staging or production");
  });
});

describe("pgEnvFromUrl", () => {
  it("splits the URL into PG* variables (password decoded, TLS required)", () => {
    const pg = pgEnvFromUrl(`postgresql://postgres.${REF}:p%40ss%2Fword@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`);
    expect(pg).toEqual({
      PGHOST: "aws-1-ap-south-1.pooler.supabase.com",
      PGPORT: "5432",
      PGUSER: `postgres.${REF}`,
      PGPASSWORD: "p@ss/word",
      PGDATABASE: "postgres",
      PGSSLMODE: "require",
      PGCONNECT_TIMEOUT: "15",
    });
  });
});

describe("the command line refuses before any request", () => {
  it("staging outside the approved workflow run → exit 1, problems listed, no value echoed", () => {
    const r = cli(["--target", "staging", "--out", "/dev/null"], { ...STAGING_ENV, GITHUB_ACTIONS: undefined, GITHUB_REF: undefined });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("[auth00-recheck] REFUSED: this is not an approved staging re-check run.");
    expect(r.stderr).toContain("runs only in GitHub Actions");
    expect(r.stdout).toBe("");
    for (const value of [DB_PASSWORD, STAGING_ENV.STAGING_SECRET_KEY!, STAGING_ENV.STAGING_PUBLISHABLE_KEY!]) {
      expect(`${r.stdout}${r.stderr}`).not.toContain(value);
    }
  }, 60_000);

  it("an unknown target or a burst above 40 → usage (exit 2)", () => {
    expect(cli(["--target", "production"], {}).status).toBe(2);
    expect(cli(["--target", "local", "--burst", "41"], {}).status).toBe(2);
  }, 60_000);
});
