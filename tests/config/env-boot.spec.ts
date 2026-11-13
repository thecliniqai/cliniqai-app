/**
 * V2-03 03-01 (P1-15 acceptance "production boot fails without real providers", K-6): the boot check.
 *
 * `next.config.ts` is what `next build`, `next start` and `next dev` load first, so it is imported in a child process
 * (via tsx) with an explicit environment: a production profile without real providers exits non-zero and names the
 * keys (never the values); the ci profile of `.github/workflows/ci.yml` and the e2e app server's environment boot.
 * `instrumentation.ts` `register()` (once per server instance) refuses a bad environment on the Node.js runtime.
 */
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV_SOURCE_NAMES } from "@/lib/env";
import { buildAppServerEnv } from "../e2e/support/app-env";
import { parseEnvFile } from "../setup/test-env";

const ROOT = path.resolve(__dirname, "../..");
const TSX = path.join(ROOT, "node_modules/.bin/tsx");
const BOOT = "import('./next.config.ts').then(() => console.log('boot-ok'), (e) => { console.error(e.message); process.exit(1); })";

function fakeJwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}.sig`;
}

/** Imports next.config.ts in a fresh process with exactly `env` (plus PATH). */
function boot(env: Record<string, string | undefined>): { status: number | null; stdout: string; stderr: string } {
  const clean: Record<string, string> = { PATH: process.env.PATH ?? "" };
  for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v;
  const res = spawnSync(TSX, ["-e", BOOT], { cwd: ROOT, env: clean as NodeJS.ProcessEnv, encoding: "utf8", timeout: 60_000 });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** 03-13 H-ENV: hosted-shaped keys (R-K prefixes), assembled at runtime so no key-shaped literal sits in the repo. */
const BOOT_PUBLISHABLE = ["sb", "publishable", "MARKER-boot-publishable"].join("_");
const BOOT_SECRET = ["sb", "secret", "MARKER-boot-secret"].join("_");

/** A production deployment that has everything except real providers (synthetic values, each a leak marker). */
const PRODUCTION_WITHOUT_PROVIDERS = {
  NODE_ENV: "production",
  APP_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://db.synthetic-project.example.org",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: BOOT_PUBLISHABLE,
  SUPABASE_SECRET_KEY: BOOT_SECRET,
  NEXT_PUBLIC_APP_URL: "https://app.synthetic-clinic.example.org",
  CRON_SECRET: "MARKER-boot-cron-secret-0123456789abcdef",
  // 04-02: required in production.
  JOBS_RUNNER_SECRET: "MARKER-boot-jobs-runner-secret-0123456789abcdef",
  MESSAGING_PROVIDER: "dev",
  AI_PROVIDER: "mock",
};

/** Every rule satisfied (synthetic values). */
const COMPLETE_PRODUCTION = {
  ...PRODUCTION_WITHOUT_PROVIDERS,
  MESSAGING_PROVIDER: "msg91",
  MSG91_AUTH_KEY: "MARKER-boot-msg91",
  MSG91_INTEGRATED_NUMBER: "910000000001",
  MSG91_WEBHOOK_SECRET: "MARKER-boot-webhook",
  AI_PROVIDER: undefined,
  ERROR_INGEST_KEY: "MARKER-boot-error-ingest-0123456789abcdef",
  EMAIL_PROVIDER: "ses",
  EMAIL_FROM: "no-reply@auth.synthetic-clinic.example.org",
  SES_ACCESS_KEY_ID: ["AKIA", "MARKERBOOT000000"].join(""),
  SES_SECRET_ACCESS_KEY: "MARKER-boot-ses-secret-access-key-0123456789",
  SEND_EMAIL_HOOK_SECRET: `v1,whsec_${Buffer.from("MARKER-boot-hook-key-0123456789ab").toString("base64")}`,
  PWNED_CHECK: "on",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0xMARKER-boot-turnstile-key",
};

const CI_BUILD = {
  NODE_ENV: "production",
  APP_ENV: "ci",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "ci-build-placeholder-not-a-key",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
  MESSAGING_PROVIDER: "dev",
};

describe("boot: next.config.ts (next build / start / dev)", () => {
  it("a production profile without real providers fails, naming the keys and no value", () => {
    const res = boot(PRODUCTION_WITHOUT_PROVIDERS);
    expect(res.status).not.toBe(0);
    expect(res.stdout).not.toContain("boot-ok");
    expect(res.stderr).toContain("MESSAGING_PROVIDER: must not be dev in production");
    expect(res.stderr).toContain("AI_PROVIDER: must not be mock in production");
    // 03-09b: production must report its errors to the sink.
    expect(res.stderr).toContain("ERROR_INGEST_KEY: required in production");
    // 03-11b: production must send auth email through SES and verify the Send Email hook.
    expect(res.stderr).toContain("EMAIL_PROVIDER: required in production");
    expect(res.stderr).toContain("SEND_EMAIL_HOOK_SECRET: required in production");
    // 03-12a: production must reject breached passwords (FT-05).
    expect(res.stderr).toContain("PWNED_CHECK: must be on in production");
    // 03-12c: production must show a real Turnstile widget (C43).
    expect(res.stderr).toContain("NEXT_PUBLIC_TURNSTILE_SITE_KEY: required in production");
    for (const value of Object.values(PRODUCTION_WITHOUT_PROVIDERS).filter((v) => v.includes("MARKER"))) {
      expect(res.stderr).not.toContain(value);
      expect(res.stdout).not.toContain(value);
    }
  });

  it("a production profile with the messaging provider unset fails (no fallback)", () => {
    const res = boot({ ...PRODUCTION_WITHOUT_PROVIDERS, MESSAGING_PROVIDER: undefined, AI_PROVIDER: undefined });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("MESSAGING_PROVIDER: required");
  });

  it("NODE_ENV=production without APP_ENV fails", () => {
    const res = boot({ ...CI_BUILD, APP_ENV: undefined });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("APP_ENV: required when NODE_ENV=production");
  });

  it("the ci build profile boots (K-6)", () => {
    const res = boot(CI_BUILD);
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("boot-ok");
  });

  it("the e2e app server environment boots (K-6)", () => {
    const env = buildAppServerEnv({
      source: {},
      keys: { anonKey: fakeJwt({ iss: "supabase-demo", role: "anon" }), serviceRoleKey: fakeJwt({ iss: "supabase-demo", role: "service_role" }) },
    });
    // The socket guard preload is for the real server; this child only evaluates the config.
    const res = boot({ ...env, NODE_OPTIONS: undefined });
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
  });

  it("a complete synthetic production profile boots", () => {
    const res = boot(COMPLETE_PRODUCTION);
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
  });

  it("the secret key in the publishable variable stops the build, naming the key and no value (03-13 H-ENV)", () => {
    // The swap the PO could make in Vercel: next build would otherwise inline the secret key into every page.
    const res = boot({ ...COMPLETE_PRODUCTION, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: BOOT_SECRET, SUPABASE_SECRET_KEY: BOOT_PUBLISHABLE });
    expect(res.status).not.toBe(0);
    expect(res.stdout).not.toContain("boot-ok");
    expect(res.stderr).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: must not be a secret key");
    expect(res.stderr).toContain("SUPABASE_SECRET_KEY: must not be a publishable key");
    for (const value of [BOOT_SECRET, BOOT_PUBLISHABLE]) {
      expect(res.stderr).not.toContain(value);
      expect(res.stdout).not.toContain(value);
    }
  });

  it("a staging profile on a Vercel preview deployment stops the build (03-13 M-PREVIEW)", () => {
    const staging = { ...COMPLETE_PRODUCTION, APP_ENV: "staging" };
    expect(boot({ ...staging, VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "feature/v2" }).status).toBe(0);
    const res = boot({ ...staging, VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "MARKER-pushed-branch" });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("VERCEL_ENV: must be production when APP_ENV=staging");
    expect(res.stderr).toContain("VERCEL_GIT_COMMIT_REF: must be feature/v2 when APP_ENV=staging");
    expect(res.stderr).not.toContain("MARKER-pushed-branch");
  });
});


describe("boot: instrumentation.ts register() (every server instance)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function stubAll(env: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  }

  it("throws on the Node.js runtime when the environment breaks a tier rule", async () => {
    stubAll({ ...PRODUCTION_WITHOUT_PROVIDERS, NEXT_RUNTIME: "nodejs" });
    const { register } = await import("@/instrumentation");
    await expect(register()).rejects.toThrow(/MESSAGING_PROVIDER: must not be dev in production/);
  });

  it("passes on the Node.js runtime with a valid environment", async () => {
    stubAll({ ...CI_BUILD, NEXT_RUNTIME: "nodejs" });
    const { register } = await import("@/instrumentation");
    await expect(register()).resolves.toBeUndefined();
  });

  /**
   * V2-04 04-00 (review A L-3, R-47): the pinned CLI's fixed opaque local keys carry the hosted prefixes, so only their
   * digest identifies them. Read from the running local stack here (never committed, never printed); the Vitest lane
   * itself loads the JWT keys, so these exist only inside this test's stubbed environment.
   */
  /** Exactly `env` for the schema's names: the lane's own values (e.g. its local-only names) are unset first. */
  function stubOnly(env: Record<string, string | undefined>) {
    stubAll({ ...Object.fromEntries(ENV_SOURCE_NAMES.map((name) => [name, undefined])), ...env });
  }

  function liveLocalOpaqueKeys(): { publishable: string; secret: string } {
    const status = parseEnvFile(
      execFileSync("npx", ["supabase", "status", "-o", "env"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60_000 }),
    );
    const publishable = status.PUBLISHABLE_KEY;
    const secret = status.SECRET_KEY;
    expect(publishable, "the local stack reports PUBLISHABLE_KEY").toBeTruthy();
    expect(secret, "the local stack reports SECRET_KEY").toBeTruthy();
    // They pass every prefix rule of lib/env.ts; that is why the digest check exists.
    expect(publishable.startsWith(["sb", "publishable", ""].join("_"))).toBe(true);
    expect(secret.startsWith(["sb", "secret", ""].join("_"))).toBe(true);
    return { publishable, secret };
  }

  it("refuses a staging profile carrying the local stack's opaque keys, naming both and no value (04-00 L-3)", async () => {
    const local = liveLocalOpaqueKeys();
    stubOnly({
      ...COMPLETE_PRODUCTION,
      APP_ENV: "staging",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.publishable,
      SUPABASE_SECRET_KEY: local.secret,
      NEXT_RUNTIME: "nodejs",
    });
    const { register } = await import("@/instrumentation");
    const err = await register().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: must not be a local-stack key in staging");
    expect(message).toContain("SUPABASE_SECRET_KEY: must not be a local-stack key in staging");
    expect(message).not.toContain(local.publishable);
    expect(message).not.toContain(local.secret);

    // Every server read goes through the same parse.
    const { serverEnv } = await import("@/lib/env-server");
    expect(() => serverEnv()).toThrow(/SUPABASE_SECRET_KEY: must not be a local-stack key in staging/);

    // One local key is enough to refuse; production refuses them as well.
    vi.unstubAllEnvs();
    stubOnly({ ...COMPLETE_PRODUCTION, SUPABASE_SECRET_KEY: local.secret, NEXT_RUNTIME: "nodejs" });
    await expect(register()).rejects.toThrow(/^(?![\s\S]*NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)[\s\S]*SUPABASE_SECRET_KEY: must not be a local-stack key in production/);
  });

  it("the same staging profile with run-time-built hosted keys boots; the local tiers keep their keys (04-00 L-3)", async () => {
    stubOnly({ ...COMPLETE_PRODUCTION, APP_ENV: "staging", NEXT_RUNTIME: "nodejs" });
    const { register } = await import("@/instrumentation");
    await expect(register()).resolves.toBeUndefined();

    // Outside the deploy tiers the opaque local keys are not refused (a developer may run against them locally).
    const local = liveLocalOpaqueKeys();
    vi.unstubAllEnvs();
    stubOnly({ ...CI_BUILD, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.publishable, SUPABASE_SECRET_KEY: local.secret, NEXT_RUNTIME: "nodejs" });
    await expect(register()).resolves.toBeUndefined();
  });
});
