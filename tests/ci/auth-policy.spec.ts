/**
 * Local auth policy check (V2-03 03-11a, AUTH-02): proves scripts/ci/check-auth-config.mjs passes on the repo's
 * supabase/config.toml and fails, naming the key, when config.toml drifts from the `local` column of
 * supabase/auth-policy.json (a flipped policy value, a missing key, an ungoverned key, a link in a code-only
 * template), and refuses a structurally invalid policy. Each failing case mutates a copy of the real config/policy
 * in a temp dir, so the fixtures track the committed files.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, runNodeChecker } from "./run-checker";

const CONFIG = fs.readFileSync(path.join(ROOT, "supabase/config.toml"), "utf8");
const POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, "supabase/auth-policy.json"), "utf8")) as {
  settings: Array<Record<string, unknown>>;
};

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "auth-policy-"));
}

/** Writes `config` (default: the repo config with `edit` applied) and runs the checker against it. */
function checkConfig(edit: (toml: string) => string, extra: string[] = []) {
  const dir = tmpDir();
  const edited = edit(CONFIG);
  expect(edited).not.toBe(CONFIG); // the mutation really happened
  const file = path.join(dir, "config.toml");
  fs.writeFileSync(file, edited);
  return runNodeChecker("check-auth-config.mjs", ["--config", file, ...extra]);
}

function checkPolicy(mutate: (p: typeof POLICY) => void) {
  const dir = tmpDir();
  const copy = structuredClone(POLICY);
  mutate(copy);
  const file = path.join(dir, "auth-policy.json");
  fs.writeFileSync(file, JSON.stringify(copy));
  return runNodeChecker("check-auth-config.mjs", ["--policy", file]);
}

