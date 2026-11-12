"use server";
// Lint-gate fixture (P0-01): must FAIL lint. Never imported or executed.
export async function fixture({ systolic, recorded_by }: { systolic: number; recorded_by?: string } = { systolic: 0 }) {
  return [systolic, recorded_by];
}
