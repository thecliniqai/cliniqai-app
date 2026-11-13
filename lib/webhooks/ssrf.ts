import dns from "dns";
import net from "net";

/**
 * Address classification on bytes (V2-03 03-13d, M-SSRF-V6; review E-3/E-4/E-5, IND M-1). An address is parsed to its
 * 4 or 16 bytes first, so every textual form (compressed, uncompressed, dotted tail, upper case) is judged the same.
 *
 * IPv4: blocked unless outside every special-purpose range below. IPv6: the embedded IPv4 of IPv4-mapped
 * (`::ffff:0:0/96`), IPv4-compatible (`::/96`), NAT64 well-known (`64:ff9b::/96`) and 6to4 (`2002::/16`) addresses is
 * re-checked; otherwise only global unicast `2000::/3` is accepted, minus `2001::/23` (IETF protocol assignments:
 * Teredo, ORCHID, benchmarking), `2001:db8::/32` and `3fff::/20` (documentation). Everything outside `2000::/3`
 * (loopback, unspecified, `64:ff9b:1::/48` local NAT64, `100::/64` discard, ULA, link- and site-local, multicast) is
 * blocked.
 */
/** [network, prefix length]. */
const V4_RANGES: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // RFC 1918
  ["100.64.0.0", 10], // shared address space (CGNAT)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // RFC 1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // RFC 1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
];

function v4Number(bytes: ArrayLike<number>, offset = 0): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

const V4_BLOCKS = V4_RANGES.map(([network, bits]) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { network: (v4Number(parseIpv4(network) as Uint8Array) & mask) >>> 0, mask };
});

function parseIpv4(text: string): Uint8Array | null {
  if (!net.isIPv4(text)) return null;
  const parts = text.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return Uint8Array.from(parts);
}

/** 16 bytes of an IPv6 address, or `null`. Zone ids (`%eth0`) are refused. */
function parseIpv6(text: string): Uint8Array | null {
  if (!net.isIPv6(text) || text.includes("%")) return null;
  let head = text;
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  const dotted = text.slice(lastColon + 1);
  if (dotted.includes(".")) {
    const v4 = parseIpv4(dotted);
    if (!v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    // Keep a trailing "::" (`::1.2.3.4`); drop a single trailing ":" (`::ffff:1.2.3.4` → `::ffff`).
    head = text.slice(0, lastColon + 1);
    if (!head.endsWith("::")) head = head.slice(0, -1);
  }
  const groups = (s: string) => (s === "" ? [] : s.split(":").map((g) => parseInt(g, 16)));
  let words: number[];
  if (head.includes("::")) {
    const [left, right] = head.split("::");
    const l = groups(left);
    const r = groups(right);
    const fill = 8 - tail.length - l.length - r.length;
    if (fill < 0) return null;
    words = [...l, ...new Array(fill).fill(0), ...r, ...tail];
  } else {
    words = [...groups(head), ...tail];
  }
  if (words.length !== 8 || words.some((w) => !Number.isInteger(w) || w < 0 || w > 0xffff)) return null;
  const bytes = new Uint8Array(16);
  words.forEach((w, i) => {
    bytes[2 * i] = w >> 8;
    bytes[2 * i + 1] = w & 0xff;
  });
  return bytes;
}

/** The 4 or 16 bytes of an IP literal, or `null` when the text is not one. */
export function parseIp(text: string): Uint8Array | null {
  if (typeof text !== "string") return null;
  return parseIpv4(text) ?? parseIpv6(text);
}

function isBlockedV4(bytes: ArrayLike<number>, offset = 0): boolean {
  const n = v4Number(bytes, offset);
  return V4_BLOCKS.some(({ network, mask }) => (n & mask) >>> 0 === network);
}

function zero(bytes: Uint8Array, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (bytes[i] !== 0) return false;
  return true;
}

function isBlockedV6(b: Uint8Array): boolean {
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d (incl. :: and ::1): judge the embedded IPv4.
  if (zero(b, 0, 10) && ((b[10] === 0xff && b[11] === 0xff) || (b[10] === 0 && b[11] === 0))) return isBlockedV4(b, 12);
  // NAT64 well-known prefix 64:ff9b::/96: the embedded IPv4 is what a NAT64 gateway connects to.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zero(b, 4, 12)) return isBlockedV4(b, 12);
  // 6to4 2002:V4ADDR::/48.
  if (b[0] === 0x20 && b[1] === 0x02) return isBlockedV4(b, 2);
  // Only global unicast 2000::/3 from here on.
  if ((b[0] & 0xe0) !== 0x20) return true;
  // 2001::/23 IETF protocol assignments (Teredo 2001::/32, ORCHID, benchmarking 2001:2::/48, …).
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] <= 0x01) return true;
  // 2001:db8::/32 documentation.
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true;
  // 3fff::/20 documentation.
  if (b[0] === 0x3f && b[1] === 0xff && (b[2] & 0xf0) === 0x00) return true;
  return false;
}

/**
 * Whether an address must never be a webhook destination: private, loopback, link-local, metadata, special-purpose,
 * or not a valid IP literal at all (fail closed).
 */
export function isPrivateIp(ip: string): boolean {
  const bytes = parseIp(ip);
  if (!bytes) return true;
  return bytes.length === 4 ? isBlockedV4(bytes) : isBlockedV6(bytes);
}

