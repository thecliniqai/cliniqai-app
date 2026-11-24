"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { browserResumeListen, startResumeRefresh } from "@/lib/pwa/resume";
import { refreshWhenReachable } from "@/lib/pwa/safe-refresh";

/**
 * The refresh on resume (V2-06 06-04b; moved into the query provider by V2-09e 09E-03, R-14). A live view comes back to the foreground
 * (or the network returns) and re-reads its data. A screen on the client data layer (Today: its queries are marked `meta.live`) has its
 * live queries invalidated, which is one data request and no page render; a live view not on it yet (the schedule) still gets the page
 * refreshed, only while the server answers (`refreshWhenReachable`: a refresh that fails mid-flight becomes a full navigation).
 */
const QUERY_BACKED_VIEWS: readonly string[] = ["/today"];

export function ResumeRefresh() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname() || "/";
  const currentPath = useRef(pathname);
  useEffect(() => {
    currentPath.current = pathname;
  }, [pathname]);

  useEffect(
    () =>
      startResumeRefresh({
        pathname: () => currentPath.current,
        refresh: () => {
          const path = currentPath.current.length > 1 ? currentPath.current.replace(/\/+$/, "") : currentPath.current;
          if (QUERY_BACKED_VIEWS.includes(path)) {
            void queryClient.invalidateQueries({ predicate: (query) => query.meta?.live === true }, { cancelRefetch: false });
            return;
          }
          void refreshWhenReachable(() => router.refresh());
        },
        isVisible: () => document.visibilityState === "visible",
        listen: browserResumeListen,
        now: () => Date.now(),
      }),
    [router, queryClient],
  );
  return null;
}
