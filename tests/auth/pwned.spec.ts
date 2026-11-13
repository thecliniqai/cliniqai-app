/**
 * V2-03 03-12a FT-05 unit tests (roadmap: "FT-05 unit tests with a mocked range API (hit, miss, API down)").
 *
 * The range API is a mocked fetcher: no network. Every assertion that touches the log checks that the password, its
 * SHA-1, the 5-character prefix and the suffix never appear in it (k-anonymity holds in our own logs too).
 * Synthetic passwords only.
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { isPwnedPassword, type PwnedRangeFetcher } from "@/lib/auth/pwned";

const BREACHED = "Synthetic-breached-pass-01";
const CLEAN = "Synthetic-clean-pass-02";
const BASE = "http://127.0.0.1:3101";

function sha1(value: string) {
  const hex = createHash("sha1").update(value, "utf8").digest("hex").toUpperCase();
  return { hex, prefix: hex.slice(0, 5), suffix: hex.slice(5) };
}

/** A range body for `prefix`: real-looking lines, padding lines (count 0) and the listed suffixes. */
function rangeBody(listed: Array<[string, number]>): string {
  const filler = Array.from({ length: 6 }, (_, i) => `${"A".repeat(34)}${i}:${i % 2 === 0 ? 0 : 5}`);
  return [...filler, ...listed.map(([s, c]) => `${s}:${c}`)].join("\r\n");
}

function mockFetcher(respond: (url: string) => { status: number; body: string } | Promise<never>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetcher: PwnedRangeFetcher = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const r = await respond(url);
    return { status: r.status, text: async () => r.body };
  };
  return { fetcher, calls };
}

let stderr: MockInstance;
const written = () => stderr.mock.calls.map((c) => String(c[0])).join("");

beforeEach(() => {
  stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function expectNothingSecretLogged(password: string) {
  const { hex, prefix, suffix } = sha1(password);
  const out = written();
  for (const secret of [password, hex, prefix, suffix, hex.toLowerCase(), prefix.toLowerCase()]) {
    expect(out).not.toContain(secret);
  }
}

describe("isPwnedPassword (FT-05, mocked range API)", () => {
  it("hit: a listed suffix with a count above 0 is pwned; only the 5-character prefix is sent, with padding", async () => {
    const { prefix, suffix } = sha1(BREACHED);
    const { fetcher, calls } = mockFetcher(() => ({ status: 200, body: rangeBody([[suffix, 42]]) }));

    expect(await isPwnedPassword(BREACHED, { enabled: true, baseUrl: BASE, fetcher })).toBe("pwned");

    expect(calls).toEqual([{ url: `${BASE}/range/${prefix}`, headers: { "Add-Padding": "true" } }]);
    expect(calls[0].url).not.toContain(suffix);
    expect(written()).toBe("");
  });

  it("miss: a suffix that is not listed is clear", async () => {
    const { suffix } = sha1(BREACHED);
    const { fetcher } = mockFetcher(() => ({ status: 200, body: rangeBody([[suffix, 3]]) }));
    expect(await isPwnedPassword(CLEAN, { enabled: true, baseUrl: BASE, fetcher })).toBe("clear");
    expect(written()).toBe("");
  });

  it("a padded count-0 line equal to the suffix is clear (Add-Padding entries are ignored)", async () => {
    const { suffix } = sha1(BREACHED);
    const { fetcher } = mockFetcher(() => ({ status: 200, body: rangeBody([[suffix, 0]]) }));
    expect(await isPwnedPassword(BREACHED, { enabled: true, baseUrl: BASE, fetcher })).toBe("clear");
  });

  it("matches case-insensitively and tolerates LF line endings and a trailing slash in the base URL", async () => {
    const { prefix, suffix } = sha1(BREACHED);
    const { fetcher, calls } = mockFetcher(() => ({ status: 200, body: `${suffix.toLowerCase()}:7\n` }));
    expect(await isPwnedPassword(BREACHED, { enabled: true, baseUrl: `${BASE}/`, fetcher })).toBe("pwned");
    expect(calls[0].url).toBe(`${BASE}/range/${prefix}`);
  });

  it("API down (network error): unavailable, the password is allowed, one warn line without the prefix", async () => {
    const { fetcher } = mockFetcher(() => Promise.reject(new TypeError(`fetch failed for ${sha1(BREACHED).prefix}`)));

    expect(await isPwnedPassword(BREACHED, { enabled: true, baseUrl: BASE, fetcher })).toBe("unavailable");

    const lines = written().trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ level: "warn", event: "pwned.unavailable", reason: "network" });
    expectNothingSecretLogged(BREACHED);
  });

  it.each([429, 500, 503, 404])("API down (HTTP %i): unavailable with one warn line", async (status) => {
    const { fetcher } = mockFetcher(() => ({ status, body: rangeBody([[sha1(BREACHED).suffix, 9]]) }));
    expect(await isPwnedPassword(BREACHED, { enabled: true, baseUrl: BASE, fetcher })).toBe("unavailable");
    const lines = written().trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ event: "pwned.unavailable", reason: "http_status", status });
    expectNothingSecretLogged(BREACHED);
  });

  it("timeout: a range API that never answers is unavailable after the deadline", async () => {
    let aborted = false;
    const fetcher: PwnedRangeFetcher = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const started = Date.now();
    expect(await isPwnedPassword(BREACHED, { enabled: true, baseUrl: BASE, fetcher, timeoutMs: 50 })).toBe("unavailable");
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(aborted).toBe(true);
    expect(JSON.parse(written().trim())).toMatchObject({ event: "pwned.unavailable", reason: "timeout" });
    expectNothingSecretLogged(BREACHED);
  });

  it("timeout holds even when the fetcher ignores the abort signal", async () => {
    const fetcher: PwnedRangeFetcher = () => new Promise(() => undefined);
    expect(await isPwnedPassword(BREACHED, { enabled: true, baseUrl: BASE, fetcher, timeoutMs: 30 })).toBe("unavailable");
  });

  it("flag off: skipped, and no request is made", async () => {
    const { fetcher, calls } = mockFetcher(() => ({ status: 200, body: "" }));
    expect(await isPwnedPassword(BREACHED, { enabled: false, baseUrl: BASE, fetcher })).toBe("skipped");
    expect(calls).toEqual([]);
  });

  it("reads PWNED_CHECK and PWNED_API_BASE_URL from the environment by default (off in the test lane)", async () => {
    const { prefix, suffix } = sha1(BREACHED);
    const { fetcher, calls } = mockFetcher(() => ({ status: 200, body: `${suffix}:1` }));

    expect(await isPwnedPassword(BREACHED, { fetcher })).toBe("skipped");
    expect(calls).toEqual([]);

    vi.stubEnv("PWNED_CHECK", "on");
    vi.stubEnv("PWNED_API_BASE_URL", BASE);
    expect(await isPwnedPassword(BREACHED, { fetcher })).toBe("pwned");
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/range/${prefix}`]);
  });
});
