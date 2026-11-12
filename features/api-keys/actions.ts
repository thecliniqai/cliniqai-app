"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAuditLegacy } from "@/lib/audit/audit";

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

/**
 * Lists all API keys for the authenticated clinic tenant, joining
 * today's request count from public.api_key_usage_daily.
 * Enforces clinic:manage permission (owner or admin).
 */
export async function listApiKeys(clientOverride?: unknown): Promise<{
  success: boolean;
  keys: ApiKeyItem[];
  error?: string;
}> {
  try {
    const session = await requirePermission("clinic:manage");
    const supabase = (clientOverride as any) || (await createClient());

    const todayDate = new Date().toISOString().slice(0, 10);

    // 1. Fetch keys
    const { data: keys, error: keysErr } = await (supabase.from("api_keys") as any)
      .select("id, name, key_prefix, created_at, last_used_at, revoked_at")
      .eq("tenant_id", session.tenantId)
      .order("created_at", { ascending: false });

    if (keysErr) {
      console.error("[listApiKeys] Error fetching keys:", keysErr);
      return { success: false, keys: [], error: "Failed to load API keys." };
    }

    // 2. Fetch today's usage counts for all keys in this tenant
    const { data: usageRows } = await (supabase.from("api_key_usage_daily") as any)
      .select("api_key_id, request_count")
      .eq("tenant_id", session.tenantId)
      .eq("date", todayDate);

    const usageMap = new Map<string, number>();
    for (const row of usageRows || []) {
      usageMap.set(row.api_key_id, row.request_count || 0);
    }

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
    console.error("[listApiKeys] Exception:", err);
    return {
      success: false,
      keys: [],
      error: err instanceof Error ? err.message : "Access denied or session invalid.",
    };
  }
}

/**
 * Creates a new tenant-scoped API key.
 * Generates high-entropy CSPRNG raw key (clq_live_...), stores SHA-256 hash,
 * records audit event, and returns raw key for single-reveal display.
 */
export async function createApiKey(
  name: string,
  clientOverride?: unknown
): Promise<CreateApiKeyResult> {
  try {
    const cleanName = (name || "").trim();
    if (!cleanName || cleanName.length < 2) {
      return { success: false, error: "Key label must be at least 2 characters long." };
    }

    const session = await requirePermission("clinic:manage");
    const supabase = (clientOverride as any) || (await createClient());

    // 1. Generate cryptographic secret
    const rawSecret = crypto.randomBytes(24).toString("hex");
    const rawKey = `clq_live_${rawSecret}`;
    const keyPrefix = rawKey.slice(0, 16); // "clq_live_" + 7 hex characters
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");

    // 2. Insert into public.api_keys
    const { data: newKey, error: insertErr } = await (supabase.from("api_keys") as any)
      .insert({
        tenant_id: session.tenantId,
        name: cleanName,
        key_prefix: keyPrefix,
        key_hash: keyHash,
        created_by: session.userId,
      })
      .select("id, name, key_prefix")
      .single();

    if (insertErr || !newKey) {
      console.error("[createApiKey] Insert error:", insertErr);
      return { success: false, error: "Failed to persist API key record." };
    }

    // 3. Audit trail (D-08, AGENTS.md §10)
    try {
      await recordAuditLegacy(
        {
          action: "api_key.create",
          entityType: "api_key",
          entityId: newKey.id,
          metadata: {
            reason: `API key created for: ${cleanName}`,
          },
        },
        clientOverride as any,
        session
      );
    } catch (auditErr) {
      console.warn("[createApiKey] Audit logging warning:", auditErr);
    }

    try {
      revalidatePath("/settings/developer");
    } catch {
      // Non-web contexts
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
    console.error("[createApiKey] Exception:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unable to generate API key.",
    };
  }
}

/**
 * Revokes an existing API key immediately, rendering all subsequent API requests invalid.
 * Enforces clinic:manage permission.
 */
export async function revokeApiKey(
  keyId: string,
  clientOverride?: unknown
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!keyId || typeof keyId !== "string") {
      return { success: false, error: "Valid API key identifier is required." };
    }

    const session = await requirePermission("clinic:manage");
    const supabase = (clientOverride as any) || (await createClient());

    const nowIso = new Date().toISOString();

    const { error: updateErr } = await (supabase.from("api_keys") as any)
      .update({
        revoked_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", keyId)
      .eq("tenant_id", session.tenantId);

    if (updateErr) {
      console.error("[revokeApiKey] Update error:", updateErr);
      return { success: false, error: "Failed to revoke API key." };
    }

    // Audit log
    try {
      await recordAuditLegacy(
        {
          action: "api_key.revoke",
          entityType: "api_key",
          entityId: keyId,
          metadata: {
            reason: "API key manually revoked by clinic administrator",
          },
        },
        clientOverride as any,
        session
      );
    } catch (auditErr) {
      console.warn("[revokeApiKey] Audit warning:", auditErr);
    }

    try {
      revalidatePath("/settings/developer");
    } catch {
      // Non-web contexts
    }

    return { success: true };
  } catch (err: unknown) {
    console.error("[revokeApiKey] Exception:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unable to revoke API key.",
    };
  }
}
