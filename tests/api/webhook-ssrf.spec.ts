/**
 * SSRF validator without a test-environment branch (V2-03 03-10, P2-03, TEST_STRATEGY E-6, T-03-11).
 *
 * Before 03-10, `validateWebhookEndpoint` read `VITEST`/`NODE_ENV` and, inside this runner, accepted any `.test` or
 * `.example.com` host without resolving it, so no test could exercise the DNS check. Now resolution always runs through
 * an injectable resolver (`resolve`), every answer must be public, and a resolver error or empty answer fails closed.
 * These tests run inside Vitest on purpose: the cases marked "before: accepted" passed under the old skip.
 */
import dns from "node:dns";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isPrivateIp, validateWebhookEndpoint, type HostResolver } from "@/lib/webhooks/ssrf";

const answers = (...addresses: string[]): HostResolver & ReturnType<typeof vi.fn> =>
  vi.fn(async () => addresses) as unknown as HostResolver & ReturnType<typeof vi.fn>;
const BLOCKED = "Private, loopback, or metadata addresses are blocked";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("validateWebhookEndpoint: DNS always resolved (no test bypass)", () => {
  it("rejects a .test host whose resolver answers a private address (before: accepted, DNS skipped under Vitest)", async () => {
    const resolve = answers("10.0.0.5");
    const r = await validateWebhookEndpoint("https://hooks.example.test/x", { resolve });
    expect(r).toEqual({ valid: false, error: expect.stringContaining(BLOCKED) });
    expect(resolve).toHaveBeenCalledWith("hooks.example.test");
  });

  it("rejects an .example.com host whose resolver answers the metadata address (before: accepted)", async () => {
    const r = await validateWebhookEndpoint("https://partner-a.example.com/webhooks", {
      resolve: answers("169.254.169.254"),
    });
    expect(r.valid).toBe(false);
    expect(r.error).toContain(BLOCKED);
  });

  it("accepts a host whose resolver answers only public addresses", async () => {
    const resolve = answers("93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946");
    const r = await validateWebhookEndpoint("https://hooks.example.test/x", { resolve });
    expect(r).toEqual({ valid: true });
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("rejects mixed public and private answers", async () => {
    for (const priv of ["192.168.1.7", "127.0.0.1", "fd00::1", "::ffff:10.0.0.1", "fe80::1"]) {
      const r = await validateWebhookEndpoint("https://hooks.example.test/x", {
        resolve: answers("93.184.216.34", priv),
      });
      expect(r.valid, priv).toBe(false);
      expect(r.error, priv).toContain(BLOCKED);
    }
  });

  it("fails closed when the resolver throws", async () => {
    const resolve: HostResolver = async () => {
      throw Object.assign(new Error("queryA ENOTFOUND"), { code: "ENOTFOUND" });
    };
    const r = await validateWebhookEndpoint("https://hooks.example.test/x", { resolve });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("DNS resolution failed");
  });

  it("fails closed on an empty or malformed answer", async () => {
    expect((await validateWebhookEndpoint("https://hooks.example.test/x", { resolve: answers() })).valid).toBe(false);
    expect(
      (await validateWebhookEndpoint("https://hooks.example.test/x", { resolve: answers("not-an-ip") })).valid,
    ).toBe(false);
  });

  it("uses the system resolver when none is injected (before: skipped for .test hosts under Vitest)", async () => {
    const lookup = vi
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([{ address: "10.1.2.3", family: 4 }] as never);
    const r = await validateWebhookEndpoint("https://hooks.example.test/x");
    expect(lookup).toHaveBeenCalledWith("hooks.example.test", expect.objectContaining({ all: true }));
    expect(r.valid).toBe(false);
    expect(r.error).toContain(BLOCKED);
  });
});

describe("validateWebhookEndpoint: scheme and literals", () => {
  it("rejects http:// without allowHttp, even inside Vitest", async () => {
    const resolve = answers("93.184.216.34");
    const r = await validateWebhookEndpoint("http://hooks.example.test/x", { resolve });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("must use the secure HTTPS protocol");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("accepts http:// only when the caller passes allowHttp, and still resolves the host", async () => {
    const resolve = answers("93.184.216.34");
    expect(await validateWebhookEndpoint("http://hooks.example.test/x", { allowHttp: true, resolve })).toEqual({
      valid: true,
    });
    expect(resolve).toHaveBeenCalledWith("hooks.example.test");
    const blocked = await validateWebhookEndpoint("http://hooks.example.test/x", {
      allowHttp: true,
      resolve: answers("10.0.0.5"),
    });
    expect(blocked.valid).toBe(false);
  });

  it("range-checks IP literals (incl. bracketed IPv6) without calling the resolver", async () => {
    const resolve = answers("93.184.216.34");
    for (const url of ["https://[::1]/x", "https://[fd12::1]/x", "https://[::ffff:169.254.169.254]/x", "https://10.0.0.1/x", "https://2130706433/x"]) {
      const r = await validateWebhookEndpoint(url, { resolve });
      expect(r.valid, url).toBe(false);
    }
    expect(await validateWebhookEndpoint("https://[2606:4700::1111]/x", { resolve })).toEqual({ valid: true });
    expect(await validateWebhookEndpoint("https://93.184.216.34/x", { resolve })).toEqual({ valid: true });
    expect(resolve).not.toHaveBeenCalled();
  });
});

/**
 * 03-13d M-SSRF-V6 (review E-3/E-4/E-5, IND M-1): classification on bytes. Each row was ALLOWED by the string-prefix
 * check, both as a URL literal and as a DNS answer.
 */
describe("isPrivateIp / validateWebhookEndpoint: IPv4-embedding IPv6, transition prefixes, special-purpose IPv4", () => {
  const BLOCKED_ROWS: Array<[string, string]> = [
    ["::127.0.0.1", "IPv4-compatible ::/96 (127.0.0.1)"],
    ["::7f00:1", "IPv4-compatible, hex tail"],
    ["64:ff9b::127.0.0.1", "NAT64 well-known /96 (127.0.0.1)"],
    ["64:ff9b::a9fe:a9fe", "NAT64 well-known /96 (169.254.169.254)"],
    ["64:ff9b:1::a00:1", "local-use NAT64 64:ff9b:1::/48"],
    ["2002:7f00:1::", "6to4 (127.0.0.1)"],
    ["2002:a9fe:a9fe::", "6to4 (169.254.169.254)"],
    ["2001:0:4136:e378:8000:63bf:3fff:fdd2", "Teredo 2001::/32"],
    ["fec0::1", "deprecated site-local fec0::/10"],
    ["100::1", "discard-only 100::/64"],
    ["2001:db8::1", "documentation 2001:db8::/32"],
    ["0:0:0:0:0:ffff:7f00:1", "IPv4-mapped, uncompressed (E-5)"],
    ["::FFFF:A9FE:A9FE", "IPv4-mapped, upper case"],
    ["198.18.0.1", "benchmarking 198.18.0.0/15"],
    ["198.19.255.1", "benchmarking 198.18.0.0/15 (upper half)"],
    ["192.0.0.170", "IETF protocol assignments 192.0.0.0/24"],
    ["192.88.99.1", "6to4 relay anycast 192.88.99.0/24"],
    ["255.255.255.255", "broadcast"],
  ];

  it.each(BLOCKED_ROWS)("blocks %s (%s) as an address", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(BLOCKED_ROWS)("blocks %s (%s) as a DNS answer", async (ip) => {
    const r = await validateWebhookEndpoint("https://hooks.example.test/x", { resolve: answers(ip) });
    expect(r.valid).toBe(false);
    expect(r.error).toContain(BLOCKED);
  });

  it.each(BLOCKED_ROWS.filter(([ip]) => ip.includes(":")))("blocks %s (%s) as a bracketed URL literal", async (ip) => {
    const r = await validateWebhookEndpoint(`https://[${ip}]/x`, { resolve: answers("93.184.216.34") });
    expect(r.valid).toBe(false);
  });

  it("still allows public addresses, including NAT64 and 6to4 forms of a public IPv4", () => {
    for (const ip of ["93.184.216.34", "2606:4700::1111", "2a00:1450:4009:81f::200e", "64:ff9b::5db8:d822", "2002:5db8:d822::1", "::ffff:93.184.216.34", "198.20.0.1", "172.32.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("refuses an endpoint URL carrying a user name or password (review E-7)", async () => {
    const r = await validateWebhookEndpoint("https://user:pass@hooks.example.test/x", { resolve: answers("93.184.216.34") });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("user name or password");
  });
});
