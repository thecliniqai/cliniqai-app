/**
 * Staging scripts (V2-03 03-08; P1-35a, FT-01; rulings R-9, R-21, R-26, R-30; threat T-03-09). No network and no
 * hosted project: every HTTP call goes through an injected `fetch`, the schema-drift CLI call through an injected
 * spawn, and the seed scripts are only run on inputs they must refuse before any request.
 *
 *   target-guard      refuses loopback, IP literals, local names and another project's ref; accepts the staging API
 *                     origin, the direct database host and the session pooler (ref in the user name); masks only the
 *                     password and never prints it in a refusal
 *   wait-for-release  exits 0 once /api/health reports the SHA and /api/ready is ready at the newest migration; 1 on
 *                     timeout, not-ready or a wrong migration; 2 on a non-https origin
 *   check-region      vercel.json pins bom1; /api/health region bom1 passes; another region fails with the FT-01 note
 *   schema-drift      refuses a loopback URL without running the CLI; the CLI output is judged by local-drift's
 *                     allowlist; a failing CLI's stderr is shown with the URL and password redacted
 *   seed-staging      refuses without APP_ENV=staging, with a loopback URL, another ref, a local JWT key or a short
 *                     password; seed-local-dev still refuses a non-loopback URL
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkRegion, pinnedRegion } from "@/scripts/staging/check-region.mjs";
import { diffArgs, runSchemaDrift } from "@/scripts/staging/schema-drift.mjs";
import { canonicalDbUrl, redactUrl, stagingTargetProblems } from "@/scripts/staging/target-guard.mjs";
import { newestMigration, waitForRelease } from "@/scripts/staging/wait-for-release.mjs";
import { ROOT } from "./run-checker";

const REF = "abcdefghijklmnopqrst";
const OTHER_REF = "zyxwvutsrqponmlkjihg";
const PW = "Fixture-Pw/Marker+not-real"; // "/" and "+" so the raw and the percent-encoded forms differ
const SHA = "0123456789abcdef0123456789abcdef01234567";
const ORIGIN = "https://staging.clinicos.example";
const TSX = path.join(ROOT, "node_modules/.bin/tsx");

/** Runs a script with exactly `env` (nothing inherited from the Vitest process). */
function runWithEnv(command: string, args: string[], env: Record<string, string | undefined>) {
  const r = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", env: env as NodeJS.ProcessEnv, timeout: 60_000 });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** A database URL built from parts (no credential-bearing URL literal in the repository). */
const dbUrl = (user: string, host: string, scheme = "postgresql") => `${scheme}://${user}:${encodeURIComponent(PW)}@${host}:5432/postgres`;

describe("target-guard", () => {
  it.each([
    ["the local API (127.0.0.1)", "http://127.0.0.1:54321", /IP address \(127\.0\.0\.1\)/],
    ["localhost", "https://localhost:54321", /loopback or local/],
    ["the local database", dbUrl("postgres", "127.0.0.1"), /IP address/],
    ["an IPv6 loopback", "https://[::1]:54321", /IP address/],
    ["a docker-internal host", dbUrl("postgres", "host.docker.internal"), /loopback or local/],
    ["another project's API", `https://${OTHER_REF}.supabase.co`, /is not the staging project/],
    ["another project's direct database", dbUrl("postgres", `db.${OTHER_REF}.supabase.co`), /neither db\.abcdefghijklmnopqrst\.supabase\.co/],
    ["the pooler with another project's user", dbUrl(`postgres.${OTHER_REF}`, "aws-0-ap-south-1.pooler.supabase.com"), /does not end in "\.abcdefghijklmnopqrst"/],
    ["a look-alike host", `https://${REF}.supabase.co.evil.example`, /is not the staging project/],
    ["an API URL with a path", `https://${REF}.supabase.co/rest/v1`, /bare origin/],
    ["an unknown scheme", `mysql://u:p@db.${REF}.supabase.co/x`, /neither https: \(API\) nor postgres/],
  ])("refuses %s", (_label, url, problem) => {
    const problems = stagingTargetProblems({ url, ref: REF });
    expect(problems.join("\n")).toMatch(problem);
    expect(problems.join("\n")).not.toContain(PW);
  });

  // 03-13 M-GUARD: pgx (the Supabase CLI's driver) applies URL query parameters over the authority, so each of these
  // would connect somewhere other than the host the guard checked, or without TLS.
  it.each([
    ["?host= pointing at loopback", `${dbUrl("postgres", `db.${REF}.supabase.co`)}?host=127.0.0.1`, /query parameters other than sslmode \(host\)/],
    ["?host= pointing at another project", `${dbUrl("postgres", `db.${REF}.supabase.co`)}?host=db.${OTHER_REF}.supabase.co`, /\(host\)/],
    ["?user= naming another project's pooler tenant", `${dbUrl(`postgres.${REF}`, "aws-0-ap-south-1.pooler.supabase.com")}?user=postgres.${OTHER_REF}`, /\(user\)/],
    ["sslmode=disable", `${dbUrl("postgres", `db.${REF}.supabase.co`)}?sslmode=disable`, /sslmode must be require or verify-full/],
    ["sslmode=prefer", `${dbUrl("postgres", `db.${REF}.supabase.co`)}?sslmode=prefer`, /sslmode must be require or verify-full/],
    ["sslmode twice", `${dbUrl("postgres", `db.${REF}.supabase.co`)}?sslmode=require&sslmode=disable`, /sslmode more than once/],
    ["port, dbname and options overrides", `${dbUrl("postgres", `db.${REF}.supabase.co`)}?port=6543&dbname=x&options=-c%20x%3Dy`, /\(dbname, options, port\)/],
    ["an upper-case HOST parameter", `${dbUrl("postgres", `db.${REF}.supabase.co`)}?HOST=127.0.0.1`, /\(HOST\)/],
    ["a fragment", `${dbUrl("postgres", `db.${REF}.supabase.co`)}#host=127.0.0.1`, /fragment/],
    ["a multi-segment path", dbUrl("postgres", `db.${REF}.supabase.co`).replace(":5432/postgres", ":5432/postgres/x"), /single database name/],
  ])("refuses a database URL with %s", (_label, url, problem) => {
    const problems = stagingTargetProblems({ url, ref: REF, kind: "db" });
    expect(problems.join("\n")).toMatch(problem);
    expect(problems.join("\n")).not.toContain(PW);
  });

  it("accepts sslmode=require / verify-full and re-serialises the URL with TLS required (the CLI never sees the raw secret)", () => {
    const pooler = dbUrl(`postgres.${REF}`, "aws-0-ap-south-1.pooler.supabase.com");
    expect(stagingTargetProblems({ url: `${pooler}?sslmode=require`, ref: REF })).toEqual([]);
    expect(stagingTargetProblems({ url: `${pooler}?sslmode=verify-full`, ref: REF })).toEqual([]);
    expect(canonicalDbUrl(pooler)).toBe(`${pooler}?sslmode=require`);
    expect(canonicalDbUrl(`${pooler}?sslmode=verify-full`)).toBe(`${pooler}?sslmode=verify-full`);
    expect(new URL(canonicalDbUrl(pooler)).password).toBe(encodeURIComponent(PW));
  });

  it("CLI --print-db-url prints only the canonical URL on stdout; refuses a re-targeting URL with nothing on stdout", () => {
    const guard = path.join(ROOT, "scripts/staging/target-guard.mjs");
    const pooler = dbUrl(`postgres.${REF}`, "aws-0-ap-south-1.pooler.supabase.com");
    const base = { PATH: process.env.PATH, GITHUB_ACTIONS: "true", SUPABASE_PROJECT_REF_STAGING: REF };
    const ok = runWithEnv(process.execPath, [guard, "--var", "STAGING_DB_URL", "--print-db-url"], { ...base, STAGING_DB_URL: pooler });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toBe(`${pooler}?sslmode=require\n`);
    expect(ok.stderr).toContain("target-guard: OK STAGING_DB_URL is the staging project");
    expect(ok.stderr).not.toContain(PW);
    expect(ok.stderr).not.toContain(encodeURIComponent(PW));

    const refused = runWithEnv(process.execPath, [guard, "--var", "STAGING_DB_URL", "--print-db-url"], { ...base, STAGING_DB_URL: `${pooler}?host=127.0.0.1` });
    expect(refused.status).toBe(1);
    expect(refused.stdout).toBe("");
    expect(refused.stderr).toContain("(host)");
    expect(refused.stderr).not.toContain(encodeURIComponent(PW));

    // An API URL is not a database target for --print-db-url; --mask and --print-db-url together is a usage error.
    expect(runWithEnv(process.execPath, [guard, "--var", "X", "--print-db-url"], { ...base, X: `https://${REF}.supabase.co` }).status).toBe(1);
    expect(runWithEnv(process.execPath, [guard, "--var", "X", "--print-db-url", "--mask"], { ...base, X: pooler }).status).toBe(2);
  });

  it("refuses a missing or malformed ref and a missing URL", () => {
    expect(stagingTargetProblems({ url: `https://${REF}.supabase.co`, ref: undefined }).join()).toMatch(/20-character project ref/);
    expect(stagingTargetProblems({ url: `https://${REF}.supabase.co`, ref: "Short" }).join()).toMatch(/20-character project ref/);
    expect(stagingTargetProblems({ url: undefined, ref: REF })).toEqual(["the target URL is not set"]);
  });

  it.each([
    ["the staging API origin", `https://${REF}.supabase.co`, "api"],
    ["the direct database host", dbUrl("postgres", `db.${REF}.supabase.co`), "db"],
    ["the session pooler (ref in the user name)", dbUrl(`clinicos_drift_ro.${REF}`, "aws-0-ap-south-1.pooler.supabase.com"), "db"],
    ["the postgres:// scheme", dbUrl(`postgres.${REF}`, "aws-1-ap-south-1.pooler.supabase.com", "postgres"), "any"],
  ] as const)("accepts %s", (_label, url, kind) => {
    expect(stagingTargetProblems({ url, ref: REF, kind })).toEqual([]);
  });

  it("enforces the kind: a database URL is not an API target and vice versa", () => {
    expect(stagingTargetProblems({ url: dbUrl("postgres", `db.${REF}.supabase.co`), ref: REF, kind: "api" })).toEqual(["an API target must be an https URL"]);
    expect(stagingTargetProblems({ url: `https://${REF}.supabase.co`, ref: REF, kind: "db" })).toEqual([
      "a database target must be a postgres:// or postgresql:// URL",
    ]);
  });

  it("CLI: --mask on a GitHub runner masks the password and prints it nowhere else; a refusal prints no password", () => {
    const guard = path.join(ROOT, "scripts/staging/target-guard.mjs");
    const ok = runWithEnv(process.execPath, [guard, "--var", "STAGING_DB_URL", "--mask"], {
      PATH: process.env.PATH,
      GITHUB_ACTIONS: "true",
      SUPABASE_PROJECT_REF_STAGING: REF,
      STAGING_DB_URL: dbUrl(`postgres.${REF}`, "aws-0-ap-south-1.pooler.supabase.com"),
    });
    expect(ok.status).toBe(0);
    const lines = ok.stdout.trim().split("\n");
    expect(lines[0]).toBe(`::add-mask::${PW}`);
    expect(lines[1]).toBe(`::add-mask::${encodeURIComponent(PW)}`);
    expect(lines.slice(2).join("\n")).not.toContain(PW);
    expect(lines.slice(2).join("\n")).not.toContain(encodeURIComponent(PW));
    expect(lines.at(-1)).toContain(`target-guard: OK STAGING_DB_URL is the staging project ${REF}`);

    const refused = runWithEnv(process.execPath, [guard, "--var", "STAGING_DB_URL", "--mask"], {
      PATH: process.env.PATH,
      GITHUB_ACTIONS: "true",
      SUPABASE_PROJECT_REF_STAGING: REF,
      STAGING_DB_URL: dbUrl("postgres", "127.0.0.1"),
    });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("target-guard: REFUSED STAGING_DB_URL");
    expect(`${refused.stdout}${refused.stderr}`).not.toContain(PW);
  });

  it("redactUrl removes the URL and its password (raw and percent-decoded)", () => {
    const url = dbUrl(`postgres.${REF}`, "aws-0-ap-south-1.pooler.supabase.com");
    const text = `failed to connect to ${url}; password ${PW}; again ${encodeURIComponent(PW)}`;
    const out = redactUrl(text, url);
    expect(out).not.toContain(PW);
    expect(out).not.toContain(encodeURIComponent(PW));
    expect(out).toContain("<staging-url>");
  });
});

/** A fake clock + fetch: /api/health answers `releases` in order (the last one repeats), /api/ready answers `ready`. */
function fakeStaging(releases: (string | null)[], ready: { status: number; body: unknown }) {
  let clock = 0;
  let healthCalls = 0;
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    if (url.endsWith("/api/health")) {
      const release = releases[Math.min(healthCalls++, releases.length - 1)];
      return Response.json({ status: "ok", region: "bom1", release });
    }
    if (url.endsWith("/api/ready")) return Response.json(ready.body, { status: ready.status });
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch;
  return {
    urls,
    options: { fetchImpl, now: () => clock, sleep: async (ms: number) => void (clock += ms), timeoutMs: 60_000, intervalMs: 15_000 },
  };
}

const READY = { status: 200, body: { status: "ready", latestMigration: "000027" } };

describe("wait-for-release", () => {
  it("exits 0 once /api/health reports the SHA and /api/ready is ready at the newest migration", async () => {
    const s = fakeStaging(["fedcba9876543210fedcba9876543210fedcba98", null, SHA], READY);
    const r = await waitForRelease({ origin: ORIGIN, sha: SHA, expectedMigration: "000027", ...s.options });
    expect(r.lines.at(-1)).toBe(`wait-for-release: PASS release ${SHA} is live and ready at migration 000027`);
    expect(r.exitCode).toBe(0);
    expect(s.urls).toEqual([...Array(3).fill(`${ORIGIN}/api/health`), `${ORIGIN}/api/ready`]);
  });

  it("exits 1 on timeout when the release never appears, without calling /api/ready", async () => {
    const s = fakeStaging(["fedcba9876543210fedcba9876543210fedcba98"], READY);
    const r = await waitForRelease({ origin: ORIGIN, sha: SHA, expectedMigration: "000027", ...s.options });
    expect(r.exitCode).toBe(1);
    expect(r.lines.at(-1)).toMatch(/TIMEOUT after 5 attempt\(s\).*never reported release/);
    expect(s.urls.some((u) => u.endsWith("/api/ready"))).toBe(false);
  });

  it("exits 1 when /api/ready answers 503, or is ready at an older migration", async () => {
    const notReady = await waitForRelease({ origin: ORIGIN, sha: SHA, expectedMigration: "000027", ...fakeStaging([SHA], { status: 503, body: { status: "not_ready" } }).options });
    expect(notReady.exitCode).toBe(1);
    expect(notReady.lines.at(-1)).toContain("/api/ready answered HTTP 503");
    const stale = await waitForRelease({ origin: ORIGIN, sha: SHA, expectedMigration: "000028", ...fakeStaging([SHA], READY).options });
    expect(stale.exitCode).toBe(1);
    expect(stale.lines.at(-1)).toContain('latestMigration "000027", the repository\'s newest is 000028');
  });

  it("exits 2 for a non-https or non-bare origin and a short SHA, before any request", async () => {
    for (const [origin, sha] of [["http://127.0.0.1:3000", SHA], [`${ORIGIN}/`, SHA], [ORIGIN, "0123abc"]]) {
      const s = fakeStaging([SHA], READY);
      const r = await waitForRelease({ origin, sha, expectedMigration: "000027", ...s.options });
      expect(r.exitCode).toBe(2);
      expect(s.urls).toEqual([]);
    }
  });

  it("newestMigration picks the highest NNNNNN_ file and ignores anything else", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrations-"));
    for (const f of ["000001_init.sql", "000027_record_payment_rpc.sql", "000009_x.sql", "README.md", "20250101_ts.sql"]) {
      fs.writeFileSync(path.join(dir, f), "");
    }
    expect(newestMigration(dir)).toBe("000027");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("check-region (FT-01)", () => {
  it("vercel.json pins exactly the bom1 (Mumbai) function region", () => {
    expect(pinnedRegion()).toBe("bom1");
  });

  it("refuses a vercel.json without a single pinned region", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vercel-json-"));
    for (const config of [{}, { regions: [] }, { regions: ["bom1", "sin1"] }]) {
      fs.writeFileSync(path.join(dir, "vercel.json"), JSON.stringify(config));
      expect(() => pinnedRegion(path.join(dir, "vercel.json"))).toThrow(/exactly one function region/);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const health = (region: string | null, status = 200) =>
    (async () => Response.json({ status: "ok", region, release: SHA }, { status, headers: { "x-vercel-id": "bom1::iad1::abcde-1234567890" } })) as unknown as typeof fetch;

  it("passes when /api/health reports the pinned region and shows the x-vercel-id regions only", async () => {
    const r = await checkRegion({ origin: ORIGIN, expected: "bom1", fetchImpl: health("bom1") });
    expect(r.exitCode).toBe(0);
    expect(r.lines[0]).toBe("check-region: PASS functions run in bom1 (x-vercel-id regions: bom1::iad1)");
  });

  it("fails on another region (or none) and says to record the deviation (FT-01)", async () => {
    for (const region of ["iad1", null]) {
      const r = await checkRegion({ origin: ORIGIN, expected: "bom1", fetchImpl: health(region) });
      expect(r.exitCode).toBe(1);
      expect(r.lines.join("\n")).toContain("record the deviation (FT-01)");
    }
  });
});

describe("schema-drift (staging, read-only)", () => {
  const roUrl = dbUrl(`clinicos_drift_ro.${REF}`, "aws-0-ap-south-1.pooler.supabase.com");
  const vars = { STAGING_DB_URL_RO: roUrl, SUPABASE_PROJECT_REF_STAGING: REF };

  type SpawnImpl = NonNullable<NonNullable<Parameters<typeof runSchemaDrift>[0]>["spawnImpl"]>;

  /**
   * Fakes the `npx supabase db diff` call and (03-13b) the privilege-snapshot `psql` call, which answers with the
   * committed snapshot (no privilege drift); the judging `node scripts/ci/local-drift.mjs` call runs for real.
   */
  function fakeCli(result: { status: number; stdout?: string; stderr?: string }) {
    const calls: string[][] = [];
    const spawnImpl: SpawnImpl = (cmd, args, opts) => {
      calls.push([cmd, ...args]);
      if (cmd === "npx") return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
      if (cmd === "psql") return { status: 0, stdout: fs.readFileSync(path.join(ROOT, "scripts/drift/schema-snapshot.txt"), "utf8"), stderr: "" };
      const r = spawnSync(cmd, args, { ...(opts as object), encoding: "utf8" });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    };
    return { calls, spawnImpl };
  }

  it("refuses a loopback database URL without running the CLI", () => {
    const cli = fakeCli({ status: 0, stdout: "{}" });
    const r = runSchemaDrift({ vars: { ...vars, STAGING_DB_URL_RO: dbUrl("postgres", "127.0.0.1") }, spawnImpl: cli.spawnImpl });
    expect(r.exitCode).toBe(2);
    expect(r.lines[0]).toContain("schema-drift: REFUSED STAGING_DB_URL_RO");
    expect(cli.calls).toEqual([]);
  });

  it("refuses a re-targeting query parameter without running the CLI (03-13 M-GUARD)", () => {
    const cli = fakeCli({ status: 0, stdout: "{}" });
    const r = runSchemaDrift({ vars: { ...vars, STAGING_DB_URL_RO: `${roUrl}?host=127.0.0.1` }, spawnImpl: cli.spawnImpl });
    expect(r.exitCode).toBe(2);
    expect(r.lines.join("\n")).toContain("(host)");
    expect(cli.calls).toEqual([]);
  });

  it("runs the read-only diff against the given URL with --schema public,ops,private and passes on no drift", () => {
    const cli = fakeCli({ status: 0, stdout: JSON.stringify({ diff: "" }) });
    const r = runSchemaDrift({ vars, spawnImpl: cli.spawnImpl });
    // 03-13 M-GUARD: the CLI gets the re-serialised URL (TLS required), not the raw secret.
    expect(cli.calls[0]).toEqual(["npx", ...diffArgs(`${roUrl}?sslmode=require`)]);
    expect(cli.calls[0]).toEqual(expect.arrayContaining(["--db-url", "--schema", "public,ops,private"]));
    expect(cli.calls[0]).not.toContain("-f");
    expect(r.lines.join("\n")).toContain("local-drift: PASS");
    expect(r.exitCode).toBe(0);
  });

  it("fails with the statement when staging differs from the migrations", () => {
    const cli = fakeCli({ status: 0, stdout: JSON.stringify({ diff: 'alter table "public"."patients" add column "x" text;\n' }) });
    const r = runSchemaDrift({ vars, spawnImpl: cli.spawnImpl });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join("\n")).toContain('alter table "public"."patients" add column "x" text;');
  });

  it("exits 2 when the CLI fails, showing its stderr with the URL and password redacted", () => {
    const cli = fakeCli({ status: 1, stderr: `failed to connect to ${roUrl} (password ${PW}); retry ${roUrl}?sslmode=require` });
    const r = runSchemaDrift({ vars, spawnImpl: cli.spawnImpl });
    expect(r.exitCode).toBe(2);
    const printed = r.lines.join("\n");
    expect(printed).toContain("failed to connect to <staging-url>");
    expect(printed).not.toContain(PW);
    expect(printed).not.toContain(encodeURIComponent(PW));
  });
});

describe("seed scripts refuse the wrong target before any request", () => {
  const STAGING_ENV = {
    APP_ENV: "staging",
    SUPABASE_PROJECT_REF_STAGING: REF,
    STAGING_SUPABASE_URL: `https://${REF}.supabase.co`,
    STAGING_SECRET_KEY: "sb_secret_FIXTURE-not-real",
    STAGING_SEED_PASSWORD: "Fixture-seed-password-not-real",
  };
  const seedStaging = (env: Record<string, string | undefined>) =>
    runWithEnv(TSX, ["scripts/seed-staging.ts"], { PATH: process.env.PATH, HOME: process.env.HOME, ...env });

  it.each([
    ["APP_ENV unset", { APP_ENV: undefined }, 'APP_ENV must be "staging" (got unset)'],
    ["APP_ENV=test", { APP_ENV: "test" }, 'APP_ENV must be "staging" (got "test")'],
    ["the local API URL", { STAGING_SUPABASE_URL: "http://127.0.0.1:54321" }, "IP address (127.0.0.1)"],
    ["a localhost URL", { STAGING_SUPABASE_URL: "http://localhost:54321" }, "loopback or local"],
    ["another project's URL", { STAGING_SUPABASE_URL: `https://${OTHER_REF}.supabase.co` }, "is not the staging project"],
    ["a local-stack JWT key", { STAGING_SECRET_KEY: "eyJhbGciOiJIUzI1NiJ9.e30.fixture" }, "STAGING_SECRET_KEY must be a hosted secret key"],
    ["a short password", { STAGING_SEED_PASSWORD: "short-pw-1" }, "at least 16 characters"],
  ])("seed-staging refuses with %s", (_label, override, problem) => {
    const r = seedStaging({ ...STAGING_ENV, ...override });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("[seed:staging] REFUSED: this is not an approved staging seed run.");
    expect(r.stderr).toContain(problem);
    expect(r.stdout).toBe("");
    expect(`${r.stdout}${r.stderr}`).not.toContain(STAGING_ENV.STAGING_SEED_PASSWORD);
  }, 60_000);

  it("seed-local-dev still refuses a non-loopback Supabase URL (its guard is unchanged)", () => {
    const r = runWithEnv(TSX, ["scripts/seed-local-dev.ts"], {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NEXT_PUBLIC_SUPABASE_URL: "https://staging.invalid",
      // The local-stack keys the Vitest lane already holds, so the script never shells out to `supabase status`.
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Refusing to run tests: the environment is not the local test stack.");
    expect(r.stderr).toContain('NEXT_PUBLIC_SUPABASE_URL points at non-local host "staging.invalid"');
  }, 60_000);
});
