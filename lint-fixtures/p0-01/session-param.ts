"use server";
// Lint-gate fixture (P0-01): must FAIL lint. Never imported or executed.
export async function fixture(session: { userId: string; tenantId: string }) {
  return session.userId;
}
