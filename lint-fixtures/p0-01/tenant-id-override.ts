"use server";
// Lint-gate fixture (P0-01): must FAIL lint. Never imported or executed.
export const fixture = async (query: string, tenantIdOverride?: string) => [query, tenantIdOverride];
