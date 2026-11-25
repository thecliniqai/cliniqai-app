"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { registerQueryClientCleanup } from "./client";
import { createQueryClient } from "./policy";

const ClearedContext = createContext(false);

/**
 * The tab's one `QueryClient` (V2-09e 09E-03, R-14), around the dashboard shell (09E-13: the shell itself reads the session bootstrap from it). Created once
 * per mounted provider (never at module level, so one server request never shares it with another). After a sign-out, a lock or a clinic switch has cleared
 * it, the screens are no longer rendered ({@link QueryScreens}): the page is about to be replaced by a hard navigation and shows nothing of the old clinic
 * meanwhile. The provider itself keeps its children (the shell) as they are: re-rendering them would make their queries read again.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(createQueryClient);
  const [cleared, setCleared] = useState(false);
  useEffect(() => registerQueryClientCleanup(client, () => setCleared(true)), [client]);
  return (
    <QueryClientProvider client={client}>
      <ClearedContext.Provider value={cleared}>{children}</ClearedContext.Provider>
    </QueryClientProvider>
  );
}

/** The screens inside the shell: rendered until the client has been cleared (sign-out, lock, clinic switch), then nothing. */
export function QueryScreens({ children }: { children: React.ReactNode }) {
  return useContext(ClearedContext) ? null : <>{children}</>;
}
