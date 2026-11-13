/**
 * V2-03 03-01 (P1-15, I-07, K-6, AI-06 L1, R-11, R-K, R-16, R-32): the env schema's tier rules.
 *
 * Each forbidden staging/production combination throws an `EnvConfigError` naming its key, and the thrown text never
 * contains a value (every value below is a distinctive synthetic marker the assertions look for). A complete synthetic
 * production profile passes; the ci profile of `.github/workflows/ci.yml` and the e2e app server's environment
 * (`buildAppServerEnv`) pass in their own tiers (K-6). No value here is real.
 */
import { describe, expect, it } from "vitest";
import { EnvConfigError, isLoopbackHost, parseEnv, SECRET_ENV_NAMES, type EnvSource } from "@/lib/env";
import { buildAppServerEnv } from "../e2e/support/app-env";
import { LOCAL_SEND_EMAIL_HOOK_SECRET } from "../setup/test-env";

/** Unsigned JWT with the given payload (the schema reads `iss`; it never verifies signatures). */
function fakeJwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}.sig`;
}
const LOCAL_ANON = fakeJwt({ iss: "supabase-demo", role: "anon" });
const LOCAL_SERVICE = fakeJwt({ iss: "supabase-demo", role: "service_role" });
/** 03-13 H-ENV: hosted-shaped keys (R-K prefixes), assembled at runtime so no key-shaped literal sits in the repo. */
const hostedKey = (kind: "publishable" | "secret", marker: string) => ["sb", kind, marker].join("_");
const PUBLISHABLE = hostedKey("publishable", "MARKER-publishable-value");
const SECRET = hostedKey("secret", "MARKER-secret-key-value");

/** `v1,whsec_<base64>` of a synthetic key (assembled at runtime; no secret-shaped literal in the repo). */
function hookSecret(key: string): string {
  return `v1,whsec_${Buffer.from(key).toString("base64")}`;
}
/** 03-11b: synthetic SES IAM key pair, assembled at runtime. */
const SES_KEY_ID = ["AKIA", "MARKERSYNTH00000"].join("");
const SES_SECRET = "MARKER-ses-secret-access-key-value-0123456789";
const HOOK_SECRET = hookSecret("MARKER-hook-key-for-prod-0123456");
/** 04-00b: a synthetic Resend key (`re_` + body), assembled at runtime. */
const RESEND_KEY = ["re", "MARKERschemaResendKey0000"].join("_");
/** 04-00b: the PO's launch configuration (Resend until go-live): SES names unset, Resend key set. */
const RESEND_EMAIL: EnvSource = {
  EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: RESEND_KEY,
  SES_ACCESS_KEY_ID: undefined,
  SES_SECRET_ACCESS_KEY: undefined,
};

/** Synthetic values; each is a marker that must never appear in an error message. */
const PRODUCTION: EnvSource = {
  NODE_ENV: "production",
  APP_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://db.synthetic-project.example.org",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
  SUPABASE_SECRET_KEY: SECRET,
  NEXT_PUBLIC_APP_URL: "https://app.synthetic-clinic.example.org",
  CRON_SECRET: "MARKER-cron-secret-value-0123456789abcdef",
  // 04-02: the pg_cron runner bearer (its own secret, never the cron one).
  JOBS_RUNNER_SECRET: "MARKER-jobs-runner-secret-value-0123456789abcdef",
  // 04-04 (R-1): production emails ops alerts to one inbox.
  OPS_ALERT_EMAIL: "ops-alerts@synthetic-clinic.example.org",
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
  // 03-12c: production shows a real Turnstile widget on sign-in and reset (C43). Synthetic, key-shaped.
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0xMARKER-turnstile-site-key",
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
    // 04-03a (R-9): a runner pass in e2e sends nothing and writes no file.
    expect(parsed.MESSAGING_PROVIDER).toBe("sink");
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

  it("MESSAGING_PROVIDER=sink parses in staging and every local tier and is refused in production (04-03a, R-9)", () => {
    expect(parseEnv({ ...STAGING, MESSAGING_PROVIDER: "sink" }).MESSAGING_PROVIDER).toBe("sink");
    expectRejected({ ...PRODUCTION, MESSAGING_PROVIDER: "sink" }, "MESSAGING_PROVIDER");
    let message = "";
    try {
      parseEnv({ ...PRODUCTION, MESSAGING_PROVIDER: "sink" });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/MESSAGING_PROVIDER: must not be sink in production/);
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

describe("env schema: the Resend provider (04-00b, PO decision 2026-11-13)", () => {
  const local = { NODE_ENV: "test", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_ANON };

  it.each([
    ["production", PRODUCTION],
    ["staging", STAGING],
  ])("%s parses with EMAIL_PROVIDER=resend, the key, the sender and the hook secret", (_tier, profile) => {
    const env = parseEnv({ ...profile, ...RESEND_EMAIL });
    expect(env.EMAIL_PROVIDER).toBe("resend");
    expect(env.RESEND_API_KEY).toBe(RESEND_KEY);
  });

  it.each([
    ["production", PRODUCTION],
    ["staging", STAGING],
  ])("%s refuses resend without RESEND_API_KEY (no silent fallback), naming the key", (tier, profile) => {
    const issues = issuesOf({ ...profile, ...RESEND_EMAIL, RESEND_API_KEY: undefined });
    expect(issues).toEqual(["RESEND_API_KEY: required when EMAIL_PROVIDER=resend"]);
    expect(issuesOf({ ...profile, ...RESEND_EMAIL, RESEND_API_KEY: " " })).toEqual(["RESEND_API_KEY: required when EMAIL_PROVIDER=resend"]);
    void tier;
  });

  it.each([
    ["production", PRODUCTION],
    ["staging", STAGING],
  ])("%s refuses resend without the sender address or the hook secret", (_tier, profile) => {
    expect(issuesOf({ ...profile, ...RESEND_EMAIL, EMAIL_FROM: undefined })).toContain("EMAIL_FROM: required when EMAIL_PROVIDER=resend");
    expect(issuesOf({ ...profile, ...RESEND_EMAIL, SEND_EMAIL_HOOK_SECRET: undefined })).toContain(
      "SEND_EMAIL_HOOK_SECRET: required when EMAIL_PROVIDER=resend",
    );
  });

  it("resend needs its key, the sender address and the hook secret in the local tiers too", () => {
    const issues = issuesOf({ ...local, EMAIL_PROVIDER: "resend" });
    expect(issues.map((i) => i.split(":")[0]).sort()).toEqual(["EMAIL_FROM", "RESEND_API_KEY", "SEND_EMAIL_HOOK_SECRET"].sort());
  });

  it.each([
    ["production", PRODUCTION],
    ["staging", STAGING],
  ])("%s refuses EMAIL_PROVIDER=mailpit (a loopback catcher, never a deploy sender)", (tier, profile) => {
    expect(issuesOf({ ...profile, EMAIL_PROVIDER: "mailpit", MAILPIT_API_URL: "http://127.0.0.1:54324" })).toContain(
      `EMAIL_PROVIDER: must not be mailpit in ${tier}`,
    );
  });

  it("a value that is not a Resend key is refused in every tier, never echoed", () => {
    for (const bad of ["MARKER-not-a-resend-key-000000", ["re", "MARKERshort"].join("_"), ["sk", "MARKERsomeOtherService0000"].join("_")]) {
      const issues = issuesOf({ ...PRODUCTION, ...RESEND_EMAIL, RESEND_API_KEY: bad });
      expect(issues).toContain("RESEND_API_KEY: must be a Resend API key (re_ followed by 16 to 200 letters, digits, _ or -)");
      expect(issues.join("\n")).not.toContain(bad);
    }
    expect(issuesOf({ ...local, RESEND_API_KEY: "MARKER-local-not-a-key" })).toContain(
      "RESEND_API_KEY: must be a Resend API key (re_ followed by 16 to 200 letters, digits, _ or -)",
    );
  });

  it("the key is server only: a NEXT_PUBLIC_ name for it, or a Resend key in any public name, is refused in every tier", () => {
    for (const profile of [PRODUCTION, STAGING, local, CI_BUILD]) {
      const named = issuesOf({ ...profile, NEXT_PUBLIC_RESEND_API_KEY: RESEND_KEY });
      expect(named.some((i) => i.startsWith("NEXT_PUBLIC_RESEND_API_KEY: must not be set: the Resend API key is server only"))).toBe(true);
      expect(named.join("\n")).not.toContain(RESEND_KEY);
    }
    // In production the Turnstile site key is the public name a paste error would most likely hit.
    expect(issuesOf({ ...PRODUCTION, ...RESEND_EMAIL, NEXT_PUBLIC_TURNSTILE_SITE_KEY: RESEND_KEY })).toContain(
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY: must not hold a Resend API key (server only, RESEND_API_KEY)",
    );
    expect(issuesOf({ ...local, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: RESEND_KEY })).toContain(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: must not hold a Resend API key (server only, RESEND_API_KEY)",
    );
    expect(SECRET_ENV_NAMES).toContain("RESEND_API_KEY");
  });

  it("a padded Resend key is refused naming the key, never the value", () => {
    const issues = issuesOf({ ...PRODUCTION, ...RESEND_EMAIL, RESEND_API_KEY: `${RESEND_KEY}\n` });
    expect(issues).toEqual(["RESEND_API_KEY: must not have leading or trailing whitespace"]);
  });
});

describe("env schema: auth email and the Send Email hook (03-11b, AUTH-03, PO-A3, R-16, R-31)", () => {
  const local = { NODE_ENV: "test", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_ANON };

  it("production parses with SES and the hook secret; EMAIL_PROVIDER is required and must be a real provider", () => {
    expect(parseEnv(PRODUCTION).EMAIL_PROVIDER).toBe("ses");
    expect(expectRejected({ ...PRODUCTION, EMAIL_PROVIDER: undefined }, "EMAIL_PROVIDER")).toContain(
      "EMAIL_PROVIDER: required in production (resend or ses, or disabled in staging)",
    );
    expect(issuesOf({ ...PRODUCTION, EMAIL_PROVIDER: "disabled" })).toContain("EMAIL_PROVIDER: must be resend or ses in production");
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

  it("names no email value in the Error message (04-00b: the Resend key too)", () => {
    try {
      parseEnv({ ...PRODUCTION, EMAIL_PROVIDER: "resend", RESEND_API_KEY: `${RESEND_KEY}!`, NEXT_PUBLIC_RESEND_API_KEY: RESEND_KEY });
      throw new Error("expected a throw");
    } catch (e) {
      expect((e as Error).message).not.toContain(RESEND_KEY);
    }
  });

  it("names no SES value in the Error message", () => {
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

/**
 * V2-04 04-02 (RL-23, R-16, R-18, R-32; T-04-01, T-04-20): the job runner's bearer and the drill switch. Each refusal
 * names the key and never the value.
 */
describe("env schema: job runner secret and drill switch (04-02)", () => {
  const local = { NODE_ENV: "test", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_ANON };
  const RUNNER_NEXT = "MARKER-jobs-runner-next-value-0123456789abcdef";

  it.each([
    ["production", PRODUCTION],
    ["staging", STAGING],
  ])("%s without JOBS_RUNNER_SECRET throws naming it", (tier, profile) => {
    const issues = expectRejected({ ...profile, JOBS_RUNNER_SECRET: undefined }, "JOBS_RUNNER_SECRET");
    expect(issues).toContain(`JOBS_RUNNER_SECRET: required in ${tier} (the pg_cron runner bearer, 04-P8)`);
  });

  it.each([
    ["production", PRODUCTION],
    ["staging", STAGING],
    ["test", local],
  ])("a 20-character or spaced JOBS_RUNNER_SECRET throws in %s, never echoed", (_tier, profile) => {
    for (const value of ["MARKER-twenty-chars0", "MARKER-jobs-runner secret-with-a-space-0123"]) {
      expect(issuesOf({ ...profile, JOBS_RUNNER_SECRET: value })).toContain(
        "JOBS_RUNNER_SECRET: at least 32 printable ASCII characters without spaces",
      );
    }
  });

  it("JOBS_RUNNER_SECRET_NEXT equal to the current secret throws naming the key", () => {
    const issues = expectRejected({ ...PRODUCTION, JOBS_RUNNER_SECRET_NEXT: PRODUCTION.JOBS_RUNNER_SECRET }, "JOBS_RUNNER_SECRET_NEXT");
    expect(issues).toEqual(["JOBS_RUNNER_SECRET_NEXT: must differ from JOBS_RUNNER_SECRET"]);
  });

  it("JOBS_RUNNER_SECRET_NEXT needs a current secret and the same shape", () => {
    expect(issuesOf({ ...local, JOBS_RUNNER_SECRET_NEXT: RUNNER_NEXT })).toEqual(["JOBS_RUNNER_SECRET_NEXT: requires JOBS_RUNNER_SECRET"]);
    expect(issuesOf({ ...PRODUCTION, JOBS_RUNNER_SECRET_NEXT: "MARKER-short-next" })).toEqual([
      "JOBS_RUNNER_SECRET_NEXT: at least 32 printable ASCII characters without spaces",
    ]);
    const env = parseEnv({ ...PRODUCTION, JOBS_RUNNER_SECRET_NEXT: RUNNER_NEXT });
    expect(env.JOBS_RUNNER_SECRET_NEXT).toBe(RUNNER_NEXT);
  });

  it("the runner secret must not be the cron secret (a dedicated secret, R-16)", () => {
    const issues = expectRejected({ ...PRODUCTION, JOBS_RUNNER_SECRET: PRODUCTION.CRON_SECRET }, "JOBS_RUNNER_SECRET");
    expect(issues).toEqual(["JOBS_RUNNER_SECRET: must differ from CRON_SECRET (a dedicated runner secret, R-16)"]);
  });

  it("a padded runner secret or rotation slot is refused in every tier (both are secret names)", () => {
    expect(SECRET_ENV_NAMES).toEqual(expect.arrayContaining(["JOBS_RUNNER_SECRET", "JOBS_RUNNER_SECRET_NEXT"]));
    expect(issuesOf({ ...PRODUCTION, JOBS_RUNNER_SECRET: `${PRODUCTION.JOBS_RUNNER_SECRET}\n` })).toContain(
      "JOBS_RUNNER_SECRET: must not have leading or trailing whitespace",
    );
    expect(issuesOf({ ...PRODUCTION, JOBS_RUNNER_SECRET_NEXT: ` ${RUNNER_NEXT}` })).toContain(
      "JOBS_RUNNER_SECRET_NEXT: must not have leading or trailing whitespace",
    );
  });

  it("the local tiers may leave the runner secret unset (the route then refuses every call)", () => {
    expect(parseEnv(local).JOBS_RUNNER_SECRET).toBeUndefined();
    expect(parseEnv(CI_BUILD).JOBS_RUNNER_SECRET).toBeUndefined();
  });

  it("production with JOBS_DRILL_ENABLED=true throws (R-32); staging may drill; it defaults to false", () => {
    expectRejected({ ...PRODUCTION, JOBS_DRILL_ENABLED: "true" }, "JOBS_DRILL_ENABLED");
    expect(parseEnv({ ...STAGING, JOBS_DRILL_ENABLED: "true" }).JOBS_DRILL_ENABLED).toBe(true);
    expect(parseEnv(PRODUCTION).JOBS_DRILL_ENABLED).toBe(false);
    expect(parseEnv({ ...PRODUCTION, JOBS_DRILL_ENABLED: "false" }).JOBS_DRILL_ENABLED).toBe(false);
    expectRejected({ ...STAGING, JOBS_DRILL_ENABLED: "yes" }, "JOBS_DRILL_ENABLED");
  });

  it("production without OPS_ALERT_EMAIL, or with a malformed address, throws naming the key (04-04, R-1)", () => {
    expect(parseEnv(PRODUCTION).OPS_ALERT_EMAIL).toBe("ops-alerts@synthetic-clinic.example.org");
    expect(issuesOf({ ...PRODUCTION, OPS_ALERT_EMAIL: undefined })).toContain("OPS_ALERT_EMAIL: required in production (R-1)");
    expect(issuesOf({ ...PRODUCTION, OPS_ALERT_EMAIL: "   " })).toContain("OPS_ALERT_EMAIL: required in production (R-1)");
    for (const bad of ["MARKER-not-an-address", "MARKER-ops@", "MARKER ops@example.org", "a@b@MARKER.example.org"]) {
      const issues = issuesOf({ ...PRODUCTION, OPS_ALERT_EMAIL: bad });
      expect(issues, bad).toContain("OPS_ALERT_EMAIL: must be an email address");
      expect(issues.join("\n")).not.toContain(bad);
    }
    // Staging and the local tiers may leave it unset (alerts then stay in ops.alerts and the ops report).
    expect(parseEnv({ ...STAGING, OPS_ALERT_EMAIL: undefined }).OPS_ALERT_EMAIL).toBeUndefined();
    expectRejected({ ...STAGING, OPS_ALERT_EMAIL: "MARKER-not-an-address" }, "OPS_ALERT_EMAIL");
    expect(parseEnv(CI_BUILD).OPS_ALERT_EMAIL).toBeUndefined();
  });

  it("the e2e app server emails alerts to the synthetic ops inbox (04-04)", () => {
    const env = parseEnv(buildAppServerEnv({ source: {}, keys: { anonKey: LOCAL_ANON, serviceRoleKey: LOCAL_SERVICE } }));
    expect(env.OPS_ALERT_EMAIL).toBe("ops-alerts@example.test");
  });

  it("the e2e app server runs the drill kinds with its synthetic runner secret", () => {
    const env = parseEnv(buildAppServerEnv({ source: {}, keys: { anonKey: LOCAL_ANON, serviceRoleKey: LOCAL_SERVICE } }));
    expect(env.JOBS_DRILL_ENABLED).toBe(true);
    expect(env.JOBS_RUNNER_SECRET?.length).toBeGreaterThanOrEqual(32);
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

describe("env schema: Turnstile site key (03-12c, C43, R-17, R-22)", () => {
  const local = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_ANON };
  const PASS_KEY = "1x00000000000000000000AA";
  const REAL_SHAPED = "0xMARKER-turnstile-site-key";

  it("production requires a key (unset throws)", () => {
    expect(parseEnv(PRODUCTION).NEXT_PUBLIC_TURNSTILE_SITE_KEY).toBe(REAL_SHAPED);
    expect(issuesOf({ ...PRODUCTION, NEXT_PUBLIC_TURNSTILE_SITE_KEY: undefined })).toContain(
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY: required in production (C43)",
    );
    expect(issuesOf({ ...PRODUCTION, NEXT_PUBLIC_TURNSTILE_SITE_KEY: "" })).toContain(
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY: required in production (C43)",
    );
  });

  it.each(["1x00000000000000000000AA", "2x00000000000000000000AB", "1x00000000000000000000BB", "2x00000000000000000000BB", "3x00000000000000000000FF"])(
    "production refuses the Cloudflare test key %s",
    (key) => {
      expect(issuesOf({ ...PRODUCTION, NEXT_PUBLIC_TURNSTILE_SITE_KEY: key })).toContain(
        "NEXT_PUBLIC_TURNSTILE_SITE_KEY: must not be a Cloudflare test key in production",
      );
    },
  );

  it("staging is optional: unset, a test key or a real key all parse (PO action E7 sets the real one)", () => {
    expect(parseEnv({ ...STAGING, NEXT_PUBLIC_TURNSTILE_SITE_KEY: undefined }).NEXT_PUBLIC_TURNSTILE_SITE_KEY).toBeUndefined();
    expect(parseEnv({ ...STAGING, NEXT_PUBLIC_TURNSTILE_SITE_KEY: PASS_KEY }).NEXT_PUBLIC_TURNSTILE_SITE_KEY).toBe(PASS_KEY);
    expect(parseEnv(STAGING).NEXT_PUBLIC_TURNSTILE_SITE_KEY).toBe(REAL_SHAPED);
  });

  it("development, test, e2e and ci accept only Cloudflare's test keys (and default to no widget)", () => {
    const profiles: Array<[string, EnvSource]> = [
      ["development", local],
      ["test", { ...local, NODE_ENV: "test" }],
      ["ci", CI_BUILD],
      ["e2e", { ...CI_BUILD, APP_ENV: "e2e" }],
    ];
    for (const [tier, profile] of profiles) {
      expect(parseEnv(profile).NEXT_PUBLIC_TURNSTILE_SITE_KEY, tier).toBeUndefined();
      expect(parseEnv({ ...profile, NEXT_PUBLIC_TURNSTILE_SITE_KEY: PASS_KEY }).NEXT_PUBLIC_TURNSTILE_SITE_KEY, tier).toBe(PASS_KEY);
      expect(issuesOf({ ...profile, NEXT_PUBLIC_TURNSTILE_SITE_KEY: REAL_SHAPED }), tier).toContain(
        `NEXT_PUBLIC_TURNSTILE_SITE_KEY: must be one of Cloudflare's test site keys in ${tier}`,
      );
    }
  });

  it("a value that is not site-key shaped throws in every tier", () => {
    for (const profile of [PRODUCTION, STAGING, CI_BUILD]) {
      expectRejected({ ...profile, NEXT_PUBLIC_TURNSTILE_SITE_KEY: "LEAK-not-a-site-key" }, "NEXT_PUBLIC_TURNSTILE_SITE_KEY");
      expectRejected({ ...profile, NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x<script>" }, "NEXT_PUBLIC_TURNSTILE_SITE_KEY");
    }
  });

  it("the e2e app server builds with the always-pass test key (R-22)", () => {
    const env = buildAppServerEnv({ source: {}, keys: { anonKey: LOCAL_ANON, serviceRoleKey: LOCAL_SERVICE } });
    expect(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY).toBe(PASS_KEY);
    expect(parseEnv(env).NEXT_PUBLIC_TURNSTILE_SITE_KEY).toBe(PASS_KEY);
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

describe("env schema: a Supabase key in the other key's variable (03-13 H-ENV, R-K)", () => {
  // Legacy hosted JWTs (issuer `supabase`) and the hosted prefixes, each carrying a MARKER the message must not echo.
  const HOSTED_SERVICE_JWT = fakeJwt({ iss: "supabase", ref: "MARKER-ref", role: "service_role" });
  const HOSTED_ANON_JWT = fakeJwt({ iss: "supabase", ref: "MARKER-ref", role: "anon" });
  const ADMIN_JWT = fakeJwt({ iss: "supabase", ref: "MARKER-ref", role: "supabase_admin" });
  const local = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_ANON };
  const every: Array<[string, EnvSource]> = [
    ["production", PRODUCTION],
    ["staging", STAGING],
    ["ci", CI_BUILD],
    ["e2e", { ...CI_BUILD, APP_ENV: "e2e" }],
    ["test", { ...local, NODE_ENV: "test" }],
    ["development", local],
  ];

  describe.each(every)("%s", (_tier, profile) => {
    it.each<[string, EnvSource, string]>([
      ["an sb_secret_ key as the publishable key", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SECRET }, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
      [
        "an upper-case, space-padded secret prefix as the publishable key",
        { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ` ${SECRET.replace("sb_secret_", "SB_SECRET_")}` },
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      ],
      ["a service_role JWT as the publishable key", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: HOSTED_SERVICE_JWT }, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
      ["the local service_role JWT as the publishable key", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_SERVICE }, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
      ["a JWT of another role as the publishable key", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ADMIN_JWT }, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
      ["an sb_publishable_ key as the secret key", { SUPABASE_SECRET_KEY: PUBLISHABLE }, "SUPABASE_SECRET_KEY"],
      ["an anon JWT as the secret key", { SUPABASE_SECRET_KEY: HOSTED_ANON_JWT }, "SUPABASE_SECRET_KEY"],
      ["the local anon JWT as the secret key", { SUPABASE_SECRET_KEY: LOCAL_ANON }, "SUPABASE_SECRET_KEY"],
    ])("refuses %s, naming the key and no value", (_label, override, key) => {
      const issues = expectRejected({ ...profile, ...override }, key);
      for (const value of Object.values(override)) expect(issues.join("\n")).not.toContain(value!.trim());
    });

    it("refuses both keys swapped at once", () => {
      const issues = issuesOf({ ...profile, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SECRET, SUPABASE_SECRET_KEY: PUBLISHABLE });
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: must not be a secret key/),
          expect.stringMatching(/^SUPABASE_SECRET_KEY: must not be a publishable key/),
        ]),
      );
    });
  });

  it("the local stack's own keys parse in the local tiers", () => {
    const env = parseEnv({ ...local, NODE_ENV: "test", SUPABASE_SECRET_KEY: LOCAL_SERVICE });
    expect(env.SUPABASE_SECRET_KEY).toBe(LOCAL_SERVICE);
    expect(parseEnv(buildAppServerEnv({ source: {}, keys: { anonKey: LOCAL_ANON, serviceRoleKey: LOCAL_SERVICE } })).APP_ENV).toBe("e2e");
  });

  it.each([
    ["production", PRODUCTION],
    ["staging", STAGING],
  ])("%s requires the sb_publishable_ / sb_secret_ prefixes (legacy and unrecognised keys refused)", (tier, profile) => {
    expect(parseEnv(profile).APP_ENV).toBe(tier);
    expect(issuesOf({ ...profile, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: HOSTED_ANON_JWT })).toContain(
      `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: must be a publishable key (sb_publishable_...) in ${tier} (R-K)`,
    );
    expect(issuesOf({ ...profile, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "MARKER-unrecognised-key" })).toContain(
      `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: must be a publishable key (sb_publishable_...) in ${tier} (R-K)`,
    );
    expect(issuesOf({ ...profile, SUPABASE_SECRET_KEY: HOSTED_SERVICE_JWT })).toContain(
      `SUPABASE_SECRET_KEY: must be a secret key (sb_secret_...) in ${tier} (R-K)`,
    );
    expect(issuesOf({ ...profile, SUPABASE_SECRET_KEY: "MARKER-unrecognised-secret" })).toContain(
      `SUPABASE_SECRET_KEY: must be a secret key (sb_secret_...) in ${tier} (R-K)`,
    );
  });
});

