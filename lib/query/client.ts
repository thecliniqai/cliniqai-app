import type { QueryClient } from "@tanstack/react-query";
import { registerCleanup } from "@/lib/pwa/cleanup";

/**
 * One `QueryClient` per tab (V2-09e 09E-03, R-14), created by the dashboard shell's provider (`provider.tsx`) and registered here with the
 * cleanup registry, so every exit empties it before anything else happens: sign-out and lock (`runCleanups`), and the clinic switch
 * (`runCleanups("switch")`, run before the hard navigation). A cleanup removes every query, cancels what is in flight and runs
 * `onCleared` (the provider stops rendering the screens, so nothing of the old data stays on the page).
 */
export function registerQueryClientCleanup(client: QueryClient, onCleared: () => void): () => void {
  return registerCleanup(async () => {
    await client.cancelQueries();
    client.clear();
    onCleared();
  });
}
