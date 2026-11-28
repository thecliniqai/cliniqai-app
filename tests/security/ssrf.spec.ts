/**
 * V2-14 14-02 (P2-06, SVP TC-SSRF-01..05; inherited 03 adversarial E-2): the outbound webhook path against the SSRF cases
 * the verification plan names. No database and no network beyond a loopback test server: the resolver is injected and
 * the transport is driven directly.
 *
 * TC-SSRF-01 a 3xx to the metadata address is a failed delivery: the transport never follows it (one request, no second
 *            connection).
 * TC-SSRF-02 DNS rebinding: the check resolves once and returns the address the delivery is pinned to; a name that
 *            answers private on a later lookup is refused, and a mixed answer is refused outright.
 * TC-SSRF-03 every textual form of IPv6 loopback and IPv4-mapped loopback is refused.
 * TC-SSRF-04 NAT64 (well-known and local-use prefixes) embedding a private or metadata IPv4 is refused.
 * TC-SSRF-05 decimal, hexadecimal, octal and short IPv4 forms are normalised by the URL parser and refused.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveWebhookTarget, type WebhookTarget } from "@/lib/webhooks/ssrf";
import { postPinned } from "@/lib/webhooks/transport";

const PUBLIC_IP = "93.184.216.34";
const BLOCKED = "Private, loopback, or metadata addresses are blocked for webhook endpoints.";
const publicResolver = async () => [PUBLIC_IP];

describe("TC-SSRF-01: a redirect to the metadata address is never followed", () => {
  let server: http.Server;
  let port = 0;
  const seen: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/iam/security-credentials/" });
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("the delivery resolves with the 302 and makes exactly one request", async () => {
    // The checked target the dispatcher would hand over (a loopback test server stands in for a public partner).
    const target: WebhookTarget = {
      url: new URL(`http://partner.example.test:${port}/hooks/in`),
      hostname: "partner.example.test",
      address: "127.0.0.1",
      family: 4,
      port,
    };
    const result = await postPinned(target, { headers: { "content-type": "application/json" }, body: "{}", timeoutMs: 5_000 });
    expect(result).toEqual({ status: 302 });
    expect(seen).toEqual(["POST /hooks/in"]);
  });
});

describe("TC-SSRF-02: DNS rebinding", () => {
  it("resolves once and pins the delivery to the checked public address", async () => {
    let lookups = 0;
    const rebinding = async () => (++lookups === 1 ? [PUBLIC_IP] : ["169.254.169.254"]);
    const result = await resolveWebhookTarget("https://rebind.example.test/hook", { resolve: rebinding });
    expect(result).toMatchObject({ valid: true, target: { address: PUBLIC_IP, hostname: "rebind.example.test", port: 443 } });
    expect(lookups).toBe(1);
    // A later check of the same name (its next answer is private) is refused.
    expect(await resolveWebhookTarget("https://rebind.example.test/hook", { resolve: rebinding })).toEqual({ valid: false, error: BLOCKED });
  });

  it("a name answering a public and a private address at once is refused", async () => {
    const mixed = async () => [PUBLIC_IP, "10.0.0.5"];
    expect(await resolveWebhookTarget("https://mixed.example.test/hook", { resolve: mixed })).toEqual({ valid: false, error: BLOCKED });
  });
});

describe("TC-SSRF-03: IPv6 loopback in every form", () => {
  it.each([
    "https://[::1]/",
    "https://[0:0:0:0:0:0:0:1]/",
    "https://[0000:0000:0000:0000:0000:0000:0000:0001]/",
    "https://[::ffff:127.0.0.1]/",
    "https://[::ffff:7f00:1]/",
    "https://[::127.0.0.1]/",
    "https://[::]/",
    "https://[::ffff:169.254.169.254]/",
    "https://[fe80::1]/",
    "https://[fd00::1]/",
  ])("%s is refused", async (url) => {
    expect(await resolveWebhookTarget(url, { resolve: publicResolver })).toEqual({ valid: false, error: BLOCKED });
  });

  it("a name resolving to an IPv6 loopback form is refused", async () => {
    const v6 = async () => ["0:0:0:0:0:ffff:7f00:1"];
    expect(await resolveWebhookTarget("https://v6.example.test/", { resolve: v6 })).toEqual({ valid: false, error: BLOCKED });
  });
});

describe("TC-SSRF-04: NAT64", () => {
  it.each([
    "https://[64:ff9b::a9fe:a9fe]/", // 169.254.169.254
    "https://[64:ff9b::169.254.169.254]/",
    "https://[64:ff9b::7f00:1]/", // 127.0.0.1
    "https://[64:ff9b::a00:1]/", // 10.0.0.1
    "https://[64:ff9b:1::a9fe:a9fe]/", // local-use NAT64 prefix
  ])("%s is refused", async (url) => {
    expect(await resolveWebhookTarget(url, { resolve: publicResolver })).toEqual({ valid: false, error: BLOCKED });
  });

  it("NAT64 of a public IPv4 is allowed (the prefix itself is not the problem)", async () => {
    const result = await resolveWebhookTarget("https://[64:ff9b::5db8:d822]/", { resolve: publicResolver });
    expect(result.valid).toBe(true);
  });
});

describe("TC-SSRF-05: decimal, hex, octal and short IPv4", () => {
  it.each([
    ["https://2130706433/", "127.0.0.1"],
    ["https://0x7f000001/", "127.0.0.1"],
    ["https://0177.0.0.1/", "127.0.0.1"],
    ["https://127.1/", "127.0.0.1"],
    ["https://2852039166/", "169.254.169.254"],
    ["https://0xa9.0xfe.0xa9.0xfe/", "169.254.169.254"],
    ["https://167772161/", "10.0.0.1"],
  ])("%s (%s) is refused", async (url, normalised) => {
    expect(new URL(url).hostname).toBe(normalised);
    expect(await resolveWebhookTarget(url, { resolve: publicResolver })).toEqual({ valid: false, error: BLOCKED });
  });
});
