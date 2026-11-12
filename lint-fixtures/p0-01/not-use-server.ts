// Lint-gate fixture (P0-01): must PASS the P0-01 action gates: without the "use server" directive the module is
// not a server action module (service modules take a typed ctx).
export async function fixture(session: { userId: string }, client: unknown, tenantId: string) {
  return [session, client, tenantId];
}
