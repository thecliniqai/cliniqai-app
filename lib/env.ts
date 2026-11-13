/**
 * Environment schema (V2-03 03-01: P1-15, I-07, K-6, AI-06 L1, rulings R-11, R-K, R-16, R-32).
 *
 * One list of every environment name the app reads, with its shape and the rules of each deployment tier. `APP_ENV`
 * names the tier (development | test | e2e | ci | staging | production); it is required whenever
 * `NODE_ENV=production` and is never inferred from `VERCEL_ENV` (a staging project can be a Vercel "production"
 * deployment). Staging and production are fail-closed: no offline provider, no loopback or demo Supabase, no stale
 * names. ci, e2e and test run `NODE_ENV=production` builds (ci, e2e) with offline providers but loopback URLs only.
 *
 * - `parseEnv(source)` returns the typed {@link Env} or throws {@link EnvConfigError}, whose message lists
 *   `KEY: rule` pairs and never a value.
 * - `assertDeployEnv(source)` is the boot check: `next.config.ts` (next build / start / dev) and `instrumentation.ts`
 *   (`register()`, once per server instance) call it.
 * - Server code reads `serverEnv()` from `lib/env-server.ts` (`import "server-only"`). Browser code reads
 *   {@link publicEnv}, whose getters are explicit `process.env.NEXT_PUBLIC_*` reads so Next inlines them.
 * - `ENV_DOCS` drives `.env.example` (`node scripts/ci/env-example.mjs`; `--check` in CI `static`).
 *
 * `next.config.ts` imports this file, so it uses relative imports only (no `@/` alias) and reads no environment at
 * import time.
 */
import { z } from "zod";

