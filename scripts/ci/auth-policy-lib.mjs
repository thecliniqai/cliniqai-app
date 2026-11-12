/**
 * Auth policy as code (V2-03 03-11a, AUTH-02, AUTH_REDESIGN §4.1 and §7 "Config drift").
 *
 * `supabase/auth-policy.json` holds one row per Supabase Auth setting with its value on every environment:
 *   - `toml`: the dotted `supabase/config.toml` path (null for hosted-only settings),
 *   - `hosted`: the Management API field of `GET /v1/projects/{ref}/config/auth` (null for local-only settings),
 *   - `transform`: how the policy value maps to the hosted field (see TRANSFORMS),
 *   - `local` / `staging` / `production`: the value; `null` on `local` means "absent from config.toml",
 *   - `source`: the AUTH_REDESIGN row or ruling the value comes from,
 *   - `deviation_reason`: required whenever the environments differ.
 * The toml → hosted field mapping is the one Supabase CLI 2.120.0 uses for `config push` (read from the CLI binary).
 *
 * Shared by `scripts/ci/check-auth-config.mjs` (local, `static` job) and `scripts/drift/auth-config-hosted.mjs`
 * (hosted, read-only). Plain Node; the only dependency is `smol-toml` (dev, exact pin).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const ENVIRONMENTS = ["local", "staging", "production"];
export const HOSTED_ENVIRONMENTS = ["staging", "production"];

/**
 * Policy value → hosted value:
 *   same              equal (an expected "" also accepts a hosted null)
 *   invert            boolean negation (`enable_signup` ↔ `disable_signup`, `enable_confirmations` ↔ `mailer_autoconfirm`)
 *   duration_seconds  Go duration string ("60s", "1m") ↔ integer seconds
 *   csv_set           string array ↔ comma-separated string, compared as a set (null or "" = empty)
 *   file_content      a repo-relative file path ↔ the file's text (template bodies)
 */
export const TRANSFORMS = ["same", "invert", "duration_seconds", "csv_set", "file_content"];

/**
 * Hosted fields that carry secrets: never mapped, compared or printed (threat T-03-10). These are the fields the CLI
 * treats as secrets (`security_captcha_secret`, `smtp_pass`, `hook_*_secrets`, `external_*_secret`,
 * `sms_*_auth_token`, `sms_*_api_key`, `sms_*_api_secret`, `sms_*_access_key`). Settings that merely mention
 * passwords (`password_min_length`, `security_update_password_require_current_password`) are policy, not secrets.
 */
export const SECRET_FIELD = /secret|smtp_pass|auth_token|api_key|access_key/i;

/** Template/notification bodies: code-only, never a link (AUTH-04a, 01-06 ruling R2). */
const LINK_MARKERS = [/\{\{\s*\.ConfirmationURL\s*\}\}/, /\{\{\s*\.TokenHash\s*\}\}/, /\{\{\s*\.SiteURL\s*\}\}/, /\{\{\s*\.RedirectTo\s*\}\}/, /href\s*=/i, /https?:\/\//i];
const TOKEN_MARKER = /\{\{\s*\.Token\s*\}\}/;

export class PolicyError extends Error {}

export function readPolicy(policyPath) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  } catch (e) {
    throw new PolicyError(`cannot read the policy ${policyPath}: ${e instanceof Error ? e.message : String(e)}`);
  }
  validatePolicy(raw);
  return raw;
}

function isValue(v) {
  return v === null || ["boolean", "number", "string"].includes(typeof v) || (Array.isArray(v) && v.every((x) => typeof x === "string"));
}

