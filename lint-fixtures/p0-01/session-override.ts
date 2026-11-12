"use server";
// Lint-gate fixture (P0-01): must FAIL lint. Never imported or executed.
export async function fixture(query: string, sessionOverride?: { userId: string; tenantId: string }) {
  return [query, sessionOverride];
}
