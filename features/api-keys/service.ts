import "server-only";

import crypto from "crypto";
import { assertPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { recordAudit } from "@/lib/audit/audit";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

// API key management use-cases (clinic:manage, as before). Tenant and creator come only from `ctx` (ADR-0005 D1).

export interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  scope: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  todayRequestCount: number;
}

export interface CreateApiKeyResult {
  success: boolean;
  key?: {
    id: string;
    name: string;
    prefix: string;
    rawKey: string;
  };
  error?: string;
}

export type ListApiKeysResult = { success: boolean; keys: ApiKeyItem[]; error?: string };

/**
 * Lists all API keys for the acting clinic tenant, joining today's request count from public.api_key_usage_daily.
 */
export async function listApiKeys(ctx: ServiceContext): Promise<ListApiKeysResult> {
  try {
    assertPerm(ctx.role, "clinic:manage");
    const supabase = ctx.db;

    const todayDate = new Date().toISOString().slice(0, 10);

    // 1. Fetch keys
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: keys, error: keysErr } = await (supabase.from("api_keys") as any)
      .select("id, name, key_prefix, created_at, last_used_at, revoked_at")
      .eq("tenant_id", ctx.tenantId)
      .order("created_at", { ascending: false });

    if (keysErr) {
      log.error({ event: "apikeys.list_query.failed", code: errorTag(keysErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, keys: [], error: "Failed to load API keys." };
    }

    // 2. Fetch today's usage counts for all keys in this tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: usageRows } = await (supabase.from("api_key_usage_daily") as any)
      .select("api_key_id, request_count")
      .eq("tenant_id", ctx.tenantId)
      .eq("date", todayDate);

    const usageMap = new Map<string, number>();
    for (const row of usageRows || []) {
      usageMap.set(row.api_key_id, row.request_count || 0);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: ApiKeyItem[] = (keys || []).map((k: any) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.key_prefix,
      scope: "Clinic Admin",
      createdAt: k.created_at,
      lastUsedAt: k.last_used_at,
      revokedAt: k.revoked_at,
      todayRequestCount: usageMap.get(k.id) || 0,
    }));

    return { success: true, keys: items };
  } catch (err: unknown) {
    log.error({ event: "apikeys.list.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return {
      success: false,
      keys: [],
      error: err instanceof Error ? err.message : "Access denied or session invalid.",
    };
  }
}

/**
 * Creates a new tenant-scoped API key. Generates a high-entropy CSPRNG raw key (clq_live_...), stores its SHA-256
 * hash, records an audit event, and returns the raw key for single-reveal display. The creator is the acting user.
 */
export async function createApiKey(ctx: ServiceContext, name: string): Promise<CreateApiKeyResult> {
  try {
    assertPerm(ctx.role, "clinic:manage");

    const cleanName = (name || "").trim();
    if (!cleanName || cleanName.length < 2) {
      return { success: false, error: "Key label must be at least 2 characters long." };
    }

    const supabase = ctx.db;

    // 1. Generate cryptographic secret
    const rawSecret = crypto.randomBytes(24).toString("hex");
    const rawKey = `clq_live_${rawSecret}`;
    const keyPrefix = rawKey.slice(0, 16); // "clq_live_" + 7 hex characters
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");

    // 2. Insert into public.api_keys
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: newKey, error: insertErr } = await (supabase.from("api_keys") as any)
      .insert({
        tenant_id: ctx.tenantId,
        name: cleanName,
        key_prefix: keyPrefix,
        key_hash: keyHash,
        created_by: ctx.userId,
      })
      .select("id, name, key_prefix")
      .single();

    if (insertErr || !newKey) {
      log.error({ event: "apikeys.create_insert.failed", code: errorTag(insertErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to persist API key record." };
    }

    // 3. Audit trail (D-08, AGENTS.md §10)
    try {
      await recordAudit(ctx, {
        action: "api_key.create",
        entityType: "api_key",
        entityId: newKey.id,
        metadata: {
          reason: `API key created for: ${cleanName}`,
        },
      });
    } catch (auditErr) {
      log.warn({ event: "apikeys.create_audit.failed", code: errorTag(auditErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
    }

    return {
      success: true,
      key: {
        id: newKey.id,
        name: newKey.name,
        prefix: newKey.key_prefix,
        rawKey,
      },
    };
  } catch (err: unknown) {
    log.error({ event: "apikeys.create.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unable to generate API key.",
    };
  }
}

/**
 * Revokes an API key of the acting tenant immediately, rendering all subsequent API requests invalid.
 */
export async function revokeApiKey(ctx: ServiceContext, keyId: string): Promise<{ success: boolean; error?: string }> {
  try {
    assertPerm(ctx.role, "clinic:manage");

    if (!keyId || typeof keyId !== "string") {
      return { success: false, error: "Valid API key identifier is required." };
    }

    const supabase = ctx.db;
    const nowIso = new Date().toISOString();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateErr } = await (supabase.from("api_keys") as any)
      .update({
        revoked_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", keyId)
      .eq("tenant_id", ctx.tenantId);

    if (updateErr) {
      log.error({ event: "apikeys.revoke_update.failed", code: errorTag(updateErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to revoke API key." };
    }

    // Audit log
    try {
      await recordAudit(ctx, {
        action: "api_key.revoke",
        entityType: "api_key",
        entityId: keyId,
        metadata: {
          reason: "API key manually revoked by clinic administrator",
        },
      });
    } catch (auditErr) {
      log.warn({ event: "apikeys.revoke_audit.failed", code: errorTag(auditErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
    }

    return { success: true };
  } catch (err: unknown) {
    log.error({ event: "apikeys.revoke.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unable to revoke API key.",
    };
  }
}
