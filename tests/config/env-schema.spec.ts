/**
 * V2-03 03-01 (P1-15, I-07, K-6, AI-06 L1, R-11, R-K, R-16, R-32): the env schema's tier rules.
 *
 * Each forbidden staging/production combination throws an `EnvConfigError` naming its key, and the thrown text never
 * contains a value (every value below is a distinctive synthetic marker the assertions look for). A complete synthetic
 * production profile passes; the ci profile of `.github/workflows/ci.yml` and the e2e app server's environment
 * (`buildAppServerEnv`) pass in their own tiers (K-6). No value here is real.
 */
import { describe, expect, it } from "vitest";
import { EnvConfigError, parseEnv, type EnvSource } from "@/lib/env";
import { buildAppServerEnv } from "../e2e/support/app-env";
import { LOCAL_SEND_EMAIL_HOOK_SECRET } from "../setup/test-env";

/** Unsigned JWT with the given payload (the schema reads `iss`; it never verifies signatures). */
function fakeJwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}.sig`;
}
const LOCAL_ANON = fakeJwt({ iss: "supabase-demo", role: "anon" });
const LOCAL_SERVICE = fakeJwt({ iss: "supabase-demo", role: "service_role" });

/** `v1,whsec_<base64>` of a synthetic key (assembled at runtime; no secret-shaped literal in the repo). */
function hookSecret(key: string): string {
  return `v1,whsec_${Buffer.from(key).toString("base64")}`;
}
/** 03-11b: synthetic SES IAM key pair, assembled at runtime. */
const SES_KEY_ID = ["AKIA", "MARKERSYNTH00000"].join("");
const SES_SECRET = "MARKER-ses-secret-access-key-value-0123456789";
const HOOK_SECRET = hookSecret("MARKER-hook-key-for-prod-0123456");

/** Synthetic values; each is a marker that must never appear in an error message. */
const PRODUCTION: EnvSource = {
  NODE_ENV: "production",
  APP_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://db.synthetic-project.example.org",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "MARKER-publishable-value",
  SUPABASE_SECRET_KEY: "MARKER-secret-key-value",
  NEXT_PUBLIC_APP_URL: "https://app.synthetic-clinic.example.org",
  CRON_SECRET: "MARKER-cron-secret-value-0123456789abcdef",
  MESSAGING_PROVIDER: "msg91",
  MSG91_AUTH_KEY: "MARKER-msg91-auth-value",
  MSG91_INTEGRATED_NUMBER: "910000000001",
  MSG91_WEBHOOK_SECRET: "MARKER-msg91-webhook-value",
  AI_ENABLED: "false",
  // 03-09b: production must report its errors to the sink.
  ERROR_INGEST_KEY: "MARKER-error-ingest-key-value-0123456789",
  // 03-11b: production sends auth email through SES and verifies the Send Email hook.
  EMAIL_PROVIDER: "ses",
  EMAIL_FROM: "no-reply@auth.synthetic-clinic.example.org",
  SES_ACCESS_KEY_ID: SES_KEY_ID,
  SES_SECRET_ACCESS_KEY: SES_SECRET,
  SEND_EMAIL_HOOK_SECRET: HOOK_SECRET,
  // 03-12a: production rejects breached passwords (FT-05).
  PWNED_CHECK: "on",
};

const STAGING: EnvSource = { ...PRODUCTION, APP_ENV: "staging", MESSAGING_PROVIDER: "disabled" };

/** `.github/workflows/ci.yml` `build` step: a production build with offline providers on loopback. */
const CI_BUILD: EnvSource = {
  NODE_ENV: "production",
  APP_ENV: "ci",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "ci-build-placeholder-not-a-key",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
  MESSAGING_PROVIDER: "dev",
};

function issuesOf(source: EnvSource): string[] {
  try {
    parseEnv(source);
  } catch (e) {
    expect(e).toBeInstanceOf(EnvConfigError);
    const err = e as EnvConfigError;
    // No value of the source may reach the message (keys and rules only).
    for (const value of Object.values(source)) {
      if (value && value.length >= 8 && /MARKER|LEAK/.test(value)) expect(err.message).not.toContain(value);
    }
    return err.issues;
  }
  return [];
}

function expectRejected(source: EnvSource, key: string): string[] {
  const issues = issuesOf(source);
  expect(issues.some((i) => i.startsWith(`${key}:`)), `expected an issue for ${key}, got:\n${issues.join("\n")}`).toBe(
    true,
  );
  return issues;
}

describe("env schema: complete profiles pass", () => {
  it("a complete synthetic production profile parses, flags as booleans", () => {
    const env = parseEnv(PRODUCTION);
    expect(env.APP_ENV).toBe("production");
    expect(env.MESSAGING_PROVIDER).toBe("msg91");
    expect(env.API_V1_ENABLED).toBe(false);
    expect(env.AI_ENABLED).toBe(false);
    expect(env.NEXT_PUBLIC_APP_URL).toBe("https://app.synthetic-clinic.example.org");
  });

  it("staging may run MESSAGING_PROVIDER=disabled until the accounts exist (R-16)", () => {
    expect(parseEnv(STAGING).MESSAGING_PROVIDER).toBe("disabled");
  });

  it("production with AI on and a complete provider configuration parses", () => {
    const env = parseEnv({
      ...PRODUCTION,
      AI_ENABLED: "true",
      AI_PROVIDER: "gemini",
      AI_API_KEY: "MARKER-ai-key",
      AI_MODEL_NAME: "synthetic-model",
      AI_BASE_URL: "https://ai.synthetic.example.org/v1",
    });
    expect(env.AI_ENABLED).toBe(true);
  });

  it("the ci build profile parses as tier ci (K-6)", () => {
    expect(parseEnv(CI_BUILD).APP_ENV).toBe("ci");
  });

  it("the e2e app server environment parses as tier e2e (K-6)", () => {
    const env = buildAppServerEnv({ source: {}, keys: { anonKey: LOCAL_ANON, serviceRoleKey: LOCAL_SERVICE } });
    const parsed = parseEnv(env);
    expect(parsed.APP_ENV).toBe("e2e");
    expect(parsed.MESSAGING_PROVIDER).toBe("dev");
    // 03-09b: the e2e server writes to the local sink and serves the diagnostic route.
    expect(parsed.ERROR_INGEST_KEY).toBeDefined();
    expect(parsed.DIAG_ERROR_ROUTE_ENABLED).toBe(true);
    // 03-12a: the e2e server checks passwords against the loopback fake range API.
    expect(parsed.PWNED_CHECK).toBe("on");
    expect(new URL(parsed.PWNED_API_BASE_URL).hostname).toBe("127.0.0.1");
  });

  it("development and test default the app URL and the offline messaging provider", () => {
    const local = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_ANON };
    for (const NODE_ENV of ["development", "test"]) {
      const env = parseEnv({ ...local, NODE_ENV });
      expect(env.APP_ENV).toBe(NODE_ENV);
      expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
      expect(env.MESSAGING_PROVIDER).toBe("dev");
    }
  });

  it("blank values count as unset", () => {
    expect(parseEnv({ ...PRODUCTION, AI_PROVIDER: "", MSG91_SENDER_ID: "" }).AI_PROVIDER).toBeUndefined();
  });
});

describe("env schema: the tier", () => {
  it("NODE_ENV=production without APP_ENV throws", () => {
    expectRejected({ ...PRODUCTION, APP_ENV: undefined }, "APP_ENV");
  });

  it.each(["development", "test"])("NODE_ENV=production cannot claim APP_ENV=%s (it would switch the rules off)", (tier) => {
    expectRejected({ ...PRODUCTION, APP_ENV: tier }, "APP_ENV");
  });

  it("an unknown APP_ENV throws without echoing it", () => {
    const issues = expectRejected({ ...PRODUCTION, APP_ENV: "LEAK-tier-value" }, "APP_ENV");
    expect(issues.join("\n")).not.toContain("LEAK-tier-value");
  });
});

describe("env schema: staging and production are fail-closed", () => {
  const tiers: Array<[string, EnvSource]> = [
    ["production", PRODUCTION],
    ["staging", { ...PRODUCTION, APP_ENV: "staging" }],
  ];

  describe.each(tiers)("%s", (_tier, profile) => {
    it.each<[string, EnvSource, string]>([
      ["dev messaging", { MESSAGING_PROVIDER: "dev" }, "MESSAGING_PROVIDER"],
      ["no messaging provider", { MESSAGING_PROVIDER: undefined }, "MESSAGING_PROVIDER"],
      ["msg91 without its auth key", { MSG91_AUTH_KEY: undefined }, "MSG91_AUTH_KEY"],
      ["msg91 without a sender", { MSG91_INTEGRATED_NUMBER: undefined }, "MSG91_INTEGRATED_NUMBER"],
      ["msg91 without its webhook secret", { MSG91_WEBHOOK_SECRET: undefined }, "MSG91_WEBHOOK_SECRET"],
      ["twilio without credentials", { MESSAGING_PROVIDER: "twilio" }, "TWILIO_AUTH_TOKEN"],
      [
        "twilio without a WhatsApp sender",
        {
          MESSAGING_PROVIDER: "twilio",
          TWILIO_ACCOUNT_SID: "MARKER-sid",
          TWILIO_AUTH_TOKEN: "MARKER-token",
          TWILIO_FROM_PHONE: "+10000000000",
        },
        "TWILIO_WHATSAPP_FROM",
      ],
      ["gupshup without credentials", { MESSAGING_PROVIDER: "gupshup" }, "GUPSHUP_API_KEY"],
      ["mock AI", { AI_PROVIDER: "mock" }, "AI_PROVIDER"],
      ["an http Supabase URL", { NEXT_PUBLIC_SUPABASE_URL: "http://db.synthetic.example.org" }, "NEXT_PUBLIC_SUPABASE_URL"],
      ["a loopback Supabase URL", { NEXT_PUBLIC_SUPABASE_URL: "https://127.0.0.1:54321" }, "NEXT_PUBLIC_SUPABASE_URL"],
      ["the local-stack publishable key", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_ANON }, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
      ["the local-stack secret key", { SUPABASE_SECRET_KEY: LOCAL_SERVICE }, "SUPABASE_SECRET_KEY"],
      ["no secret key", { SUPABASE_SECRET_KEY: undefined }, "SUPABASE_SECRET_KEY"],
      ["no app URL", { NEXT_PUBLIC_APP_URL: undefined }, "NEXT_PUBLIC_APP_URL"],
      ["an http app URL", { NEXT_PUBLIC_APP_URL: "http://app.synthetic.example.org" }, "NEXT_PUBLIC_APP_URL"],
      ["no cron secret", { CRON_SECRET: undefined }, "CRON_SECRET"],
      ["a short cron secret", { CRON_SECRET: "MARKER-short" }, "CRON_SECRET"],
      ["the public API on", { API_V1_ENABLED: "true" }, "API_V1_ENABLED"],
      ["a stale R2 key", { R2_ACCOUNT_ID: "MARKER-r2-account" }, "R2_ACCOUNT_ID"],
      ["a stale R2 secret", { R2_SECRET_ACCESS_KEY: "MARKER-r2-secret" }, "R2_SECRET_ACCESS_KEY"],
      ["a stale storage switch", { STORAGE_PROVIDER: "r2" }, "STORAGE_PROVIDER"],
      ["the old anon key name", { NEXT_PUBLIC_SUPABASE_ANON_KEY: "MARKER-old-anon" }, "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
      ["the old service-role key name", { SUPABASE_SERVICE_ROLE_KEY: "MARKER-old-service" }, "SUPABASE_SERVICE_ROLE_KEY"],
      ["the C-3 webhook secret name", { MESSAGING_WEBHOOK_SECRET: "MARKER-old-webhook" }, "MESSAGING_WEBHOOK_SECRET"],
      ["AI on without a key", { AI_ENABLED: "true", AI_PROVIDER: "openai", AI_MODEL_NAME: "m", AI_BASE_URL: "https://ai.example.org" }, "AI_API_KEY"],
    ])("refuses %s", (_label, override, key) => {
      expectRejected({ ...profile, ...override }, key);
    });
  });

  it("production refuses the disabled messaging provider (staging allows it)", () => {
    expectRejected({ ...PRODUCTION, MESSAGING_PROVIDER: "disabled" }, "MESSAGING_PROVIDER");
  });

  it("lists every broken rule at once, never a value", () => {
    const issues = issuesOf({
      ...PRODUCTION,
      MESSAGING_PROVIDER: "dev",
      AI_PROVIDER: "mock",
      CRON_SECRET: "MARKER-short",
      R2_ACCOUNT_ID: "MARKER-r2-account",
    });
    expect(issues.map((i) => i.split(":")[0]).sort()).toEqual(
      ["AI_PROVIDER", "CRON_SECRET", "MESSAGING_PROVIDER", "R2_ACCOUNT_ID"].sort(),
    );
  });
});

describe("env schema: auth email and the Send Email hook (03-11b, AUTH-03, PO-A3, R-16, R-31)", () => {
  const local = { NODE_ENV: "test", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_ANON };

  it("production parses with SES and the hook secret; EMAIL_PROVIDER is required and must be ses", () => {
    expect(parseEnv(PRODUCTION).EMAIL_PROVIDER).toBe("ses");
    expect(expectRejected({ ...PRODUCTION, EMAIL_PROVIDER: undefined }, "EMAIL_PROVIDER")).toContain(
      "EMAIL_PROVIDER: required in production (ses, or disabled in staging)",
    );
    expect(issuesOf({ ...PRODUCTION, EMAIL_PROVIDER: "disabled" })).toContain("EMAIL_PROVIDER: must be ses in production");
    const mailpit = issuesOf({ ...PRODUCTION, EMAIL_PROVIDER: "mailpit", MAILPIT_API_URL: "http://127.0.0.1:54324" });
    expect(mailpit).toContain("EMAIL_PROVIDER: must not be mailpit in production");
  });

  it("production requires the hook secret even if the provider were not ses", () => {
    expect(issuesOf({ ...PRODUCTION, SEND_EMAIL_HOOK_SECRET: undefined })).toEqual(
      expect.arrayContaining(["SEND_EMAIL_HOOK_SECRET: required in production"]),
    );
  });

  it("staging must choose: disabled parses until the SES account exists (R-16), mailpit is refused", () => {
    const stagingDisabled = { ...STAGING, EMAIL_PROVIDER: "disabled", SES_ACCESS_KEY_ID: undefined, SES_SECRET_ACCESS_KEY: undefined, SEND_EMAIL_HOOK_SECRET: undefined };
    expect(parseEnv(stagingDisabled).EMAIL_PROVIDER).toBe("disabled");
    expectRejected({ ...stagingDisabled, EMAIL_PROVIDER: undefined }, "EMAIL_PROVIDER");
    expect(issuesOf({ ...STAGING, EMAIL_PROVIDER: "mailpit", MAILPIT_API_URL: "http://127.0.0.1:54324" })).toContain(
      "EMAIL_PROVIDER: must not be mailpit in staging",
    );
    expect(parseEnv(STAGING).EMAIL_PROVIDER).toBe("ses");
  });

  it("ses needs the sender address, the IAM key pair and the hook secret in every tier", () => {
    const issues = issuesOf({ ...local, EMAIL_PROVIDER: "ses" });
    expect(issues.map((i) => i.split(":")[0]).sort()).toEqual(
      ["EMAIL_FROM", "SEND_EMAIL_HOOK_SECRET", "SES_ACCESS_KEY_ID", "SES_SECRET_ACCESS_KEY"].sort(),
    );
  });

  it("the SES key pair has the IAM user shape; values are never echoed", () => {
    expect(issuesOf({ ...PRODUCTION, SES_ACCESS_KEY_ID: "MARKER-not-a-key-id" })).toContain(
      "SES_ACCESS_KEY_ID: must be an IAM user access key id (AKIA followed by 16 characters)",
    );
    // A temporary (ASIA…) key needs a session token the sender never passes.
    expectRejected({ ...PRODUCTION, SES_ACCESS_KEY_ID: ["ASIA", "MARKERSYNTH00000"].join("") }, "SES_ACCESS_KEY_ID");
    expect(issuesOf({ ...PRODUCTION, SES_SECRET_ACCESS_KEY: "MARKER-short" })).toContain(
      "SES_SECRET_ACCESS_KEY: must be at least 40 characters",
    );
  });

  it("the hook secret must be v1,whsec_<base64> of at least 24 bytes", () => {
    for (const bad of ["MARKER-plain-secret-value", `whsec_${Buffer.from("MARKER-no-version-prefix-0000000").toString("base64")}`, "v1,whsec_MARKER!!"]) {
      expect(issuesOf({ ...PRODUCTION, SEND_EMAIL_HOOK_SECRET: bad })).toContain(
        "SEND_EMAIL_HOOK_SECRET: must be formatted v1,whsec_<base64> (as Supabase shows it)",
      );
    }
    const short = hookSecret("MARKER-23-bytes-of-key!");
    expect(issuesOf({ ...PRODUCTION, SEND_EMAIL_HOOK_SECRET: short })).toContain(
      "SEND_EMAIL_HOOK_SECRET: the decoded key must be at least 24 bytes",
    );
  });

  it("the local synthetic hook secret parses in the local tiers and is refused in staging and production", () => {
    expect(parseEnv({ ...local, SEND_EMAIL_HOOK_SECRET: LOCAL_SEND_EMAIL_HOOK_SECRET }).SEND_EMAIL_HOOK_SECRET).toBe(
      LOCAL_SEND_EMAIL_HOOK_SECRET,
    );
    for (const profile of [PRODUCTION, STAGING]) {
      const issues = issuesOf({ ...profile, SEND_EMAIL_HOOK_SECRET: LOCAL_SEND_EMAIL_HOOK_SECRET });
      expect(issues.some((i) => i.startsWith("SEND_EMAIL_HOOK_SECRET: must not be a local placeholder"))).toBe(true);
      expect(issues.join("\n")).not.toContain(LOCAL_SEND_EMAIL_HOOK_SECRET);
    }
  });

  it("mailpit needs a loopback API URL and a sender address; a non-loopback Mailpit URL is refused in every tier", () => {
    const issues = issuesOf({ ...local, EMAIL_PROVIDER: "mailpit" });
    expect(issues).toEqual(
      expect.arrayContaining(["MAILPIT_API_URL: required when EMAIL_PROVIDER=mailpit", "EMAIL_FROM: required when EMAIL_PROVIDER=mailpit"]),
    );
    expect(issuesOf({ ...local, MAILPIT_API_URL: "https://mail.synthetic.example.org" })).toContain(
      "MAILPIT_API_URL: must be a loopback URL",
    );
    const env = parseEnv({ ...local, EMAIL_PROVIDER: "mailpit", MAILPIT_API_URL: "http://127.0.0.1:54324", EMAIL_FROM: "no-reply@auth.example.com" });
    expect(env.EMAIL_PROVIDER).toBe("mailpit");
  });

  it("EMAIL_FROM must be an address (the message says so, without the value)", () => {
    const issues = expectRejected({ ...PRODUCTION, EMAIL_FROM: "LEAK-not-an-address" }, "EMAIL_FROM");
    expect(issues).toContain("EMAIL_FROM: must be an email address");
  });

  it("defaults to disabled in development, test and ci; the e2e server runs Mailpit with the local secret", () => {
    expect(parseEnv(local).EMAIL_PROVIDER).toBe("disabled");
    expect(parseEnv(CI_BUILD).EMAIL_PROVIDER).toBe("disabled");
    const e2e = parseEnv(buildAppServerEnv({ source: {}, keys: { anonKey: LOCAL_ANON, serviceRoleKey: LOCAL_SERVICE } }));
    expect(e2e.EMAIL_PROVIDER).toBe("mailpit");
    expect(e2e.SEND_EMAIL_HOOK_SECRET).toBe(LOCAL_SEND_EMAIL_HOOK_SECRET);
  });

  it("names no email value in the Error message", () => {
    try {
      parseEnv({ ...PRODUCTION, EMAIL_PROVIDER: "disabled", SES_ACCESS_KEY_ID: "MARKER-bad-id", SEND_EMAIL_HOOK_SECRET: "MARKER-bad" });
      throw new Error("expected a throw");
    } catch (e) {
      const message = (e as Error).message;
      for (const value of [SES_SECRET, "MARKER-bad-id", "MARKER-bad", PRODUCTION.EMAIL_FROM!]) expect(message).not.toContain(value);
    }
  });
});

describe("env schema: error sink and diagnostic route (03-09b, R-7, R-18)", () => {
  it("production without ERROR_INGEST_KEY throws; staging and the local tiers may leave it unset", () => {
    expectRejected({ ...PRODUCTION, ERROR_INGEST_KEY: undefined }, "ERROR_INGEST_KEY");
    expect(parseEnv({ ...STAGING, ERROR_INGEST_KEY: undefined }).ERROR_INGEST_KEY).toBeUndefined();
    expect(parseEnv(CI_BUILD).ERROR_INGEST_KEY).toBeUndefined();
  });

  it.each([
    ["production", PRODUCTION],
    ["staging", STAGING],
    ["ci", CI_BUILD],
  ])("a short ERROR_INGEST_KEY throws in %s, without echoing it", (_tier, profile) => {
    expectRejected({ ...profile, ERROR_INGEST_KEY: "MARKER-short-ingest" }, "ERROR_INGEST_KEY");
  });

  it.each([
    ["production", PRODUCTION],
    ["staging", STAGING],
  ])("a local placeholder ERROR_INGEST_KEY throws in %s", (_tier, profile) => {
    expectRejected({ ...profile, ERROR_INGEST_KEY: "not-real-ingest-key-not-real-ingest-key-" }, "ERROR_INGEST_KEY");
  });

  it("DIAG_ERROR_ROUTE_ENABLED=true throws in production (T-03-15)", () => {
    expectRejected({ ...PRODUCTION, DIAG_ERROR_ROUTE_ENABLED: "true" }, "DIAG_ERROR_ROUTE_ENABLED");
  });

  it("DIAG_ERROR_ROUTE_ENABLED=true parses in staging (PO action E9) and e2e; it defaults to false", () => {
    expect(parseEnv({ ...STAGING, DIAG_ERROR_ROUTE_ENABLED: "true" }).DIAG_ERROR_ROUTE_ENABLED).toBe(true);
    expect(parseEnv(PRODUCTION).DIAG_ERROR_ROUTE_ENABLED).toBe(false);
    expect(parseEnv({ ...PRODUCTION, DIAG_ERROR_ROUTE_ENABLED: "false" }).DIAG_ERROR_ROUTE_ENABLED).toBe(false);
  });

  it("a non-boolean DIAG_ERROR_ROUTE_ENABLED throws", () => {
    expectRejected({ ...STAGING, DIAG_ERROR_ROUTE_ENABLED: "yes" }, "DIAG_ERROR_ROUTE_ENABLED");
  });
});

describe("env schema: breached-password check (03-12a, FT-05, R-17)", () => {
  const local = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_ANON };
  const LOOPBACK_RANGE = "http://127.0.0.1:3101";

  it("production must have PWNED_CHECK=on (unset and off throw)", () => {
    expect(parseEnv(PRODUCTION).PWNED_CHECK).toBe("on");
    expect(issuesOf({ ...PRODUCTION, PWNED_CHECK: undefined })).toContain("PWNED_CHECK: must be on in production (FT-05)");
    expect(issuesOf({ ...PRODUCTION, PWNED_CHECK: "off" })).toContain("PWNED_CHECK: must be on in production (FT-05)");
  });

  it("defaults to off with the public API everywhere else; staging may run either way until the PO sets it", () => {
    for (const env of [parseEnv(local), parseEnv({ ...local, NODE_ENV: "test" }), parseEnv(CI_BUILD)]) {
      expect(env.PWNED_CHECK).toBe("off");
      expect(env.PWNED_API_BASE_URL).toBe("https://api.pwnedpasswords.com");
    }
    expect(parseEnv({ ...STAGING, PWNED_CHECK: "off" }).PWNED_CHECK).toBe("off");
    expect(parseEnv(STAGING).PWNED_CHECK).toBe("on");
  });

  it("a value other than on|off throws", () => {
    expectRejected({ ...STAGING, PWNED_CHECK: "true" }, "PWNED_CHECK");
  });

  it.each([
    ["production", PRODUCTION],
    ["staging", STAGING],
    ["ci", CI_BUILD],
  ])("PWNED_API_BASE_URL cannot be overridden in %s", (_tier, profile) => {
    expectRejected({ ...profile, PWNED_API_BASE_URL: LOOPBACK_RANGE }, "PWNED_API_BASE_URL");
    expectRejected({ ...profile, PWNED_API_BASE_URL: "https://range.synthetic.example.org" }, "PWNED_API_BASE_URL");
  });

  it("test and e2e accept only a loopback override; development accepts any URL", () => {
    expect(parseEnv({ ...local, NODE_ENV: "test", PWNED_API_BASE_URL: LOOPBACK_RANGE }).PWNED_API_BASE_URL).toBe(LOOPBACK_RANGE);
    expectRejected({ ...local, NODE_ENV: "test", PWNED_API_BASE_URL: "https://range.synthetic.example.org" }, "PWNED_API_BASE_URL");
    expectRejected({ ...CI_BUILD, APP_ENV: "e2e", PWNED_API_BASE_URL: "https://range.synthetic.example.org" }, "PWNED_API_BASE_URL");
    expect(parseEnv({ ...local, PWNED_API_BASE_URL: "https://range.synthetic.example.org" }).PWNED_API_BASE_URL).toBe(
      "https://range.synthetic.example.org",
    );
  });

  it("on in a loopback tier needs the loopback override (a test lane never reaches the public API)", () => {
    expect(issuesOf({ ...local, NODE_ENV: "test", PWNED_CHECK: "on" })).toContain(
      "PWNED_CHECK: on in test needs a loopback PWNED_API_BASE_URL (no public network from a test lane)",
    );
    expectRejected({ ...CI_BUILD, PWNED_CHECK: "on" }, "PWNED_CHECK");
    expect(parseEnv({ ...local, NODE_ENV: "test", PWNED_CHECK: "on", PWNED_API_BASE_URL: LOOPBACK_RANGE }).PWNED_CHECK).toBe("on");
  });
});

describe("env schema: build tiers (ci, e2e, test) are loopback-only (K-6)", () => {
  it.each(["ci", "e2e"])("%s with a non-loopback Supabase URL throws", (tier) => {
    expectRejected({ ...CI_BUILD, APP_ENV: tier, NEXT_PUBLIC_SUPABASE_URL: "https://db.synthetic.example.org" }, "NEXT_PUBLIC_SUPABASE_URL");
  });

  it("ci with a non-loopback app URL throws", () => {
    expectRejected({ ...CI_BUILD, NEXT_PUBLIC_APP_URL: "https://app.synthetic.example.org" }, "NEXT_PUBLIC_APP_URL");
  });

  it("test with a non-loopback Supabase URL throws", () => {
    expectRejected(
      { NODE_ENV: "test", NEXT_PUBLIC_SUPABASE_URL: "https://db.synthetic.example.org", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_ANON },
      "NEXT_PUBLIC_SUPABASE_URL",
    );
  });

  it("ci requires an explicit app URL and messaging provider (no development defaults)", () => {
    expectRejected({ ...CI_BUILD, NEXT_PUBLIC_APP_URL: undefined }, "NEXT_PUBLIC_APP_URL");
    expectRejected({ ...CI_BUILD, MESSAGING_PROVIDER: undefined }, "MESSAGING_PROVIDER");
  });
});

describe("env schema: AI-06 L1 (AI_ENABLED=true needs a complete provider in a production build)", () => {
  it.each(["AI_API_KEY", "AI_MODEL_NAME", "AI_BASE_URL"])("NODE_ENV=production + AI_ENABLED=true without %s throws", (key) => {
    const complete = {
      ...CI_BUILD,
      AI_ENABLED: "true",
      AI_PROVIDER: "openai",
      AI_API_KEY: "MARKER-ai-key",
      AI_MODEL_NAME: "synthetic-model",
      AI_BASE_URL: "http://127.0.0.1:9/v1",
    };
    expect(parseEnv(complete).AI_ENABLED).toBe(true);
    expectRejected({ ...complete, [key]: undefined }, key);
  });

  it("NODE_ENV=production + AI_ENABLED=true with the mock provider throws", () => {
    expectRejected({ ...CI_BUILD, AI_ENABLED: "true", AI_PROVIDER: "mock" }, "AI_PROVIDER");
  });

  it("outside a production build an incomplete AI config parses (the AI layer fails closed at runtime)", () => {
    expect(
      parseEnv({ NODE_ENV: "test", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_ANON, AI_ENABLED: "true" })
        .AI_ENABLED,
    ).toBe(true);
  });
});

describe("env schema: every tier", () => {
  const local = { NODE_ENV: "test", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_ANON };

  it("MESSAGING_PROVIDER=msg91 without MSG91_AUTH_KEY throws (no fallback to the dev logger)", () => {
    expectRejected({ ...local, MESSAGING_PROVIDER: "msg91" }, "MSG91_AUTH_KEY");
  });

  it("an old key name alone says where the value went", () => {
    const issues = expectRejected(
      { NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "MARKER-old-anon" },
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
    expect(issues).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: required (renamed from NEXT_PUBLIC_SUPABASE_ANON_KEY)");
  });

  it("shape errors name the key and the allowed values, never the received value", () => {
    const issues = expectRejected({ ...local, API_V1_ENABLED: "LEAK-flag-value" }, "API_V1_ENABLED");
    expect(issues).toContain("API_V1_ENABLED: must be one of true | false");
    const urlIssues = expectRejected({ ...local, NEXT_PUBLIC_SUPABASE_URL: "LEAK-not-a-url" }, "NEXT_PUBLIC_SUPABASE_URL");
    expect(urlIssues.join("\n")).not.toContain("LEAK-not-a-url");
    expectRejected({ ...local, MESSAGING_PROVIDER: "LEAK-provider" }, "MESSAGING_PROVIDER");
    expectRejected({ ...local, AI_PROVIDER: "LEAK-ai" }, "AI_PROVIDER");
  });

  it("names no value in the Error message either (the whole text)", () => {
    try {
      parseEnv({ ...PRODUCTION, MESSAGING_PROVIDER: "dev", SUPABASE_SECRET_KEY: LOCAL_SERVICE });
      throw new Error("expected a throw");
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toMatch(/MESSAGING_PROVIDER: must not be dev in production/);
      for (const value of [
        LOCAL_SERVICE,
        PRODUCTION.MSG91_AUTH_KEY!,
        PRODUCTION.CRON_SECRET!,
        PRODUCTION.MSG91_WEBHOOK_SECRET!,
        PRODUCTION.ERROR_INGEST_KEY!,
      ]) {
        expect(message).not.toContain(value);
      }
    }
  });
});