/** The canonical text of an address (`::ffff:7f00:1` and `0:0:0:0:0:ffff:7f00:1` give the same), or `null`. */
export function canonicalIp(ip: string): string | null {
  const bytes = parseIp(ip);
  if (!bytes) return null;
  if (bytes.length === 4) return Array.from(bytes).join(".");
  const words = Array.from({ length: 8 }, (_, i) => ((bytes[2 * i] << 8) | bytes[2 * i + 1]).toString(16));
  return words.join(":");
}

/** Resolves a hostname to every address it answers with. Injected by tests; production uses {@link resolveHost}. */
export type HostResolver = (host: string) => Promise<string[]>;

/** The production resolver: the system resolver (`getaddrinfo`), every A/AAAA answer. */
export const resolveHost: HostResolver = async (host) => {
  const answers = await dns.promises.lookup(host, { all: true, verbatim: true });
  return answers.map((a) => a.address);
};

export interface ValidateWebhookEndpointOptions {
  /** Permit `http:` in addition to `https:`. Production callers never pass it (V2-03 03-10, T-03-11). */
  allowHttp?: boolean;
  /** Resolver used for non-literal hostnames; defaults to {@link resolveHost}. Resolution always runs. */
  resolve?: HostResolver;
}

const BLOCKED = "Private, loopback, or metadata addresses are blocked for webhook endpoints.";

/** A validated destination: the URL as parsed and the one checked address a delivery must connect to. */
export interface WebhookTarget {
  url: URL;
  /** Host name without IPv6 brackets (SNI and `Host`). */
  hostname: string;
  /** The vetted address (canonical text) the connection is pinned to. */
  address: string;
  family: 4 | 6;
  port: number;
}

export type WebhookTargetResult = { valid: true; target: WebhookTarget } | { valid: false; error: string };

/**
 * Resolves and checks a webhook endpoint once (V2-03 03-10/03-13d, T-03-11; review E-2): `https:` only (unless the
 * caller passes `allowHttp`), no userinfo, every DNS answer public, and returns the first checked address. A delivery
 * connects to exactly that address (`lib/webhooks/transport.ts`), so a DNS answer that changes between the check and
 * the connect (rebinding) is never used.
 */
export async function resolveWebhookTarget(
  urlString: string,
  options?: ValidateWebhookEndpointOptions,
): Promise<WebhookTargetResult> {
  if (!urlString || typeof urlString !== "string") {
    return { valid: false, error: "Endpoint URL is required." };
  }

  let parsed: URL;
  try {
    parsed = new URL(urlString.trim());
  } catch {
    return { valid: false, error: "Invalid endpoint URL format." };
  }

  const isHttpAllowed = options?.allowHttp === true;
  if (parsed.protocol !== "https:" && !(isHttpAllowed && parsed.protocol === "http:")) {
    return { valid: false, error: "Webhook endpoint must use the secure HTTPS protocol." };
  }
  // Credentials in the URL (`https://user:pass@host`) would be stored and audited; fetch refuses them anyway (E-7).
  if (parsed.username || parsed.password) {
    return { valid: false, error: "Webhook endpoint URL must not contain a user name or password." };
  }

  // `URL.hostname` keeps the brackets of an IPv6 literal ("[::1]"); strip them so the literal is range-checked.
  const hostname = parsed.hostname.replace(/^\[(.*)\]$/, "$1");
  if (!hostname) {
    return { valid: false, error: "Invalid endpoint URL: missing hostname." };
  }
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;

  const lowerHost = hostname.toLowerCase();
  if (lowerHost === "localhost" || lowerHost.endsWith(".localhost")) {
    return { valid: false, error: BLOCKED };
  }

  let addresses: string[];
  if (net.isIP(hostname)) {
    addresses = [hostname];
  } else {
    // Resolve the hostname (always; no domain is exempt) and require every answer to be public.
    const resolve = options?.resolve ?? resolveHost;
    try {
      addresses = await resolve(hostname);
    } catch {
      return { valid: false, error: `DNS resolution failed for hostname "${hostname}".` };
    }
    if (!Array.isArray(addresses) || addresses.length === 0) {
      return { valid: false, error: `Could not resolve hostname "${hostname}".` };
    }
  }

  // `isPrivateIp` blocks anything that is not a valid IP literal, so a malformed answer also fails closed.
  if (addresses.some((address) => typeof address !== "string" || isPrivateIp(address))) {
    return { valid: false, error: BLOCKED };
  }
  const address = canonicalIp(addresses[0]) as string;
  return {
    valid: true,
    target: { url: parsed, hostname, address, family: net.isIPv4(address) ? 4 : 6, port },
  };
}

/**
 * Validates that an outgoing webhook endpoint URL uses HTTPS and does not resolve to private, loopback, or cloud
 * metadata IP addresses (SSRF protection, T-03-11). See {@link resolveWebhookTarget}; deliveries use that directly so
 * they connect to the checked address.
 */
export async function validateWebhookEndpoint(
  urlString: string,
  options?: ValidateWebhookEndpointOptions,
): Promise<{ valid: boolean; error?: string }> {
  const result = await resolveWebhookTarget(urlString, options);
  return result.valid ? { valid: true } : { valid: false, error: result.error };
}
