/**
 * V2-03 03-13e (H-AUTH residual; migration 000030, `[auth.hook.custom_access_token]` in supabase/config.toml): the
 * local GoTrue (v2.197.0) with the Custom Access Token hook enabled, driven straight over HTTP the way a thief holding
 * a refresh token would (`POST /auth/v1/token?grant_type=refresh_token`), never through the app: without a fresh access
 * token there is nothing to send to `PUT /auth/v1/user`.
 *
 * Age is simulated in data, not in a clock: GoTrue builds `amr` from `auth.mfa_amr_claims` (the factor's updated_at,
 * which a refresh never moves), so moving that row's updated_at back N seconds makes a real session N seconds older.
 *
 * Fails without the fix: before 000030 (and with the hook off) the aged recovery session refreshes (200) and the new
 * access token changes the password straight at GoTrue; the 03-13a residual ("GoTrue itself has no age bound").
 */
import { beforeAll, describe, expect, it } from "vitest";
import { publicEnv } from "@/lib/env";
import { addMemberToTenant, seedTenantWithOwner, seededUserPassword, type SeededTenant } from "../../helpers/tenants";
import { recoverySession, signedInClient, type BrowserLikeClient } from "../../helpers/auth-flows";
import { psql } from "../../helpers/sql";

const GOTRUE = `${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`;
const headers = { apikey: publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" };

interface Claims {
  session_id: string;
  exp: number;
  iat: number;
  amr: { method: string; timestamp: number }[];
}

function claimsOf(accessToken: string): Claims {
  return JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8")) as Claims;
}

/** The refresh grant straight at GoTrue (what a stolen refresh token allows). */
async function directRefresh(refreshToken: string): Promise<{ status: number; access?: string; refresh?: string; code?: string }> {
  const res = await fetch(`${GOTRUE}/token?grant_type=refresh_token`, {
    method: "POST",
    headers,
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; error_code?: string; code?: string | number };
  return { status: res.status, access: body.access_token, refresh: body.refresh_token, code: body.error_code };
}

/** Moves every amr factor of `sessionId` back by `seconds` (optionally renaming the method). Synthetic rows only. */
function ageSession(sessionId: string, seconds: number, method?: string): void {
  if (!/^[0-9a-f-]{36}$/.test(sessionId)) throw new Error("not a session id");
  const rename = method ? `, authentication_method = '${method.replace(/'/g, "''")}'` : "";
  psql(`update auth.mfa_amr_claims set updated_at = now() - interval '${seconds} seconds'${rename} where session_id = '${sessionId}'`);
}

async function tokensOf(client: BrowserLikeClient): Promise<{ access: string; refresh: string }> {
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error("no session");
  return { access: data.session.access_token, refresh: data.session.refresh_token };
}

let owner: SeededTenant;
beforeAll(async () => {
  owner = await seedTenantWithOwner(`Token Hook Clinic ${Date.now()}`);
});

describe("Custom Access Token hook on the local GoTrue (03-13e)", () => {
  it("a recovery session refreshed straight at GoTrue within 600 s succeeds (also at 590 s); claims unchanged", async () => {
    const user = await addMemberToTenant(owner.tenantId, "doctor");
    const t = await tokensOf(await recoverySession(user.userEmail));
    const first = claimsOf(t.access);
    expect(first.amr.map((a) => a.method)).toEqual(["otp"]); // a recovery session's amr reads otp (AUTH-00 E1b)

    const r = await directRefresh(t.refresh);
    expect(r.status).toBe(200);
    const next = claimsOf(r.access!);
    expect(next.session_id).toBe(first.session_id);
    expect(next.amr).toEqual(first.amr);
    expect(next.exp - next.iat).toBe(900);

    ageSession(first.session_id, 590);
    const late = await directRefresh(r.refresh!);
    expect(late.status).toBe(200);
    expect(claimsOf(late.access!).amr[0].timestamp).toBeLessThanOrEqual(first.amr[0].timestamp - 589);
  });

  it("past 600 s the refresh is refused (403, no token): no fresh token for PUT /user; supabase-js gets the 403", async () => {
    const user = await addMemberToTenant(owner.tenantId, "doctor");
    const client = await recoverySession(user.userEmail);
    const t = await tokensOf(client);
    ageSession(claimsOf(t.access).session_id, 601);

    const r = await directRefresh(t.refresh);
    expect(r.status).toBe(403);
    expect(r.access).toBeUndefined();
    expect(r.refresh).toBeUndefined();
    // Refused every time after (the factor only gets older), not just once.
    expect((await directRefresh(t.refresh)).status).toBe(403);

    const { data, error } = await client.auth.refreshSession();
    expect(error?.status).toBe(403);
    expect(data.session).toBeNull();
  });

  it("a password session is unaffected at any age (refresh 200, the normal 900 s token)", async () => {
    const user = await addMemberToTenant(owner.tenantId, "doctor");
    const { client, result } = await signedInClient(user.userEmail, seededUserPassword());
    expect(result.ok).toBe(true);
    const t = await tokensOf(client);
    ageSession(claimsOf(t.access).session_id, 30 * 86400);

    const r = await directRefresh(t.refresh);
    expect(r.status).toBe(200);
    const claims = claimsOf(r.access!);
    expect(claims.amr.map((a) => a.method)).toEqual(["password"]);
    expect(claims.exp - claims.iat).toBe(900);
  });

  it("an unknown amr method fails closed: allowed while fresh, refused past 600 s", async () => {
    const user = await addMemberToTenant(owner.tenantId, "doctor");
    const { client, result } = await signedInClient(user.userEmail, seededUserPassword());
    expect(result.ok).toBe(true);
    const t = await tokensOf(client);
    const sid = claimsOf(t.access).session_id;

    ageSession(sid, 10, "carrier/pigeon");
    const fresh = await directRefresh(t.refresh);
    expect(fresh.status).toBe(200);
    expect(claimsOf(fresh.access!).amr.map((a) => a.method)).toEqual(["carrier/pigeon"]);

    ageSession(sid, 601, "carrier/pigeon");
    expect((await directRefresh(fresh.refresh!)).status).toBe(403);
  });
});