describe("auth policy check (config.toml vs supabase/auth-policy.json, local column)", () => {
  it("passes on the committed config.toml", () => {
    const r = runNodeChecker("check-auth-config.mjs", []);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/auth-policy: PASS \(\d+ config\.toml settings match/);
  });

  it("fails naming auth.jwt_expiry when the config is back at 3600", () => {
    const r = checkConfig((t) => t.replace(/^jwt_expiry = 900$/m, "jwt_expiry = 3600"));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("MISMATCH auth.jwt_expiry: config.toml has 3600, policy (local) wants 900");
  });

  it("fails when signups are turned on (A00-1)", () => {
    const r = checkConfig((t) => t.replace(/^enable_signup = false$/m, "enable_signup = true"));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("MISMATCH auth.enable_signup: config.toml has true, policy (local) wants false");
  });

  it("fails when email confirmations are turned off", () => {
    const r = checkConfig((t) => t.replace(/^enable_confirmations = true$/m, "enable_confirmations = false"));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("auth.email.enable_confirmations");
  });

  it("fails when a governed key is removed (CLI defaults are not accepted silently)", () => {
    const r = checkConfig((t) => t.replace(/^max_frequency = "60s"\n/m, ""));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('MISMATCH auth.email.max_frequency: missing from config.toml, policy (local) wants "60s"');
  });

  it("fails on an [auth] key that no policy row governs", () => {
    const r = checkConfig((t) => `${t}\n[auth.external.google]\nenabled = true\n`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("auth.external.google.enabled: set in config.toml but not governed by supabase/auth-policy.json");
  });

  it("fails when config.toml sets a key the policy keeps off locally (the Send Email hook URL)", () => {
    const r = checkConfig((t) =>
      t.replace(/^\[auth\.hook\.send_email\]\nenabled = false$/m, '[auth.hook.send_email]\nenabled = false\nuri = "http://127.0.0.1:3000/api/auth/send-email"'),
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("MISMATCH auth.hook.send_email.uri: config.toml sets");
    expect(r.stderr).toContain("policy (local) wants it absent");
  });

  it("fails when a code-only template carries a link instead of the code", () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, "supabase/templates"), { recursive: true });
    for (const f of fs.readdirSync(path.join(ROOT, "supabase/templates"))) {
      fs.copyFileSync(path.join(ROOT, "supabase/templates", f), path.join(root, "supabase/templates", f));
    }
    fs.writeFileSync(
      path.join(root, "supabase/templates/recovery.html"),
      '<p><a href="{{ .ConfirmationURL }}">Reset your password</a></p>\n',
    );
    const r = runNodeChecker("check-auth-config.mjs", ["--root", root]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("auth.email.template.recovery.content_path: template ./supabase/templates/recovery.html contains a link marker");
    expect(r.stderr).toContain("must carry the {{ .Token }} code");
  });

  it("refuses a policy row without a source, and environments that differ without a reason (exit 2)", () => {
    const noSource = checkPolicy((p) => {
      p.settings.find((s) => s.id === "jwt_expiry")!.source = "";
    });
    expect(noSource.status).toBe(2);
    expect(noSource.stderr).toContain("(jwt_expiry): missing source");

    const noReason = checkPolicy((p) => {
      p.settings.find((s) => s.id === "jwt_expiry")!.staging = 3600;
    });
    expect(noReason.status).toBe(2);
    expect(noReason.stderr).toContain("(jwt_expiry): environments differ, so deviation_reason is required");
  });

  it("refuses a policy that maps a secret-bearing hosted field", () => {
    const r = checkPolicy((p) => {
      p.settings.push({
        id: "captcha_secret",
        toml: null,
        hosted: "security_captcha_secret",
        transform: "same",
        local: null,
        staging: "x",
        production: "x",
        dashboard: "x",
        source: "x",
        deviation_reason: null,
      });
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("hosted field security_captcha_secret is secret-bearing and must not be mapped");
  });

  it("03-13a (R-36): a 6-digit OTP breaks the length floor in any environment, also for --print (exit 1)", () => {
    for (const env of ["local", "staging", "production"] as const) {
      const dir = tmpDir();
      const copy = structuredClone(POLICY);
      for (const e of ["local", "staging", "production"]) copy.settings.find((s) => s.id === "email_otp_length")![e] = 8;
      copy.settings.find((s) => s.id === "email_otp_length")![env] = 6;
      copy.settings.find((s) => s.id === "email_otp_length")!.deviation_reason = "test";
      const file = path.join(dir, "auth-policy.json");
      fs.writeFileSync(file, JSON.stringify(copy));
      // The matching config keeps the local-column comparison out of the way when only a hosted column changes.
      const config = path.join(dir, "config.toml");
      fs.writeFileSync(config, env === "local" ? CONFIG.replace(/^otp_length = 8$/m, "otp_length = 6") : CONFIG);
      for (const extra of [[], ["--print", "staging"]]) {
        const r = runNodeChecker("check-auth-config.mjs", ["--policy", file, "--config", config, ...extra]);
        expect(r.status, `${env} ${extra.join(" ")}`).toBe(1);
        expect(r.stderr).toContain(`FLOOR email_otp_length (${env}): 6 breaks the floor >= 8 (R-36)`);
        expect(r.stdout).toBe("");
      }
    }
  });

  it("03-13a: an OTP expiry above 600 s breaks the expiry floor; the committed policy meets both floors", () => {
    const r = checkPolicy((p) => {
      for (const e of ["local", "staging", "production"]) p.settings.find((s) => s.id === "email_otp_expiry")![e] = 3600;
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("FLOOR email_otp_expiry (production): 3600 breaks the floor <= 600 s (AR-L6)");
    const row = POLICY.settings.find((s) => s.id === "email_otp_length")!;
    expect([row.local, row.staging, row.production]).toEqual([8, 8, 8]);
    expect(CONFIG).toMatch(/^otp_length = 8$/m);
  });

  it("03-13e (H-AUTH): the session-age Custom Access Token hook is a floor in every environment (off, elsewhere or missing fails)", () => {
    const HOOK = "pg-functions://postgres/private/session_age_token_hook";
    for (const env of ["local", "staging", "production"] as const) {
      const off = checkPolicy((p) => {
        const row = p.settings.find((s) => s.id === "hook_custom_access_token_enabled")!;
        row[env] = false;
        row.deviation_reason = "test";
      });
      expect(off.status, env).toBe(1);
      expect(off.stderr).toContain(`FLOOR hook_custom_access_token_enabled (${env}): false breaks the floor = true (03-13e H-AUTH)`);
      const elsewhere = checkPolicy((p) => {
        const row = p.settings.find((s) => s.id === "hook_custom_access_token_uri")!;
        row[env] = "pg-functions://postgres/public/custom_access_token_hook";
        row.deviation_reason = "test";
      });
      expect(elsewhere.status, env).toBe(1);
      expect(elsewhere.stderr).toContain(`FLOOR hook_custom_access_token_uri (${env}): "pg-functions://postgres/public/custom_access_token_hook"`);
    }
    const dropped = checkPolicy((p) => {
      p.settings = p.settings.filter((s) => s.id !== "hook_custom_access_token_enabled");
    });
    expect(dropped.status).toBe(1);
    expect(dropped.stderr).toContain("FLOOR hook_custom_access_token_enabled: policy row missing");
    // config.toml must carry it too (the local stack runs the hook).
    const noToml = checkConfig((t) => t.replace(/^\[auth\.hook\.custom_access_token\]\nenabled = true$/m, "[auth.hook.custom_access_token]\nenabled = false"));
    expect(noToml.status).toBe(1);
    expect(noToml.stderr).toContain("MISMATCH auth.hook.custom_access_token.enabled: config.toml has false, policy (local) wants true");
    expect(CONFIG).toContain(`[auth.hook.custom_access_token]\nenabled = true\nuri = "${HOOK}"`);
    const staging = runNodeChecker("check-auth-config.mjs", ["--print", "staging"]);
    expect(staging.stdout).toContain("hook_custom_access_token_enabled = true");
    expect(staging.stdout).toContain(`hook_custom_access_token_uri = "${HOOK}"`);
  });

  it("--print staging lists the dashboard checklist with the hosted-only require-current-password row", () => {
    const r = runNodeChecker("check-auth-config.mjs", ["--print", "staging"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("security_update_password_require_current_password = true");
    expect(r.stdout).toContain("disable_signup = true"); // printed as the hosted field holds it (inverse of enable_signup)
    expect(r.stdout).toContain("smtp_max_frequency = 60");
    expect(r.stdout).toContain("mailer_otp_length = 8");
    expect(r.stdout).toContain('hook_send_email_uri = "{{STAGING_ORIGIN}}/api/auth/send-email"');
    expect(r.stdout).toContain("mailer_templates_recovery_content = contents of ./supabase/templates/recovery.html");
  });
});
