/**
 * V2-01a acceptance: "the guard aborts a run pointed at any non-local URL; zero tests reach a hosted URL".
 * Unit-level checks of the rule set, plus an end-to-end check that a real `vitest run` pointed at a hosted URL
 * exits non-zero at config load, before any test file is collected.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TURNSTILE_TEST_SITE_KEYS as SCHEMA_TURNSTILE_TEST_SITE_KEYS } from "@/lib/env";
import {
  FORBIDDEN_VARS,
  findTestEnvProblems,
  LOCAL_ERROR_INGEST_KEY,
  LOCAL_JOBS_RUNNER_SECRET,
  LOCAL_OPS_ALERT_EMAIL,
  LOCAL_SEND_EMAIL_HOOK_SECRET,
  TURNSTILE_TEST_SITE_KEYS,
  loadLocalStackKeys,
  parseEnvFile,
  TestEnvGuardError,
  type EnvMap,
} from "./test-env";

const ROOT = path.resolve(__dirname, "../..");

/** Unsigned JWT with the given payload (the guard reads `iss`; it never verifies signatures). */
function fakeJwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}.sig`;
}

const LOCAL_ANON = fakeJwt({ iss: "supabase-demo", role: "anon" });
const LOCAL_SERVICE = fakeJwt({ iss: "supabase-demo", role: "service_role" });

function safeEnv(overrides: Record<string, string | undefined> = {}): EnvMap {
  const env: EnvMap = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_ANON,
    SUPABASE_SECRET_KEY: LOCAL_SERVICE,
    APP_ENV: "test",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    MESSAGING_PROVIDER: "dev",
    AI_PROVIDER: "mock",
    STORAGE_PROVIDER: "supabase",
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

describe("test-env guard rules", () => {
  it("accepts the local stack configuration", () => {
    expect(findTestEnvProblems(safeEnv())).toEqual([]);
    expect(findTestEnvProblems(safeEnv({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" }))).toEqual([]);
  });

  it.each([
    "https://abcdefghijklmnop.supabase.co",
    "https://abcdefghijklmnop.supabase.in",
    "https://db.example.com",
    "http://10.0.0.5:54321",
    "http://127.0.0.1.nip.io:54321",
  ])("rejects a non-local Supabase URL: %s", (url) => {
    const problems = findTestEnvProblems(safeEnv({ NEXT_PUBLIC_SUPABASE_URL: url }));
    expect(problems.some((p) => p.startsWith("NEXT_PUBLIC_SUPABASE_URL"))).toBe(true);
  });

  it("rejects a missing or malformed Supabase URL", () => {
    expect(findTestEnvProblems(safeEnv({ NEXT_PUBLIC_SUPABASE_URL: undefined }))).toContain(
      "NEXT_PUBLIC_SUPABASE_URL is not set",
    );
    expect(findTestEnvProblems(safeEnv({ NEXT_PUBLIC_SUPABASE_URL: "not a url" }))).toContain(
      "NEXT_PUBLIC_SUPABASE_URL is not a valid URL",
    );
  });

  it("rejects a hosted URL hidden in any other variable", () => {
    const problems = findTestEnvProblems(safeEnv({ SOME_OTHER_URL: "postgres://x@db.abcd.supabase.co:5432/postgres" }));
    expect(problems).toContain('SOME_OTHER_URL references a hosted service (".supabase.co")');
  });

  it("rejects keys that were not issued by the local stack", () => {
    const hostedService = fakeJwt({ iss: "supabase", ref: "abcd", role: "service_role" });
    expect(findTestEnvProblems(safeEnv({ SUPABASE_SECRET_KEY: hostedService }))).toContain(
      'SUPABASE_SECRET_KEY is not a local-stack key (issuer must be "supabase-demo")',
    );
    expect(findTestEnvProblems(safeEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc" }))).toContain(
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not a local-stack key (issuer must be "supabase-demo")',
    );
  });

  it("requires offline providers", () => {
    expect(findTestEnvProblems(safeEnv({ MESSAGING_PROVIDER: "msg91" }))).toContain(
      'MESSAGING_PROVIDER must be dev (got "msg91")',
    );
    expect(findTestEnvProblems(safeEnv({ AI_PROVIDER: "openai" }))).toContain('AI_PROVIDER must be mock (got "openai")');
    expect(findTestEnvProblems(safeEnv({ STORAGE_PROVIDER: "r2" }))).toContain(
      'STORAGE_PROVIDER must be unset or supabase (got "r2")',
    );
    expect(findTestEnvProblems(safeEnv({ AI_EVAL_LIVE: "true" }))).toContain(
      'AI_EVAL_LIVE must be unset or false or 0 (got "true")',
    );
  });

  it.each([...FORBIDDEN_VARS])("rejects real-credential variable %s", (key) => {
    expect(findTestEnvProblems(safeEnv({ [key]: "anything" }))).toContain(`${key} must not be set in the test lane`);
  });

  // V2-04 04-00 (review A L-8, R-47): the staging lane's names are refused by prefix, whatever the value looks like.
  it.each(["STAGING_SECRET_KEY", "STAGING_SEED_PASSWORD", "STAGING_PUBLISHABLE_KEY", "STAGING_DB_URL_RO", "STAGING_ANY_LATER_NAME"])(
    "rejects the staging name %s, never echoing its value (04-00 L-8)",
    (key) => {
      const value = "MARKER-staging-value-not-hosted-shaped";
      const problems = findTestEnvProblems(safeEnv({ [key]: value }));
      expect(problems).toContain(`${key} must not be set in the test lane (staging names never reach a test lane)`);
      expect(problems.join("\n")).not.toContain(value);
    },
  );

  it("an empty staging name is not a value (the shell may export it blank); a name merely containing STAGING passes", () => {
    expect(findTestEnvProblems(safeEnv({ STAGING_SECRET_KEY: "" }))).toEqual([]);
    expect(findTestEnvProblems(safeEnv({ MY_STAGING_NOTE: "x" }))).toEqual([]);
  });

  it.each([
    ["an sb_secret_ value", ["sb", "secret", "MARKER0123456789abcdefghij"].join("_"), "sb_secret_"],
    ["an sb_publishable_ value", ["sb", "publishable", "MARKER0123456789abcdefghij"].join("_"), "sb_publishable_"],
    ["an upper-case SB_SECRET_ value", ["SB", "SECRET", "MARKER0123456789abcdefghij"].join("_"), "sb_secret_"],
  ])("rejects %s in an unrelated variable as hosted, never echoing it (04-00 L-8)", (_label, value, marker) => {
    const problems = findTestEnvProblems(safeEnv({ SOME_UNRELATED_VAR: value }));
    expect(problems).toContain(`SOME_UNRELATED_VAR references a hosted service ("${marker}")`);
    expect(problems.join("\n")).not.toContain(value);
  });

  it("rejects a key with the wrong role claim (anon key in the service-role slot)", () => {
    expect(findTestEnvProblems(safeEnv({ SUPABASE_SECRET_KEY: LOCAL_ANON }))).toContain(
      'SUPABASE_SECRET_KEY has the wrong role claim (must be "service_role")',
    );
    expect(findTestEnvProblems(safeEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_SERVICE }))).toContain(
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY has the wrong role claim (must be "anon")',
    );
  });

  it.each(["MSG91_AUTH_KEY", "AI_API_KEY"])("allows only placeholders for %s", (key) => {
    for (const ok of ["x", "test-msg91-auth-key-not-real"]) {
      expect(findTestEnvProblems(safeEnv({ [key]: ok }))).toEqual([]);
    }
    for (const bad of ["a1b2c3d4e5f6realLookingKey", "test_a1b2c3d4realKey", "not-real-prefix-then-real"]) {
      expect(findTestEnvProblems(safeEnv({ [key]: bad }))).toContain(
        `${key} must be unset, "x" or end in "-not-real" in the test lane`,
      );
    }
  });

  it.each(["HTTPS_PROXY", "http_proxy", "NODE_USE_ENV_PROXY"])("refuses proxy variable %s", (key) => {
    expect(findTestEnvProblems(safeEnv({ [key]: "1" }))).toContain(
      `${key} must not be set in the test lane (unset proxies before running tests)`,
    );
  });

  it("pins the env-schema tier: APP_ENV=test for the lane, e2e for the app server (03-01, R-11)", () => {
    expect(findTestEnvProblems(safeEnv({ APP_ENV: undefined }))).toContain('APP_ENV must be test (got unset)');
    expect(findTestEnvProblems(safeEnv({ APP_ENV: "production" }))).toContain('APP_ENV must be test (got "production")');
    expect(findTestEnvProblems(safeEnv({ APP_ENV: "e2e" }), { appEnv: "e2e" })).toEqual([]);
    expect(findTestEnvProblems(safeEnv({ APP_ENV: "staging" }), { appEnv: "e2e" })).toContain(
      'APP_ENV must be e2e (got "staging")',
    );
  });

  it("refuses dev auth logging and a hosted Playwright base URL", () => {
    expect(findTestEnvProblems(safeEnv({ ENABLE_DEV_AUTH_LOGS: "true" }))).toContain(
      'ENABLE_DEV_AUTH_LOGS must be unset or false or 0 (got "true")',
    );
    expect(findTestEnvProblems(safeEnv({ PLAYWRIGHT_TEST_BASE_URL: "https://app.example.com" }))).toContain(
      'PLAYWRIGHT_TEST_BASE_URL points at non-local host "app.example.com"',
    );
  });

  it("pins the AI kill switch off (V2-02 02-03a)", () => {
    for (const ok of ["false", "0"]) expect(findTestEnvProblems(safeEnv({ AI_ENABLED: ok }))).toEqual([]);
    expect(findTestEnvProblems(safeEnv({ AI_ENABLED: "true" }))).toContain(
      'AI_ENABLED must be unset or false or 0 (got "true")',
    );
  });

  it("allows NODE_ENV=production only when the caller opts in (the e2e app server)", () => {
    expect(findTestEnvProblems(safeEnv({ NODE_ENV: "production" }))).toContain(
      'NODE_ENV must be unset or test (got "production")',
    );
    expect(findTestEnvProblems(safeEnv({ NODE_ENV: "production" }), { allowNodeEnv: ["production"] })).toEqual([]);
    expect(findTestEnvProblems(safeEnv({ NODE_ENV: "development" }), { allowNodeEnv: ["production"] })).toContain(
      'NODE_ENV must be unset or test or production (got "development")',
    );
  });

  it("pins the error-sink key to the local synthetic key and never echoes another value (03-09b)", () => {
    expect(findTestEnvProblems(safeEnv({ ERROR_INGEST_KEY: LOCAL_ERROR_INGEST_KEY }))).toEqual([]);
    const other = "MARKER-a-staging-ingest-key-0123456789";
    const problems = findTestEnvProblems(safeEnv({ ERROR_INGEST_KEY: other }));
    expect(problems.some((p) => p.startsWith("ERROR_INGEST_KEY must be unset or the local synthetic key"))).toBe(true);
    expect(problems.join("\n")).not.toContain(other);
  });

  it("keeps the diagnostic error route off in the Vitest lane; the e2e app server may turn it on (03-09b)", () => {
    expect(findTestEnvProblems(safeEnv({ DIAG_ERROR_ROUTE_ENABLED: "false" }))).toEqual([]);
    expect(findTestEnvProblems(safeEnv({ DIAG_ERROR_ROUTE_ENABLED: "true" }))).toContain(
      "DIAG_ERROR_ROUTE_ENABLED must be unset or false in this lane",
    );
    expect(findTestEnvProblems(safeEnv({ DIAG_ERROR_ROUTE_ENABLED: "true" }), { diagRoute: true })).toEqual([]);
  });

  it("pins the job runner bearer to the local synthetic secret, never echoing another value; no rotation slot (04-02)", () => {
    expect(LOCAL_JOBS_RUNNER_SECRET).toHaveLength(64);
    expect(findTestEnvProblems(safeEnv({ JOBS_RUNNER_SECRET: LOCAL_JOBS_RUNNER_SECRET }))).toEqual([]);
    const other = "MARKER-a-staging-runner-secret-0123456789abcdef";
    const problems = findTestEnvProblems(safeEnv({ JOBS_RUNNER_SECRET: other }));
    expect(problems).toContain(
      "JOBS_RUNNER_SECRET must be unset or the local synthetic secret (LOCAL_JOBS_RUNNER_SECRET) in the test lane",
    );
    expect(problems.join("\n")).not.toContain(other);
    const next = findTestEnvProblems(safeEnv({ JOBS_RUNNER_SECRET: LOCAL_JOBS_RUNNER_SECRET, JOBS_RUNNER_SECRET_NEXT: other }));
    expect(next).toEqual(["JOBS_RUNNER_SECRET_NEXT must not be set in the test lane"]);
  });

  it("pins the ops alert inbox to the local synthetic address, never echoing another value (04-04)", () => {
    expect(LOCAL_OPS_ALERT_EMAIL).toBe("ops-alerts@example.test");
    expect(findTestEnvProblems(safeEnv({ OPS_ALERT_EMAIL: LOCAL_OPS_ALERT_EMAIL }))).toEqual([]);
    expect(findTestEnvProblems(safeEnv({ OPS_ALERT_EMAIL: "" }))).toEqual([]);
    const other = "MARKER-ops-inbox@clinic.example.org";
    const problems = findTestEnvProblems(safeEnv({ OPS_ALERT_EMAIL: other }));
    expect(problems).toEqual([
      "OPS_ALERT_EMAIL must be unset or the local synthetic inbox (LOCAL_OPS_ALERT_EMAIL) in the test lane",
    ]);
    expect(problems.join("\n")).not.toContain(other);
  });

  it("keeps the drill job kinds off in the Vitest lane; the e2e app server may run them (04-02)", () => {
    expect(findTestEnvProblems(safeEnv({ JOBS_DRILL_ENABLED: "false" }))).toEqual([]);
    expect(findTestEnvProblems(safeEnv({ JOBS_DRILL_ENABLED: "true" }))).toContain("JOBS_DRILL_ENABLED must be unset or false in this lane");
    expect(findTestEnvProblems(safeEnv({ JOBS_DRILL_ENABLED: "true" }), { drillJobs: true })).toEqual([]);
  });

  it("pins messaging to dev in the Vitest lane and to sink for the e2e app server; never a real provider (04-03a)", () => {
    expect(findTestEnvProblems(safeEnv({ MESSAGING_PROVIDER: "sink" }))).toContain('MESSAGING_PROVIDER must be dev (got "sink")');
    expect(findTestEnvProblems(safeEnv({ MESSAGING_PROVIDER: "sink" }), { sinkMessaging: true })).toEqual([]);
    expect(findTestEnvProblems(safeEnv(), { sinkMessaging: true })).toContain('MESSAGING_PROVIDER must be sink (got "dev")');
    expect(findTestEnvProblems(safeEnv({ MESSAGING_PROVIDER: "msg91" }), { sinkMessaging: true })).toContain(
      'MESSAGING_PROVIDER must be sink (got "msg91")',
    );
  });

  it("pins the Send Email hook secret to the local synthetic secret and never echoes another value (03-11b)", () => {
    expect(findTestEnvProblems(safeEnv({ SEND_EMAIL_HOOK_SECRET: LOCAL_SEND_EMAIL_HOOK_SECRET }))).toEqual([]);
    const other = `v1,whsec_${Buffer.from("LEAK-another-hook-secret-value-x").toString("base64")}`;
    const problems = findTestEnvProblems(safeEnv({ SEND_EMAIL_HOOK_SECRET: other }));
    expect(problems.some((p) => p.startsWith("SEND_EMAIL_HOOK_SECRET must be unset or the local synthetic secret"))).toBe(true);
    expect(problems.join("\n")).not.toContain(other);
  });

  it("keeps the breached-password check off in the Vitest lane; the e2e server may turn it on, loopback only (03-12a)", () => {
    expect(findTestEnvProblems(safeEnv({ PWNED_CHECK: "off" }))).toEqual([]);
    expect(findTestEnvProblems(safeEnv({ PWNED_CHECK: "on", PWNED_API_BASE_URL: "http://127.0.0.1:3101" }))).toContain(
      "PWNED_CHECK must be unset or off in this lane",
    );
    expect(
      findTestEnvProblems(safeEnv({ PWNED_CHECK: "on", PWNED_API_BASE_URL: "http://127.0.0.1:3101" }), { pwnedCheck: true }),
    ).toEqual([]);
    expect(findTestEnvProblems(safeEnv({ PWNED_CHECK: "on" }), { pwnedCheck: true })).toContain(
      "PWNED_CHECK=on needs PWNED_API_BASE_URL (the loopback fake range API) in this lane",
    );
    expect(findTestEnvProblems(safeEnv({ PWNED_API_BASE_URL: "https://api.pwnedpasswords.com" }))).toContain(
      'PWNED_API_BASE_URL points at non-local host "api.pwnedpasswords.com"',
    );
  });

  it("allows auth email only as disabled or the loopback Mailpit, never SES (03-11b)", () => {
    expect(findTestEnvProblems(safeEnv({ EMAIL_PROVIDER: "disabled" }))).toEqual([]);
    expect(findTestEnvProblems(safeEnv({ EMAIL_PROVIDER: "mailpit", MAILPIT_API_URL: "http://127.0.0.1:54324" }))).toEqual([]);
    expect(findTestEnvProblems(safeEnv({ EMAIL_PROVIDER: "ses" }))).toContain(
      'EMAIL_PROVIDER must be unset or disabled or mailpit (got "ses")',
    );
    expect(findTestEnvProblems(safeEnv({ MAILPIT_API_URL: "http://mail.example.org:8025" }))).toContain(
      'MAILPIT_API_URL points at non-local host "mail.example.org"',
    );
  });

  it("never lets a test lane select Resend or carry a Resend key, by any name (04-00b)", () => {
    // Built at run time: no key-shaped literal in the repo.
    const key = ["re", "MARKERguard0000000000000"].join("_");
    expect(findTestEnvProblems(safeEnv({ EMAIL_PROVIDER: "resend" }))).toContain(
      'EMAIL_PROVIDER must be unset or disabled or mailpit (got "resend")',
    );
    for (const name of ["RESEND_API_KEY", "NEXT_PUBLIC_RESEND_API_KEY"]) {
      const problems = findTestEnvProblems(safeEnv({ [name]: key }));
      expect(problems).toContain(`${name} must not be set in the test lane`);
      expect(problems.join("\n")).not.toContain(key);
    }
    expect(findTestEnvProblems(safeEnv({ SOME_URL: "https://api.resend.com/emails" }))).toContain(
      'SOME_URL references a hosted service ("api.resend.com")',
    );
  });

  it("allows only Cloudflare's Turnstile test site keys in a test lane (03-12c, R-22)", () => {
    expect([...TURNSTILE_TEST_SITE_KEYS]).toEqual([...SCHEMA_TURNSTILE_TEST_SITE_KEYS]);
    for (const key of TURNSTILE_TEST_SITE_KEYS) {
      expect(findTestEnvProblems(safeEnv({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: key }))).toEqual([]);
    }
    expect(findTestEnvProblems(safeEnv({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAAsyntheticRealKey" }))[0]).toMatch(
      /^NEXT_PUBLIC_TURNSTILE_SITE_KEY must be unset or 1x00000000000000000000AA/,
    );
  });

  it("never echoes secret values in its messages", () => {
    const secret = "sk-live-THIS-MUST-NOT-APPEAR";
    const problems = findTestEnvProblems(safeEnv({ OPENAI_API_KEY: secret, SUPABASE_ACCESS_TOKEN: secret }));
    expect(problems.join("\n")).not.toContain(secret);
  });
});

describe("local stack key loading", () => {
  it("fills keys from `supabase status` output and nothing else", () => {
    const env: EnvMap = {};
    loadLocalStackKeys(ROOT, env, () => `ANON_KEY="${LOCAL_ANON}"\nSERVICE_ROLE_KEY="${LOCAL_SERVICE}"\nAPI_URL="x"\n`);
    expect(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe(LOCAL_ANON);
    expect(env.SUPABASE_SECRET_KEY).toBe(LOCAL_SERVICE);
    expect(env.API_URL).toBeUndefined();
  });

  it("fails closed when the local stack is not running", () => {
    expect(() =>
      loadLocalStackKeys(ROOT, {}, () => {
        throw new Error("not running");
      }),
    ).toThrow(TestEnvGuardError);
  });

  it("parses dotenv content without interpolation", () => {
    expect(parseEnvFile('A=1\n# c\nexport B="two"\nC=\'3\'\nBAD\n')).toEqual({ A: "1", B: "two", C: "3" });
  });
});

describe("worker network block", () => {
  it("rejects fetch to a non-loopback host before any request is made", async () => {
    await expect(fetch("https://abcdefghijklmnop.supabase.co/rest/v1/")).rejects.toThrow(
      'Test lane blocked a network request to non-local host "abcdefghijklmnop.supabase.co"',
    );
    await expect(fetch(new URL("https://example.com/hook"))).rejects.toThrow(/non-local host "example.com"/);
  });

  it("refuses raw sockets to non-loopback hosts (node:https, AWS SDK, etc.)", async () => {
    const https = await import("node:https");
    const err = await new Promise<Error>((resolve) => {
      const req = https.request("https://example.com/", () => resolve(new Error("connected")));
      req.on("error", resolve);
      req.end();
    });
    expect(err.message).toMatch(/non-local host "example.com"|non-local host "93.184.216.34"/);
  });

  it("answers DNS for non-loopback names offline with a fixed public address", async () => {
    const dns = await import("node:dns");
    const { TEST_PUBLIC_ADDRESS } = await import("./worker-guard");
    await expect(dns.promises.lookup("partner-a.example.com", { all: true })).resolves.toEqual([
      { address: TEST_PUBLIC_ADDRESS, family: 4 },
    ]);
    const local = await dns.promises.lookup("localhost");
    expect(["127.0.0.1", "::1"]).toContain(local.address);
  });

  it("refuses resolver queries and UDP to non-loopback hosts without sending them (AR-L5)", async () => {
    const dns = await import("node:dns");
    const dgram = await import("node:dgram");
    const blocked = /blocked a DNS\/UDP request to non-local host "partner-a.example.com"/;
    await expect(dns.promises.resolve4("partner-a.example.com")).rejects.toThrow(blocked);
    await expect(dns.promises.resolveTxt("partner-a.example.com")).rejects.toThrow(blocked);
    await expect(new dns.promises.Resolver().resolve("partner-a.example.com")).rejects.toThrow(blocked);
    const viaCallback = await new Promise<Error | null>((resolve) => dns.resolve6("partner-a.example.com", (err) => resolve(err)));
    expect(viaCallback?.message).toMatch(blocked);
    const viaResolver = await new Promise<Error | null>((resolve) =>
      new dns.Resolver().resolveMx("partner-a.example.com", (err) => resolve(err)),
    );
    expect(viaResolver?.message).toMatch(blocked);
    await expect(dns.promises.reverse("93.184.216.34")).rejects.toThrow(/non-local host "93.184.216.34"/);

    const socket = dgram.createSocket("udp4");
    try {
      const sendErr = await new Promise<Error | null>((resolve) =>
        socket.send(Buffer.from("x"), 53, "partner-a.example.com", (err) => resolve(err)),
      );
      expect(sendErr?.message).toMatch(blocked);
      const connectErr = await new Promise<Error>((resolve) => {
        socket.once("error", resolve);
        socket.connect(53, "8.8.8.8");
      });
      expect(connectErr.message).toMatch(/non-local host "8.8.8.8"/);
    } finally {
      socket.close();
    }

    // Loopback still works: a UDP datagram to a local socket arrives.
    const receiver = dgram.createSocket("udp4");
    const sender = dgram.createSocket("udp4");
    try {
      await new Promise<void>((resolve) => receiver.bind(0, "127.0.0.1", () => resolve()));
      const got = new Promise<string>((resolve) => receiver.once("message", (m) => resolve(m.toString())));
      sender.send(Buffer.from("loopback"), receiver.address().port, "127.0.0.1");
      expect(await got).toBe("loopback");
    } finally {
      receiver.close();
      sender.close();
    }
  });

  it("refuses to load .env files in workers", () => {
    expect(() => process.loadEnvFile(".env")).toThrow("Test lane refused to load .env");
    expect(() => process.loadEnvFile(".env.local")).toThrow("Test lane refused to load .env.local");
  });

  it("still allows the local stack", async () => {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "" },
    });
    expect(res.status).toBe(200);
  });
});

describe("end to end: a vitest run pointed at a hosted URL", () => {
  it("aborts at config load with a non-zero exit and collects no tests", () => {
    const res = spawnSync(
      process.execPath,
      [path.join(ROOT, "node_modules/vitest/vitest.mjs"), "run", "tests/utils/phone.spec.ts", "--reporter=dot"],
      {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 120_000,
        env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co" },
      },
    );
    const output = `${res.stdout}\n${res.stderr}`;
    expect(res.status).not.toBe(0);
    expect(output).toContain("Refusing to run tests");
    expect(output).toContain('NEXT_PUBLIC_SUPABASE_URL points at non-local host "abcdefghijklmnop.supabase.co"');
    expect(output).not.toMatch(/Tests\s+\d+ passed/);
  }, 130_000);
});
