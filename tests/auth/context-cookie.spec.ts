/**
 * V2-09d (request speed): the signed session-context cookie (`lib/auth/context-cookie.ts`). Pure: no database.
 *
 * - a value signed for a session verifies for that session (user, session id, pin) and carries ids, role and state only;
 * - refused: a changed payload or MAC, another key, a malformed value, an expired one, one issued in the future or with a
 *   lifetime over the TTL, another user, another session (or a token with no session id), another active-clinic pin;
 * - the TTL stays well inside the access token's 900 s.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CONTEXT_COOKIE,
  CONTEXT_COOKIE_TTL_SECONDS,
  contextCookieOptions,
  signContext,
  verifyContext,
  type SessionContext,
} from "@/lib/auth/context-cookie";
import { PROXY_CONTEXT_COOKIE } from "@/proxy";

const SECRET = "not-real-session-context-key-".repeat(2);
const NOW = 1_800_000_000;
const CONTEXT: SessionContext = {
  userId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  tenantId: "33333333-3333-4333-8333-333333333333",
  role: "receptionist",
  level: "full",
  pin: "33333333-3333-4333-8333-333333333333",
};
const EXPECT = { userId: CONTEXT.userId, sessionId: CONTEXT.sessionId, pin: CONTEXT.pin };

function payloadOf(value: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(value.split(".")[0]!, "base64url").toString("utf8")) as Record<string, unknown>;
}

function resign(payload: Record<string, unknown>, secret = SECRET): string {
  // A forger who knows the format but signs with the key they have (or none): the MAC must not verify.
  const signed = signContext(CONTEXT, secret, NOW);
  const text = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${text}.${signed.split(".")[1]}`;
}

describe("V2-09d session-context cookie", () => {
  it("round trip: verifies for the same session and pin, with exactly the documented fields", () => {
    const value = signContext(CONTEXT, SECRET, NOW);
    const verdict = verifyContext(value, SECRET, EXPECT, NOW + 10);
    expect(verdict).toEqual({ ok: true, context: CONTEXT, expiresAt: NOW + CONTEXT_COOKIE_TTL_SECONDS });
    expect(Object.keys(payloadOf(value)).sort()).toEqual(["exp", "iat", "lvl", "pin", "role", "sid", "tid", "uid", "v"].sort());
  });

  it("the pin is compared case-insensitively, and an absent pin binds to no pin", () => {
    const value = signContext({ ...CONTEXT, pin: CONTEXT.pin.toUpperCase() }, SECRET, NOW);
    expect(verifyContext(value, SECRET, { ...EXPECT, pin: CONTEXT.pin.toUpperCase() }, NOW).ok).toBe(true);
    const unpinned = signContext({ ...CONTEXT, pin: "" }, SECRET, NOW);
    expect(verifyContext(unpinned, SECRET, { ...EXPECT, pin: null }, NOW).ok).toBe(true);
    expect(verifyContext(unpinned, SECRET, { ...EXPECT, pin: "not-a-clinic-id" }, NOW).ok).toBe(true);
    expect(verifyContext(unpinned, SECRET, EXPECT, NOW)).toEqual({ ok: false, reason: "pin" });
  });

  it("signature: a changed payload, a changed MAC or another key is refused", () => {
    const value = signContext(CONTEXT, SECRET, NOW);
    const escalated = resign({ ...payloadOf(value), role: "owner" });
    expect(verifyContext(escalated, SECRET, EXPECT, NOW)).toEqual({ ok: false, reason: "signature" });
    const otherClinic = resign({ ...payloadOf(value), tid: "44444444-4444-4444-8444-444444444444" });
    expect(verifyContext(otherClinic, SECRET, EXPECT, NOW)).toEqual({ ok: false, reason: "signature" });
    const [text, mac] = value.split(".");
    const flipped = `${text}.${mac!.slice(0, -2)}${mac!.endsWith("AA") ? "AB" : "AA"}`;
    expect(verifyContext(flipped, SECRET, EXPECT, NOW)).toEqual({ ok: false, reason: "signature" });
    expect(verifyContext(value, `${SECRET}x`, EXPECT, NOW)).toEqual({ ok: false, reason: "signature" });
    expect(verifyContext(`${text}.`, SECRET, EXPECT, NOW)).toEqual({ ok: false, reason: "signature" });
  });

  it("malformed values are refused", () => {
    for (const bad of [undefined, null, "", "abc", "a.b.c", ".x", "x".repeat(3000)]) {
      expect(verifyContext(bad, SECRET, EXPECT, NOW).ok).toBe(false);
    }
  });

  it("expiry: refused at and after exp, when issued in the future, or with a lifetime over the TTL", () => {
    const value = signContext(CONTEXT, SECRET, NOW);
    expect(verifyContext(value, SECRET, EXPECT, NOW + CONTEXT_COOKIE_TTL_SECONDS - 1).ok).toBe(true);
    expect(verifyContext(value, SECRET, EXPECT, NOW + CONTEXT_COOKIE_TTL_SECONDS)).toEqual({ ok: false, reason: "expired" });
    expect(verifyContext(value, SECRET, EXPECT, NOW + 3600)).toEqual({ ok: false, reason: "expired" });
    expect(verifyContext(value, SECRET, EXPECT, NOW - 31)).toEqual({ ok: false, reason: "expired" });
    // A lifetime over the TTL is refused even when correctly signed (a key leak cannot mint long-lived contexts).
    const long = signContext(CONTEXT, SECRET, NOW);
    const p = payloadOf(long);
    const text = Buffer.from(JSON.stringify({ ...p, exp: NOW + CONTEXT_COOKIE_TTL_SECONDS + 1 }), "utf8").toString("base64url");
    const mac = createHmac("sha256", SECRET).update("clinicos.session-context.v1.").update(text).digest("base64url");
    expect(verifyContext(`${text}.${mac}`, SECRET, EXPECT, NOW)).toEqual({ ok: false, reason: "expired" });
  });

  it("session binding: another user, another session, or a token without a session id is refused", () => {
    const value = signContext(CONTEXT, SECRET, NOW);
    expect(verifyContext(value, SECRET, { ...EXPECT, userId: "55555555-5555-4555-8555-555555555555" }, NOW)).toEqual({ ok: false, reason: "user" });
    expect(verifyContext(value, SECRET, { ...EXPECT, sessionId: "66666666-6666-4666-8666-666666666666" }, NOW)).toEqual({ ok: false, reason: "session" });
    expect(verifyContext(value, SECRET, { ...EXPECT, sessionId: null }, NOW)).toEqual({ ok: false, reason: "session" });
  });

  it("pin binding: a context resolved under another active clinic is refused", () => {
    const value = signContext(CONTEXT, SECRET, NOW);
    expect(verifyContext(value, SECRET, { ...EXPECT, pin: "77777777-7777-4777-8777-777777777777" }, NOW)).toEqual({ ok: false, reason: "pin" });
    expect(verifyContext(value, SECRET, { ...EXPECT, pin: null }, NOW)).toEqual({ ok: false, reason: "pin" });
  });

  it("TTL and attributes: 5 minutes (inside the 900 s access token), HttpOnly, SameSite=Lax, Path=/; the proxy names the same cookie", () => {
    expect(CONTEXT_COOKIE_TTL_SECONDS).toBe(300);
    expect(CONTEXT_COOKIE_TTL_SECONDS).toBeLessThan(900);
    expect(contextCookieOptions(true)).toEqual({ httpOnly: true, sameSite: "lax", path: "/", secure: true, maxAge: 300 });
    expect(contextCookieOptions(false).secure).toBe(false);
    expect(PROXY_CONTEXT_COOKIE).toBe(CONTEXT_COOKIE);
  });
});
