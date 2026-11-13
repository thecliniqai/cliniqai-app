import "server-only";
import { createHash } from "node:crypto";
import { PWNED_API_PUBLIC_BASE_URL } from "@/lib/env";
import { serverEnv } from "@/lib/env-server";
import { log } from "@/lib/log";

/**
 * FT-05 breached-password check against the Have I Been Pwned "Pwned Passwords" range API (V2-03 03-12a, R-5).
 *
 * k-anonymity: the password is hashed with SHA-1 here, only the first 5 hex characters of the hash leave the process
 * (`GET <base>/range/<prefix>` with `Add-Padding: true`), and the response (every suffix sharing that prefix) is
 * matched locally. The password, its hash, the prefix and the suffix are never logged, returned or stored.
 *
 * Outcomes:
 *   - `pwned`: the suffix is listed with a count above 0 (padding lines have count 0 and are ignored);
 *   - `clear`: the suffix is not listed;
 *   - `unavailable`: network error, timeout or a non-200 answer. The password is ALLOWED (fail-open, FT-05) and one
 *     `pwned.unavailable` warn line is written (reason only). A third-party outage must not lock every clinic out of
 *     resetting a password; the server-side policy (10-72 bytes) still applies and the warn line makes the gap visible;
 *   - `skipped`: `PWNED_CHECK=off` (the default outside production; R-17). No request is made.
 *
 * The HTTP call is behind {@link PwnedRangeFetcher} so tests inject a mocked range API; the e2e server points
 * `PWNED_API_BASE_URL` at a loopback fake (tests/e2e/support/pwned-range-server.ts). No real network in any test lane.
 */

export type PwnedResult = "pwned" | "clear" | "unavailable" | "skipped";

/** The subset of `fetch` the check uses; tests pass a mock. */
export type PwnedRangeFetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  status: number;
  text(): Promise<string>;
}>;

export interface PwnedCheckOptions {
  /** Default: `serverEnv().PWNED_CHECK === "on"`. */
  enabled?: boolean;
  /** Default: `serverEnv().PWNED_API_BASE_URL` (the public API unless overridden in development/test/e2e). */
  baseUrl?: string;
  /** Default: the global `fetch`. */
  fetcher?: PwnedRangeFetcher;
  /** Abort after this many milliseconds and treat the API as unavailable. */
  timeoutMs?: number;
}

export const PWNED_TIMEOUT_MS = 1500;
const PREFIX_LENGTH = 5;
const LINE = /^([0-9A-F]{35}):(\d+)$/;

/** SHA-1 of the UTF-8 password as upper-case hex, split into the 5-character prefix and the 35-character suffix. */
function hashParts(password: string): { prefix: string; suffix: string } {
  const hex = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  return { prefix: hex.slice(0, PREFIX_LENGTH), suffix: hex.slice(PREFIX_LENGTH) };
}

/** True when `body` lists `suffix` with a count above 0. Malformed lines are ignored. */
function listsSuffix(body: string, suffix: string): boolean {
  for (const raw of body.split(/\r?\n/)) {
    const match = LINE.exec(raw.trim().toUpperCase());
    if (match && match[1] === suffix && Number(match[2]) > 0) return true;
  }
  return false;
}

function unavailable(reason: string, status?: number): PwnedResult {
  // Reason and HTTP status only: never the password, the hash, the prefix or the suffix.
  log.warn({ event: "pwned.unavailable", module: "auth.pwned", reason, ...(status !== undefined ? { status } : {}) });
  return "unavailable";
}

export async function isPwnedPassword(password: string, options: PwnedCheckOptions = {}): Promise<PwnedResult> {
  const env = options.enabled === undefined || options.baseUrl === undefined ? serverEnv() : null;
  const enabled = options.enabled ?? env?.PWNED_CHECK === "on";
  if (!enabled) return "skipped";

  const baseUrl = (options.baseUrl ?? env?.PWNED_API_BASE_URL ?? PWNED_API_PUBLIC_BASE_URL).replace(/\/+$/, "");
  const fetcher: PwnedRangeFetcher = options.fetcher ?? ((url, init) => fetch(url, { ...init, cache: "no-store" }));
  const { prefix, suffix } = hashParts(password);

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The deadline holds even if a fetcher ignores the abort signal (the request and the body read share it).
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timeout"));
    }, options.timeoutMs ?? PWNED_TIMEOUT_MS);
  });
  try {
    const lookup = (async () => {
      const res = await fetcher(`${baseUrl}/range/${prefix}`, {
        headers: { "Add-Padding": "true" },
        signal: controller.signal,
      });
      if (res.status !== 200) return { status: res.status, body: null };
      return { status: 200, body: await res.text() };
    })();
    lookup.catch(() => undefined); // settled after the deadline: nothing to report twice
    const { status, body } = await Promise.race([lookup, deadline]);
    if (body === null) return unavailable("http_status", status);
    return listsSuffix(body, suffix) ? "pwned" : "clear";
  } catch {
    return unavailable(controller.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
}