export const APP_ENVS = ["development", "test", "e2e", "ci", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/** Tiers a real deployment runs in: every fail-closed rule applies. */
export const DEPLOY_TIERS: readonly AppEnv[] = ["staging", "production"];
/** Tiers whose Supabase and app URLs must be loopback (the local stack). */
export const LOOPBACK_TIERS: readonly AppEnv[] = ["test", "e2e", "ci"];
/** Tiers with offline defaults (`MESSAGING_PROVIDER=dev`, `NEXT_PUBLIC_APP_URL=http://localhost:3000`). */
export const DEFAULTED_TIERS: readonly AppEnv[] = ["development", "test"];

export const MESSAGING_PROVIDERS = ["dev", "disabled", "msg91", "twilio", "gupshup"] as const;
export type MessagingProviderName = (typeof MESSAGING_PROVIDERS)[number];
/** The AI providers `lib/ai/client.ts` can call. `mock` is accepted only as the offline marker of local lanes. */
export const AI_PROVIDERS = ["openai", "gemini", "claude", "groq", "ollama", "deepseek"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];
/** 03-11b (AUTH-03, PO-A3): who delivers auth email. `mailpit` is the local catcher; `disabled` sends nothing. */
export const EMAIL_PROVIDERS = ["mailpit", "ses", "disabled"] as const;
export type EmailProviderName = (typeof EMAIL_PROVIDERS)[number];
/** Tiers that may use the local Mailpit sender (never staging or production). */
export const MAILPIT_TIERS: readonly AppEnv[] = ["development", "test", "e2e", "ci"];
/** PO-A3: SES runs in Mumbai only. A constant, not an env name: Vercel reserves `AWS_REGION` (and sets it per function). */
export const SES_REGION = "ap-south-1";

export const DEFAULT_LOCAL_APP_URL = "http://localhost:3000";
/** JWT issuer of the keys every `npx supabase start` stack uses; never valid in staging or production. */
export const LOCAL_DEMO_KEY_ISSUER = "supabase-demo";
export const MIN_CRON_SECRET_LENGTH = 32;
/** 03-09b: the error-sink ingest key (its SHA-256 is the vault secret `ops_error_ingest_key_sha256`). */
export const MIN_ERROR_INGEST_KEY_LENGTH = 32;
/**
 * 03-11b: the Send Email hook secret as Supabase shows it, `v1,whsec_<base64>`. The decoded key must be at least 24
 * bytes (the Standard Webhooks secret range is 24 to 64 bytes); the Supabase CLI itself refuses a shorter string.
 */
export const SEND_EMAIL_HOOK_SECRET_PATTERN = /^v1,whsec_[A-Za-z0-9+/]+={0,2}$/;
export const MIN_SEND_EMAIL_HOOK_KEY_BYTES = 24;
/** 03-11b (R-31): long-term access key id of the least-privilege SES IAM user. */
export const SES_ACCESS_KEY_ID_PATTERN = /^AKIA[A-Z0-9]{16}$/;

/** Names that must not be set in staging or production (stale hosted config fails loudly), with what replaced them. */
export const RETIRED_NAMES: Readonly<Record<string, string>> = {
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "renamed to NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (R-K)",
  SUPABASE_SERVICE_ROLE_KEY: "renamed to SUPABASE_SECRET_KEY (R-K)",
  MESSAGING_WEBHOOK_SECRET: "the messaging webhook secret is MSG91_WEBHOOK_SECRET (R-32)",
  STORAGE_PROVIDER: "removed: Supabase Storage is the only provider (P1-43)",
  R2_ACCOUNT_ID: "removed with the R2 provider (P1-43)",
  R2_ACCESS_KEY_ID: "removed with the R2 provider (P1-43)",
  R2_SECRET_ACCESS_KEY: "removed with the R2 provider (P1-43)",
  R2_BUCKET_NAME: "removed with the R2 provider (P1-43)",
};

/** The old name of a renamed key, so a missing new name can say where its value went. */
const RENAMED_FROM: Readonly<Record<string, string>> = {
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  SUPABASE_SECRET_KEY: "SUPABASE_SERVICE_ROLE_KEY",
  MSG91_WEBHOOK_SECRET: "MESSAGING_WEBHOOK_SECRET",
};

const text = z.string();
const flag = z.enum(["true", "false"]);

/** Shapes only; tier rules are in {@link tierIssues}. Every blank value is treated as unset before parsing. */
const shapeSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
  APP_ENV: z.enum(APP_ENVS).optional(),
  NEXT_PUBLIC_SUPABASE_URL: text.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: text,
  SUPABASE_SECRET_KEY: text.optional(),
  NEXT_PUBLIC_APP_URL: text.url().optional(),
  API_V1_ENABLED: flag.optional(),
  CRON_SECRET: text.optional(),
  MESSAGING_PROVIDER: z.enum(MESSAGING_PROVIDERS).optional(),
  MSG91_AUTH_KEY: text.optional(),
  MSG91_INTEGRATED_NUMBER: text.optional(),
  MSG91_SENDER_ID: text.optional(),
  MSG91_DLT_TE_ID: text.optional(),
  MSG91_WEBHOOK_SECRET: text.optional(),
  TWILIO_ACCOUNT_SID: text.optional(),
  TWILIO_AUTH_TOKEN: text.optional(),
  TWILIO_FROM_PHONE: text.optional(),
  TWILIO_WHATSAPP_FROM: text.optional(),
  GUPSHUP_API_KEY: text.optional(),
  GUPSHUP_APP_NAME: text.optional(),
  GUPSHUP_SRC_PHONE: text.optional(),
  AI_ENABLED: flag.optional(),
  AI_PROVIDER: z.enum([...AI_PROVIDERS, "mock"]).optional(),
  AI_API_KEY: text.optional(),
  AI_MODEL_NAME: text.optional(),
  AI_BASE_URL: text.url().optional(),
  ERROR_INGEST_KEY: text.optional(),
  DIAG_ERROR_ROUTE_ENABLED: flag.optional(),
  EMAIL_PROVIDER: z.enum(EMAIL_PROVIDERS).optional(),
  EMAIL_FROM: text.email().optional(),
  MAILPIT_API_URL: text.url().optional(),
  SES_ACCESS_KEY_ID: text.optional(),
  SES_SECRET_ACCESS_KEY: text.optional(),
  SEND_EMAIL_HOOK_SECRET: text.optional(),
  VERCEL_REGION: text.optional(),
  VERCEL_GIT_COMMIT_SHA: text.optional(),
});

type Shape = z.infer<typeof shapeSchema>;
export type EnvName = keyof Shape;

/** Every name the schema reads (the retired names are read only to refuse them). */
export const ENV_NAMES = Object.keys(shapeSchema.shape) as EnvName[];
export const ENV_SOURCE_NAMES: readonly string[] = [...ENV_NAMES, ...Object.keys(RETIRED_NAMES)];

