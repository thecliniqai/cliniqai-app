/**
 * Lighthouse CI config builder and report scrub (V2-06 06-07 step 5; PWA-09; threats T-06-12, T-06-13;
 * scripts/perf/lhci-config.mjs). The run itself is the `perf-lhci` Playwright project; this proves the parts that keep
 * it local and public-safe: loopback URLs only, Chrome's resolver locked to loopback, filesystem upload, report-only
 * assertions, and no session value left in a JSON or HTML report.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASE_CONFIG_REL,
  HOST_RESOLVER_RULES,
  REDACTED,
  buildLhciConfig,
  cookieHeaderFor,
  readBaseConfig,
  scrubLhr,
  scrubReportDir,
  secretsOf,
  lhciFailureMessage,
  redactToolOutput,
} from "../../scripts/perf/lhci-config.mjs";

const ROOT = path.resolve(__dirname, "../..");
const CHROME = "/opt/playwright/chromium/chrome";
const OUT = "test-results/lhci";
// Built at run time: shaped like a chunked Supabase session cookie, synthetic, never a real token.
const SESSION_VALUE = `base64-${Buffer.from(`synthetic-session-${process.pid}-${"x".repeat(40)}`).toString("base64")}`;
const COOKIE = `sb-127-auth-token.0=${SESSION_VALUE}; lane=a`;

/** A minimal Lighthouse result carrying the header where Lighthouse 12 puts it, plus a request echo. */
function fixtureLhr() {
  return {
    lighthouseVersion: "12.6.1",
    requestedUrl: "http://127.0.0.1:3100/patients",
    finalDisplayedUrl: "http://127.0.0.1:3100/patients",
    configSettings: { formFactor: "mobile", extraHeaders: { Cookie: COOKIE } },
    audits: {
      "network-requests": {
        details: {
          items: [{ url: "http://127.0.0.1:3100/patients", requestHeaders: [{ name: "Cookie", value: COOKIE }] }],
        },
      },
      "largest-contentful-paint": { numericValue: 1800, displayValue: "1.8 s" },
    },
    runWarnings: [`header was ${COOKIE}`],
    headers: { Authorization: "Bearer synthetic-run-time-value-0123456789" },
  };
}

describe("buildLhciConfig", () => {
  const base = readBaseConfig(path.join(ROOT, BASE_CONFIG_REL));
  const urls = ["http://127.0.0.1:3100/", "http://127.0.0.1:3100/patients"];

  it("uses filesystem upload, the given loopback URLs, Playwright's Chromium and the loopback-only resolver rule", () => {
    const { ci } = buildLhciConfig({ urls, chromePath: CHROME, outputDir: OUT, base });
    expect(ci.upload).toEqual({ target: "filesystem", outputDir: OUT });
    expect(ci.collect.url).toEqual(urls);
    expect(ci.collect.chromePath).toBe(CHROME);
    expect(ci.collect.settings.chromeFlags).toBe(`--host-resolver-rules="${HOST_RESOLVER_RULES}"`);
    expect(HOST_RESOLVER_RULES).toBe("MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1");
    expect(ci.collect.settings).not.toHaveProperty("extraHeaders");
    expect(ci.collect.settings).toMatchObject({ formFactor: "mobile", throttlingMethod: "simulate" });
  });

  it("puts the role's Cookie header in extraHeaders for a signed-in group, and --no-sandbox only when asked", () => {
    const { ci } = buildLhciConfig({ urls, chromePath: CHROME, outputDir: OUT, cookieHeader: COOKIE, noSandbox: true, base });
    expect(ci.collect.settings.extraHeaders).toEqual({ Cookie: COOKIE });
    expect(ci.collect.settings.chromeFlags).toBe(`--host-resolver-rules="${HOST_RESOLVER_RULES}" --no-sandbox`);
  });

  it("keeps every assertion at warn with the PWA_STRATEGY §3.9 numbers (report-only)", () => {
    const { ci } = buildLhciConfig({ urls, chromePath: CHROME, outputDir: OUT, base });
    expect(ci.assert.assertions).toEqual({
      "largest-contentful-paint": ["warn", { maxNumericValue: 2500 }],
      "total-blocking-time": ["warn", { maxNumericValue: 300 }],
      "cumulative-layout-shift": ["warn", { maxNumericValue: 0.1 }],
      "resource-summary:font:count": ["warn", { maxNumericValue: 2 }],
    });
  });

  it("refuses an assertion at error (blocking is V2-15's switch, not a config slip)", () => {
    const blocking = structuredClone(base);
    blocking.ci.assert.assertions["total-blocking-time"] = ["error", { maxNumericValue: 300 }];
    expect(() => buildLhciConfig({ urls, chromePath: CHROME, outputDir: OUT, base: blocking })).toThrow(
      'assertion total-blocking-time is "error"',
    );
  });

  it.each([
    "https://example.com/",
    "http://10.0.0.5:3100/",
    "http://127.0.0.1.nip.io:3100/",
    "file:///etc/hosts",
  ])("throws on a non-loopback URL %s", (bad) => {
    expect(() => buildLhciConfig({ urls: [urls[0], bad], chromePath: CHROME, outputDir: OUT, base })).toThrow(
      "only loopback http(s) URLs may be measured",
    );
  });
});