describe("env schema: deploy tiers only in a Vercel production deployment (03-13 M-PREVIEW, R-9)", () => {
  it.each([
    ["production", PRODUCTION],
    ["staging", STAGING],
  ])("%s refuses a preview or development deployment and accepts production or no Vercel at all", (tier, profile) => {
    for (const vercelEnv of ["preview", "development", "LEAK-vercel-env"]) {
      const issues = issuesOf({ ...profile, VERCEL_ENV: vercelEnv });
      expect(issues).toContain(`VERCEL_ENV: must be production when APP_ENV=${tier} (no preview or development deployment with ${tier} secrets)`);
      expect(issues.join("\n")).not.toContain("LEAK-vercel-env");
    }
    expect(parseEnv({ ...profile, VERCEL_ENV: "production" }).VERCEL_ENV).toBe("production");
    expect(parseEnv(profile).VERCEL_ENV).toBeUndefined();
  });

  it("staging refuses any branch but feature/v2; production is not bound to a branch here", () => {
    expect(issuesOf({ ...STAGING, VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "LEAK-attacker-branch" })).toEqual([
      "VERCEL_GIT_COMMIT_REF: must be feature/v2 when APP_ENV=staging (staging deploys only that branch)",
    ]);
    expect(parseEnv({ ...STAGING, VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "feature/v2" }).APP_ENV).toBe("staging");
    expect(parseEnv({ ...PRODUCTION, VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" }).APP_ENV).toBe("production");
  });

  it("the build and local tiers ignore VERCEL_ENV (the tier is never inferred from it, R-11)", () => {
    expect(parseEnv({ ...CI_BUILD, VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "any-branch" }).APP_ENV).toBe("ci");
  });
});

/**
 * V2-04 04-00 (review A L-1, R-47): a value that is blank after `trim()` is unset, and a credential-shaped name with
 * leading or trailing whitespace is refused in every tier, naming the key and never the value. Before 04-00 all of
 * these booted in production.
 */
describe("env schema: blank and padded secrets (04-00, review A L-1)", () => {
  const spaces = (n: number) => " ".repeat(n);

  it("a CRON_SECRET of 32 spaces is unset (refused as missing in production), never echoed", () => {
    const issues = expectRejected({ ...PRODUCTION, CRON_SECRET: spaces(32) }, "CRON_SECRET");
    expect(issues).toContain("CRON_SECRET: required in production, at least 32 characters");
  });

  it.each(["SUPABASE_SECRET_KEY", "MSG91_AUTH_KEY", "MSG91_WEBHOOK_SECRET"])("%s=\" \" is refused as missing in production", (key) => {
    const issues = expectRejected({ ...PRODUCTION, [key]: " " }, key);
    expect(issues.find((i) => i.startsWith(`${key}:`))).toMatch(/required/);
  });

  it.each([
    ["CRON_SECRET", `${PRODUCTION.CRON_SECRET}\n`],
    ["SUPABASE_SECRET_KEY", `${SECRET} `],
    ["MSG91_AUTH_KEY", `\t${PRODUCTION.MSG91_AUTH_KEY}`],
    ["MSG91_WEBHOOK_SECRET", `${PRODUCTION.MSG91_WEBHOOK_SECRET}\r\n`],
    ["SEND_EMAIL_HOOK_SECRET", `${HOOK_SECRET}\n`],
    ["ERROR_INGEST_KEY", ` ${PRODUCTION.ERROR_INGEST_KEY}`],
    ["SES_SECRET_ACCESS_KEY", `${SES_SECRET} `],
  ])("a valid %s with surrounding whitespace is refused naming the key, never the value", (key, padded) => {
    const issues = issuesOf({ ...PRODUCTION, [key]: padded });
    expect(issues).toContain(`${key}: must not have leading or trailing whitespace`);
    expect(issues.join("\n")).not.toContain(padded.trim());
  });

  it("the padding rule holds in every tier (a padded secret in the test tier is refused too)", () => {
    const local = { NODE_ENV: "test", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_ANON };
    expect(issuesOf({ ...local, CRON_SECRET: "MARKER-local-cron-secret " })).toEqual(["CRON_SECRET: must not have leading or trailing whitespace"]);
    expect(parseEnv({ ...local, CRON_SECRET: "  " }).CRON_SECRET).toBeUndefined();
  });

  it("the rule covers every credential-shaped schema name and no public or non-secret one", () => {
    for (const key of [
      "CRON_SECRET",
      "SUPABASE_SECRET_KEY",
      "MSG91_AUTH_KEY",
      "MSG91_WEBHOOK_SECRET",
      "SEND_EMAIL_HOOK_SECRET",
      "ERROR_INGEST_KEY",
      "SES_SECRET_ACCESS_KEY",
      "TWILIO_AUTH_TOKEN",
      "GUPSHUP_API_KEY",
      "AI_API_KEY",
    ]) {
      expect(SECRET_ENV_NAMES).toContain(key);
    }
    for (const key of ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_TURNSTILE_SITE_KEY", "SES_ACCESS_KEY_ID", "MSG91_INTEGRATED_NUMBER"]) {
      expect(SECRET_ENV_NAMES).not.toContain(key);
    }
  });
});

/**
 * V2-04 04-00 (review A L-2, R-47): loopback is classified on the WHATWG-canonical host (127/8, 0.0.0.0, ::1, ::,
 * ::ffff:127.*, localhost. and *.localhost), and the deploy tiers' Supabase and app URLs must be bare https origins.
 * Before 04-00 every refused case below booted in production.
 */
describe("env schema: loopback forms and bare origins (04-00, review A L-2)", () => {
  /** A synthetic 20-character project ref (not a real project). */
  const REF = "abcdefghijklmnopqrst";

  it.each(["https://localhost./", "https://0.0.0.0", "https://[::ffff:127.0.0.1]", "https://127.0.0.2", "https://127.1", "https://[::]", "https://app.localhost."])(
    "production refuses NEXT_PUBLIC_APP_URL=%s as loopback",
    (url) => {
      expect(issuesOf({ ...PRODUCTION, NEXT_PUBLIC_APP_URL: url })).toContain("NEXT_PUBLIC_APP_URL: must be a non-loopback https URL in production");
    },
  );

  it.each(["https://localhost./", "https://0.0.0.0", "https://[::ffff:127.0.0.1]", "https://127.0.0.2"])(
    "staging refuses NEXT_PUBLIC_SUPABASE_URL=%s as loopback",
    (url) => {
      expect(issuesOf({ ...STAGING, NEXT_PUBLIC_SUPABASE_URL: url })).toContain("NEXT_PUBLIC_SUPABASE_URL: must be a non-loopback https URL in staging");
    },
  );

  it.each([
    ["userinfo, a path and a query", `https://u:p@${REF}.supabase.co/x?y`],
    ["userinfo only", `https://u:p@${REF}.supabase.co`],
    ["a path", `https://${REF}.supabase.co/rest/v1`],
    ["a query", `https://${REF}.supabase.co/?apikey=MARKER-query-value`],
    ["a lone ?", `https://${REF}.supabase.co?`],
    ["a fragment", `https://${REF}.supabase.co/#x`],
  ])("production refuses a Supabase URL with %s as not a bare origin, never echoing it", (_label, url) => {
    const issues = issuesOf({ ...PRODUCTION, NEXT_PUBLIC_SUPABASE_URL: url });
    expect(issues).toContain("NEXT_PUBLIC_SUPABASE_URL: must be a bare https origin in production (no credentials, path, query or fragment)");
    expect(issues.join("\n")).not.toContain(url);
  });

  it("the app URL must be a bare origin too (staging)", () => {
    expect(issuesOf({ ...STAGING, NEXT_PUBLIC_APP_URL: "https://app.synthetic-clinic.example.org/clinic" })).toEqual([
      "NEXT_PUBLIC_APP_URL: must be a bare https origin in staging (no credentials, path, query or fragment)",
    ]);
  });

  it("a bare hosted origin passes, with or without the trailing slash", () => {
    for (const url of [`https://${REF}.supabase.co`, `https://${REF}.supabase.co/`]) {
      expect(parseEnv({ ...PRODUCTION, NEXT_PUBLIC_SUPABASE_URL: url }).NEXT_PUBLIC_SUPABASE_URL).toBe(url);
    }
    expect(parseEnv({ ...STAGING, NEXT_PUBLIC_APP_URL: "https://staging.synthetic-clinic.example.org" }).APP_ENV).toBe("staging");
  });

  it("the test, e2e and ci tiers still accept the local stack (and refuse a non-loopback host)", () => {
    for (const APP_ENV of ["ci", "e2e"]) {
      expect(parseEnv({ ...CI_BUILD, APP_ENV, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }).APP_ENV).toBe(APP_ENV);
    }
    const test = { NODE_ENV: "test", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_ANON };
    expect(parseEnv(test).APP_ENV).toBe("test");
    expect(parseEnv({ ...test, NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" }).APP_ENV).toBe("test");
    expectRejected({ ...test, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1.nip.io:54321" }, "NEXT_PUBLIC_SUPABASE_URL");
  });

  it.each([
    ["127.0.0.1", true],
    ["127.255.255.254", true],
    ["0.0.0.0", true],
    ["[::1]", true],
    ["[::]", true],
    ["[::ffff:7f00:1]", true],
    ["[::ffff:7fff:ffff]", true],
    ["[::ffff:0:0]", true],
    ["localhost", true],
    ["localhost.", true],
    ["db.localhost", true],
    ["db.localhost.", true],
    ["128.0.0.1", false],
    ["[::2]", false],
    ["[::ffff:8000:1]", false],
    ["localhost.example.org", false],
    ["notlocalhost", false],
  ])("isLoopbackHost(%s) = %s", (host, expected) => {
    expect(isLoopbackHost(host)).toBe(expected);
  });
});
