"use server";
// Lint-gate fixture (P0-01): must FAIL lint. Never imported or executed.
export async function fixture(client: unknown, id: string) {
  return [client, id];
}
