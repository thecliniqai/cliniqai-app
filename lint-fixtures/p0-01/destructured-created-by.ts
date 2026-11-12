"use server";
// Lint-gate fixture (P0-01): must FAIL lint. Never imported or executed.
export async function fixture({ name, createdBy }: { name: string; createdBy: string }) {
  return [name, createdBy];
}
