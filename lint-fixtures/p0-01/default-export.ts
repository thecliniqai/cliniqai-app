"use server";
// Lint-gate fixture (P0-01): must FAIL lint. Never imported or executed.
export default async function fixture(id: string, clientOverride?: unknown) {
  return [id, clientOverride];
}
