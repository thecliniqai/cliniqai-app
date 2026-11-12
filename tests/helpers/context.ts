import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServiceContext } from "@/lib/auth/context";
import type { SeededTenant } from "./tenants";

/**
 * Builds the explicit service context for a seeded tenant user (ADR-0005 D1: "Tests call domain services with an
 * explicit context"). `db` is that user's JWT client, so RLS applies exactly as in a real request.
 */
export function ctxFor(t: Pick<SeededTenant, "userId" | "tenantId" | "role" | "client">): ServiceContext {
  return { userId: t.userId, tenantId: t.tenantId, role: t.role, actorType: "user", db: t.client };
}

/** A context over a hand-built fake client, for unit tests that stub the database. */
export function mockCtx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any> | Record<string, unknown>,
  overrides: Partial<Omit<ServiceContext, "db">> = {}
): ServiceContext {
  return {
    userId: "00000000-0000-4000-8000-000000000001",
    tenantId: "00000000-0000-4000-8000-0000000000a1",
    role: "owner",
    actorType: "user",
    ...overrides,
    db: db as ServiceContext["db"],
  };
}
