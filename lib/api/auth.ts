import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "@/lib/db/types";
import { apiError, ApiErrorResponse } from "@/lib/api/envelope";
import type { ServiceContext } from "@/lib/auth/context";
import { apiV1Enabled } from "@/lib/api/enabled";

/**
 * The plain 404 the `/api/v1` switch answers with (same as the middleware: empty body, nothing that reveals the API).
 * Handlers return it when `apiV1Enabled()` is false, so the switch does not depend on the middleware alone (AR2-H2).
 */
export function apiV1NotFound<T = ApiErrorResponse>(): NextResponse<T> {
  return new NextResponse(null, { status: 404 }) as NextResponse<T>;
}

export interface AuthenticatedApiKeySession {
  apiKeyId: string;
  tenantId: string;
  userId: string; // auth.users UUID of creator for FK compliance
  name: string;
  role: "admin"; // D-02: All-or-nothing clinic admin scope
}

export type ApiKeyAuthResult =
  | { success: true; session: AuthenticatedApiKeySession }
  | { success: false; response: NextResponse<ApiErrorResponse> };

/**
 * Creates high-entropy prefixed API key credentials.
 * Key format: clq_live_<48-char hex>
 */
export function createApiKeySecret(): {
  rawToken: string;
  keyPrefix: string;
  keyHash: string;
} {
  const randomHex = crypto.randomBytes(24).toString("hex");
  const rawToken = `clq_live_${randomHex}`;
  const keyPrefix = rawToken.slice(0, 16);
  const keyHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  return { rawToken, keyPrefix, keyHash };
}

/**
 * Validates incoming Bearer tokens for /api/v1/* routes.
 * 1. Checks Authorization header for Bearer clq_live_...
 * 2. Hashes token via SHA-256 and retrieves key record where revoked_at IS NULL
 * 3. Compares digests in constant time via crypto.timingSafeEqual
 * 4. Records last_used_at and increments daily usage counter
 * 5. Returns AuthenticatedApiKeySession with tenant context and creator userId
 */
export async function authenticateApiKey(
  // Required, never defaulted (V2-01 R13): the `/api/v1` register route builds the client and passes it in.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<Database, any, any>,
  req: NextRequest
): Promise<ApiKeyAuthResult> {
  // AR2-H2 defence in depth: every key-authenticated v1 handler is off with the switch, even if the middleware is
  // bypassed. Checked before the key is looked up, so no usage counter moves either.
  if (!apiV1Enabled()) {
    return { success: false, response: apiV1NotFound() };
  }

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      success: false,
      response: apiError(
        "UNAUTHORIZED",
        "Missing or invalid Authorization header. Expected Bearer clq_live_...",
        401
      ),
    };
  }

  const rawToken = authHeader.slice(7).trim();

  if (!rawToken.startsWith("clq_live_") || rawToken.length < 20) {
    return {
      success: false,
      response: apiError(
        "UNAUTHORIZED",
        "Invalid API key format. Expected Bearer clq_live_...",
        401
      ),
    };
  }

  const computedHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const supabase = db;

  const { data: keyRecord, error } = await (supabase.from("api_keys") as any)
    .select("id, tenant_id, name, key_hash, created_by, revoked_at")
    .eq("key_hash", computedHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !keyRecord) {
    return {
      success: false,
      response: apiError("UNAUTHORIZED", "Invalid or revoked API key", 401),
    };
  }

  // Constant-time comparison to prevent timing side channels (T-06-02)
  const providedBuf = Buffer.from(computedHash, "utf-8");
  const storedBuf = Buffer.from(keyRecord.key_hash, "utf-8");

  if (
    providedBuf.length !== storedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, storedBuf)
  ) {
    return {
      success: false,
      response: apiError("UNAUTHORIZED", "Invalid or revoked API key", 401),
    };
  }

  const now = new Date().toISOString();
  const today = now.split("T")[0];

  // Update last_used_at and daily usage counter
  try {
    await (supabase.from("api_keys") as any)
      .update({ last_used_at: now, updated_at: now })
      .eq("id", keyRecord.id);

    const { data: usage } = await (supabase.from("api_key_usage_daily") as any)
      .select("request_count")
      .eq("api_key_id", keyRecord.id)
      .eq("date", today)
      .maybeSingle();

    if (usage) {
      await (supabase.from("api_key_usage_daily") as any)
        .update({
          request_count: (usage.request_count || 0) + 1,
          last_request_at: now,
        })
        .eq("api_key_id", keyRecord.id)
        .eq("date", today);
    } else {
      await (supabase.from("api_key_usage_daily") as any)
        .insert({
          tenant_id: keyRecord.tenant_id,
          api_key_id: keyRecord.id,
          date: today,
          request_count: 1,
          error_count: 0,
          last_request_at: now,
        });
    }
  } catch (usageErr) {
    console.error("[lib/api/auth] Failed to record usage counter:", usageErr);
  }

  return {
    success: true,
    session: {
      apiKeyId: keyRecord.id,
      tenantId: keyRecord.tenant_id,
      userId: keyRecord.created_by,
      name: keyRecord.name,
      role: "admin",
    },
  };
}

/**
 * Builds the explicit service context for an authenticated API key (ADR-0005 Phasing: `/api/v1/**` stays on the
 * register until P1-37). Tenant and actor come only from the verified key; `db` is the register route's client.
 */
export function apiKeyServiceContext(
  session: AuthenticatedApiKeySession,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<Database, any, any>
): ServiceContext {
  return {
    userId: session.userId,
    tenantId: session.tenantId,
    role: session.role,
    actorType: "api_key",
    apiKeyId: session.apiKeyId,
    db,
  };
}
