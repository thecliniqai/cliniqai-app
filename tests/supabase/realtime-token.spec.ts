/**
 * V2-08 08-03a (R-10): the Realtime client reads the access token from the session cookie (it has no auth client, so it
 * can never refresh or delete the session). Whole, `base64-` encoded and chunked cookies; anything else gives null.
 */
import { describe, expect, it } from "vitest";
import { accessTokenFromCookie } from "@/lib/supabase/client";

const session = { access_token: "header.payload.signature", refresh_token: "r", user: { id: "u" } };
const b64url = (text: string) => Buffer.from(text, "utf8").toString("base64url");

describe("accessTokenFromCookie", () => {
  it("reads a base64url session cookie", () => {
    const cookie = `theme=dark; sb-127-auth-token=base64-${b64url(JSON.stringify(session))}; other=1`;
    expect(accessTokenFromCookie(cookie)).toBe("header.payload.signature");
  });

  it("reads a plain JSON session cookie (url-encoded)", () => {
    expect(accessTokenFromCookie(`sb-local-auth-token=${encodeURIComponent(JSON.stringify(session))}`)).toBe("header.payload.signature");
  });

  it("joins a chunked session cookie in order", () => {
    const value = `base64-${b64url(JSON.stringify({ ...session, user: { id: "u", note: "é".repeat(200) } }))}`;
    const half = Math.floor(value.length / 2);
    const cookie = `sb-x-auth-token.1=${value.slice(half)}; sb-x-auth-token.0=${value.slice(0, half)}`;
    expect(accessTokenFromCookie(cookie)).toBe("header.payload.signature");
  });

  it("answers null without a session cookie, with a broken one, or without an access token", () => {
    expect(accessTokenFromCookie("")).toBeNull();
    expect(accessTokenFromCookie("theme=dark; sb-127-auth-token-code-verifier=abc")).toBeNull();
    expect(accessTokenFromCookie("sb-127-auth-token=base64-!!!")).toBeNull();
    expect(accessTokenFromCookie(`sb-127-auth-token=${encodeURIComponent(JSON.stringify({ refresh_token: "r" }))}`)).toBeNull();
  });
});
