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
import { validateWebhookEndpoint, type HostResolver } from "@/lib/webhooks/ssrf";

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
