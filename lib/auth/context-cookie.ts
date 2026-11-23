import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { UserRole } from "@/lib/db/types";

/**
 * V2-09d (request speed): the signed session-context cookie. Pure (no Next import): `lib/auth/tenant.ts` reads and
 * issues it, `proxy.ts` and the sign-out route expire it.
 *
 * What it is: the clinic context the app resolved from the database for this session (user, session, active clinic,
 * role, the clinic's access level), signed with HMAC-SHA256 under `SESSION_CONTEXT_SECRET`, so the next requests of the
 * same session skip the membership and access-level lookups for at most {@link CONTEXT_COOKIE_TTL_SECONDS}. It is NOT
 * authorisation: RLS and the definer commands check membership, role and access in the database on every read and
 * write; the cookie only decides what the app shows and which guard answers it gives (a removed member sees navigation
 * for at most the TTL, never data). The permission set is derived from the role by the current code at use time
 * (`lib/permissions`), so a deploy that changes the matrix applies at once.
 *
 * Contents (ids, role and state only; never PHI, names or emails): `v` format version, `uid` user id, `sid` the JWT's
 * `session_id`, `tid` active clinic, `role`, `lvl` access level, `pin` the active-clinic cookie value it was resolved
 * under ("" for none), `iat`, `exp` (unix seconds). Wire form: `<base64url(JSON)>.<base64url(HMAC)>`; the MAC covers a
 * domain prefix and the payload text.
 *
 * Accepted only when: the MAC verifies (constant-time), the version, shape, role and level are known, `iat` is not in the
 * future (30 s skew) and `exp - iat` is at most the TTL and `exp` is after now, `uid` and `sid` equal the verified JWT's
 * `sub` and `session_id`, and `pin` equals the active-clinic cookie sent with this request. Anything else is ignored
 * (the caller falls back to the database; only `/api/session-status` issues a new one, 09D-01a A-3).
 */
export const CONTEXT_COOKIE = "clinic_ctx";
/** 5 minutes: well inside the access token's 900 s, and the session-status poll (every 5 min while visible) renews it. */
export const CONTEXT_COOKIE_TTL_SECONDS = 300;
const VERSION = 1;
const MAC_DOMAIN = "clinicos.session-context.v1.";
const CLOCK_SKEW_SECONDS = 30;

const ROLES: readonly UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];
const LEVELS = ["full", "locked", "onboarding", "none"] as const;
export type ContextAccessLevel = (typeof LEVELS)[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SessionContext {
  userId: string;
  sessionId: string;
  tenantId: string;
  role: UserRole;
  level: ContextAccessLevel;
  /** The active-clinic cookie value the context was resolved under ("" when there was none). */
  pin: string;
}

interface Payload {
  v: number;
  uid: string;
  sid: string;
  tid: string;
  role: UserRole;
  lvl: ContextAccessLevel;
  pin: string;
  iat: number;
  exp: number;
}

export type ContextRejection = "malformed" | "signature" | "expired" | "user" | "session" | "pin";
export type ContextVerdict = { ok: true; context: SessionContext; expiresAt: number } | { ok: false; reason: ContextRejection };

function mac(payloadText: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(MAC_DOMAIN).update(payloadText).digest();
}

/** The active-clinic cookie value as the context binds it: a clinic id in lower case, or "" (absent or not an id). */
export function normalisePin(value: string | null | undefined): string {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : "";
}

/** The cookie value for `context`, valid from `nowSeconds` for {@link CONTEXT_COOKIE_TTL_SECONDS}. */
export function signContext(context: SessionContext, secret: string, nowSeconds: number = Math.floor(Date.now() / 1000)): string {
  const payload: Payload = {
    v: VERSION,
    uid: context.userId,
    sid: context.sessionId,
    tid: context.tenantId,
    role: context.role,
    lvl: context.level,
    pin: normalisePin(context.pin),
    iat: nowSeconds,
    exp: nowSeconds + CONTEXT_COOKIE_TTL_SECONDS,
  };
  const text = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${text}.${mac(text, secret).toString("base64url")}`;
}

function parsePayload(text: string): Payload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  const isInt = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);
  if (p.v !== VERSION || !isInt(p.iat) || !isInt(p.exp)) return null;
  if (typeof p.uid !== "string" || !UUID.test(p.uid) || typeof p.sid !== "string" || !UUID.test(p.sid)) return null;
  if (typeof p.tid !== "string" || !UUID.test(p.tid)) return null;
  if (!(ROLES as readonly unknown[]).includes(p.role) || !(LEVELS as readonly unknown[]).includes(p.lvl)) return null;
  if (typeof p.pin !== "string" || (p.pin !== "" && !UUID.test(p.pin))) return null;
  return p as unknown as Payload;
}

/**
 * Verifies a cookie value against the session it arrived with. `expect.userId` / `expect.sessionId` come from the JWT
 * claims verified for this request; `expect.pin` is this request's active-clinic cookie.
 */
export function verifyContext(
  value: string | null | undefined,
  secret: string,
  expect: { userId: string; sessionId: string | null; pin: string | null | undefined },
  nowSeconds: number = Math.floor(Date.now() / 1000),
): ContextVerdict {
  if (typeof value !== "string" || value.length > 2048) return { ok: false, reason: "malformed" };
  const dot = value.indexOf(".");
  if (dot <= 0 || dot !== value.lastIndexOf(".")) return { ok: false, reason: "malformed" };
  const text = value.slice(0, dot);
  let given: Buffer;
  try {
    given = Buffer.from(value.slice(dot + 1), "base64url");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const expected = mac(text, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "signature" };
  const p = parsePayload(text);
  if (!p) return { ok: false, reason: "malformed" };
  if (p.iat > nowSeconds + CLOCK_SKEW_SECONDS || p.exp - p.iat > CONTEXT_COOKIE_TTL_SECONDS || p.exp <= nowSeconds) {
    return { ok: false, reason: "expired" };
  }
  if (p.uid.toLowerCase() !== expect.userId.toLowerCase()) return { ok: false, reason: "user" };
  if (!expect.sessionId || p.sid.toLowerCase() !== expect.sessionId.toLowerCase()) return { ok: false, reason: "session" };
  if (p.pin !== normalisePin(expect.pin)) return { ok: false, reason: "pin" };
  return {
    ok: true,
    context: { userId: p.uid, sessionId: p.sid, tenantId: p.tid, role: p.role, level: p.lvl, pin: p.pin },
    expiresAt: p.exp,
  };
}

/** Cookie attributes: HttpOnly, SameSite=Lax, Path=/, Max-Age = TTL; `secure` per request (https, or production off loopback). */
export function contextCookieOptions(secure: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, path: "/", secure, maxAge: CONTEXT_COOKIE_TTL_SECONDS };
}
