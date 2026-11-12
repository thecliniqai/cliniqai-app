"use server";
// Lint-gate fixture (P0-01): must FAIL lint. Never imported or executed.
async function fixture(id: string, sessionOverride?: unknown) {
  return [id, sessionOverride];
}

export { fixture };
