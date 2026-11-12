import dns from "dns";
import net from "net";

/**
 * Checks if a given IP address belongs to private, loopback, link-local,
 * or cloud metadata subnets (e.g. 169.254.169.254).
 */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true; // Malformed IPv4 -> treat as blocked
    }
    const [a, b] = parts;

    // 0.0.0.0/8 - Current network ("this" host)
    if (a === 0) return true;

    // 127.0.0.0/8 - Loopback
    if (a === 127) return true;

    // 10.0.0.0/8 - Private Class A (RFC 1918)
    if (a === 10) return true;

    // 172.16.0.0/12 - Private Class B (RFC 1918: 172.16.0.0 - 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true;

    // 192.168.0.0/16 - Private Class C (RFC 1918)
    if (a === 192 && b === 168) return true;

    // 169.254.0.0/16 - Link-local & cloud metadata (e.g. 169.254.169.254)
    if (a === 169 && b === 254) return true;

    // 100.64.0.0/10 - Shared address space (CGNAT: 100.64.0.0 - 100.127.255.255)
    if (a === 100 && b >= 64 && b <= 127) return true;

    // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 - Documentation (TEST-NET)
    if (a === 192 && b === 0 && parts[2] === 2) return true;
    if (a === 198 && b === 51 && parts[2] === 100) return true;
    if (a === 203 && b === 0 && parts[2] === 113) return true;

    // 224.0.0.0/4 - Multicast & reserved (224-255)
    if (a >= 224) return true;

    return false;
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();

    // Loopback & unspecified
    if (normalized === "::1" || normalized === "::") return true;

    // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
    if (normalized.startsWith("::ffff:")) {
      const remainder = normalized.substring(7);
      if (net.isIPv4(remainder)) {
        return isPrivateIp(remainder);
      }
      return true;
    }

    // Unique Local Addresses (fc00::/7 -> fc00... to fdff...)
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;

    // Link-local unicast (fe80::/10 -> fe80... to febf...)
    if (/^fe[89ab]/i.test(normalized)) return true;

    // Multicast (ff00::/8)
    if (normalized.startsWith("ff")) return true;

    return false;
  }

  // Not a valid IP -> block
  return true;
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

/**
 * Validates that an outgoing webhook endpoint URL uses HTTPS and does not resolve to private, loopback, or cloud
 * metadata IP addresses (SSRF protection, T-03-11).
 *
 * There is no test-environment branch (V2-03 03-10, P2-03, E-6): every hostname is resolved, every answer must be
 * public, and a resolver error or an empty answer fails closed. Tests inject `resolve` (and `allowHttp`) explicitly.
 * Residual (recorded for review): the dispatcher's `fetch` resolves the name again, so a DNS-rebinding answer that
 * changes between this check and the connect is not covered here.
 */
export async function validateWebhookEndpoint(
  urlString: string,
  options?: ValidateWebhookEndpointOptions
): Promise<{ valid: boolean; error?: string }> {
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
    return {
      valid: false,
      error: "Webhook endpoint must use the secure HTTPS protocol.",
    };
  }

  // `URL.hostname` keeps the brackets of an IPv6 literal ("[::1]"); strip them so the literal is range-checked.
  const hostname = parsed.hostname.replace(/^\[(.*)\]$/, "$1");
  if (!hostname) {
    return { valid: false, error: "Invalid endpoint URL: missing hostname." };
  }

  // Direct string checks for well-known loopback/metadata patterns
  const lowerHost = hostname.toLowerCase();
  if (
    lowerHost === "localhost" ||
    lowerHost.endsWith(".localhost") ||
    lowerHost === "127.0.0.1" ||
    lowerHost === "::1" ||
    lowerHost === "169.254.169.254"
  ) {
    return { valid: false, error: BLOCKED };
  }

  // If hostname is directly an IP address literal
  if (net.isIP(hostname)) {
    return isPrivateIp(hostname) ? { valid: false, error: BLOCKED } : { valid: true };
  }

  // Resolve the hostname (always; no domain is exempt) and require every answer to be public.
  const resolve = options?.resolve ?? resolveHost;
  let addresses: string[];
  try {
    addresses = await resolve(hostname);
  } catch {
    return {
      valid: false,
      error: `DNS resolution failed for hostname "${hostname}".`,
    };
  }

  if (!Array.isArray(addresses) || addresses.length === 0) {
    return {
      valid: false,
      error: `Could not resolve hostname "${hostname}".`,
    };
  }

  // `isPrivateIp` blocks anything that is not a valid IP literal, so a malformed answer also fails closed.
  if (addresses.some((address) => typeof address !== "string" || isPrivateIp(address))) {
    return { valid: false, error: BLOCKED };
  }

  return { valid: true };
}
