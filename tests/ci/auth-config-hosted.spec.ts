/**
 * Hosted auth-config drift check (V2-03 03-11a, AUTH-02; ruling A00-4/A00-5; threat T-03-10): proves
 * scripts/drift/auth-config-hosted.mjs compares a Management API response with the `staging` column of
 * supabase/auth-policy.json, fails naming the field on drift or on a missing expected field, refuses to run without
 * the read-only token, and never prints a secret-bearing field or the token.
 *
 * No network: the check is called with an injected `fetch` that serves the synthetic response in
 * lint-fixtures/auth-policy/hosted-staging.json (the CLI-path refusal case exits before any request).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkHostedAuthConfig } from "@/scripts/drift/auth-config-hosted.mjs";
import { ROOT, runChecker } from "./run-checker";

const ORIGIN = "https://staging.clinicos.example";
const REF = "abcdefghijklmnopqrst";
const TOKEN = "sbp_FAKE-TOKEN-MARKER-not-real";
const SECRET_MARKER = "FAKE-SECRET-MARKER";

const VARS = {
  SUPABASE_ACCESS_TOKEN_STAGING_RO: TOKEN,
  SUPABASE_PROJECT_REF_STAGING: REF,
  STAGING_ORIGIN: ORIGIN,
};

const TEMPLATES: Record<string, string> = {
  mailer_templates_recovery_content: "recovery.html",
  mailer_templates_confirmation_content: "confirmation.html",
  mailer_templates_email_change_content: "email_change.html",
  mailer_templates_password_changed_notification_content: "password_changed.html",
};

/** The synthetic staging response, as the PO would leave staging after applying the checklist (E3). */
function stagingResponse(): Record<string, unknown> {
  const body = JSON.parse(fs.readFileSync(path.join(ROOT, "lint-fixtures/auth-policy/hosted-staging.json"), "utf8"));
  delete body._fixture;
  for (const [field, file] of Object.entries(TEMPLATES)) {
    body[field] = fs.readFileSync(path.join(ROOT, "supabase/templates", file), "utf8");
  }
  return body;
}

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(body: unknown, status = 200) {
  const calls: Call[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

async function run(body: unknown, vars: Record<string, string | undefined> = VARS, status = 200) {
  const f = fakeFetch(body, status);
  const result = await checkHostedAuthConfig({ env: "staging", vars, fetchImpl: f.impl });
  const printed = `${result.lines.join("\n")}\n${JSON.stringify(result.report)}`;
  return { ...result, calls: f.calls, printed };
}

describe("hosted auth-config drift check (staging column, injected fetch)", () => {
  it("passes when the hosted config matches the staging policy, with a read-only GET to the auth config endpoint", async () => {
    const r = await run(stagingResponse());
    expect(r.lines.at(-1)).toMatch(/auth-config-hosted: PASS \(\d+ fields match the staging policy column\)/);
    expect(r.exitCode).toBe(0);
    expect(r.report?.ok).toBe(true);
    expect(r.report?.matched).toContain("security_update_password_require_current_password");
    expect(r.report?.matched).toEqual(expect.arrayContaining(["rate_limit_email_sent", "rate_limit_otp", "rate_limit_token_refresh", "rate_limit_verify"]));
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].url).toBe(`https://api.supabase.com/v1/projects/${REF}/config/auth`);
    expect(r.calls[0].init?.method).toBe("GET");
    expect((r.calls[0].init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("fails naming disable_signup when signups are on in the hosted project (A00-1)", async () => {
    const body = stagingResponse();
    body.disable_signup = false;
    const r = await run(body);
    expect(r.exitCode).toBe(1);
    expect(r.lines).toContain("auth-config-hosted: DRIFT disable_signup (signup): hosted false, policy (staging) wants true");
    expect(r.report?.mismatches).toEqual([
      { field: "disable_signup", id: "signup", toml: "auth.enable_signup", expected: true, actual: false },
    ]);
  });

  it("fails when security_update_password_require_current_password is missing from the response (A00-5, A4)", async () => {
    const body = stagingResponse();
    delete body.security_update_password_require_current_password;
    const r = await run(body);
    expect(r.exitCode).toBe(1);
    expect(r.lines.join("\n")).toContain("MISSING security_update_password_require_current_password (require_current_password)");
  });

  it("fails on a rate limit, the per-user email interval or a template body that drifted (A00-4)", async () => {
    const body = stagingResponse();
    body.rate_limit_token_refresh = 1800;
    body.smtp_max_frequency = 1;
    body.mailer_templates_recovery_content = '<a href="{{ .ConfirmationURL }}">Reset</a>';
    const r = await run(body);
    expect(r.exitCode).toBe(1);
    const fields = r.report?.mismatches.map((m) => m.field);
    expect(fields).toEqual(["rate_limit_token_refresh", "smtp_max_frequency", "mailer_templates_recovery_content"]);
    // Template bodies are reported as a hash and a length, never as text.
    expect(r.printed).not.toContain("ConfirmationURL");
  });

  it("resolves {{STAGING_ORIGIN}}: a hook URL on another origin is drift", async () => {
    const body = stagingResponse();
    body.hook_send_email_uri = "https://attacker.example/api/auth/send-email";
    const r = await run(body);
    expect(r.exitCode).toBe(1);
    expect(r.lines.join("\n")).toContain(
      `DRIFT hook_send_email_uri (hook_send_email_uri): hosted "https://attacker.example/api/auth/send-email", policy (staging) wants "${ORIGIN}/api/auth/send-email"`,
    );
  });

  it("an extra redirect URL is drift; an empty allow-list as null is not", async () => {
    const extra = stagingResponse();
    extra.uri_allow_list = "https://evil.example/**";
    expect((await run(extra)).exitCode).toBe(1);

    const asNull = stagingResponse();
    asNull.uri_allow_list = null;
    expect((await run(asNull)).exitCode).toBe(0);
  });

  it("never prints or reports a secret-bearing field or the token, even when drift is reported", async () => {
    const body = stagingResponse();
    body.security_captcha_enabled = false;
    const r = await run(body);
    expect(r.exitCode).toBe(1);
    expect(r.printed).not.toContain(SECRET_MARKER);
    expect(r.printed).not.toContain(TOKEN);
    for (const field of ["security_captcha_secret", "smtp_pass", "hook_send_email_secrets", "external_google_secret"]) {
      expect(r.printed).not.toContain(field);
    }
  });

  it("refuses to run without the token and makes no request", async () => {
    const r = await run(stagingResponse(), { ...VARS, SUPABASE_ACCESS_TOKEN_STAGING_RO: undefined });
    expect(r.exitCode).toBe(2);
    expect(r.calls).toHaveLength(0);
    expect(r.report).toBeNull();
    expect(r.lines.join("\n")).toContain("REFUSED SUPABASE_ACCESS_TOKEN_STAGING_RO is not set");
  });

  it("refuses a malformed project ref or a non-https origin before any request", async () => {
    const badRef = await run(stagingResponse(), { ...VARS, SUPABASE_PROJECT_REF_STAGING: "../../v1/projects" });
    expect(badRef.exitCode).toBe(2);
    expect(badRef.calls).toHaveLength(0);

    const httpOrigin = await run(stagingResponse(), { ...VARS, STAGING_ORIGIN: "http://staging.clinicos.example" });
    expect(httpOrigin.exitCode).toBe(2);
    expect(httpOrigin.calls).toHaveLength(0);
  });

  it("an API error is reported by status only (exit 2, nothing compared)", async () => {
    const r = await run({ message: `token ${TOKEN} rejected` }, VARS, 401);
    expect(r.exitCode).toBe(2);
    expect(r.lines.join("\n")).toContain("returned HTTP 401");
    expect(r.printed).not.toContain(TOKEN);
  });

  it("the CLI refuses without the token (exit 2) and writes no report", () => {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "auth-hosted-")), "report.json");
    // The test lane never carries the token (tests/setup/test-env.ts forbids it), so the child inherits none.
    const r = runChecker(process.execPath, [path.join(ROOT, "scripts/drift/auth-config-hosted.mjs"), "--out", out]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("REFUSED SUPABASE_ACCESS_TOKEN_STAGING_RO is not set");
    expect(fs.existsSync(out)).toBe(false);
  });
});
