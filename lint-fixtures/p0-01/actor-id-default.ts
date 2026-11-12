"use server";
// Lint-gate fixture (P0-01): must FAIL lint. Never imported or executed.
export async function fixture(id: string, actorId = "00000000-0000-4000-8000-000000000001") {
  return [id, actorId];
}
