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

export interface ValidateWebhookEndpointOptions {
  allowHttp?: boolean;
}

/**
 * Validates that an outgoing webhook endpoint URL uses HTTPS and does not
 * resolve to private, loopback, or cloud metadata IP addresses (SSRF protection).
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

  // Enforce HTTPS
  const isHttpAllowed = options?.allowHttp === true;
  if (parsed.protocol !== "https:" && !(isHttpAllowed && parsed.protocol === "http:")) {
    return {
      valid: false,
      error: "Webhook endpoint must use the secure HTTPS protocol.",
    };
  }

  const hostname = parsed.hostname;
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
    return {
      valid: false,
      error: "Private, loopback, or metadata addresses are blocked for webhook endpoints.",
    };
  }

  // If hostname is directly an IP address literal
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      return {
        valid: false,
        error: "Private, loopback, or metadata addresses are blocked for webhook endpoints.",
      };
    }
    return { valid: true };
  }

  // Resolve hostname via DNS
  try {
    const addresses = await dns.promises.lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      return {
        valid: false,
        error: `Could not resolve hostname "${hostname}".`,
      };
    }

    for (const record of addresses) {
      if (isPrivateIp(record.address)) {
        return {
          valid: false,
          error: "Private, loopback, or metadata addresses are blocked for webhook endpoints.",
        };
      }
    }
  } catch (dnsErr) {
    return {
      valid: false,
      error: `DNS resolution failed for hostname "${hostname}".`,
    };
  }

  return { valid: true };
}
