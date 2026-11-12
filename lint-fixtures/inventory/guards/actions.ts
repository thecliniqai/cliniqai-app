"use server";
// Inventory guard-extraction fixture (P0-13, V2-02 02-02): proven by tests/ci/inventory-guards.spec.ts. Never imported
// or executed; only the TypeScript compiler reads it.
import { requireServiceContext, resolveServiceContext } from "@/lib/auth/context";
import { getActiveMembership } from "@/lib/auth/tenant";
import { requirePermission } from "@/lib/permissions/guards";
import { createClient } from "@/lib/supabase/server";

const EXPORT_PERMISSION = "exports:create" as const;

async function loadWithGuard() {
  return requireServiceContext("billing:view");
}

export async function directPermission() {
  return resolveServiceContext("patients:view");
}

export async function legacyTwoArgGuard() {
  const supabase = await createClient();
  return requirePermission(supabase, "clinic:manage");
}

export async function constantPermission() {
  return requireServiceContext(EXPORT_PERMISSION);
}

export async function membershipOnly() {
  return resolveServiceContext();
}

export async function delegatedGuard() {
  return loadWithGuard();
}

export async function firstGuardWins() {
  await getActiveMembership();
  return requireServiceContext("clinic:manage");
}

export const aliasOfDirect = directPermission;

export async function unguarded() {
  const supabase = await createClient();
  return supabase.auth.getUser();
}