/** Structural rules, so a policy edit cannot quietly drop a source, a deviation reason or a hosted column. */
export function validatePolicy(policy) {
  const problems = [];
  if (!policy || typeof policy !== "object" || !Array.isArray(policy.settings)) {
    throw new PolicyError("policy must be an object with a `settings` array");
  }
  const ids = new Set();
  const tomls = new Set();
  const hosteds = new Set();
  for (const [i, row] of policy.settings.entries()) {
    const where = `settings[${i}]${row && row.id ? ` (${row.id})` : ""}`;
    if (!row || typeof row !== "object") {
      problems.push(`${where}: not an object`);
      continue;
    }
    if (typeof row.id !== "string" || !row.id) problems.push(`${where}: missing id`);
    else if (ids.has(row.id)) problems.push(`${where}: duplicate id`);
    else ids.add(row.id);
    if (row.toml !== null && (typeof row.toml !== "string" || !row.toml.startsWith("auth."))) {
      problems.push(`${where}: toml must be null or a dotted path under auth.`);
    }
    if (row.hosted !== null && (typeof row.hosted !== "string" || !/^[a-z0-9_]+$/.test(row.hosted))) {
      problems.push(`${where}: hosted must be null or a Management API field name`);
    }
    if (row.toml === null && row.hosted === null) problems.push(`${where}: needs a toml path, a hosted field, or both`);
    if (typeof row.toml === "string") {
      if (tomls.has(row.toml)) problems.push(`${where}: toml path ${row.toml} appears twice`);
      tomls.add(row.toml);
    }
    if (typeof row.hosted === "string") {
      if (hosteds.has(row.hosted)) problems.push(`${where}: hosted field ${row.hosted} appears twice`);
      hosteds.add(row.hosted);
      if (SECRET_FIELD.test(row.hosted)) problems.push(`${where}: hosted field ${row.hosted} is secret-bearing and must not be mapped`);
    }
    if (!TRANSFORMS.includes(row.transform)) problems.push(`${where}: transform must be one of ${TRANSFORMS.join(", ")}`);
    if (typeof row.source !== "string" || !row.source.trim()) problems.push(`${where}: missing source`);
    if (typeof row.dashboard !== "string" || !row.dashboard.trim()) problems.push(`${where}: missing dashboard label`);
    for (const env of ENVIRONMENTS) {
      if (!(env in row)) problems.push(`${where}: missing the ${env} value`);
      else if (!isValue(row[env])) problems.push(`${where}: ${env} value must be a scalar, a string array or null`);
    }
    if (row.toml === null && row.local !== null) problems.push(`${where}: a hosted-only setting needs local = null`);
    if (row.hosted !== null) {
      for (const env of HOSTED_ENVIRONMENTS) {
        if (row[env] === null) problems.push(`${where}: a hosted field needs a ${env} value`);
      }
    } else {
      for (const env of HOSTED_ENVIRONMENTS) {
        if (row[env] !== null) problems.push(`${where}: a local-only setting needs ${env} = null`);
      }
    }
    const compared = ENVIRONMENTS.filter((env) => row[env] !== null && (env === "local" ? row.toml !== null : row.hosted !== null));
    const differs = compared.some((env) => !deepEqual(row[env], row[compared[0]]));
    const localOnlyAbsent = row.toml !== null && row.hosted !== null && row.local === null;
    const hasReason = typeof row.deviation_reason === "string" && row.deviation_reason.trim().length > 0;
    if ((differs || localOnlyAbsent) && !hasReason) problems.push(`${where}: environments differ, so deviation_reason is required`);
    if (!differs && !localOnlyAbsent && row.deviation_reason !== null) {
      problems.push(`${where}: environments agree, so deviation_reason must be null`);
    }
  }
  if (problems.length) throw new PolicyError(`invalid auth policy:\n  - ${problems.join("\n  - ")}`);
}

export function deepEqual(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  return a === b;
}

/** Leaves of `[auth]` as dotted paths (arrays are leaves). */
export function flattenAuth(config) {
  const out = new Map();
  const walk = (node, prefix) => {
    for (const [k, v] of Object.entries(node)) {
      const key = `${prefix}.${k}`;
      if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) walk(v, key);
      else out.set(key, v);
    }
  };
  if (config.auth && typeof config.auth === "object") walk(config.auth, "auth");
  return out;
}