/** The parsed environment: tier resolved, defaults applied, flags as booleans. */
export interface Env {
  NODE_ENV: "development" | "test" | "production";
  APP_ENV: AppEnv;
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SECRET_KEY?: string;
  NEXT_PUBLIC_APP_URL: string;
  API_V1_ENABLED: boolean;
  CRON_SECRET?: string;
  MESSAGING_PROVIDER: MessagingProviderName;
  MSG91_AUTH_KEY?: string;
  MSG91_INTEGRATED_NUMBER?: string;
  MSG91_SENDER_ID?: string;
  MSG91_DLT_TE_ID?: string;
  MSG91_WEBHOOK_SECRET?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_PHONE?: string;
  TWILIO_WHATSAPP_FROM?: string;
  GUPSHUP_API_KEY?: string;
  GUPSHUP_APP_NAME?: string;
  GUPSHUP_SRC_PHONE?: string;
  AI_ENABLED: boolean;
  AI_PROVIDER?: AiProviderId | "mock";
  AI_API_KEY?: string;
  AI_MODEL_NAME?: string;
  AI_BASE_URL?: string;
  ERROR_INGEST_KEY?: string;
  DIAG_ERROR_ROUTE_ENABLED: boolean;
  /** Defaults to `disabled` outside staging and production; required there. */
  EMAIL_PROVIDER: EmailProviderName;
  EMAIL_FROM?: string;
  MAILPIT_API_URL?: string;
  SES_ACCESS_KEY_ID?: string;
  SES_SECRET_ACCESS_KEY?: string;
  SEND_EMAIL_HOOK_SECRET?: string;
  VERCEL_REGION?: string;
  VERCEL_GIT_COMMIT_SHA?: string;
}

export type EnvSource = Record<string, string | undefined>;

/** Thrown when the environment is invalid. `issues` are `KEY: rule` strings; no value is ever included. */
export class EnvConfigError extends Error {
  // A plain field, not a parameter property: `scripts/ci/env-example.mjs` loads this file with Node's type stripping.
  readonly issues: string[];

