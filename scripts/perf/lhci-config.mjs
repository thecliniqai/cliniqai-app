/**
 * Lighthouse CI run config and report scrub (V2-06 06-07 step 5; PWA-09; threats T-06-12, T-06-13; ruling R-6).
 *
 * Pure functions, no I/O except `scrubReportFile` / `scrubReportDir` (which rewrite the files they are given). Used by
 * tests/e2e/perf/lhci.spec.ts (the `perf-lhci` Playwright project) and proven by tests/ci/lhci-config.spec.ts.
 *
 * - `buildLhciConfig` merges `lighthouserc.base.json` with one run group: loopback URLs only (anything else throws),
 *   Playwright's Chromium, Chrome's host resolver mapping every name except localhost/127.0.0.1 to NOTFOUND (nothing
 *   leaves the machine, Chrome's own background requests included), filesystem upload only, every assertion `warn`
 *   (report-only), and for a signed-in group the role's `Cookie` header in `settings.extraHeaders`.
 * - The repository and its CI artifacts are public. Lighthouse copies `extraHeaders` into every report
 *   (`configSettings.extraHeaders`, also inside the HTML report's embedded JSON). `scrubReport*` removes that key,
 *   replaces every `Cookie` / `Set-Cookie` / `Authorization` value with `[REDACTED]`, replaces any remaining occurrence
 *   of a session value anywhere in the text, and throws if one survives.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * The base config, relative to the repository root. No `import.meta` in this module: Playwright's loader compiles the
 * spec's imports to CommonJS, where `import.meta` is a syntax error; callers pass the absolute path.
 */
export const BASE_CONFIG_REL = "scripts/perf/lighthouserc.base.json";
export const REDACTED = "[REDACTED]";
/** Chrome resolves only loopback names; every other host fails DNS inside the browser. */
export const HOST_RESOLVER_RULES = "MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const SECRET_HEADERS = new Set(["cookie", "set-cookie", "authorization"]);
/** Session values shorter than this are not treated as secrets for the free-text replacement (avoids mangling). */
const MIN_SECRET_LENGTH = 16;

/** @param {string} file absolute path of the base config (`path.join(<repo root>, BASE_CONFIG_REL)`) */
export function readBaseConfig(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Throws unless `url` is http(s) on a loopback host. */
export function assertLoopbackUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`lhci-config: not a URL: ${url}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(`lhci-config: only loopback http(s) URLs may be measured, got ${parsed.protocol}//${parsed.host}`);
  }
  return parsed.href;
}

/** `name=value; name2=value2` from Playwright storage-state cookies for `url`'s host (no attributes). */
export function cookieHeaderFor(cookies, url) {
  const host = new URL(url).hostname;
  return cookies
    .filter((c) => c.domain.replace(/^\./, "") === host)
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

/** The cookie values (and the whole header) that must never appear in a report. */
export function secretsOf(cookieHeader) {
  if (!cookieHeader) return [];
  const values = cookieHeader
    .split(";")
    .map((pair) => pair.slice(pair.indexOf("=") + 1).trim())
    .filter((v) => v.length >= MIN_SECRET_LENGTH);
  return [cookieHeader, ...values];
}

/**
 * One LHCI config for a run group.
 * @param {{ urls: string[], chromePath: string, outputDir: string, base: any, cookieHeader?: string,
 *   noSandbox?: boolean }} group
 */
export function buildLhciConfig({ urls, chromePath, outputDir, base, cookieHeader = "", noSandbox = false }) {
  if (!base?.ci) throw new Error("lhci-config: base config (lighthouserc.base.json) is required");
  if (!Array.isArray(urls) || urls.length === 0) throw new Error("lhci-config: no URLs");
  if (!chromePath) throw new Error("lhci-config: chromePath is required (Playwright's Chromium)");
  const url = urls.map(assertLoopbackUrl);
  const baseCi = base.ci ?? {};

  const assertions = {};
  for (const [id, value] of Object.entries(baseCi.assert?.assertions ?? {})) {
    const [level, options] = Array.isArray(value) ? value : [value, undefined];
    if (level !== "warn") throw new Error(`lhci-config: assertion ${id} is "${level}"; V2-06 is report-only (warn)`);
    assertions[id] = options ? [level, options] : [level];
  }

  const chromeFlags = [`--host-resolver-rules="${HOST_RESOLVER_RULES}"`];
  if (noSandbox) chromeFlags.push("--no-sandbox");
  const settings = { ...(baseCi.collect?.settings ?? {}), chromeFlags: chromeFlags.join(" ") };
  delete settings.extraHeaders;
  if (cookieHeader) settings.extraHeaders = { Cookie: cookieHeader };

  return {
    ci: {
      collect: { ...(baseCi.collect ?? {}), url, chromePath, settings },
      assert: { assertions },
      upload: { target: "filesystem", outputDir },
    },
  };
}

function redactValue(value, secrets) {
  let out = value;
  for (const s of secrets) if (s && out.includes(s)) out = out.split(s).join(REDACTED);
  return out;
}

/** Returns a scrubbed deep copy of a Lighthouse result (or any JSON value). */
export function scrubLhr(value, secrets = []) {
  if (typeof value === "string") return redactValue(value, secrets);
  if (Array.isArray(value)) return value.map((v) => scrubLhr(v, secrets));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (key === "extraHeaders") continue;
      if (SECRET_HEADERS.has(key.toLowerCase()) && typeof v === "string") out[key] = REDACTED;
      else if (isHeaderPair(v)) out[key] = { ...v, value: REDACTED };
      else out[key] = scrubLhr(v, secrets);
    }
    return out;
  }
  return value;
}

/** `{ name: "Cookie", value: "…" }` shaped header entries (DevTools-protocol style). */
function isHeaderPair(v) {
  return (
    v && typeof v === "object" && typeof v.name === "string" && typeof v.value === "string" &&
    SECRET_HEADERS.has(v.name.toLowerCase())
  );
}

const HTML_JSON = /(window\.__LIGHTHOUSE_JSON__\s*=\s*)([\s\S]*?)(;\s*<\/script>)/;

/** JSON for an inline `<script>`, as Lighthouse writes it (`<` and the JS line separators escaped). */
function inlineJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Rewrites one report file in place (`.json` or `.html`). Throws if a secret is still present afterwards. */
export function scrubReportFile(file, secrets = []) {
  const text = fs.readFileSync(file, "utf8");
  let out = text;
  if (file.endsWith(".json")) {
    out = `${JSON.stringify(scrubLhr(JSON.parse(text), secrets), null, 2)}\n`;
  } else if (file.endsWith(".html")) {
    const m = HTML_JSON.exec(text);
    if (m) out = text.slice(0, m.index) + m[1] + inlineJson(scrubLhr(JSON.parse(m[2]), secrets)) + m[3] + text.slice(m.index + m[0].length);
    out = redactValue(out, secrets);
  }
  if (secrets.some((s) => s && out.includes(s))) throw new Error(`lhci-config: a session value survived the scrub in ${file}`);
  if (/"extraHeaders"\s*:/.test(out)) throw new Error(`lhci-config: extraHeaders survived the scrub in ${file}`);
  fs.writeFileSync(file, out);
  return file;
}

/**
 * Scrubs every `.json` / `.html` file under `dir`; returns the files rewritten.
 * @param {string} dir
 * @param {string[]} [secrets]
 * @returns {string[]}
 */
export function scrubReportDir(dir, secrets = []) {
  /** @type {string[]} */
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...scrubReportDir(abs, secrets));
    else if (/\.(json|html)$/.test(entry.name)) files.push(scrubReportFile(abs, secrets));
  }
  return files;
}
