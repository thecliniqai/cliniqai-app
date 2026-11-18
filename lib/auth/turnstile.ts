import "server-only";
import { isTurnstileTestSecret, TURNSTILE_VERIFY_PUBLIC_URL } from "@/lib/env";
import { serverEnv } from "@/lib/env-server";
import { log, logWord } from "@/lib/log";

/**
 * Server-side Cloudflare Turnstile check (V2-05 05-07b, R-46; AUTH_REDESIGN §3.2 "verify Turnstile server-side").
 *
 * V2-03 verified Turnstile only inside GoTrue (sign-in, reset request). Invite acceptance creates the invitee's account
 * through the Auth admin API, which skips GoTrue's CAPTCHA, so the app verifies the widget token itself before any
 * account change: POST `secret`, `response` (and `remoteip` when known) to the fixed siteverify URL, 3 s timeout.
 *
 * Fail closed, always:
 *   - `unconfigured`: no `TURNSTILE_SECRET_KEY` (allowed in staging until PO action 05-P7): refuse, never skip;
 *   - `missing_token`: no widget token;
 *   - `rejected`: `success` is not true;
 *   - `hostname_mismatch`: the token was solved on another site (skipped only with a Cloudflare test secret, whose
 *     dummy answers carry no real hostname; the env schema allows test secrets in local tiers only);
 *   - `action_mismatch` (V2-05 05-12, IND I-6): the widget that produced the token declared another `action` than the
 *     flow expects (`expectedAction`), e.g. a token solved on the sign-in form replayed at invite acceptance (skipped
 *     with a test secret, like the hostname);
 *   - `unavailable` / `timeout`: network error, non-200 answer, unreadable body, or no answer within 3 s.
 * Logs carry the reason and Cloudflare's error codes only when they are machine words: never the secret, the widget
 * token or the remote IP. Nothing is returned but `{ ok }` and the reason.
 */

export type TurnstileFailure =
  | "unconfigured"
  | "missing_token"
  | "rejected"
  | "hostname_mismatch"
  | "action_mismatch"
  | "unavailable"
  | "timeout";

/** The widget `action` of each server-verified flow (the client widget declares the same value). */
export const TURNSTILE_ACTIONS = { inviteAccept: "invite-accept" } as const;
export type TurnstileResult = { ok: true } | { ok: false; reason: TurnstileFailure };

/** The subset of `fetch` the check uses; tests pass a mock. */
export type TurnstileFetcher = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface TurnstileVerifyOptions {
  remoteIp?: string;
  /** Default: `serverEnv().TURNSTILE_SECRET_KEY`. */
  secret?: string;
  /** Default: `serverEnv().TURNSTILE_VERIFY_URL` (Cloudflare's siteverify unless overridden in test/e2e). */
  verifyUrl?: string;
  /** Default: the host of `NEXT_PUBLIC_APP_URL`. */
  expectedHostname?: string;
  /** The widget `action` the flow declares (`TURNSTILE_ACTIONS`); when set, any other action fails closed. */
  expectedAction?: string;
  fetcher?: TurnstileFetcher;
  timeoutMs?: number;
}

export const TURNSTILE_TIMEOUT_MS = 3000;
/** Cloudflare's tokens are at most 2048 characters. */
const MAX_TOKEN_LENGTH = 2048;
const ERROR_CODE = /^[a-z0-9-]{1,40}$/;

function fail(reason: TurnstileFailure, errorCodes: unknown = undefined): TurnstileResult {
  const codes = Array.isArray(errorCodes) ? errorCodes.filter((c): c is string => typeof c === "string" && ERROR_CODE.test(c)) : [];
  log.warn({
    event: "auth.turnstile.failed",
    module: "auth.turnstile",
    reason: logWord(reason),
    ...(codes.length > 0 ? { code: codes.slice(0, 3).join(".").slice(0, 40) } : {}),
  });
  return { ok: false, reason };
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export async function verifyTurnstile(token: string | null | undefined, options: TurnstileVerifyOptions = {}): Promise<TurnstileResult> {
  const needsEnv = options.secret === undefined || options.verifyUrl === undefined || options.expectedHostname === undefined;
  const env = needsEnv ? serverEnv() : null;
  const secret = options.secret ?? env?.TURNSTILE_SECRET_KEY;
  if (!secret) return fail("unconfigured");
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return fail("missing_token");

  const verifyUrl = options.verifyUrl ?? env?.TURNSTILE_VERIFY_URL ?? TURNSTILE_VERIFY_PUBLIC_URL;
  const expectedHostname = (options.expectedHostname ?? (env ? hostnameOf(env.NEXT_PUBLIC_APP_URL) : null))?.toLowerCase() ?? null;
  const fetcher: TurnstileFetcher = options.fetcher ?? ((url, init) => fetch(url, { ...init, cache: "no-store" }));

  const body = new URLSearchParams({ secret, response: token });
  if (options.remoteIp) body.set("remoteip", options.remoteIp);

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The deadline holds even if a fetcher ignores the abort signal (the request and the body read share it).
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timeout"));
    }, options.timeoutMs ?? TURNSTILE_TIMEOUT_MS);
  });
  try {
    const call = (async () => {
      const res = await fetcher(verifyUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: controller.signal,
      });
      if (res.status !== 200) return { status: res.status, json: null as unknown };
      return { status: 200, json: await res.json() };
    })();
    call.catch(() => undefined); // settled after the deadline: nothing to report twice
    const { status, json } = await Promise.race([call, deadline]);
    if (status !== 200 || json === null || typeof json !== "object") return fail("unavailable");
    const answer = json as { success?: unknown; hostname?: unknown; action?: unknown; "error-codes"?: unknown };
    if (answer.success !== true) return fail("rejected", answer["error-codes"]);
    if (!isTurnstileTestSecret(secret)) {
      const host = typeof answer.hostname === "string" ? answer.hostname.toLowerCase() : null;
      if (expectedHostname === null || host !== expectedHostname) return fail("hostname_mismatch");
      if (options.expectedAction !== undefined && answer.action !== options.expectedAction) return fail("action_mismatch");
    }
    return { ok: true };
  } catch {
    return fail(controller.signal.aborted ? "timeout" : "unavailable");
  } finally {
    clearTimeout(timer);
  }
}
