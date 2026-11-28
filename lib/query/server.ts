import "server-only";

import { dehydrate, type DehydratedState, type QueryClient } from "@tanstack/react-query";
import { createQueryClient } from "./policy";

/**
 * A page's per-request client (V2-09e 09E-03, R-14): made inside the request (never shared between requests or users), filled with
 * what the page has already read, and dehydrated for the browser's `HydrationBoundary`. Only queries that succeeded are carried.
 */
export function createRequestQueryClient(): QueryClient {
  return createQueryClient();
}

export function dehydrateRequest(client: QueryClient): DehydratedState {
  return dehydrate(client);
}