/** Go-style duration ("60s", "1m", "1h30m") → seconds; null when unparseable. */
export function durationSeconds(value) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value !== "string" || !/^(\d+h)?(\d+m)?(\d+s)?$/.test(value) || value === "") return null;
  const part = (unit) => Number(new RegExp(`(\\d+)${unit}`).exec(value)?.[1] ?? 0);
  return part("h") * 3600 + part("m") * 60 + part("s");
}

/** `{{NAME}}` placeholders in string values, resolved from `vars`; unresolved names are returned. */
export function resolvePlaceholders(value, vars) {
  const missing = new Set();
  const one = (s) =>
    s.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (_m, name) => {
      const v = vars[name];
      if (typeof v !== "string" || v === "") {
        missing.add(name);
        return `{{${name}}}`;
      }
      return v;
    });
  let resolved = value;
  if (typeof value === "string") resolved = one(value);
  else if (Array.isArray(value)) resolved = value.map(one);
  return { value: resolved, missing: [...missing] };
}

function normaliseText(s) {
  return String(s).replace(/\r\n/g, "\n").trim();
}

export function sha256Short(s) {
  return createHash("sha256").update(normaliseText(s)).digest("hex").slice(0, 12);
}

export function readTemplate(root, relPath) {
  const abs = path.resolve(root, relPath);
  if (!abs.startsWith(path.resolve(root) + path.sep)) throw new PolicyError(`template path escapes the repo: ${relPath}`);
  return fs.readFileSync(abs, "utf8");
}

/**
 * Compares an expected policy value with a hosted value under `transform`. Returns `{ ok, expected, actual }` where
 * expected/actual are printable (template bodies are reduced to a hash and a length).
 */
export function compareHosted(row, expected, actual, root) {
  switch (row.transform) {
    case "same": {
      const ok = deepEqual(expected, actual) || (expected === "" && actual === null);
      return { ok, expected, actual };
    }
    case "invert": {
      const want = typeof expected === "boolean" ? !expected : expected;
      return { ok: actual === want, expected: want, actual };
    }
    case "duration_seconds": {
      const want = durationSeconds(expected);
      return { ok: want !== null && actual === want, expected: want, actual };
    }
    case "csv_set": {
      const want = [...new Set(Array.isArray(expected) ? expected : [])].sort();
      const got =
        actual === null || actual === ""
          ? []
          : typeof actual === "string"
            ? [...new Set(actual.split(",").map((s) => s.trim()).filter(Boolean))].sort()
            : null;
      return { ok: got !== null && deepEqual(want, got), expected: want, actual: got ?? actual };
    }
    case "file_content": {
      const body = readTemplate(root, String(expected));
      const want = { sha256: sha256Short(body), length: normaliseText(body).length };
      if (typeof actual !== "string") return { ok: false, expected: want, actual: actual === null ? null : typeof actual };
      const got = { sha256: sha256Short(actual), length: normaliseText(actual).length };
      return { ok: normaliseText(actual) === normaliseText(body), expected: want, actual: got };
    }
    default:
      throw new PolicyError(`unknown transform ${row.transform}`);
  }
}

/** Code-only template rules: no links; code templates carry `{{ .Token }}`, notifications carry no code. */
export function templateProblems(row, body) {
  const problems = [];
  for (const marker of LINK_MARKERS) {
    if (marker.test(body)) problems.push(`${row.toml}: template ${row.local} contains a link marker (${marker.source})`);
  }
  const isNotification = row.toml.includes(".notification.");
  if (isNotification && TOKEN_MARKER.test(body)) problems.push(`${row.toml}: notification ${row.local} must not carry a code`);
  if (!isNotification && !TOKEN_MARKER.test(body)) problems.push(`${row.toml}: template ${row.local} must carry the {{ .Token }} code`);
  return problems;
}

/** The value as the hosted field holds it (for the PO checklist). */
export function hostedValue(row, value) {
  if (value === null) return null;
  switch (row.transform) {
    case "invert":
      return typeof value === "boolean" ? !value : value;
    case "duration_seconds":
      return durationSeconds(value);
    case "csv_set":
      return Array.isArray(value) ? value.join(",") : value;
    default:
      return value;
  }
}

export function formatValue(v) {
  return JSON.stringify(v);
}
