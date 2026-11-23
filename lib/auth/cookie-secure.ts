import { serverEnv } from "@/lib/env-server";

/**
 * Whether a cookie the app sets carries `Secure` (V2-08 08-06a, S-9; moved here from `features/clinics/switch.ts` in V2-09d so
 * the session-context cookie shares the rule with the active-clinic pin).
 */

/** Whether a request reached the server over https (directly, or through a proxy that says so). */
export function isHttpsRequest(headers: { get(name: string): string | null }): boolean {
  const forwarded = headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  return (headers.get("origin") ?? "").toLowerCase().startsWith("https:");
}

function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  const name = host.trim().toLowerCase().replace(/:\d+$/, "");
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]";
}

/**
 * On an https request, and in production on any host but loopback, so a proxy that forgets `x-forwarded-proto` cannot drop
 * the flag. A production build served on loopback over http (the e2e server) stays without it: a browser would not store
 * the cookie there.
 */
export function cookieSecureFor(
  headers: { get(name: string): string | null },
  nodeEnv: string = serverEnv().NODE_ENV,
): boolean {
  if (isHttpsRequest(headers)) return true;
  if (nodeEnv !== "production") return false;
  return !isLoopbackHost(headers.get("x-forwarded-host") ?? headers.get("host"));
}
