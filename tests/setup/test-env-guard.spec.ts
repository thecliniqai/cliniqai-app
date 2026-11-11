/**
 * V2-01a acceptance: "the guard aborts a run pointed at any non-local URL; zero tests reach a hosted URL".
 * Unit-level checks of the rule set, plus an end-to-end check that a real `vitest run` pointed at a hosted URL
 * exits non-zero at config load, before any test file is collected.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_VARS,
  findTestEnvProblems,
  loadLocalStackKeys,
  parseEnvFile,
  TestEnvGuardError,
} from "./test-env";

const ROOT = path.resolve(__dirname, "../..");

/** Unsigned JWT with the given payload (the guard reads `iss`; it never verifies signatures). */
function fakeJwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}.sig`;
}

const LOCAL_ANON = fakeJwt({ iss: "supabase-demo", role: "anon" });
const LOCAL_SERVICE = fakeJwt({ iss: "supabase-demo", role: "service_role" });

function safeEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: LOCAL_ANON,
    SUPABASE_SERVICE_ROLE_KEY: LOCAL_SERVICE,
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
    expect(findTestEnvProblems(safeEnv({ SUPABASE_SERVICE_ROLE_KEY: hostedService }))).toContain(
      'SUPABASE_SERVICE_ROLE_KEY is not a local-stack key (issuer must be "supabase-demo")',
    );
    expect(findTestEnvProblems(safeEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_abc" }))).toContain(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY is not a local-stack key (issuer must be "supabase-demo")',
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

  it("never echoes secret values in its messages", () => {
    const secret = "sk-live-THIS-MUST-NOT-APPEAR";
    const problems = findTestEnvProblems(safeEnv({ OPENAI_API_KEY: secret, SUPABASE_ACCESS_TOKEN: secret }));
    expect(problems.join("\n")).not.toContain(secret);
  });
});

describe("local stack key loading", () => {
  it("fills keys from `supabase status` output and nothing else", () => {
    const env: NodeJS.ProcessEnv = {};
    loadLocalStackKeys(ROOT, env, () => `ANON_KEY="${LOCAL_ANON}"\nSERVICE_ROLE_KEY="${LOCAL_SERVICE}"\nAPI_URL="x"\n`);
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe(LOCAL_ANON);
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe(LOCAL_SERVICE);
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
