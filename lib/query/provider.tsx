"use client";

import { useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { registerQueryClientCleanup } from "./client";
import { createQueryClient } from "./policy";

/**
 * The tab's one `QueryClient` (V2-09e 09E-03, R-14), inside the dashboard shell. Created once per mounted provider (never at module
 * level, so one server request never shares it with another). After a sign-out, a lock or a clinic switch has cleared it, the screens
 * are no longer rendered: the page is about to be replaced by a hard navigation and shows nothing of the old clinic meanwhile.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(createQueryClient);
  const [cleared, setCleared] = useState(false);
  useEffect(() => registerQueryClientCleanup(client, () => setCleared(true)), [client]);
  return <QueryClientProvider client={client}>{cleared ? null : children}</QueryClientProvider>;
}