describe("cookie header and secrets", () => {
  it("joins the storage-state cookies of the measured host only", () => {
    const cookies = [
      { name: "sb-127-auth-token.0", value: SESSION_VALUE, domain: "127.0.0.1" },
      { name: "lane", value: "a", domain: "127.0.0.1" },
      { name: "other", value: "elsewhere-cookie-value-000000", domain: "example.com" },
    ];
    expect(cookieHeaderFor(cookies, "http://127.0.0.1:3100/")).toBe(COOKIE);
    expect(secretsOf(COOKIE)).toEqual([COOKIE, SESSION_VALUE]);
  });
});

describe("report scrub", () => {
  it("removes extraHeaders and redacts Cookie/Authorization values and free-text copies in a fixture LHR", () => {
    const scrubbed = scrubLhr(fixtureLhr(), secretsOf(COOKIE));
    expect(scrubbed.configSettings).toEqual({ formFactor: "mobile" });
    expect(scrubbed.audits["network-requests"].details.items[0].requestHeaders).toEqual([
      { name: "Cookie", value: REDACTED },
    ]);
    expect(scrubbed.headers.Authorization).toBe(REDACTED);
    expect(scrubbed.runWarnings).toEqual([`header was ${REDACTED}`]);
    expect(scrubbed.audits["largest-contentful-paint"]).toEqual({ numericValue: 1800, displayValue: "1.8 s" });
    expect(JSON.stringify(scrubbed)).not.toContain(SESSION_VALUE);
  });

  it("rewrites .json and .html reports on disk so no session value or extraHeaders key remains", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lhci-scrub-"));
    const lhr = fixtureLhr();
    fs.writeFileSync(path.join(dir, "127_0_0_1-_patients.report.json"), JSON.stringify(lhr));
    const embedded = JSON.stringify(lhr).replace(/</g, "\\u003c");
    fs.writeFileSync(
      path.join(dir, "127_0_0_1-_patients.report.html"),
      `<!doctype html><html><body><script>window.__LIGHTHOUSE_JSON__ = ${embedded};</script>` +
        `<p>${SESSION_VALUE}</p></body></html>`,
    );
    fs.mkdirSync(path.join(dir, "nested"));
    fs.writeFileSync(path.join(dir, "nested", "manifest.json"), JSON.stringify([{ url: lhr.requestedUrl, note: COOKIE }]));

    const files = scrubReportDir(dir, secretsOf(COOKIE));

    expect(files.map((f) => path.relative(dir, f)).sort()).toEqual([
      "127_0_0_1-_patients.report.html",
      "127_0_0_1-_patients.report.json",
      path.join("nested", "manifest.json"),
    ]);
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      expect(text).not.toContain(SESSION_VALUE);
      expect(text).not.toMatch(/"extraHeaders"\s*:/);
    }
    const html = fs.readFileSync(path.join(dir, "127_0_0_1-_patients.report.html"), "utf8");
    const json = /window\.__LIGHTHOUSE_JSON__ = ([\s\S]*?);<\/script>/.exec(html)![1];
    expect(JSON.parse(json).configSettings).toEqual({ formFactor: "mobile" });
    expect(html).toContain(`<p>${REDACTED}</p>`);
  });
});

describe("tool output scrub (06-09a C L-3)", () => {
  const header = "sb-127-auth-token=base64-eyJzeW50aGV0aWMiOiJ0b2tlbi12YWx1ZSJ9; clinic_active_tenant=00000000-0000-4000-8000-000000000000";
  const secrets = secretsOf(header);

  it("a failed lhci run's message carries no cookie value, the whole header or a value copied by Lighthouse", () => {
    const output = `Runtime error: the page at /patients sent ${header}\nlhr head: {"cookie":"${secrets[1]}"}\n`;
    const message = lhciFailureMessage("collect", 1, output, secrets, `spawn failed near ${secrets[2]}`);
    for (const secret of secrets) expect(message).not.toContain(secret);
    expect(message).toContain(REDACTED);
    expect(message).toMatch(/^lhci collect failed \(status 1, spawn failed near /);
  });

  it("returned output (the lhci-assert.txt attachment) is redacted too; text without secrets is unchanged", () => {
    expect(redactToolOutput(`ok ${secrets[1]} done`, secrets)).toBe(`ok ${REDACTED} done`);
    expect(redactToolOutput("Done running Lighthouse!", secrets)).toBe("Done running Lighthouse!");
    expect(redactToolOutput(undefined, secrets)).toBe("");
  });
});
