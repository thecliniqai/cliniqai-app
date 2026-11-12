"use server";

import { revalidatePath } from "next/cache";
import { resolveServiceContext } from "@/lib/auth/context";
import * as apiKeysService from "./service";
import type { CreateApiKeyResult, ListApiKeysResult } from "./service";

export type { ApiKeyItem, CreateApiKeyResult, ListApiKeysResult } from "./service";

// Each action authenticates and checks clinic:manage before it reads any input and derives the tenant and actor from
// the session (ADR-0005 D1), then delegates to the server-only service. Failure shapes are unchanged.

function revalidate() {
  try {
    revalidatePath("/settings/developer");
  } catch {
    // Outside a Next.js request (tests) revalidation is a no-op
  }
}

export async function listApiKeys(): Promise<ListApiKeysResult> {
  const resolved = await resolveServiceContext("clinic:manage");
  if (!resolved.ok) return { success: false, keys: [], error: resolved.error };
  return apiKeysService.listApiKeys(resolved.ctx);
}

export async function createApiKey(name: string): Promise<CreateApiKeyResult> {
  const resolved = await resolveServiceContext("clinic:manage");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await apiKeysService.createApiKey(resolved.ctx, name);
  if (result.success) revalidate();
  return result;
}

export async function revokeApiKey(keyId: string): Promise<{ success: boolean; error?: string }> {
  const resolved = await resolveServiceContext("clinic:manage");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await apiKeysService.revokeApiKey(resolved.ctx, keyId);
  if (result.success) revalidate();
  return result;
}