  constructor(issues: string[], tier: string) {
    super(`Environment configuration error (tier ${tier}):\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "EnvConfigError";
    this.issues = issues;
  }
}

/** Value-free messages for shape errors (zod's defaults can quote the received value). */
const shapeErrorMap: z.ZodErrorMap = (issue) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return { message: issue.received === "undefined" ? "required" : "must be a string" };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: `must be one of ${issue.options.join(" | ")}` };
    case z.ZodIssueCode.invalid_string:
      return { message: issue.validation === "email" ? "must be an email address" : "must be a valid URL" };
    default:
      return { message: "invalid" };
  }
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function isLoopbackUrl(url: string): boolean {
  const host = hostOf(url);
  return host !== null && (LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost"));
}

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** True for a JWT issued by the local Supabase stack (`supabase-demo`). */
function isLocalDemoKey(key: string): boolean {
  const part = key.split(".")[1];
  if (!part) return false;
  try {
    // `atob` (not Buffer): this module is also bundled for the browser.
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="))) as { iss?: unknown };
    return payload.iss === LOCAL_DEMO_KEY_ISSUER;
  } catch {
    return false;
  }
}

function present(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

/** The decoded key of a `v1,whsec_<base64>` hook secret, or null when the shape is wrong. */
function hookSecretKey(secret: string): string | null {
  if (!SEND_EMAIL_HOOK_SECRET_PATTERN.test(secret)) return null;
  try {
    // `atob` (not Buffer): this module is also bundled for the browser.
    return atob(secret.slice("v1,whsec_".length));
  } catch {
    return null;
  }
}

/** Blank values count as unset; only the schema's own names (and the retired names) are read. */
function normalise(source: EnvSource): EnvSource {
  const out: EnvSource = {};
  for (const name of ENV_SOURCE_NAMES) {
    const value = source[name];
    out[name] = present(value) ? value : undefined;
  }
  return out;
}

/** The tier, or an issue: explicit `APP_ENV` wins; with `NODE_ENV=production` it is required. */
function resolveTier(raw: EnvSource): { tier: AppEnv | null; issue?: string } {
  const appEnv = raw.APP_ENV;
  if (appEnv !== undefined) {
    return (APP_ENVS as readonly string[]).includes(appEnv) ? { tier: appEnv as AppEnv } : { tier: null };
  }
  if (raw.NODE_ENV === "production") {
    return { tier: null, issue: "APP_ENV: required when NODE_ENV=production (development | test | e2e | ci | staging | production)" };
  }
  return { tier: raw.NODE_ENV === "test" ? "test" : "development" };
}

/** Every tier rule that `raw` breaks, as `KEY: rule`. `tier` is already resolved. */
function tierIssues(raw: EnvSource, tier: AppEnv): string[] {
  const issues: string[] = [];
  const add = (key: string, rule: string) => issues.push(`${key}: ${rule}`);
  const deploy = DEPLOY_TIERS.includes(tier);
  const nodeProduction = raw.NODE_ENV === "production";

  // A production build can claim only a build/deploy tier; `development`/`test` would switch the fail-closed rules off.
  if (nodeProduction && (tier === "development" || tier === "test")) {
    add("APP_ENV", "must be e2e, ci, staging or production when NODE_ENV=production");
  }

  // Renamed keys: say where the value went when only the old name is set.
  for (const [current, old] of Object.entries(RENAMED_FROM)) {
    if (!present(raw[current]) && present(raw[old]) && !deploy) add(current, `required (renamed from ${old})`);
  }

  const supabaseUrl = raw.NEXT_PUBLIC_SUPABASE_URL;
  const appUrl = raw.NEXT_PUBLIC_APP_URL ?? (DEFAULTED_TIERS.includes(tier) ? DEFAULT_LOCAL_APP_URL : undefined);
  if (!present(raw.NEXT_PUBLIC_APP_URL) && !DEFAULTED_TIERS.includes(tier)) add("NEXT_PUBLIC_APP_URL", "required");

  const messaging = raw.MESSAGING_PROVIDER ?? (DEFAULTED_TIERS.includes(tier) ? "dev" : undefined);
  if (!present(raw.MESSAGING_PROVIDER) && !DEFAULTED_TIERS.includes(tier)) add("MESSAGING_PROVIDER", "required");

  // A chosen messaging provider needs its credentials in every tier (no silent fallback to the dev logger).
  if (messaging === "msg91" && !present(raw.MSG91_AUTH_KEY)) add("MSG91_AUTH_KEY", "required when MESSAGING_PROVIDER=msg91");
  if (messaging === "twilio") {
    for (const key of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_PHONE"]) {
      if (!present(raw[key])) add(key, "required when MESSAGING_PROVIDER=twilio");
    }
  }
  if (messaging === "gupshup") {
    for (const key of ["GUPSHUP_API_KEY", "GUPSHUP_APP_NAME", "GUPSHUP_SRC_PHONE"]) {
      if (!present(raw[key])) add(key, "required when MESSAGING_PROVIDER=gupshup");
    }
  }

  // PO-16 / ADR-0005 §17.1: the public REST API is never on in a production build until P1-37.
  if (raw.API_V1_ENABLED === "true" && (nodeProduction || deploy)) {
    add("API_V1_ENABLED", "must not be true in production or staging (P1-37)");
  }

  // AI-06 L1 / AI_STRATEGY §4.6: an enabled AI kill switch needs a complete provider configuration to build.
  if (raw.AI_ENABLED === "true" && (nodeProduction || deploy)) {
    if (!present(raw.AI_PROVIDER) || raw.AI_PROVIDER === "mock") {
      add("AI_PROVIDER", `required when AI_ENABLED=true (one of ${AI_PROVIDERS.join(" | ")})`);
    }
    for (const key of ["AI_API_KEY", "AI_MODEL_NAME", "AI_BASE_URL"]) {
      if (!present(raw[key])) add(key, "required when AI_ENABLED=true");
    }
  }

  // 03-09b (R-7, R-18): the error-sink key is long enough to resist guessing; production must report its errors; the
  // diagnostic error route never runs in production.
  if (present(raw.ERROR_INGEST_KEY) && raw.ERROR_INGEST_KEY.length < MIN_ERROR_INGEST_KEY_LENGTH) {
    add("ERROR_INGEST_KEY", `at least ${MIN_ERROR_INGEST_KEY_LENGTH} characters`);
  }
  if (tier === "production" && !present(raw.ERROR_INGEST_KEY)) add("ERROR_INGEST_KEY", "required in production");
  if (deploy && present(raw.ERROR_INGEST_KEY) && /not-real/i.test(raw.ERROR_INGEST_KEY)) {
    add("ERROR_INGEST_KEY", `must not be a local placeholder in ${tier}`);
  }
  if (raw.DIAG_ERROR_ROUTE_ENABLED === "true" && tier === "production") {
    add("DIAG_ERROR_ROUTE_ENABLED", "must not be true in production (R-18)");
  }

  // 03-11b (AUTH-03, PO-A3, R-16, R-17, R-31): auth email. Off (`disabled`) unless chosen; staging must choose (ses, or
  // disabled until the PO's SES account exists); production sends through SES. Mailpit is a loopback catcher for local
  // lanes only. SES needs the sender address, the IAM user's key pair and the hook secret that authenticates the
  // Send Email hook calls it serves.
  const emailProvider = raw.EMAIL_PROVIDER ?? (deploy ? undefined : "disabled");
  if (deploy && !present(raw.EMAIL_PROVIDER)) add("EMAIL_PROVIDER", `required in ${tier} (ses, or disabled in staging)`);
  if (tier === "production" && present(raw.EMAIL_PROVIDER) && raw.EMAIL_PROVIDER !== "ses") {
    add("EMAIL_PROVIDER", "must be ses in production");
  }
  if (emailProvider === "mailpit") {
    if (!MAILPIT_TIERS.includes(tier)) add("EMAIL_PROVIDER", `must not be mailpit in ${tier}`);
    if (!present(raw.MAILPIT_API_URL)) add("MAILPIT_API_URL", "required when EMAIL_PROVIDER=mailpit");
    if (!present(raw.EMAIL_FROM)) add("EMAIL_FROM", "required when EMAIL_PROVIDER=mailpit");
  }
  if (present(raw.MAILPIT_API_URL) && !isLoopbackUrl(raw.MAILPIT_API_URL)) add("MAILPIT_API_URL", "must be a loopback URL");
  if (emailProvider === "ses") {
    if (!present(raw.EMAIL_FROM)) add("EMAIL_FROM", "required when EMAIL_PROVIDER=ses");
    if (!present(raw.SES_ACCESS_KEY_ID)) add("SES_ACCESS_KEY_ID", "required when EMAIL_PROVIDER=ses (R-31)");
    if (!present(raw.SES_SECRET_ACCESS_KEY)) add("SES_SECRET_ACCESS_KEY", "required when EMAIL_PROVIDER=ses (R-31)");
    if (!present(raw.SEND_EMAIL_HOOK_SECRET)) add("SEND_EMAIL_HOOK_SECRET", "required when EMAIL_PROVIDER=ses");
  }
  if (present(raw.SES_ACCESS_KEY_ID) && !SES_ACCESS_KEY_ID_PATTERN.test(raw.SES_ACCESS_KEY_ID)) {
    add("SES_ACCESS_KEY_ID", "must be an IAM user access key id (AKIA followed by 16 characters)");
  }
  if (present(raw.SES_SECRET_ACCESS_KEY) && raw.SES_SECRET_ACCESS_KEY.length < 40) {
    add("SES_SECRET_ACCESS_KEY", "must be at least 40 characters");
  }
  if (tier === "production" && !present(raw.SEND_EMAIL_HOOK_SECRET)) add("SEND_EMAIL_HOOK_SECRET", "required in production");
  if (present(raw.SEND_EMAIL_HOOK_SECRET)) {
    const key = hookSecretKey(raw.SEND_EMAIL_HOOK_SECRET);
    if (key === null) add("SEND_EMAIL_HOOK_SECRET", "must be formatted v1,whsec_<base64> (as Supabase shows it)");
    else if (key.length < MIN_SEND_EMAIL_HOOK_KEY_BYTES) {
      add("SEND_EMAIL_HOOK_SECRET", `the decoded key must be at least ${MIN_SEND_EMAIL_HOOK_KEY_BYTES} bytes`);
    } else if (deploy && /not-real/i.test(key)) add("SEND_EMAIL_HOOK_SECRET", `must not be a local placeholder in ${tier}`);
  }

  if (LOOPBACK_TIERS.includes(tier)) {
    if (present(supabaseUrl) && !isLoopbackUrl(supabaseUrl)) add("NEXT_PUBLIC_SUPABASE_URL", `must be a loopback URL in ${tier}`);
    if (present(appUrl) && !isLoopbackUrl(appUrl)) add("NEXT_PUBLIC_APP_URL", `must be a loopback URL in ${tier}`);
  }

  if (deploy) {
    if (messaging === "dev") add("MESSAGING_PROVIDER", `must not be dev in ${tier}`);
    if (messaging === "disabled" && tier === "production") add("MESSAGING_PROVIDER", "must not be disabled in production");
    if (messaging === "msg91") {
      if (!present(raw.MSG91_INTEGRATED_NUMBER) && !present(raw.MSG91_SENDER_ID)) {
        add("MSG91_INTEGRATED_NUMBER", "MSG91_INTEGRATED_NUMBER or MSG91_SENDER_ID required when MESSAGING_PROVIDER=msg91");
      }
      if (!present(raw.MSG91_WEBHOOK_SECRET)) add("MSG91_WEBHOOK_SECRET", "required when MESSAGING_PROVIDER=msg91");
    }
    if (messaging === "twilio" && !present(raw.TWILIO_WHATSAPP_FROM)) {
      add("TWILIO_WHATSAPP_FROM", "required when MESSAGING_PROVIDER=twilio (no sandbox default)");
    }
    if (raw.AI_PROVIDER === "mock") add("AI_PROVIDER", `must not be mock in ${tier}`);

    if (present(supabaseUrl) && (!isHttpsUrl(supabaseUrl) || isLoopbackUrl(supabaseUrl))) {
      add("NEXT_PUBLIC_SUPABASE_URL", `must be a non-loopback https URL in ${tier}`);
    }
    if (present(raw.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) && isLocalDemoKey(raw.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
      add("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", `must not be a local-stack key in ${tier}`);
    }
    if (!present(raw.SUPABASE_SECRET_KEY)) add("SUPABASE_SECRET_KEY", `required in ${tier}`);
    else if (isLocalDemoKey(raw.SUPABASE_SECRET_KEY)) add("SUPABASE_SECRET_KEY", `must not be a local-stack key in ${tier}`);
    if (present(appUrl) && (!isHttpsUrl(appUrl) || isLoopbackUrl(appUrl))) {
      add("NEXT_PUBLIC_APP_URL", `must be a non-loopback https URL in ${tier}`);
    }
    if (!present(raw.CRON_SECRET) || raw.CRON_SECRET.length < MIN_CRON_SECRET_LENGTH) {
      add("CRON_SECRET", `required in ${tier}, at least ${MIN_CRON_SECRET_LENGTH} characters`);
    }
    for (const [name, why] of Object.entries(RETIRED_NAMES)) {
      if (present(raw[name])) add(name, `must not be set in ${tier}: ${why}`);
    }
  }

  return issues;
}

/**
 * Parses an environment record into the typed {@link Env}. Throws {@link EnvConfigError} listing every broken rule
 * as `KEY: rule`; values are never echoed.
 */
export function parseEnv(source: EnvSource): Env {
  const raw = normalise(source);
  const { tier, issue: tierIssue } = resolveTier(raw);
  const shaped = shapeSchema.safeParse(raw, { errorMap: shapeErrorMap });

  const issues: string[] = [];
  if (tierIssue) issues.push(tierIssue);
  if (!shaped.success) {
    for (const i of shaped.error.issues) issues.push(`${i.path.join(".")}: ${i.message}`);
  }
  if (tier) issues.push(...tierIssues(raw, tier));

  const unique = [...new Set(issues)];
  if (unique.length > 0 || !shaped.success || !tier) {
    throw new EnvConfigError(unique.length > 0 ? unique : ["APP_ENV: invalid"], tier ?? "unresolved");
  }

  const s: Shape = shaped.data;
  const defaulted = DEFAULTED_TIERS.includes(tier);
  return {
    ...s,
    NODE_ENV: s.NODE_ENV ?? "development",
    APP_ENV: tier,
    // Both are checked above: present, or defaulted in development/test.
    NEXT_PUBLIC_APP_URL: s.NEXT_PUBLIC_APP_URL ?? (defaulted ? DEFAULT_LOCAL_APP_URL : ""),
    MESSAGING_PROVIDER: s.MESSAGING_PROVIDER ?? "dev",
    API_V1_ENABLED: s.API_V1_ENABLED === "true",
    AI_ENABLED: s.AI_ENABLED === "true",
    DIAG_ERROR_ROUTE_ENABLED: s.DIAG_ERROR_ROUTE_ENABLED === "true",
    // Checked above: present in staging/production.
    EMAIL_PROVIDER: s.EMAIL_PROVIDER ?? "disabled",
  };
}

/**
 * The boot check (P1-15: "production boot fails without real providers"). Called from `next.config.ts` and from
 * `instrumentation.ts` `register()`. Throws {@link EnvConfigError}; returns the parsed environment otherwise.
 */
export function assertDeployEnv(source: EnvSource): Env {
  return parseEnv(source);
}

export function isDeployTier(tier: AppEnv): boolean {
  return DEPLOY_TIERS.includes(tier);
}

function requirePublic(name: string, value: string | undefined, url: boolean): string {
  if (!present(value)) throw new EnvConfigError([`${name}: required`], "public");
  if (url && hostOf(value) === null) throw new EnvConfigError([`${name}: must be a valid URL`], "public");
  return value;
}

/**
 * The public values, for browser and server code alike. Each getter is an explicit `process.env.NEXT_PUBLIC_*` read
 * (never `process.env` as a whole) so Next inlines it into client bundles; it validates on access, so importing this
 * module never throws. The tier rules for these keys run at boot ({@link assertDeployEnv}).
 */
export const publicEnv = {
  get NEXT_PUBLIC_SUPABASE_URL(): string {
    return requirePublic("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL, true);
  },
  get NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY(): string {
    return requirePublic("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, false);
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// `.env.example` metadata (I-07). `scripts/ci/env-example.mjs` renders it; CI `static` checks the file is in sync.
// ---------------------------------------------------------------------------------------------------------------------

export interface EnvDoc {
  group: string;
  /** What the key is and its rules, one line each. */
  notes: string[];
  /** The value written into `.env.example`: a non-secret example or a placeholder. Never a real value. */
  example: string;
}

/** Placeholder for deployment-only secrets; `.env.example` writes these keys commented out. */
export const SET_IN_VERCEL = "<set in Vercel>";

export const ENV_DOCS: Record<Exclude<EnvName, "NODE_ENV" | "VERCEL_REGION" | "VERCEL_GIT_COMMIT_SHA">, EnvDoc> = {
  APP_ENV: {
    group: "Deployment tier",
    notes: [
      "development | test | e2e | ci | staging | production. Required when NODE_ENV=production; never inferred from VERCEL_ENV.",
      "staging and production are fail-closed: real providers, https non-loopback URLs, no stale names (R-11).",
    ],
    example: "development",
  },
  NEXT_PUBLIC_SUPABASE_URL: {
    group: "Supabase",
    notes: ["Project URL. Loopback only in test/e2e/ci; https and non-loopback in staging/production."],
    example: "http://127.0.0.1:54321",
  },
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: {
    group: "Supabase",
    notes: [
      "Publishable (sb_publishable_...) or legacy anon JWT key (R-K). Formerly NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      "Local stack: `npx supabase status -o env`. Never the local-stack key in staging/production.",
    ],
    example: "<publishable key>",
  },
  SUPABASE_SECRET_KEY: {
    group: "Supabase",
    notes: [
      "Secret (sb_secret_...) or legacy service-role JWT key (R-K). Formerly SUPABASE_SERVICE_ROLE_KEY. Server only.",
      "Required in staging/production; optional locally (system paths fail without it).",
    ],
    example: SET_IN_VERCEL,
  },
  NEXT_PUBLIC_APP_URL: {
    group: "App",
    notes: [
      "Base URL for patient-facing links. Defaults to http://localhost:3000 in development and test only.",
      "Required in e2e/ci/staging/production; https and non-loopback in staging/production.",
    ],
    example: DEFAULT_LOCAL_APP_URL,
  },
  CRON_SECRET: {
    group: "App",
    notes: [
      `Bearer secret for /api/cron/*. Required in staging/production, at least ${MIN_CRON_SECRET_LENGTH} characters (I-07).`,
      "Unset locally means every cron call is refused.",
    ],
    example: SET_IN_VERCEL,
  },
  API_V1_ENABLED: {
    group: "App",
    notes: ["true | false (default false). Public REST API switch; refused in production builds and staging (PO-16)."],
    example: "false",
  },
  MESSAGING_PROVIDER: {
    group: "Messaging",
    notes: [
      "dev | disabled | msg91 | twilio | gupshup. Defaults to dev in development and test only.",
      "staging: not dev (disabled allowed until accounts exist, R-16); production: a real provider.",
    ],
    example: "dev",
  },
  MSG91_AUTH_KEY: {
    group: "Messaging",
    notes: ["Required when MESSAGING_PROVIDER=msg91 (every tier)."],
    example: SET_IN_VERCEL,
  },
  MSG91_INTEGRATED_NUMBER: {
    group: "Messaging",
    notes: ["WhatsApp integrated number; this or MSG91_SENDER_ID is required for msg91 in staging/production."],
    example: SET_IN_VERCEL,
  },
  MSG91_SENDER_ID: {
    group: "Messaging",
    notes: ["SMS sender id (used when MSG91_INTEGRATED_NUMBER is unset)."],
    example: SET_IN_VERCEL,
  },
  MSG91_DLT_TE_ID: {
    group: "Messaging",
    notes: ["DLT template entity id for SMS (optional)."],
    example: SET_IN_VERCEL,
  },
  MSG91_WEBHOOK_SECRET: {
    group: "Messaging",
    notes: [
      "Shared secret MSG91 sends in the x-webhook-secret header (R-32; not MESSAGING_WEBHOOK_SECRET).",
      "Required for msg91 in staging/production; unset means every webhook is refused.",
    ],
    example: SET_IN_VERCEL,
  },
  TWILIO_ACCOUNT_SID: {
    group: "Messaging",
    notes: ["Required when MESSAGING_PROVIDER=twilio."],
    example: SET_IN_VERCEL,
  },
  TWILIO_AUTH_TOKEN: {
    group: "Messaging",
    notes: ["Required when MESSAGING_PROVIDER=twilio."],
    example: SET_IN_VERCEL,
  },
  TWILIO_FROM_PHONE: {
    group: "Messaging",
    notes: ["Required when MESSAGING_PROVIDER=twilio."],
    example: SET_IN_VERCEL,
  },
  TWILIO_WHATSAPP_FROM: {
    group: "Messaging",
    notes: ["Required for twilio in staging/production (the sandbox number is a local default only)."],
    example: SET_IN_VERCEL,
  },
  GUPSHUP_API_KEY: {
    group: "Messaging",
    notes: ["Required when MESSAGING_PROVIDER=gupshup."],
    example: SET_IN_VERCEL,
  },
  GUPSHUP_APP_NAME: {
    group: "Messaging",
    notes: ["Required when MESSAGING_PROVIDER=gupshup."],
    example: SET_IN_VERCEL,
  },
  GUPSHUP_SRC_PHONE: {
    group: "Messaging",
    notes: ["Required when MESSAGING_PROVIDER=gupshup."],
    example: SET_IN_VERCEL,
  },
  AI_ENABLED: {
    group: "AI",
    notes: [
      "true | false (default false). Deploy-level AI kill switch (AI_STRATEGY §4.6).",
      "When true in a production build: AI_PROVIDER, AI_API_KEY, AI_MODEL_NAME and AI_BASE_URL are required (AI-06 L1).",
    ],
    example: "false",
  },
  AI_PROVIDER: {
    group: "AI",
    notes: [`${AI_PROVIDERS.join(" | ")}; mock is the offline marker of local lanes and is refused in staging/production.`],
    example: "mock",
  },
  AI_API_KEY: {
    group: "AI",
    notes: ["Provider key. Server only."],
    example: SET_IN_VERCEL,
  },
  AI_MODEL_NAME: {
    group: "AI",
    notes: ["Model id for the provider."],
    example: SET_IN_VERCEL,
  },
  AI_BASE_URL: {
    group: "AI",
    notes: ["OpenAI-compatible base URL of the provider."],
    example: SET_IN_VERCEL,
  },
  ERROR_INGEST_KEY: {
    group: "Observability",
    notes: [
      `Error-sink ingest key (03-09b, R-7), at least ${MIN_ERROR_INGEST_KEY_LENGTH} characters. Server only.`,
      "Its SHA-256 (hex) is the vault secret ops_error_ingest_key_sha256 (docs/runbooks/error-sink.md, PO action E9).",
      "Required in production; unset elsewhere means errors are logged but not written to ops.error_events.",
    ],
    example: SET_IN_VERCEL,
  },
  DIAG_ERROR_ROUTE_ENABLED: {
    group: "Observability",
    notes: [
      "true | false (default false). POST /api/diag/error (CRON_SECRET bearer) throws a synthetic error (R-18).",
      "Refused in production; on staging true only during PO action E9.",
    ],
    example: "false",
  },
  EMAIL_PROVIDER: {
    group: "Email",
    notes: [
      "mailpit | ses | disabled. Who delivers auth email for the Send Email hook (03-11b, AUTH-03).",
      "Defaults to disabled outside staging/production; staging: ses or disabled (R-16); production: ses.",
      "mailpit (the local stack's catcher, loopback only) is refused in staging and production.",
    ],
    example: "disabled",
  },
  EMAIL_FROM: {
    group: "Email",
    notes: [
      "Sender address. Required for ses and mailpit; for ses it is the verified identity's address (no-reply@auth.<domain>).",
    ],
    example: "no-reply@auth.example.com",
  },
  MAILPIT_API_URL: {
    group: "Email",
    notes: ["Local Mailpit API base URL (loopback only). Required when EMAIL_PROVIDER=mailpit."],
    example: "http://127.0.0.1:54324",
  },
  SES_ACCESS_KEY_ID: {
    group: "Email",
    notes: [
      "Access key id of the least-privilege SES IAM user (R-31; ses:SendEmail on one identity). Server only.",
      `Required when EMAIL_PROVIDER=ses. Region is fixed to ${SES_REGION} (PO-A3).`,
      "Not AWS_ACCESS_KEY_ID: Vercel reserves the AWS_* credential and region names for its own runtime.",
    ],
    example: SET_IN_VERCEL,
  },
  SES_SECRET_ACCESS_KEY: {
    group: "Email",
    notes: ["Secret access key of the same IAM user. Server only. Required when EMAIL_PROVIDER=ses."],
    example: SET_IN_VERCEL,
  },
  SEND_EMAIL_HOOK_SECRET: {
    group: "Email",
    notes: [
      "Supabase Auth Send Email hook secret, v1,whsec_<base64> as the dashboard shows it (PO action E8).",
      `Decoded key at least ${MIN_SEND_EMAIL_HOOK_KEY_BYTES} bytes. Required in production and with ses; unset means every hook call is refused (401).`,
    ],
    example: SET_IN_VERCEL,
  },
};

/** Names the platform sets; documented in `.env.example` as comments, never as assignments. */
export const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  NODE_ENV: "set by Next (development for next dev, production for next build/start); never set by hand",
  VERCEL_REGION: "set by Vercel at runtime; reported by /api/health as region (R-30)",
  VERCEL_GIT_COMMIT_SHA: "set by Vercel; reported by /api/health as release (R-26)",
};
